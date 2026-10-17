const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./helpers.cjs");
const h = harness({}, { react: React, "react/jsx-runtime": require("react/jsx-runtime") });
const { AppointmentTimePicker } = h.load("src/components/alinflow/AppointmentTimePicker.tsx");
const { availableAppointmentStartTimes, availableAppointmentSlots } = h.load("src/lib/alinflow/schedule.ts");
const date = "2026-11-10";
const device = quantity => ({ isManual: true, customName: "Synthetic climate", quantity, customPrice: 100000 });
const booked = extra => ({ id: "customer", activeAppointmentId: "appointment", name: "Synthetic Customer",
  date, time: "08:00", appointmentType: "installation", status: "Időpont foglalva", quoteItems: [device(1)], ...extra });

function render(options = {}) {
  const input = { customers: options.works || [], date, appointmentType: options.type || "installation",
    items: options.items || [device(1)], selectedCustomerId: options.selectedCustomerId,
    selectedAppointmentId: options.selectedAppointmentId };
  const props = { appointmentType: input.appointmentType, items: input.items, time: options.time || "08:00",
    availableTimes: availableAppointmentStartTimes({ ...input, includeTime: options.time }),
    recommendedTimes: availableAppointmentSlots(input), onChange: () => {} };
  const html = renderToStaticMarkup(React.createElement(AppointmentTimePicker, props));
  assert.doesNotMatch(html, /<select\b|<option\b|Szabad kezdési idő/);
  const buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(([, attributes, text]) => ({
    active: /\bclass="slot-active"/.test(attributes), text,
  }));
  return { html, props, buttons, text: html.replace(/<[^>]*>/g, "") };
}

test("blocked current 08:00 is absent from recommendation buttons and shows a clear choose-time prompt", () => {
  const f = render({ works: [booked()], time: "08:00" });
  assert.equal(f.buttons.some(button => button.text.startsWith("08:00")), false);
  assert.equal(f.buttons.some(button => button.active), false);
  assert.match(f.html, /role="status"[^>]*>Válassz a munka teljes időtartamára szabad kezdést/);
  assert.doesNotMatch(f.text, /Kiválasztva:\s*08:00/);
  assert.equal(f.buttons.some(button => button.text === "11:00–14:00"), true);
});

test("available 11:00 has an active recommendation button with the correct duration", () => {
  const f = render({ works: [booked()], time: "11:00" });
  assert.deepEqual(f.buttons.filter(button => button.active).map(button => button.text), ["11:00–14:00"]);
  assert.match(f.html, /Munka időtartama: 3 óra/);
  assert.doesNotMatch(f.html, /role="status"/);
});

test("increasing one climate to two invalidates saved 09:00 when the six-hour visit would cross a noon survey", () => {
  const works = [booked({ time: "12:00", appointmentType: "survey" })];
  const short = render({ works, time: "09:00", items: [device(1)] });
  assert.match(short.text, /Kiválasztva:\s*09:00–12:00/);
  const longer = render({ works, time: "09:00", items: [device(2)] });
  assert.doesNotMatch(longer.text, /Kiválasztva:\s*09:00/);
  assert.equal(longer.buttons.some(button => button.active), false);
  assert.match(longer.html, /Munka időtartama: 6 óra/);
  assert.match(longer.html, /Válassz a munka teljes időtartamára szabad kezdést/);
  for (const time of longer.props.recommendedTimes) {
    assert.ok(longer.props.availableTimes.includes(time), `recommended ${time} must also fit the full duration`);
  }
});

test("a day without recommended free starts shows another-day guidance and no stale buttons", () => {
  for (const allDay of [true, false]) {
    const works = Array.from({ length: allDay ? 24 : 12 }, (_, index) => {
      const hour = allDay ? index : index + 8;
      return booked({ activeAppointmentId: `work-${hour}`, appointmentType: "other", time: `${String(hour).padStart(2, "0")}:00` });
    });
    const f = render({ works, time: "08:00" });
    assert.equal(f.props.availableTimes.length === 0, allDay);
    assert.equal(f.props.recommendedTimes.length, 0);
    assert.match(f.text, /Erre a napra nincs szabad ajánlott idősáv\. Válassz másik napot\./);
    assert.match(f.html, /role="status"/);
    assert.equal(f.buttons.length, 0);
  }
});

test("editing preserves an available saved off-grid time while excluding only that same appointment", () => {
  const work = booked({ time: "09:07" });
  const f = render({ works: [work], time: "09:07", selectedCustomerId: work.id, selectedAppointmentId: work.activeAppointmentId });
  assert.match(f.text, /Kiválasztva:\s*09:07–12:07/);
  assert.equal(f.buttons.some(button => button.text.startsWith("09:07")), false, "saved off-grid time is read-only");
  assert.doesNotMatch(f.html, /role="status"/);
});

test("maintenance remains one hour even when the selected installation has three climates", () => {
  const f = render({ type: "maintenance", items: [device(3)], time: "08:00",
    works: [booked({ time: "09:00", appointmentType: "survey" })] });
  assert.deepEqual(f.buttons.filter(button => button.active).map(button => button.text), ["08:00–09:00"]);
  assert.match(f.html, /Munka időtartama: 1 óra/);
});
