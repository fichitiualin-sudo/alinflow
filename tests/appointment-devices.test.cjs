const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, database } = require("./helpers.cjs");
const ids = { workspace: "11111111-1111-4111-8111-111111111111", customer: "22222222-2222-4222-8222-222222222222", appointment: "33333333-3333-4333-8333-333333333333", device: "44444444-4444-4444-8444-444444444444", other: "55555555-5555-4555-8555-555555555555" };
const context = () => ({ workspaceId: ids.workspace, customerId: ids.customer, appointmentId: ids.appointment, appointmentType: "installation", workDate: "2026-09-14", workTime: "08:00" });
const slot = () => ({ productKey: "manual:teszt klíma", productName: "Teszt klíma", unitNumber: 1 });
const row = (patch = {}) => ({ id: ids.device, workspace_id: ids.workspace, customer_id: ids.customer, appointment_id: ids.appointment, product_key: "manual:teszt klíma", product_name: "Teszt klíma", unit_number: 1, data: { indoorSerial: "IN123", outdoorSerial: "OUT456" }, updated_at: "2026-09-14T08:00:00Z", ...patch });
const device = () => ({ id: ids.device, ...context(), ...slot(), data: row().data, updatedAt: row().updated_at });
const plain = (value) => JSON.parse(JSON.stringify(value));
function setup(handler = () => ({ data: row() })) {
  const calls = [];
  const db = database((op) => { calls.push(op); return handler(op); });
  return { calls, api: harness({}, { "@/lib/supabase": { supabase: db } }).load("src/lib/alinflow/appointment-devices.ts") };
}

test("device slots preserve separate physical units across duplicate product lines", () => {
  const { api } = setup();
  const slots = api.deviceSlots([
    { productId: "saved-product", productName: "Mentett típus", quantity: 2 },
    { productId: "saved-product", productName: "Mentett típus", quantity: 1 },
    { isManual: true, customName: "Másik típus", quantity: 1 },
  ]);
  assert.deepEqual(plain(slots.map((item) => item.unitNumber)), [1, 2, 3, 1]);
  assert.equal(new Set(slots.map(api.deviceSlotKey)).size, 4);
  assert.throws(() => api.deviceSlots([{ isManual: true, customName: "Típus", quantity: 1.5 }]), /egész darabszám/);
  assert.throws(() => api.deviceSlots([{ isManual: true, customName: "Típus", quantity: 101 }]), /egész darabszám/);
});
test("list reads only the exact workspace/customer/appointment and maps both serials", async () => {
  const { api, calls } = setup(() => ({ data: [row()] }));
  const result = await api.listAppointmentDevices(context());
  assert.deepEqual(plain(calls[0].filters), { workspace_id: ids.workspace, customer_id: ids.customer, appointment_id: ids.appointment });
  assert.equal(result[0].data.indoorSerial, "IN123"); assert.equal(result[0].data.outdoorSerial, "OUT456");
  assert.equal(result[0].updatedAt, row().updated_at);
});
test("new device saves only whitelisted normalized fields under the captured scope", async () => {
  const { api, calls } = setup();
  const original = context();
  const pending = api.saveAppointmentDevice(original, slot(), { indoorSerial: "  IN123  ", scop: "4.6", malicious: "DROP", outdoorSerial: "x".repeat(250) });
  original.appointmentId = ids.other;
  await pending;
  assert.equal(calls[0].method, "insert");
  assert.equal(calls[0].value.appointment_id, ids.appointment);
  assert.equal(calls[0].value.data.indoorSerial, "IN123");
  assert.equal(calls[0].value.data.outdoorSerial.length, 200);
  assert.equal(calls[0].value.data.malicious, undefined);
  assert.equal(calls[0].value.data.scop, "4.6");
});
test("existing device saves require exact identity and optimistic timestamp", async () => {
  const { api, calls } = setup();
  await api.saveAppointmentDevice(context(), slot(), { indoorSerial: "NEW123" }, device());
  assert.equal(calls[0].method, "update");
  assert.deepEqual(plain(calls[0].filters), { id: ids.device, updated_at: row().updated_at, workspace_id: ids.workspace, customer_id: ids.customer, appointment_id: ids.appointment });
});
test("wrong scopes or physical units cannot reach a device write", async () => {
  const { api, calls } = setup();
  for (const key of ["workspaceId", "customerId", "appointmentId"]) {
    await assert.rejects(api.saveAppointmentDevice({ ...context(), [key]: "" }, slot(), {}), /időpontot/);
    await assert.rejects(api.saveAppointmentDevice(context(), slot(), {}, { ...device(), [key]: ids.other }), /másik munkához/);
  }
  await assert.rejects(api.saveAppointmentDevice(context(), { ...slot(), unitNumber: 2 }, {}, device()), /másik munkához/);
  await assert.rejects(api.saveAppointmentDevice(context(), { ...slot(), productKey: "other" }, {}, device()), /másik munkához/);
  assert.equal(calls.length, 0);
});
test("concurrent insert/update conflicts and network failures are explicit", async () => {
  for (const code of ["23505", "PGRST116"]) {
    const { api } = setup(() => ({ data: null, error: { code } }));
    await assert.rejects(api.saveAppointmentDevice(context(), slot(), {}, device()), /közben máshol/);
  }
  const { api } = setup(() => ({ data: null, error: { code: "NETWORK" } }));
  await assert.rejects(api.saveAppointmentDevice(context(), slot(), {}), /nem sikerült menteni/);
  await assert.rejects(api.listAppointmentDevices(context()), /nem tölthetők be/);
});
