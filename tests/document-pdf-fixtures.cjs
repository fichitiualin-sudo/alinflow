const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const zlib = require("node:zlib");
const ts = require("typescript");

function loadTypeScript(relative, overrides = {}, cache = new Map()) {
  const filename = path.resolve(__dirname, "..", relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = { exports: {} };
  cache.set(filename, loaded);
  const nativeRequire = createRequire(filename);
  const localRequire = (specifier) => {
    if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
    const candidate = specifier.startsWith("@/") ? path.resolve(__dirname, "../src", `${specifier.slice(2)}.ts`)
      : specifier.startsWith(".") ? path.resolve(path.dirname(filename), `${specifier}.ts`) : null;
    if (candidate && fs.existsSync(candidate)) return loadTypeScript(candidate, overrides, cache);
    return nativeRequire(specifier);
  };
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  });
  new Function("require", "module", "exports", outputText)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

// Artificial coloured zigzag, never a real person's signature. Different colours expose signature reuse.
function signature(colour = [20, 40, 170]) {
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  }
  const width = 220, height = 60, pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const isLine = x > 10 && x < width - 10 && Math.abs(y - (30 + 15 * Math.sin(x / 12))) < 2;
    const offset = y * (1 + width * 3) + 1 + x * 3;
    (isLine ? colour : [255, 255, 255]).forEach((value, index) => { pixels[offset + index] = value; });
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]).toString("base64")}`;
}

const ids = { workspace: "11111111-1111-4111-8111-111111111111", customer: "22222222-2222-4222-8222-222222222222",
  appointment: "33333333-3333-4333-8333-333333333333", report: "44444444-4444-4444-8444-444444444444",
  declaration: "55555555-5555-4555-8555-555555555555", other: "66666666-6666-4666-8666-666666666666" };
const report = (overrides = {}) => ({ id: ids.report, workspace_id: ids.workspace, customer_id: ids.customer,
  appointment_id: ids.appointment, appointment_type: "installation", work_date: "2026-09-14", work_time: "08:00",
  customer_name: "TESZT Őri Tűnde", customer_address: "1111 Tesztváros, Ősz utca ű/2.", customer_email: "synthetic@example.invalid",
  customer_phone: "teszt", climate_summary: "2 db Teszt hűtő-fűtő klímaberendezés Ő/Ű", work_description: "Nyomáspróba, vákuumozás, beüzemelés és működési próba elvégezve.",
  notes: "Árvíztűrő tükörfúrógép – TESZT dokumentum.", signature_data_url: signature(), signer_name: "Munkalap TESZT Őri", signed_at: "2026-09-14T08:30:00Z", ...overrides });
const declaration = (overrides = {}) => ({ id: ids.declaration, workspace_id: ids.workspace, customer_id: ids.customer,
  appointment_id: ids.appointment, work_report_id: ids.report, seller_name: "TESZT Hűtés-Fűtés Kft.", seller_tax_number: "TESZT",
  seller_representative: "Teszt Ősz Gábor", quote_items: [{ productName: "TESZT hűtő-fűtő berendezés Ő/Ű", quantity: 2 }],
  signature_data_url: signature([180, 30, 30]), signer_name: "Nyilatkozat TESZT Tűnde", signed_at: "2026-09-14T08:35:00Z", ...overrides });
const input = (overrides = {}) => ({ workspaceId: ids.workspace, customerId: ids.customer, appointmentId: ids.appointment,
  workReportId: ids.report, purchaseDeclarationIds: [ids.declaration], documents: "both", ...overrides });
function backend(rows = { work_reports: [report()], purchase_declarations: [declaration()] }) {
  const queries = [];
  return { queries, from(table) {
    const filters = {}; queries.push({ table, filters });
    const query = { select() { return query; }, eq(key, value) { filters[key] = value; return query; }, async maybeSingle() {
      return { data: (rows[table] || []).find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) || null, error: null };
    } }; return query;
  } };
}
module.exports = { loadTypeScript, signature, ids, report, declaration, input, backend };
