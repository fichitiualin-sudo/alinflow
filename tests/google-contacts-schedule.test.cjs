const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const { nextGoogleContactsSyncAt } = harness().load("src/lib/alinflow/google-contacts-schedule.ts");

test("daily contact schedule chooses a strictly future 03:00 UTC boundary", () => {
  for (const [now, expected] of [
    ["2026-11-02T02:59:59.999Z", "2026-11-02T03:00:00.000Z"],
    ["2026-11-02T03:00:00.000Z", "2026-11-03T03:00:00.000Z"],
    ["2026-11-02T21:00:00.000Z", "2026-11-03T03:00:00.000Z"],
    ["2026-12-31T22:00:00.000Z", "2027-01-01T03:00:00.000Z"],
    ["2026-03-29T03:01:00.000Z", "2026-03-30T03:00:00.000Z"],
    ["2026-10-25T03:01:00.000Z", "2026-10-26T03:00:00.000Z"],
  ]) assert.equal(nextGoogleContactsSyncAt(Date.parse(now)), expected, now);
});
