import type { Customer, QuoteItem } from "@/lib/alinflow/types";
import { authorizeCustomerRequest, apiErrorResponse, ApiError } from "@/lib/alinflow/server-auth";
import { cleanQuoteItems, climateQuoteItems, isExtraQuoteItem, itemDeviceTotal, itemInstallTotal, itemName, itemQuantity, itemTotal } from "@/lib/alinflow/products";
import { normalizeAppointmentType } from "@/lib/alinflow/appointments";
import { billingDueDateIso, type BillingInvoiceKind, type BillingPaymentMethod } from "@/lib/alinflow/billing";
import { invoiceIssueDate, issueInvoiceOnce, InvoiceProviderRejection } from "@/lib/alinflow/invoice-delivery";

export const runtime = "nodejs";

type InvoiceRequest = {
  kind: BillingInvoiceKind;
  amount: number;
  paymentMethod?: BillingPaymentMethod;
  transferDueDays?: number;
  billingLabels?: {
    deviceLineName?: string;
    laborLineName?: string;
    maintenanceLineName?: string;
    combinedLineName?: string;
  };
  sendEmail?: boolean;
  customer: Customer;
  quoteItems?: QuoteItem[];
};

type InvoiceIssuer = {
  agentKey: string;
  vatKey: string;
  invoicePrefix: string;
  comment: string;
};

const SZAMLAZZ_URL = "https://www.szamlazz.hu/szamla/";

function safeText(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

function buyerAddress(customer: Customer) {
  const postalCode = customer.postalCode || "";
  const city = customer.city || "";
  const originalAddress = (customer.address || "").normalize("NFC").trim();
  let address = originalAddress;
  const prefix = /^(\d{4})[\s,.;:]*(.*)$/u.exec(address);
  const normalizedCity = city.normalize("NFC").trim();
  const normalizeCity = (value: string) => value.toLocaleLowerCase("hu-HU").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Remove only a complete postcode/city prefix; city-named streets stay intact.
  if (prefix?.[1] === postalCode && normalizedCity) {
    const cityPrefix = prefix[2].slice(0, normalizedCity.length);
    const afterCity = prefix[2].slice(normalizedCity.length);
    if (normalizeCity(cityPrefix) === normalizeCity(normalizedCity) && /^(?:[\s,.;:(]|$)/u.test(afterCity)) {
      address = afterCity.replace(/^[\s,.;:]+/u, "");
    }
  }

  return {
    postalCode,
    city,
    address: address || originalAddress,
  };
}

function readEnv(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function agentKeyEnvName(kind: BillingInvoiceKind) {
  if (kind === "combined") return "SZAMLAZZ_COMBINED_AGENT_KEY";
  return kind === "device" ? "SZAMLAZZ_DEVICE_AGENT_KEY" : "SZAMLAZZ_LABOR_AGENT_KEY";
}

function resolveInvoiceIssuer(kind: BillingInvoiceKind, workspaceId: string): InvoiceIssuer {
  const primaryWorkspaceId = readEnv("SZAMLAZZ_WORKSPACE_ID").trim();
  const splitWorkspaceId = readEnv("SZAMLAZZ_SPLIT_WORKSPACE_ID").trim();
  if (splitWorkspaceId && splitWorkspaceId === primaryWorkspaceId && workspaceId === splitWorkspaceId) {
    throw new ApiError("A munkaterület számlázási beállításai ütköznek. A számlázási kapcsolat ellenőrzése szükséges.", 403);
  }

  if (splitWorkspaceId && workspaceId === splitWorkspaceId) {
    // A split issuer binding takes precedence over any older combined allowlist entry.
    if (kind === "combined") {
      throw new ApiError("Ezen a munkaterületen a készüléket és a munkadíjat külön kell számlázni.", 403);
    }
    if (kind === "labor" || kind === "maintenance") {
      const agentKey = readEnv("SZAMLAZZ_SPLIT_LABOR_AGENT_KEY").trim();
      const vatKey = readEnv("SZAMLAZZ_SPLIT_LABOR_VAT_KEY").trim();
      if (!agentKey) throw new ApiError("Hiányzik a munkaterület saját munkadíj-számlázási kapcsolata.", 500);
      if (!vatKey) throw new ApiError("Hiányzik a munkaterület saját munkadíj-számlázási áfabeállítása.", 500);
      return {
        agentKey,
        vatKey,
        invoicePrefix: readEnv("SZAMLAZZ_SPLIT_LABOR_INVOICE_PREFIX").trim(),
        comment: kind === "maintenance" ? "Légkondicionáló karbantartás számlája." : "Klímaszerelési munkadíj számlája.",
      };
    }
    // Only device invoices share the existing device issuer and its tax/prefix settings.
  } else {
    const combinedWorkspaceAllowed = kind === "combined" && readEnv("SZAMLAZZ_COMBINED_WORKSPACE_IDS")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(workspaceId);
    if (!(primaryWorkspaceId && primaryWorkspaceId === workspaceId) && !combinedWorkspaceAllowed) {
      throw new ApiError("Ehhez a munkaterülethez ez a számlatípus még nincs beállítva. A számlázási kapcsolat beállítása szükséges.", 403);
    }
  }

  const agentKey = kind === "combined"
    ? readEnv("SZAMLAZZ_COMBINED_AGENT_KEY") || readEnv("SZAMLAZZ_DEVICE_AGENT_KEY")
    : readEnv(agentKeyEnvName(kind));
  if (!agentKey.trim()) {
    const envName = kind === "combined" ? "SZAMLAZZ_COMBINED_AGENT_KEY vagy SZAMLAZZ_DEVICE_AGENT_KEY" : agentKeyEnvName(kind);
    throw new ApiError(`Hiányzik a ${envName} környezeti változó.`, 500);
  }
  return { agentKey, vatKey: invoiceVatKey(kind), invoicePrefix: invoicePrefix(kind), comment: invoiceComment(kind) };
}

function configuredLabel(value: unknown, fallback: string) {
  const label = String(value || "").trim();
  return label || fallback;
}

function invoiceLineName(kind: BillingInvoiceKind, labels?: InvoiceRequest["billingLabels"]) {
  if (kind === "combined") return configuredLabel(labels?.combinedLineName, readEnv("SZAMLAZZ_COMBINED_LINE_NAME", "Klímaszerelés készülékkel, anyaggal és munkadíjjal"));
  if (kind === "device") return configuredLabel(labels?.deviceLineName, readEnv("SZAMLAZZ_DEVICE_LINE_NAME", "Klímaberendezés"));
  if (kind === "maintenance") return configuredLabel(labels?.maintenanceLineName, readEnv("SZAMLAZZ_MAINTENANCE_LINE_NAME", "Légkondicionáló karbantartás"));
  return configuredLabel(labels?.laborLineName, readEnv("SZAMLAZZ_LABOR_LINE_NAME", "Légkondicionáló telepítés és beüzemelés"));
}

function invoiceVatKey(kind: BillingInvoiceKind) {
  if (kind === "device") return readEnv("SZAMLAZZ_DEVICE_VAT_KEY", "27");
  if (kind === "combined") return readEnv("SZAMLAZZ_COMBINED_VAT_KEY", readEnv("SZAMLAZZ_DEVICE_VAT_KEY", "27"));
  return readEnv("SZAMLAZZ_LABOR_VAT_KEY", "AAM");
}

function invoiceComment(kind: BillingInvoiceKind) {
  if (kind === "combined") return readEnv("SZAMLAZZ_COMBINED_COMMENT", "Készülék, szerelési anyagok és munkadíj számlája.");
  if (kind === "device") return readEnv("SZAMLAZZ_DEVICE_COMMENT", "Készülék és szerelési anyagok számlája.");
  if (kind === "maintenance") return readEnv("SZAMLAZZ_MAINTENANCE_COMMENT", "Légkondicionáló karbantartás számlája.");
  return readEnv("SZAMLAZZ_LABOR_COMMENT", "Klímaszerelési munkadíj számlája.");
}

function invoicePrefix(kind: BillingInvoiceKind) {
  if (kind === "combined") return readEnv("SZAMLAZZ_COMBINED_INVOICE_PREFIX", readEnv("SZAMLAZZ_DEVICE_INVOICE_PREFIX"));
  return kind === "device" ? readEnv("SZAMLAZZ_DEVICE_INVOICE_PREFIX") : readEnv("SZAMLAZZ_LABOR_INVOICE_PREFIX");
}

function invoicePrefixXml(kind: BillingInvoiceKind, configuredPrefix = invoicePrefix(kind)) {
  const prefix = configuredPrefix.trim();
  return prefix ? `    <szamlaszamElotag>${safeText(prefix)}</szamlaszamElotag>` : "";
}

function amountsFromGross(gross: number, vatKey: string) {
  const numericVat = Number(String(vatKey).replace(",", "."));
  if (Number.isFinite(numericVat) && numericVat > 0) {
    const net = Math.round(gross / (1 + numericVat / 100));
    return { net, vat: gross - net, gross };
  }
  return { net: gross, vat: 0, gross };
}

function laborInvoiceLineName(labels?: InvoiceRequest["billingLabels"]) {
  return invoiceLineName("labor", labels);
}

function maintenanceInvoiceLineName(labels?: InvoiceRequest["billingLabels"]) {
  return invoiceLineName("maintenance", labels);
}

function invoiceLineFromGross(kind: BillingInvoiceKind, name: string, gross: number, note = "", vatKey = invoiceVatKey(kind)) {
  const amounts = amountsFromGross(gross, vatKey);
  return {
    name,
    vatKey,
    ...amounts,
    note,
  };
}

function invoiceQuantityPrefix(quantity: number) {
  return quantity > 1 ? `${quantity} db ` : "";
}

function invoiceLineNoteXml(note: string) {
  const value = String(note || "").trim();
  return value ? `      <megjegyzes>${safeText(value)}</megjegyzes>\n` : "";
}

function distributeGross(totalGross: number, weights: number[]) {
  const weightSum = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!weightSum) return weights.map(() => 0);

  let remaining = totalGross;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remaining;
    const value = Math.min(remaining, Math.round(totalGross * (Math.max(0, weight) / weightSum)));
    remaining -= value;
    return value;
  });
}

function invoiceItemName(item: QuoteItem) {
  return `${invoiceQuantityPrefix(itemQuantity(item))}${itemName(item)}${isExtraQuoteItem(item) ? "" : " + szerelési anyagok"}`;
}

function weightedInvoiceLines(kind: BillingInvoiceKind, amount: number, lines: Array<{ name: string; weight: number }>, vatKey: string) {
  const grossValues = distributeGross(amount, lines.map((line) => line.weight));
  return lines.map((line, index) => invoiceLineFromGross(kind, line.name, grossValues[index], "", vatKey)).filter((line) => line.gross > 0);
}

function invoiceLines(kind: BillingInvoiceKind, amount: number, items: QuoteItem[], labels?: InvoiceRequest["billingLabels"], vatKey = invoiceVatKey(kind), appointmentType?: string) {
  const cleanItems = cleanQuoteItems(items);
  const climateItems = climateQuoteItems(cleanItems);
  const climateQuantity = climateItems.reduce((sum, item) => sum + itemQuantity(item), 0);
  const extrasOnlyName = !climateItems.length ? cleanItems.map(invoiceItemName).join("; ") : "";

  if (normalizeAppointmentType(appointmentType) === "other") {
    const serviceLines = cleanItems.map((item) => ({ name: `${invoiceQuantityPrefix(itemQuantity(item))}${itemName(item)}`, weight: itemTotal(item) })).filter((line) => line.weight > 0);
    if (serviceLines.length) return weightedInvoiceLines(kind, amount, serviceLines, vatKey);
    const name = cleanItems.map((item) => `${invoiceQuantityPrefix(itemQuantity(item))}${itemName(item)}`).join("; ") || "Egyéb szolgáltatás";
    return [invoiceLineFromGross(kind, name, amount, "", vatKey)];
  }

  if (kind === "maintenance") {
    return [invoiceLineFromGross(kind, `${invoiceQuantityPrefix(climateQuantity)}${maintenanceInvoiceLineName(labels)}`, amount, "", vatKey)];
  }

  if (kind === "labor") {
    const extraLines = cleanItems.filter(isExtraQuoteItem).map((item) => ({ name: invoiceItemName(item), weight: itemInstallTotal(item) })).filter((line) => line.weight > 0);
    if (extraLines.length) {
      const climateWeight = climateItems.reduce((sum, item) => sum + itemInstallTotal(item), 0);
      return weightedInvoiceLines(kind, amount, [
        ...(climateWeight > 0 ? [{ name: `${invoiceQuantityPrefix(climateQuantity)}${laborInvoiceLineName(labels)}`, weight: climateWeight }] : []),
        ...extraLines,
      ], vatKey);
    }
    return [invoiceLineFromGross(kind, extrasOnlyName || `${invoiceQuantityPrefix(climateQuantity)}${laborInvoiceLineName(labels)}`, amount, "", vatKey)];
  }

  if (kind === "combined") {
    const itemLines = cleanItems
      .map((item) => {
        return {
          name: invoiceItemName(item),
          weight: isExtraQuoteItem(item) ? itemTotal(item) : itemDeviceTotal(item),
        };
      })
      .filter((line) => line.name && line.weight > 0);
    const laborWeight = climateItems.reduce((sum, item) => sum + itemInstallTotal(item), 0);
    const combinedLines = [
      ...itemLines,
      laborWeight > 0 ? {
        name: `${invoiceQuantityPrefix(climateQuantity)}${laborInvoiceLineName(labels)}`,
        weight: laborWeight,
      } : null,
    ].filter(Boolean) as Array<{ name: string; weight: number }>;

    if (!combinedLines.length) {
      return [invoiceLineFromGross(kind, extrasOnlyName || invoiceLineName("combined", labels), amount, "", vatKey)];
    }

    return weightedInvoiceLines(kind, amount, combinedLines, vatKey);
  }

  const itemLines = cleanItems
    .map((item) => {
      return {
        name: invoiceItemName(item),
        weight: itemDeviceTotal(item),
      };
    })
    .filter((line) => line.name && line.weight > 0);

  if (!itemLines.length) {
    return [invoiceLineFromGross(kind, extrasOnlyName || `${invoiceLineName("device", labels)} + szerelési anyagok`, amount, "", vatKey)];
  }

  return weightedInvoiceLines(kind, amount, itemLines, vatKey);
}

function normalizePaymentMethod(value: unknown): BillingPaymentMethod {
  return value === "transfer" ? "transfer" : "cash";
}

function szamlazzPaymentMethodName(method: BillingPaymentMethod) {
  return method === "cash" ? "Készpénz" : "Átutalás";
}

function buildInvoiceXml({ kind, amount, paymentMethod = "cash", transferDueDays = 2, billingLabels, sendEmail = false, customer, quoteItems = [] }: InvoiceRequest, agentKey: string, issuer?: Omit<InvoiceIssuer, "agentKey">) {
  const date = invoiceIssueDate();
  const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
  const dueDate = billingDueDateIso(normalizedPaymentMethod, new Date(`${date}T12:00:00.000Z`), transferDueDays);
  const buyer = buyerAddress(customer);
  const lines = invoiceLines(kind, amount, quoteItems, billingLabels, issuer?.vatKey, customer.appointmentType);
  const externalId = `alinflow-${kind}-${customer.activeAppointmentId || customer.id}`;
  const comment = issuer?.comment ?? invoiceComment(kind);
  const paymentLabel = szamlazzPaymentMethodName(normalizedPaymentMethod);
  const shouldSendEmail = Boolean(sendEmail && customer.email?.trim());

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
  <beallitasok>
    <szamlaagentkulcs>${safeText(agentKey)}</szamlaagentkulcs>
    <eszamla>false</eszamla>
    <szamlaLetoltes>false</szamlaLetoltes>
    <valaszVerzio>2</valaszVerzio>
    <aggregator></aggregator>
    <szamlaKulsoAzon>${safeText(externalId)}</szamlaKulsoAzon>
  </beallitasok>
  <fejlec>
    <keltDatum>${date}</keltDatum>
    <teljesitesDatum>${date}</teljesitesDatum>
    <fizetesiHataridoDatum>${dueDate}</fizetesiHataridoDatum>
    <fizmod>${safeText(paymentLabel)}</fizmod>
    <penznem>Ft</penznem>
    <szamlaNyelve>hu</szamlaNyelve>
    <megjegyzes>${safeText(comment)}</megjegyzes>
    <arfolyamBank></arfolyamBank>
    <arfolyam>0.0</arfolyam>
    <rendelesSzam></rendelesSzam>
    <dijbekeroSzamlaszam></dijbekeroSzamlaszam>
    <elolegszamla>false</elolegszamla>
    <vegszamla>false</vegszamla>
    <helyesbitoszamla>false</helyesbitoszamla>
    <helyesbitettSzamlaszam></helyesbitettSzamlaszam>
    <dijbekero>false</dijbekero>
${invoicePrefixXml(kind, issuer?.invoicePrefix)}
  </fejlec>
  <elado>
    <bank></bank>
    <bankszamlaszam></bankszamlaszam>
    <emailReplyto></emailReplyto>
    <emailTargy></emailTargy>
    <emailSzoveg></emailSzoveg>
  </elado>
  <vevo>
    <nev>${safeText(customer.name || "Magánszemély")}</nev>
    <irsz>${safeText(buyer.postalCode)}</irsz>
    <telepules>${safeText(buyer.city)}</telepules>
    <cim>${safeText(buyer.address)}</cim>
    <email>${safeText(customer.email)}</email>
    <sendEmail>${shouldSendEmail ? "true" : "false"}</sendEmail>
    <adoszam></adoszam>
    <postazasiNev></postazasiNev>
    <postazasiIrsz></postazasiIrsz>
    <postazasiTelepules></postazasiTelepules>
    <postazasiCim></postazasiCim>
    <azonosito></azonosito>
    <telefonszam>${safeText(customer.phone)}</telefonszam>
    <megjegyzes></megjegyzes>
  </vevo>
  <tetelek>
${lines.map((line) => `    <tetel>
      <megnevezes>${safeText(line.name)}</megnevezes>
      <mennyiseg>1.0</mennyiseg>
      <mennyisegiEgyseg>db</mennyisegiEgyseg>
      <nettoEgysegar>${line.net}</nettoEgysegar>
      <afakulcs>${line.vatKey}</afakulcs>
      <nettoErtek>${line.net}</nettoErtek>
      <afaErtek>${line.vat}</afaErtek>
      <bruttoErtek>${line.gross}</bruttoErtek>
${invoiceLineNoteXml(line.note)}    </tetel>`).join("\n")}
  </tetelek>
</xmlszamla>`;
}

function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, "i"));
  return match?.[1]?.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim() || "";
}

async function sendInvoiceXml(xml: string) {
  const form = new FormData();
  form.append("action-xmlagentxmlfile", new Blob([xml], { type: "text/xml;charset=utf-8" }), "alinflow-szamla.xml");

  const response = await fetch(SZAMLAZZ_URL, { method: "POST", body: form,
    ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(25_000) } : {}),
  });
  const text = await response.text();
  const outcome = xmlValue(text, "sikeres");
  const invoiceNumber = xmlValue(text, "szamlaszam");
  if (outcome === "false" && !invoiceNumber) throw new InvoiceProviderRejection();
  if (!response.ok || outcome !== "true" || !invoiceNumber) throw new Error("Unconfirmed invoice result");

  return {
    invoiceNumber,
    netAmount: xmlValue(text, "szamlanetto"),
    grossAmount: xmlValue(text, "szamlabrutto"),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InvoiceRequest;
    const { workspaceId, userId, appointment } = await authorizeCustomerRequest(request, body);
    const kind = body.kind === "device" || body.kind === "labor" || body.kind === "maintenance" || body.kind === "combined" ? body.kind : null;
    const amount = parseAmount(body.amount);
    const customer = { ...body.customer, appointmentType: normalizeAppointmentType(appointment?.appointment_type || body.customer?.appointmentType) };

    if (!kind) return Response.json({ ok: false, error: "Ismeretlen számlatípus." }, { status: 400 });
    if (!amount) return Response.json({ ok: false, error: "Hiányzik az érvényes számlaösszeg." }, { status: 400 });
    if (!customer?.id) return Response.json({ ok: false, error: "Hiányzik az ügyfél." }, { status: 400 });
    if (customer.appointmentType === "other" && (!appointment?.id || kind !== "labor")) {
      throw new ApiError("Az egyéb munka a mentett időponthoz, saját szolgáltatási számlaként számlázható.", 400);
    }
    if (customer.appointmentType === "other" && (appointment?.status === "Lemondva" || appointment?.cancelled_at)) {
      throw new ApiError("A lemondott szolgáltatási időpont nem számlázható.", 409);
    }

    const issuer = resolveInvoiceIssuer(kind, workspaceId);
    if (customer.appointmentType === "other") issuer.comment = "Szolgáltatási díj számlája.";

    const sendEmail = Boolean(body.sendEmail && customer.email?.trim());
    const xml = buildInvoiceXml({ ...body, kind, amount, customer, sendEmail }, issuer.agentKey, issuer);
    const result = await issueInvoiceOnce({ workspaceId, customerId: customer.id,
      appointmentId: appointment?.id || null, requestedBy: userId, kind, sendEmail }, () => sendInvoiceXml(xml));
    return Response.json({ ok: true, ...result });
  } catch (error: any) {
    return apiErrorResponse(error);
  }
}
