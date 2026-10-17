const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const sms = harness().load("src/lib/alinflow/sms-reminders.ts");
const today = "2026-10-17";
const climate = (quantity = 1, extra = {}) => ({ productId: "archived-climate", quantity, ...extra });
const booking = (extra = {}) => ({
  id: "customer-1", activeAppointmentId: "appointment-1", name: "Nagy Anna",
  phone: "06 30 123 4567", date: "2026-10-18", time: "08:00",
  appointmentType: "installation", status: "Időpont foglalva",
  quoteItems: [climate()], ...extra,
});
const draft = (extra = {}, day = today) => sms.buildSmsReminder(booking(extra), "KLIMAlin", day);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("approved accented installation text uses the full saved name and one-hour arrival window", () => {
  assert.equal(draft().text, "Kedves Nagy Anna! Holnap telepítjük a klímáját, várhatóan 8–9 között érkezünk. Kérjük, tegye szabaddá a munkaterületet. Köszönjük, szép napot! KLIMAlin");
  assert.equal(draft({ name: "  Jean-Luc  de la Fontaine ", quoteItems: [climate(3)], time: "13:30" }).text,
    "Kedves Jean-Luc de la Fontaine! Holnap telepítjük a klímáit, várhatóan 13:30–14:30 között érkezünk. Kérjük, tegye szabaddá a munkaterületet. Köszönjük, szép napot! KLIMAlin");
  assert.equal(draft({ quoteItems: [climate(20)] }).arrivalWindow, "8–9");
  assert.equal(draft({ time: "08:00:00" }).time, "08:00");
});

test("maintenance and survey use their exact approved templates and workspace brand", () => {
  assert.equal(draft({ appointmentType: "maintenance" }).text,
    "Kedves Nagy Anna! Holnap elvégezzük a klímája karbantartását, várhatóan 8–9 között érkezünk. Kérjük, tegye hozzáférhetővé a készüléket. Köszönjük, szép napot! KLIMAlin");
  assert.match(draft({ appointmentType: "maintenance", quoteItems: [climate(2)] }).text,
    /klímái karbantartását.*hozzáférhetővé a készülékeket/);
  assert.equal(sms.buildSmsReminder(booking({ appointmentType: "survey" }), "Urbán Klíma", today).text,
    "Kedves Nagy Anna! Holnap felmérjük a klímatelepítés helyszínét, várhatóan 8–9 között érkezünk. Köszönjük, szép napot! Urbán Klíma");
  assert.match(draft({ name: "" }).text, /^Kedves Ügyfelünk!/);
  assert.equal(sms.buildSmsReminder(booking(), " ", today), null);
});

test("concrete Hungarian dates are natural, including month and year boundaries", () => {
  assert.match(draft({ date: "2026-10-19" }).text, /! Október 19-én telepítjük/);
  assert.match(draft({ date: "2026-11-01" }).text, /! November 1-jén telepítjük/);
  assert.match(draft({ date: "2026-11-03" }).text, /! November 3-án telepítjük/);
  assert.match(draft({ date: "2027-01-02" }, "2026-12-31").text, /! 2027\. január 2-án telepítjük/);
  assert.match(draft({ date: "2027-01-01" }, "2026-12-31").text, /! Holnap telepítjük/);
});

test("Budapest calendar days work at UTC midnight edges and both daylight-saving transitions", () => {
  for (const [instant, expected] of [
    ["2026-03-28T23:30:00Z", "2026-03-29"],
    ["2026-03-29T22:30:00Z", "2026-03-30"],
    ["2026-10-24T22:30:00Z", "2026-10-25"],
    ["2026-10-25T23:30:00Z", "2026-10-26"],
    ["2026-12-31T23:30:00Z", "2027-01-01"],
  ]) assert.equal(sms.smsReminderToday(new Date(instant)), expected);
  assert.equal(sms.smsReminderDayOffset("2026-03-30", "2026-03-28"), 2);
  assert.equal(sms.smsReminderDayOffset("2026-10-26", "2026-10-24"), 2);
  assert.equal(sms.smsReminderDayOffset("2028-03-01", "2028-02-28"), 2);
  assert.equal(sms.smsReminderToday(new Date("invalid")), "");
});

test("1/2/3-day filters select exactly one date while direct reminders support any future day", () => {
  for (const day of [1, 2, 3]) {
    for (const offset of [1, 2, 3, 4]) {
      assert.equal(sms.isSmsReminderEligible(booking({ date: `2026-10-${17 + offset}` }), day, today), day === offset);
    }
  }
  assert.equal(sms.isSmsReminderAppointment(booking({ date: "2026-11-20" }), today), true);
  assert.ok(draft({ date: "2026-11-20" }));
  assert.equal(sms.isSmsReminderEligible(booking(), 4, today), false);
});

test("today, past, unsaved, completed, cancelled, other and malformed appointments are ineligible", () => {
  for (const extra of [
    { date: today }, { date: "2026-10-16" }, { activeAppointmentId: undefined },
    { activeAppointmentId: " " }, { id: "" }, { appointmentType: "other" }, { appointmentType: "unknown" },
    { status: "Lezárva" }, { status: "Lemondva" }, { status: "Szerelés kész – admin folyamatban" },
    { status: "completed" }, { stockDeducted: true }, { date: "2026-02-30" },
    { date: "2027-02-29" }, { date: "2026-13-01" }, { date: "2026-10-18T08:00:00Z" },
    { date: "" }, { time: "" }, { time: "25:00" }, { time: "08:60" },
    { time: "8-ish" }, { time: "text 08:00" }, { time: "08:00+11:00" }, { time: "08:00:45" },
  ]) {
    assert.equal(sms.isSmsReminderAppointment(booking(extra), today), false, JSON.stringify(extra));
    assert.equal(draft(extra), null, JSON.stringify(extra));
  }
  assert.equal(sms.isSmsReminderAppointment(booking(), "not-a-date"), false);
  // Freshness describes customer workflow, not whether an appointment is saved.
  assert.equal(sms.isSmsReminderAppointment(booking({ isFresh: true }), today), true);
});

test("climate counts exclude extras and blank rows, retain archived/manual devices and never sum alternatives", () => {
  const extras = { itemType: "extra", customName: "Extra piping", productId: "", quantity: 20 };
  assert.equal(draft({ quoteItems: [climate(1), extras, { productId: "", quantity: 10 }] }).deviceCount, 1);
  assert.equal(draft({ quoteItems: [climate(1), climate(2, { productId: "", customName: "Manual", isManual: true })] }).deviceCount, 3);
  assert.equal(draft({ quoteItems: [climate(""), climate(-3)] }).deviceCount, 2);
  assert.equal(draft({ quotePricingMode: "alternatives", quoteItems: [climate(2), climate(2), climate(1)] }).deviceCount, 2);
  assert.equal(draft({ quoteItems: [extras] }).deviceCount, 0);
  assert.equal(draft({ quoteItems: [climate(2, { productId: " ", customName: "Manual climate" })] }).deviceCount, 2);
});

test("maintenance fallback counts only selected installation summaries, once, and no customer history", () => {
  const installations = [
    { appointmentId: "selected", quoteItems: [climate(2)] },
    { appointmentId: "selected", quoteItems: [climate(2)] },
    { appointmentId: "unselected", quoteItems: [climate(12)] },
  ];
  const base = { appointmentType: "maintenance", quoteItems: [], maintenanceInstallationIds: ["selected"], maintenanceInstallations: installations };
  assert.equal(draft(base).deviceCount, 2);
  assert.equal(draft({ ...base, quoteItems: [climate(1)] }).deviceCount, 1);
  assert.equal(draft({ ...base, maintenanceInstallationIds: [] }).deviceCount, 0);
  assert.equal(draft({ ...base, appointmentType: "installation" }).deviceCount, 0);
  assert.equal(draft({ ...base, maintenanceInstallations: [] }).deviceCount, 0);
});

test("phone normalization supports Hungarian and explicit international single recipients", () => {
  for (const phone of ["06 30 123 4567", "+36 (30) 123-4567", "30 123 4567", "0036301234567"]) {
    assert.equal(sms.normalizeSmsPhone(phone), "+36301234567", phone);
  }
  assert.equal(sms.normalizeSmsPhone("06 1 234 5678"), "+3612345678");
  assert.equal(sms.normalizeSmsPhone("1 234 5678"), "+3612345678");
  assert.equal(sms.normalizeSmsPhone("+44 7700 900123"), "+447700900123");
  assert.equal(sms.normalizeSmsPhone("+1 (202) 555-0100"), "+12025550100");
  for (const phone of ["", "123", "+0 123456789", "+36 30 123456", "06 30 12345678",
    "+36301234567;+36701234567", "+36301234567,+36701234567", "30/1234567",
    "+36301234567 ext 2", "+36301234567 x2", "+36301234567?body=hello",
    "+36301234567\n+36701234567", "+36+301234567", "tel:+36301234567", "+36 (30 1234567",
    "+1234567890123456"]) assert.equal(sms.normalizeSmsPhone(phone), null, phone);
});

test("composer URLs encode the complete accented body and contain exactly one normalized recipient", () => {
  const body = "Kedves Ágnes! A&B? # 50% +\nŐsz";
  for (const [platform, delimiter] of [["ios", "&"], ["android", "?"]]) {
    const href = sms.smsComposerHref("06 30 123 4567", body, platform);
    assert.equal(href, `sms:+36301234567${delimiter}body=${encodeURIComponent(body)}`);
    assert.equal(decodeURIComponent(href.split("body=")[1]), body);
  }
  assert.equal(sms.smsComposerHref("a number", body, "ios"), null);
  assert.equal(sms.smsComposerHref("+36301234567,+36701234567", body, "android"), null);
  assert.equal(sms.smsComposerHref("+36301234567", "", "ios"), null);
  assert.equal(sms.smsComposerHref("+36301234567", body, "desktop"), null);
});

test("SMS counting uses GSM extension septets and real UTF-16 units without stripping accents", () => {
  assert.deepEqual(plain(sms.countSmsSegments("")), { encoding: "GSM-7", units: 0, segments: 0 });
  assert.deepEqual(plain(sms.countSmsSegments("A".repeat(160))), { encoding: "GSM-7", units: 160, segments: 1 });
  assert.deepEqual(plain(sms.countSmsSegments("A".repeat(161))), { encoding: "GSM-7", units: 161, segments: 2 });
  assert.deepEqual(plain(sms.countSmsSegments("^{}\\[]~|€\f")), { encoding: "GSM-7", units: 20, segments: 1 });
  assert.equal(sms.countSmsSegments("é".repeat(160)).segments, 1);
  assert.equal(sms.countSmsSegments("á".repeat(70)).segments, 1);
  assert.equal(sms.countSmsSegments("á".repeat(71)).segments, 2);
  assert.equal(sms.countSmsSegments("ő".repeat(134)).segments, 2);
  assert.equal(sms.countSmsSegments("ő".repeat(135)).segments, 3);
  assert.deepEqual(plain(sms.countSmsSegments("😀".repeat(35))), { encoding: "UCS-2", units: 70, segments: 1 });
  assert.equal(sms.countSmsSegments("😀".repeat(36)).segments, 2);
  assert.equal(sms.countSmsSegments("^".repeat(153)).segments, 3);
  assert.equal(sms.countSmsSegments("😀".repeat(67)).segments, 3);
  assert.equal(draft().encoding.encoding, "UCS-2");
  assert.ok(draft().encoding.segments > 1);
});

test("fingerprint follows business content, stays stable across relative-date changes and ignores unrelated edits", () => {
  const future = booking({ date: "2026-10-20" });
  const first = sms.buildSmsReminder(future, "KLIMAlin", today);
  const tomorrow = sms.buildSmsReminder(future, "KLIMAlin", "2026-10-19");
  assert.notEqual(first.text, tomorrow.text);
  assert.equal(first.fingerprint, tomorrow.fingerprint);
  assert.equal(draft().fingerprint, draft({ notes: "internal", updatedAt: "2026-10-17T12:00:00Z" }).fingerprint);
  assert.equal(draft().fingerprint, draft({ phone: "+36301234567", time: "08:00:00" }).fingerprint);
  for (const extra of [{ activeAppointmentId: "appointment-2" }, { id: "customer-2" }, { date: "2026-10-19" },
    { time: "09:00" }, { phone: "+36701234567" }, { name: "Nagy Béla" },
    { appointmentType: "maintenance" }, { quoteItems: [climate(2)] }]) {
    assert.notEqual(draft().fingerprint, draft(extra).fingerprint, JSON.stringify(extra));
  }
  assert.notEqual(draft().fingerprint, sms.buildSmsReminder(booking(), "Urbán Klíma", today).fingerprint);
  assert.equal(draft({ phone: "invalid" }).phone, null);
});
