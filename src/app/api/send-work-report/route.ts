export const runtime = "nodejs";

type Customer = {
  name?: string;
  city?: string;
  phone?: string;
  email?: string;
  address?: string;
  date?: string;
  time?: string;
};

type QuoteItem = {
  name?: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
};

type WorkReport = {
  workDescription?: string;
  notes?: string;
  signatureDataUrl?: string;
  signerName?: string;
  signedAt?: string;
};

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function fullAddress(cityValue?: string, addressValue?: string, fallback = "nincs megadva") {
  const city = safeText(cityValue);
  const address = safeText(addressValue);
  if (city && address) {
    return address.toLowerCase().includes(city.toLowerCase()) ? address : `${city}, ${address}`;
  }
  return address || city || fallback;
}

function escapeHtml(value: unknown) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: unknown) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function ft(value?: number) {
  return Number(value || 0).toLocaleString("hu-HU") + " Ft";
}

function formatDate(value?: string) {
  if (!value) return "egyeztetett időpont";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

function formatDateTime(value?: string) {
  if (!value) return "nincs megadva";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function signatureBase64(dataUrl?: string) {
  const value = safeText(dataUrl);
  const match = value.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  return match?.[2] || "";
}


const SELLER_COMPANY = {
  name: "AMOVA 4U Kft.",
  taxNumber: "29253630-2-13",
  representative: "Adorján Mirjam",
};

function formatKelt(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString("hu-HU");
  return date.toLocaleDateString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\s/g, "");
}

function dottedValue(value: unknown) {
  const text = escapeHtml(value);
  return `<span style="display:inline-block;min-width:180px;max-width:420px;border-bottom:1px dotted #111;padding:0 3px 1px 3px;font-weight:700;vertical-align:bottom">${text || "&nbsp;"}</span>`;
}

function declarationItemsRows(items: QuoteItem[]) {
  const rows = items.length ? items : [{ name: "Klímaberendezés", quantity: 1 }];
  return rows.map((item) => {
    const quantity = Number(item.quantity || 1);
    const name = escapeHtml(item.name || "Klímaberendezés");
    return `<tr>
      <td style="border:1px solid #111;padding:3px 5px;font-size:9.7px;line-height:1.1">${name}</td>
      <td style="border:1px solid #111;padding:3px 5px;text-align:center;font-size:9.7px;font-weight:700">${quantity}</td>
    </tr>`;
  }).join("");
}

function purchaseDeclarationHtml(customer: Customer, items: QuoteItem[], report: WorkReport) {
  const customerName = customer.name || report.signerName || "";
  const customerAddress = fullAddress(customer.city, customer.address, "");
  const kelt = formatKelt(report.signedAt);
  const hasSignature = Boolean(signatureBase64(report.signatureDataUrl));

  return `<div class="purchase-page" style="max-width:700px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #d1d5db;border-radius:10px;padding:12px 14px 10px 14px;font-family:'Times New Roman',Times,serif;color:#111827;page-break-before:always;break-before:page;page-break-inside:avoid;break-inside:avoid;box-sizing:border-box">
    <h2 style="margin:0;text-align:center;font-size:16px;line-height:1;font-weight:900;letter-spacing:.02em">VÁSÁRLÁSI<br>NYILATKOZAT</h2>
    <p style="margin:3px 0 8px 0;text-align:center;font-size:9px;line-height:1.15;font-weight:700">a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet<br>28. § (5) bekezdése alapján</p>

    <p style="margin:0 0 4px 0;font-size:11px;font-weight:900">Az értékesítő vállalkozás adatai:</p>
    <div style="margin-left:12px;margin-bottom:6px;font-size:10.5px;line-height:1.25">
      neve: ${dottedValue(SELLER_COMPANY.name)}<br>
      adószáma: ${dottedValue(SELLER_COMPANY.taxNumber)}<br>
      a képviseletében eljáró természetes személy neve: ${dottedValue(SELLER_COMPANY.representative)}
    </div>

    <p style="margin:0 0 4px 0;font-size:11px;font-weight:900">A telepíttető adatai:</p>
    <div style="margin-left:12px;margin-bottom:5px;font-size:10.5px;line-height:1.25">
      <strong>A.) Vállalkozás, intézmény, egyéb adószámmal rendelkező szervezet</strong><br>
      neve: <span style="display:inline-block;min-width:220px;border-bottom:1px dotted #111">&nbsp;</span><br>
      adószáma: <span style="display:inline-block;min-width:212px;border-bottom:1px dotted #111">&nbsp;</span><br>
      a képviseletében eljáró természetes személy neve: <span style="display:inline-block;min-width:130px;border-bottom:1px dotted #111">&nbsp;</span>
    </div>
    <div style="margin-left:12px;margin-bottom:6px;font-size:10.5px;line-height:1.25">
      <strong>B.) Természetes személy</strong><br>
      neve: ${dottedValue(customerName)}<br>
      lakcíme: ${dottedValue(customerAddress)}
    </div>

    <p style="margin:0 0 6px 0;font-size:9.8px;line-height:1.12;text-align:justify">Telepíttető – megfelelve az Európai Parlament és a Tanács 2024/573 Rendeletében, valamint a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. §-ban foglaltaknak – jelen nyilatkozat aláírásával kötelezettséget vállal arra, hogy az alábbi telepítési tanúsítvány-köteles berendezés(ek) telepítését és beüzemelését az arra képesítéssel rendelkező vállalkozás képesített alkalmazottjával fogja elvégeztetni.</p>

    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:4px 0 4px 0">
      <thead>
        <tr>
          <th style="border:1px solid #111;padding:4px 6px;text-align:center;font-size:10px;font-weight:900">Termék megnevezése</th>
          <th style="border:1px solid #111;padding:4px 6px;text-align:center;font-size:10px;font-weight:900;width:34%">Megvásárolt termékek darabszáma</th>
        </tr>
      </thead>
      <tbody>${declarationItemsRows(items)}</tbody>
    </table>
    <p style="margin:0 0 5px 0;font-size:8.8px;line-height:1.1">*Több berendezés típus vásárlása esetén a táblázat sorainak száma bővíthető egyéni szerkesztéssel</p>

    <p style="margin:0 0 5px 0;font-size:9.8px;line-height:1.12;text-align:justify">Telepíttető tudomásul veszi, hogy a telepítési tanúsítvány-köteles berendezéssel kapcsolatos jótállás telepítési tanúsítvány<sup>1</sup> birtokában érvényesíthető.</p>
    <p style="margin:0 0 6px 0;font-size:9.8px;line-height:1.12;text-align:justify;font-weight:700">Nyilatkozata megtételével egyidejűleg hozzájárul, hogy fentiekben megadott adatait a forgalmazó megismerje, kezelje, nyilvántartsa.</p>

    <div style="display:flex;gap:10px;align-items:flex-end;justify-content:space-between;margin-top:4px">
      <div style="font-size:10.5px;white-space:nowrap">Kelt: ${dottedValue(kelt)}</div>
      <div style="width:210px;text-align:center">
        ${hasSignature ? `<img src="cid:ugyfel-alairas" alt="Telepíttető aláírása" style="display:block;width:100%;max-width:150px;height:auto;max-height:54px;margin:0 auto 1px auto;background:#ffffff" />` : `<div style="height:28px">&nbsp;</div>`}
        <div style="border-top:1px solid #111;padding-top:1px;font-style:italic;font-size:10.5px">Telepíttető</div>
      </div>
    </div>

    <div style="border-top:1px solid #111;margin-top:7px;padding-top:3px;font-size:8px;line-height:1.08"><sup>1</sup> A klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. § (7)-(10) bekezdései alapján</div>
  </div>`;
}

function uniqueEmailRef(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function itemsHtml(items: QuoteItem[]) {
  if (!items.length) {
    return `<div style="padding:14px 0;border-bottom:1px solid #e5e7eb"><strong>Klímatelepítés</strong><br><span style="color:#64748b">Szereléssel együtt, egyeztetés szerint.</span></div>`;
  }

  return items.map((item) => {
    const quantity = Number(item.quantity || 1);
    const name = escapeHtml(item.name || "Klímaberendezés");
    const total = Number(item.totalPrice || 0);
    return `<div style="padding:14px 0;border-bottom:1px solid #e5e7eb">
      <div style="font-size:16px;font-weight:900;color:#020617">${quantity} db · ${name}</div>
      <div style="margin-top:4px;color:#64748b;font-size:14px">Szereléssel együtt</div>
      ${total ? `<div style="margin-top:5px;font-size:15px;font-weight:900;color:#020617">${ft(total)}</div>` : ""}
    </div>`;
  }).join("");
}

function workReportEmailHtml(customer: Customer, items: QuoteItem[], report: WorkReport) {
  const name = escapeHtml(customer.name || "Ügyfelünk");
  const rawName = customer.name || report.signerName || "";
  const address = escapeHtml(fullAddress(customer.city, customer.address, "nincs megadva"));
  const phone = escapeHtml(customer.phone || "");
  const email = escapeHtml(customer.email || "");
  const date = escapeHtml(formatDate(customer.date));
  const time = escapeHtml(customer.time || "egyeztetés szerint");
  const workDescription = escapeHtml(report.workDescription || "Klímaberendezés telepítése, beüzemelése és átadása. Vákuumozás, működési próba és felhasználói betanítás elvégezve.").replace(/\n/g, "<br>");
  const notes = escapeHtml(report.notes || "").replace(/\n/g, "<br>");
  const signer = escapeHtml(report.signerName || customer.name || "");
  const signedAt = escapeHtml(formatDateTime(report.signedAt));
  const hasSignature = Boolean(signatureBase64(report.signatureDataUrl));
  const signatureCid = "ugyfel-alairas";
  const rows = items.length ? items : [{ name: "Klímaberendezés", quantity: 1 }];
  const deviceRows = rows.map((item) => {
    const quantity = Number(item.quantity || 1);
    const itemName = escapeHtml(item.name || "Klímaberendezés");
    return `<tr>
      <td style="border:1px solid #111;padding:5px 7px;font-size:9.7px;line-height:1.1">${itemName}</td>
      <td style="border:1px solid #111;padding:5px 7px;text-align:center;font-size:9.7px;font-weight:700;width:90px">${quantity}</td>
      <td style="border:1px solid #111;padding:5px 7px;font-size:9.7px;line-height:1.1;width:145px">szereléssel együtt</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="hu">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @media only screen and (max-width: 600px) {
        .outer { padding: 10px !important; }
        .document { padding: 12px !important; border-radius: 12px !important; }
        .doc-title { font-size: 18px !important; }
        .sign-row { display: block !important; }
        .sign-box { width: 100% !important; margin-top: 12px !important; }
      }
      @media print {
        @page { size: A4; margin: 8mm; }
        body { background: #ffffff !important; margin: 0 !important; }
        .outer { background: #ffffff !important; padding: 0 !important; }
        .document { margin: 0 auto !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; max-width: 185mm !important; width: 185mm !important; }
        .work-page { page-break-after: always !important; break-after: page !important; page-break-inside: avoid !important; break-inside: avoid !important; }
        .purchase-page { page-break-before: always !important; break-before: page !important; page-break-inside: avoid !important; break-inside: avoid !important; margin: 0 auto !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; max-width: 185mm !important; width: 185mm !important; }
        .document *, .purchase-page * { box-sizing: border-box !important; }
      }
    </style>
  </head>
  <body style="margin:0;background:#f6f7fb;padding:0;color:#111827">
    <div class="outer" style="background:#f6f7fb;padding:24px 12px">
      <div class="document work-page" style="max-width:700px;width:100%;margin:0 auto 18px auto;background:#ffffff;border:1px solid #d1d5db;border-radius:10px;padding:12px 14px 10px 14px;font-family:'Times New Roman',Times,serif;color:#111827;page-break-inside:avoid;break-inside:avoid;box-sizing:border-box">
        <h1 class="doc-title" style="margin:0;text-align:center;font-size:17px;line-height:1;font-weight:900;letter-spacing:.02em">KLÍMASZERELÉSI<br>MUNKALAP</h1>
        <p style="margin:5px 0 10px 0;text-align:center;font-size:9px;line-height:1.1;font-weight:700">az elvégzett klímaszerelési munka és átadás-átvétel visszaigazolására</p>

        <p style="margin:0 0 5px 0;font-size:11px;font-weight:900">Ügyfél adatai:</p>
        <div style="margin-left:14px;margin-bottom:8px;font-size:10.5px;line-height:1.25">
          neve: ${dottedValue(rawName)}<br>
          címe: ${dottedValue(fullAddress(customer.city, customer.address, ""))}<br>
          telefonszáma: ${dottedValue(customer.phone || "")}<br>
          email címe: ${dottedValue(customer.email || "")}
        </div>

        <p style="margin:0 0 5px 0;font-size:11px;font-weight:900">Szerelés adatai:</p>
        <div style="margin-left:14px;margin-bottom:8px;font-size:10.5px;line-height:1.25">
          szerelés dátuma: ${dottedValue(date)}<br>
          idősáv: ${dottedValue(time)}<br>
          helyszín: ${dottedValue(fullAddress(customer.city, customer.address, ""))}
        </div>

        <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:5px 0 6px 0">
          <thead>
            <tr>
              <th style="border:1px solid #111;padding:6px 8px;text-align:center;font-size:11.5px;font-weight:900">Készülék megnevezése</th>
              <th style="border:1px solid #111;padding:6px 8px;text-align:center;font-size:11.5px;font-weight:900;width:90px">Darab</th>
              <th style="border:1px solid #111;padding:6px 8px;text-align:center;font-size:11.5px;font-weight:900;width:145px">Megjegyzés</th>
            </tr>
          </thead>
          <tbody>${deviceRows}</tbody>
        </table>

        <p style="margin:0 0 5px 0;font-size:11px;font-weight:900">Elvégzett munka:</p>
        <div style="border:1px solid #111;padding:7px 8px;margin-bottom:8px;font-size:10px;line-height:1.12;min-height:24px;text-align:justify">${workDescription}</div>

        ${notes ? `<p style="margin:0 0 5px 0;font-size:11px;font-weight:900">Megjegyzés:</p><div style="border:1px solid #111;padding:7px 8px;margin-bottom:8px;font-size:10px;line-height:1.12;min-height:24px;text-align:justify">${notes}</div>` : ""}

        <p style="margin:0 0 7px 0;font-size:9.8px;line-height:1.12;text-align:justify">Az ügyfél a munkalap aláírásával igazolja, hogy a fenti munkát átvette, a készülék működését bemutatták, és az alapvető használati tudnivalókról tájékoztatást kapott.</p>

        <div class="sign-row" style="display:flex;gap:12px;align-items:flex-end;justify-content:space-between;margin-top:5px">
          <div style="font-size:10.5px;line-height:1.25">
            Kelt: ${dottedValue(formatKelt(report.signedAt))}<br>
            Aláíró neve: ${dottedValue(signer)}
          </div>
          <div class="sign-box" style="width:230px;text-align:center">
            ${hasSignature ? `<img src="cid:${signatureCid}" alt="Ügyfél aláírása" style="display:block;width:100%;max-width:150px;max-height:54px;height:auto;margin:0 auto 1px auto;background:#ffffff" />` : `<div style="height:26px">&nbsp;</div>`}
            <div style="border-top:1px solid #111;padding-top:2px;font-style:italic;font-size:10.5px">Ügyfél aláírása</div>
          </div>
        </div>

        <div style="border-top:1px solid #111;margin-top:7px;padding-top:3px;font-size:8.8px;line-height:1.1">
          Üdvözlettel,<br><strong>Adorján Alin · KLIMAlin</strong><br>klimalin.hu · legkondikalkulator.hu · 06 30 700 4908
        </div>
      </div>

      ${purchaseDeclarationHtml(customer, items, report)}
    </div>
  </body>
</html>`;
}
export async function POST(request: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM || "KLIMAlin <info@alinflow.hu>";
    const replyTo = process.env.EMAIL_REPLY_TO || "klima.alin@gmail.com";

    if (!apiKey) return Response.json({ error: "Hiányzik a RESEND_API_KEY környezeti változó." }, { status: 500 });

    const body = await request.json();
    const customer: Customer = body.customer || {};
    const items: QuoteItem[] = Array.isArray(body.items) ? body.items : [];
    const report: WorkReport = body.report || {};
    const to = safeText(customer.email);

    if (!to) return Response.json({ error: "Hiányzik az ügyfél email címe." }, { status: 400 });

    const sigBase64 = signatureBase64(report.signatureDataUrl);
    const attachments = sigBase64
      ? [{ filename: "ugyfel-alairas.png", content: sigBase64, content_type: "image/png", content_id: "ugyfel-alairas" }]
      : undefined;

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
        subject: "Klímaszerelési munkalap és vásárlási nyilatkozat – KLIMAlin",
        headers: {
          "X-Entity-Ref-ID": uniqueEmailRef("klimalin-work-report"),
        },
        html: workReportEmailHtml(customer, items, report),
        attachments,
      }),
    });

    const result = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) return Response.json({ error: result?.message || "A Resend nem tudta elküldeni az emailt." }, { status: resendResponse.status });

    return Response.json({ ok: true, id: result?.id });
  } catch (error: any) {
    return Response.json({ error: error?.message || "Ismeretlen munkalap email küldési hiba." }, { status: 500 });
  }
}
