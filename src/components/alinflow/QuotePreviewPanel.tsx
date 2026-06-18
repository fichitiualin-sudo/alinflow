import type { Customer, QuoteItem, QuotePricingMode } from "@/lib/alinflow/types";
import { displayAddress, ft } from "@/lib/alinflow/format";
import { isQuoteAlternatives, itemName, itemPriceLine, itemQuantity, itemTotal } from "@/lib/alinflow/products";
import { Back, Btn, Card, Layout, Main, Shell, Side } from "@/components/alinflow/LayoutPrimitives";

type QuotePreviewPanelProps = {
  selected: Customer;
  quoteItems: QuoteItem[];
  totalAmount: number;
  installerAmount: number;
  materialAmount: number;
  quoteEmailBusy: boolean;
  quoteIssuedAt: string;
  onBack: () => void;
  onPrint: () => void;
  onSendQuote: () => void;
  onSchedule: () => void;
  onQuotePricingModeChange: (value: QuotePricingMode) => void;
};

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

export function QuotePreviewPanel({
  selected,
  quoteItems,
  totalAmount,
  installerAmount,
  materialAmount,
  quoteEmailBusy,
  quoteIssuedAt,
  onBack,
  onPrint,
  onSendQuote,
  onSchedule,
  onQuotePricingModeChange,
}: QuotePreviewPanelProps) {
  const quoteIsAlternatives = isQuoteAlternatives(selected.quotePricingMode);
  const shownQuoteIssuedAt = formatQuoteIssuedAt(quoteIssuedAt);

  return (
    <Shell>
      <div className="no-print">
        <Back onClick={onBack} />
      </div>
      <Layout>
        <Main>
          <Card title="KLIMAlin árajánlat">
            <div className="quote-print rounded-[2rem] bg-white p-6 text-slate-950 print:bg-white print:text-black">
              <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-4">
                  <img src="/alin-klima-logo.png" alt="KLIMAlin logo" className="h-20 w-auto object-contain" />
                  <div>
                    <h2 className="text-3xl font-black">KLIMAlin árajánlat</h2>
                    <p className="mt-2 text-sm text-slate-600">Klímaberendezés alapszereléssel együtt</p>
                  </div>
                </div>
                <div className="text-sm text-slate-600 md:text-right">
                  <p>Árajánlat időpontja: {shownQuoteIssuedAt}</p>
                  <p>Ajánlat érvényessége: 7 nap</p>
                  <p>Kapcsolat: 06 30 700 4908</p>
                  <p>klimalin.hu</p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-sm text-slate-500">Ügyfél</p>
                  <p className="mt-1 text-xl font-black">{selected.name || "Nincs név"}</p>
                  <p className="mt-1">{displayAddress(selected)}</p>
                  <p>{selected.email}</p>
                  <p>{selected.phone}</p>
                </div>
                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-sm text-slate-500">Ajánlat összesítő</p>
                  {quoteIsAlternatives ? (
                    <>
                      <p className="mt-1 text-xl font-black">Választható ajánlatok</p>
                      <p className="mt-1 text-sm text-slate-600">A tételek külön-külön értendők, nem összeadandóak.</p>
                    </>
                  ) : (
                    <>
                      <p className="mt-1 text-xl font-black">{ft(totalAmount)}</p>
                      <p className="mt-1 text-sm text-slate-600">Bruttó végösszeg alapszereléssel</p>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {quoteItems.map((item, index) => (
                  <div key={index} className="quote-item flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      {quoteIsAlternatives ? (
                        <span className="mb-2 inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-700">
                          {index + 1}. lehetőség
                        </span>
                      ) : null}
                      <p className="font-black">{itemQuantity(item)} db · {itemName(item)}</p>
                      <p className="text-sm text-slate-500">{itemPriceLine(item)}</p>
                    </div>
                    <b>{quoteIsAlternatives ? "Ajánlati ár: " : ""}{ft(itemTotal(item))}</b>
                  </div>
                ))}
              </div>

              <div className="quote-second-page mt-6 rounded-2xl bg-slate-100 p-5">
                <h3 className="text-xl font-black">Alapszerelés tartalma</h3>
                <div className="mt-3 space-y-2 text-sm leading-relaxed">
                  <p>• max. 3 m szigetelt rézcső-pár / klíma</p>
                  <p>• 1 db faláttörés, tömítés és esztétikus lezárás</p>
                  <p>• kondenzvíz elvezetés kialakítása gravitációsan, megfelelő lejtéssel, adottság szerint</p>
                  <p>• kültéri fali konzol vastag rezgéscsillapítókkal, max. 4 m szerelési magasságig, létraállással</p>
                  <p>• kábelcsatorna és rögzítők a szükséges mértékben</p>
                  <p>• betáp kábel max. 5 m-ig</p>
                  <p>• nyomáspróba + vákuumozás + beüzemelés, működési teszt</p>
                  <p>• felhasználói betanítás, rendrakás</p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl bg-slate-100 p-5">
                <h3 className="text-xl font-black">Minőségi kivitelezés</h3>
                <div className="mt-3 space-y-2 text-sm leading-relaxed">
                  <p>• Alukasírozott, hőszigetelt rézcső-pár.</p>
                  <p>• Időjárásálló gumikábel a teljes nyomvonalon.</p>
                  <p>• Stabil konzol + vastag rezgéscsillapítók a kültéri egységnél.</p>
                  <p>• Szakszerű faláttörés, tömítés és esztétikus lezárás.</p>
                  <p>• Nyomáspróba + vákuumozás, majd beüzemelés és működési teszt.</p>
                  <p>• Betanítás, szűrőtisztítás ismertetése + rendrakás a végén.</p>
                </div>
              </div>

              {quoteIsAlternatives ? null : (
                <div className="mt-6 rounded-2xl bg-amber-50 p-5 text-sm text-slate-800">
                  <h3 className="font-black">Belső számlázási bontás</h3>
                  <p className="mt-2">Adorján Alin E.V. – klímatelepítési munkadíj: {ft(installerAmount)}</p>
                  <p>AMOVA 4U Kft. – klímaberendezés + szerelési anyagok: {ft(materialAmount)}</p>
                </div>
              )}

              <div className="mt-6 text-sm text-slate-600">
                <p>Üdvözlettel,</p>
                <p className="font-black text-slate-950">Adorján Alin · KLIMAlin</p>
                <p>klimalin.hu · legkondikalkulator.hu · 06 30 700 4908</p>
              </div>
            </div>
          </Card>
        </Main>
        <Side>
          <div className="no-print">
            <Card title="Ajánlat műveletek">
              <div className="space-y-3">
                <Btn color="blue" onClick={onPrint}>Nyomtatás / mentés PDF-be</Btn>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm font-bold text-slate-200">
                  <input
                    type="checkbox"
                    checked={quoteIsAlternatives}
                    onChange={(event) => onQuotePricingModeChange(event.target.checked ? "alternatives" : "bundle")}
                    className="mt-1 h-5 w-5 accent-cyan-300"
                  />
                  <span>
                    <span className="block text-base font-black text-slate-100">Ne adja össze a tételeket</span>
                  </span>
                </label>
                <button onClick={onSendQuote} disabled={quoteEmailBusy} className="block w-full rounded-2xl bg-emerald-400 px-5 py-4 text-center font-black text-slate-950 disabled:cursor-wait disabled:opacity-60">
                  {quoteEmailBusy ? "Küldés folyamatban..." : "Ajánlat küldése emailben"}
                </button>
                <Btn color="cyan" onClick={onSchedule}>Időpont keresése</Btn>
              </div>
            </Card>
          </div>
        </Side>
      </Layout>
    </Shell>
  );
}
