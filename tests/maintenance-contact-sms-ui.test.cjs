const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const draft = (extra = {}) => ({
  customerName: "Teszt Ügyfél", phone: "+36301234567",
  text: "Kedves Teszt Ügyfél! Klímakarbantartás egyeztetése miatt kerestük telefonon. Kérjük, hívjon vissza! Teszt Klíma",
  encoding: { encoding: "UCS-2", units: 1, segments: 99 }, ...extra,
});
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function event() {
  return { defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
}
function smsUI(options = {}) {
  const slots = [], effects = [], requests = [], clipboard = [], selections = [], listeners = new Map(), timers = new Map();
  let cursor = 0, dirty = false, tree, timerId = 0, mounted = true, closeCount = 0;
  const props = { workspaceId: "workspace-one", userId: "user-one",
    target: { type: "own", customerId: "customer-one", installationId: "installation-one" },
    onClose() { closeCount++; }, ...options.props };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => {
        const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) {
        const record = { deps, cleanup: null }; slots[index] = record;
        effects.push(() => { previous?.cleanup?.(); record.cleanup = effect(); });
      }
    },
  };
  const listen = prefix => ({
    addEventListener(name, fn) { listeners.set(prefix + name, fn); },
    removeEventListener(name, fn) { if (listeners.get(prefix + name) === fn) listeners.delete(prefix + name); },
  });
  const nativeDialog = { open: false, showCount: 0, closeCount: 0,
    showModal() { this.open = true; this.showCount++; }, close() { this.open = false; this.closeCount++; } };
  const document = { visibilityState: "visible", ...listen("document:") };
  const session = { data: { session: { access_token: "synthetic-token", user: { id: "user-one" } } }, error: null };
  const fetch = async (url, init) => {
    const request = { url: String(url), method: init.method || "GET", ...init }; requests.push(request);
    assert.equal(request.method, "GET", "The contact SMS UI must never write or send messages");
    assert.equal(request.body, undefined);
    return options.request ? options.request(request) : Response.json({ draft: options.draft || draft() });
  };
  const { MaintenanceContactSmsDialog } = harness({
    AbortController, DOMException, URLSearchParams, fetch, document,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    window: listen("window:"),
    navigator: {
      userAgent: options.platform === "ios" ? "iPhone" : options.platform === "android" ? "Android" : "Desktop",
      platform: options.platform === "ipad" ? "MacIntel" : "", maxTouchPoints: options.platform === "ipad" ? 5 : 0,
      clipboard: options.noClipboard ? undefined : { async writeText(value) {
        if (options.copyError) throw Error("Permission denied");
        clipboard.push(value);
        if (options.copy) await options.copy(value);
      } },
    },
  }, { react, "react/jsx-runtime": require("react/jsx-runtime"),
    "@/lib/supabase": { supabase: { auth: { getSession: () => options.getSession ? options.getSession() : Promise.resolve(session) } } },
  }).load("src/components/alinflow/MaintenanceContactSms.tsx");
  function render(changes = {}) {
    if (!mounted) return;
    Object.assign(props, changes);
    let passes = 0;
    do {
      assert.ok(++passes < 15, "Effects must settle");
      cursor = 0; dirty = false; tree = MaintenanceContactSmsDialog(props);
      for (const dialog of nodes(tree, node => node.type === "dialog")) dialog.props.ref.current = nativeDialog;
      for (const area of nodes(tree, node => node.type === "textarea")) area.props.ref.current = {
        focus() {}, select() { selections.push(area.props.value); },
      };
      for (const run of effects.splice(0)) run();
    } while (dirty);
  }
  async function settle() { for (let i = 0; i < 6; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } }
  function button(label) {
    const found = nodes(tree, node => node.type === "button" && (node.props["aria-label"] === label || text(node) === label));
    assert.equal(found.length, 1, `Expected one button matching ${label}`); return found[0];
  }
  function cleanup() {
    mounted = false;
    for (const slot of slots) slot?.cleanup?.();
  }
  render();
  return { render, settle, button, cleanup, requests, clipboard, selections, listeners, timers, document, nativeDialog,
    nodes: predicate => nodes(tree, predicate), text: () => text(tree), closeCount: () => closeCount,
    async click(label) { button(label).props.onClick(event()); render(); await settle(); },
    async emit(name) { listeners.get(name)?.(); render(); await settle(); },
    async expire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } await settle(); },
  };
}

test("native modal reads one saved scope and desktop offers copy without claiming delivery", async () => {
  const ui = smsUI(); await ui.settle();
  assert.equal(ui.nativeDialog.open, true); assert.equal(ui.nativeDialog.showCount, 1);
  assert.equal(ui.requests.length, 1);
  const query = new URL(ui.requests[0].url, "https://example.test").searchParams;
  assert.equal(query.get("workspaceId"), "workspace-one"); assert.equal(query.get("type"), "own");
  assert.equal(query.get("customerId"), "customer-one"); assert.equal(query.get("installationId"), "installation-one");
  assert.equal(ui.requests[0].headers.Authorization, "Bearer synthetic-token"); assert.equal(ui.requests[0].cache, "no-store");
  assert.equal(ui.nodes(node => node.type === "a").length, 0);
  const area = ui.nodes(node => node.type === "textarea")[0];
  assert.equal(area.props.readOnly, true); assert.equal(area.props.value, draft().text);
  assert.match(ui.text(), /Becsült hossz: 2 SMS-rész/); assert.doesNotMatch(ui.text(), /99 SMS-rész|Elküldtem|elküldve/i);
  await ui.click("Szöveg másolása"); assert.deepEqual(ui.clipboard, [draft().text]);
  assert.match(ui.text(), /Szöveg kimásolva/); assert.equal(ui.requests.length, 1);
  ui.cleanup(); assert.equal(ui.nativeDialog.open, false); assert.equal(ui.listeners.size, 0);
});

test("iOS, iPad and Android hand over exactly one recipient and the complete accented preview", async () => {
  for (const platform of ["ios", "ipad", "android"]) {
    const value = draft({ text: "Kedves Teszt Ügyfél! Árvíztűrő tükörfúrógép & + ? # =" });
    const ui = smsUI({ platform, draft: value }); await ui.settle();
    const anchor = ui.nodes(node => node.type === "a")[0];
    assert.equal(anchor.props.href, `sms:${value.phone}${platform === "android" ? "?" : "&"}body=${encodeURIComponent(value.text)}`);
    const click = event(); anchor.props.onClick(click); assert.equal(click.defaultPrevented, false);
    assert.equal(ui.requests.length, 1); assert.doesNotMatch(ui.text(), /elküldve|Elküldtem/i); ui.cleanup();
  }
});

test("missing phone allows reading and copying but never a native composer link", async () => {
  const ui = smsUI({ platform: "ios", draft: draft({ phone: null }) }); await ui.settle();
  assert.equal(ui.nodes(node => node.type === "a").length, 0);
  assert.match(ui.text(), /Hiányzó vagy hibás telefonszám/);
  await ui.click("Szöveg másolása"); assert.deepEqual(ui.clipboard, [draft().text]); ui.cleanup();
});

test("clipboard failure or unavailability selects the preview for manual copying", async () => {
  for (const options of [{ copyError: true }, { noClipboard: true }]) {
    const ui = smsUI(options); await ui.settle(); await ui.click("Szöveg másolása");
    assert.deepEqual(ui.selections, [draft().text]); assert.match(ui.text(), /másold ki kézzel/);
    assert.equal(ui.requests.length, 1); ui.cleanup();
  }
});

test("invalid or missing session never reaches the preview endpoint", async () => {
  for (const session of [null, { access_token: "wrong-user-token", user: { id: "other-user" } }, { user: { id: "user-one" } }]) {
    const ui = smsUI({ getSession: async () => ({ data: { session }, error: null }) }); await ui.settle();
    assert.equal(ui.requests.length, 0); assert.match(ui.text(), /bejelentkezés lejárt/); ui.cleanup();
  }
});

test("shared scope contains only grant and installation identifiers, not a guessed customer", async () => {
  const ui = smsUI({ props: { target: { type: "shared", grantId: "grant-one", installationId: "source-installation" } } });
  await ui.settle(); const query = new URL(ui.requests[0].url, "https://example.test").searchParams;
  assert.equal(query.get("grantId"), "grant-one"); assert.equal(query.get("installationId"), "source-installation");
  assert.equal(query.get("customerId"), null); ui.cleanup();
});

test("changing recipient or workspace aborts the old read and ignores its late result", async () => {
  const old = deferred();
  const ui = smsUI({ platform: "ios", request: request => request.url.includes("customer-one") ? old.promise
    : Response.json({ draft: draft({ customerName: "Másik Teszt", phone: "+36701234567", text: "Másik ügyfél üzenete" }) }) });
  await ui.settle(); const first = ui.requests[0];
  ui.render({ workspaceId: "workspace-two", target: { type: "own", customerId: "customer-two", installationId: "installation-two" } });
  await ui.settle(); assert.equal(first.signal.aborted, true);
  old.resolve(Response.json({ draft: draft({ customerName: "Régi Teszt" }) })); await ui.settle();
  assert.match(ui.text(), /Másik Teszt/); assert.doesNotMatch(ui.text(), /Régi Teszt/);
  assert.match(ui.nodes(node => node.type === "a")[0].props.href, /^sms:\+36701234567/); ui.cleanup();
});

test("changing user while session lookup is pending never fetches with the previous user", async () => {
  const old = deferred(); let lookups = 0;
  const ui = smsUI({ getSession: () => ++lookups === 1 ? old.promise : Promise.resolve({ data: { session: {
    access_token: "new-user-token", user: { id: "user-two" },
  } }, error: null }) });
  ui.render({ userId: "user-two" }); await ui.settle();
  old.resolve({ data: { session: { access_token: "old-user-token", user: { id: "user-one" } } }, error: null });
  await ui.settle(); assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0].headers.Authorization, "Bearer new-user-token"); ui.cleanup();
});

test("closing aborts a pending read, removes focus listeners and prevents retained composer actions", async () => {
  const gate = deferred(); const loading = smsUI({ request: () => gate.promise }); await loading.settle();
  loading.cleanup(); assert.equal(loading.requests[0].signal.aborted, true); assert.equal(loading.listeners.size, 0);
  gate.resolve(Response.json({ draft: draft() })); await loading.settle();
  const loaded = smsUI({ platform: "android" }); await loaded.settle();
  const anchor = loaded.nodes(node => node.type === "a")[0]; const copy = loaded.button("Szöveg másolása");
  loaded.cleanup(); const click = event(); anchor.props.onClick(click); copy.props.onClick(event()); await loaded.settle();
  assert.equal(click.defaultPrevented, true); assert.equal(loaded.clipboard.length, 0);
});

test("late clipboard completion cannot show confirmation in a different recipient scope", async () => {
  const gate = deferred(); const ui = smsUI({ copy: () => gate.promise }); await ui.settle();
  ui.button("Szöveg másolása").props.onClick(event());
  ui.render({ target: { type: "own", customerId: "another-customer", installationId: "another-installation" } }); await ui.settle();
  gate.resolve(); await ui.settle(); assert.doesNotMatch(ui.text(), /Szöveg kimásolva/); ui.cleanup();
});

test("focus refresh blocks a retained old link immediately and replaces the saved phone", async () => {
  const gate = deferred(); let calls = 0;
  const ui = smsUI({ platform: "ios", request: () => ++calls === 1 ? Response.json({ draft: draft() }) : gate.promise });
  await ui.settle(); const anchor = ui.nodes(node => node.type === "a")[0];
  ui.listeners.get("window:focus")();
  const click = event(); anchor.props.onClick(click); assert.equal(click.defaultPrevented, true);
  ui.render(); await ui.settle(); assert.equal(ui.nodes(node => node.type === "a").length, 0);
  gate.resolve(Response.json({ draft: draft({ phone: "+36701234567" }) })); await ui.settle();
  assert.match(ui.nodes(node => node.type === "a")[0].props.href, /^sms:\+36701234567/); ui.cleanup();
});

test("hidden tab does not refresh and a revoked grant removes all composer actions", async () => {
  let calls = 0;
  const ui = smsUI({ platform: "ios", request: () => ++calls === 1 ? Response.json({ draft: draft() })
    : Response.json({ error: "Nincs aktív hozzáférés." }, { status: 403 }) });
  await ui.settle(); ui.document.visibilityState = "hidden"; await ui.emit("document:visibilitychange");
  assert.equal(ui.requests.length, 1);
  ui.document.visibilityState = "visible"; await ui.emit("document:visibilitychange");
  assert.equal(ui.requests.length, 2); assert.match(ui.text(), /Nincs aktív hozzáférés/);
  assert.equal(ui.nodes(node => node.type === "a" || node.type === "textarea").length, 0); ui.cleanup();
});

test("endpoint failures are visible and retry only performs a new read", async () => {
  let calls = 0;
  const ui = smsUI({ request: () => ++calls === 1 ? Response.json({ error: "Átmeneti hiba." }, { status: 503 })
    : Response.json({ draft: draft() }) });
  await ui.settle(); assert.match(ui.text(), /Átmeneti hiba/);
  await ui.click("Újrapróbálás"); assert.equal(ui.requests.length, 2); assert.match(ui.text(), /Teszt Ügyfél/);
  assert.doesNotMatch(ui.text(), /Átmeneti hiba/); ui.cleanup();
});

test("the twenty-second timeout covers both a hanging session and a hanging network request", async () => {
  for (const beforeFetch of [true, false]) {
    const gate = deferred(); const ui = smsUI(beforeFetch ? { getSession: () => gate.promise } : { request: () => gate.promise });
    await ui.settle(); assert.equal([...ui.timers.values()][0].delay, 20000);
    await ui.expire(); assert.match(ui.text(), /túl sokáig tartott/); assert.doesNotMatch(ui.text(), /betöltése/);
    assert.equal(ui.timers.size, 0);
    if (!beforeFetch) assert.equal(ui.requests[0].signal.aborted, true);
    gate.resolve(beforeFetch ? { data: { session: { access_token: "late-token", user: { id: "user-one" } } }, error: null }
      : Response.json({ draft: draft() }));
    await ui.settle(); assert.match(ui.text(), /túl sokáig tartott/); assert.equal(ui.nodes(node => node.type === "textarea").length, 0);
    if (beforeFetch) assert.equal(ui.requests.length, 0); ui.cleanup();
  }
});

test("malformed drafts and multiple recipient numbers fail closed without a compose link", async () => {
  for (const malformed of [null, {}, draft({ text: " " }), draft({ customerName: 42 }), draft({ phone: "+36301234567;+36701234567" }), draft({ phone: "06301234567" })]) {
    const ui = smsUI({ platform: "ios", request: () => Response.json({ draft: malformed }) }); await ui.settle();
    assert.match(ui.text(), /válasza hiányos/); assert.equal(ui.nodes(node => node.type === "a" || node.type === "textarea").length, 0); ui.cleanup();
  }
});

test("escape and the close control request closing, while native dialog clicks do not bubble", async () => {
  const ui = smsUI(); await ui.settle(); const dialog = ui.nodes(node => node.type === "dialog")[0];
  const cancel = event(); dialog.props.onCancel(cancel); assert.equal(cancel.defaultPrevented, true); assert.equal(ui.closeCount(), 1);
  await ui.click("SMS-előnézet bezárása"); assert.equal(ui.closeCount(), 2);
  const click = event(); dialog.props.onClick(click); assert.equal(click.stopped, true); ui.cleanup();
});
