const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const h = harness({ URLSearchParams });
const { googleCalendarHref } = h.load("src/lib/alinflow/calendar.ts");
const {
  defaultWorkspaceSettings,
  normalizeWorkspaceSettings,
  workspaceSettingsFromRow,
  workspaceSettingsToRow,
} = h.load("src/lib/alinflow/workspace-settings.ts");
const workspace = (id) => ({ id, slug: id, name: `Workspace ${id}` });
const customer = (appointmentType = "installation") => ({
  id: "calendar-target-customer", name: "Teszt Ügyfél", phone: "06301234567",
  email: "customer@example.invalid", city: "Budapest", postalCode: "1111",
  address: "Teszt utca 1.", source: "Kézi", status: "Időpont foglalva", need: "Hűtés",
  date: "2026-10-15", time: "09:30", appointmentType,
  quoteItems: [{ productId: "test", productName: "Teszt klíma", quantity: 1, customPrice: 150000 }],
});

test("legacy and generic settings leave manual calendar blank without using company email", () => {
  for (const identity of [null, workspace("second-workspace")]) {
    const fallback = defaultWorkspaceSettings(identity);
    assert.equal(fallback.companyProfile.manualCalendarEmail, "");
    const loaded = workspaceSettingsFromRow({
      company_profile: { email: "company@example.invalid" },
    }, fallback);
    assert.equal(loaded.companyProfile.email, "company@example.invalid");
    assert.equal(loaded.companyProfile.manualCalendarEmail, "");
    assert.equal(new URL(googleCalendarHref(customer(), loaded.companyProfile.manualCalendarEmail)).searchParams.has("src"), false);
  }
});

test("manual target is normalized and survives the existing company_profile JSON round trip", () => {
  const settings = defaultWorkspaceSettings(workspace("first-workspace"));
  settings.companyProfile.manualCalendarEmail = "  Calendar.Owner@Example.Invalid  ";
  settings.companyProfile.email = "company@example.invalid";
  settings.billingSettings.invoiceMode = "single";
  const row = workspaceSettingsToRow(settings, "first-workspace", "test-user");
  assert.equal(row.workspace_id, "first-workspace");
  assert.equal(row.company_profile.manualCalendarEmail, "calendar.owner@example.invalid");
  assert.equal(row.company_profile.email, "company@example.invalid");
  const loaded = workspaceSettingsFromRow(JSON.parse(JSON.stringify(row)), defaultWorkspaceSettings(workspace("first-workspace")));
  assert.equal(loaded.companyProfile.manualCalendarEmail, "calendar.owner@example.invalid");
  assert.equal(loaded.billingSettings.invoiceMode, "single");
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.companyProfile)), JSON.parse(JSON.stringify(row.company_profile)));
});

test("clearing or invalidating a saved manual target does not restore the previous value", () => {
  const saved = defaultWorkspaceSettings(workspace("first-workspace"));
  saved.companyProfile.manualCalendarEmail = "previous@example.invalid";
  for (const input of ["", "   ", "not-an-email", "owner@example.invalid&add=guest@example.invalid"]) {
    const edited = JSON.parse(JSON.stringify(saved));
    edited.companyProfile.manualCalendarEmail = input;
    assert.equal(normalizeWorkspaceSettings(edited, saved).companyProfile.manualCalendarEmail, "");
    const row = workspaceSettingsToRow(edited, "first-workspace");
    assert.equal(row.company_profile.manualCalendarEmail, "");
    assert.equal(workspaceSettingsFromRow(row, saved).companyProfile.manualCalendarEmail, "");
  }
});

test("separate workspace settings select independent accounts and do not mutate each other", () => {
  const first = defaultWorkspaceSettings(workspace("first-workspace"));
  const second = defaultWorkspaceSettings(workspace("second-workspace"));
  first.companyProfile.manualCalendarEmail = "first@example.invalid";
  second.companyProfile.manualCalendarEmail = "second@example.invalid";
  const firstRow = workspaceSettingsToRow(first, "first-workspace");
  const secondRow = workspaceSettingsToRow(second, "second-workspace");
  for (const [row, email] of [[firstRow, "first@example.invalid"], [secondRow, "second@example.invalid"]]) {
    const loaded = workspaceSettingsFromRow(row, defaultWorkspaceSettings(workspace(row.workspace_id)));
    const link = new URL(googleCalendarHref(customer(), loaded.companyProfile.manualCalendarEmail));
    assert.equal(link.searchParams.get("authuser"), email);
    assert.equal(link.searchParams.get("src"), email);
  }
  assert.equal(first.companyProfile.manualCalendarEmail, "first@example.invalid");
  assert.equal(defaultWorkspaceSettings(workspace("third-workspace")).companyProfile.manualCalendarEmail, "");
});

test("targeted manual links preserve all original event data and never invite the target", () => {
  for (const appointmentType of ["installation", "survey", "maintenance"]) {
    const record = customer(appointmentType);
    const original = new URL(googleCalendarHref(record));
    const targeted = new URL(googleCalendarHref(record, "  Calendar.Owner@Example.Invalid  "));
    assert.equal(targeted.origin, original.origin);
    assert.equal(targeted.pathname, original.pathname);
    assert.equal(targeted.searchParams.get("action"), "TEMPLATE");
    assert.equal(targeted.searchParams.get("authuser"), "calendar.owner@example.invalid");
    assert.equal(targeted.searchParams.get("src"), "calendar.owner@example.invalid");
    assert.equal(targeted.searchParams.has("add"), false);
    assert.equal(targeted.searchParams.has("attendees"), false);
    targeted.searchParams.delete("authuser");
    targeted.searchParams.delete("src");
    assert.deepEqual([...targeted.searchParams], [...original.searchParams]);
  }
});

test("missing, blank, and malformed targets retain the original manual calendar link", () => {
  const record = customer();
  const original = googleCalendarHref(record);
  for (const target of [undefined, "", "   ", "not-an-email", "owner@example.invalid&add=guest@example.invalid", "one@example.invalid two@example.invalid"]) {
    const link = googleCalendarHref(record, target);
    assert.equal(link, original);
    const params = new URL(link).searchParams;
    assert.equal(params.has("authuser"), false);
    assert.equal(params.has("src"), false);
    assert.equal(params.has("add"), false);
    assert.equal(params.has("attendees"), false);
  }
});
