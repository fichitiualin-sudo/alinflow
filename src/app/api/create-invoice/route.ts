import type { Customer, QuoteItem } from "@/lib/alinflow/types";
import { climateSummary } from "@/lib/alinflow/products";
import type { BillingInvoiceKind } from "@/lib/alinflow/billing";

export const runtime = "nodejs";

type InvoiceRequest = {
  kind: BillingInvoiceKind;
  amount: number;
  customer: Customer;
  quoteItems?: QuoteItem[];
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

function buyerAddress(customer: Customer) {
  const postalCode = customer.postalCode || "";
  const city = customer.city || "";
  let address = customer.address || "";

  if (postalCode && address.startsWith(postalCode)) address = address.slice(postalCode.length).trim();
  if (city && address.toLocaleLowerCase("hu-HU").startsWith(city.toLocaleLowerCase("hu-HU"))) {
    address = address.slice(city.length).replace(/^,?\s*/, "");
  }

  return {
    postalCode,
    city,
    address: address || customer.address || "",
  };
}

function readEnv(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function agentKeyEnvName(kind: BillingInvoiceKind) {
  return kind === "device" ? "SZAMLAZZ_DEVICE_AGENT_KEY" : "SZAMLAZZ_LABOR_AGENT_KEY";
}

function getAgentKey(kind: BillingInvoiceKind) {
  return readEnv(agentKeyEnvName(kind));
}

function invoiceLineName(kind: BillingInvoiceKind) {
  if (kind === "device") return readEnv("SZAMLAZZ_DEVICE_LINE_NAME", "Klímaberendezés és szerelési anyagok");
  return readEnv("SZAMLAZZ_LABOR_LINE_NAME", "Klímaszerelési munkadíj");
}

function invoiceVatKey(kind: BillingInvoiceKind) {
  if (kind === "device") return readEnv("SZAMLAZZ_DEVICE_VAT_KEY", "27");
  return readEnv("SZAMLAZZ_LABOR_VAT_KEY", "AAM");
}

function invoiceComment(kind: BillingInvoiceKind) {
  if (kind === "device") return readEnv("SZAMLAZZ_DEVICE_COMMENT", "Készülék és szerelési anyagok számlája.");
  return readEnv("SZAMLAZZ_LABOR_COMMENT", "Klímaszerelési munkadíj számlája.");
}

function invoicePrefix(kind: BillingInvoiceKind) {
  return kind === "device" ? readEnv("SZAMLAZZ_DEVICE_INVOICE_PREFIX") : readEnv("SZAMLAZZ_LABOR_INVOICE_PREFIX");
}

function amountsFromGross(gross: number, vatKey: string) {
  const numericVat = Number(String(vatKey).replace(",", "."));
  if (Number.isFinite(numericVat) && numericVat > 0) {
    const net = Math.round(gross / (1 + numericVat / 100));
    return { net, vat: gross - net, gross };
  }
  return { net: gross, vat: 0, gross };
}

function invoiceLine(kind: BillingInvoiceKind, amount: number, items: QuoteItem[]) {
  const gross = amount;
  const vatKey = invoiceVatKey(kind);
  const amounts = amountsFromGross(gross, vatKey);
  return {
    name: invoiceLineName(kind),
    vatKey,
    ...amounts,
    note: climateSummary(items),
  };
}

function buildInvoiceXml({ kind, amount, customer, quoteItems = [] }: InvoiceRequest, agentKey: string) {
  const date = todayIso();
  const buyer = buyerAddress(customer);
  const line = invoiceLine(kind, amount, quoteItems);
  const externalId = `alinflow-${kind}-${customer.activeAppointmentId || customer.id}`;
  const comment = invoiceComment(kind);

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
    <fizetesiHataridoDatum>${date}</fizetesiHataridoDatum>
    <fizmod>Átutalás</fizmod>
    <penznem>HUF</penznem>
    <szamlaNyelve>hu</szamlaNyelve>
    <megjegyzes>${safeText(comment)}</megjegyzes>
    <arfolyamBank></arfolyamBank>
    <arfolyam>0.0</arfolyam>
    <rendelesSzam>${safeText(externalId)}</rendelesSzam>
    <dijbekeroSzamlaszam></dijbekeroSzamlaszam>
    <elolegszamla>false</elolegszamla>
    <vegszamla>false</vegszamla>
    <helyesbitoszamla>false</helyesbitoszamla>
    <helyesbitettSzamlaszam></helyesbitettSzamlaszam>
    <dijbekero>false</dijbekero>
    <szamlaszamElotag>${safeText(invoicePrefix(kind))}</szamlaszamElotag>
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
    <sendEmail>false</sendEmail>
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
    <tetel>
      <megnevezes>${safeText(line.name)}</megnevezes>
      <mennyiseg>1.0</mennyiseg>
      <mennyisegiEgyseg>db</mennyisegiEgyseg>
      <nettoEgysegar>${line.net}</nettoEgysegar>
      <afakulcs>${line.vatKey}</afakulcs>
      <nettoErtek>${line.net}</nettoErtek>
      <afaErtek>${line.vat}</afaErtek>
      <bruttoErtek>${line.gross}</bruttoErtek>
      <megjegyzes>${safeText(line.note)}</megjegyzes>
    </tetel>
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

  const response = await fetch(SZAMLAZZ_URL, { method: "POST", body: form });
  const text = await response.text();
  const success = xmlValue(text, "sikeres") === "true";
  const invoiceNumber = xmlValue(text, "szamlaszam");
  const errorMessage = xmlValue(text, "hibauzenet") || decodeURIComponent(response.headers.get("szlahu_error") || "");

  if (!response.ok || !success) {
    throw new Error(errorMessage || "A Számlázz.hu nem hozta létre a számlát.");
  }

  return {
    invoiceNumber,
    netAmount: xmlValue(text, "szamlanetto"),
    grossAmount: xmlValue(text, "szamlabrutto"),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InvoiceRequest;
    const kind = body.kind === "device" || body.kind === "labor" ? body.kind : null;
    const amount = parseAmount(body.amount);
    const customer = body.customer;

    if (!kind) return Response.json({ ok: false, error: "Ismeretlen számlatípus." }, { status: 400 });
    if (!amount) return Response.json({ ok: false, error: "Hiányzik az érvényes számlaösszeg." }, { status: 400 });
    if (!customer?.id) return Response.json({ ok: false, error: "Hiányzik az ügyfél." }, { status: 400 });

    const agentKey = getAgentKey(kind);
    if (!agentKey) {
      const envName = agentKeyEnvName(kind);
      return Response.json({ ok: false, error: `Hiányzik a ${envName} környezeti változó.` }, { status: 500 });
    }

    const result = await sendInvoiceXml(buildInvoiceXml({ ...body, kind, amount, customer }, agentKey));
    return Response.json({ ok: true, ...result });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message || "Számlázási hiba." }, { status: 500 });
  }
}
