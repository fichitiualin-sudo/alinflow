const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const { Calendar } = harness({}, {
  react: { useMemo: run => run() }, "react/jsx-runtime": require("react/jsx-runtime"),
  "@/components/alinflow/AppointmentSmsReminders": { AppointmentSmsRemindersButton: "test-sms-reminders" },
}).load("src/components/alinflow/CalendarPanel.tsx");
const connected = { configured: true, connected: true, status: "connected", pending: 0, canManage: true, managedAppointmentIds: [] };
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}
function calendar(extra = {}) {
  return Calendar({ mode: "week", date: new Date(2026, 9, 16), customers: [], onMode() {}, onStep() {}, onOpen() {}, googleCalendar: connected, ...extra });
}

test("normal automatic calendar status shares the mode toolbar with an accessible description", () => {
  const changed = [];
  const tree = calendar({ onMode: mode => changed.push(mode) });
  const indicator = nodes(tree, node => node.props?.["aria-label"] === "Új időpontok automatikus mentése a Google Naptárba");
  assert.equal(indicator.length, 1);
  assert.equal(indicator[0].props.title, indicator[0].props["aria-label"]);
  assert.equal(nodes(tree, node => node.props?.role === "status").length, 0);
  assert.ok(!text(tree).includes("Új időpontok: automatikus Google Naptár-mentés."));
  const toolbar = nodes(tree, node => Array.isArray(node.props?.children) && node.props.children.includes(indicator[0]));
  assert.equal(toolbar.length, 1);
  const modes = nodes(toolbar[0], node => node.type === "button");
  assert.deepEqual(modes.map(text), ["Heti", "Havi"]);
  modes[1].props.onClick(); assert.deepEqual(changed, ["month"]);
});

test("pending, paused, permission and connection errors remain visible instead of a success indicator", () => {
  for (const [extra, expected] of [
    [{ googleCalendar: { ...connected, pending: 3 } }, /3 frissítés várakozik/],
    [{ googleCalendar: { ...connected, connected: false, status: "paused" } }, /szinkronizálás szünetel/],
    [{ googleCalendar: { ...connected, connected: false, status: "reauth_required" } }, /engedélyezd újra/],
    [{ googleCalendar: { ...connected, lastError: "synthetic provider error" } }, /Részletek a Beállításokban/],
    [{ googleCalendar: null, googleCalendarError: "synthetic network failure" }, /Részletek a Beállításokban/],
  ]) {
    const tree = calendar(extra);
    const notices = nodes(tree, node => node.props?.role === "status");
    assert.equal(notices.length, 1); assert.match(text(notices[0]), expected);
    assert.equal(nodes(tree, node => node.props?.title === "Új időpontok automatikus mentése a Google Naptárba").length, 0);
  }
});

test("date picking and an unconnected calendar do not display automatic sync status", () => {
  for (const extra of [{ selectable: true }, { selectable: true, googleCalendarError: "synthetic failure" }, { googleCalendar: { ...connected, connected: false, status: "not_connected" } }]) {
    const tree = calendar(extra);
    assert.equal(nodes(tree, node => node.props?.role === "status").length, 0);
    assert.ok(!text(tree).includes("Google Naptár"));
  }
});
