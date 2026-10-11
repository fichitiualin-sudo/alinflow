import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/alinflow/server-auth";
import { defaultWorkspaceSettings, workspaceSettingsFromRow, type WorkspaceSettings } from "./workspace-settings";

// Use the authorized workspace's persisted identity, never browser-supplied
// settings or the legacy workspace's contacts as a cross-workspace fallback.
export async function loadWorkspaceEmailSettings(client: Pick<SupabaseClient, "from">, workspaceId: string): Promise<WorkspaceSettings> {
  const [workspace, saved] = await Promise.all([
    client.from("workspaces").select("id,name,slug").eq("id", workspaceId).eq("active", true).maybeSingle(),
    client.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  if (workspace.error || saved.error) {
    throw new ApiError("A munkaterület emailbeállításai nem tölthetők be. Próbáld újra később.", 503);
  }
  if (!workspace.data || workspace.data.id !== workspaceId || (saved.data && saved.data.workspace_id !== workspaceId)) {
    throw new ApiError("A munkaterület emailbeállításai nem érhetők el.", 403);
  }
  return workspaceSettingsFromRow(saved.data, defaultWorkspaceSettings(workspace.data));
}

export function workspaceEmailIdentity(settings: WorkspaceSettings, configuredFrom = process.env.EMAIL_FROM) {
  const raw = String(configuredFrom || "info@alinflow.hu").trim();
  const mailbox = /<([^<>]+)>$/.exec(raw)?.[1]?.trim() || raw;
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(mailbox) || /[\r\n]/.test(raw)) {
    throw new ApiError("Az email feladó címe hibásan van beállítva.", 503);
  }
  const name = (settings.emailSettings.senderName || settings.companyProfile.displayName || "AlinFlow")
    .replace(/[\r\n]+/g, " ").trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return {
    from: `"${name}" <${mailbox}>`,
    replyTo: settings.companyProfile.email || mailbox,
  };
}
