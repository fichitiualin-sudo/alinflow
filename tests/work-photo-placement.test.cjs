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

function workPage(appointmentType = "installation") {
  const runtime = hooks();
  const module = harness({}, {
    react: runtime.react,
    "react/jsx-runtime": jsx,
    "@/components/alinflow/LayoutPrimitives": { Card: "test-card", Layout: "test-layout", Main: "test-main", Side: "test-side", Btn: "test-button", Field: "test-field", Gradient: "test-gradient" },
    "@/components/alinflow/PostalCodeCityFields": { PostalCodeCityFields: "test-postal-code" },
    "@/components/alinflow/WorkPhotosPanel": { WorkPhotosPanel: "test-work-photos" },
    "@/components/alinflow/AppointmentDevicesPanel": { AppointmentDevicesPanel: "test-appointment-devices" },
    "@/components/alinflow/HTariffPanel": { HTariffPanel: "test-h-tariff" },
    "@/components/alinflow/DocumentCards": { DocumentActionButtons: "test-document-actions" },
  });
  const { WorkPagePanel } = module.load("src/components/alinflow/WorkPagePanel.tsx");
  const { defaultWorkspaceSettings } = module.load("src/lib/alinflow/workspace-settings.ts");
  const props = {
    workspaceId: "workspace-a",
    selected: { id: "customer-a", activeAppointmentId: "appointment-a", appointmentType,
      name: "Szintetikus ügyfél", status: "Időpont egyeztetve", date: "2026-09-15", time: "08:00",
      quoteItems: [{ productId: "old-product", quantity: 1 }] },
    quoteItems: [], products: [], materials: [], message: "", workHistory: [],
    documentRows: [], maintenanceRows: [], currentWorkChecklist: {}, checklistDates: {}, actionDates: {},
    workspaceSettings: defaultWorkspaceSettings(),
  };
  const run = {
    props,
    render() { runtime.reset(); run.tree = WorkPagePanel(props); return run.tree; },
    toggle(label) {
      const button = nodes(run.tree, (node) => node.props?.label === label);
      assert.equal(button.length, 1, `One toggle for ${label}`);
      button[0].props.onClick();
      return run.render();
    },
    photos: () => nodes(run.tree, (node) => node.type === "test-work-photos"),
    devices: () => nodes(run.tree, (node) => node.type === "test-appointment-devices"),
  };
  run.render();
  return run;
}

test("installation serial photos have one entry point inside Munkafotók, independent of the climate list", () => {
  const run = workPage();
  assert.equal(run.photos().length, 0);
  assert.equal(run.devices().length, 0, "The initially open climate list must not contain serial photos");
  run.toggle("Munkafotók megjelenítése");
  assert.equal(run.photos().length, 1);
  assert.equal(run.devices().length, 1);
  assert.equal(nodes(run.photos()[0], (node) => node.type === "test-appointment-devices").length, 1);
  const deviceKey = run.devices()[0].key;
  run.toggle("Időponthoz tartozó klímák elrejtése");
  assert.equal(run.devices().length, 1, "Collapsing the climate list must leave the serial-photo section accessible");
  assert.equal(run.devices()[0].key, deviceKey);
  assert.strictEqual(run.devices()[0].props.customer.quoteItems, run.props.quoteItems, "Use the current edited devices, not the old stored quote");
  assert.equal(run.devices()[0].props.workspaceId, "workspace-a");
  assert.equal(run.devices()[0].props.customer.activeAppointmentId, "appointment-a");
  run.toggle("Munkafotók elrejtése");
  assert.equal(run.devices().length, 0);
  run.toggle("Munkafotók megjelenítése");
  assert.equal(run.devices().length, 1);
  assert.equal(run.devices()[0].key, deviceKey);

  run.props.workspaceId = "workspace-b";
  run.props.selected = { ...run.props.selected, id: "customer-b", activeAppointmentId: "appointment-b" };
  run.render();
  assert.notEqual(run.devices()[0].key, deviceKey, "Changing work must reset device editor state");
  assert.equal(run.devices()[0].props.customer.activeAppointmentId, "appointment-b");
  assert.equal(run.photos()[0].props.workspaceId, "workspace-b");
});

test("maintenance and survey retain only their own ordinary work-photo gallery", () => {
  for (const appointmentType of ["maintenance", "survey"]) {
    const run = workPage(appointmentType);
    run.toggle("Munkafotók megjelenítése");
    assert.equal(run.photos().length, 1);
    assert.equal(run.devices().length, 0);
    assert.strictEqual(run.photos()[0].props.customer, run.props.selected);
    assert.equal(run.photos()[0].props.customer.appointmentType, appointmentType);
  }
});

test("the work-photo card renders the supplied device section alongside the ordinary upload controls", () => {
  const runtime = hooks();
  const { WorkPhotosPanel } = harness({}, {
    react: runtime.react,
    "react/jsx-runtime": jsx,
    "@/components/alinflow/LayoutPrimitives": { Card: "test-card" },
    "@/lib/supabase": { supabase: {} },
    "@/lib/alinflow/work-photos": { WORK_PHOTO_PAGE_SIZE: 10, workPhotoContext: () => null },
  }).load("src/components/alinflow/WorkPhotosPanel.tsx");
  const section = jsx.jsx("test-appointment-devices", { children: "Sorozatszámok és adattábla-fotók" });
  const tree = WorkPhotosPanel({ customer: {}, children: section });
  assert.equal(tree.props.title, "Munkafotók");
  assert.equal(nodes(tree, (node) => node === section).length, 1);
  assert.equal(nodes(tree, (node) => node.type === "input" && node.props.type === "file").length, 1);
  assert.equal(nodes(tree, (node) => node.type === "button" && node.props.children === "Képek kiválasztása").length, 1);
});
