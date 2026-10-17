const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const clone = (value) => JSON.parse(JSON.stringify(value));
const entry = (index = 1, extra = {}) => ({
  appointmentId: `appointment-${index}`, customerId: `customer-${index}`,
  customerName: `Teszt Ügyfél ${index}`, appointmentType: "installation",
  date: "2026-10-18", time: "08:00", arrivalWindow: "8–9",
  phone: "+36301234567", text: `Kedves Teszt Ügyfél ${index}! Holnap telepítjük a klímáját. Köszönjük! KLIMAlin`,
  contentKey: `hash-${index}`, encoding: { encoding: "UCS-2", units: 150, segments: 3 },
  acknowledgedAt: null, changedSinceAcknowledgement: false, ...extra,
});
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clickEvent(extra = {}) {
  return {
    stopped: false, defaultPrevented: false,
    stopPropagation() { this.stopped = true; },
    preventDefault() { this.defaultPrevented = true; },
    ...extra,
  };
}
function ancestry(tree, target, parents = []) {
  if (Array.isArray(tree)) {
    for (const child of tree) { const path = ancestry(child, target, parents); if (path) return path; }
    return null;
  }
  if (!tree || typeof tree !== "object") return null;
  const path = [...parents, tree];
  return tree === target ? path : ancestry(tree.props?.children, target, path);
}

function remindersUI(options = {}) {
  const slots = [], effects = [], requests = [], clipboard = [], listeners = new Map(), selections = [], timers = new Map(), portals = [];
  let nextTimer = 0;
  let cursor = 0, dirty = false, tree, clock = "2026-10-17T10:00:00Z";
  const props = { workspaceId: "workspace-one", userId: "user-one", ...options.props };
  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return new Date(clock).getTime(); }
  }
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => {
        const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) {
        const record = { deps, cleanup: null }; slots[index] = record;
        effects.push(() => { previous?.cleanup?.(); record.cleanup = effect(); });
      }
    },
  };
  const listen = (prefix) => ({
    addEventListener(name, fn) { listeners.set(prefix + name, fn); },
    removeEventListener(name, fn) { if (listeners.get(prefix + name) === fn) listeners.delete(prefix + name); },
  });
  const document = { visibilityState: "visible", body: { style: { overflow: "" } }, activeElement: { focus() {} }, ...listen("document:") };
  const fetch = async (url, init) => {
    const request = { url: String(url), method: init.method, signal: init.signal, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(request);
    if (options.request) return options.request(request);
    return Response.json(init.method === "POST"
      ? { acknowledgedAt: "2026-10-17T10:05:00Z" }
      : { entries: options.entries || [entry()], date: "2026-10-18" });
  };
  const session = { data: { session: { user: { id: "user-one" }, access_token: "test-token" } }, error: null };
  const { AppointmentSmsRemindersButton } = harness({
    Date: MockDate, AbortController, DOMException, URLSearchParams, fetch, document,
    window: { ...listen("window:"),
      setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    navigator: {
      userAgent: options.platform === "ios" ? "iPhone" : options.platform === "android" ? "Android" : "Desktop",
      platform: options.platform === "ipad" ? "MacIntel" : "", maxTouchPoints: options.platform === "ipad" ? 5 : 0,
      clipboard: { async writeText(value) {
        if (options.copyError) throw Error("Permission denied");
        clipboard.push(value);
      } },
    },
  }, {
    react, "react/jsx-runtime": require("react/jsx-runtime"),
    "react-dom": { createPortal(children, host) { portals.push({ children, host }); return children; } },
    "@/lib/supabase": { supabase: { auth: { getSession: () => options.getSession ? options.getSession() : Promise.resolve(session) } } },
  }).load("src/components/alinflow/AppointmentSmsReminders.tsx");
  function render(changes = {}) {
    Object.assign(props, changes);
    let passes = 0;
    do {
      assert.ok(++passes < 15, "Effects must settle");
      dirty = false; cursor = 0; tree = AppointmentSmsRemindersButton(props);
      for (const area of nodes(tree, (node) => node.type === "textarea")) {
        area.props.ref?.({ focus() {}, select() { selections.push(area.props.value); } });
      }
      for (const run of effects.splice(0)) run();
    } while (dirty);
  }
  async function settle() {
    for (let i = 0; i < 6; i++) { await new Promise((resolve) => setImmediate(resolve)); render(); }
  }
  function button(label) {
    const found = nodes(tree, (node) => node.type === "button" && (label instanceof RegExp ? label.test(text(node)) : text(node) === label));
    assert.equal(found.length, 1, `Expected one button matching ${label}`);
    return found[0];
  }
  render();
  return {
    render, settle, requests, clipboard, listeners, selections, document, timers, portals,
    nodes: (predicate) => nodes(tree, predicate), text: () => text(tree), button,
    async click(label) {
      const control = button(label); assert.equal(Boolean(control.props.disabled), false, "Button must be enabled");
      control.props.onClick(clickEvent()); render(); await settle();
    },
    async open() { await this.click(props.calendarCard ? "SMS" : props.appointmentId ? "SMS-emlékeztető" : "SMS-emlékeztetők"); },
    async bubbleClick(control) {
      const path = ancestry(tree, control);
      assert.ok(path, "Click target belongs to the rendered SMS component");
      const event = clickEvent({ target: control });
      for (const node of [...path].reverse()) {
        event.currentTarget = node;
        node.props?.onClick?.(event);
        if (event.stopped) break;
      }
      if (!event.stopped) options.onParentClick?.(event);
      render(); await settle();
      return event;
    },
    clock(value) { clock = value; },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("calendar dialog loads only on opening, shows ten read-only rows, exact day tabs and desktop copy fallback", async () => {
  const ui = remindersUI({ entries: Array.from({ length: 12 }, (_, index) => entry(index + 1)) });
  await ui.settle(); assert.equal(ui.requests.length, 0);
  await ui.open();
  assert.match(ui.requests[0].url, /days=1/);
  assert.equal(ui.nodes((node) => node.props?.role === "dialog" && node.props["aria-modal"]).length, 1);
  assert.equal(ui.nodes((node) => node.type === "article").length, 10);
  assert.equal(ui.nodes((node) => node.type === "textarea" && node.props.readOnly).length, 10);
  assert.equal(ui.nodes((node) => node.type === "a").length, 0);
  assert.match(ui.text(), /Becsült hossz: 3 SMS-rész/);
  assert.match(ui.text(), /Másold a szöveget/);
  await ui.click("Következő");
  assert.equal(ui.nodes((node) => node.type === "article").length, 2);
  await ui.click("2 nap múlva"); assert.match(ui.requests.at(-1).url, /days=2/);
  await ui.click("3 nap múlva"); assert.match(ui.requests.at(-1).url, /days=3/);
  assert.equal(ui.requests.some((request) => request.method === "POST"), false);
  ui.cleanup();
});

for (const platform of ["ios", "android", "ipad"]) {
  test(`${platform} opens the single-recipient composer without acknowledging; explicit Elküldtem saves`, async () => {
    const ui = remindersUI({ platform }); await ui.open();
    assert.equal(ui.button("Elküldtem").props.disabled, true);
    const anchor = ui.nodes((node) => node.type === "a")[0];
    assert.match(anchor.props.href, platform === "android" ? /^sms:\+36301234567\?body=/ : /^sms:\+36301234567&body=/);
    let prevented = false;
    anchor.props.onClick({ preventDefault() { prevented = true; } }); ui.render(); await ui.settle();
    assert.equal(prevented, false);
    assert.equal(ui.requests.filter((request) => request.method === "POST").length, 0);
    await ui.click("Elküldtem");
    const request = ui.requests.find((candidate) => candidate.method === "POST");
    assert.deepEqual(request.body, { workspaceId: "workspace-one", customerId: "customer-1", appointmentId: "appointment-1", contentKey: "hash-1" });
    assert.equal(request.headers.Authorization, "Bearer test-token");
    assert.match(ui.text(), /Elküldöttnek jelölted/);
    assert.equal(ui.button("Elküldtem").props.disabled, true);
    ui.cleanup();
  });
}

test("successful copy only unlocks explicit acknowledgement and failure exposes manual selection", async () => {
  const ui = remindersUI(); await ui.open(); await ui.click("Szöveg másolása");
  assert.deepEqual(ui.clipboard, [entry().text]);
  assert.equal(ui.button("Elküldtem").props.disabled, false);
  assert.equal(ui.requests.some((request) => request.method === "POST"), false);
  await ui.click("Elküldtem");
  assert.equal(ui.requests.filter((request) => request.method === "POST").length, 1);
  const failed = remindersUI({ copyError: true }); await failed.open(); await failed.click("Szöveg másolása");
  assert.equal(failed.button("Elküldtem").props.disabled, true);
  assert.match(failed.text(), /A másolás nem sikerült/);
  assert.deepEqual(failed.selections, [entry().text]);
  await failed.click("Kimásoltam a szöveget");
  assert.equal(failed.button("Elküldtem").props.disabled, false);
  assert.equal(failed.requests.some((request) => request.method === "POST"), false);
  ui.cleanup(); failed.cleanup();
});

test("invalid phone never gets a composer or acknowledgement, and changed receipts are explained", async () => {
  const ui = remindersUI({ platform: "ios", entries: [entry(1, { phone: null, acknowledgedAt: "2026-10-16T10:00:00Z", changedSinceAcknowledgement: true })] });
  await ui.open();
  assert.equal(ui.nodes((node) => node.type === "a").length, 0);
  assert.match(ui.text(), /Hiányzó vagy hibás telefonszám/);
  assert.match(ui.text(), /A korábbi jelölés óta változott/);
  await ui.click("Szöveg másolása");
  assert.equal(ui.button("Elküldtem").props.disabled, true);
  ui.cleanup();
});

test("single-appointment button scopes both IDs and omits calendar tabs", async () => {
  const ui = remindersUI({ props: { appointmentId: "appointment-1", customerId: "customer-1" } }); await ui.open();
  assert.match(ui.requests[0].url, /appointmentId=appointment-1&customerId=customer-1/);
  assert.ok(!ui.requests[0].url.includes("days="));
  assert.equal(ui.nodes((node) => node.props?.role === "tab").length, 0);
  ui.cleanup();
});

test("workspace switch aborts a pending read and cannot reveal old customer data", async () => {
  const gate = deferred();
  const ui = remindersUI({ request: () => gate.promise });
  ui.button("SMS-emlékeztetők").props.onClick(clickEvent()); ui.render(); await ui.settle();
  assert.equal(ui.requests.length, 1);
  ui.render({ workspaceId: "workspace-two", userId: "user-two" });
  assert.equal(ui.requests[0].signal.aborted, true);
  gate.resolve(Response.json({ entries: [entry(1, { customerName: "Old private name" })], date: "2026-10-18" }));
  await ui.settle();
  assert.ok(!ui.text().includes("Old private name"));
  assert.equal(ui.nodes((node) => node.props?.role === "dialog").length, 0);
  ui.cleanup();
});

test("out-of-order day responses cannot replace the selected day's preview", async () => {
  const old = deferred();
  const ui = remindersUI({ request: (request) => request.url.includes("days=1") ? old.promise
    : Promise.resolve(Response.json({ entries: [entry(2)], date: "2026-10-19" })) });
  ui.button("SMS-emlékeztetők").props.onClick(clickEvent()); ui.render(); await ui.settle();
  await ui.click("2 nap múlva");
  assert.equal(ui.requests[0].signal.aborted, true);
  old.resolve(Response.json({ entries: [entry(99)], date: "2026-10-18" })); await ui.settle();
  assert.ok(ui.text().includes("Teszt Ügyfél 2")); assert.ok(!ui.text().includes("Teszt Ügyfél 99"));
  ui.cleanup();
});

test("409 refreshes changed content and clears preparation for the previous hash", async () => {
  let reads = 0;
  const ui = remindersUI({ request: (request) => request.method === "POST"
    ? Promise.resolve(Response.json({ error: "stale" }, { status: 409 }))
    : Promise.resolve(Response.json({ entries: [entry(1, { contentKey: ++reads === 1 ? "old" : "new", text: reads === 1 ? "Old text" : "Updated text" })], date: "2026-10-18" })) });
  await ui.open(); await ui.click("Szöveg másolása"); await ui.click("Elküldtem");
  assert.equal(reads, 2);
  assert.equal(ui.nodes((node) => node.type === "textarea")[0].props.value, "Updated text");
  assert.equal(ui.button("Elküldtem").props.disabled, true);
  assert.match(ui.text(), /Az időpont vagy az üzenet megváltozott/);
  assert.ok(!ui.text().includes("Elküldöttnek jelölted"));
  ui.cleanup();
});

test("failed acknowledgement remains retryable and rapid duplicate clicks issue one POST", async () => {
  const gate = deferred();
  const ui = remindersUI({ request: (request) => request.method === "POST" ? gate.promise
    : Promise.resolve(Response.json({ entries: [entry()], date: "2026-10-18" })) });
  await ui.open(); await ui.click("Szöveg másolása");
  const button = ui.button("Elküldtem"); button.props.onClick(clickEvent()); button.props.onClick(clickEvent()); ui.render(); await ui.settle();
  assert.equal(ui.requests.filter((request) => request.method === "POST").length, 1);
  gate.resolve(Response.json({ error: "Synthetic save failure" }, { status: 500 })); await ui.settle();
  assert.match(ui.text(), /Synthetic save failure/);
  assert.equal(ui.button("Elküldtem").props.disabled, false);
  assert.ok(!ui.text().includes("Elküldöttnek jelölted"));
  ui.cleanup();
});

test("focus refresh preserves preparation only for unchanged content and stops on closing", async () => {
  let reads = 0;
  const ui = remindersUI({ request: () => Promise.resolve(Response.json({
    entries: [entry(1, { contentKey: ++reads <= 2 ? "same" : "changed" })], date: "2026-10-18",
  })) });
  await ui.open(); await ui.click("Szöveg másolása");
  ui.listeners.get("window:focus")(); await ui.settle();
  assert.equal(ui.button("Elküldtem").props.disabled, false);
  ui.clock("2026-10-17T10:00:01Z");
  ui.listeners.get("document:visibilitychange")(); await ui.settle();
  assert.equal(ui.button("Elküldtem").props.disabled, true);
  await ui.click("Bezárás");
  assert.equal(ui.listeners.has("window:focus"), false);
  assert.equal(ui.listeners.has("document:visibilitychange"), false);
  assert.equal(ui.document.body.style.overflow, "");
  ui.cleanup();
});

test("midnight blocks an old composer link and requests a fresh preview", async () => {
  const ui = remindersUI({ platform: "ios" }); await ui.open();
  const anchor = ui.nodes((node) => node.type === "a")[0];
  ui.clock("2026-10-17T22:01:00Z");
  let prevented = false;
  anchor.props.onClick({ preventDefault() { prevented = true; } }); ui.render(); await ui.settle();
  assert.equal(prevented, true);
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.button("Elküldtem").props.disabled, true);
  assert.equal(ui.requests.some((request) => request.method === "POST"), false);
  ui.cleanup();
});

test("session mismatch and a session resolving after scope change never fetch with stale credentials", async () => {
  const mismatch = remindersUI({ getSession: async () => ({ data: { session: { user: { id: "other-user" }, access_token: "wrong-token" } }, error: null }) });
  await mismatch.open(); assert.equal(mismatch.requests.length, 0); assert.match(mismatch.text(), /bejelentkezés lejárt/);
  const gate = deferred();
  const stale = remindersUI({ getSession: () => gate.promise });
  stale.button("SMS-emlékeztetők").props.onClick(clickEvent()); stale.render();
  stale.render({ workspaceId: "workspace-two" });
  gate.resolve({ data: { session: { user: { id: "user-one" }, access_token: "old-token" } }, error: null });
  await stale.settle(); assert.equal(stale.requests.length, 0);
  mismatch.cleanup(); stale.cleanup();
});

test("closing aborts a pending acknowledgement and reopening reads the saved server state", async () => {
  const gate = deferred(); let readCount = 0;
  const ui = remindersUI({ request: (request) => request.method === "POST" ? gate.promise
    : Promise.resolve(Response.json({ entries: [entry(1, { acknowledgedAt: ++readCount === 1 ? null : "2026-10-17T10:05:00Z" })], date: "2026-10-18" })) });
  await ui.open(); await ui.click("Szöveg másolása");
  ui.button("Elküldtem").props.onClick(clickEvent()); ui.render(); await ui.settle();
  await ui.click("Bezárás");
  assert.equal(ui.requests.find((request) => request.method === "POST").signal.aborted, true);
  gate.resolve(Response.json({ acknowledgedAt: "2026-10-17T10:05:00Z" })); await ui.settle();
  await ui.open(); assert.match(ui.text(), /Elküldöttnek jelölted/);
  assert.equal(ui.button("Elküldtem").props.disabled, true);
  ui.cleanup();
});

test("selecting the active day keeps its preview and day tabs support arrow-key navigation", async () => {
  const ui = remindersUI(); await ui.open(); await ui.click("Holnap");
  assert.equal(ui.nodes((node) => node.type === "article").length, 1);
  assert.equal(ui.requests.length, 1);
  let focused = false, prevented = false, selector = "";
  const tabs = ui.nodes((node) => node.props?.role === "tablist")[0];
  tabs.props.onKeyDown({ key: "ArrowRight", preventDefault() { prevented = true; },
    currentTarget: { querySelector(value) { selector = value; return { focus() { focused = true; } }; } } });
  ui.render(); await ui.settle();
  assert.equal(prevented, true); assert.equal(focused, true);
  assert.equal(selector, '[data-sms-day="2"]');
  assert.match(ui.requests.at(-1).url, /days=2/);
  assert.equal(ui.nodes((node) => node.props?.role === "tab" && node.props.tabIndex === 0).length, 1);
  ui.cleanup();
});

test("paired focus and visibility events coalesce into one refresh", async () => {
  let reads = 0;
  const gate = deferred();
  const ui = remindersUI({ request: () => ++reads === 1
    ? Promise.resolve(Response.json({ entries: [entry()], date: "2026-10-18" })) : gate.promise });
  await ui.open();
  ui.listeners.get("window:focus")();
  ui.listeners.get("document:visibilitychange")();
  ui.render(); await ui.settle();
  assert.equal(reads, 2);
  assert.equal(ui.requests[1].signal.aborted, false);
  gate.resolve(Response.json({ entries: [entry()], date: "2026-10-18" })); await ui.settle();
  ui.listeners.get("document:visibilitychange")(); await ui.settle();
  assert.equal(reads, 2);
  assert.equal(ui.timers.size, 0);
  ui.cleanup();
});

test("focus during acknowledgement does not abort the write or unlock duplicate submission", async () => {
  const gate = deferred();
  const ui = remindersUI({ request: (request) => request.method === "POST" ? gate.promise
    : Promise.resolve(Response.json({ entries: [entry()], date: "2026-10-18" })) });
  await ui.open(); await ui.click("Szöveg másolása");
  ui.button("Elküldtem").props.onClick(clickEvent()); ui.render(); await ui.settle();
  const write = ui.requests.find((request) => request.method === "POST");
  ui.listeners.get("window:focus")();
  ui.listeners.get("document:visibilitychange")();
  await ui.settle();
  assert.equal(write.signal.aborted, false);
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.button("Jelölés mentése…").props.disabled, true);
  gate.resolve(Response.json({ acknowledgedAt: "2026-10-17T10:05:00Z" })); await ui.settle();
  assert.match(ui.text(), /Elküldöttnek jelölted/);
  assert.equal(ui.timers.size, 0);
  ui.cleanup();
});

test("read timeout aborts the network and replaces loading with a retryable error", async () => {
  const gate = deferred();
  const ui = remindersUI({ request: () => gate.promise });
  ui.button("SMS-emlékeztetők").props.onClick(clickEvent()); ui.render(); await ui.settle();
  assert.equal(ui.timers.size, 1);
  const [timer] = ui.timers.values(); assert.equal(timer.delay, 20000); timer.fn(); await ui.settle();
  assert.equal(ui.requests[0].signal.aborted, true);
  assert.match(ui.text(), /A betöltés túl sokáig tartott/);
  assert.ok(!ui.text().includes("Emlékeztetők betöltése"));
  assert.equal(ui.timers.size, 0);
  ui.cleanup();
});

test("write timeout leaves the outcome unconfirmed and retries with the same content key", async () => {
  const pendingWrite = deferred();
  let writes = 0;
  const ui = remindersUI({ request: (request) => request.method === "GET"
    ? Promise.resolve(Response.json({ entries: [entry()], date: "2026-10-18" }))
    : ++writes === 1 ? pendingWrite.promise : Promise.resolve(Response.json({ acknowledgedAt: "2026-10-17T10:05:00Z" })) });
  await ui.open(); await ui.click("Szöveg másolása");
  ui.button("Elküldtem").props.onClick(clickEvent()); ui.render(); await ui.settle();
  const [timer] = ui.timers.values(); timer.fn(); await ui.settle();
  assert.match(ui.text(), /A jelölés visszaigazolása nem érkezett meg/);
  assert.ok(!ui.text().includes("Elküldöttnek jelölted"));
  assert.equal(ui.button("Elküldtem").props.disabled, false);
  await ui.click("Elküldtem");
  const submitted = ui.requests.filter((request) => request.method === "POST");
  assert.equal(submitted.length, 2);
  assert.deepEqual(submitted[0].body, submitted[1].body);
  assert.match(ui.text(), /Elküldöttnek jelölted/);
  assert.equal(ui.timers.size, 0);
  ui.cleanup();
});

test("compact calendar-card trigger is accessible, scopes one appointment and never bubbles or loads automatically", async () => {
  let parentClicks = 0;
  const ui = remindersUI({
    props: { calendarCard: true, workspaceId: "workspace-calendar", userId: "user-calendar", appointmentId: "appointment-calendar", customerId: "customer-calendar" },
    entries: [entry(1, { appointmentId: "appointment-calendar", customerId: "customer-calendar" })],
    getSession: async () => ({ data: { session: { user: { id: "user-calendar" }, access_token: "calendar-token" } }, error: null }),
    onParentClick() { parentClicks++; },
  });
  await ui.settle();
  const trigger = ui.button("SMS");
  assert.equal(trigger.props.title, "SMS-emlékeztető");
  assert.equal(trigger.props["aria-label"], "SMS-emlékeztető");
  assert.equal(ui.requests.length, 0);
  const event = await ui.bubbleClick(trigger);
  assert.equal(event.stopped, true);
  assert.equal(parentClicks, 0);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].method, "GET");
  const query = new URL(ui.requests[0].url, "https://example.test").searchParams;
  assert.equal(query.get("workspaceId"), "workspace-calendar");
  assert.equal(query.get("appointmentId"), "appointment-calendar");
  assert.equal(query.get("customerId"), "customer-calendar");
  assert.equal(query.has("days"), false);
  assert.equal(ui.requests[0].headers.Authorization, "Bearer calendar-token");
  assert.equal(ui.nodes((node) => node.props?.role === "dialog" && node.props["aria-label"] === "SMS-emlékeztető").length, 1);
  assert.equal(ui.nodes((node) => node.props?.role === "tab").length, 0);
  assert.equal(ui.portals.at(-1).host, ui.document.body);
  assert.equal(ui.requests.some((request) => request.method === "POST"), false);
  ui.cleanup();
});

test("calendar-card dialog content, composer and backdrop clicks cannot trigger the parent calendar day", async () => {
  let parentClicks = 0;
  const ui = remindersUI({
    props: { calendarCard: true, appointmentId: "appointment-1", customerId: "customer-1" },
    platform: "ios", onParentClick() { parentClicks++; },
  });
  await ui.open();
  const [preview] = ui.nodes((node) => node.type === "textarea");
  const previewClick = await ui.bubbleClick(preview);
  assert.equal(previewClick.stopped, true);
  assert.equal(ui.nodes((node) => node.props?.role === "dialog").length, 1);
  await ui.bubbleClick(ui.button("Szöveg másolása"));
  assert.deepEqual(ui.clipboard, [entry().text]);
  const [composer] = ui.nodes((node) => node.type === "a");
  const composerClick = await ui.bubbleClick(composer);
  assert.equal(composerClick.stopped, true);
  assert.equal(composerClick.defaultPrevented, false, "The phone composer action remains allowed");
  assert.equal(ui.nodes((node) => node.props?.role === "dialog").length, 1);
  assert.equal(ui.requests.some((request) => request.method === "POST"), false);
  const [backdrop] = ui.nodes((node) => node.type === "div" && typeof node.props?.onClick === "function"
    && nodes(node, (child) => child.props?.role === "dialog").length === 1);
  assert.ok(backdrop);
  const backdropClick = await ui.bubbleClick(backdrop);
  assert.equal(backdropClick.stopped, true);
  assert.equal(ui.nodes((node) => node.props?.role === "dialog").length, 0);
  assert.equal(parentClicks, 0);
  assert.equal(ui.requests.some((request) => request.method === "POST"), false);
  ui.cleanup();
});

test("disabled compact calendar-card SMS never opens a dialog or fetches", async () => {
  const ui = remindersUI({ props: { calendarCard: true, appointmentId: "appointment-1", customerId: "customer-1", disabled: true } });
  await ui.settle();
  assert.equal(ui.button("SMS").props.disabled, true);
  assert.equal(ui.nodes((node) => node.props?.role === "dialog").length, 0);
  assert.equal(ui.requests.length, 0);
  ui.cleanup();
});
