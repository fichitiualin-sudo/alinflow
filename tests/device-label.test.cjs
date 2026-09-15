const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");
const { deviceLabelCandidates } = harness().load("src/lib/alinflow/device-label.ts");
const read = (text, side = "indoor") => JSON.parse(JSON.stringify(deviceLabelCandidates(text, side)));

test("Hungarian indoor and outdoor captions map only to the selected unit", () => {
  const text = "GYÁRTÓ: Midea\nBELTÉRI EGYSÉG TÍPUSA: TEST-35/I\nKÜLTÉRI EGYSÉG TÍPUSA: TEST-35/O";
  assert.deepEqual(read(text), { manufacturers: ["Midea"], models: ["TEST-35/I"] });
  assert.deepEqual(read(text, "outdoor"), { manufacturers: ["Midea"], models: ["TEST-35/O"] });
});

test("model captions preserve exact punctuation, case and zeros without guessing characters", () => {
  assert.deepEqual(read("Model No.: AbC-035/I(AA)\nTYPE: unrelated"), {
    manufacturers: [], models: ["AbC-035/I(AA)"],
  });
  assert.deepEqual(read("Típus: TEST_001.A\nTipusa: TEST-002/B").models, ["TEST_001.A", "TEST-002/B"]);
  assert.deepEqual(read("MODEL NUMBER: TEST-003\nModel #: TEST-004").models, ["TEST-003", "TEST-004"]);
  assert.deepEqual(read("TYPE: TEST-005\nUNIT TYPE: TEST-006\nRefrigerant Type: R32\nCompressor Type: COMP123").models, ["TEST-005", "TEST-006"]);
});

test("sparse captions accept a nearby value but never skip over the next field", () => {
  assert.deepEqual(read("Manufacturer:\n\nPanasonic\nModel:\n\nTEST-35W").models, ["TEST-35W"]);
  assert.deepEqual(read("Model:\n\nS/N: WRONG123456\nManufacturer:\nMODEL: TEST-35W"), {
    manufacturers: [], models: ["TEST-35W"],
  });
  assert.deepEqual(read("Model:\n\n\n\nTOO-FAR35").models, []);
});

test("truncated OCR model fragments are rejected instead of filling an incomplete code", () => {
  for (const fragment of ["TEST-35-", "TEST-35/", "TEST-35.", "TEST-35_", "TEST-35+", "TEST-35(", "TEST-35(AA", "TEST-35AA)", "TEST-35)AA("]) {
    assert.deepEqual(read(`MODEL: ${fragment}`).models, [], fragment);
  }
  assert.deepEqual(read("MODEL: TEST-35- I\nMANUFACTURER: Midea"), { manufacturers: ["Midea"], models: [] });
});

test("complete model suffixes and balanced parentheses remain exact proposals", () => {
  for (const model of ["TEST-35-I", "TEST-35/I", "TEST-35.A", "TEST_35_A", "TEST35+A", "TEST-35(AA)", "TEST-35(AA(B))", "TEST(35)A"]) {
    assert.deepEqual(read(`MODEL: ${model}`).models, [model], model);
  }
});

test("a separate unit heading protects a generic Model caption from the opposite side", () => {
  const text = "OUTDOOR UNIT\nManufacturer: Gree\nModel: TEST-42/O\nINDOOR UNIT\nModel: TEST-42/I";
  assert.deepEqual(read(text), { manufacturers: ["Gree"], models: ["TEST-42/I"] });
  assert.deepEqual(read(text, "outdoor").models, ["TEST-42/O"]);
  assert.deepEqual(read("Beltéri egység\nTEST-42/I\nKültéri egység\nTEST-42/O").models, ["TEST-42/I"]);
});

test("unlabelled product names, serials and technical values never become a model", () => {
  const text = "Raynor Pro 3.5 kW\nS/N: SERIAL123456789\nTEST-35/I\nModel: 220-240V\nModel: 50Hz\nModel: R410A\nModel: IPX4\nModel: 00123456\nModel: 3.5kW\nCompressor model: COMP1234\nRefrigerant Type: R32";
  assert.deepEqual(read(text), { manufacturers: [], models: [] });
});

test("printed manufacturer brands do not need a successfully read caption", () => {
  assert.deepEqual(read("GD Midea Air-Conditioning Equipment Co., Ltd.\nMODEL: TEST-35/I"), {
    manufacturers: ["Midea"], models: ["TEST-35/I"],
  });
  assert.deepEqual(read("MITSUBISHI ELECTRIC\nMODEL: TEST35").manufacturers, ["Mitsubishi Electric"]);
  assert.deepEqual(read("MITSUBISHI HEAVY INDUSTRIES\nMODEL: TEST35").manufacturers, ["Mitsubishi Heavy Industries"]);
});

test("an explicitly labelled unknown manufacturer is kept as printed", () => {
  assert.deepEqual(read("Gyártó: Hűvös Klíma Kft.\nTípus: TEST35"), {
    manufacturers: ["Hűvös Klíma Kft."], models: ["TEST35"],
  });
  assert.deepEqual(read("MANUFACTURED BY: Example Climate GmbH\nMODEL: TEST35").manufacturers, ["Example Climate GmbH"]);
});

test("short brand names require a logo or manufacturer context", () => {
  assert.deepEqual(read("AUX HEATER 1.5 kW\nMODEL: LG-TEST35\nTCLAMP 20 C").manufacturers, []);
  assert.deepEqual(read("LG\nMODEL: TEST35").manufacturers, ["LG"]);
  assert.deepEqual(read("Manufacturer: AUX\nMODEL: TEST35").manufacturers, ["AUX"]);
  assert.deepEqual(read("TCL AIR CONDITIONER\nMODEL: TEST35").manufacturers, ["TCL"]);
});

test("two-character noise after a manufacturer caption does not compete with a printed brand", () => {
  assert.deepEqual(read("Manufacturer:\nxx\nGD Midea Air-Conditioning Equipment Co., Ltd.").manufacturers, ["Midea"]);
  assert.deepEqual(read("Manufacturer: GE").manufacturers, [], "Unknown short names need manual entry");
  assert.deepEqual(read("Manufacturer: LG").manufacturers, ["LG"], "A recognized short brand remains usable");
  assert.deepEqual(read("Manufacturer: XYZ").manufacturers, ["XYZ"], "Longer unknown names stay as printed");
});

test("full width text and accent-free captions remain readable", () => {
  assert.deepEqual(read("Ｍｏｄｅｌ：ＴＥＳＴ－０３５／Ｉ\nGYARTO: Gree"), { manufacturers: ["Gree"], models: ["TEST-035/I"] });
  assert.deepEqual(read("KULTERI EGYSEG TIPUSA (MODEL): TEST35/O", "outdoor").models, ["TEST35/O"]);
  assert.deepEqual(read("BELTERIEGYSEGTIPUSA / MODEL: TEST35/I").models, ["TEST35/I"]);
  assert.deepEqual(read("KULTERIEGYSEGTIPUSA | TEST-I2RETN-O |", "outdoor").models, ["TEST-I2RETN-O"]);
});

test("manufacturer fields cannot consume electrical data or a following field", () => {
  assert.deepEqual(read("Manufacturer: 220-240V\nBrand:\nS/N: ABC12345\nManufacturer: Midea Model: TEST35\nBRANDING text").manufacturers, ["Midea"]);
});

test("multiple explicit models remain separate review proposals and are bounded", () => {
  assert.deepEqual(read("MODEL: TEST01 | MODEL: TEST02\nMODEL: TEST03\nMODEL: TEST04\nMODEL: TEST05\nMODEL: TEST06").models,
    ["TEST01", "TEST02", "TEST03", "TEST04", "TEST05"]);
});
