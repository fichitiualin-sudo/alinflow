import { createDocumentPdf } from "./document-pdf";
import { parsePrivacyNoticeSnapshot } from "./privacy-notice";

/** No current workspace fields or unrelated customer fields enter a saved notice. */
export async function createPrivacyNoticePdf(snapshot: unknown, revokedAt?: string): Promise<Uint8Array> {
  const notice = parsePrivacyNoticeSnapshot(snapshot);
  if (!notice) throw new Error("Nincs mentett adatkezelési tájékoztató ehhez a munkalaphoz.");
  const pdf = await createDocumentPdf("Adatkezelési tájékoztató");
  pdf.text(`Verzió: ${notice.version}`, { size: 9, muted: true });
  for (const { role, party } of notice.controllers) {
    pdf.section(role === "device_seller" ? "Adatkezelő - készülék értékesítője" : "Adatkezelő - szerelési / karbantartási szolgáltató");
    pdf.text([party.legalName, party.address, party.taxNumber ? `Adószám: ${party.taxNumber}` : "", [party.email, party.phone].filter(Boolean).join(" · ")].filter(Boolean).join("\n"), { size: 9.5, gap: 2 });
  }
  pdf.section("Ügyfél adatai");
  pdf.text(`Név: ${notice.customer.name}\nCím: ${notice.customer.address}\nTelefonszám: ${notice.customer.phone || "Nincs megadva"}\nEmail: ${notice.customer.email || "Nincs megadva"}`, { size: 9.5 });
  for (const section of notice.sections) {
    pdf.section(section.title);
    pdf.text(section.text, { size: 9.5 });
  }
  pdf.section("Önkéntes karbantartói adattovábbítás");
  pdf.text(notice.consentText, { size: 9.5 });
  if (notice.partner) {
    const partner = notice.partner;
    pdf.text([`Karbantartó partner: ${partner.legalName}`, partner.address, partner.taxNumber ? `Adószám: ${partner.taxNumber}` : "", [partner.email, partner.phone].filter(Boolean).join(" · ")].filter(Boolean).join("\n"), { size: 9.5 });
  } else pdf.text("Karbantartó partner nincs kijelölve; adattovábbítás nem engedélyezett.", { size: 9.5 });
  pdf.text(notice.consentGranted ? "[X] Hozzájárultam a megjelölt partner részére történő adattovábbításhoz." : "[ ] Nem adtam hozzájárulást karbantartó partner részére történő adattovábbításhoz.", { size: 10 });
  if (revokedAt) {
    const revoked = new Date(revokedAt);
    if (!Number.isFinite(revoked.getTime())) throw new Error("A hozzájárulás visszavonásának időpontja hibás.");
    pdf.text(`A hozzájárulást később visszavonták: ${revoked.toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}. Az eredeti döntés fent látható.`, { size: 9.5 });
  }
  await pdf.signature(notice.signatureDataUrl, notice.signerName, notice.signedAt);
  return pdf.save();
}
