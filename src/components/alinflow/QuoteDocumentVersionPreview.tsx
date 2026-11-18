import { ft } from "@/lib/alinflow/format";
import type { QuoteDocumentVersion } from "@/lib/alinflow/quote-documents";
import type { Customer } from "@/lib/alinflow/types";
import { settingsBrandName, type WorkspaceSettings } from "@/lib/alinflow/workspace-settings";

const dateFormatter = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest", dateStyle: "medium", timeStyle: "short",
});

function documentDate(value?: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? dateFormatter.format(timestamp) : "Nincs rögzítve";
}

type Props = {
  document: QuoteDocumentVersion;
  customer: Customer;
  workspaceSettings: WorkspaceSettings;
};

export function QuoteDocumentVersionPreview({ document, customer, workspaceSettings }: Props) {
  const sent = document.kind === "sent";
  return (
    <article className="mx-auto w-full max-w-[760px] rounded-3xl bg-white p-5 text-slate-950 shadow-2xl sm:p-8 print:max-w-none print:rounded-none print:p-[12mm] print:shadow-none">
      <header className="border-b border-slate-200 pb-5">
        <p className="break-words text-sm font-bold text-slate-600">{settingsBrandName(workspaceSettings)}</p>
        <h2 className="mt-1 text-3xl font-black">Árajánlat</h2>
      </header>
      <dl className="my-6 grid grid-cols-1 gap-4 rounded-2xl bg-slate-100 p-4 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <dt className="text-sm text-slate-600">Ügyfél</dt>
          <dd className="break-words font-bold">{customer.name || "Nincs rögzítve"}</dd>
        </div>
        {sent && document.recipient && <div>
          <dt className="text-sm text-slate-600">Címzett</dt>
          <dd className="break-all font-bold">{document.recipient}</dd>
        </div>}
        {sent && <div>
          <dt className="text-sm text-slate-600">Kiállítva</dt>
          <dd>{documentDate(document.issuedAt)}</dd>
        </div>}
        <div>
          <dt className="text-sm text-slate-600">{sent ? "Elküldve" : "Mentve"}</dt>
          <dd>{documentDate(document.timestamp)}</dd>
        </div>
      </dl>
      <h3 className="mb-3 text-lg font-black">{document.alternatives ? "Választható ajánlatok" : "Ajánlati tételek"}</h3>
      {document.items.length ? (
        <ol className="space-y-3">
          {document.items.map((item, index) => (
            <li key={index} className="quote-item rounded-2xl border border-slate-200 p-4">
              {document.alternatives && <p className="mb-1 text-sm font-bold text-cyan-800">{index + 1}. lehetőség</p>}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between print:flex-row">
                <div className="min-w-0">
                  <p className="break-words text-lg font-black">{item.name}</p>
                  <p className="text-sm text-slate-600">
                    {item.quantity === null ? "Mennyiség nincs rögzítve" : `${item.quantity} db`}
                    {item.unitPrice !== null && <span> · {ft(item.unitPrice)} / db</span>}
                  </p>
                  {item.productUrl?.startsWith("https://klimalin.hu/") &&
                    <a href={item.productUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-cyan-800 underline">Termék megtekintése</a>}
                </div>
                <p className="shrink-0 font-bold sm:text-right">{item.totalPrice === null ? "Tételár nincs rögzítve" : ft(item.totalPrice)}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="text-slate-600">A tételsorok nem állnak rendelkezésre.</p>}
      {!document.alternatives && (
        <div className="mt-6 break-inside-avoid border-t border-slate-300 pt-4">
          <p className="text-sm text-slate-600">Bruttó végösszeg</p>
          <p className="text-2xl font-black">{document.total === null ? "Nincs rögzítve" : ft(document.total)}</p>
        </div>
      )}
    </article>
  );
}
