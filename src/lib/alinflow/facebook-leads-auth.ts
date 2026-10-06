import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./server-auth";
import { isWorkspaceId } from "./facebook-leads";

export async function authorizeFacebookWorkspace(request: Request, workspaceId: unknown) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new ApiError("A művelethez be kell jelentkezni.", 401);
  if (!isWorkspaceId(workspaceId)) throw new ApiError("Hiányzik vagy hibás a munkaterület.", 400);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError("A kapcsolat szerverbeállítása hiányzik.", 503);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new ApiError("A bejelentkezés lejárt.", 401);
  const normalized = workspaceId.toLowerCase();
  const member = await client.from("workspace_members").select("workspace_id")
    .eq("workspace_id", normalized).eq("user_id", data.user.id).eq("active", true).maybeSingle();
  if (member.error || !member.data) throw new ApiError("Nincs hozzáférés ehhez a munkaterülethez.", 403);
  return { client, workspaceId: normalized };
}
