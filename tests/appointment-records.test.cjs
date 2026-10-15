const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");
const { compatibleAppointmentRows, appointmentIdAliases } = harness().load("src/lib/alinflow/appointment-records.ts");
const plain = value => JSON.parse(JSON.stringify(value));

function installation(extra = {}) {
  return { id: "installation", customer_id: "customer", workspace_id: "workspace",
    legacy_source_key: "legacy-klima-xlsx:installation:synthetic", appointment_type: "installation",
    scheduled_date: "2025-10-14", scheduled_time: "08:00", quote_id: "quote",
    created_at: "2025-10-14T00:00:00Z", updated_at: "2026-10-15T10:00:00Z", ...extra };
}
function mirror(extra = {}) {
  return { id: "job", customer_id: "customer", workspace_id: "workspace",
    legacy_source_key: "appointments:installation", appointment_type: "installation",
    scheduled_date: "2025-10-14", scheduled_time: "08:00", quote_id: "quote",
    updated_at: "2026-10-15T10:00:00Z", ...extra };
}

test("imported appointment and reverse-linked mirror appear once with the real appointment ID", () => {
  const appointment = installation();
  const rows = compatibleAppointmentRows([appointment], [mirror()]);
  assert.deepEqual(plain(rows), [appointment]);
  assert.deepEqual([...appointmentIdAliases([appointment], [mirror()])], [["job", "installation"]]);
});

test("a newer mirror never replaces canonical version, geocoding, origin or identity metadata", () => {
  const appointment = installation({ latitude: 47, longitude: 19, geocode_status: "manual",
    geocoded_at: "2026-10-15T10:00:00Z", geocode_error: null, maintenance_origin: "external",
    maintenance_source_name: "Partner", maintenance_opt_out: true, maintenance_opt_out_at: "2026-10-01",
    cancelled_at: "2026-10-02", created_by: "creator" });
  const job = mirror({ updated_at: "2026-10-15T11:00:00Z", scheduled_time: "09:00", notes: "Legacy edit",
    latitude: 50, longitude: 21, geocode_status: "failed", geocoded_at: null, geocode_error: "old error",
    maintenance_origin: "own", maintenance_source_name: null, maintenance_opt_out: false,
    maintenance_opt_out_at: null, created_at: "2026-10-15", cancelled_at: null, created_by: "other" });
  const [row] = compatibleAppointmentRows([appointment], [job]);
  assert.deepEqual(plain(row), { ...appointment, scheduled_time: "09:00", notes: "Legacy edit" });
});

for (const field of ["customer_id", "workspace_id"]) {
  for (const reverse of [true, false]) {
    test(`${field} mismatch never pairs records through ${reverse ? "reverse" : "forward"} link`, () => {
      const appointment = installation(reverse ? {} : { legacy_source_key: "jobs:job" });
      const job = mirror({ [field]: "different", ...(reverse ? {} : { legacy_source_key: null }),
        scheduled_date: "2099-01-01", updated_at: "2099-01-01" });
      assert.equal(appointmentIdAliases([appointment], [job]).size, 0);
      assert.deepEqual(plain(compatibleAppointmentRows([appointment], [job])), [appointment, job]);
    });
  }
}

test("genuine separate installations with identical date and climate quote remain separate", () => {
  const first = installation();
  const second = installation({ id: "second-installation", legacy_source_key: "legacy-klima-xlsx:installation:other" });
  const secondMirror = mirror({ id: "second-job", legacy_source_key: "appointments:second-installation" });
  assert.deepEqual(plain(compatibleAppointmentRows([first, second], [mirror(), secondMirror])), [first, second]);
  assert.deepEqual([...appointmentIdAliases([first, second], [mirror(), secondMirror])],
    [["job", "installation"], ["second-job", "second-installation"]]);
});

test("forward legacy links and genuine unmatched legacy jobs keep their compatibility behavior", () => {
  const appointment = installation({ legacy_source_key: "jobs:job" });
  const job = mirror({ legacy_source_key: null, scheduled_time: "09:00", updated_at: "2026-10-15T11:00:00Z" });
  const unmatched = mirror({ id: "old-job", legacy_source_key: null });
  assert.deepEqual(plain(compatibleAppointmentRows([appointment], [job, unmatched])),
    [{ ...appointment, scheduled_time: "09:00" }, unmatched]);
  assert.deepEqual([...appointmentIdAliases([appointment], [job, unmatched])], [["job", "installation"]]);
});

test("a deleted forward-linked job remains hidden unless jobs could not be read", () => {
  const appointment = installation({ legacy_source_key: "jobs:deleted-job" });
  assert.deepEqual(plain(compatibleAppointmentRows([appointment], [])), []);
  assert.deepEqual(plain(compatibleAppointmentRows([appointment], [], { jobsReadSucceeded: false })), [appointment]);
  assert.equal(appointmentIdAliases([appointment], []).size, 0);
});

test("merged legacy appointments and their mirror jobs do not reappear or produce selectable aliases", () => {
  for (const extra of [{ legacy_source_key: "legacy-klima-xlsx:merged:synthetic" },
    { notes: "legacy_merged_into:retained-appointment" },
    { legacy_source_key: "jobs:job", notes: "legacy_merged_into:retained-appointment" }]) {
    const appointment = installation(extra);
    assert.deepEqual(plain(compatibleAppointmentRows([appointment], [mirror()])), []);
    assert.equal(appointmentIdAliases([appointment], [mirror()]).size, 0);
  }
});

test("scope fields absent in genuine older records do not prevent exact legacy pairing", () => {
  const appointment = installation({ workspace_id: undefined, customer_id: undefined });
  assert.deepEqual(plain(compatibleAppointmentRows([appointment], [mirror()])), plain([appointment]));
  assert.equal(appointmentIdAliases([appointment], [mirror()]).get("job"), "installation");
});

test("conflicting forward and reverse identifiers are not guessed or aliased", () => {
  const appointment = installation({ legacy_source_key: "jobs:other-job" });
  const otherJob = mirror({ id: "other-job", legacy_source_key: "appointments:elsewhere" });
  assert.equal(appointmentIdAliases([appointment], [mirror(), otherJob]).size, 0);
  assert.deepEqual(plain(compatibleAppointmentRows([appointment], [mirror(), otherJob])), [appointment, mirror(), otherJob]);
});

test("ambiguous forward links and real appointment ID collisions never rewrite an identity", () => {
  const first = installation({ legacy_source_key: "jobs:job" });
  const second = installation({ id: "second", legacy_source_key: "jobs:job" });
  assert.equal(appointmentIdAliases([first, second], [mirror({ legacy_source_key: null })]).size, 0);
  assert.equal(appointmentIdAliases([installation(), installation({ id: "job" })], [mirror()]).size, 0);
});

test("two exactly linked mirrors still produce only one canonical appointment", () => {
  const appointment = installation();
  const newer = mirror({ id: "job-2", updated_at: "2026-10-15T11:00:00Z", scheduled_time: "10:00" });
  assert.deepEqual(plain(compatibleAppointmentRows([appointment], [mirror(), newer])), [{ ...appointment, scheduled_time: "10:00" }]);
  assert.deepEqual([...appointmentIdAliases([appointment], [mirror(), newer])],
    [["job", "installation"], ["job-2", "installation"]]);
});
