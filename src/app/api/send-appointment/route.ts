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
};

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function formatDate(value?: string) {
  if (!value) return "egyeztetett időpont";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" });
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

    const itemLines = items.length
      ? items.map((item) => `<li><strong>${Number(item.quantity || 1)} db ${safeText(item.name)}</strong> <span style="color:#64748b">– szereléssel együtt</span></li>`).join("")
      : "<li>Klímatelepítés / felmérés</li>";

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
        html: `
          <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a">
            <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden">
              <div style="padding:24px 28px;background:#050816;color:white">
                <div style="font-size:13px;color:#67e8f9;margin-bottom:6px">KLIMAlin időpont visszaigazolás</div>
                <h1 style="margin:0;font-size:24px">Sikeres időpont-egyeztetés</h1>
              </div>
              <div style="padding:26px 28px">
                <p>Tisztelt ${safeText(customer.name) || "Ügyfelünk"}!</p>
                <p>Ezúton visszaigazoljuk a klímás időpontot.</p>
                <div style="background:#f1f5f9;border-radius:14px;padding:16px;margin:18px 0">
                  <p style="margin:0 0 8px 0"><strong>Időpont:</strong> ${formatDate(customer.date)} · ${safeText(customer.time) || "egyeztetés szerint"}</p>
                  <p style="margin:0"><strong>Cím:</strong> ${safeText(customer.address) || safeText(customer.city) || "egyeztetés szerint"}</p>
                </div>
                <p><strong>Érintett készülék / munka:</strong></p>
                <ul>${itemLines}</ul>
                <p>A klíma ára / ajánlata szereléssel együtt értendő, az előzetesen egyeztetett feltételek szerint.</p>
                <p>Kérjük, az időpont előtt gondoskodjon róla, hogy a szerelési terület hozzáférhető legyen.</p>
                <p>Amennyiben bármi változna, erre az emailre válaszolva vagy telefonon tudja jelezni.</p>
                <p>Üdvözlettel:<br/><strong>Adorján Alin · KLIMAlin</strong><br/>06 30 700 4908<br/>klimalin.hu</p>
              </div>
            </div>
          </div>
        `,
      }),
    });

    const result = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) return Response.json({ error: result?.message || "A Resend nem tudta elküldeni az emailt." }, { status: resendResponse.status });

    return Response.json({ ok: true, id: result?.id });
  } catch (error: any) {
    return Response.json({ error: error?.message || "Ismeretlen email küldési hiba." }, { status: 500 });
  }
}
