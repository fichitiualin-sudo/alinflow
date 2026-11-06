const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./helpers.cjs");
const h = harness({}, { react: React, "react/jsx-runtime": require("react/jsx-runtime") });
const { MaintenanceDevicePicker } = h.load("src/components/alinflow/MaintenanceDevicePicker.tsx");
const { maintenanceDeviceSlots } = h.load("src/lib/alinflow/maintenance-devices.ts");
const work = { id: "customer", activeAppointmentId: "installation", date: "2025-01-01", city: "Synthetic city", address: "Synthetic street",
  quoteItems: [{ productId: "manual-test", customName: "Synthetic AC", quantity: 4, isManual: true }] };
const devices = maintenanceDeviceSlots(work.quoteItems);
const plain = value => JSON.parse(JSON.stringify(value));
const props = extra => ({ works: [work], installationIds: ["installation"], onChange: () => {}, ...extra });
function elements(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...React.Children.toArray(node.props?.children).flatMap(elements)];
}

test("device picker renders four independent choices and one selected unit", () => {
  const input = props({ selections: { installation: [devices[2]] } });
  const html = renderToStaticMarkup(React.createElement(MaintenanceDevicePicker, input));
  assert.equal((html.match(/type="checkbox"/g) || []).length, 4);
  assert.equal((html.match(/checked=""/g) || []).length, 1);
  assert.match(html, /Kiválasztva: 1 \/ 4 klíma/);
  for (const index of [1, 2, 3, 4]) assert.match(html, new RegExp(`${index}\\. készülék`));
});

test("checking a second unit retains the first selection and unchecking removes only that unit", () => {
  const events = [], chosen = [devices[2]];
  const tree = MaintenanceDevicePicker(props({ selections: { installation: chosen }, onChange: (id, selection) => events.push([id, plain(selection)]) }));
  const inputs = elements(tree).filter(element => element.type === "input");
  inputs[0].props.onChange({ target: { checked: true } });
  inputs[2].props.onChange({ target: { checked: false } });
  assert.deepEqual(events, [["installation", [plain(devices[2]), plain(devices[0])]], ["installation", []]]);
  assert.deepEqual(plain(chosen), [plain(devices[2])]);
});

test("legacy selection defaults to all devices but an excluded installation defaults to none", () => {
  const all = renderToStaticMarkup(React.createElement(MaintenanceDevicePicker, props()));
  const none = renderToStaticMarkup(React.createElement(MaintenanceDevicePicker, props({ installationIds: [] })));
  assert.equal((all.match(/checked=""/g) || []).length, 4);
  assert.equal((none.match(/checked=""/g) || []).length, 0);
  assert.match(none, /Válassz legalább egy karbantartandó klímát/);
});
