import { lookupPrivacyPartner, privacyPartnerError, privacyPartnerResponse, readPrivacyPartnerRequest } from "@/lib/alinflow/privacy-partner-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const lookup = await readPrivacyPartnerRequest(request);
    return privacyPartnerResponse(await lookupPrivacyPartner(request, lookup));
  } catch (error) { return privacyPartnerError(error); }
}
