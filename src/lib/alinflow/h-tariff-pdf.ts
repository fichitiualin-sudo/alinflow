import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, TextAlignment, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { AppointmentDevice } from "./appointment-devices";
import type { WorkPhotoContext } from "./types";
import { loadPdfFont } from "./document-pdf";
import { H_TARIFF_PROVIDERS, hTariffDeviceGroups, hTariffModel, hTariffNumber, validateHTariff, type HTariffData } from "./h-tariff";

type Rect = readonly [number, number, number, number];
const BLACK = rgb(0, 0, 0);

/** Original form pages remain untouched as backgrounds; unique AcroForm fields avoid merge collisions. */
export async function buildHTariffPdf(data: HTariffData, devices: AppointmentDevice[], scope?: WorkPhotoContext): Promise<Uint8Array> {
  const issues = validateHTariff(data, devices, scope);
  if (issues.length || !data.provider) throw new Error(`A H tarifás nyomtatványhoz javítsd az adatokat: ${issues.slice(0, 5).map((issue) => issue.label).join("; ")}`);
  const provider = H_TARIFF_PROVIDERS[data.provider];
  const template = await readFile(path.join(process.cwd(), "public/forms/h-tariff", provider.template));
  const document = await PDFDocument.create();
  const font = await loadPdfFont(document);
  const backgrounds = await document.embedPdf(template, [0, 1]);
  const form = document.getForm();
  document.setTitle(`H tarifa - ${data.applicantName} - ${provider.label}`);
  document.setCreator("AlinFlow");
  document.setSubject(`${provider.version}; aláírandó nyomtatvány; ${devices.length} készülék`);

  for (const [index, group] of hTariffDeviceGroups(data.provider, devices).entries()) {
    const prefix = `h_${index + 1}`;
    const page = document.addPage([backgrounds[0].width, backgrounds[0].height]);
    page.drawPage(backgrounds[0]);
    const technical = group[0].data;
    const field = (name: string, value: string, rect: Rect, options: { multiline?: boolean; comb?: number; size?: number } = {}) => {
      const [x, y, width, height] = rect;
      const lines = String(value).split("\n");
      const size = Math.min(options.size || 9, ...lines.map((line) => line ? (width - 4) / font.widthOfTextAtSize(line, 1) : 9));
      if (!options.comb && size < 6.5) throw new Error(`A(z) „${name}” értéke túl hosszú a hivatalos nyomtatvány mezőjéhez. Rövidítsd az adatot a pontos azonosítás megtartásával.`);
      if (options.multiline && lines.length * font.heightAtSize(size) * 1.2 > height - 2) throw new Error(`A(z) „${name}” mező túl sok sort tartalmaz a hivatalos nyomtatványhoz. Rövidítsd a szöveget.`);
      const item = form.createTextField(`${prefix}.${name}`);
      if (options.multiline) item.enableMultiline();
      if (options.comb) { item.setMaxLength(options.comb); item.enableCombing(); }
      item.setText(value);
      item.addToPage(page, { x, y, width, height, font, textColor: BLACK, borderWidth: 0, borderColor: undefined, backgroundColor: undefined });
      item.setFontSize(size);
      item.updateAppearances(font);
      return item;
    };
    const check = (name: string, selected: boolean, x: number, y: number) => {
      const item = form.createCheckBox(`${prefix}.${name}`);
      item.addToPage(page, { x, y, width: 7, height: 7, borderWidth: 0.6, borderColor: BLACK });
      if (selected) item.check();
    };

    if (data.provider === "eon") {
      field("applicantName", data.applicantName, [149.1, 707.24, 412.16, 10.77]);
      field("meteringPointIdentifier", data.meteringPointIdentifier.replace(/\s/g, "").toUpperCase().slice(5), [149.63, 688.85, 328.46, 13.85], { comb: 28 });
      field("manufacturer", technical.manufacturer || "", [114.09, 613.56, 447.17, 10.77]);
      field("model", hTariffModel(technical), [106.30, 599.74, 454.96, 10.77]);
      check("quantity.one", group.length === 1, 221.02, 586.32);
      check("quantity.multiple", group.length > 1, 272.02, 586.32);
      if (group.length > 1) field("quantityCount", String(group.length), [333.21, 586.55, 23.9, 10.77]);
      check("phase.one", technical.phaseCount === "1", 221.02, 556.89);
      check("phase.three", technical.phaseCount === "3", 272.02, 556.89);
      field("heatingCapacityKw", technical.heatingCapacityKw || "", [201.26, 543.4, 360, 10.77]);
      field("nominalElectricalKw", technical.nominalElectricalKw || "", [247.18, 529.68, 314.08, 10.77]);
      check("start.soft", technical.startCurrentReduction === "soft-starter", 259.02, 515.98);
      check("start.inverter", technical.startCurrentReduction === "inverter", 357.02, 515.98);
      check("start.none", technical.startCurrentReduction === "none", 432.02, 515.98);
      field("nominalCurrentA", technical.nominalCurrentA || "", [156.47, 502.3, 100.06, 10.77]);
      field("maximumCurrentA", technical.maximumCurrentA || "", [361.98, 502.3, 199.28, 10.77]);
      field("recommendedFuse", technical.recommendedFuse || "", [250.58, 488.69, 310.68, 10.77]);
      field("supplementaryHeaterKw", technical.supplementaryHeaterKw || "", [199.13, 475.09, 362.13, 10.77]);
      if (Number(hTariffNumber(technical.supplementaryHeaterKw)) > 0) {
        check("supplementary.yes", technical.supplementaryHeaterSeparable === "yes", 357.02, 461.45);
        check("supplementary.no", technical.supplementaryHeaterSeparable === "no", 432.02, 461.45);
        if (technical.supplementaryHeaterSeparable === "no") field("supplementaryHeaterSharePercent", technical.supplementaryHeaterSharePercent || "", [185.1, 433.98, 376.16, 10.77]);
      }
      check("use.cooling", technical.systemUsage?.includes("cooling") === true, 150.02, 404.38);
      check("use.heating", technical.systemUsage?.includes("heating") === true, 229.02, 404.38);
      check("use.hotwater", technical.systemUsage?.includes("dhw") === true, 292.02, 404.38);
      [["ground-probe", 81.02], ["ground-collector", 150.02], ["well", 229.02], ["air", 292.02]].forEach(([source, x]) => check(`source.${source}`, technical.heatSource === source, Number(x), 390.74));
      check("medium.water", technical.systemType?.endsWith("-water") === true, 96.41, 377.11);
      check("medium.air", technical.systemType?.endsWith("-air") === true, 150.02, 377.11);
      field("scop", technical.scop || "", [498.9, 377.15, 62.36, 10.77]);
      field("notes", data.notes, [34.02, 332, 527.24, 20], { multiline: true, size: 8 });
      for (const [role, x, width] of [["electrician", 144.28, 146.98], ["installer", 361.28, 199.98]] as const) {
        field(`${role}Name`, data[`${role}Name`], [x, 301.89, width, 10.77]);
        const addressLines = splitFieldLines(data[`${role}Address`], font, width, 8);
        field(`${role}Address1`, addressLines[0] || "", [x, 287.72, width, 10.77], { size: 8 });
        field(`${role}Address2`, addressLines.slice(1).join(" "), [role === "electrician" ? 34.02 : 303.31, 273.54, role === "electrician" ? 257.24 : 257.95, 10.77], { size: 8 });
        field(`${role}Phone`, data[`${role}Phone`], [role === "electrician" ? 174.95 : 391.18, 257.73, role === "electrician" ? 116.31 : 170.08, 10.77], { size: 8 });
        field(`${role}Email`, data[`${role}Email`], [role === "electrician" ? 168.95 : 385.51, 241.91, role === "electrician" ? 122.31 : 175.75, 10.77], { size: 8 });
      }
    } else if (data.provider === "mvm-emasz") {
      field("applicantName", data.applicantName, [129.480, 706.560, 388.255, 20.400]);
      field("installationAddress", data.installationAddress, [171.183, 683.955, 347.097, 20.280]);
      field("emaszConsumptionPlaceIdentifier", data.emaszConsumptionPlaceIdentifier, [180.592, 661.230, 338.475, 20.400]);
      field("caseNumber", data.caseNumber, [132.205, 638.565, 386.192, 20.400]);
      field("tariff", "H", [131.733, 616.320, 386.565, 19.560]);
      field("manufacturer", technical.manufacturer || "", [137.045, 523.560, 377.735, 20.400]);
      field("model", hTariffModel(technical), [100.366, 500.062, 414.894, 20.400]);
      field("outdoorModel", technical.outdoorModel || "", [188.163, 476.564, 326.801, 20.400]);
      field("indoorModel", technical.indoorModel || "", [188.184, 453.067, 327.445, 20.400]);
      field("outdoorSerial", technical.outdoorSerial || "", [172.669, 429.569, 342.360, 20.400]);
      field("indoorSerial", technical.indoorSerial || "", [172.713, 406.071, 342.860, 20.400]);
      field("installerName", data.installerName, [94.516, 242.467, 422.396, 20.400]);
      field("installerFgasIdentifier", data.installerFgasIdentifier, [186.012, 218.504, 330.496, 20.400]);
      field("installerPhone", data.installerPhone, [126.575, 194.541, 390.185, 20.400]);
      field("installerEmail", data.installerEmail, [119.698, 170.578, 397.586, 20.400]);
      field("dateAndLocation", `${data.location}, ${data.date.replaceAll("-", ".")}.`, [140.825, 128.031, 258.360, 20.400]);
    } else {
      const topField = (name: string, value: string, x: number, top: number, width: number, height: number, options?: Parameters<typeof field>[3]) => field(name, value, [x, page.getHeight() - top - height, width, height], options);
      topField("applicantName", data.applicantName, 198, 161, 362, 20, { size: 11 });
      for (const [name, top, identifier] of [["customerIdentifier", 188, data.customerIdentifier], ["consumptionPlaceIdentifier", 272, data.consumptionPlaceIdentifier]] as const) {
        [...identifier.replace(/\s/g, "").slice(2)].forEach((character, i) => {
          const item = topField(`${name}.${i}`, character, 267 + i * 37.2, top, 35, 31, { size: 11 });
          item.setAlignment(TextAlignment.Center);
        });
      }
      [...data.postalCode].forEach((character, i) => {
        const item = topField(`postalCode.${i}`, character, 196 + i * 17.5, 228, 17, 17);
        item.setAlignment(TextAlignment.Center);
      });
      const address = data.installationAddress.replace(new RegExp(`^${data.postalCode}\\s*`), "");
      topField("installationAddress", address, 200, 247, 360, 18, { size: 10 });
      topField("manufacturer", technical.manufacturer || "", 109, 383, 255, 17);
      topField("indoorModel", technical.indoorModel || "", 460, 382, 102, 10, { size: 8 });
      topField("outdoorModel", technical.outdoorModel || "", 460, 392, 102, 10, { size: 8 });
      topField("nominalElectricalKw", technical.nominalElectricalKw || "", 163, 425, 58, 14, { size: 10 });
      topField("heatingCapacityKw", technical.heatingCapacityKw || "", 281, 425, 82, 14, { size: 10 });
      topField("scop", technical.scop || "", 482, 425, 80, 14, { size: 10 });
      const systemIndex = ["air-air", "air-water", "ground-air", "ground-water", "water-air", "water-water"].indexOf(technical.systemType || "");
      const systems = [[84, 486], [172, 486], [260, 486], [348, 486], [435, 486], [523, 486]];
      if (systemIndex >= 0) page.drawEllipse({ x: systems[systemIndex][0], y: page.getHeight() - systems[systemIndex][1], xScale: 39, yScale: 13, borderWidth: 1, borderColor: BLACK });
      topField("totalSimultaneousElectricalKw", data.totalSimultaneousElectricalKw, 404, 517, 157, 16, { size: 10 });
      topField("heatingSeasonKwh", technical.heatingSeasonKwh || "", 167, 558, 132, 16, { size: 10 });
      topField("summerSeasonKwh", technical.summerSeasonKwh || "", 422, 558, 139, 16, { size: 10 });
      topField("dateAndLocation", `${data.location}, ${data.date.replaceAll("-", ".")}.`, 107, 699, 175, 14, { size: 9 });
    }
    const instructions = document.addPage([backgrounds[1].width, backgrounds[1].height]);
    instructions.drawPage(backgrounds[1]);
  }
  form.updateFieldAppearances(font);
  return document.save();
}

function splitFieldLines(value: string, font: PDFFont, width: number, size: number) {
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(/\s+/)) {
    if (current && font.widthOfTextAtSize(`${current} ${word}`, size) > width - 4) { lines.push(current); current = word; }
    else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines;
}
