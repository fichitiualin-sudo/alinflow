const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");

function fixture(options = {}) {
  const entry = { workspace_id: "workspace-one", appointment_id: "appointment-one", desired_version: 2, lease_version: 2,
    lease_token: "lease-one", lease_expires_at: new Date(Date.now() + 120000).toISOString(), appointment_deleted: false,
    event_id: null, event_generation: 0, remote_deleted: false, attempts: 1, ...options.entry };
  const connection = { workspace_id: entry.workspace_id, calendar_id: "calendar@example.invalid", status: "connected", sync_from: "2026-10-01T00:00:00Z", refresh_token_encrypted: "encrypted-test-token" };
  const appointment = { id: entry.appointment_id, customer_id: "customer-one", quote_id: "quote-one", scheduled_date: "2026-11-10", scheduled_time: "08:00",
    appointment_type: "installation", status: "Időpont foglalva", address: "2750 Tesztváros, Példa utca 1.", created_at: "2026-10-08T10:00:00Z", ...options.appointment };
  const calls = [], rpcCalls = [], httpCalls = [];
  const admin = database(op => {
    calls.push(op);
    assert.equal(op.filters.workspace_id, entry.workspace_id, `${op.table} must be workspace scoped`);
    if (op.table === "google_calendar_connections") return { data: op.method === "update" ? null : connection, error: null };
    if (op.table === "google_calendar_sync_queue") return { data: { ...entry, ...options.currentQueue }, error: null };
    if (op.table === "appointments") { assert.equal(op.filters.id, entry.appointment_id); return { data: options.missingAppointment ? null : appointment, error: null }; }
    if (op.table === "customers") { assert.equal(op.filters.id, appointment.customer_id); return { data: { id: appointment.customer_id, name: "Synthetic Customer", phone: "06301234567", email: "synthetic@example.invalid", city: "OldCity", postal_code: "1111", address: "Old address", notes: "Synthetic note" }, error: null }; }
    if (op.table === "quotes") {
      assert.equal(op.filters.id, appointment.quote_id); assert.equal(op.filters.customer_id, appointment.customer_id);
      return { data: options.missingQuote ? null : { id: appointment.quote_id, notes: "quote_pricing_mode:bundle" }, error: null };
    }
    if (op.table === "quote_items") { assert.equal(op.filters.quote_id, appointment.quote_id); return { data: [{ product_name: "Saved equipment", description: "synthetic-product|install_price=40000", quantity: 2, unit_price: 123000, purchase_price: 99999 }], error: null }; }
    throw Error("Unexpected database operation " + op.table);
  });
  let remainingClaims = options.claims || 1;
  admin.rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === "claim_google_calendar_sync") {
      assert.equal(args.p_limit, 1);
      return { data: remainingClaims-- > 0 ? [entry] : [], error: null };
    }
    assert.equal(name, "finish_google_calendar_sync");
    return { data: true, error: null };
  };
  class GoogleCalendarAuthError extends Error {}
  const auth = { googleCalendarAdmin: () => admin, GoogleCalendarAuthError,
    calendarAccessToken: async () => { if (options.authError) throw new GoogleCalendarAuthError("never-log-this-token"); return "test-access-token"; } };
  const http = [...(options.responses || [{ status: 404 }, { status: 200, body: { id: "created" } }])];
  const worker = harness({ AbortSignal, fetch: async (url, init) => {
    const call = { url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    httpCalls.push(call);
    const response = http.shift();
    if (!response) throw Error("Unexpected HTTP request");
    if (response.throw) throw Error(response.throw);
    if (response.after) response.after(call);
    return new Response(response.status === 204 ? null : JSON.stringify(response.body || {}), { status: response.status });
  } }, { "node:crypto": require("node:crypto"), "./google-calendar-auth": auth }).load("src/lib/alinflow/google-calendar-sync.ts");
  const owned = (generation = entry.event_generation) => ({ etag: '"remote-version"', extendedProperties: { private: {
    alinflow_workspace_id: entry.workspace_id, alinflow_appointment_id: entry.appointment_id, alinflow_generation: String(generation),
  } } });
  return { worker, entry, connection, calls, rpcCalls, httpCalls, owned, finishes: () => rpcCalls.filter(call => call.name.startsWith("finish")).map(call => call.args) };
}

function owned(generation = 0) { return { etag: '"remote-version"', extendedProperties: { private: { alinflow_workspace_id: "workspace-one", alinflow_appointment_id: "appointment-one", alinflow_generation: String(generation) } } }; }

test("new event uses saved workspace-scoped data, deterministic valid Google ID, and sends no invitations", async () => {
  const f = fixture();
  const result = await f.worker.runGoogleCalendarSync("workspace-one");
  assert.equal(result.synced, 1);
  const created = f.httpCalls[1];
  assert.equal(created.method, "POST");
  assert.match(created.url, /calendar%40example\.invalid\/events\?sendUpdates=none$/);
  assert.match(created.body.id, /^[0-9a-v]{5,1024}$/);
  assert.equal(created.body.id, f.worker.googleCalendarEventId("workspace-one", "appointment-one", 0));
  assert.match(created.body.description, /Saved equipment.*246\s000 Ft/);
  assert.doesNotMatch(created.body.description, /99999|OldCity/);
  assert.equal(created.body.location, "2750 Tesztváros, Példa utca 1.");
  assert.equal(created.body.attendees, undefined);
  assert.equal(created.body.reminders.useDefault, false);
  assert.equal(f.finishes()[0].p_version, 2);
  assert.equal(f.finishes()[0].p_success, true);
});

test("updates own event with If-Match and retains its stable ID", async () => {
  const f = fixture({ entry: { event_id: "saved-event" }, responses: [{ status: 200, body: owned() }, { status: 200 }] });
  await f.worker.runGoogleCalendarSync("workspace-one");
  assert.equal(f.httpCalls[1].method, "PATCH");
  assert.equal(f.httpCalls[1].headers["If-Match"], '"remote-version"');
  assert.match(f.httpCalls[1].url, /\/saved-event\?sendUpdates=none$/);
  assert.equal(f.finishes()[0].p_event_id, "saved-event");
});

test("manual or other-workspace Google event is never patched or deleted", async () => {
  for (const appointment_deleted of [false, true]) {
    const f = fixture({ entry: { appointment_deleted, event_id: "foreign-event" }, responses: [{ status: 200, body: { etag: '"foreign"', extendedProperties: { private: { alinflow_workspace_id: "foreign" } } } }] });
    await f.worker.runGoogleCalendarSync();
    assert.equal(f.httpCalls.length, 1);
    assert.equal(f.finishes()[0].p_success, false);
    assert.match(f.finishes()[0].p_error, /nem módosítottuk/);
  }
});

test("cancelled or deleted appointment only deletes the matching event; missing remote event is success", async () => {
  for (const status of [404, 410]) {
    const f = fixture({ entry: { appointment_deleted: true }, responses: [{ status }] });
    await f.worker.runGoogleCalendarSync();
    assert.equal(f.calls.some(call => call.table === "customers"), false);
    assert.equal(f.finishes()[0].p_success, true);
    assert.equal(f.finishes()[0].p_remote_deleted, true);
  }
  const f = fixture({ appointment: { cancelled_at: "2026-10-08T11:00:00Z" }, responses: [{ status: 200, body: owned() }, { status: 204 }] });
  await f.worker.runGoogleCalendarSync();
  assert.equal(f.httpCalls[1].method, "DELETE");
  assert.equal(f.httpCalls[1].headers["If-Match"], '"remote-version"');
  assert.equal(f.finishes()[0].p_remote_deleted, true);
});

test("restored cancellation and Google tombstone choose stable next generation", async () => {
  for (const persisted of [false, true]) {
    const responses = [...(!persisted ? [{ status: 200, body: { id: "tombstone", status: "cancelled" } }] : []), { status: 404 }, { status: 200 }];
    const f = fixture({ entry: { remote_deleted: persisted }, responses });
    await f.worker.runGoogleCalendarSync();
    const inserted = f.httpCalls.find(call => call.method === "POST");
    assert.equal(inserted.body.id, f.worker.googleCalendarEventId("workspace-one", "appointment-one", 1));
    assert.equal(inserted.body.extendedProperties.private.alinflow_generation, "1");
    assert.equal(f.finishes()[0].p_event_generation, 1);
    assert.equal(f.finishes()[0].p_remote_deleted, false);
  }
});

test("ambiguous remote deletion followed by restore escapes a 410 tombstone without reusing its ID", async () => {
  const first = fixture({ appointment: { cancelled_at: "2026-10-08T11:00:00Z" }, responses: [
    { status: 200, body: owned() }, { throw: "response lost after Google accepted DELETE" },
  ] });
  await first.worker.runGoogleCalendarSync();
  const saved = first.finishes()[0];
  assert.equal(saved.p_remote_deleted, false);
  assert.equal(saved.p_success, false);
  const restored = fixture({ entry: { event_id: saved.p_event_id, event_generation: saved.p_event_generation, remote_deleted: saved.p_remote_deleted },
    responses: [{ status: 410 }, { status: 404 }, { status: 200 }] });
  await restored.worker.runGoogleCalendarSync();
  assert.equal(restored.httpCalls.map(call => call.method).join(","), "GET,GET,POST");
  assert.equal(restored.httpCalls[2].body.id, restored.worker.googleCalendarEventId("workspace-one", "appointment-one", 1));
  assert.notEqual(restored.httpCalls[2].body.id, saved.p_event_id);
  assert.equal(restored.finishes()[0].p_success, true);
});

test("ambiguous insert retries adopt the same owned ID rather than creating a duplicate", async () => {
  const first = fixture({ responses: [{ status: 404 }, { throw: "network error with secret test-access-token" }] });
  await first.worker.runGoogleCalendarSync();
  const saved = first.finishes()[0];
  assert.equal(saved.p_success, false);
  assert.doesNotMatch(saved.p_error, /test-access-token|network error/);
  const second = fixture({ entry: { event_id: saved.p_event_id }, responses: [{ status: 200, body: owned() }, { status: 200 }] });
  await second.worker.runGoogleCalendarSync();
  assert.equal(second.httpCalls.some(call => call.method === "POST"), false);
  assert.equal(second.finishes()[0].p_event_id, first.httpCalls[1].body.id);
});

test("409 insert response must be followed by ownership verification", async () => {
  const f = fixture({ responses: [{ status: 404 }, { status: 409 }, { status: 200, body: owned() }, { status: 200 }] });
  await f.worker.runGoogleCalendarSync();
  assert.equal(f.httpCalls.map(call => call.method).join(","), "GET,POST,GET,PATCH");
  assert.equal(f.finishes()[0].p_success, true);
  const other = fixture({ responses: [{ status: 404 }, { status: 409 }, { status: 200, body: { etag: '"foreign"' } }] });
  await other.worker.runGoogleCalendarSync();
  assert.equal(other.httpCalls.length, 3);
  assert.equal(other.finishes()[0].p_success, false);
});

test("newer appointment edit or lost lease prevents stale remote mutation", async () => {
  for (const currentQueue of [{ desired_version: 3 }, { lease_token: "other-worker" }, { lease_expires_at: new Date(Date.now() - 1).toISOString() }]) {
    const f = fixture({ currentQueue, responses: [{ status: 200, body: owned() }] });
    await f.worker.runGoogleCalendarSync();
    assert.equal(f.httpCalls.length, 1);
    assert.equal(f.finishes()[0].p_success, false);
    assert.equal(f.finishes()[0].p_version, 2);
    assert.equal(f.finishes()[0].p_lease_token, "lease-one");
  }
});

test("provider conflict stays queued without overwriting a concurrent Google change", async () => {
  const f = fixture({ responses: [{ status: 200, body: owned() }, { status: 412 }] });
  await f.worker.runGoogleCalendarSync();
  assert.equal(f.finishes()[0].p_success, false);
  assert.equal(f.httpCalls.length, 2);
});

test("revoked token marks same connection for reauthorization with no token leaks", async () => {
  const f = fixture({ authError: true });
  const result = await f.worker.runGoogleCalendarSync();
  assert.equal(result.failed, 1);
  assert.equal(f.httpCalls.length, 0);
  const update = f.calls.find(call => call.method === "update");
  assert.equal(update.value.status, "reauth_required");
  assert.equal(update.filters.refresh_token_encrypted, f.connection.refresh_token_encrypted);
  assert.doesNotMatch(f.finishes()[0].p_error, /token|never-log/);
});

test("unowned saved quote or pre-connection appointment never reaches Google", async () => {
  for (const options of [{ missingQuote: true }, { appointment: { created_at: "2026-09-01T00:00:00Z" } }]) {
    const f = fixture(options);
    await f.worker.runGoogleCalendarSync();
    assert.equal(f.httpCalls.length, 0);
    assert.equal(f.finishes()[0].p_success, false);
  }
});

test("a worker invocation claims a bounded eight jobs", async () => {
  const f = fixture({ claims: 9, entry: { appointment_deleted: true }, responses: Array.from({ length: 8 }, () => ({ status: 404 })) });
  const result = await f.worker.runGoogleCalendarSync();
  assert.equal(result.processed, 8);
  assert.equal(result.synced, 8);
});
