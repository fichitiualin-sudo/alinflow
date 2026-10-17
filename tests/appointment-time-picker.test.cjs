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
  const optionTags = [...html.matchAll(/<option\b([^>]*)>(.*?)<\/option>/g)].map(([, attributes, text]) => ({
    value: attributes.match(/\bvalue="([^"]*)"/)?.[1] || "", selected: /\bselected=/.test(attributes), text,
  }));
  return { html, props, options: optionTags };
}

test("blocked current 08:00 is absent from selectable options and shows a clear choose-time prompt", () => {
  const f = render({ works: [booked()], time: "08:00" });
  assert.equal(f.options.some(option => option.value === "08:00"), false);
  assert.deepEqual(f.options.filter(option => option.selected).map(option => option.value), [""]);
  assert.match(f.html, /role="status"[^>]*>Válassz a munka teljes időtartamára szabad kezdést/);
  assert.doesNotMatch(f.html, /class="slot-active"/);
  assert.equal(f.options.some(option => option.value === "11:00" && option.text === "11:00–14:00"), true);
});

test("available 11:00 is selected and rendered with the correct duration in both controls", () => {
  const f = render({ works: [booked()], time: "11:00" });
  assert.deepEqual(f.options.filter(option => option.selected).map(option => option.value), ["11:00"]);
  assert.match(f.html, /class="slot-active"[^>]*>11:00–14:00<\/button>/);
  assert.match(f.html, /Munka időtartama: 3 óra/);
  assert.doesNotMatch(f.html, /role="status"/);
  const selectId = f.html.match(/<select\b[^>]*\bid="([^"]+)"/)?.[1];
  assert.ok(selectId);
  assert.ok(f.html.includes(`for="${selectId}"`), "visible label is associated with its select");
});

test("increasing one climate to two removes 09:00 when the six-hour visit would cross a noon survey", () => {
  const works = [booked({ time: "12:00", appointmentType: "survey" })];
  const short = render({ works, time: "09:00", items: [device(1)] });
  assert.equal(short.options.find(option => option.value === "09:00")?.selected, true);
  assert.equal(short.options.find(option => option.value === "09:00")?.text, "09:00–12:00");
  const longer = render({ works, time: "09:00", items: [device(2)] });
  assert.equal(longer.options.some(option => option.value === "09:00"), false);
  assert.deepEqual(longer.options.filter(option => option.selected).map(option => option.value), [""]);
  assert.match(longer.html, /Munka időtartama: 6 óra/);
  assert.match(longer.html, /Válassz a munka teljes időtartamára szabad kezdést/);
  for (const time of longer.props.recommendedTimes) {
    assert.ok(longer.props.availableTimes.includes(time), `recommended ${time} must also fit the full duration`);
  }
});

test("a fully occupied day has a disabled select and no stale recommendation buttons", () => {
  const works = Array.from({ length: 24 }, (_, hour) => booked({ activeAppointmentId: `work-${hour}`,
    appointmentType: "other", time: `${String(hour).padStart(2, "0")}:00` }));
  const f = render({ works, time: "08:00" });
  assert.equal(f.props.availableTimes.length, 0);
  assert.equal(f.options.length, 1);
  assert.match(f.html, /<select\b[^>]*\bdisabled=""/);
  assert.match(f.html, /Erre a napra nincs szabad időpont/);
  assert.match(f.html, /role="status"[^>]*>Válassz másik napot/);
  assert.doesNotMatch(f.html, /<button\b/);
});

test("editing preserves an available saved off-grid time while excluding only that same appointment", () => {
  const work = booked({ time: "09:07" });
  const f = render({ works: [work], time: "09:07", selectedCustomerId: work.id, selectedAppointmentId: work.activeAppointmentId });
  assert.equal(f.options.find(option => option.value === "09:07")?.selected, true);
  assert.equal(f.options.find(option => option.value === "09:07")?.text, "09:07–12:07");
});

test("maintenance remains one hour even when the selected installation has three climates", () => {
  const f = render({ type: "maintenance", items: [device(3)], time: "08:00",
    works: [booked({ time: "09:00", appointmentType: "survey" })] });
  assert.equal(f.options.find(option => option.value === "08:00")?.selected, true);
  assert.equal(f.options.find(option => option.value === "08:00")?.text, "08:00–09:00");
  assert.match(f.html, /Munka időtartama: 1 óra/);
});
