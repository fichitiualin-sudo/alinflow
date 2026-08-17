import { parseKlimalinCatalog } from "@/lib/alinflow/klimalin-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_URL = "https://klimalin.hu/";

export async function POST() {
  try {
    const response = await fetch(SOURCE_URL, {
      cache: "no-store",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) {
      return Response.json({ error: `A KLIMAlin oldal nem érhető el (${response.status}).` }, { status: 502 });
    }

    const products = parseKlimalinCatalog(await response.text());
    return Response.json(
      { products, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return Response.json({ error: error?.message || "A KLIMAlin kínálat nem olvasható be." }, { status: 502 });
  }
}
