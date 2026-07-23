export type SpreadsheetCell = string | number | boolean | null | undefined;

export type SpreadsheetColumn = {
  key: string;
  label: string;
};

export type SpreadsheetRow = Record<string, SpreadsheetCell>;

export type SpreadsheetSheet = {
  name: string;
  columns: SpreadsheetColumn[];
  rows: SpreadsheetRow[];
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sheetName(value: string, usedNames: Set<string>) {
  const cleaned = value.replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Adatok";
  const baseName = cleaned.slice(0, 31);
  let nextName = baseName;
  let index = 2;

  while (usedNames.has(nextName)) {
    const suffix = ` ${index}`;
    nextName = `${baseName.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }

  usedNames.add(nextName);
  return nextName;
}

function cellXml(value: SpreadsheetCell) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }

  if (typeof value === "boolean") {
    return `<Cell><Data ss:Type="String">${value ? "igen" : "nem"}</Data></Cell>`;
  }

  return `<Cell><Data ss:Type="String">${escapeXml(String(value ?? ""))}</Data></Cell>`;
}

function rowXml(values: SpreadsheetCell[]) {
  return `<Row>${values.map(cellXml).join("")}</Row>`;
}

export function buildSpreadsheetWorkbook(sheets: SpreadsheetSheet[]) {
  const usedNames = new Set<string>();
  const worksheets = sheets.map((sheet) => {
    const name = sheetName(sheet.name, usedNames);
    const header = rowXml(sheet.columns.map((column) => column.label));
    const rows = sheet.rows.map((row) => rowXml(sheet.columns.map((column) => row[column.key]))).join("");

    return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${header}${rows}</Table></Worksheet>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${worksheets}
</Workbook>`;
}

export function downloadSpreadsheetWorkbook(filename: string, sheets: SpreadsheetSheet[]) {
  const workbook = buildSpreadsheetWorkbook(sheets);
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
