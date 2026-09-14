import { ApiError, authorizeCustomerRequest, apiErrorResponse } from "@/lib/alinflow/server-auth";
import { appointmentTypeLabel } from "@/lib/alinflow/appointments";
import { loadSavedPdfBundle } from "@/lib/alinflow/document-pdf-data";
import { createSavedPdfAttachments } from "@/lib/alinflow/document-pdf-render";
import {
  defaultWorkspaceSettings,
  normalizeWorkspaceSettings,
  settingsBrandName,
  settingsFooterLines,
} from "@/lib/alinflow/workspace-settings";

export const runtime = "nodejs";

function escapeHtml(value: unknown) {
  return String(value ?? "").trim().replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { client, workspaceId, appointment } = await authorizeCustomerRequest(request, body);
    const customer = body.customer;
    const to = String(customer.email || "").trim();
    if (!to) throw new ApiError("Hiányzik az ügyfél email címe.");

    const bundle = await loadSavedPdfBundle(client, {
      workspaceId,
      customerId: customer.id,
      appointmentId: appointment?.id || "",
      workReportId: body.workReportId,
      purchaseDeclarationIds: body.purchaseDeclarationIds,
      documents: body.documents,
    });
    const settings = normalizeWorkspaceSettings(body.settings, defaultWorkspaceSettings(null));
    let attachments;
    try { attachments = await createSavedPdfAttachments(bundle, customer, settings); }
    catch (error) { throw new ApiError(error instanceof Error ? error.message : "A mentett dokumentumok PDF-je nem készíthető el.", 409); }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new ApiError("Hiányzik a RESEND_API_KEY környezeti változó.", 500);
    const brandName = settingsBrandName(settings);
    const documentLabel = bundle.includeWorkReport
      ? `${appointmentTypeLabel(bundle.report.appointment_type)} munkalap${bundle.declarations.length ? " és vásárlási nyilatkozat" : ""}`
      : "Vásárlási nyilatkozat";
    const footer = settingsFooterLines(settings, "workReport").map(escapeHtml).join("<br>");
    const html = `<!doctype html><html lang="hu"><head><meta charset="utf-8"></head>
      <body style="font-family:Arial,sans-serif;color:#172033;line-height:1.6;padding:20px">
        <p>Kedves ${escapeHtml(customer.name || "Ügyfelünk")}!</p>
        <p>A mentett, aláírt dokumentumokat PDF-mellékletként küldjük.</p>
        <p><strong>${escapeHtml(documentLabel)}</strong><br>${attachments.length} PDF-melléklet</p>
        <p>A mellékletek letölthetők és kinyomtathatók.</p>
        ${footer ? `<p>Üdvözlettel,<br>${footer}</p>` : ""}
      </body></html>`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || `${brandName} <info@alinflow.hu>`,
        to: [to],
        reply_to: settings.companyProfile.email || process.env.EMAIL_REPLY_TO || "klima.alin@gmail.com",
        subject: `${documentLabel} – ${brandName}`,
        headers: { "X-Entity-Ref-ID": `alinflow-work-report-${crypto.randomUUID()}` },
        html,
        attachments,
      }),
    });
    const result = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) return Response.json({ error: result?.message || "A Resend nem tudta elküldeni az emailt." }, { status: resendResponse.status });
    return Response.json({
      ok: true, id: result?.id,
      workReportId: bundle.includeWorkReport ? bundle.report.id : null,
      purchaseDeclarationIds: bundle.declarations.map((declaration) => declaration.id),
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
