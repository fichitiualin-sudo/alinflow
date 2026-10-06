// Rebuild the public, offline town lookup after downloading and extracting
// https://download.geonames.org/export/zip/HU.zip (postal codes) and
// https://download.geonames.org/export/dump/HU.zip (gazetteer), each with its
// sibling readme.txt and extracted HU.txt in separate directories.
// Usage: node scripts/generate-callback-towns.cjs <postal-HU.txt> <YYYY-MM-DD> <postal-HU.zip> <gazetteer-HU.txt> <gazetteer-HU.zip>
// Requires only Node built-ins; never reads or sends customer data.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const [input, snapshot, archive, gazetteerInput, gazetteerArchive] = process.argv.slice(2);
if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot || "") || !archive || !gazetteerInput || !gazetteerArchive) {
  throw new Error("Usage: node scripts/generate-callback-towns.cjs <postal-HU.txt> <YYYY-MM-DD> <postal-HU.zip> <gazetteer-HU.txt> <gazetteer-HU.zip>");
}
const source = fs.readFileSync(input, "utf8");
const readme = fs.readFileSync(path.join(path.dirname(input), "readme.txt"), "utf8");
if (!readme.includes("Creative Commons Attribution 4.0 License")) {
  throw new Error("The GeoNames source license changed; review it before regenerating.");
}
const sourceHash = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
const textHash = createHash("sha256").update(source).digest("hex");
const gazetteer = fs.readFileSync(gazetteerInput, "utf8");
const gazetteerReadme = fs.readFileSync(path.join(path.dirname(gazetteerInput), "readme.txt"), "utf8");
if (!gazetteerReadme.includes("Creative Commons Attribution 4.0 License")) {
  throw new Error("The GeoNames gazetteer license changed; review it before regenerating.");
}
const gazetteerArchiveHash = createHash("sha256").update(fs.readFileSync(gazetteerArchive)).digest("hex");
const gazetteerTextHash = createHash("sha256").update(gazetteer).digest("hex");
const rows = source.trim().split(/\r?\n/);
if (rows.length < 3000) throw new Error("The Hungarian source is unexpectedly incomplete.");
const allNames = new Set();
const towns = new Map();
let excludedRows = 0;
for (const row of rows) {
  const values = row.split("\t");
  const city = values[2];
  const latitude = Number(values[9]);
  const longitude = Number(values[10]);
  const accuracy = Number(values[11]);
  if (values.length !== 12 || values[0] !== "HU" || !/^\d{4}$/.test(values[1]) || !city?.trim()
      || !Number.isFinite(latitude) || latitude < 45 || latitude > 49.5
      || !Number.isFinite(longitude) || longitude < 16 || longitude > 23.5 || !Number.isFinite(accuracy)) {
    throw new Error("Unexpected source row; review the public dataset before regenerating.");
  }
  allNames.add(city);
  // Values below 4 include positions estimated from neighbouring postcodes.
  // Keep these towns unlocated unless another, better source row exists.
  if (accuracy < 4) { excludedRows++; continue; }
  let town = towns.get(city);
  if (!town) { town = new Map(); towns.set(city, town); }
  const key = `${latitude},${longitude}`;
  const point = town.get(key) || { latitude, longitude, count: 0 };
  point.count++;
  town.set(key, point);
}
const selected = new Map([...towns].map(([city, points]) => {
  // A municipality with several postal codes still gets a single source point.
  // Prefer the coordinate repeated most often; stable numeric order breaks ties.
  const point = [...points.values()].sort((a, b) => b.count - a.count || a.latitude - b.latitude || a.longitude - b.longitude)[0];
  return [city, point];
}));
function duplicatedPoints(entries) {
  const namesByPoint = new Map();
  for (const [city, point] of entries) {
    const key = `${point.latitude},${point.longitude}`;
    namesByPoint.set(key, [...(namesByPoint.get(key) || []), city]);
  }
  return [...namesByPoint.values()].filter(names => names.length > 1).flat();
}
const duplicateNames = new Set(duplicatedPoints(selected));
const gazetteerMatches = new Map();
const municipalityFeatures = new Set(["PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC"]);
for (const row of gazetteer.trim().split(/\r?\n/)) {
  const values = row.split("\t");
  // Exact original names only. PPLX is a district/part of another settlement,
  // not an independent municipality (e.g. several places named Kisfalud).
  if (!duplicateNames.has(values[1]) || values[6] !== "P" || values[8] !== "HU"
      || !municipalityFeatures.has(values[7])) continue;
  const point = { id: values[0], city: values[1], latitude: Number(values[4]), longitude: Number(values[5]),
    feature: values[7], population: Number(values[14]), admin1: values[10], admin2: values[11] };
  if (values.length !== 19 || !/^\d+$/.test(point.id) || !Number.isFinite(point.latitude)
      || point.latitude < 45 || point.latitude > 49.5 || !Number.isFinite(point.longitude)
      || point.longitude < 16 || point.longitude > 23.5 || !Number.isSafeInteger(point.population)
      || point.population < 0) throw new Error("Unexpected populated-place record in the gazetteer.");
  gazetteerMatches.set(point.city, [...(gazetteerMatches.get(point.city) || []), point]);
}
const corrections = [];
for (const city of duplicateNames) {
  const matches = (gazetteerMatches.get(city) || []).sort((a, b) => b.population - a.population);
  // One exact populated place is unambiguous. Multiple source records are
  // accepted only if they describe the same point and administrative scope;
  // then the highest population is the reproducible source-id preference.
  const candidate = matches[0];
  const unambiguous = candidate && matches.every(point => point.latitude === candidate.latitude
    && point.longitude === candidate.longitude && point.admin1 === candidate.admin1 && point.admin2 === candidate.admin2);
  if (!unambiguous) { selected.delete(city); continue; }
  selected.set(city, candidate);
  corrections.push(candidate);
}
// Never publish two independent town markers at a shared, unresolved source
// point. Affected customers stay in the visible unlocated list instead.
for (const city of duplicatedPoints(selected)) selected.delete(city);
const output = [...selected].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([city, point]) => `  ${JSON.stringify([city, point.latitude, point.longitude])},`);
const excludedTowns = [...allNames].filter(city => !selected.has(city));
const retainedCorrections = corrections.filter(point => selected.has(point.city));
const header = `// Generated by scripts/generate-callback-towns.cjs; do not edit manually.
// Public GeoNames Hungarian postal-code dataset; snapshot: ${snapshot}.
// Source: https://download.geonames.org/export/zip/HU.zip
// Attribution: https://www.geonames.org/ — Creative Commons Attribution 4.0.
// License: https://creativecommons.org/licenses/by/4.0/
// Source readme: https://download.geonames.org/export/zip/readme.txt
// HU.zip SHA-256: ${sourceHash}
// HU.txt SHA-256: ${textHash}
// Duplicate-point corrections: https://download.geonames.org/export/dump/HU.zip
// Gazetteer readme: https://download.geonames.org/export/dump/readme.txt
// Gazetteer HU.zip SHA-256: ${gazetteerArchiveHash}
// Gazetteer HU.txt SHA-256: ${gazetteerTextHash}
// ${rows.length} source rows / ${allNames.size} source towns; ${output.length} town points retained.
// Excluded ${excludedRows} rows with accuracy <4; ${excludedTowns.length} towns have no retained point.
// ${retainedCorrections.length} overlapping town points replaced by exact gazetteer populated-place records.
${retainedCorrections.sort((a, b) => a.city < b.city ? -1 : a.city > b.city ? 1 : 0)
  .map(point => `// ${point.city}: https://www.geonames.org/${point.id}/ (${point.feature}, ${point.latitude}, ${point.longitude})`).join("\n")}
// Points describe approximate settlements, never individual customer addresses.
// Multiple postal codes share one canonical town; no network request at runtime.

export type CallbackTown = readonly [city: string, latitude: number, longitude: number];

export const CALLBACK_TOWNS: readonly CallbackTown[] = [
`;
const destination = path.resolve(__dirname, "../src/lib/alinflow/callback-town-data.ts");
fs.writeFileSync(destination, `${header}${output.join("\n")}\n];\n`, "utf8");
console.log(JSON.stringify({ sourceRows: rows.length, sourceTowns: allNames.size, retainedTowns: output.length,
  excludedRows, excludedTowns, correctedTowns: retainedCorrections.length, outputBytes: fs.statSync(destination).size }));
