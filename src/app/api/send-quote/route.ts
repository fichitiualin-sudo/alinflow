import type { WorkspaceSettings } from "@/lib/alinflow/workspace-settings";
import {
  defaultWorkspaceSettings,
  normalizeWorkspaceSettings,
  settingsBrandName,
  settingsContactLine,
  settingsFooterLines,
  settingsPrimaryContact,
} from "@/lib/alinflow/workspace-settings";

export const runtime = "nodejs";

type QuoteCustomer = {
  name?: string;
  city?: string;
  postalCode?: string;
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

type QuotePricingMode = "bundle" | "alternatives";

function ft(value: number) {
  return `${Number(value || 0).toLocaleString("hu-HU")} Ft`;
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function fullAddress(cityValue?: string, addressValue?: string, fallback = "nincs megadva", postalCodeValue?: string) {
  const postalCode = safeText(postalCodeValue);
  const city = safeText(cityValue);
  const location = [postalCode, city].filter(Boolean).join(" ");
  const address = safeText(addressValue);
  if (location && address) {
    const lowerAddress = address.toLocaleLowerCase("hu-HU");
    const lowerLocation = location.toLocaleLowerCase("hu-HU");
    const lowerCity = city.toLocaleLowerCase("hu-HU");
    return lowerAddress.includes(lowerLocation) || (city && lowerAddress.includes(lowerCity)) ? address : `${location}, ${address}`;
  }
  return address || location || fallback;
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

function footerHtml(settings: WorkspaceSettings) {
  const lines = settingsFooterLines(settings, "email");
  if (!lines.length) return "";
  const [firstLine, ...rest] = lines;
  return `Üdvözlettel,<br><strong style="color:#020617">${escapeHtml(firstLine)}</strong>${rest.length ? `<br>${rest.map(escapeHtml).join("<br>")}` : ""}`;
}

function isAlternativesPricing(mode?: string) {
  return mode === "alternatives";
}

function formatQuoteIssuedAt(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return safeText(value);
  return date.toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function itemRows(items: QuoteItem[], totalAmount: number, pricingMode: QuotePricingMode = "bundle") {
  const fallback = items.length
    ? items
    : [{ name: "Klímaberendezés", quantity: 1, totalPrice: totalAmount }];
  const quoteIsAlternatives = isAlternativesPricing(pricingMode);

  return fallback
    .map((item, index) => {
      const qty = Math.max(1, Number(item.quantity || 1));
      const name = escapeHtml(item.name || "Klímaberendezés");
      const unitPrice = Number(item.unitPrice || 0);
      const totalPrice = Number(item.totalPrice || (unitPrice * qty) || totalAmount || 0);
      const priceLine = qty > 1
        ? `${ft(unitPrice || Math.round(totalPrice / qty))} / db <span style="white-space:nowrap">(szereléssel együtt)</span>`
        : `${ft(totalPrice)} <span style="white-space:nowrap">(szereléssel együtt)</span>`;
      const optionBadge = quoteIsAlternatives
        ? `<div style="display:inline-block;background:#e0f2fe;border:1px solid #bae6fd;color:#0369a1;border-radius:999px;padding:5px 11px;margin-bottom:11px;font-size:12px;line-height:1;font-weight:900;letter-spacing:.02em">${index + 1}. lehetőség</div>`
        : "";
      return `
        <div style="border:1px solid #e5e7eb;border-radius:18px;padding:18px 20px;margin:14px 0;background:${quoteIsAlternatives ? "#f8fafc" : "#ffffff"}">
          ${optionBadge}
          <div style="font-size:18px;line-height:1.35;font-weight:900;color:#020617">${qty} db · ${name}</div>
          <div style="margin-top:7px;font-size:14px;color:#64748b;line-height:1.45">${priceLine}</div>
          <div style="margin-top:13px;padding-top:13px;border-top:1px solid #e5e7eb;font-size:19px;font-weight:900;color:#020617">${quoteIsAlternatives ? "Ajánlati ár: " : ""}${ft(totalPrice)}</div>
        </div>
      `;
    })
    .join("");
}

function quoteEmailHtml(customer: QuoteCustomer, items: QuoteItem[], totalAmount: number, installerAmount: number, materialAmount: number, pricingMode: QuotePricingMode = "bundle", quoteIssuedAt = "", workspaceSettings?: WorkspaceSettings) {
  const settings = workspaceSettings || defaultWorkspaceSettings(null);
  const quote = settings.quoteSettings;
  const company = settings.companyProfile;
  const brandName = settingsBrandName(settings);
  const quoteTitle = quote.title || `${company.displayName || brandName} árajánlat`;
  const primaryContact = settingsPrimaryContact(settings);
  const contactLine = settingsContactLine(settings);
  const customerName = escapeHtml(customer.name || "Ügyfelünk");
  const address = customerLine(fullAddress(customer.city, customer.address, "nincs megadva", customer.postalCode));
  const email = customerLine(customer.email);
  const phone = customerLine(customer.phone);
  const quoteIsAlternatives = isAlternativesPricing(pricingMode);
  const shownQuoteIssuedAt = escapeHtml(formatQuoteIssuedAt(quoteIssuedAt));

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
          <div style="font-size:14px;font-weight:800;color:#0891b2;margin-bottom:8px">${escapeHtml(brandName)}</div>
          <h1 class="title" style="margin:0;font-size:32px;line-height:1.15;color:#020617;font-weight:900">${escapeHtml(quoteTitle)}</h1>
          <p style="margin:10px 0 0 0;color:#64748b;font-size:15px;line-height:1.5">${escapeHtml(quote.subtitle)}</p>
          <div style="margin-top:24px;color:#64748b;font-size:15px;line-height:1.55">
            <div><strong>Árajánlat időpontja:</strong> ${shownQuoteIssuedAt}</div>
            <div><strong>Ajánlat érvényessége:</strong> ${escapeHtml(quote.validityDays)} nap</div>
            ${primaryContact ? `<div><strong>Kapcsolat:</strong> ${escapeHtml(primaryContact)}</div>` : ""}
            ${contactLine ? `<div>${escapeHtml(contactLine)}</div>` : ""}
          </div>
        </div>

        <div class="section" style="padding:26px 32px">
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.6">Tisztelt ${customerName}!</p>
          <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#334155">${escapeHtml(quoteIsAlternatives ? quote.alternativesIntro : quote.bundleIntro)}</p>

          <div style="background:#f1f5f9;border-radius:20px;padding:18px 20px;margin:0 0 18px 0">
            <div style="font-size:14px;color:#64748b;margin-bottom:7px">Ügyfél</div>
            <div style="font-size:21px;font-weight:900;color:#020617;margin-bottom:8px">${customerName}</div>
            <div style="font-size:15px;color:#020617">${address}${email}${phone}</div>
          </div>

          <div style="background:#f1f5f9;border-radius:20px;padding:18px 20px;margin:0 0 20px 0">
            <div style="font-size:14px;color:#64748b;margin-bottom:7px">Ajánlat összesítő</div>
            <div style="font-size:26px;font-weight:900;color:#020617">${quoteIsAlternatives ? "Választható ajánlatok" : ft(totalAmount)}</div>
            <div style="font-size:14px;color:#64748b;margin-top:4px">${quoteIsAlternatives ? "A tételek külön-külön értendők, nem összeadandóak." : "Bruttó végösszeg alapszereléssel"}</div>
          </div>

          ${itemRows(items, totalAmount, pricingMode)}


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

          ${quoteIsAlternatives ? "" : `
            <div style="background:#fff8dc;border-radius:18px;padding:18px 20px;margin-bottom:22px;color:#334155;font-size:15px;line-height:1.55">
              <div style="font-weight:900;margin-bottom:8px">Belső számlázási bontás</div>
              <div>${escapeHtml(quote.laborProviderName || "Munkadíj")} – ${escapeHtml(quote.laborDescription)}: ${ft(installerAmount)}</div>
              <div>${escapeHtml(quote.deviceProviderName || "Készülék és anyag")} – ${escapeHtml(quote.deviceDescription)}: ${ft(materialAmount)}</div>
              <div style="margin-top:8px;color:#64748b">Ez a bontás az ügyfél által fizetendő végösszeget nem módosítja.</div>
            </div>
          `}

          <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(quote.acceptanceText)}</p>
          <p style="margin:18px 0 0 0;font-size:15px;line-height:1.6;color:#334155">${footerHtml(settings)}</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const configuredFrom = process.env.EMAIL_FROM;
    const configuredReplyTo = process.env.EMAIL_REPLY_TO || "klima.alin@gmail.com";

    if (!apiKey) return Response.json({ error: "Hiányzik a RESEND_API_KEY környezeti változó." }, { status: 500 });

    const body = await request.json();
    const customer: QuoteCustomer = body.customer || {};
    const items: QuoteItem[] = Array.isArray(body.items) ? body.items : [];
    const totalAmount = Number(body.totalAmount || 0);
    const installerAmount = Number(body.installerAmount || 0);
    const materialAmount = Number(body.materialAmount || 0);
    const pricingMode: QuotePricingMode = body.pricingMode === "alternatives" ? "alternatives" : "bundle";
    const quoteIssuedAt = safeText(body.quoteIssuedAt) || new Date().toISOString();
    const workspaceSettings = normalizeWorkspaceSettings(body.settings, defaultWorkspaceSettings(null));
    const brandName = settingsBrandName(workspaceSettings);
    const from = configuredFrom || `${brandName} <info@alinflow.hu>`;
    const replyTo = workspaceSettings.companyProfile.email || configuredReplyTo;
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
        subject: pricingMode === "alternatives" ? `Klíma ajánlat – választható lehetőségek – ${brandName}` : `Klíma ajánlat – ${brandName}`,
        headers: {
          "X-Entity-Ref-ID": uniqueEmailRef("alinflow-quote"),
        },
        html: quoteEmailHtml(customer, items, totalAmount, installerAmount, materialAmount, pricingMode, quoteIssuedAt, workspaceSettings),
      }),
    });

    const result = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) return Response.json({ error: result?.message || "A Resend nem tudta elküldeni az emailt." }, { status: resendResponse.status });

    return Response.json({ ok: true, id: result?.id });
  } catch (error: any) {
    return Response.json({ error: error?.message || "Ismeretlen email küldési hiba." }, { status: 500 });
  }
}
