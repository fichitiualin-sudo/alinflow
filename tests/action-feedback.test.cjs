const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const { inferActionFeedbackTone } = harness().load("src/lib/alinflow/action-feedback.ts");

test("failed saves and sends cannot look successful", () => {
  for (const message of [
    "Mentési hiba: kapcsolat megszakadt",
    "Email küldési hiba: érvénytelen címzett",
    "Nem sikerült betölteni az ügyfeleket.",
    "Ez az idősáv közben foglalt lett. Adj meg másik időpontot.",
    "Nem zárható teljesen. Hiányzik: munkalap.",
  ]) assert.equal(inferActionFeedbackTone(message), "error", message);
});

test("partial success retains a warning even when later text mentions an error", () => {
  for (const message of [
    "Időpont mentve, de az email küldése nem sikerült.",
    "A PDF-mellékleteket elküldtük, de a küldés állapota nem mentődött.",
    "Az időpont mentve, de az emailküldés nem indult el: hálózati hiba.",
    "Időpont módosítva ✅ Email nem ment ki.",
  ]) assert.equal(inferActionFeedbackTone(message), "warning", message);
});

test("pending actions and successful completion have separate tones", () => {
  assert.equal(inferActionFeedbackTone("Ajánlat email küldése folyamatban..."), "pending");
  assert.equal(inferActionFeedbackTone("Teljes Excel export készítése..."), "pending");
  assert.equal(inferActionFeedbackTone("Ajánlat elküldve emailben ✅"), "success");
  assert.equal(inferActionFeedbackTone("Szerelés kész ✅ Admin még folyamatban."), "success");
});

test("missing prerequisites are warnings, ordinary navigation text is informational", () => {
  assert.equal(inferActionFeedbackTone("Az ajánlat elküldéséhez előbb add meg az ügyfél email címét."), "warning");
  assert.equal(inferActionFeedbackTone("Küldés előtt szükséges az egyszerű ügyfél aláírás."), "warning");
  assert.equal(inferActionFeedbackTone("Karbantartáshoz válassz legalább egy kapcsolódó klímát."), "warning");
  assert.equal(inferActionFeedbackTone("Ügyfél megnyitva."), "info");
});
