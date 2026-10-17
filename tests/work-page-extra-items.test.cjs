const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, noop } = require("./helpers.cjs");
const jsx = require("react/jsx-runtime");

function hooks() {
  const slots = [];
  let cursor = 0;
  return {
    reset: () => { cursor = 0; },
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useEffect: noop,
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useRef: (value) => ({ current: value }),
      useId: () => "synthetic-photo-dialog",
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    },
  };
}

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

function workPage(overrides = {}) {
  const runtime = hooks();
  const h = harness({}, {
    react: runtime.react, "react/jsx-runtime": jsx,
    "@/components/alinflow/LayoutPrimitives": { Back: "test-back", Card: "test-card", Layout: "test-layout", Main: "test-main", Side: "test-side", Btn: "test-button", Field: "test-field", Gradient: "test-gradient" },
    "@/components/alinflow/PostalCodeCityFields": { PostalCodeCityFields: "test-postal-code" },
    "@/components/alinflow/AppointmentSmsReminders": { AppointmentSmsRemindersButton: "test-sms-reminders" },
    "@/components/alinflow/WorkPhotosPanel": { WorkPhotosPanel: "test-work-photos" },
    "@/components/alinflow/AppointmentDevicesPanel": { AppointmentDevicesPanel: "test-appointment-devices" },
    "@/components/alinflow/WorkSectionToggleButton": { WorkSectionToggleButton: "test-section-toggle" },
    "@/components/alinflow/WorkSectionIcon": { WorkSectionIcon: "test-section-icon" },
    "@/components/alinflow/DocumentCards": { DocumentActionButtons: "test-document-actions" },
  });
  const { WorkPagePanel } = h.load("src/components/alinflow/WorkPagePanel.tsx");
  const { defaultWorkspaceSettings } = h.load("src/lib/alinflow/workspace-settings.ts");
  const changes = [];
  let addClimateCount = 0, addExtraCount = 0, unlockCount = 0;
  const props = {
    workspaceId: "workspace-synthetic", selected: { id: "customer-synthetic", activeAppointmentId: "appointment-synthetic",
      appointmentType: "installation", name: "Tesztügyfél", status: "Időpont egyeztetve", date: "2026-10-16", time: "08:00" },
    quoteItems: [
      { productId: "", isManual: true, customName: "Régi kézi klíma", quantity: 1, customPrice: 150000, customInstallPrice: 50000 },
      { productId: "", isManual: true, itemType: "extra", customName: "Kiegészítő tétel", quantity: 2, customPrice: 10000, customInstallPrice: 2000 },
    ],
    products: [], materials: [], message: "", workHistory: [], documentRows: [], maintenanceRows: [],
    currentWorkChecklist: {}, checklistDates: {}, actionDates: {}, workspaceSettings: defaultWorkspaceSettings(),
    canEditWorkResources: true, workResourceEditLocked: false, allowWorkResourceEdit: false,
    onUpdateQuoteItem: (...args) => changes.push(args),
    onAddQuoteItem: () => { addClimateCount++; }, onAddExtraQuoteItem: () => { addExtraCount++; },
    onSetAllowWorkResourceEdit: value => { assert.equal(value, true); unlockCount++; },
    ...overrides,
  };
  const run = {
    props, changes,
    render() { runtime.reset(); run.tree = WorkPagePanel(props); return run.tree; },
    open() { nodes(run.tree, node => node.type === "test-section-toggle" && node.props.label === "Időponthoz tartozó klímák")[0].props.onClick(); return run.render(); },
    button(text) { const matches = nodes(run.tree, node => node.type === "button" && node.props.children === text); assert.equal(matches.length, 1); return matches[0]; },
    counts: () => ({ climate: addClimateCount, extra: addExtraCount, unlock: unlockCount }),
  };
  run.render(); return run;
}

function textOf(tree) {
  if (Array.isArray(tree)) return tree.map(textOf).join(" ");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? textOf(tree.props?.children) : String(tree);
}

function rowFields(run, name) {
  const row = nodes(run.tree, node => node.type === "div" && String(node.props.className).includes("xl:grid-cols-") && nodes(node, child => child.type === "input" && child.props.value === name).length)[0];
  assert.ok(row, "An editable row exists for " + name);
  return nodes(row, node => node.type === "input");
}

test("work page offers a distinct extra-item action without reclassifying legacy manual climates", () => {
  const run = workPage();
  assert.equal(nodes(run.tree, node => node.type === "button" && node.props.children === "+ Egyéb tétel").length, 0);
  run.open();
  const extra = run.button("+ Egyéb tétel");
  assert.equal(extra.props.type, "button"); assert.equal(extra.props.disabled, false);
  extra.props.onClick(); assert.deepEqual(run.counts(), { climate: 0, extra: 1, unlock: 0 });
  run.button("+ Klíma hozzáadása").props.onClick(); assert.equal(run.counts().climate, 1);
  assert.equal(rowFields(run, "Régi kézi klíma")[0].props.placeholder, "Klíma megnevezése");
  assert.equal(rowFields(run, "Kiegészítő tétel")[0].props.placeholder, "Tétel megnevezése");
  assert.match(textOf(run.tree), /Egyedi klíma/); assert.match(textOf(run.tree), /Tétel ára/);
});

test("locked work resources disable adding and editing extras until the existing unlock action is used", () => {
  const run = workPage({ canEditWorkResources: false, workResourceEditLocked: true }); run.open();
  assert.equal(run.button("+ Egyéb tétel").props.disabled, true);
  assert.ok(rowFields(run, "Kiegészítő tétel").every(input => input.props.disabled));
  run.button("Módosítás engedélyezése").props.onClick(); assert.equal(run.counts().unlock, 1);
  run.props.allowWorkResourceEdit = true; run.props.canEditWorkResources = true; run.render();
  assert.equal(run.button("+ Egyéb tétel").props.disabled, false);
  assert.ok(rowFields(run, "Kiegészítő tétel").every(input => input.props.disabled === false));
  run.props.saving = true; run.render();
  assert.equal(nodes(run.tree, node => node.type === "fieldset")[0].props.disabled, true, "Saving blocks every nested mutation, including the extra button");
});

test("extra line amount editing preserves the explicit quantity and device/labor price split", () => {
  const run = workPage(); run.open();
  const fields = rowFields(run, "Kiegészítő tétel");
  assert.equal(fields[1].props.value, 2); assert.equal(fields[2].props.value, "16000"); assert.equal(fields[3].props.value, "4000");
  fields[0].props.onChange({ target: { value: "Új megnevezés" } });
  fields[2].props.onChange({ target: { value: "20000" } });
  fields[3].props.onChange({ target: { value: "6000" } });
  assert.deepEqual(run.changes, [[1, "customName", "Új megnevezés"], [1, "customPrice", 12000], [1, "customInstallPrice", 3000], [1, "customPrice", 11000]]);
});

test("maintenance and survey pages do not offer installation extra-item mutations", () => {
  for (const appointmentType of ["maintenance", "survey"]) {
    const run = workPage({ selected: { id: "customer-synthetic", activeAppointmentId: "appointment-synthetic", appointmentType, name: "Tesztügyfél", status: "Időpont egyeztetve" } });
    const toggles = nodes(run.tree, node => node.type === "test-section-toggle" && /klímák/.test(node.props.label || ""));
    for (const toggle of toggles) toggle.props.onClick(); run.render();
    assert.equal(nodes(run.tree, node => node.type === "button" && node.props.children === "+ Egyéb tétel").length, 0);
  }
});
