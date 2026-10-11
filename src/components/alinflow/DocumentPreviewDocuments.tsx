import type { Customer, PurchaseDeclaration, QuoteItem, SellerCompany, WorkReport } from "@/lib/alinflow/types";
import { PrivacyNoticeDocument } from "@/components/alinflow/PrivacyNoticeDocument";
import type { WorkspaceSettings } from "@/lib/alinflow/workspace-settings";
import { ft, fullCustomerAddress } from "@/lib/alinflow/format";
import { isQuoteAlternatives, itemName, itemProductMedia, itemQuantity, itemTotal, itemUnitPrice, total } from "@/lib/alinflow/products";
import { defaultWorkDescription, formatSignedAt, hasValidWorkReportSignature, workAcceptanceText, workReportTitle } from "@/lib/alinflow/work-report";
import { appointmentDocumentTitle, appointmentEmailIntro, appointmentTimeLabel, appointmentTimeRangeLabel, appointmentTypeLabel, appointmentWorkLabel, normalizeAppointmentType } from "@/lib/alinflow/appointments";
import { DEFAULT_SELLER_COMPANY } from "@/lib/alinflow/purchase-declarations";
import { defaultWorkspaceSettings, settingsBrandName, settingsContactLine, settingsContentLines, settingsCustomerDocumentFooterLines, settingsFooterLines, settingsPrimaryContact } from "@/lib/alinflow/workspace-settings";

function formatDocumentDate(value?: string) {
  if (!value) return "nincs megadva";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

function declarationDate(value?: string, fallbackDate?: string) {
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" });
  }
  if (fallbackDate) {
    const date = new Date(`${fallbackDate.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("hu-HU");
  }
  return "";
}

function formatQuoteIssuedAt(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function appointmentDocumentNotes(type?: string) {
  const normalized = normalizeAppointmentType(type);
  if (normalized === "survey") {
    return [
      "Kérjük, hogy a tervezett beltéri és kültéri egység helye legyen hozzáférhető.",
      "Amennyiben az időponttal kapcsolatban bármi változna, kérjük, jelezze telefonon.",
    ];
  }
  if (normalized === "maintenance") {
    return [
      "Kérjük, hogy a karbantartandó klíma beltéri és kültéri egysége legyen hozzáférhető.",
      "Amennyiben az időponttal kapcsolatban bármi változna, kérjük, jelezze telefonon.",
    ];
  }
  return [
    "Kérjük, hogy a szerelési helyszín legyen megközelíthető.",
    "A beltéri és kültéri egység tervezett helye legyen hozzáférhető.",
    "Amennyiben az időponttal kapcsolatban bármi változna, kérjük, jelezze telefonon.",
  ];
}

function customerWithReportDate(customer: Customer, report: WorkReport): Customer {
  return {
    ...customer,
    appointmentType: report.appointmentType || customer.appointmentType,
    date: report.workDate || customer.date,
    time: report.workTime || customer.time,
  };
}

export function WorkReportDocument({ customer, report, quoteItems, workspaceSettings }: { customer: Customer; report: WorkReport; quoteItems: QuoteItem[]; workspaceSettings?: WorkspaceSettings }) {
  const reportCustomer = customerWithReportDate(customer, report);
  const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
  const shownItems = items.length ? items : [{ productId: "", quantity: 1, customName: "Nincs klíma megadva", isManual: true }];
  const settings = workspaceSettings || defaultWorkspaceSettings(null);
  const footerLines = settingsFooterLines(settings, "workReport");
  const workType = appointmentTypeLabel(reportCustomer.appointmentType);
  const workTime = reportCustomer.time ? appointmentTimeLabel(reportCustomer.appointmentType, reportCustomer.time, items) : appointmentTimeRangeLabel(reportCustomer);
  const workTitle = workReportTitle(reportCustomer.appointmentType);
  const workNote = appointmentWorkLabel(reportCustomer.appointmentType);
  const workDate = reportCustomer.date;
  return (
    <>
    <article className="doc-print-page work-report-doc mx-auto max-w-[210mm] rounded-2xl bg-white p-5 font-sans text-[13px] leading-relaxed text-slate-900 shadow-xl [overflow-wrap:anywhere] sm:p-8 print:m-0 print:min-h-[297mm] print:w-[210mm] print:max-w-[210mm] print:overflow-visible print:rounded-none print:border-0 print:p-[14mm] print:text-[11.5px] print:shadow-none">
      <header className="border-b-2 border-teal-700 pb-5 print:pb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700 print:text-[9px]">{settingsBrandName(settings)}</p>
        <h2 className="mt-2 text-[25px] font-bold leading-tight tracking-tight print:text-[23px]">{workTitle}</h2>
        <p className="mt-2 text-[11px] text-slate-500 print:text-[10px]">az elvégzett munka és átadás-átvétel visszaigazolására</p>
      </header>

      <div className="mt-6 space-y-6 print:mt-5 print:space-y-5">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 print:grid-cols-2 print:gap-8">
          <section className="min-w-0">
            <h3 className="mb-3 break-after-avoid text-[11px] font-bold uppercase tracking-[0.1em] text-teal-700 print:text-[9.5px]">Ügyfél adatai</h3>
            <dl className="space-y-2">
              <div><dt className="text-[10px] text-slate-500">Név</dt><dd className="font-semibold">{customer.name || "—"}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Cím</dt><dd>{fullCustomerAddress(customer) || "—"}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Telefonszám</dt><dd>{customer.phone || "—"}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Email</dt><dd>{customer.email || "—"}</dd></div>
            </dl>
          </section>
          <section className="min-w-0">
            <h3 className="mb-3 break-after-avoid text-[11px] font-bold uppercase tracking-[0.1em] text-teal-700 print:text-[9.5px]">Munka adatai</h3>
            <dl className="space-y-2">
              <div><dt className="text-[10px] text-slate-500">Munka típusa</dt><dd className="font-semibold">{workType}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Munka dátuma</dt><dd>{formatDocumentDate(workDate)}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Idősáv</dt><dd>{workTime}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Helyszín</dt><dd>{fullCustomerAddress(customer) || "—"}</dd></div>
            </dl>
          </section>
        </div>

        <section>
          <h3 className="mb-3 break-after-avoid text-[11px] font-bold uppercase tracking-[0.1em] text-teal-700 print:text-[9.5px]">Készülékek</h3>
          <table className="w-full table-fixed border-collapse text-[11px] print:text-[10px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="border-y border-slate-200 px-3 py-2 text-left font-semibold">Készülék megnevezése</th>
                <th className="w-14 border-y border-slate-200 px-2 py-2 text-center font-semibold">Darab</th>
                <th className="w-[30%] border-y border-slate-200 px-3 py-2 text-left font-semibold">Megjegyzés</th>
              </tr>
            </thead>
            <tbody>
              {shownItems.map((item, index)=><tr key={`${item.productId}-${index}`} className="break-inside-avoid">
                <td className="border-b border-slate-200 px-3 py-2.5 align-top">{itemName(item)}</td>
                <td className="border-b border-slate-200 px-2 py-2.5 text-center align-top font-semibold">{itemQuantity(item)}</td>
                <td className="border-b border-slate-200 px-3 py-2.5 align-top text-slate-600">{workNote}</td>
              </tr>)}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="mb-2 break-after-avoid text-[11px] font-bold uppercase tracking-[0.1em] text-teal-700 print:text-[9.5px]">Elvégzett munka</h3>
          <p className="whitespace-pre-wrap">{report.workDescription || defaultWorkDescription(reportCustomer.appointmentType)}</p>
        </section>

        {report.notes ? <section><h3 className="mb-2 break-after-avoid text-[11px] font-bold uppercase tracking-[0.1em] text-teal-700 print:text-[9.5px]">Megjegyzés</h3><p className="whitespace-pre-wrap">{report.notes}</p></section> : null}

        <section className="border-l-2 border-teal-700 pl-4">
          <h3 className="mb-1 break-after-avoid text-[11px] font-semibold print:text-[10px]">Átadás-átvételi nyilatkozat</h3>
          <p className="text-[11px] leading-relaxed text-slate-600 print:text-[10px]">{workAcceptanceText(reportCustomer.appointmentType)}</p>
        </section>

        <section className="flex break-inside-avoid flex-col items-end justify-between gap-5 pt-3 sm:flex-row print:flex-row print:pt-2">
          <div className="min-w-0 self-start sm:self-auto print:self-auto">
            <p className="text-[10px] text-slate-500">Kelt</p>
            <p className="mt-1 text-[11px]">{formatDocumentDate(workDate)}</p>
          </div>
          <div className="w-[56mm] max-w-full shrink-0 text-center">
            {report.signatureDataUrl ? <img src={report.signatureDataUrl} alt="Ügyfél aláírása" className="mx-auto mb-2 max-h-[22mm] max-w-full object-contain print:max-h-[18mm]"/> : <div className="mb-2 h-[18mm]"/>}
            <div className="border-t border-slate-400 pt-2 text-[11px] font-medium">Ügyfél aláírása</div>
            {hasValidWorkReportSignature(report) ? <p className="mt-1 text-[9px] text-slate-500">Aláírva: {formatSignedAt(report.signedAt)}</p> : null}
          </div>
        </section>

        <footer className="break-inside-avoid border-t border-slate-200 pt-3 text-[10px] leading-relaxed text-slate-500 print:text-[9px]">
          Üdvözlettel,<br />
          {footerLines.map((line, index) => (
            <span key={`${line}-${index}`}>{index === 0 ? <strong>{line}</strong> : line}{index < footerLines.length - 1 ? <br /> : null}</span>
          ))}
        </footer>
      </div>
    </article>
    {report.privacyNotice ? <PrivacyNoticeDocument notice={report.privacyNotice} revokedAt={report.privacyConsentRevokedAt} /> : null}
    </>
  );
}

export function AllWorkReportsDocument({ customer, reports, quoteItems, workspaceSettings }: { customer: Customer; reports: WorkReport[]; quoteItems: QuoteItem[]; workspaceSettings?: WorkspaceSettings }) {
  const sortedReports = [...reports].sort((a, b) => {
    const aDate = `${a.workDate || ""}T${a.workTime || "00:00"}`;
    const bDate = `${b.workDate || ""}T${b.workTime || "00:00"}`;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

  if (!sortedReports.length) {
    return (
      <article className="doc-print-page mx-auto max-w-[210mm] rounded-3xl bg-white p-8 text-slate-950 shadow-2xl print:m-0 print:min-h-[297mm] print:w-[210mm] print:rounded-none print:p-[14mm] print:shadow-none">
        <h2 className="text-2xl font-black">Garanciális munkalapok</h2>
        <p className="mt-4 text-slate-700">Ehhez az ügyfélhez még nincs mentett munkalap.</p>
      </article>
    );
  }

  return (
    <>
      <article className="doc-print-page mx-auto max-w-[210mm] rounded-3xl bg-white p-8 text-slate-950 shadow-2xl print:m-0 print:min-h-[297mm] print:w-[210mm] print:rounded-none print:p-[14mm] print:shadow-none">
        <h2 className="text-2xl font-black">Garanciális munkalapok összesítő</h2>
        <p className="mt-2 text-sm text-slate-600">Ügyfél: <strong>{customer.name || "Nincs név"}</strong></p>
        <p className="text-sm text-slate-600">Cím: <strong>{fullCustomerAddress(customer) || "nincs megadva"}</strong></p>
        <div className="mt-6 space-y-2">
          {sortedReports.map((report, index) => {
            const reportCustomer = customerWithReportDate(customer, report);
            return (
              <div key={report.id || `${report.workDate}-${report.workTime}-${index}`} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 p-3">
                <div>
                  <p className="font-black">{workReportTitle(reportCustomer.appointmentType)}</p>
                  <p className="text-sm text-slate-600">{formatDocumentDate(reportCustomer.date)} · {reportCustomer.time ? appointmentTimeLabel(reportCustomer.appointmentType, reportCustomer.time, quoteItems) : "nincs idő"}</p>
                </div>
                <p className="text-sm font-bold text-slate-600">{hasValidWorkReportSignature(report) ? `Aláírva: ${formatSignedAt(report.signedAt)}` : "aláírás nélkül"}</p>
              </div>
            );
          })}
        </div>
      </article>
      {sortedReports.map((report, index) => (
        <WorkReportDocument key={report.id || `${report.workDate}-${report.workTime}-${index}`} customer={customer} report={report} quoteItems={quoteItems} workspaceSettings={workspaceSettings} />
      ))}
    </>
  );
}

export function PurchaseDeclarationDocument({ customer, report, quoteItems, seller, declaration }: { customer: Customer; report: WorkReport; quoteItems: QuoteItem[]; seller?: SellerCompany; declaration?: PurchaseDeclaration }) {
  const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
  const shownItems = items.length ? items : [{ productId: "", quantity: 1, customName: "Nincs klíma megadva", isManual: true }];
  const shownSeller = seller || DEFAULT_SELLER_COMPANY;
  const signature = declaration ? declaration.signatureDataUrl : report.signatureDataUrl;
  const signerName = declaration ? declaration.signerName : report.signerName;
  const savedDate = declaration ? declaration.signedAt || declaration.createdAt : report.signedAt || report.createdAt;
  const issuedDate = declarationDate(savedDate, report.workDate || customer.date);
  const field = (label: string, value = "") => <p className="purchase-field"><span>{label}</span><span className="purchase-field-value">{value || "\u00A0"}</span></p>;
  return (
    <>
      <style>{`
        .purchase-original { position: relative; box-sizing: border-box; width: 100%; max-width: 210mm; min-height: 297mm; margin: 0 auto 24px; padding: 19mm 25mm 18mm; background: white; color: black; font-family: "Times New Roman", Times, serif; font-size: 16px; line-height: 1.2; box-shadow: 0 12px 32px #0f172a18; overflow-wrap: anywhere; }
        .purchase-original p, .purchase-original h2, .purchase-original h3 { margin: 0; }
        .purchase-original h2 { text-align: center; font-size: 18.67px; line-height: 1.15; font-weight: bold; }
        .purchase-original .purchase-subtitle { font-size: 13.33px; line-height: 1.15; }
        .purchase-original section { margin-top: 18px; }
        .purchase-original h3 { margin-bottom: 16px; font-weight: bold; font-size: 16px; break-after: avoid; }
        .purchase-original .purchase-seller { margin-left: 12.5mm; }
        .purchase-original .purchase-buyer { margin-left: 6.25mm; }
        .purchase-original .purchase-buyer-fields { margin-left: 6.25mm; }
        .purchase-original .purchase-person { margin-top: 24px; }
        .purchase-original .purchase-field { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 4px; line-height: 1.35; }
        .purchase-original .purchase-field-value { flex: 1; min-width: 40px; border-bottom: 1px dotted black; padding: 0 2px; }
        .purchase-original .purchase-paragraph { margin-top: 16px; text-align: justify; }
        .purchase-original table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 18px; font-size: 14.67px; }
        .purchase-original th, .purchase-original td { border: .7px solid black; padding: 12px; vertical-align: middle; }
        .purchase-original th { font-weight: bold; text-align: center; height: 14mm; }
        .purchase-original td { height: 15mm; }
        .purchase-original tr { break-inside: avoid; }
        .purchase-original .purchase-table-note { margin-top: 5px; text-align: justify; }
        .purchase-original .purchase-signatures { display: flex; align-items: flex-end; gap: 16px; justify-content: space-between; margin-top: 18px; break-inside: avoid; }
        .purchase-original .purchase-date { flex: 1; align-self: flex-start; margin-top: 4px; }
        .purchase-original .purchase-signature { width: 82mm; max-width: 53%; text-align: center; }
        .purchase-original .purchase-signature img { display: block; margin: 0 auto 3px; max-width: 100%; height: 15mm; object-fit: contain; }
        .purchase-original .purchase-signature-space { height: 10mm; }
        .purchase-original .purchase-signature-line { border-top: .7px solid black; font-style: italic; }
        .purchase-original .purchase-footnote { margin-top: 20px; font-size: 13.33px; line-height: 1.15; break-inside: avoid; }
        .purchase-original .purchase-footnote::before { display: block; width: 50mm; border-top: .7px solid black; content: ""; margin-bottom: 7px; }
        @media screen and (max-width: 600px) { .purchase-original { padding: 55px 20px 28px; min-height: 0; } .purchase-original .purchase-seller, .purchase-original .purchase-buyer, .purchase-original .purchase-buyer-fields { margin-left: 12px; } .purchase-original .purchase-signatures { flex-wrap: wrap; } .purchase-original .purchase-date { flex-basis: 100%; } .purchase-original .purchase-signature { margin-left: auto; max-width: 80%; } }
        @media print { .purchase-original { width: 210mm; max-width: 210mm; min-height: 297mm; height: auto; overflow: visible; margin: 0; line-height: 1.15; box-shadow: none; break-after: page; } .purchase-original:last-child { break-after: auto; } .purchase-original thead { display: table-header-group; } }
      `}</style>
      <article className="doc-print-page purchase-doc purchase-original">
        <header>
          <h2>VÁSÁRLÁSI<br />NYILATKOZAT</h2>
          <p className="purchase-subtitle">a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló <strong>458/2024. (XII. 30.) Korm. rendelet</strong><br />28. § (5) bekezdése alapján</p>
        </header>
        <section>
          <h3>Az értékesítő vállalkozás adatai:</h3>
          <div className="purchase-seller">
            {field("neve:", shownSeller.name)}
            {field("adószáma:", shownSeller.taxNumber)}
            {field("a képviseletében eljáró természetes személy neve:", shownSeller.representative)}
          </div>
        </section>
        <section>
          <h3>A telepíttető adatai:</h3>
          <div className="purchase-buyer">
            <p>A.) Vállalkozás, intézmény, egyéb adószámmal rendelkező szervezet</p>
            <div className="purchase-buyer-fields">
              {field("neve:")}
              {field("adószáma:")}
              {field("a képviseletében eljáró természetes személy neve:")}
            </div>
            <p className="purchase-person">B.) Természetes személy</p>
            <div className="purchase-buyer-fields">
              {field("neve:", customer.name || signerName)}
              {field("lakcíme:", fullCustomerAddress(customer))}
            </div>
          </div>
        </section>
        <p className="purchase-paragraph">Telepíttető – megfelelve az Európai Parlament és a Tanács 2024/573 Rendeletében, valamint a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. §-ban foglaltaknak – <strong>jelen nyilatkozat aláírásával kötelezettséget vállal arra, hogy az alábbi telepítési tanúsítvány-köteles berendezés(ek) telepítését és beüzemelését az arra képesítéssel rendelkező vállalkozás képesített alkalmazottjával fogja elvégeztetni.</strong></p>
        <table>
          <thead><tr><th className="w-[59%]">Termék megnevezése</th><th>Megvásárolt termékek darabszáma</th></tr></thead>
          <tbody>{shownItems.map((item, index) => <tr key={`${item.productId}-${index}`}><td>{itemName(item)}</td><td className="text-center">{itemQuantity(item)}</td></tr>)}</tbody>
        </table>
        <p className="purchase-table-note">*Több berendezés típus vásárlása esetén a táblázat sorainak száma bővíthető egyéni szerkesztéssel</p>
        <p className="purchase-paragraph">Telepíttető tudomásul veszi, hogy a telepítési tanúsítvány-köteles berendezéssel kapcsolatos <strong>jótállás</strong> telepítési tanúsítvány<sup>1</sup> birtokában érvényesíthető.</p>
        <p className="purchase-paragraph"><strong>Nyilatkozata megtételével egyidejűleg hozzájárul, hogy fentiekben megadott adatait a forgalmazó megismerje, kezelje, nyilvántartsa.</strong></p>
        <section className="purchase-signatures">
          <div className="purchase-date">{field("Kelt:", issuedDate)}</div>
          <div className="purchase-signature">
            {signature ? <img src={signature} alt="Telepíttető aláírása"/> : <div className="purchase-signature-space"/>}
            <div className="purchase-signature-line">Telepíttető</div>
          </div>
        </section>
        <footer className="purchase-footnote"><sup>1</sup> A klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. § (7)-(10) bekezdései alapján</footer>
      </article>
      {report.privacyNotice ? <PrivacyNoticeDocument notice={report.privacyNotice} revokedAt={report.privacyConsentRevokedAt} /> : null}
    </>
  );
}

export function QuoteDocument({ customer, quoteItems, quoteIssuedAt, workspaceSettings }: { customer: Customer; quoteItems: QuoteItem[]; quoteIssuedAt?: string; workspaceSettings?: WorkspaceSettings }) {
  const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
  const sum = total(items);
  const quoteIsAlternatives = isQuoteAlternatives(customer.quotePricingMode);
  const shownQuoteIssuedAt = formatQuoteIssuedAt(quoteIssuedAt);
  const settings = workspaceSettings || defaultWorkspaceSettings(null);
  const quote = settings.quoteSettings;
  const company = settings.companyProfile;
  const footerLines = settingsCustomerDocumentFooterLines(settings, "quote");
  const contactLine = settingsContactLine(settings);
  const primaryContact = settingsPrimaryContact(settings);
  const quoteTitle = quote.title || `${company.displayName || "AlinFlow"} árajánlat`;
  const installationLines = settingsContentLines(quote.installationSectionContent);
  const qualityLines = settingsContentLines(quote.qualitySectionContent);

  return <article className="mx-auto max-w-[760px] rounded-3xl bg-white p-6 text-slate-950 shadow-2xl print:max-w-none print:rounded-none print:p-0 print:shadow-none">
    <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-4">
        {company.logoUrl ? <img src={company.logoUrl} alt={`${company.displayName || "AlinFlow"} logo`} className="h-16 w-auto object-contain" /> : null}
        <div>
          <h2 className="text-3xl font-black">{quoteTitle}</h2>
          <p className="mt-2 text-sm text-slate-600">{quote.subtitle}</p>
        </div>
      </div>
      <div className="text-sm text-slate-600 md:text-right">
        <p>Árajánlat időpontja: {shownQuoteIssuedAt}</p>
        <p>Ajánlat érvényessége: {quote.validityDays} nap</p>
        {primaryContact ? <p>Kapcsolat: {primaryContact}</p> : null}
        {contactLine ? <p>{contactLine}</p> : null}
      </div>
    </div>

    <div className="mt-6 rounded-2xl bg-slate-100 p-5">
      <p className="text-sm text-slate-500">Ügyfél</p>
      <p className="mt-1 text-2xl font-black">{customer.name || "Nincs név"}</p>
      <p className="mt-2">{fullCustomerAddress(customer) || "nincs cím"}</p>
      {customer.email ? <p>{customer.email}</p> : null}
      {customer.phone ? <p>{customer.phone}</p> : null}
    </div>

    <div className="mt-4 rounded-2xl bg-slate-100 p-5">
      <p className="text-sm text-slate-500">Ajánlat összesítő</p>
      {quoteIsAlternatives ? <>
        <p className="mt-1 text-3xl font-black">Választható ajánlatok</p>
        <p className="mt-1 text-sm text-slate-600">A tételek külön-külön értendők, nem összeadandóak.</p>
      </> : <>
        <p className="mt-1 text-3xl font-black">{ft(sum)}</p>
        <p className="mt-1 text-sm text-slate-600">Bruttó végösszeg alapszereléssel</p>
      </>}
    </div>

    <div className="mt-6 space-y-3">
      {items.map((item, index) => {
        const media = itemProductMedia(item);
        return <div key={`${item.productId}-${index}`} className="rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            {media.imageUrl ? <img src={media.imageUrl} alt={itemName(item)} className="h-20 w-20 shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-1" /> : null}
            <div>
            {quoteIsAlternatives ? <span className="mb-2 inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-700">{index + 1}. lehetőség</span> : null}
            <p className="text-lg font-black">{itemQuantity(item)} db · {itemName(item)}</p>
            <p className="mt-1 text-sm text-slate-600">{ft(itemUnitPrice(item))} / db · telepítéssel együtt</p>
            {media.productUrl ? <a href={media.productUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-black text-cyan-700 underline">Termék megtekintése a KLIMAlin oldalon</a> : null}
            </div>
          </div>
          <p className="text-xl font-black">{quoteIsAlternatives ? "Ajánlati ár: " : ""}{ft(itemTotal(item))}</p>
        </div>
      </div>;
      })}
    </div>

    <div className="mt-6 rounded-2xl bg-slate-100 p-5 text-sm leading-relaxed">
      <h3 className="text-lg font-black">{quote.installationSectionTitle}</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        {installationLines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </div>

    <div className="mt-4 rounded-2xl bg-slate-100 p-5 text-sm leading-relaxed">
      <h3 className="text-lg font-black">{quote.qualitySectionTitle}</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        {qualityLines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </div>

    <div className="mt-8 text-sm text-slate-700">
      <p>Üdvözlettel,</p>
      {footerLines.map((line, index) => (
        <p key={`${line}-${index}`} className={index === 0 ? "font-black" : undefined}>{line}</p>
      ))}
    </div>
  </article>;
}

export function AppointmentConfirmationDocument({ customer, quoteItems, workspaceSettings }: { customer: Customer; quoteItems: QuoteItem[]; workspaceSettings?: WorkspaceSettings }) {
  const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
  const settings = workspaceSettings || defaultWorkspaceSettings(null);
  const company = settings.companyProfile;
  const brandName = settingsBrandName(settings);
  const footerLines = settingsCustomerDocumentFooterLines(settings, "email");
  const contactLine = settingsContactLine(settings);
  const primaryContact = settingsPrimaryContact(settings);
  const appointmentTitle = appointmentDocumentTitle(customer.appointmentType).replace("KLIMAlin", brandName);
  const appointmentLabel = appointmentTypeLabel(customer.appointmentType);
  const appointmentTime = appointmentTimeRangeLabel(customer);
  const workLabel = appointmentWorkLabel(customer.appointmentType);
  const isInstallationAppointment = normalizeAppointmentType(customer.appointmentType) === "installation";
  return <article className="mx-auto max-w-[760px] rounded-3xl bg-white p-6 text-slate-950 shadow-2xl print:max-w-none print:rounded-none print:p-0 print:shadow-none">
    <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-4">
        {company.logoUrl ? <img src={company.logoUrl} alt={`${company.displayName || "AlinFlow"} logo`} className="h-16 w-auto object-contain" /> : null}
        <div>
          <h2 className="text-3xl font-black">{appointmentTitle}</h2>
          <p className="mt-2 text-sm text-slate-600">{appointmentLabel} időpont és helyszín összesítő</p>
        </div>
      </div>
      <div className="text-sm text-slate-600 md:text-right">
        {primaryContact ? <p>Kapcsolat: {primaryContact}</p> : null}
        {contactLine ? <p>{contactLine}</p> : null}
      </div>
    </div>

    <div className="mt-6 rounded-2xl bg-slate-100 p-5 text-sm leading-relaxed">
      <p className="text-lg font-black">Tisztelt {customer.name || "Ügyfelünk"}!</p>
      <p className="mt-3">{appointmentEmailIntro(customer.appointmentType)} Kérjük, hogy a megadott időpontban a helyszín legyen hozzáférhető.</p>
    </div>

    <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="rounded-2xl bg-slate-100 p-4">
        <p className="text-sm text-slate-500">Ügyfél</p>
        <p className="mt-1 text-xl font-black">{customer.name || "Nincs név"}</p>
        {customer.email ? <p className="mt-1">{customer.email}</p> : null}
        {customer.phone ? <p>{customer.phone}</p> : null}
      </div>
      <div className="rounded-2xl bg-slate-100 p-4">
        <p className="text-sm text-slate-500">Időpont</p>
        <p className="mt-1 text-xl font-black">{customer.date ? formatDocumentDate(customer.date) : "nincs időpont"}</p>
        <p className="mt-1 font-bold">{appointmentTime}</p>
        <p className="mt-1 text-sm text-slate-600">Típus: {appointmentLabel}</p>
      </div>
    </div>

    <div className="mt-4 rounded-2xl bg-slate-100 p-4">
      <p className="text-sm text-slate-500">Helyszín</p>
      <p className="mt-1 text-lg font-black">{fullCustomerAddress(customer) || "nincs megadva"}</p>
    </div>

    <div className="mt-6 space-y-3">
      {isInstallationAppointment && items.length ? items.map((item, i)=><div key={`${item.productId}-${i}`} className="rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-lg font-black">{itemQuantity(item)} db · {itemName(item)}</p>
          <p className="text-sm text-slate-600">szereléssel együtt</p>
        </div>
      </div>) : <div className="rounded-2xl border border-slate-200 p-4"><p className="text-lg font-black">{workLabel}</p></div>}
    </div>

    <div className="mt-6 rounded-2xl border border-slate-200 p-5 text-sm leading-relaxed">
      <p className="font-black">Fontos tudnivalók</p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-700">
        {appointmentDocumentNotes(customer.appointmentType).map((note) => <li key={note}>{note}</li>)}
      </ul>
    </div>

    <div className="mt-8 text-sm text-slate-700">
      <p>Üdvözlettel,</p>
      {footerLines.map((line, index) => (
        <p key={`${line}-${index}`} className={index === 0 ? "font-black" : undefined}>{line}</p>
      ))}
    </div>
  </article>;
}
