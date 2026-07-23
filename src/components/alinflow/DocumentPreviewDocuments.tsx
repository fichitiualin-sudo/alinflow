import type { Customer, QuoteItem, SellerCompany, WorkReport } from "@/lib/alinflow/types";
import type { WorkspaceSettings } from "@/lib/alinflow/workspace-settings";
import { ft, fullCustomerAddress } from "@/lib/alinflow/format";
import { isQuoteAlternatives, itemName, itemQuantity, itemTotal, itemUnitPrice, total } from "@/lib/alinflow/products";
import { defaultWorkDescription, formatSignedAt, hasValidWorkReportSignature, workAcceptanceText, workReportTitle } from "@/lib/alinflow/work-report";
import { appointmentDocumentTitle, appointmentEmailIntro, appointmentTimeLabel, appointmentTimeRangeLabel, appointmentTypeLabel, appointmentWorkLabel, normalizeAppointmentType } from "@/lib/alinflow/appointments";
import { DEFAULT_SELLER_COMPANY } from "@/lib/alinflow/purchase-declarations";
import { defaultWorkspaceSettings, settingsBrandName, settingsContactLine, settingsContentLines, settingsFooterLines, settingsPrimaryContact } from "@/lib/alinflow/workspace-settings";

function formatDocumentDate(value?: string) {
  if (!value) return "nincs megadva";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

function dottedLine(value?: string) {
  return <span className="inline-block min-w-[180px] border-b border-dotted border-slate-900 px-1 pb-0.5 font-bold">{value || "\u00A0"}</span>;
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
  const footerLines = settingsFooterLines(workspaceSettings || defaultWorkspaceSettings(null), "workReport");
  const workType = appointmentTypeLabel(reportCustomer.appointmentType);
  const workTime = reportCustomer.time ? appointmentTimeLabel(reportCustomer.appointmentType, reportCustomer.time, items) : appointmentTimeRangeLabel(reportCustomer);
  const workTitle = workReportTitle(reportCustomer.appointmentType);
  const workNote = appointmentWorkLabel(reportCustomer.appointmentType);
  const workDate = reportCustomer.date;
  return (
    <article className="doc-print-page work-report-doc mx-auto max-w-[210mm] rounded-3xl bg-white p-8 font-serif text-[13px] leading-snug text-slate-950 shadow-2xl print:m-0 print:h-[297mm] print:min-h-[297mm] print:w-[210mm] print:max-w-[210mm] print:overflow-hidden print:rounded-none print:border-0 print:p-[14mm] print:text-[11.5px] print:shadow-none">
      <div className="text-center">
        <h2 className="text-xl font-black leading-none tracking-tight print:text-[17px]">{workTitle.toUpperCase()}</h2>
        <p className="mt-1 text-xs font-bold print:text-[9.5px]">az elvégzett munka és átadás-átvétel visszaigazolására</p>
      </div>

      <div className="mt-4 space-y-3 print:mt-3 print:space-y-2">
        <section>
          <h3 className="mb-1 font-black">Ügyfél adatai:</h3>
          <div className="ml-3 space-y-0.5">
            <p>neve: {dottedLine(customer.name)}</p>
            <p>címe: {dottedLine(fullCustomerAddress(customer))}</p>
            <p>telefonszáma: {dottedLine(customer.phone)}</p>
            <p>email címe: {dottedLine(customer.email)}</p>
          </div>
        </section>

        <section>
          <h3 className="mb-1 font-black">Munka adatai:</h3>
          <div className="ml-3 space-y-0.5">
            <p>munka típusa: {dottedLine(workType)}</p>
            <p>munka dátuma: {dottedLine(formatDocumentDate(workDate))}</p>
            <p>idősáv: {dottedLine(workTime)}</p>
            <p>helyszín: {dottedLine(fullCustomerAddress(customer))}</p>
          </div>
        </section>

        <section>
          <table className="w-full border-collapse text-[11px] print:text-[9.5px]">
            <thead>
              <tr>
                <th className="border border-slate-900 p-1.5 text-center print:p-1">Készülék megnevezése</th>
                <th className="w-16 border border-slate-900 p-1.5 text-center print:p-1">Darab</th>
                <th className="w-32 border border-slate-900 p-1.5 text-center print:p-1">Megjegyzés</th>
              </tr>
            </thead>
            <tbody>
              {shownItems.map((item, index)=><tr key={`${item.productId}-${index}`}>
                <td className="border border-slate-900 p-1.5 print:p-1">{itemName(item)}</td>
                <td className="border border-slate-900 p-1.5 text-center font-bold print:p-1">{itemQuantity(item)}</td>
                <td className="border border-slate-900 p-1.5 print:p-1">{workNote}</td>
              </tr>)}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="mb-1 font-black">Elvégzett munka:</h3>
          <p className="whitespace-pre-wrap border border-slate-900 p-2.5 text-justify print:p-2">{report.workDescription || defaultWorkDescription(reportCustomer.appointmentType)}</p>
        </section>

        <section>
          <h3 className="mb-1 font-black">Átadás-átvételi nyilatkozat:</h3>
          <p className="border border-slate-900 p-2.5 text-justify print:p-2">{workAcceptanceText(reportCustomer.appointmentType)}</p>
        </section>

        {report.notes ? <section><h3 className="mb-1 font-black">Megjegyzés:</h3><p className="whitespace-pre-wrap border border-slate-900 p-2 print:p-1.5">{report.notes}</p></section> : null}

        <section className="mt-4 flex items-end justify-between gap-4 print:mt-3">
          <div className="min-w-0">
            <p>Kelt: {dottedLine(formatDocumentDate(workDate) || new Date().toLocaleDateString("hu-HU"))}</p>
          </div>
          <div className="w-[56mm] text-center">
            {report.signatureDataUrl ? <img src={report.signatureDataUrl} alt="Ügyfél aláírása" className="mx-auto mb-1 max-h-[22mm] max-w-full object-contain print:max-h-[18mm]"/> : <div className="mb-1 h-[18mm] border border-dashed border-slate-400"/>}
            <div className="border-t border-slate-900 pt-1 italic">Ügyfél aláírása</div>
            {hasValidWorkReportSignature(report) ? <p className="mt-0.5 text-[10px] print:text-[8.5px]">Aláírva: {formatSignedAt(report.signedAt)}</p> : null}
          </div>
        </section>

        <div className="border-t border-slate-900 pt-1 text-[10px] leading-tight print:text-[8.5px]">
          Üdvözlettel,<br />
          {footerLines.map((line, index) => (
            <span key={`${line}-${index}`}>{index === 0 ? <strong>{line}</strong> : line}{index < footerLines.length - 1 ? <br /> : null}</span>
          ))}
        </div>
      </div>
    </article>
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

export function PurchaseDeclarationDocument({ customer, report, quoteItems, seller }: { customer: Customer; report: WorkReport; quoteItems: QuoteItem[]; seller?: SellerCompany }) {
  const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
  const shownItems = items.length ? items : [{ productId: "", quantity: 1, customName: "Nincs klíma megadva", isManual: true }];
  const shownSeller = seller || DEFAULT_SELLER_COMPANY;
  return (
    <article className="doc-print-page purchase-doc mx-auto max-w-[210mm] rounded-3xl bg-white p-8 font-serif text-[12px] leading-snug text-slate-950 shadow-2xl print:m-0 print:h-[297mm] print:min-h-[297mm] print:w-[210mm] print:max-w-[210mm] print:overflow-hidden print:rounded-none print:border-0 print:p-[12mm] print:text-[10px] print:leading-[1.2] print:shadow-none">
      <div className="text-center">
        <h2 className="text-lg font-black leading-none tracking-tight print:text-[15px]">VÁSÁRLÁSI<br />NYILATKOZAT</h2>
        <p className="mt-1 text-[10px] font-bold leading-tight print:text-[8.3px]">a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet<br />28. § (5) bekezdése alapján</p>
      </div>

      <div className="mt-3 space-y-2 print:mt-2 print:space-y-1.5">
        <section>
          <h3 className="font-black">Az értékesítő vállalkozás adatai:</h3>
          <div className="ml-3 mt-0.5 space-y-0.5">
            <p>neve: {dottedLine(shownSeller.name)}</p>
            <p>adószáma: {dottedLine(shownSeller.taxNumber)}</p>
            <p>a képviseletében eljáró természetes személy neve: {dottedLine(shownSeller.representative)}</p>
          </div>
        </section>

        <section>
          <h3 className="font-black">A telepíttető adatai:</h3>
          <div className="ml-3 mt-0.5 space-y-0.5">
            <p className="font-bold">A.) Vállalkozás, intézmény, egyéb adószámmal rendelkező szervezet</p>
            <p>neve: {dottedLine("")}</p>
            <p>adószáma: {dottedLine("")}</p>
            <p>a képviseletében eljáró természetes személy neve: {dottedLine("")}</p>
            <p className="mt-1 font-bold">B.) Természetes személy</p>
            <p>neve: {dottedLine(customer.name || report.signerName)}</p>
            <p>lakcíme: {dottedLine(fullCustomerAddress(customer))}</p>
          </div>
        </section>

        <p className="text-justify text-[10.2px] leading-tight print:text-[8.6px]">Telepíttető – megfelelve az Európai Parlament és a Tanács 2024/573 Rendeletében, valamint a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. §-ban foglaltaknak – jelen nyilatkozat aláírásával kötelezettséget vállal arra, hogy az alábbi telepítési tanúsítvány-köteles berendezés(ek) telepítését és beüzemelését az arra képesítéssel rendelkező vállalkozás képesített alkalmazottjával fogja elvégeztetni.</p>

        <table className="w-full border-collapse text-[10.5px] print:text-[8.6px]">
          <thead>
            <tr>
              <th className="border border-slate-900 p-1.5 text-center print:p-1">Termék megnevezése</th>
              <th className="w-[34%] border border-slate-900 p-1.5 text-center print:p-1">Megvásárolt termékek darabszáma</th>
            </tr>
          </thead>
          <tbody>
            {shownItems.map((item, index)=><tr key={`${item.productId}-${index}`}>
              <td className="border border-slate-900 p-1.5 print:p-1">{itemName(item)}</td>
              <td className="border border-slate-900 p-1.5 text-center font-bold print:p-1">{itemQuantity(item)}</td>
            </tr>)}
          </tbody>
        </table>

        <p className="text-[9.5px] leading-tight print:text-[7.9px]">*Több berendezés típus vásárlása esetén a táblázat sorainak száma bővíthető egyéni szerkesztéssel</p>
        <p className="text-justify text-[10.2px] leading-tight print:text-[8.6px]">Telepíttető tudomásul veszi, hogy a telepítési tanúsítvány-köteles berendezéssel kapcsolatos jótállás telepítési tanúsítvány<sup>1</sup> birtokában érvényesíthető.</p>
        <p className="text-justify text-[10.2px] font-bold leading-tight print:text-[8.6px]">Nyilatkozata megtételével egyidejűleg hozzájárul, hogy fentiekben megadott adatait a forgalmazó megismerje, kezelje, nyilvántartsa.</p>

        <section className="mt-3 flex items-end justify-between gap-4 print:mt-2">
          <div><p>Kelt: {dottedLine(new Date().toLocaleDateString("hu-HU"))}</p></div>
          <div className="w-[56mm] text-center">
            {report.signatureDataUrl ? <img src={report.signatureDataUrl} alt="Telepíttető aláírása" className="mx-auto mb-1 max-h-[20mm] max-w-full object-contain print:max-h-[15mm]"/> : <div className="mb-1 h-[16mm] border border-dashed border-slate-400"/>}
            <div className="border-t border-slate-900 pt-1 italic">Telepíttető</div>
          </div>
        </section>

        <div className="border-t border-slate-900 pt-1 text-[9px] leading-tight print:text-[7.3px]"><sup>1</sup> A klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. § (7)-(10) bekezdései alapján</div>
      </div>
    </article>
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
  const footerLines = settingsFooterLines(settings, "quote");
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
      {items.map((item, index)=><div key={`${item.productId}-${index}`} className="rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {quoteIsAlternatives ? <span className="mb-2 inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-700">{index + 1}. lehetőség</span> : null}
            <p className="text-lg font-black">{itemQuantity(item)} db · {itemName(item)}</p>
            <p className="mt-1 text-sm text-slate-600">{ft(itemUnitPrice(item))} / db · telepítéssel együtt</p>
          </div>
          <p className="text-xl font-black">{quoteIsAlternatives ? "Ajánlati ár: " : ""}{ft(itemTotal(item))}</p>
        </div>
      </div>)}
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
  const footerLines = settingsFooterLines(settings, "email");
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
