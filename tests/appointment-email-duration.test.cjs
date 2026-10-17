const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const h = harness();
const appointments = h.load("src/lib/alinflow/appointments.ts");
const products = h.load("src/lib/alinflow/products.ts");
const settingsModule = h.load("src/lib/alinflow/workspace-settings.ts");
const workspaceSettings = settingsModule.defaultWorkspaceSettings(null);
const { quotePayload } = h.functions(["quotePayload"], { ...appointments, ...products, workspaceSettings });
const { appointmentEmailHtml } = h.functions([
  "safeText", "fullAddress", "escapeHtml", "footerHtml", "ft", "formatDate", "itemLines", "importantNotesHtml", "appointmentEmailHtml",
], { ...appointments, ...settingsModule }, "src/app/api/send-appointment/route.ts");

for (const [quantity, end] of [[1, "11:00"], [2, "14:00"], [3, "17:00"], [7, "17:00"]]) {
  test("appointment email carries " + quantity + " equipment units through the real payload and excludes extra work from duration", () => {
    const customer = { id: "synthetic-customer", activeAppointmentId: "synthetic-appointment", name: "Synthetic Customer",
      email: "synthetic@example.invalid", date: "2026-10-18", time: "08:00", appointmentType: "installation" };
    const items = [
      { productId: "synthetic-ac", productName: "Saved AC", quantity, customPrice: 100000 },
      { productId: "", customName: "Extra pipe", itemType: "extra", quantity: 10, customPrice: 1000 },
    ];
    const payload = quotePayload(customer, items, "2026-10-17T12:00:00Z");
    assert.equal(payload.items[1].itemType, "extra");
    const html = appointmentEmailHtml(payload.customer, payload.items, workspaceSettings);
    assert.ok(html.includes("08:00–" + end));
    assert.ok(html.includes("Extra pipe"));
  });
}

for (const appointmentType of ["maintenance", "survey", "other"]) {
  test(appointmentType + " confirmation email takes one hour even with several devices", () => {
    const html = appointmentEmailHtml({ name: "Synthetic Customer", date: "2026-10-18", time: "10:30", appointmentType },
      [{ name: "Saved AC", quantity: 7 }], workspaceSettings);
    assert.ok(html.includes("10:30–11:30"));
  });
}
