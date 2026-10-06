const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const { hasMaintenanceMapCoordinates, groupMaintenanceMapPoints } = harness().load("src/lib/alinflow/maintenance-map.ts");
const point = (appointmentId, patch = {}) => ({
  appointmentId,
  customer: { id: "customer-1", name: "Teszt ügyfél", quoteItems: [] },
  customerId: "customer-1",
  customerName: "Teszt ügyfél",
  climateSummary: "Teszt klíma",
  address: "Teszt cím",
  city: "Teszt település",
  installationLabel: "Telepítés",
  maintenanceCount: 0,
  status: "ok",
  latitude: 47,
  longitude: 19,
  ...patch,
});
const appointmentIds = group => Array.from(group.points, item => item.appointmentId);

test("one marker retains multiple installations for the same customer in input order", () => {
  const first = point("installation-1");
  const second = point("installation-2", { customer: first.customer, status: "overdue" });
  const groups = groupMaintenanceMapPoints([first, second]);
  assert.equal(groups.length, 1);
  assert.deepEqual(appointmentIds(groups[0]), ["installation-1", "installation-2"]);
  assert.equal(groups[0].points[0], first);
  assert.equal(groups[0].points[1], second);
  assert.equal(groups[0].status, "overdue");
});

test("shared-coordinate marker takes the most urgent status regardless of point order", () => {
  const priority = ["overdue", "dueSoon", "unknown", "ok", "optOut"];
  for (let left = 0; left < priority.length; left++) {
    for (let right = left; right < priority.length; right++) {
      const points = [point("first", { status: priority[left] }), point("second", { status: priority[right] })];
      assert.equal(groupMaintenanceMapPoints(points)[0].status, priority[left]);
      assert.equal(groupMaintenanceMapPoints([...points].reverse())[0].status, priority[left]);
    }
  }
});

test("distinct exact coordinates remain separate without rounding and preserve first-seen order", () => {
  const points = [
    point("first", { latitude: 47.0000001 }),
    point("second", { latitude: 47.0000002 }),
    point("third", { latitude: 47.0000001, longitude: 19.0000001 }),
    point("fourth", { latitude: 47.0000002 }),
    point("fifth", { latitude: 47.0000001 }),
  ];
  const groups = groupMaintenanceMapPoints(points);
  assert.equal(groups.length, 3);
  assert.deepEqual(Array.from(groups, appointmentIds), [["first", "fifth"], ["second", "fourth"], ["third"]]);
  assert.equal(new Set(groups.map(group => group.id)).size, 3);
  for (const group of groups) {
    const reversedGroup = groupMaintenanceMapPoints([...points].reverse())
      .find(item => item.latitude === group.latitude && item.longitude === group.longitude);
    assert.equal(group.id, reversedGroup.id);
  }
});

test("invalid or missing coordinates never enter a marker group", () => {
  const invalid = [
    { latitude: undefined }, { longitude: undefined },
    { latitude: NaN }, { longitude: NaN },
    { latitude: Infinity }, { latitude: -Infinity },
    { longitude: Infinity }, { longitude: -Infinity },
    { latitude: -90.000001 }, { latitude: 90.000001 },
    { longitude: -180.000001 }, { longitude: 180.000001 },
    { latitude: "47" }, { longitude: "19" },
    { latitude: null }, { longitude: null },
  ].map((patch, index) => point(`invalid-${index}`, patch));
  for (const item of invalid) assert.equal(hasMaintenanceMapCoordinates(item), false, item.appointmentId);
  const valid = point("valid");
  const groups = groupMaintenanceMapPoints([...invalid, valid]);
  assert.equal(groups.length, 1);
  assert.deepEqual(appointmentIds(groups[0]), ["valid"]);
  assert.equal(groupMaintenanceMapPoints(invalid).length, 0);
});

test("zero coordinates and latitude/longitude boundaries are valid", () => {
  const points = [
    point("zero", { latitude: 0, longitude: 0 }),
    point("south-west", { latitude: -90, longitude: -180 }),
    point("north-east", { latitude: 90, longitude: 180 }),
    point("south-east", { latitude: -90, longitude: 180 }),
    point("north-west", { latitude: 90, longitude: -180 }),
  ];
  for (const item of points) assert.equal(hasMaintenanceMapCoordinates(item), true, item.appointmentId);
  const groups = groupMaintenanceMapPoints(points);
  assert.equal(groups.length, points.length);
  assert.deepEqual(Array.from(groups, group => [group.latitude, group.longitude]),
    points.map(item => [item.latitude, item.longitude]));
});

test("grouping never mutates the input array, appointment points or customer objects", () => {
  const points = [point("first", { status: "optOut" }), point("second", { status: "overdue" })];
  const before = structuredClone(points);
  for (const item of points) {
    Object.freeze(item.customer.quoteItems);
    Object.freeze(item.customer);
    Object.freeze(item);
  }
  Object.freeze(points);
  const groups = groupMaintenanceMapPoints(points);
  assert.deepEqual(points, before);
  assert.notEqual(groups[0].points, points);
  assert.equal(groups[0].points[0], points[0]);
  assert.equal(groups[0].points[1], points[1]);
  groups[0].points.pop();
  assert.equal(points.length, 2);
  assert.equal(groupMaintenanceMapPoints(points)[0].points.length, 2);
});

test("an empty collection produces no marker groups", () => {
  assert.equal(groupMaintenanceMapPoints([]).length, 0);
});
