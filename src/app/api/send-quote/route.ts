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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function uniqueEmailRef(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function customerLine(value?: string) {
  const text = escapeHtml(value);
  return text ? `<div style="margin:3px 0;line-height:1.45">${text}</div>` : "";
}

function itemRows(items: QuoteItem[], totalAmount: number) {
  const fallback = items.length
    ? items
    : [{ name: "Klímaberendezés", quantity: 1, totalPrice: totalAmount }];

  return fallback
    .map((item) => {
      const qty = Number(item.quantity || 1);
      const name = escapeHtml(item.name || "Klímaberendezés");
      const price = Number(item.totalPrice || item.unitPrice || 0);
      return `
        <div style="border:1px solid #e5e7eb;border-radius:18px;padding:16px 18px;margin:12px 0;background:#ffffff">
          <div style="font-size:17px;line-height:1.35;font-weight:800;color:#020617">${qty} db · ${name}</div>
          <div style="margin-top:5px;font-size:14px;color:#64748b">${ft(price)} <span style="white-space:nowrap">(szereléssel együtt)</span></div>
          <div style="margin-top:12px;font-size:18px;font-weight:900;color:#020617">${ft(price)}</div>
        </div>
      `;
    })
    .join("");
}

function quoteEmailHtml(customer: QuoteCustomer, items: QuoteItem[], totalAmount: number, installerAmount: number, materialAmount: number) {
  const customerName = escapeHtml(customer.name || "Ügyfelünk");
  const address = customerLine(fullAddress(customer.city, customer.address, "nincs megadva"));
  const email = customerLine(customer.email);
  const phone = customerLine(customer.phone);

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
        .title { font-size: 26px !important; line-height: 1.1 !important; }
        .total-row { display: block !important; }
        .total-row span { display: block !important; margin-top: 8px !important; text-align: left !important; }
      }
    </style>
  </head>
  <body style="margin:0;background:#f6f7fb;padding:0;font-family:Arial,Helvetica,sans-serif;color:#020617">
    <div class="outer" style="background:#f6f7fb;padding:28px 14px">
      <div class="card" style="max-width:720px;width:100%;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 18px 45px rgba(15,23,42,.10)">
        <div class="section" style="padding:30px 32px 22px 32px;background:#ffffff;border-bottom:1px solid #e5e7eb">
          <div style="font-size:14px;font-weight:800;color:#0891b2;margin-bottom:8px">KLIMAlin</div>
          <h1 class="title" style="margin:0;font-size:32px;line-height:1.15;color:#020617;font-weight:900">KLIMAlin árajánlat</h1>
          <p style="margin:10px 0 0 0;color:#64748b;font-size:15px;line-height:1.5">Klímaberendezés alapszereléssel együtt</p>
          <div style="margin-top:24px;color:#64748b;font-size:15px;line-height:1.55">
            <div><strong>Ajánlat érvényessége:</strong> 7 nap</div>
            <div><strong>Kapcsolat:</strong> 06 30 700 4908</div>
            <div>klimalin.hu</div>
          </div>
        </div>

        <div class="section" style="padding:26px 32px">
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.6">Tisztelt ${customerName}!</p>
          <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#334155">A telefonos / online egyeztetés alapján az alábbi klímás ajánlatot küldjük. Az árak bruttó összegek, és alapszereléssel együtt értendők.</p>

          <div style="background:#f1f5f9;border-radius:20px;padding:18px 20px;margin:0 0 18px 0">
            <div style="font-size:14px;color:#64748b;margin-bottom:7px">Ügyfél</div>
            <div style="font-size:21px;font-weight:900;color:#020617;margin-bottom:8px">${customerName}</div>
            <div style="font-size:15px;color:#020617">${address}${email}${phone}</div>
          </div>

          <div style="background:#f1f5f9;border-radius:20px;padding:18px 20px;margin:0 0 20px 0">
            <div style="font-size:14px;color:#64748b;margin-bottom:7px">Ajánlat összesítő</div>
            <div style="font-size:26px;font-weight:900;color:#020617">${ft(totalAmount)}</div>
            <div style="font-size:14px;color:#64748b;margin-top:4px">Bruttó végösszeg alapszereléssel</div>
          </div>

          ${itemRows(items, totalAmount)}

          <div class="total-row" style="margin:22px 0 8px 0;background:#050816;border-radius:18px;padding:18px 20px;color:#ffffff;font-size:19px;font-weight:900;display:flex;justify-content:space-between;gap:16px">
            <div>Fizetendő bruttó végösszeg</div>
            <span style="text-align:right;white-space:nowrap">${ft(totalAmount)}</span>
          </div>
        </div>

        <div class="section" style="padding:0 32px 28px 32px">
          <div style="background:#f1f5f9;border-radius:20px;padding:20px;margin-bottom:18px">
            <h2 style="margin:0 0 14px 0;font-size:20px;line-height:1.25;color:#020617">Alapszerelés tartalma</h2>
            <ul style="margin:0;padding-left:20px;color:#111827;font-size:15px;line-height:1.75">
              <li>max. 3 m szigetelt rézcső-pár / klíma</li>
              <li>1 db faláttörés, tömítés és esztétikus lezárás</li>
              <li>kondenzvíz elvezetés kialakítása gravitációsan, megfelelő lejtéssel, adottság szerint</li>
              <li>kültéri fali konzol vastag rezgéscsillapítókkal, max. 4 m szerelési magasságig, létraállással</li>
              <li>kábelcsatorna és rögzítők a szükséges mértékben</li>
              <li>betáp kábel max. 5 m-ig</li>
              <li>nyomáspróba + vákuumozás + beüzemelés, működési teszt</li>
              <li>felhasználói betanítás, rendrakás</li>
            </ul>
          </div>

          <div style="background:#f1f5f9;border-radius:20px;padding:20px;margin-bottom:18px">
            <h2 style="margin:0 0 14px 0;font-size:20px;line-height:1.25;color:#020617">Minőségi kivitelezés</h2>
            <ul style="margin:0;padding-left:20px;color:#111827;font-size:15px;line-height:1.75">
              <li>Alukasírozott, hőszigetelt rézcső-pár.</li>
              <li>Időjárásálló gumikábel a teljes nyomvonalon.</li>
              <li>Stabil konzol + vastag rezgéscsillapítók a kültéri egységnél.</li>
              <li>Szakszerű faláttörés, tömítés és esztétikus lezárás.</li>
              <li>Nyomáspróba + vákuumozás, majd beüzemelés és működési teszt.</li>
              <li>Betanítás, szűrőtisztítás ismertetése + rendrakás a végén.</li>
            </ul>
          </div>

          <div style="background:#fff8dc;border-radius:18px;padding:18px 20px;margin-bottom:22px;color:#334155;font-size:15px;line-height:1.55">
            <div style="font-weight:900;margin-bottom:8px">Belső számlázási bontás</div>
            <div>Adorján Alin E.V. – klímatelepítési munkadíj: ${ft(installerAmount)}</div>
            <div>AMOVA 4U Kft. – klímaberendezés + szerelési anyagok: ${ft(materialAmount)}</div>
            <div style="margin-top:8px;color:#64748b">Ez a bontás az ügyfél által fizetendő végösszeget nem módosítja.</div>
          </div>

          <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#334155">Amennyiben megfelel Önnek az ajánlat, válasz emailben vagy telefonon tudunk időpontot egyeztetni.</p>
          <p style="margin:18px 0 0 0;font-size:15px;line-height:1.6;color:#334155">Üdvözlettel,<br><strong style="color:#020617">Adorján Alin · KLIMAlin</strong><br>klimalin.hu · legkondikalkulator.hu · 06 30 700 4908</p>
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
    const customer: QuoteCustomer = body.customer || {};
    const items: QuoteItem[] = Array.isArray(body.items) ? body.items : [];
    const totalAmount = Number(body.totalAmount || 0);
    const installerAmount = Number(body.installerAmount || 0);
    const materialAmount = Number(body.materialAmount || 0);
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
        subject: "Klíma ajánlat – KLIMAlin",
        headers: {
          "X-Entity-Ref-ID": uniqueEmailRef("klimalin-quote"),
        },
        html: quoteEmailHtml(customer, items, totalAmount, installerAmount, materialAmount),
      }),
    });

    const result = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) return Response.json({ error: result?.message || "A Resend nem tudta elküldeni az emailt." }, { status: resendResponse.status });

    return Response.json({ ok: true, id: result?.id });
  } catch (error: any) {
    return Response.json({ error: error?.message || "Ismeretlen email küldési hiba." }, { status: 500 });
  }
}
