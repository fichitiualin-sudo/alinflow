import { privacyControllerLabel, type PrivacyNoticeSnapshot } from "@/lib/alinflow/privacy-notice";
import { formatSignedAt } from "@/lib/alinflow/work-report";

/** Render the version shown when this signature was made, never today's settings. */
export function PrivacyNoticeDocument({ notice, revokedAt }: { notice: PrivacyNoticeSnapshot; revokedAt?: string }) {
  const party = (value: PrivacyNoticeSnapshot["controllers"][number]["party"]) => (
    <><strong>{value.legalName}</strong><br />{[value.address, value.taxNumber ? `Adószám: ${value.taxNumber}` : "", value.email, value.phone].filter(Boolean).join(" · ")}</>
  );
  return <article className="doc-print-page privacy-notice-doc mx-auto mt-6 max-w-[210mm] rounded-2xl bg-white p-5 font-sans text-[12px] leading-relaxed text-slate-900 shadow-xl [overflow-wrap:anywhere] sm:p-8 print:m-0 print:min-h-[297mm] print:w-[210mm] print:rounded-none print:p-[14mm] print:shadow-none">
    <style>{`@media print { .doc-print-page.privacy-notice-doc { height: auto !important; overflow: visible !important; padding: 14mm !important; break-before: page; font-family: Arial, sans-serif; font-size: 10.5pt; line-height: 1.4; } }`}</style>
    <header className="border-b-2 border-teal-700 pb-3">
      <h2 className="text-2xl font-bold">Adatkezelési tájékoztató</h2>
      <p className="mt-1 text-[10px] text-slate-500">Verzió: {notice.version}</p>
    </header>
    <section className="mt-4">
      <h3 className="font-bold text-teal-800">{notice.controllers.length === 1 ? "Adatkezelő" : "Adatkezelők"}</h3>
      {notice.controllers.map(({ role, party: controller }) => <p key={role} className="mt-2">
        <span className="text-[10px] text-slate-500">{privacyControllerLabel(role, notice.version)}</span><br />{party(controller)}
      </p>)}
    </section>
    <section className="mt-4 rounded-xl bg-slate-50 p-3">
      <h3 className="font-bold">Ügyfél adatai</h3>
      <p>Név: {notice.customer.name}</p><p>Cím: {notice.customer.address}</p>
      <p>Telefonszám: {notice.customer.phone || "Nincs megadva"}</p><p>Email: {notice.customer.email || "Nincs megadva"}</p>
    </section>
    {notice.sections.map((section, index) => <section key={index} className="mt-4">
      <h3 className="break-after-avoid font-bold text-teal-800">{section.title}</h3>
      <p className="mt-1 whitespace-pre-wrap">{section.text}</p>
    </section>)}
    <section className="mt-4 border-l-2 border-teal-700 pl-3">
      <h3 className="break-after-avoid font-bold">Önkéntes karbantartói adattovábbítás</h3>
      <p className="mt-1">{notice.consentText}</p>
      <p className="mt-2">Karbantartó partner: {notice.partner ? party(notice.partner) : "Nincs kijelölve; adattovábbítás nem engedélyezett."}</p>
      <p className="mt-2 font-bold">{notice.consentGranted ? "☑ Hozzájárultam a megjelölt partner részére történő adattovábbításhoz." : "☐ Nem adtam hozzájárulást karbantartó partner részére történő adattovábbításhoz."}</p>
      {revokedAt ? <p className="mt-2 font-bold">A hozzájárulást később visszavonták: {formatSignedAt(revokedAt)}. Az eredeti döntés fent látható.</p> : null}
    </section>
    <section className="mt-5 flex break-inside-avoid flex-col items-end gap-2">
      <img src={notice.signatureDataUrl} alt="Az adatkezelési dokumentumhoz rögzített ügyfélaláírás" className="h-[18mm] max-w-[56mm] object-contain" />
      <p className="w-[56mm] max-w-full border-t border-slate-400 pt-1 text-center">{notice.signerName}</p>
      <p className="text-[10px] text-slate-500">Aláírva: {formatSignedAt(notice.signedAt)}</p>
    </section>
  </article>;
}
