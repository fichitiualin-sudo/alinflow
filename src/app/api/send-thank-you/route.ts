import type { WorkspaceSettings } from "@/lib/alinflow/workspace-settings";
import {
  defaultWorkspaceSettings,
  normalizeWorkspaceSettings,
  settingsBrandName,
  settingsFooterLines,
} from "@/lib/alinflow/workspace-settings";

export const runtime = "nodejs";

type Customer = {
  name?: string;
  city?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  address?: string;
  date?: string;
  time?: string;
};

type QuoteItem = {
  name?: string;
  quantity?: number;
};

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function escapeHtml(value: unknown) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function uniqueEmailRef(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function footerHtml(settings: WorkspaceSettings) {
  const lines = settingsFooterLines(settings, "email");
  if (!lines.length) return "";
  const [firstLine, ...rest] = lines;
  return `Üdvözlettel,<br><strong style="color:#020617">${escapeHtml(firstLine)}</strong>${rest.length ? `<br>${rest.map(escapeHtml).join("<br>")}` : ""}`;
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric" });
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

function reviewLinks(settings: WorkspaceSettings) {
  const googleUrl = safeText(settings.emailSettings.googleReviewUrl);
  const facebookUrl = safeText(settings.emailSettings.facebookReviewUrl);
  const customUrl = safeText(settings.emailSettings.customReviewUrl);
  const customLabel = safeText(settings.emailSettings.customReviewLabel) || "Értékelés";

  return [
    googleUrl ? { label: "Google értékelés", url: googleUrl, color: "#0f172a" } : null,
    facebookUrl ? { label: "Facebook értékelés", url: facebookUrl, color: "#1877f2" } : null,
    customUrl ? { label: customLabel, url: customUrl, color: "#0f766e" } : null,
  ].filter(Boolean) as Array<{ label: string; url: string; color: string }>;
}

function itemLines(items: QuoteItem[]) {
  if (!items.length) {
    return `<li style="margin:8px 0"><strong>Klímaberendezés telepítése</strong></li>`;
  }

  return items.map((item) => {
    const quantity = Number(item.quantity || 1);
    return `<li style="margin:8px 0"><strong>${quantity} db ${escapeHtml(item.name || "Klímaberendezés")}</strong></li>`;
  }).join("");
}

function thankYouEmailHtml(customer: Customer, items: QuoteItem[], workspaceSettings?: WorkspaceSettings) {
  const settings = workspaceSettings || defaultWorkspaceSettings(null);
  const brandName = settingsBrandName(settings);
  const name = escapeHtml(customer.name || "Ügyfelünk");
  const address = escapeHtml(fullAddress(customer.city, customer.address, "", customer.postalCode));
  const installationDate = escapeHtml(formatDate(customer.date));
  const links = reviewLinks(settings);

  return `<!doctype html>
<html lang="hu">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @media only screen and (max-width: 600px) {
        .outer { padding: 12px !important; }
        .card { border-radius: 18px !important; }
        .section { padding: 20px !important; }
        .title { font-size: 26px !important; line-height: 1.15 !important; }
      }
    </style>
  </head>
  <body style="margin:0;background:#f6f7fb;padding:0;font-family:Arial,Helvetica,sans-serif;color:#020617">
    <div class="outer" style="background:#f6f7fb;padding:28px 14px">
      <div class="card" style="max-width:680px;width:100%;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 18px 45px rgba(15,23,42,.10)">
        <div class="section" style="padding:32px;background:#050816;color:#ffffff">
          <div style="font-size:14px;font-weight:800;color:#67e8f9;margin-bottom:8px">${escapeHtml(brandName)}</div>
          <h1 class="title" style="margin:0;font-size:31px;line-height:1.15;font-weight:900">${escapeHtml(settings.emailSettings.thankYouTitle)}</h1>
          <p style="margin:14px 0 0 0;color:#cbd5e1;font-size:15px;line-height:1.6">${escapeHtml(settings.emailSettings.thankYouIntro)}</p>
        </div>

        <div class="section" style="padding:28px 32px">
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.6">Tisztelt ${name}!</p>
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:#334155">Köszönjük a bizalmat és a korrekt együttműködést. Bízunk benne, hogy az új klíma hosszú távon kényelmesebbé teszi az otthonukat.</p>

          <div style="background:#f1f5f9;border-radius:20px;padding:18px 20px;margin-bottom:18px">
            <div style="font-size:14px;color:#64748b;margin-bottom:8px">Telepítés adatai</div>
            ${installationDate ? `<div style="font-size:15px;line-height:1.6;color:#111827"><strong>Dátum:</strong> ${installationDate}</div>` : ""}
            ${address ? `<div style="font-size:15px;line-height:1.6;color:#111827"><strong>Helyszín:</strong> ${address}</div>` : ""}
          </div>

          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:18px 20px;margin-bottom:18px">
            <div style="font-size:14px;color:#64748b;margin-bottom:8px">Telepített készülék</div>
            <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.6;color:#111827">
              ${itemLines(items)}
            </ul>
          </div>

          <div style="background:#ecfeff;border-radius:18px;padding:18px 20px;margin-bottom:18px;color:#334155;font-size:15px;line-height:1.65">
            <strong style="color:#020617">Garancia és karbantartás</strong><br>
            A garancia megőrzéséhez javasolt évente legalább egy karbantartást elvégezni. A karbantartási munkalapokat rendszerünkben dátum szerint megőrizzük, így szükség esetén később is visszakereshetők.
          </div>

          ${links.length ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:18px 20px;margin-bottom:18px;color:#334155;font-size:15px;line-height:1.65">
            <strong style="color:#020617">Értékelnének minket?</strong><br>
            Nagyon sokat jelent számunkra, ha pár mondatban megírják a tapasztalatukat. Ezzel másoknak is segítenek a döntésben.
            <div style="margin-top:14px;display:block">
              ${links.map((link) => `<a href="${escapeHtml(link.url)}" style="display:inline-block;margin:0 8px 8px 0;background:${link.color};color:#ffffff;text-decoration:none;border-radius:999px;padding:11px 16px;font-weight:800;font-size:14px">${escapeHtml(link.label)}</a>`).join("")}
            </div>
          </div>` : ""}

          <div style="background:#fff8dc;border-radius:18px;padding:18px 20px;margin-bottom:22px;color:#334155;font-size:15px;line-height:1.65">
            <strong style="color:#020617">Ha bármi kérdés felmerül</strong><br>
            Használattal, beállítással, karbantartással vagy későbbi bővítéssel kapcsolatban keressenek minket nyugodtan. Szívesen segítünk.
          </div>

          <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#334155">${footerHtml(settings)}</p>
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
    const customer: Customer = body.customer || {};
    const items: QuoteItem[] = Array.isArray(body.items) ? body.items : [];
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
        subject: `${workspaceSettings.emailSettings.thankYouTitle} – ${brandName}`,
        headers: {
          "X-Entity-Ref-ID": uniqueEmailRef("alinflow-thank-you"),
        },
        html: thankYouEmailHtml(customer, items, workspaceSettings),
      }),
    });

    const result = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) return Response.json({ error: result?.message || "A Resend nem tudta elküldeni az emailt." }, { status: resendResponse.status });

    return Response.json({ ok: true, id: result?.id });
  } catch (error: any) {
    return Response.json({ error: error?.message || "Ismeretlen köszönő email küldési hiba." }, { status: 500 });
  }
}
