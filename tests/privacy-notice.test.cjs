const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");

const h = harness();
const privacy = h.load("src/lib/alinflow/privacy-notice.ts");
const settings = h.load("src/lib/alinflow/workspace-settings.ts");
const party = (legalName) => ({ legalName, address: "1234 Tesztváros, Példa utca 1.", email: "teszt@example.com", phone: "", taxNumber: "" });
const config = () => ({ enabled: true, serviceProvider: party("Teszt Szerelő EV"), deviceSeller: party("Teszt Készülék Kft."), partner: privacy.normalizePrivacyParty(undefined), retentionText: "Teszt megőrzési szabály.", recipientsText: "Teszt szolgáltató és szerepe.", internationalTransfersText: "Teszt adattovábbítás és garanciák." });
const snapshotInput = (overrides = {}) => ({ config: config(), customer: { name: "Teszt Ügyfél", address: "1234 Tesztváros, Példa utca 2.", phone: "+36000000000", email: "ugyfel@example.com" }, signerName: "Teszt Aláíró", signatureDataUrl: "data:image/png;base64,dGVzdA==", signedAt: "2026-10-11T12:00:00.000Z", consentGranted: false, ...overrides });
const clone = (value) => JSON.parse(JSON.stringify(value));

test("legacy settings keep privacy disabled without inheriting another workspace's identities", () => {
  const current = settings.normalizeWorkspaceSettings({});
  assert.equal(current.documentSettings.privacyNotice.enabled, false);
  assert.equal(current.documentSettings.privacyNotice.serviceProvider.legalName, "");
  const urban = settings.defaultWorkspaceSettings({ id: "test-workspace", name: "Teszt vállalkozás", slug: "test" });
  const normalized = settings.normalizeWorkspaceSettings({}, urban);
  assert.equal(normalized.documentSettings.privacyNotice.enabled, false);
  assert.equal(normalized.documentSettings.privacyNotice.deviceSeller.legalName, "");
});

test("both issuer identities and factual policy fields survive settings row round-trip", () => {
  const saved = settings.normalizeWorkspaceSettings({ documentSettings: { privacyNotice: config() } });
  const row = settings.workspaceSettingsToRow(saved, "workspace-one");
  const restored = settings.workspaceSettingsFromRow(row, settings.defaultWorkspaceSettings());
  assert.equal(restored.documentSettings.privacyNotice.serviceProvider.legalName, "Teszt Szerelő EV");
  assert.equal(restored.documentSettings.privacyNotice.deviceSeller.legalName, "Teszt Készülék Kft.");
  assert.equal(restored.documentSettings.privacyNotice.retentionText, "Teszt megőrzési szabály.");
  assert.equal(restored.documentSettings.privacyNotice.enabled, true);
});

test("activation requires real controller contacts and the three factual policy fields", () => {
  assert.equal(privacy.privacyNoticeConfigValidation(privacy.defaultPrivacyNoticeConfig()).length, 0);
  const missing = { ...privacy.defaultPrivacyNoticeConfig(), enabled: true };
  assert.equal(privacy.privacyNoticeConfigValidation(missing).length, 6);
  assert.equal(privacy.privacyNoticeConfigValidation(missing, { appointmentType: "installation" }).length, 9);
  assert.equal(privacy.privacyNoticeConfigValidation(config()).length, 0);
  assert.throws(() => privacy.buildPrivacyNoticeSnapshot(snapshotInput({ config: { ...config(), enabled: false } })), /nincs bekapcsolva/);
});

test("maintenance uses the current service provider only, even when a seller is configured", () => {
  const input = snapshotInput({ appointmentType: "maintenance", config: { ...config(), partner: party("Teszt Partner EV") }, consentGranted: true });
  const snapshot = privacy.buildPrivacyNoticeSnapshot(input);
  assert.equal(snapshot.version, privacy.MAINTENANCE_PRIVACY_NOTICE_VERSION);
  assert.equal(snapshot.controllers.length, 1);
  assert.equal(snapshot.controllers[0].role, "service_provider");
  assert.equal(snapshot.controllers[0].party.legalName, input.config.serviceProvider.legalName);
  assert.doesNotMatch(JSON.stringify(snapshot), /Teszt Készülék Kft\./);
  assert.match(snapshot.sections[0].text, /adott karbantartási munkalaphoz/);
  assert.match(snapshot.sections[1].text, /elutasítása nem érinti a karbantartást/);
  assert.equal(JSON.stringify(privacy.parsePrivacyNoticeSnapshot(clone(snapshot))), JSON.stringify(snapshot));
  assert.throws(() => privacy.parsePrivacyNoticeSnapshot({ ...clone(snapshot), controllers: [{ role: "device_seller", party: input.config.deviceSeller }] }), /hiányos vagy sérült/);
  const oldSnapshot = privacy.buildPrivacyNoticeSnapshot(snapshotInput());
  assert.throws(() => privacy.parsePrivacyNoticeSnapshot({ ...clone(snapshot), controllers: oldSnapshot.controllers }), /hiányos vagy sérült/);
  assert.equal(JSON.stringify(privacy.parsePrivacyNoticeSnapshot(clone(oldSnapshot))), JSON.stringify(oldSnapshot));
});

test("maintenance-only settings can omit a seller; installation still requires one", () => {
  const maintenanceConfig = { ...config(), deviceSeller: privacy.normalizePrivacyParty(undefined) };
  assert.equal(privacy.privacyNoticeConfigValidation(maintenanceConfig).length, 0);
  assert.equal(privacy.privacyNoticeConfigValidation(maintenanceConfig, { appointmentType: "maintenance" }).length, 0);
  assert.equal(privacy.privacyNoticeConfigValidation(maintenanceConfig, { appointmentType: "installation" }).length, 3);
  assert.equal(privacy.buildPrivacyNoticeSnapshot(snapshotInput({ config: maintenanceConfig, appointmentType: "maintenance" })).controllers.length, 1);
  assert.throws(() => privacy.buildPrivacyNoticeSnapshot(snapshotInput({ config: maintenanceConfig })), /Készülékértékesítő/);
  const partiallyFilled = { ...maintenanceConfig, deviceSeller: { ...maintenanceConfig.deviceSeller, legalName: "Incomplete seller" } };
  assert.ok(privacy.privacyNoticeConfigValidation(partiallyFilled).length > 0);
  assert.equal(privacy.privacyNoticeConfigValidation(partiallyFilled, { appointmentType: "maintenance" }).length, 0);
});

test("notice validity requires the freshly captured report signature, signer and time", () => {
  const input = snapshotInput({ appointmentType: "maintenance" });
  const snapshot = privacy.buildPrivacyNoticeSnapshot(input);
  assert.equal(privacy.privacyNoticeMatchesWorkReportSignature(snapshot, input), true);
  for (const patch of [{ signatureDataUrl: "other-image" }, { signerName: "Más aláíró" }, { signedAt: "2025-10-11T12:00:00Z" }, { signedAt: undefined }]) {
    assert.equal(privacy.privacyNoticeMatchesWorkReportSignature(snapshot, { ...input, ...patch }), false);
  }
  assert.equal(privacy.privacyNoticeMatchesWorkReportSignature(undefined, input), false);
  assert.equal(privacy.privacyNoticeMatchesWorkReportSignature(snapshot, { ...input, signedAt: "2026-10-11T14:00:00+02:00" }), true);
});

test("optional refusal works without a partner, while granted consent requires a complete named partner", () => {
  const refused = privacy.buildPrivacyNoticeSnapshot(snapshotInput());
  assert.equal(refused.consentGranted, false);
  assert.equal(refused.partner, null);
  assert.match(refused.consentText, /nem adok hozzájárulást/);
  assert.throws(() => privacy.buildPrivacyNoticeSnapshot(snapshotInput({ consentGranted: true })), /Karbantartó partner/);
  const named = { ...config(), partner: party("Teszt Partner EV") };
  const accepted = privacy.buildPrivacyNoticeSnapshot(snapshotInput({ config: named, consentGranted: true }));
  assert.equal(accepted.partner.legalName, "Teszt Partner EV");
  assert.match(accepted.consentText, /Teszt Partner EV/);
  assert.match(accepted.consentText, /nevemet, a karbantartás címét, telefonszámomat és email-címemet/);
  assert.match(accepted.consentText, /kizárólag klímakarbantartás/);
});

test("snapshot projects only the four approved customer fields and freezes saved text, parties and signature", () => {
  const input = snapshotInput();
  input.customer.purchasePrice = 123456;
  input.customer.notes = "Belső megjegyzés";
  input.config.serviceProvider.secret = "not-for-documents";
  const snapshot = privacy.buildPrivacyNoticeSnapshot(input);
  input.config.serviceProvider.legalName = "Megváltozott vállalkozás";
  input.config.retentionText = "Megváltozott szabály";
  input.customer.name = "Másik ügyfél";
  assert.equal(snapshot.controllers[1].party.legalName, "Teszt Szerelő EV");
  assert.equal(snapshot.customer.name, "Teszt Ügyfél");
  assert.equal(snapshot.signerName, "Teszt Aláíró");
  assert.equal(snapshot.signedAt, "2026-10-11T12:00:00.000Z");
  assert.equal(snapshot.signatureDataUrl, "data:image/png;base64,dGVzdA==");
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.controllers[0].party) && Object.isFrozen(snapshot.sections));
  assert.doesNotMatch(JSON.stringify(snapshot), /123456|Belső megjegyzés|not-for-documents|Megváltozott/);
  assert.deepEqual(Object.keys(snapshot.customer).sort(), ["address", "email", "name", "phone"]);
});

test("saved snapshot parsing distinguishes absence from malformed data and never fabricates a signature", () => {
  assert.equal(privacy.parsePrivacyNoticeSnapshot(null), undefined);
  assert.equal(privacy.parsePrivacyNoticeSnapshot(undefined), undefined);
  const saved = clone(privacy.buildPrivacyNoticeSnapshot(snapshotInput()));
  for (const corrupt of [
    {}, { ...saved, version: "future-version" }, { ...saved, consentGranted: true },
    { ...saved, signatureDataUrl: "" }, { ...saved, signedAt: "today" }, { ...saved, internalCost: 500 },
    { ...saved, customer: { ...saved.customer, notes: "hidden" } },
    { ...saved, controllers: [saved.controllers[0], saved.controllers[0]] },
    { ...saved, sections: [{ title: "", text: "text" }] },
    { ...saved, sections: [{ title: "title", text: "x".repeat(5001) }] },
  ]) assert.throws(() => privacy.parsePrivacyNoticeSnapshot(corrupt), /hiányos vagy sérült/);
  const reread = privacy.parsePrivacyNoticeSnapshot(saved);
  assert.equal(JSON.stringify(reread), JSON.stringify(saved));
  saved.sections[0].text = "Later edit";
  assert.notEqual(reread.sections[0].text, "Later edit");
});

test("notice separates contractual billing from consent and includes revocation and complaint routes", () => {
  const text = privacy.buildPrivacyNoticeContent(config()).map((section) => section.text).join("\n");
  assert.match(text, /jogi kötelezettség/);
  assert.match(text, /önkéntes hozzájárulás/);
  assert.match(text, /bármikor visszavonható/);
  assert.match(text, /naih.hu/);
  assert.doesNotMatch(text, /közös adatkezelő|marketingcélú hozzájárulás/);
});
