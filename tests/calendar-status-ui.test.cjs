const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-10-17T10:00:00Z"])); }
  static now() { return new Date("2026-10-17T10:00:00Z").getTime(); }
}
const { Calendar } = harness({ Date: FixedDate, URLSearchParams }, {
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

const appointment = (appointmentType = "installation", extra = {}) => ({
  id: "customer-shared", activeAppointmentId: `appointment-${appointmentType}`,
  name: `Teszt ${appointmentType}`, date: "2026-10-18", time: "08:00",
  status: "Időpont foglalva", appointmentType, city: "Tesztváros", address: "",
  phone: "+36301234567", email: "", quoteItems: [], ...extra,
});
const cardReminders = (tree) => nodes(tree, (node) => node.type === "test-sms-reminders" && node.props.calendarCard);
const appointmentCards = (tree) => nodes(tree, (node) => String(node.props?.className || "").split(" ").includes("calendar-event-card"));

test("weekly and monthly appointment cards bind each SMS action to its saved appointment and shared customer", () => {
  const jobs = ["installation", "maintenance", "survey"].map((type) => appointment(type));
  for (const mode of ["week", "month"]) {
    const tree = calendar({ mode, customers: jobs, workspaceId: "workspace-calendar", userId: "user-calendar" });
    const reminders = cardReminders(tree);
    assert.equal(reminders.length, 3, mode);
    for (const job of jobs) {
      const reminder = reminders.find((node) => node.props.appointmentId === job.activeAppointmentId);
      assert.ok(reminder, job.appointmentType);
      assert.equal(reminder.props.customerId, job.id);
      assert.equal(reminder.props.workspaceId, "workspace-calendar");
      assert.equal(reminder.props.userId, "user-calendar");
      assert.equal(reminder.props.calendarCard, true);
      const card = appointmentCards(tree).find((node) => nodes(node, (child) => child === reminder).length);
      assert.ok(card, "The SMS action belongs to its appointment card");
      assert.equal(card.key, job.activeAppointmentId, "Multiple appointments for one customer need distinct card keys");
    }
    assert.equal(new Set(appointmentCards(tree).map((node) => node.key)).size, jobs.length);
    const toolbar = nodes(tree, (node) => node.type === "test-sms-reminders" && !node.props.calendarCard);
    assert.equal(toolbar.length, 1, "The existing day-filtered toolbar entry remains available");
    assert.equal(toolbar[0].props.appointmentId, undefined);
  }
});

test("weekly manual-calendar cards place SMS beside + Naptár and managed events retain SMS", () => {
  const job = appointment();
  const manual = calendar({ customers: [job], workspaceId: "workspace-calendar", userId: "user-calendar" });
  const [card] = appointmentCards(manual);
  const [reminder] = cardReminders(card);
  const rows = nodes(card, (node) => node.type === "div" && Array.isArray(node.props?.children)
    && node.props.children.includes(reminder)
    && node.props.children.some((child) => child?.type === "a" && text(child).trim() === "+ Naptár"));
  assert.equal(rows.length, 1, "SMS and + Naptár share the compact action row");
  for (const mode of ["week", "month"]) {
    const managed = calendar({ mode, customers: [job], workspaceId: "workspace-calendar", userId: "user-calendar",
      managedCalendarAppointmentIds: new Set([job.activeAppointmentId]) });
    assert.equal(cardReminders(managed).length, 1, mode);
    assert.equal(nodes(managed, (node) => node.type === "a" && text(node).trim() === "+ Naptár").length, 0);
  }
});

test("calendar-card SMS is absent for date selection, missing identity and ineligible appointments", () => {
  const ineligible = [
    appointment("installation", { activeAppointmentId: undefined }),
    appointment("installation", { activeAppointmentId: "closed", status: "Lezárva" }),
    appointment("installation", { activeAppointmentId: "done", status: "Szerelés kész – admin folyamatban" }),
    appointment("installation", { activeAppointmentId: "deducted", stockDeducted: true }),
    appointment("maintenance", { activeAppointmentId: "cancelled", status: "Lemondva" }),
    appointment("survey", { activeAppointmentId: "today", date: "2026-10-17" }),
    appointment("survey", { activeAppointmentId: "past", date: "2026-10-16" }),
    appointment("other", { activeAppointmentId: "other" }),
    appointment("installation", { activeAppointmentId: "bad-time", time: "not-a-time" }),
  ];
  for (const mode of ["week", "month"]) {
    const tree = calendar({ mode, customers: ineligible, workspaceId: "workspace-calendar", userId: "user-calendar" });
    assert.equal(cardReminders(tree).length, 0, mode);
    for (const context of [{ selectable: true }, { workspaceId: undefined }, { userId: undefined }]) {
      const hidden = calendar({ mode, customers: [appointment()], workspaceId: "workspace-calendar", userId: "user-calendar", ...context });
      assert.equal(cardReminders(hidden).length, 0, JSON.stringify({ mode, ...context }));
    }
  }
});

test("card SMS supports future appointments beyond the toolbar's three-day filters", () => {
  for (const mode of ["week", "month"]) {
    const tree = calendar({ mode, date: new Date(2026, 9, 21), customers: [appointment("installation", { date: "2026-10-21" })],
      workspaceId: "workspace-calendar", userId: "user-calendar" });
    assert.equal(cardReminders(tree).length, 1, mode);
  }
});
