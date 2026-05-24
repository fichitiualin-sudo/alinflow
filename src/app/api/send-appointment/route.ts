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
  totalPrice?: number;
};

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function escapeHtml(value: unknown) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function uniqueEmailRef(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDate(value?: string) {
  if (!value) return "egyeztetett időpont";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

function itemLines(items: QuoteItem[]) {
  if (!items.length) {
    return `<li style="margin:8px 0">Klímatelepítés / felmérés <span style="color:#64748b">– szereléssel együtt egyeztetett munka</span></li>`;
  }

  return items
    .map((item) => `<li style="margin:8px 0"><strong>${Number(item.quantity || 1)} db ${escapeHtml(item.name || "Klímaberendezés")}</strong> <span style="color:#64748b">– szereléssel együtt</span></li>`)
    .join("");
}

function appointmentEmailHtml(customer: Customer, items: QuoteItem[]) {
  const name = escapeHtml(customer.name || "Ügyfelünk");
  const date = escapeHtml(formatDate(customer.date));
  const time = escapeHtml(customer.time || "egyeztetés szerint");
  const address = escapeHtml(customer.address || customer.city || "egyeztetés szerint");
  const phone = escapeHtml(customer.phone || "");

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
      <div class="card" style="max-width:680px;width:100%;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 18px 45px rgba(15,23,42,.10)">
        <div class="section" style="padding:30px 32px 22px 32px;background:#050816;color:#ffffff">
          <div style="font-size:14px;font-weight:800;color:#67e8f9;margin-bottom:8px">KLIMAlin időpont visszaigazolás</div>
          <h1 class="title" style="margin:0;font-size:30px;line-height:1.15;font-weight:900">Sikeres időpont-egyeztetés</h1>
          <p style="margin:12px 0 0 0;color:#cbd5e1;font-size:15px;line-height:1.55">Köszönjük a bizalmat, az alábbi időpontot rögzítettük.</p>
        </div>

        <div class="section" style="padding:26px 32px">
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.6">Tisztelt ${name}!</p>
          <p style="margin:0 0 20px 0;font-size:16px;line-height:1.6;color:#334155">Ezúton visszaigazoljuk az egyeztetett klímás időpontot és a szereléssel együtt értendő klíma telepítését.</p>

          <div style="background:#f1f5f9;border-radius:20px;padding:18px 20px;margin-bottom:18px">
            <div class="info-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="info-cell">
                <div style="font-size:13px;color:#64748b;margin-bottom:5px">Időpont</div>
                <div style="font-size:17px;font-weight:900;color:#020617;line-height:1.35">${date}</div>
                <div style="margin-top:4px;font-size:15px;color:#334155">${time}</div>
              </div>
              <div class="info-cell">
                <div style="font-size:13px;color:#64748b;margin-bottom:5px">Helyszín</div>
                <div style="font-size:17px;font-weight:900;color:#020617;line-height:1.35">${address}</div>
                ${phone ? `<div style="margin-top:4px;font-size:15px;color:#334155">${phone}</div>` : ""}
              </div>
            </div>
          </div>

          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:18px 20px;margin-bottom:18px">
            <div style="font-size:14px;color:#64748b;margin-bottom:8px">Érintett készülék / munka</div>
            <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.6;color:#111827">
              ${itemLines(items)}
            </ul>
          </div>

          <div style="background:#fff8dc;border-radius:18px;padding:18px 20px;margin-bottom:20px;color:#334155;font-size:15px;line-height:1.6">
            <strong style="color:#020617">Fontos tudnivalók</strong>
            <ul style="margin:10px 0 0 0;padding-left:20px">
              <li>Kérjük, az időpont előtt legyen hozzáférhető a beltéri és kültéri egység tervezett helye.</li>
              <li>Az ajánlatban szereplő klíma szereléssel együtt értendő, az előzetesen egyeztetett feltételek szerint.</li>
              <li>Amennyiben bármi változna, kérjük, jelezze válasz emailben vagy telefonon.</li>
            </ul>
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
    const to = safeText(customer.email);

    if (!to) return Response.json({ error: "Hiányzik az ügyfél email címe." }, { status: 400 });

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
        subject: "Időpont visszaigazolás – KLIMAlin",
        headers: {
          "X-Entity-Ref-ID": uniqueEmailRef("klimalin-appointment"),
        },
        html: appointmentEmailHtml(customer, items),
      }),
    });

    const result = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) return Response.json({ error: result?.message || "A Resend nem tudta elküldeni az emailt." }, { status: resendResponse.status });

    return Response.json({ ok: true, id: result?.id });
  } catch (error: any) {
    return Response.json({ error: error?.message || "Ismeretlen email küldési hiba." }, { status: 500 });
  }
}
