const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const scriptId = "alinflow-google-maps-script";
const fakeKey = "SYNTHETIC-KEY-&=/?";

function fixture({ appendFailure = false, existingMaps, previousAuthFailure } = {}) {
  const timers = new Map();
  let timerId = 0;
  const scripts = [];
  const window = {
    setTimeout(callback, ms) { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    ...(existingMaps ? { google: { maps: existingMaps } } : {}),
    ...(previousAuthFailure ? { gm_authFailure: previousAuthFailure } : {}),
  };
  const document = {
    getElementById(id) { return scripts.find(script => script.id === id && !script.removed) || null; },
    createElement(tag) {
      assert.equal(tag, "script");
      return { id: "", src: "", onerror: null, onload: null, remove() { this.removed = true; } };
    },
    head: { appendChild(script) {
      if (appendFailure) throw new Error(`Browser failure containing ${fakeKey}`);
      scripts.push(script);
    } },
  };
  const globals = { window, document };
  const { loadGoogleMaps, subscribeGoogleMapsAuthFailure } = harness(globals).load("src/lib/alinflow/google-maps-loader.ts");
  const callback = (script = scripts.at(-1)) => new URL(script.src).searchParams.get("callback");
  const success = (script = scripts.at(-1)) => {
    const maps = { Map: function Map() {} };
    window.google = { maps };
    window[callback(script)]();
    return maps;
  };
  return { loadGoogleMaps, subscribeGoogleMapsAuthFailure, window, document, scripts, timers, globals, callback, success };
}

test("concurrent maps share one callback-based request with Hungarian options", async () => {
  const f = fixture();
  const first = f.loadGoogleMaps(fakeKey);
  const second = f.loadGoogleMaps(fakeKey);
  assert.equal(first, second);
  assert.equal(f.scripts.length, 1);
  const script = f.scripts[0];
  assert.equal(script.id, scriptId);
  assert.equal(script.async, true);
  const url = new URL(script.src);
  assert.equal(url.origin, "https://maps.googleapis.com");
  assert.equal(url.pathname, "/maps/api/js");
  assert.equal(url.searchParams.get("key"), fakeKey);
  assert.equal(url.searchParams.get("loading"), "async");
  assert.equal(url.searchParams.get("language"), "hu");
  assert.equal(url.searchParams.get("region"), "HU");
  assert.equal(url.searchParams.get("v"), "weekly");
  let settled = false;
  first.then(() => { settled = true; });
  script.onload?.();
  await Promise.resolve();
  assert.equal(settled, false, "script load cannot substitute for API callback readiness");
  const maps = f.success();
  assert.equal(await first, maps);
  assert.equal(await second, maps);
  assert.equal(f.timers.size, 0);
  assert.equal(await f.loadGoogleMaps(fakeKey), maps);
  assert.equal(f.scripts.length, 1);
  assert.equal(typeof f.window.gm_authFailure, "function", "authentication monitoring remains active after readiness");
});

test("the loader reuses an already usable Google API without inserting a script", async () => {
  const maps = { Map() {} };
  const f = fixture({ existingMaps: maps });
  assert.equal(await f.loadGoogleMaps(fakeKey), maps);
  assert.equal(f.scripts.length, 0);
  assert.equal(f.timers.size, 0);
});

test("separate module instances still share the same in-flight browser promise", async () => {
  const f = fixture();
  const another = harness(f.globals).load("src/lib/alinflow/google-maps-loader.ts");
  const first = f.loadGoogleMaps(fakeKey);
  const second = another.loadGoogleMaps(fakeKey);
  assert.equal(first, second);
  assert.equal(f.scripts.length, 1);
  assert.equal(await (f.success(), second), f.window.google.maps);
});

test("network failure removes the owned script and allows a fresh retry", async () => {
  const f = fixture();
  const first = f.loadGoogleMaps(fakeKey);
  const oldScript = f.scripts[0];
  oldScript.onerror({ message: `Provider failure ${fakeKey}` });
  await assert.rejects(first, error => /Nem sikerült/.test(error.message) && !error.message.includes(fakeKey));
  assert.equal(oldScript.removed, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.window.__alinflowGoogleMapsLoader, undefined);
  const retry = f.loadGoogleMaps(fakeKey);
  assert.notEqual(retry, first);
  assert.equal(f.scripts.length, 2);
  assert.notEqual(f.callback(oldScript), f.callback());
  assert.equal(await (f.success(), retry), f.window.google.maps);
});

test("timeout and late callbacks cannot complete or damage a later attempt", async () => {
  const f = fixture();
  const first = f.loadGoogleMaps(fakeKey);
  const oldScript = f.scripts[0];
  const oldName = f.callback(oldScript);
  const oldCallback = f.window[oldName];
  const timeout = [...f.timers.values()][0];
  assert.equal(timeout.ms, 25_000);
  timeout.callback();
  await assert.rejects(first, /túl sokáig/);
  assert.equal(oldScript.removed, true);
  const retry = f.loadGoogleMaps(fakeKey);
  let retrySettled = false;
  retry.then(() => { retrySettled = true; });
  f.window.google = { maps: { Map() {} } };
  assert.doesNotThrow(() => f.window[oldName]());
  assert.doesNotThrow(() => oldCallback());
  await Promise.resolve();
  assert.equal(retrySettled, false);
  assert.equal(f.loadGoogleMaps(fakeKey), retry, "partially initialized global cannot bypass the active callback");
  assert.equal(await (f.success(), retry), f.window.google.maps);
});

test("authentication failure rejects safely and restores the previous global handler", async () => {
  let calls = 0;
  const previous = () => { calls++; throw Error(`Old handler ${fakeKey}`); };
  const f = fixture({ previousAuthFailure: previous });
  const first = f.loadGoogleMaps(fakeKey);
  const oldAuth = f.window.gm_authFailure;
  f.window.google = { maps: { Map() {} } };
  assert.doesNotThrow(() => oldAuth());
  await assert.rejects(first, error => /hozzáférése/.test(error.message) && !error.message.includes(fakeKey));
  assert.equal(calls, 1);
  assert.equal(f.window.gm_authFailure, previous);
  assert.equal(f.window.__alinflowGoogleMapsLoader, undefined);
  const retry = f.loadGoogleMaps(fakeKey);
  assert.equal(f.scripts.length, 2, "rejected API constructors must not masquerade as a successful retry");
  assert.doesNotThrow(() => oldAuth());
  assert.equal(calls, 1);
  assert.equal(await (f.success(), retry), f.window.google.maps);
  assert.notEqual(f.window.gm_authFailure, previous, "the successful retry keeps its own authentication hook");
});

test("late authentication failure notifies canvases and invalidates a cached successful load", async () => {
  let previousCalls = 0;
  const previous = () => { previousCalls++; throw Error(`Old handler ${fakeKey}`); };
  const f = fixture({ previousAuthFailure: previous });
  const first = f.loadGoogleMaps(fakeKey);
  const oldScript = f.scripts[0];
  const oldAuth = f.window.gm_authFailure;
  const maps = f.success();
  await first;
  const errors = [];
  f.subscribeGoogleMapsAuthFailure(error => errors.push(error.message));

  assert.doesNotThrow(() => f.window.gm_authFailure());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /hozzáférése/);
  assert.equal(errors[0].includes(fakeKey), false);
  assert.equal(previousCalls, 1);
  assert.equal(f.window.__alinflowGoogleMapsLoader, undefined);
  assert.equal(f.window.__alinflowGoogleMapsFailedNamespace, maps);
  assert.equal(f.window.gm_authFailure, previous);
  assert.equal(oldScript.removed, true);

  const retry = f.loadGoogleMaps(fakeKey);
  assert.notEqual(retry, first);
  assert.equal(f.scripts.length, 2, "late failure must not return the cached, rejected namespace");
  assert.doesNotThrow(() => oldAuth());
  assert.equal(errors.length, 1, "an obsolete hook cannot affect the new attempt");
  assert.equal(previousCalls, 1);
  const retryMaps = f.success();
  assert.equal(await retry, retryMaps);
  assert.equal(f.window.__alinflowGoogleMapsFailedNamespace, undefined);
  assert.equal(await f.loadGoogleMaps(fakeKey), retryMaps);

  assert.doesNotThrow(() => f.window.gm_authFailure());
  assert.equal(errors.length, 2);
  assert.equal(previousCalls, 2, "retry must forward only the original hook without a recursive hook chain");
});

test("authentication subscriptions span module instances, unsubscribe and isolate listener errors", async () => {
  const f = fixture();
  const another = harness(f.globals).load("src/lib/alinflow/google-maps-loader.ts");
  const seen = [];
  const unsubscribe = f.subscribeGoogleMapsAuthFailure(() => seen.push("removed"));
  unsubscribe();
  unsubscribe();
  f.subscribeGoogleMapsAuthFailure(() => { throw Error(`Listener failure ${fakeKey}`); });
  const unsubscribeActive = another.subscribeGoogleMapsAuthFailure(() => seen.push("active"));
  const pending = f.loadGoogleMaps(fakeKey);
  assert.doesNotThrow(() => f.window.gm_authFailure());
  await assert.rejects(pending, /hozzáférése/);
  assert.deepEqual(seen, ["active"]);
  unsubscribeActive();
  const retry = f.loadGoogleMaps(fakeKey);
  f.success();
  await retry;
  assert.doesNotThrow(() => f.window.gm_authFailure());
  assert.deepEqual(seen, ["active"]);
  assert.doesNotThrow(() => harness().load("src/lib/alinflow/google-maps-loader.ts")
    .subscribeGoogleMapsAuthFailure(() => {})());
});

test("an incomplete API callback rejects instead of reporting a usable map", async () => {
  const f = fixture();
  const pending = f.loadGoogleMaps(fakeKey);
  f.window.google = { maps: {} };
  f.window[f.callback()]();
  await assert.rejects(pending, /nem áll készen/);
  assert.equal(f.window.__alinflowGoogleMapsLoader, undefined);
});

test("an orphaned AlinFlow script cannot pin retries to an old failed request", async () => {
  const f = fixture();
  const orphan = f.document.createElement("script");
  orphan.id = scriptId;
  f.scripts.push(orphan);
  const pending = f.loadGoogleMaps(fakeKey);
  assert.equal(orphan.removed, true);
  assert.equal(f.scripts.filter(script => !script.removed).length, 1);
  assert.equal(await (f.success(), pending), f.window.google.maps);
});

test("missing key, server rendering and insertion errors reject without exposing a key", async () => {
  const f = fixture();
  for (const value of ["", "   ", undefined, null]) {
    await assert.rejects(f.loadGoogleMaps(value), /beállítása hiányzik/);
  }
  assert.equal(f.scripts.length, 0);
  const server = harness().load("src/lib/alinflow/google-maps-loader.ts");
  await assert.rejects(server.loadGoogleMaps(fakeKey), /böngészőben/);
  const failed = fixture({ appendFailure: true });
  await assert.rejects(failed.loadGoogleMaps(fakeKey), error => /Nem sikerült/.test(error.message) && !error.message.includes(fakeKey));
  assert.equal(failed.window.__alinflowGoogleMapsLoader, undefined);
  assert.equal(failed.timers.size, 0);
});
