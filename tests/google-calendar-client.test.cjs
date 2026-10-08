const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const modulePath = "src/components/alinflow/GoogleCalendarSync.tsx";
const session = { user: { id: "user-fixture" }, access_token: "test-token" };
const connected = { configured: true, connected: true, status: "connected", pending: 0, canManage: true, managedAppointmentIds: [] };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(options = {}) {
  const effects = [], cleanups = [], requests = [], states = [], timers = [];
  const window = Object.assign(new EventTarget(), {
    location: { href: options.url || "https://app.example.test/" },
    history: { state: null, replaceState: (_state, _title, url) => { window.location.href = `https://app.example.test${url}`; } },
    setInterval: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearInterval: () => {},
  });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const react = {
    useEffect: (effect) => effects.push(effect),
    useRef: (current) => ({ current }),
    useState: (initial) => {
      const index = states.length;
      states.push(initial);
      return [initial, (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
  };
  const api = harness({
    window, document, AbortController, DOMException, CustomEvent,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return options.fetch ? options.fetch(url, init) : Response.json(url.includes("/status") ? (options.status || connected) : { processed: 1, synced: 1, failed: 0 });
    },
  }, { react, "@/lib/supabase": { supabase: { auth: { getSession: options.getSession || (async () => ({ data: { session }, error: null })) } } } }).load(modulePath);
  return {
    api, requests, states, timers, window, document,
    mount: () => {
      api.useGoogleCalendarSync({ workspaceId: "workspace-fixture", userId: "user-fixture", enabled: true, onReturn: options.onReturn || (() => {}) });
      effects.forEach((effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
    },
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
  };
}

test("calendar requests validate session identity and abort after an awaited session read", async () => {
  let resolveSession;
  const run = setup({ getSession: () => new Promise((resolve) => { resolveSession = resolve; }) });
  const controller = new AbortController();
  const request = run.api.requestGoogleCalendar("connect", "workspace-fixture", "user-fixture", controller.signal, { email: "test@example.test" });
  controller.abort();
  resolveSession({ data: { session }, error: null });
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(run.requests.length, 0);
  const changedUser = setup({ getSession: async () => ({ data: { session: { ...session, user: { id: "other-user" } } }, error: null }) });
  await assert.rejects(changedUser.api.requestGoogleCalendar("sync", "workspace-fixture", "user-fixture", new AbortController().signal), /bejelentkezés lejárt/);
  assert.equal(changedUser.requests.length, 0);
});

test("appointment changes coalesce behind one in-flight sync without losing a later save", async () => {
  let finishFirst;
  let syncs = 0;
  const run = setup({ fetch: async (url) => {
    if (url.includes("/status")) return Response.json(connected);
    syncs++;
    if (syncs === 1) await new Promise((resolve) => { finishFirst = resolve; });
    return Response.json({ processed: 1, synced: 1, failed: 0 });
  } });
  run.mount();
  await tick();
  run.api.notifyGoogleCalendarAppointmentsChanged("other-workspace");
  run.api.notifyGoogleCalendarAppointmentsChanged("workspace-fixture");
  run.api.notifyGoogleCalendarAppointmentsChanged("workspace-fixture");
  run.window.dispatchEvent(new Event("focus"));
  await tick();
  assert.equal(syncs, 1);
  finishFirst();
  await tick();
  assert.equal(syncs, 2);
  assert.ok(run.requests.every(({ url, init }) => url.includes("workspaceId=workspace-fixture") || JSON.parse(init.body).workspaceId === "workspace-fixture"));
  run.unmount();
});

test("hidden tabs skip periodic sync and disconnected workspaces never post sync", async () => {
  const run = setup();
  run.mount();
  await tick();
  assert.equal(run.timers[0].delay, 60_000);
  const initial = run.requests.length;
  run.document.visibilityState = "hidden";
  run.timers[0].callback();
  await tick();
  assert.equal(run.requests.length, initial);
  run.document.visibilityState = "visible";
  run.document.dispatchEvent(new Event("visibilitychange"));
  await tick();
  assert.ok(run.requests.length > initial);
  run.unmount();
  const paused = setup({ status: { ...connected, connected: false, status: "paused" } });
  paused.mount();
  await tick();
  paused.api.notifyGoogleCalendarAppointmentsChanged("workspace-fixture");
  paused.timers[0].callback();
  await tick();
  assert.equal(paused.requests.length, 2);
  assert.ok(paused.requests.every(({ init }) => init.method === "GET"));
  paused.unmount();
});

test("workspace cleanup cancels the pending request before it can sync", async () => {
  let finishStatus;
  const run = setup({ fetch: async (_url, init) => {
    await new Promise((resolve) => { finishStatus = resolve; });
    assert.equal(init.signal.aborted, true);
    return Response.json(connected);
  } });
  run.mount();
  await tick();
  run.unmount();
  finishStatus();
  await tick();
  run.api.notifyGoogleCalendarAppointmentsChanged("workspace-fixture");
  assert.equal(run.requests.length, 1);
});

test("new appointments are marked managed immediately while a long sync is running; old appointments are not enrolled", async () => {
  let finish;
  let block = true;
  const run = setup({ fetch: async (url) => {
    if (url.includes("/status")) return Response.json(connected);
    if (block) await new Promise((resolve) => { finish = resolve; });
    return Response.json({ processed: 1, synced: 1, failed: 0 });
  } });
  run.mount();
  await tick();
  run.api.notifyGoogleCalendarAppointmentsChanged("workspace-fixture", "new-appointment");
  assert.ok(run.states[0].status.managedAppointmentIds.includes("new-appointment"));
  run.api.notifyGoogleCalendarAppointmentsChanged("workspace-fixture");
  assert.equal(run.states[0].status.managedAppointmentIds.length, 1);
  run.api.notifyGoogleCalendarAppointmentsChanged("other-workspace", "foreign-appointment");
  assert.equal(run.states[0].status.managedAppointmentIds.length, 1);
  block = false;
  finish();
  await tick();
  assert.ok(run.states[0].status.managedAppointmentIds.includes("new-appointment"));
  run.unmount();
});

test("visible polling discovers a calendar connected on another device", async () => {
  let connection = { ...connected, connected: false, status: "not_connected" };
  const run = setup({ fetch: async (url) => Response.json(url.includes("/status") ? connection : { processed: 0, synced: 0, failed: 0 }) });
  run.mount();
  await tick();
  assert.equal(run.requests.length, 1);
  connection = connected;
  run.timers[0].callback();
  await tick();
  assert.equal(run.requests.filter(({ init }) => init.method === "POST").length, 1);
  assert.equal(run.states[0].status.connected, true);
  run.unmount();
});

test("a revoked calendar permission refreshes the connection state without changing appointment feedback", async () => {
  let revoked = false;
  const run = setup({ fetch: async (url) => {
    if (url.includes("/status")) return Response.json(revoked ? { ...connected, connected: false, status: "reauth_required" } : connected);
    revoked = true;
    return Response.json({ error: "Engedélyezd újra a naptárkapcsolatot." }, { status: 401 });
  } });
  run.mount();
  await tick();
  assert.equal(run.states[0].status.status, "reauth_required");
  assert.match(run.states[0].error, /Engedélyezd újra/);
  assert.equal(run.requests.length, 3);
  run.unmount();
});

test("OAuth outcome is consumed once and opens settings with a visible result", async () => {
  let opened = 0;
  const run = setup({ url: "https://app.example.test/?googleCalendar=wrong_account&keep=1", onReturn: () => opened++ });
  run.mount();
  await tick();
  assert.equal(opened, 1);
  assert.equal(run.window.location.href, "https://app.example.test/?keep=1");
  assert.match(run.states[1], /Másik Google-fiókot/);
  run.unmount();
});

test("missing Calendar permission opens settings with a specific checkbox instruction", async () => {
  let opened = 0;
  const run = setup({ url: "https://app.example.test/?googleCalendar=permissions_missing&keep=1", onReturn: () => opened++,
    status: { ...connected, connected: false, status: "not_connected" } });
  run.mount();
  await tick();
  assert.equal(opened, 1);
  assert.equal(run.window.location.href, "https://app.example.test/?keep=1");
  assert.match(run.states[1], /Google Naptár engedélye kimaradt/);
  assert.match(run.states[1], /Indítsd újra.*jelöld be.*jelölőnégyzetet/);
  assert.equal(run.requests.some(({ init }) => init.method === "POST"), false);
  run.unmount();
});

test("a failed appointment write never starts calendar sync; a completed write keeps its original workspace", async () => {
  let workspaceId = "original-workspace";
  let fail = true;
  const notifications = [];
  const fns = harness({ Error }).functions(["saveAppointmentWithJobMirror"], {
    currentWorkspaceId: () => workspaceId,
    user: { id: "user-fixture" },
    normalizeAppointmentType: (value) => value,
    normalizeStatus: (value) => value,
    notifyGoogleCalendarAppointmentsChanged: (id, newAppointmentId) => notifications.push({ id, newAppointmentId }),
    supabase: { rpc: async (_name, params) => {
      assert.equal(params.p_workspace_id, "original-workspace");
      workspaceId = "next-workspace";
      return fail ? { error: new Error("save rejected") } : { data: { appointment_id: "appointment-fixture" }, error: null };
    } },
  });
  const customer = { id: "customer-fixture", date: "2026-10-11", appointmentType: "survey" };
  await assert.rejects(fns.saveAppointmentWithJobMirror(customer), /save rejected/);
  assert.deepEqual(notifications, []);
  workspaceId = "original-workspace";
  fail = false;
  await fns.saveAppointmentWithJobMirror(customer);
  assert.deepEqual(notifications, [{ id: "original-workspace", newAppointmentId: "appointment-fixture" }]);
  workspaceId = "original-workspace";
  await fns.saveAppointmentWithJobMirror({ ...customer, activeAppointmentId: "previous-appointment" });
  assert.deepEqual(notifications[1], { id: "original-workspace", newAppointmentId: undefined });
});
