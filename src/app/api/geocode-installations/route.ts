import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type GeocodeRequestLocation = {
  appointmentId?: string;
  address?: string;
};

type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }>;
};

const MAX_LOCATIONS_PER_REQUEST = 30;

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

async function requireAuthenticatedUser(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: "Hiányzik a Supabase környezeti beállítás.", status: 500 };
  }
  if (!token) {
    return { error: "A koordinátakereséshez be kell jelentkezni.", status: 401 };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);

  if (error || !data.user) {
    return { error: "A bejelentkezés nem ellenőrizhető.", status: 401 };
  }

  return { userId: data.user.id };
}

async function geocodeAddress(apiKey: string, address: string) {
  const params = new URLSearchParams({
    address,
    key: apiKey,
    language: "hu",
    region: "hu",
  });
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`, {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as GoogleGeocodeResponse;

  if (!response.ok) {
    return { status: "failed", error: `Google Geocoding hiba: ${response.status}` };
  }
  if (body.status !== "OK") {
    return { status: "failed", error: body.error_message || body.status || "Nincs találat a címre." };
  }

  const location = body.results?.[0]?.geometry?.location;
  if (!Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)) {
    return { status: "failed", error: "A Google nem adott vissza koordinátát." };
  }

  return {
    status: "ok",
    latitude: Number(location?.lat),
    longitude: Number(location?.lng),
    formattedAddress: body.results?.[0]?.formatted_address,
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request);
    if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

    const apiKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
    if (!apiKey) {
      return Response.json({ error: "Hiányzik a GOOGLE_MAPS_GEOCODING_API_KEY környezeti változó." }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const rawLocations = Array.isArray(body?.locations) ? body.locations : [];
    const seenAppointments = new Set<string>();
    const locations = rawLocations
      .map((item: GeocodeRequestLocation) => ({
        appointmentId: safeText(item.appointmentId),
        address: safeText(item.address),
      }))
      .filter((item: Required<GeocodeRequestLocation>) => {
        if (!item.appointmentId || !item.address || seenAppointments.has(item.appointmentId)) return false;
        seenAppointments.add(item.appointmentId);
        return true;
      })
      .slice(0, MAX_LOCATIONS_PER_REQUEST);

    if (!locations.length) {
      return Response.json({ results: [] });
    }

    const results = [];
    for (const location of locations) {
      const geocoded = await geocodeAddress(apiKey, location.address);
      results.push({
        appointmentId: location.appointmentId,
        address: location.address,
        ...geocoded,
      });
    }

    return Response.json({ results });
  } catch (error: any) {
    return Response.json({ error: error?.message || "Ismeretlen koordinátakeresési hiba." }, { status: 500 });
  }
}
