import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/alinflow/server-auth";
import { loadWorkspaceEmailSettings } from "@/lib/alinflow/email-identity";
import { buildMaintenanceContactSms, type MaintenanceContactSmsTarget } from "@/lib/alinflow/maintenance-contact-sms";
import { isMaintenanceContactPreference, type MaintenanceContactPreference } from "@/lib/alinflow/maintenance-contact-choice";
import { smsReminderDayOffset, smsReminderToday } from "@/lib/alinflow/sms-reminders";
import type { SharedMaintenanceInstallation } from "@/lib/alinflow/shared-maintenance";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "private, no-store", "Vary": "Authorization" };

function identifier(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError(`Hiányzó vagy hibás ${label}.`, 400);
  return value.toLowerCase();
}

async function authorize(request: Request, rawWorkspace: unknown) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new ApiError("Jelentkezz be az SMS-előnézethez.", 401);
  const workspaceId = identifier(rawWorkspace, "munkaterület");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError("A kapcsolat jelenleg nem érhető el.", 503);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } } });
  const user = await client.auth.getUser(token);
  if (user.error || !user.data.user) throw new ApiError("A bejelentkezés lejárt.", 401);
  const [member, workspace] = await Promise.all([
    client.from("workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", user.data.user.id).eq("active", true).maybeSingle(),
    client.from("workspaces").select("id").eq("id", workspaceId).eq("active", true).maybeSingle(),
  ]);
  if (member.error || !member.data || workspace.error || !workspace.data) throw new ApiError("Nincs hozzáférés ehhez a munkaterülethez.", 403);
  return { client, workspaceId };
}

async function preferences(client: SupabaseClient, workspaceId: string): Promise<MaintenanceContactPreference[]> {
  const result = await client.rpc("list_maintenance_contact_preferences", { p_workspace_id: workspaceId });
  if (result.error?.code === "42501") throw new ApiError("Az ügyfélhez már nincs aktív hozzáférésed.", 403);
  if (result.error || !Array.isArray(result.data) || !result.data.every(isMaintenanceContactPreference)) {
    throw new ApiError("A karbantartási jelölések nem tölthetők be. Frissítsd az előnézetet.", 503);
  }
  return result.data;
}

function allowContact(preference: MaintenanceContactPreference | undefined, legacyOptOut: boolean) {
  if (preference ? preference.choice === "declined" : legacyOptOut) {
    throw new ApiError("Az ügyfél nem kéri a karbantartást; megkereső SMS nem készíthető.", 409);
  }
  if (preference?.choice === "original_installer" && !preference.isSource) {
    throw new ApiError("Az ügyfél az eredeti telepítőt kéri. A megkeresést ő intézi.", 409);
  }
}

async function recipient(client: SupabaseClient, workspaceId: string, target: MaintenanceContactSmsTarget) {
  if (target.type === "shared") {
    // The existing RPC checks the exact user, active grant and source installation.
    const result = await client.rpc("list_received_maintenance_installations", { p_target_workspace_id: workspaceId });
    if (result.error?.code === "42501") throw new ApiError("A karbantartási megosztáshoz már nincs hozzáférésed.", 403);
    if (result.error || !Array.isArray(result.data)) throw new ApiError("A megosztott ügyfél nem tölthető be. Próbáld újra.", 503);
    const matches = (result.data as SharedMaintenanceInstallation[]).filter(item => item?.grantId === target.grantId && item.installationId === target.installationId);
    if (matches.length !== 1) throw new ApiError("A megosztott telepítés már nem érhető el. Frissítsd az adatokat.", 404);
    const item = matches[0];
    if (!item.customer || typeof item.customer.name !== "string" || typeof item.customer.phone !== "string"
      || !item.sourceWorkspaceId || !item.sourceWorkspaceName?.trim()) throw new ApiError("A megosztott ügyfél adatai hiányosak. Frissítsd az adatokat.", 503);
    const choices = await preferences(client, workspaceId);
    const preference = choices.find(row => !row.isSource && row.sourceWorkspaceId === item.sourceWorkspaceId && row.sourceInstallationId === item.installationId);
    allowContact(preference, item.maintenanceOptOut === true);
    return { customer: item.customer, sourceWorkspaceName: item.sourceWorkspaceName };
  }

  const [installation, customer] = await Promise.all([
    client.from("appointments").select("id,customer_id,workspace_id,appointment_type,status,scheduled_date,cancelled_at,maintenance_opt_out")
      .eq("workspace_id", workspaceId).eq("id", target.installationId).eq("customer_id", target.customerId).eq("appointment_type", "installation").maybeSingle(),
    client.from("customers").select("id,name,phone").eq("workspace_id", workspaceId).eq("id", target.customerId).maybeSingle(),
  ]);
  if (installation.error || customer.error) throw new ApiError("A mentett ügyféladatok nem tölthetők be. Próbáld újra.", 503);
  const work = installation.data;
  const offset = smsReminderDayOffset(work?.scheduled_date || "", smsReminderToday());
  if (!work || !customer.data || work.cancelled_at || !["Lezárva", "Szerelés kész – admin folyamatban"].includes(work.status)
    || offset === null || offset > 0) throw new ApiError("Ehhez a telepítéshez még nem indítható karbantartási megkeresés.", 404);
  const choices = await preferences(client, workspaceId);
  allowContact(choices.find(row => row.installationId === work.id), work.maintenance_opt_out === true);
  return { customer: { name: customer.data.name || "", phone: customer.data.phone || "" }, sourceWorkspaceName: undefined };
}

/** Read-only preparation: no SMS service, receipt or business-record mutation. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { client, workspaceId } = await authorize(request, params.get("workspaceId"));
    const installationId = identifier(params.get("installationId"), "telepítés");
    const type = params.get("type");
    if (type !== "own" && type !== "shared") throw new ApiError("Válassz egy mentett karbantartási ügyfelet.", 400);
    const target: MaintenanceContactSmsTarget = type === "own"
      ? { type, installationId, customerId: identifier(params.get("customerId"), "ügyfél") }
      : { type, installationId, grantId: identifier(params.get("grantId"), "megosztás") };
    const saved = await recipient(client, workspaceId, target);
    const settings = await loadWorkspaceEmailSettings(client, workspaceId);
    return Response.json({ draft: buildMaintenanceContactSms(saved.customer, settings, saved.sourceWorkspaceName) }, { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof ApiError ? error.message : "Az SMS-előnézet nem tölthető be. Próbáld újra." },
      { status: error instanceof ApiError ? error.status : 500, headers: noStore });
  }
}
