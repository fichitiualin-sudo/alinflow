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
  return `<span style="display:inline-block;min-width:280px;border-bottom:1px dotted #111;padding:0 4px 2px 4px;font-weight:700">${text || "&nbsp;"}</span>`;
}

function declarationItemsRows(items: QuoteItem[]) {
  const rows = items.length ? items : [{ name: "Klímaberendezés", quantity: 1 }];
  return rows.map((item) => {
    const quantity = Number(item.quantity || 1);
    const name = escapeHtml(item.name || "Klímaberendezés");
    return `<tr>
      <td style="border:1px solid #111;padding:10px 12px;font-size:14px;line-height:1.35">${name}</td>
      <td style="border:1px solid #111;padding:10px 12px;text-align:center;font-size:14px;font-weight:700">${quantity}</td>
    </tr>`;
  }).join("");
}

function purchaseDeclarationHtml(customer: Customer, items: QuoteItem[], report: WorkReport) {
  const customerName = customer.name || report.signerName || "";
  const customerAddress = fullAddress(customer.city, customer.address, "");
  const kelt = formatKelt(report.signedAt);
  const hasSignature = Boolean(signatureBase64(report.signatureDataUrl));

  return `<div style="margin-top:28px;background:#ffffff;border:1px solid #d1d5db;border-radius:18px;padding:24px 20px;font-family:'Times New Roman',Times,serif;color:#111827">
    <h2 style="margin:0;text-align:center;font-size:22px;line-height:1.05;font-weight:900;letter-spacing:.02em">VÁSÁRLÁSI<br>NYILATKOZAT</h2>
    <p style="margin:6px 0 18px 0;text-align:center;font-size:13px;line-height:1.35;font-weight:700">a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet<br>28. § (5) bekezdése alapján</p>

    <p style="margin:0 0 10px 0;font-size:15px;font-weight:900">Az értékesítő vállalkozás adatai:</p>
    <div style="margin-left:22px;margin-bottom:18px;font-size:15px;line-height:1.8">
      neve: ${dottedValue(SELLER_COMPANY.name)}<br>
      adószáma: ${dottedValue(SELLER_COMPANY.taxNumber)}<br>
      a képviseletében eljáró természetes személy neve: ${dottedValue(SELLER_COMPANY.representative)}
    </div>

    <p style="margin:0 0 10px 0;font-size:15px;font-weight:900">A telepíttető adatai:</p>
    <div style="margin-left:22px;margin-bottom:12px;font-size:15px;line-height:1.8">
      <strong>A.) Vállalkozás, intézmény, egyéb adószámmal rendelkező szervezet</strong><br>
      neve: <span style="display:inline-block;min-width:280px;border-bottom:1px dotted #111">&nbsp;</span><br>
      adószáma: <span style="display:inline-block;min-width:270px;border-bottom:1px dotted #111">&nbsp;</span><br>
      a képviseletében eljáró természetes személy neve: <span style="display:inline-block;min-width:170px;border-bottom:1px dotted #111">&nbsp;</span>
    </div>
    <div style="margin-left:22px;margin-bottom:18px;font-size:15px;line-height:1.8">
      <strong>B.) Természetes személy</strong><br>
      neve: ${dottedValue(customerName)}<br>
      lakcíme: ${dottedValue(customerAddress)}
    </div>

    <p style="margin:0 0 14px 0;font-size:14px;line-height:1.38;text-align:justify">Telepíttető – megfelelve az Európai Parlament és a Tanács 2024/573 Rendeletében, valamint a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. §-ban foglaltaknak – jelen nyilatkozat aláírásával kötelezettséget vállal arra, hogy az alábbi telepítési tanúsítvány-köteles berendezés(ek) telepítését és beüzemelését az arra képesítéssel rendelkező vállalkozás képesített alkalmazottjával fogja elvégeztetni.</p>

    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:10px 0 8px 0">
      <thead>
        <tr>
          <th style="border:1px solid #111;padding:12px 10px;text-align:center;font-size:14px;font-weight:900">Termék megnevezése</th>
          <th style="border:1px solid #111;padding:12px 10px;text-align:center;font-size:14px;font-weight:900;width:34%">Megvásárolt termékek darabszáma</th>
        </tr>
      </thead>
      <tbody>${declarationItemsRows(items)}</tbody>
    </table>
    <p style="margin:0 0 14px 0;font-size:13px;line-height:1.35">*Több berendezés típus vásárlása esetén a táblázat sorainak száma bővíthető egyéni szerkesztéssel</p>

    <p style="margin:0 0 14px 0;font-size:14px;line-height:1.4;text-align:justify">Telepíttető tudomásul veszi, hogy a telepítési tanúsítvány-köteles berendezéssel kapcsolatos jótállás telepítési tanúsítvány<sup>1</sup> birtokában érvényesíthető.</p>
    <p style="margin:0 0 18px 0;font-size:14px;line-height:1.4;text-align:justify;font-weight:700">Nyilatkozata megtételével egyidejűleg hozzájárul, hogy fentiekben megadott adatait a forgalmazó megismerje, kezelje, nyilvántartsa.</p>

    <div style="display:flex;gap:18px;align-items:flex-end;justify-content:space-between;margin-top:16px">
      <div style="font-size:15px;white-space:nowrap">Kelt: ${dottedValue(kelt)}</div>
      <div style="width:300px;text-align:center">
        ${hasSignature ? `<img src="cid:ugyfel-alairas" alt="Telepíttető aláírása" style="display:block;width:100%;max-width:260px;height:auto;margin:0 auto 4px auto;background:#ffffff" />` : `<div style="height:46px">&nbsp;</div>`}
        <div style="border-top:1px solid #111;padding-top:4px;font-style:italic;font-size:15px">Telepíttető</div>
      </div>
    </div>

    <div style="border-top:1px solid #111;margin-top:20px;padding-top:6px;font-size:11px;line-height:1.3"><sup>1</sup> A klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. § (7)-(10) bekezdései alapján</div>
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
      ${total ? `<div style="margin-top:8px;font-size:15px;font-weight:900;color:#020617">${ft(total)}</div>` : ""}
    </div>`;
  }).join("");
}

function workReportEmailHtml(customer: Customer, items: QuoteItem[], report: WorkReport) {
  const name = escapeHtml(customer.name || "Ügyfelünk");
  const address = escapeHtml(fullAddress(customer.city, customer.address, "nincs megadva"));
  const phone = escapeHtml(customer.phone || "");
  const date = escapeHtml(formatDate(customer.date));
  const time = escapeHtml(customer.time || "egyeztetés szerint");
  const workDescription = escapeHtml(report.workDescription || "Klímaberendezés telepítése, beüzemelése és átadása.").replace(/\n/g, "<br>");
  const notes = escapeHtml(report.notes || "").replace(/\n/g, "<br>");
  const signer = escapeHtml(report.signerName || customer.name || "");
  const signedAt = escapeHtml(formatDateTime(report.signedAt));
  const hasSignature = Boolean(signatureBase64(report.signatureDataUrl));
  const signatureCid = "ugyfel-alairas";

  return `<!doctype html>
<html lang="hu">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @media only screen and (max-width: 600px) {
        .outer { padding: 12px !important; }
        .card { border-radius: 18px !important; }
        .section { padding: 18px !important; }
        .title { font-size: 25px !important; line-height: 1.15 !important; }
        .info-grid { display: block !important; }
        .info-cell { margin-bottom: 12px !important; }
      }
    </style>
  </head>
  <body style="margin:0;background:#f6f7fb;padding:0;font-family:Arial,Helvetica,sans-serif;color:#020617">
    <div class="outer" style="background:#f6f7fb;padding:28px 14px">
      <div class="card" style="max-width:720px;width:100%;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 18px 45px rgba(15,23,42,.10)">
        <div class="section" style="padding:30px 32px 22px 32px;background:#050816;color:#ffffff">
          <div style="font-size:14px;font-weight:800;color:#67e8f9;margin-bottom:8px">KLIMAlin munkalap</div>
          <h1 class="title" style="margin:0;font-size:30px;line-height:1.15;font-weight:900">Klímaszerelési munkalap</h1>
          <p style="margin:12px 0 0 0;color:#cbd5e1;font-size:15px;line-height:1.55">A munkalap az elvégzett klímás munka visszaigazolása.</p>
        </div>

        <div class="section" style="padding:26px 32px">
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.6">Tisztelt ${name}!</p>
          <p style="margin:0 0 20px 0;font-size:16px;line-height:1.6;color:#334155">Ezúton küldjük a rögzített klímaszerelési munkalapot. A dokumentum tartalmazza az elvégzett munkát, a szereléssel együtt értendő készüléket és az egyszerű ügyfél-aláírást.</p>

          <div style="background:#f1f5f9;border-radius:20px;padding:18px 20px;margin-bottom:18px">
            <div class="info-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="info-cell">
                <div style="font-size:13px;color:#64748b;margin-bottom:5px">Ügyfél</div>
                <div style="font-size:17px;font-weight:900;color:#020617;line-height:1.35">${name}</div>
                ${phone ? `<div style="margin-top:4px;font-size:15px;color:#334155">${phone}</div>` : ""}
              </div>
              <div class="info-cell">
                <div style="font-size:13px;color:#64748b;margin-bottom:5px">Helyszín</div>
                <div style="font-size:17px;font-weight:900;color:#020617;line-height:1.35">${address}</div>
              </div>
            </div>
          </div>

          <div style="background:#f8fafc;border-radius:20px;padding:18px 20px;margin-bottom:18px">
            <div class="info-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="info-cell">
                <div style="font-size:13px;color:#64748b;margin-bottom:5px">Szerelés dátuma</div>
                <div style="font-size:17px;font-weight:900;color:#020617;line-height:1.35">${date}</div>
              </div>
              <div class="info-cell">
                <div style="font-size:13px;color:#64748b;margin-bottom:5px">Idősáv</div>
                <div style="font-size:17px;font-weight:900;color:#020617;line-height:1.35">${time}</div>
              </div>
            </div>
          </div>

          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:18px 20px;margin-bottom:18px">
            <div style="font-size:14px;color:#64748b;margin-bottom:8px">Készülék / munka</div>
            ${itemsHtml(items)}
          </div>

          <div style="background:#eef2ff;border-radius:18px;padding:18px 20px;margin-bottom:18px">
            <div style="font-size:14px;color:#64748b;margin-bottom:8px">Elvégzett munka</div>
            <div style="font-size:15px;line-height:1.65;color:#111827">${workDescription}</div>
          </div>

          ${notes ? `<div style="background:#fff8dc;border-radius:18px;padding:18px 20px;margin-bottom:18px"><div style="font-size:14px;color:#64748b;margin-bottom:8px">Megjegyzés</div><div style="font-size:15px;line-height:1.65;color:#111827">${notes}</div></div>` : ""}

          <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:18px;padding:18px 20px;margin-bottom:22px">
            <div style="font-size:14px;color:#64748b;margin-bottom:8px">Ügyfél egyszerű aláírása</div>
            ${hasSignature ? `<img src="cid:${signatureCid}" alt="Ügyfél aláírása" style="display:block;width:100%;max-width:420px;height:auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;margin-bottom:10px" />` : `<div style="padding:18px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;color:#64748b">Nincs rögzített aláírás.</div>`}
            <div style="font-size:14px;line-height:1.6;color:#334155"><strong>Aláíró:</strong> ${signer || "nincs megadva"}<br><strong>Aláírás ideje:</strong> ${signedAt}</div>
          </div>

          <div style="margin-top:34px;margin-bottom:18px;padding-top:10px;page-break-before:always;break-before:page">
            ${purchaseDeclarationHtml(customer, items, report)}
          </div>

          <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#334155">Üdvözlettel,<br><strong style="color:#020617">Adorján Alin · KLIMAlin</strong><br>klimalin.hu · legkondikalkulator.hu · 06 30 700 4908</p>
        </div>
      </div>
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
