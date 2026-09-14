import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./server-auth";
import { decodePdfSignature } from "./document-pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type DocumentSelection = "work_report" | "purchase_declaration" | "both";

export type SavedPdfReport = {
  id: string; workspace_id: string; customer_id: string; appointment_id: string;
  appointment_type: string; work_date?: string; work_time?: string;
  customer_name?: string; customer_email?: string; customer_phone?: string; customer_address?: string;
  climate_summary?: string; work_description?: string; notes?: string;
  signature_data_url?: string; signer_name?: string; signed_at?: string;
};

export type SavedPdfDeclaration = {
  id: string; workspace_id: string; customer_id: string; appointment_id: string; work_report_id: string;
  seller_name?: string; seller_tax_number?: string; seller_representative?: string;
  quote_items?: Array<{ productName?: string; customName?: string; name?: string; quantity?: number }>;
  signature_data_url?: string; signer_name?: string; signed_at?: string;
};

export type SavedPdfBundle = { report: SavedPdfReport; declarations: SavedPdfDeclaration[]; includeWorkReport: boolean };

function requireSigned(record: { signature_data_url?: string; signed_at?: string }, label: string) {
  if (!record.signed_at || !Number.isFinite(new Date(record.signed_at).getTime()) || !record.signature_data_url) {
    throw new ApiError(`A ${label} nincs elmentve érvényes aláírással. Előbb írd alá és mentsd el.`, 409);
  }
  try { decodePdfSignature(record.signature_data_url); }
  catch { throw new ApiError(`A ${label} mentett aláírásképe nem használható PDF-ben. Nyisd meg és ellenőrizd a dokumentumot.`, 409); }
}

/** Only persisted, authorized document rows are usable as email attachment sources. */
export async function loadSavedPdfBundle(client: SupabaseClient, input: {
  workspaceId: string; customerId: string; appointmentId: string;
  workReportId: unknown; purchaseDeclarationIds?: unknown; documents?: unknown;
}): Promise<SavedPdfBundle> {
  const { workspaceId, customerId, appointmentId } = input;
  if (![workspaceId, customerId, appointmentId].every((value) => typeof value === "string" && UUID.test(value))) {
    throw new ApiError("A PDF-küldéshez válaszd ki a mentett ügyfelet és a pontos munkát.");
  }
  if (typeof input.workReportId !== "string" || !UUID.test(input.workReportId)) {
    throw new ApiError("A PDF-küldéshez előbb mentsd el a munkalapot.");
  }
  const { data, error } = await client.from("work_reports").select("*")
    .eq("id", input.workReportId).eq("workspace_id", workspaceId).eq("customer_id", customerId)
    .eq("appointment_id", appointmentId).maybeSingle();
  if (error) throw new ApiError("A mentett munkalap nem tölthető be. Próbáld újra.", 503);
  if (!data) throw new ApiError("A kiválasztott munkalap nem érhető el ennél a munkánál.", 404);
  const report = data as SavedPdfReport;
  const mode = input.documents ?? (report.appointment_type === "installation" ? "both" : "work_report");
  if (!["work_report", "purchase_declaration", "both"].includes(String(mode))) throw new ApiError("Ismeretlen dokumentumkiválasztás.");
  const includeWorkReport = mode !== "purchase_declaration";
  if (includeWorkReport) requireSigned(report, "munkalap");
  if (mode === "work_report") return { report, declarations: [], includeWorkReport };
  if (report.appointment_type !== "installation") throw new ApiError("Ehhez a munkatípushoz csak munkalap küldhető.");
  if (!Array.isArray(input.purchaseDeclarationIds) || !input.purchaseDeclarationIds.length
    || input.purchaseDeclarationIds.length > 10 || !input.purchaseDeclarationIds.every((id) => typeof id === "string" && UUID.test(id))) {
    throw new ApiError("Válaszd ki az elmentett vásárlási nyilatkozatot (legfeljebb 10 dokumentum).");
  }
  const ids = [...new Set(input.purchaseDeclarationIds as string[])];
  const declarations = await Promise.all(ids.map(async (id) => {
    const result = await client.from("purchase_declarations").select("*")
      .eq("id", id).eq("workspace_id", workspaceId).eq("customer_id", customerId)
      .eq("appointment_id", appointmentId).eq("work_report_id", report.id).maybeSingle();
    if (result.error) throw new ApiError("A mentett vásárlási nyilatkozat nem tölthető be. Próbáld újra.", 503);
    if (!result.data) throw new ApiError("A kiválasztott vásárlási nyilatkozat nem ehhez a munkalaphoz tartozik.", 404);
    const declaration = result.data as SavedPdfDeclaration;
    requireSigned(declaration, "vásárlási nyilatkozat");
    return declaration;
  }));
  return { report, declarations, includeWorkReport };
}
