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
      ? items.map((item) => `<li>${Number(item.quantity || 1)} db ${safeText(item.name)}</li>`).join("")
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
          <p>Kedves ${safeText(customer.name) || "Ügyfelünk"}!</p>
          <p>Ezúton visszaigazolom a klímás időpontot.</p>
          <p><strong>Időpont:</strong> ${formatDate(customer.date)} · ${safeText(customer.time) || "egyeztetés szerint"}</p>
          <p><strong>Cím:</strong> ${safeText(customer.address) || `${safeText(customer.city)}`}</p>
          <p><strong>Érintett készülék / munka:</strong></p>
          <ul>${itemLines}</ul>
          <p>Kérlek, az időpont előtt gondoskodj róla, hogy a szerelési terület hozzáférhető legyen.</p>
          <p>Ha bármi változna, erre az emailre válaszolva vagy telefonon tudsz jelezni.</p>
          <p>Üdvözlettel:<br/>Adorján Alin<br/>KLIMAlin<br/>06 30 700 4908</p>
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
