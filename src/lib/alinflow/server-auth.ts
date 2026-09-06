import { createClient } from "@supabase/supabase-js";

export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function apiErrorResponse(error: unknown) {
  return Response.json(
    { ok: false, error: error instanceof Error ? error.message : "A művelet nem sikerült." },
    { status: error instanceof ApiError ? error.status : 500 }
  );
}

export async function authorizeCustomerRequest(request: Request, body: any) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new ApiError("A művelethez be kell jelentkezni.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError("Hiányzik a Supabase beállítás.", 500);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: session, error: authError } = await client.auth.getUser(token);
  if (authError || !session.user) throw new ApiError("A bejelentkezés lejárt.", 401);
  const workspaceId = body?.workspaceId;
  const customerId = body?.customer?.id;
  if (typeof workspaceId !== "string" || typeof customerId !== "string") {
    throw new ApiError("Hiányzik a munkaterület vagy a mentett ügyfél.");
  }
  const { data: member, error: memberError } = await client.from("workspace_members")
    .select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", session.user.id)
    .eq("active", true).maybeSingle();
  if (memberError || !member) throw new ApiError("Nincs hozzáférés ehhez a munkaterülethez.", 403);
  const { data: customer, error } = await client.from("customers").select("*")
    .eq("id", customerId).eq("workspace_id", workspaceId).maybeSingle();
  if (error || !customer) throw new ApiError("Az ügyfél nem érhető el ezen a munkaterületen.", 403);
  if (body.customer.email !== undefined &&
      String(body.customer.email || "").trim().toLowerCase() !== String(customer.email || "").trim().toLowerCase()) {
    throw new ApiError("Az email-cím megváltozott. Előbb mentsd az ügyféladatokat, majd próbáld újra a küldést.", 409);
  }
  let appointment: any = null;
  if (body.customer.activeAppointmentId) {
    const result = await client.from("appointments").select("*")
      .eq("id", body.customer.activeAppointmentId).eq("customer_id", customerId)
      .eq("workspace_id", workspaceId).maybeSingle();
    if (result.error || !result.data) throw new ApiError("Az időpont nem ehhez az ügyfélhez tartozik.", 403);
    appointment = result.data;
  }
  // Recipients and customer identity come from the authorized database row.
  body.customer = {
    ...body.customer, id: customer.id, name: customer.name, email: customer.email,
    phone: customer.phone, postalCode: customer.postal_code, city: customer.city,
    address: appointment?.address || customer.address,
    date: appointment?.scheduled_date || body.customer.date,
    time: appointment?.scheduled_time || body.customer.time,
    appointmentType: appointment?.appointment_type || body.customer.appointmentType,
  };
  return { client, workspaceId, userId: session.user.id, appointment };
}
