export const runtime = "nodejs";

type QuoteCustomer = {
  name?: string;
  city?: string;
  phone?: string;
  email?: string;
  address?: string;
  need?: string;
};

type QuoteItem = {
  name?: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
};

function ft(value: number) {
  return `${Number(value || 0).toLocaleString("hu-HU")} Ft`;
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function ascii(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[őŐ]/g, (m) => (m === "Ő" ? "O" : "o"))
    .replace(/[űŰ]/g, (m) => (m === "Ű" ? "U" : "u"))
    .replace(/[–—]/g, "-")
    .replace(/[•]/g, "-");
}

function pdfEscape(value: string) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(value: string, max = 88) {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function createSimplePdf(lines: string[]) {
  const pageLines: string[][] = [];
  let current: string[] = [];
  for (const sourceLine of lines) {
    for (const line of wrapLine(sourceLine)) {
      if (current.length >= 43) {
        pageLines.push(current);
        current = [];
      }
      current.push(line);
    }
  }
  if (current.length) pageLines.push(current);

  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  const pagesIdPlaceholder = 0;

  for (const page of pageLines) {
    const content = ["BT", "/F1 11 Tf", "50 790 Td", "14 TL"];
    page.forEach((line, index) => {
      content.push(`${index === 0 ? "" : "T*"}(${pdfEscape(line)}) Tj`);
    });
    content.push("ET");
    const stream = content.join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent PAGES_ID 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  const pagesId = add(`<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  for (let i = 0; i < objects.length; i++) {
    objects[i] = objects[i].replaceAll("PAGES_ID", String(pagesId));
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function quotePdf(customer: QuoteCustomer, items: QuoteItem[], totalAmount: number, installerAmount: number, materialAmount: number) {
  const today = new Date().toLocaleDateString("hu-HU");
  const lines = [
    "KLIMAlin arajanlat",
    `Keszult: ${today}`,
    "",
    "Ugyfel adatok",
    `Nev: ${safeText(customer.name) || "-"}`,
    `Telepules: ${safeText(customer.city) || "-"}`,
    `Cim: ${safeText(customer.address) || "-"}`,
    `Email: ${safeText(customer.email) || "-"}`,
    `Telefon: ${safeText(customer.phone) || "-"}`,
    `Igeny: ${safeText(customer.need) || "-"}`,
    "",
    "Ajanlati tetelek",
    ...items.map((item) => `${Number(item.quantity || 1)} db ${safeText(item.name)} - ${ft(Number(item.totalPrice || 0))}`),
    "",
    `Fizetendo brutto vegosszeg: ${ft(totalAmount)}`,
    "",
    "Alapszereles tartalma",
    "- max. 3 m szigetelt rezcso-par / klima",
    "- 1 db falattores, tomites es esztetikus lezaras",
    "- kondenzviz elvezetes gravitaciosan, megfelelo lejtes szerint",
    "- kulteri fali konzol rezgescsillapitokkal",
    "- kabelcsatorna es rogzitok a szukseges mertekben",
    "- nyomasproba, vakuumozas, beuzemeles es mukodesi teszt",
    "- felhasznaloi betanitas es rendrakas",
    "",
    "Minosegi kivitelezes",
    "- Alukasirozott, hoszigetelt rezcso-par.",
    "- Idojarasallo gumikabel a teljes nyomvonalon.",
    "- Stabil konzol es vastag rezgescsillapitok.",
    "- Szakszeru falattores, tomites es esztetikus lezaras.",
    "",
    "Belso szamlazasi bontas",
    `Adorjan Alin E.V. - klimatelesitesi munkadij: ${ft(installerAmount)}`,
    `AMOVA 4U Kft. - klimaberendezes + szerelesi anyagok: ${ft(materialAmount)}`,
    "Ez a bontas az ugyfel altal fizetendo vegosszeget nem modositja.",
    "",
    "Ajanlat ervenyessege: 7 nap.",
    "",
    "Udvözlettel:",
    "Adorjan Alin - KLIMAlin",
    "klimalin.hu - legkondikalkulator.hu - 06 30 700 4908",
  ];
  return createSimplePdf(lines);
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM || "KLIMAlin <info@alinflow.hu>";
    const replyTo = process.env.EMAIL_REPLY_TO || "klima.alin@gmail.com";

    if (!apiKey) return Response.json({ error: "Hiányzik a RESEND_API_KEY környezeti változó." }, { status: 500 });

    const body = await request.json();
    const customer: QuoteCustomer = body.customer || {};
    const items: QuoteItem[] = Array.isArray(body.items) ? body.items : [];
    const totalAmount = Number(body.totalAmount || 0);
    const installerAmount = Number(body.installerAmount || 0);
    const materialAmount = Number(body.materialAmount || 0);
    const to = safeText(customer.email);

    if (!to) return Response.json({ error: "Hiányzik az ügyfél email címe." }, { status: 400 });

    const pdf = quotePdf(customer, items, totalAmount, installerAmount, materialAmount);
    const htmlItems = items.map((item) => `<li>${Number(item.quantity || 1)} db ${safeText(item.name)} – <strong>${ft(Number(item.totalPrice || 0))}</strong></li>`).join("");

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: replyTo,
        subject: "Klíma ajánlat – KLIMAlin",
        html: `
          <p>Kedves ${safeText(customer.name) || "Ügyfelünk"}!</p>
          <p>A telefonos egyeztetés alapján mellékletben küldöm a klímás ajánlatot PDF formátumban.</p>
          <ul>${htmlItems}</ul>
          <p><strong>Bruttó végösszeg: ${ft(totalAmount)}</strong></p>
          <p>Az ár alapszereléssel együtt értendő. Az ajánlat 7 napig érvényes.</p>
          <p>Üdvözlettel:<br/>Adorján Alin<br/>KLIMAlin<br/>06 30 700 4908</p>
        `,
        attachments: [
          {
            filename: `klimalin-ajanlat-${ascii(safeText(customer.name) || "ugyfel").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}.pdf`,
            content: pdf.toString("base64"),
          },
        ],
      }),
    });

    const result = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) return Response.json({ error: result?.message || "A Resend nem tudta elküldeni az emailt." }, { status: resendResponse.status });

    return Response.json({ ok: true, id: result?.id });
  } catch (error: any) {
    return Response.json({ error: error?.message || "Ismeretlen email küldési hiba." }, { status: 500 });
  }
}
