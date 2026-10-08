const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const { buildGoogleCalendarEvent, googleCalendarDetails, googleCalendarEventOwnedBy } = harness().load("src/lib/alinflow/google-calendar-event.ts");
const { googleCalendarHref } = harness({ URLSearchParams }).load("src/lib/alinflow/calendar.ts");
const identity = { workspaceId: "workspace-one", appointmentId: "appointment-one", generation: 0 };
const customer = (extra = {}) => ({ id: "customer-one", name: "Teszt Ügyfél", phone: "06301234567", email: "test@example.invalid",
  city: "Budapest", postalCode: "1111", address: "Teszt utca 1.", source: "Kézi", status: "Időpont foglalva", need: "Hűtés",
  date: "2026-07-01", time: "08:00", appointmentType: "installation", quoteItems: [
    { productId: "synthetic", productName: "Teszt klíma", quantity: 2, customPrice: 150000, purchaseGrossPrice: 99999 },
  ], ...extra });

test("automatic and manual event descriptions agree, with sale price only and no extra Google emails", () => {
  const record = customer();
  const event = buildGoogleCalendarEvent(record, identity);
  const manual = new URL(googleCalendarHref(record)).searchParams;
  assert.equal(event.summary, manual.get("text"));
  assert.equal(event.description, manual.get("details"));
  assert.equal(event.location, manual.get("location"));
  assert.match(event.description, /300\s000 Ft/);
  assert.doesNotMatch(event.description, /99999|99\s999|Ár:/);
  assert.equal(event.attendees, undefined);
  assert.equal(event.reminders.useDefault, false);
});

test("alternative offers preserve separate prices rather than adding them", () => {
  const event = buildGoogleCalendarEvent(customer({ quotePricingMode: "alternatives", quoteItems: [
    { productId: "a", productName: "Klíma A", quantity: 1, customPrice: 150000 },
    { productId: "b", productName: "Klíma B", quantity: 1, customPrice: 200000 },
  ] }), identity);
  assert.match(event.description, /1\. lehetőség:.*150\s000 Ft.*2\. lehetőség:.*200\s000 Ft/);
  assert.doesNotMatch(event.description, /350\s000/);
});

test("survey and maintenance events do not imply new equipment sales", () => {
  for (const appointmentType of ["survey", "maintenance"]) {
    const event = buildGoogleCalendarEvent(customer({ appointmentType }), identity);
    assert.match(event.description, /Munka:/);
    assert.doesNotMatch(event.description, /Ft|szereléssel együtt|Klíma:/);
  }
});

test("Budapest winter and summer offsets are independent of server timezone", () => {
  const summer = buildGoogleCalendarEvent(customer(), identity);
  const winter = buildGoogleCalendarEvent(customer({ date: "2026-12-01", time: "14:30" }), identity);
  assert.equal(summer.start.dateTime, "2026-07-01T08:00:00+02:00");
  assert.equal(summer.end.dateTime, "2026-07-01T11:00:00+02:00");
  assert.equal(winter.start.dateTime, "2026-12-01T14:30:00+01:00");
  assert.equal(winter.end.dateTime, "2026-12-01T17:30:00+01:00");
  assert.equal(winter.start.timeZone, "Europe/Budapest");
});

test("duration remains three elapsed hours across midnight and DST transitions", () => {
  for (const [date, time, end] of [
    ["2026-12-31", "23:30", "2027-01-01T02:30:00+01:00"],
    ["2026-03-29", "01:30", "2026-03-29T05:30:00+02:00"],
    ["2026-10-25", "01:30", "2026-10-25T03:30:00+01:00"],
  ]) {
    const event = buildGoogleCalendarEvent(customer({ date, time }), identity);
    assert.equal(event.end.dateTime, end);
    assert.equal(Date.parse(event.end.dateTime) - Date.parse(event.start.dateTime), 3 * 3600000);
    assert.ok(event.description.includes(`Idősáv: ${time}–${end.slice(11, 16)}`));
  }
});

test("ambiguous autumn times select first occurrence; invalid dates and missing spring times fail safely", () => {
  assert.equal(buildGoogleCalendarEvent(customer({ date: "2026-10-25", time: "02:30" }), identity).start.dateTime, "2026-10-25T02:30:00+02:00");
  for (const extra of [{ date: "2026-03-29", time: "02:30" }, { date: "2026-02-30" }, { date: "" }, { time: "" }, { time: "nonsense" }]) {
    assert.throws(() => buildGoogleCalendarEvent(customer(extra), identity));
  }
});

test("private identity matches workspace, appointment, and event generation", () => {
  const event = buildGoogleCalendarEvent(customer(), identity);
  assert.equal(googleCalendarEventOwnedBy(event, identity), true);
  for (const extra of [{ workspaceId: "other" }, { appointmentId: "other" }, { generation: 1 }]) {
    assert.equal(googleCalendarEventOwnedBy(event, { ...identity, ...extra }), false);
  }
  assert.equal(googleCalendarEventOwnedBy({}, identity), false);
  assert.equal(googleCalendarDetails(customer()).summary, "Szerelés – Teszt Ügyfél");
});
