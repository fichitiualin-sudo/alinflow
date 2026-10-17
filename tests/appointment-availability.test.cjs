const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const h = harness();
const appointments = h.load("src/lib/alinflow/appointments.ts");
const schedule = h.load("src/lib/alinflow/schedule.ts");
const day = "2026-11-02";
const climate = (quantity = 1, extra = {}) => ({ productId: "synthetic-climate", quantity, ...extra });
const booking = (time, extra = {}) => ({ id: "customer", activeAppointmentId: "appointment", date: day,
  time, status: "Időpont foglalva", appointmentType: "installation", quoteItems: [climate()], ...extra });
const input = (extra = {}) => ({ customers: [], date: day, appointmentType: "installation", items: [climate()], ...extra });
const values = (array) => Array.from(array);

for (const [quantity, hours] of [[1, 3], [2, 6], [3, 9], [4, 9], [20, 9]]) {
  test(`installation of ${quantity} devices reserves ${hours} hours`, () => {
    const items = [climate(quantity)];
    assert.equal(appointments.appointmentDurationMinutes("installation", items), hours * 60);
    assert.equal(appointments.appointmentTimeLabel("installation", "08:00", items), `08:00–${String(8 + hours).padStart(2, "0")}:00`);
    assert.equal(appointments.appointmentDurationLabel("installation", items), `${hours} óra`);
  });
}

test("installation counts all actual climate lines, including archived and manually named devices, but no extras or blank draft rows", () => {
  const legacy = climate(1, { productId: "archived-device" });
  const manual = climate(1, { productId: "", customName: "Manual device", isManual: true });
  const extra = { itemType: "extra", productId: "", customName: "Additional piping", quantity: 12 };
  const blank = { productId: "", quantity: 1 };
  assert.equal(appointments.appointmentDurationMinutes("installation", [legacy, extra, blank]), 180);
  assert.equal(appointments.appointmentDurationMinutes("installation", [legacy, manual, extra, blank]), 360);
  assert.equal(appointments.appointmentDurationMinutes("installation", [legacy, manual, climate(1)]), 540);
  assert.equal(appointments.appointmentDurationMinutes("installation", []), 180);
  assert.equal(appointments.appointmentDurationMinutes("installation", [blank, extra]), 180);
  assert.equal(appointments.appointmentDurationMinutes("installation", [climate("")]), 180);
});

test("maintenance is one hour per appointment regardless of serviced climate count; survey and other keep their documented one-hour duration", () => {
  for (const type of ["maintenance", "survey", "other"]) {
    for (const items of [[], [climate(1)], [climate(8)]]) {
      assert.equal(appointments.appointmentDurationMinutes(type, items), 60);
      assert.equal(appointments.appointmentTimeRangeLabel({ time: "10:30", appointmentType: type, quoteItems: items }), "10:30–11:30");
    }
  }
});

test("hourly short visits can fill gaps and occupied starts are absent from options", () => {
  const customers = [booking("08:00", { quoteItems: [climate(2)] })];
  const slots = schedule.availableAppointmentSlots(input({ customers, appointmentType: "maintenance", items: [climate(4)] }));
  assert.deepEqual(values(slots), ["14:00", "15:00", "16:00", "17:00"]);
  assert.deepEqual(values(appointments.appointmentSlotOptions("maintenance")),
    ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]);
});

test("the whole new duration must fit: a free start cannot cross a later booked visit", () => {
  const customers = [booking("11:00", { appointmentType: "maintenance", quoteItems: [] })];
  assert.equal(schedule.appointmentTimeAvailable(input({ customers, time: "08:00", items: [climate(1)] })), true);
  assert.equal(schedule.appointmentTimeAvailable(input({ customers, time: "08:00", items: [climate(2)] })), false);
  assert.equal(schedule.appointmentTimeAvailable(input({ customers, time: "11:00" })), false);
  assert.deepEqual(values(schedule.availableAppointmentSlots(input({ customers, items: [climate(2)] }))), ["14:00", "17:00"]);
  assert.deepEqual(values(schedule.availableAppointmentSlots(input({ customers, items: [climate(3)] }))), ["14:00"]);
});

test("part-hour bookings block any overlapping full slot while exact boundaries remain available", () => {
  const customers = [booking("10:30", { appointmentType: "maintenance", quoteItems: [] })];
  const short = input({ customers, appointmentType: "maintenance", items: [] });
  assert.equal(schedule.appointmentTimeAvailable({ ...short, time: "09:30" }), true);
  assert.equal(schedule.appointmentTimeAvailable({ ...short, time: "10:00" }), false);
  assert.equal(schedule.appointmentTimeAvailable({ ...short, time: "11:00" }), false);
  assert.equal(schedule.appointmentTimeAvailable({ ...short, time: "11:30" }), true);
});

test("editing excludes only the current appointment and still blocks other work for the same customer", () => {
  const customers = [booking("08:00"), booking("11:00", { activeAppointmentId: "another-appointment", appointmentType: "maintenance" })];
  const editing = input({ customers, selectedCustomerId: "customer", selectedAppointmentId: "appointment", time: "08:00" });
  assert.equal(schedule.appointmentTimeAvailable(editing), true);
  assert.equal(schedule.appointmentTimeAvailable({ ...editing, items: [climate(2)] }), false);
  assert.equal(schedule.appointmentTimeAvailable({ ...editing, selectedAppointmentId: undefined }), false);
  assert.equal(schedule.appointmentTimeAvailable({ ...editing, selectedCustomerId: "different-customer" }), false);
});

test("cancelled visits and another day's work do not block; finished work still occupies its original interval", () => {
  const customers = [booking("08:00", { status: " Lemondva " }), booking("08:00", { date: "2026-11-03" })];
  assert.equal(schedule.appointmentTimeAvailable(input({ customers, time: "08:00" })), true);
  assert.equal(schedule.appointmentTimeAvailable(input({ customers: [booking("08:00", { status: "Lezárva" })], time: "08:00" })), false);
});

test("invalid starts and next-day endings cannot be booked even through custom time input", () => {
  for (const time of ["", "not-a-time", "24:00", "08:99"]) {
    assert.equal(schedule.appointmentTimeAvailable(input({ time })), false);
  }
  assert.equal(schedule.appointmentTimeAvailable(input({ time: "08:00", date: "" })), false);
  assert.equal(schedule.appointmentTimeAvailable(input({ time: "17:00", items: [climate(3)] })), false);
  assert.equal(schedule.appointmentTimeAvailable(input({ time: "15:00", items: [climate(3)] })), true);
  assert.equal(schedule.appointmentTimeAvailable(input({ time: "15:01", items: [climate(3)] })), false);
  assert.deepEqual(values(appointments.appointmentSlotOptions("installation", [climate(3)])), ["08:00", "11:00", "14:00"]);
});
test("the full-day five-minute selector excludes every overlap and preserves a free off-grid current start", () => {
  const customers = [booking("10:30", { appointmentType: "maintenance" })];
  const short = input({ customers, appointmentType: "maintenance", items: [], includeTime: "12:03" });
  const times = values(schedule.availableAppointmentStartTimes(short));
  assert.equal(times[0], "00:00");
  assert.equal(times.at(-1), "23:00");
  assert.equal(times.includes("09:30"), true);
  assert.equal(times.includes("09:35"), false);
  assert.equal(times.includes("11:25"), false);
  assert.equal(times.includes("11:30"), true);
  assert.equal(times.includes("12:03"), true);
  assert.equal(times[times.indexOf("12:03") - 1], "12:00");
  assert.equal(times[times.indexOf("12:03") + 1], "12:05");
  const occupiedOffGrid = values(schedule.availableAppointmentStartTimes({ ...short, includeTime: "10:03" }));
  assert.equal(occupiedOffGrid.includes("10:03"), false);
  assert.equal(schedule.availableAppointmentStartTimes({ ...short, date: "" }).length, 0);
});

test("five-minute starts reserve all nine hours and editing preserves the current appointment only", () => {
  const customers = [booking("08:03", { quoteItems: [climate(3)] })];
  const editing = input({ customers, items: [climate(3)], selectedCustomerId: "customer", selectedAppointmentId: "appointment", includeTime: "08:03" });
  const times = values(schedule.availableAppointmentStartTimes(editing));
  assert.equal(times.includes("08:03"), true);
  assert.equal(times.at(-1), "15:00");
  assert.equal(times.includes("15:05"), false);
  const fresh = values(schedule.availableAppointmentStartTimes({ ...editing, selectedAppointmentId: undefined }));
  assert.equal(fresh.includes("08:03"), false);
  assert.equal(fresh.length, 0);
});