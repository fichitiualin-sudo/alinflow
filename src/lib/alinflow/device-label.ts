type DeviceSide = "indoor" | "outdoor";

const SIDE_LABEL = /\b(BELT[ÉE]RI|K[ÜU]LT[ÉE]RI|INDOOR|OUTDOOR)\s*(?:EGYS[ÉE]G|UNIT)?\b/i;
const MODEL_LABEL = /^\s*(?:(BELT[ÉE]RI|K[ÜU]LT[ÉE]RI|INDOOR|OUTDOOR)\s*(?:EGYS[ÉE]G|UNIT)?\s*)?(?:MODEL(?:\s*(?:NO|NUMBER))?|MODELL|(?:UNIT\s*)?TYPE|T[ÍI]PUSA?)\b\.?\s*(?:\(\s*(?:MODEL|TYPE)\s*\)|\/\s*(?:MODEL|TYPE))?\s*#?\s*[:：=-]?\s*/i;
const UNIT_LABEL = /^\s*(BELT[ÉE]RI\s*EGYS[ÉE]G|K[ÜU]LT[ÉE]RI\s*EGYS[ÉE]G|INDOOR\s*UNIT|OUTDOOR\s*UNIT)\s*[:：=-]?\s*$/i;
const MANUFACTURER_LABEL = /^\s*(?:GY[ÁA]RT[ÓO]|MANUFACTURER|MANUFACTURED\s+BY|BRAND|M[ÁA]RKA)(?=\s|[:：#=-]|$)\s*[:：#=-]?\s*/i;
const NEXT_FIELD = /\b(?:S\s*[/.\\]\s*N|SN|SERIAL|MODEL|T[ÍI]PUS|VOLTAGE|FREQUENCY|POWER|REFRIGERANT|GY[ÁA]RI\s*SZ[ÁA]M)\b/i;

// A printed brand is useful even when OCR misses the "Manufacturer" caption.
// Short, ambiguous words (AUX, LG, TCL) need a standalone logo or company name.
const BRANDS: [string, RegExp][] = [
  ["Mitsubishi Heavy Industries", /\bMITSUBISHI\s+HEAVY(?:\s+INDUSTRIES)?\b/i],
  ["Mitsubishi Electric", /\bMITSUBISHI\s+ELECTRIC\b/i],
  ["Cooper & Hunter", /\bCOOPER\s*(?:&|AND)\s*HUNTER\b/i],
  ...["Midea", "Gree", "Daikin", "Fujitsu", "Panasonic", "Samsung", "Toshiba", "Hisense", "Haier", "Fisher", "Syen", "Cascade", "Whirlpool", "Bosch", "Electrolux", "Hitachi", "Sinclair", "Vivax"].map((brand): [string, RegExp] => [brand, new RegExp(`\\b${brand}\\b`, "i")]),
  ["LG", /(?:^\s*LG\s*$|\bLG\s+ELECTRONICS\b)/im],
  ["AUX", /^\s*AUX\s*$/im],
  ["TCL", /(?:^\s*TCL\s*$|\bTCL\s+(?:AIR|ELECTRONICS)\b)/im],
];

function sideOf(label: string): DeviceSide {
  return /^(?:BELT|INDOOR)/i.test(label) ? "indoor" : "outdoor";
}

function nextValue(lines: string[], index: number, rest: string): string {
  // Sparse OCR often puts a caption and its value in separate text boxes.
  for (let next = index + 1; !rest && next < lines.length && next <= index + 3; next++) rest = lines[next].trim();
  return rest;
}

function exactModel(value: string): string | undefined {
  const token = value.match(/^[A-Z0-9][A-Z0-9._()/+-]{2,99}(?=\s|$|[,;])/i)?.[0];
  if (!token || !/[A-Z]/i.test(token) || !/\d/.test(token)) return undefined;
  // OCR can crop a suffix or split a model at a separator. Keep those fragments out of autofill.
  if (/[._/+-]$/.test(token)) return undefined;
  let parentheses = 0;
  for (const character of token) {
    if (character === "(") parentheses++;
    if (character === ")" && --parentheses < 0) return undefined;
  }
  if (parentheses !== 0) return undefined;
  if (/^(?:\d+(?:[.,/-]\d+)*(?:KW|W|V|HZ|A|KG|MPA|BTU)|R\d{2,4}[A-Z]?|IPX?\d{1,2})$/i.test(token)) return undefined;
  return token;
}

/** Proposals from the photographed label only; never infer a model from an S/N or a product name. */
export function deviceLabelCandidates(text: string, side: DeviceSide): { manufacturers: string[]; models: string[] } {
  const normalized = text.normalize("NFKC").replace(/\r/g, "").slice(0, 20_000);
  const lines = normalized.split(/\n|[|;]/);
  const manufacturers = new Map<string, string>();
  const models = new Map<string, string>();
  const add = (target: Map<string, string>, value: string) => {
    if (target.size < 5 && !target.has(value.toLocaleUpperCase("hu-HU"))) target.set(value.toLocaleUpperCase("hu-HU"), value);
  };
  let sectionSide: DeviceSide | undefined;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const header = line.match(SIDE_LABEL);
    if (header) sectionSide = sideOf(header[1]);
    const modelLabel = line.match(MODEL_LABEL) || line.match(UNIT_LABEL);
    if (modelLabel && (modelLabel[1] ? sideOf(modelLabel[1]) : sectionSide) !== (side === "indoor" ? "outdoor" : "indoor")) {
      const value = exactModel(nextValue(lines, index, line.slice(modelLabel[0].length).trim()));
      if (value) add(models, value);
    }

    const manufacturerLabel = line.match(MANUFACTURER_LABEL);
    if (manufacturerLabel) {
      const rest = nextValue(lines, index, line.slice(manufacturerLabel[0].length).trim());
      const value = rest.split(NEXT_FIELD)[0].replace(/\s+/g, " ").trim().replace(/[,|:=-]+$/, "").trim();
      if (value.length >= 2 && value.length <= 120 && /[A-ZÁÉÍÓÖŐÚÜŰ]/i.test(value) && !/\d/.test(value)) {
        const brand = BRANDS.find(([, pattern]) => pattern.test(value));
        if (brand || value.length >= 3) add(manufacturers, brand?.[0] || value);
      }
    }
  }
  for (const [brand, pattern] of BRANDS) if (pattern.test(normalized)) add(manufacturers, brand);
  return { manufacturers: [...manufacturers.values()], models: [...models.values()] };
}
