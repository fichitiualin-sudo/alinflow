const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");
const h = harness();
const privacy = h.load("src/lib/alinflow/privacy-notice.ts");
const party = { legalName: "Teszt karbantartó EV", address: "1111 Tesztváros, Minta utca 1.", email: "teszt@example.invalid", phone: "", taxNumber: "" };
const config = { ...privacy.defaultPrivacyNoticeConfig(), enabled: true, serviceProvider: party,
  retentionText: "Teszt megőrzési feltételek.", recipientsText: "Teszt szolgáltatók.", internationalTransfersText: "Teszt adattovábbítási feltételek." };

function signing(overrides = {}) {
  const captured = [], errors = [];
  const context = {
    ...privacy, privacy: config, privacyErrors: [], noticeReady: true, appointmentType: "maintenance",
    selected: { name: "Teszt ügyfél", phone: "", email: "" }, workReport: { signerName: "Teszt aláíró" },
    fullCustomerAddress: () => "1111 Tesztváros, Minta utca 2.", consentGranted: false, partnerReady: false,
    onSignatureChange: (...args) => captured.push(args), setSignatureError: value => errors.push(value), setSignatureDraft: () => {},
    ...overrides,
  };
  const { sign } = h.functions(["sign"], context, "src/components/alinflow/WorkReportPanel.tsx");
  return { sign, captured, errors };
}

test("fresh maintenance signing captures the same new image, signer and timestamp in its own notice", () => {
  const run = signing();
  const image = "data:image/png;base64,c3ludGhldGlj";
  run.sign(image);
  assert.equal(run.captured.length, 1);
  const [signature, signedAt, notice] = run.captured[0];
  assert.equal(signature, image);
  assert.equal(notice.version, privacy.MAINTENANCE_PRIVACY_NOTICE_VERSION);
  assert.equal(notice.signatureDataUrl, signature);
  assert.equal(notice.signedAt, signedAt);
  assert.equal(notice.signerName, "Teszt aláíró");
  assert.equal(notice.controllers.length, 1);
  assert.equal(notice.consentGranted, false);
});

test("enabled but incomplete notice cannot be silently omitted when a maintenance is signed", () => {
  const run = signing({ noticeReady: false, privacyErrors: ["Hiányzó vállalkozási adat."] });
  run.sign("data:image/png;base64,c3ludGhldGlj");
  assert.equal(run.captured.length, 0);
  assert.match(run.errors.at(-1), /Hiányzó vállalkozási adat/);
});
