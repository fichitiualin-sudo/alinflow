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

type PdfOp = string;

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
    .replace(/[•]/g, "-")
    .replace(/[·]/g, "-");
}

function pdfEscape(value: string) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function money(value: number) {
  return ascii(ft(value));
}

function wrapText(value: string, maxChars: number) {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function rgb(hex: string) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

function rect(x: number, y: number, w: number, h: number, fill: string, stroke?: string) {
  const ops = [`${rgb(fill)} rg`];
  if (stroke) ops.push(`${rgb(stroke)} RG`);
  ops.push(`${x} ${y} ${w} ${h} re ${stroke ? "B" : "f"}`);
  return ops.join("\n");
}

function text(value: string, x: number, y: number, size = 11, font = "F1", fill = "#111827") {
  return [
    `${rgb(fill)} rg`,
    "BT",
    `/${font} ${size} Tf`,
    `${x} ${y} Td`,
    `(${pdfEscape(value)}) Tj`,
    "ET",
  ].join("\n");
}

function paragraph(lines: string[], x: number, startY: number, options?: { size?: number; font?: string; fill?: string; leading?: number; bullet?: boolean }) {
  const size = options?.size ?? 10;
  const font = options?.font ?? "F1";
  const fill = options?.fill ?? "#111827";
  const leading = options?.leading ?? 16;
  const ops: string[] = [];
  let y = startY;
  for (const raw of lines) {
    if (options?.bullet) {
      ops.push(text("•", x, y, size, "F2", fill));
      ops.push(text(raw, x + 16, y, size, font, fill));
    } else {
      ops.push(text(raw, x, y, size, font, fill));
    }
    y -= leading;
  }
  return { ops: ops.join("\n"), nextY: y };
}

function pdfDocument(pageStreams: string[]) {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds: number[] = [];

  for (const stream of pageStreams) {
    const contentId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent PAGES_ID 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  const pagesId = add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  for (let i = 0; i < objects.length; i++) objects[i] = objects[i].replaceAll("PAGES_ID", String(pagesId));

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

function createQuotePdf(customer: QuoteCustomer, items: QuoteItem[], totalAmount: number, installerAmount: number, materialAmount: number) {
  const ops1: PdfOp[] = [];
  const ops2: PdfOp[] = [];
  const left = 55;
  const right = 540;
  const width = right - left;

  // Page 1 background + header
  ops1.push(rect(0, 0, 595, 842, "#ffffff"));
  ops1.push(text("KLIMA", 70, 735, 18, "F2", "#0f7490"));
  ops1.push(text("KLIMAlin arajanlat", 185, 735, 22, "F2", "#050816"));
  ops1.push(text("Klimaberendezes alapszerelessel egyutt", 185, 712, 11, "F1", "#64748b"));
  ops1.push(text("Ajanlat ervenyessege: 7 nap", left, 675, 11, "F1", "#64748b"));
  ops1.push(text("Kapcsolat: 06 30 700 4908", left, 655, 11, "F1", "#64748b"));
  ops1.push(text("klimalin.hu", left, 635, 11, "F1", "#64748b"));
  ops1.push("0.90 0.93 0.97 RG\n55 606 485 0.8 re S");

  // Customer card
  ops1.push(rect(left, 500, width, 92, "#f1f5f9"));
  ops1.push(text("Ugyfel", left + 12, 567, 10, "F1", "#64748b"));
  ops1.push(text(safeText(customer.name) || "-", left + 12, 546, 16, "F2", "#050816"));
  ops1.push(text(safeText(customer.city) || "-", left + 12, 526, 11, "F1", "#050816"));
  ops1.push(text(safeText(customer.address) || "-", left + 12, 508, 11, "F1", "#050816"));
  ops1.push(text(safeText(customer.email) || "-", left + 250, 526, 11, "F1", "#050816"));
  ops1.push(text(safeText(customer.phone) || "-", left + 250, 508, 11, "F1", "#050816"));

  // Summary card
  ops1.push(rect(left, 422, width, 58, "#f1f5f9"));
  ops1.push(text("Ajanlat osszesito", left + 12, 458, 10, "F1", "#64748b"));
  ops1.push(text(money(totalAmount), left + 12, 436, 18, "F2", "#050816"));
  ops1.push(text("Brutto vegosszeg alapszerelessel", left + 12, 420, 10, "F1", "#64748b"));

  // Items
  let itemY = 380;
  for (const item of items.length ? items : [{ name: "Klimaberendezes", quantity: 1, totalPrice: totalAmount }]) {
    const qty = Number(item.quantity || 1);
    const name = safeText(item.name) || "Klimaberendezes";
    const price = Number(item.totalPrice || 0);
    ops1.push(rect(left, itemY - 58, width, 58, "#ffffff", "#e5e7eb"));
    const title = `${qty} db - ${name}`;
    ops1.push(text(title, left + 12, itemY - 22, 13, "F2", "#050816"));
    ops1.push(text(`${money(price)} (telepitessel egyutt)`, left + 12, itemY - 40, 10, "F1", "#64748b"));
    ops1.push(text(money(price), right - 125, itemY - 40, 12, "F2", "#050816"));
    itemY -= 72;
    if (itemY < 150) break;
  }

  ops1.push(rect(left, 78, width, 48, "#050816"));
  ops1.push(text("Fizetendo brutto vegosszeg", left + 16, 96, 16, "F2", "#ffffff"));
  ops1.push(text(money(totalAmount), right - 120, 96, 15, "F2", "#ffffff"));

  // Page 2
  ops2.push(rect(0, 0, 595, 842, "#ffffff"));
  ops2.push(rect(left, 555, width, 230, "#f1f5f9"));
  ops2.push(text("Alapszereles tartalma", left + 14, 752, 15, "F2", "#050816"));
  const baseLines = [
    "max. 3 m szigetelt rezcso-par / klima",
    "1 db falattores, tomites es esztetikus lezaras",
    "kondenzviz elvezetes gravitaciosan, megfelelo lejtes szerint, adottsag szerint",
    "kulteri fali konzol vastag rezgescsillapitokkal, max. 4 m szerelesi magassagig",
    "kabelcsatorna es rogzitok a szukseges mertekben",
    "betap kabel max. 5 m-ig",
    "nyomasproba, vakuumozas, beuzemeles es mukodesi teszt",
    "felhasznaloi betanitas es rendrakas",
  ];
  const basePara = paragraph(baseLines, left + 18, 725, { size: 10.5, bullet: true, leading: 21 });
  ops2.push(basePara.ops);

  ops2.push(rect(left, 318, width, 205, "#f1f5f9"));
  ops2.push(text("Minosegi kivitelezes", left + 14, 490, 15, "F2", "#050816"));
  const quality = [
    "Alukasirozott, hoszigetelt rezcso-par.",
    "Idojarasallo gumikabel a teljes nyomvonalon.",
    "Stabil konzol es vastag rezgescsillapitok a kulteri egysegnel.",
    "Szakszeru falattores, tomites es esztetikus lezaras.",
    "Nyomasproba es vakuumozas, majd beuzemeles es mukodesi teszt.",
    "Betanitas, szurotisztitas ismertetese es rendrakas a vegen.",
  ];
  const qPara = paragraph(quality, left + 18, 463, { size: 10.5, bullet: true, leading: 22 });
  ops2.push(qPara.ops);

  ops2.push(rect(left, 205, width, 78, "#fff8dc"));
  ops2.push(text("Belso szamlazasi bontas", left + 14, 255, 11.5, "F2", "#334155"));
  ops2.push(text(`Adorjan Alin E.V. - klimatelesitesi munkadij: ${money(installerAmount)}`, left + 14, 235, 10.5, "F1", "#334155"));
  ops2.push(text(`AMOVA 4U Kft. - klimaberendezes + szerelesi anyagok: ${money(materialAmount)}`, left + 14, 218, 10.5, "F1", "#334155"));
  ops2.push(text("Ez a bontas az ugyfel altal fizetendo vegosszeget nem modositja.", left + 14, 198, 10, "F1", "#64748b"));

  ops2.push(text("Udvozlettel,", left, 150, 11, "F1", "#64748b"));
  ops2.push(text("Adorjan Alin - KLIMAlin", left, 132, 12, "F2", "#050816"));
  ops2.push(text("klimalin.hu - legkondikalkulator.hu - 06 30 700 4908", left, 115, 10.5, "F1", "#64748b"));

  return pdfDocument([ops1.join("\n"), ops2.join("\n")]);
}

function quoteEmailHtml(customer: QuoteCustomer, items: QuoteItem[], totalAmount: number) {
  const htmlItems = items
    .map((item) => `<li><strong>${Number(item.quantity || 1)} db ${safeText(item.name)}</strong> – ${ft(Number(item.totalPrice || 0))} <span style="color:#64748b">(telepítéssel együtt)</span></li>`)
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden">
        <div style="padding:24px 28px;background:#050816;color:white">
          <div style="font-size:13px;color:#67e8f9;margin-bottom:6px">KLIMAlin ajánlat</div>
          <h1 style="margin:0;font-size:24px">Klímaajánlat alapszereléssel együtt</h1>
        </div>
        <div style="padding:26px 28px">
          <p>Tisztelt ${safeText(customer.name) || "Ügyfelünk"}!</p>
          <p>A telefonos / online egyeztetés alapján mellékletben küldjük a klímás ajánlatot PDF formátumban.</p>
          <div style="background:#f1f5f9;border-radius:14px;padding:16px;margin:18px 0">
            <p style="margin:0 0 8px 0;color:#64748b">Ajánlatban szereplő tételek</p>
            <ul style="margin:0;padding-left:20px">${htmlItems}</ul>
          </div>
          <p style="font-size:18px"><strong>Bruttó végösszeg alapszereléssel együtt: ${ft(totalAmount)}</strong></p>
          <p>Az ár alapszereléssel együtt értendő. Az ajánlat 7 napig érvényes.</p>
          <p style="color:#64748b">Amennyiben megfelel Önnek az ajánlat, válasz emailben vagy telefonon tudunk időpontot egyeztetni.</p>
          <p>Üdvözlettel:<br/><strong>Adorján Alin · KLIMAlin</strong><br/>06 30 700 4908<br/>klimalin.hu</p>
        </div>
      </div>
    </div>
  `;
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

    const pdf = createQuotePdf(customer, items, totalAmount, installerAmount, materialAmount);

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
        html: quoteEmailHtml(customer, items, totalAmount),
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
