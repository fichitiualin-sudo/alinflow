const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const h = harness({ URLSearchParams });
const appointments = h.load("src/lib/alinflow/appointments.ts");
const documents = h.load("src/lib/alinflow/documents.ts");
const { buildGoogleCalendarEvent } = h.load("src/lib/alinflow/google-calendar-event.ts");
const { googleCalendarHref } = h.load("src/lib/alinflow/calendar.ts");
const identity = { workspaceId: "workspace", appointmentId: "other-work", generation: 0 };
const work = { id: "customer", name: "Synthetic customer", appointmentType: "other", date: "2026-11-10", time: "10:30",
  quoteItems: [{ itemType: "extra", customName: "Javítás", quantity: 1, customPrice: 12000 },
    { itemType: "extra", customName: "Leszerelés", quantity: 2, customPrice: 10000 }] };

test("other is a distinct customer work type and never an installation", () => {
  for (const value of ["other", " OTHER ", "egyéb", "egyéb munka"]) {
    assert.equal(appointments.normalizeAppointmentType(value), "other");
    assert.equal(appointments.isInstallationAppointment(value), false);
  }
  assert.equal(appointments.appointmentTypeLabel("other"), "Egyéb munka");
  assert.equal(appointments.normalizeAppointmentType(undefined), "installation");
  assert.equal(appointments.APPOINTMENT_TYPES.filter(value => value.value === "other").length, 1);
});

test("other, survey and maintenance occupy one hour while a single installation takes three", () => {
  assert.equal(appointments.appointmentDurationMinutes("other"), 60);
  assert.equal(appointments.appointmentTimeRangeLabel(work), "10:30–11:30");
  for (const value of ["survey", "maintenance"]) {
    assert.equal(appointments.appointmentDurationMinutes(value), 60);
  }
  for (const value of ["installation", undefined]) {
    assert.equal(appointments.appointmentDurationMinutes(value), 180);
  }
  assert.equal(appointments.intervalsOverlap(appointments.appointmentInterval(work), { start: 11 * 60, end: 12 * 60 }), true);
  assert.equal(appointments.intervalsOverlap(appointments.appointmentInterval(work), { start: 11 * 60 + 30, end: 12 * 60 }), false);
});

test("other work descriptions retain all named service lines and never claim installation", () => {
  assert.equal(appointments.appointmentWorkSummary(work), "1 × Javítás, 2 × Leszerelés");
  assert.equal(appointments.appointmentWorkSummary({ appointmentType: "other", quoteItems: [] }), "Egyeztetett munka");
  assert.doesNotMatch([appointments.appointmentEmailIntro("other"), appointments.appointmentWorkLabel("other"),
    appointments.appointmentDocumentTitle("other"), appointments.appointmentTypeEmailLabel("other")].join(" "), /telepítés|szereléssel|karbantartás/);
});

test("other booking and email logs stay distinct, while reports retain their appointment-scoped document family", () => {
  assert.equal(documents.appointmentBookedDocumentType("other"), "other_appointment_booked");
  assert.equal(documents.appointmentEmailDocumentType("other"), "other_appointment_email");
  assert.equal(documents.reportDocumentType("other"), "work_report");
  assert.equal(documents.appointmentBookedDocumentType("installation"), "appointment_booked");
  assert.equal(documents.appointmentEmailDocumentType("maintenance"), "maintenance_appointment_email");
});

test("manual and automatic Google exports agree for other service work, one hour without sale wording", () => {
  const event = buildGoogleCalendarEvent(work, identity);
  const manual = new URL(googleCalendarHref(work)).searchParams;
  assert.equal(event.summary, "Egyéb munka – Synthetic customer");
  assert.equal(event.summary, manual.get("text"));
  assert.equal(event.description, manual.get("details"));
  assert.equal(event.start.dateTime, "2026-11-10T10:30:00+01:00");
  assert.equal(event.end.dateTime, "2026-11-10T11:30:00+01:00");
  assert.match(event.description, /1 × Javítás, 2 × Leszerelés/);
  assert.doesNotMatch(event.description, /szereléssel együtt|Klíma:|Ft/);
  assert.equal(event.attendees, undefined);
  assert.equal(event.reminders.useDefault, false);
});

test("other appointment email gives service access instructions without installation claims", () => {
  const f = h.functions(["safeText", "escapeHtml", "importantNotesHtml", "itemLines", "ft"], appointments,
    "src/app/api/send-appointment/route.ts");
  assert.match(f.importantNotesHtml("other"), /egyeztetett munkavégzés/);
  assert.doesNotMatch(f.importantNotesHtml("other"), /tervezett helye|szereléssel együtt|karbantartandó/);
  assert.match(f.itemLines([{ name: "Javítás <teszt>", quantity: 1 }], "other"), /Javítás &lt;teszt&gt;/);
  assert.doesNotMatch(f.itemLines([{ name: "Javítás", quantity: 1 }], "other"), /szereléssel együtt/);
});
