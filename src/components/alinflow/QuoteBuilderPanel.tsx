"use client";

import type { ClimateProduct, Customer, QuoteItem, QuotePricingMode } from "@/lib/alinflow/types";
import { ft } from "@/lib/alinflow/format";
import { hasCustomProductPrice, isCustomQuoteItem, isQuoteAlternatives, itemPriceLine, itemTotal, itemUnitPrice, prod, sortProducts } from "@/lib/alinflow/products";
import { Back, Btn, Card, Gradient, Layout, Main, Shell, Side } from "@/components/alinflow/LayoutPrimitives";

type QuoteBuilderPanelProps = {
  selected: Customer;
  quoteItems: QuoteItem[];
  products: ClimateProduct[];
  totalAmount: number;
  installerAmount: number;
  materialAmount: number;
  quoteEmailBusy: boolean;
  canEditWorkResources: boolean;
  quotePricingMode: QuotePricingMode;
  onBack: () => void;
  onPreview: () => void;
  onSendQuoteEmail: () => void;
  onSchedule: () => void;
  onQuotePricingModeChange: (value: QuotePricingMode) => void;
  onUpdateQuoteItem: (index: number, key: keyof QuoteItem, value: string | number | boolean) => void;
  onUpdateQuoteProduct: (index: number, productId: string) => void;
  onRemoveQuoteItem: (index: number) => void;
  onSyncQuoteItemPrice: (index: number) => void;
  onAddQuoteItem: () => void;
  onAddManualQuoteItem: () => void;
};

function ProductSelect({ products, value, onChange, disabled = false }: { products: ClimateProduct[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const sorted = sortProducts(products);
  const selectValue = sorted.some((product) => product.id === value) ? value : "";
  return (
    <select value={selectValue} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="input disabled:cursor-not-allowed disabled:opacity-60">
      <option value="">Válassz klímát...</option>
      {sorted.map((product: any) => (
        <option key={product.id} value={product.id}>{product.name}</option>
      ))}
    </select>
  );
}

function numericInputValue(value: string) {
  if (value === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, numeric) : "";
}

function priceInputValue(value: string) {
  if (value === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : "";
}

export function QuoteBuilderPanel({
  quoteItems,
  products,
  totalAmount,
  quoteEmailBusy,
  canEditWorkResources,
  quotePricingMode,
  onBack,
  onPreview,
  onSendQuoteEmail,
  onSchedule,
  onQuotePricingModeChange,
  onUpdateQuoteItem,
  onUpdateQuoteProduct,
  onRemoveQuoteItem,
  onSyncQuoteItemPrice,
  onAddQuoteItem,
  onAddManualQuoteItem,
}: QuoteBuilderPanelProps) {
  const quoteIsAlternatives = isQuoteAlternatives(quotePricingMode);

  return (
    <Shell>
      <Back onClick={onBack} />
      <Layout>
        <Main>
          <Card title="Ajánlatban szereplő tételek">
            <div className="space-y-3">
              {quoteItems.map((item, index) => (
                <div key={index} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_150px_44px]">
                    {isCustomQuoteItem(item) ? (
                      <input className="input" value={item.customName || ""} onChange={(event) => onUpdateQuoteItem(index, "customName", event.target.value)} placeholder="Klíma/tétel megnevezése" />
                    ) : (
                      <ProductSelect products={products} value={item.productId} onChange={(value) => onUpdateQuoteProduct(index, value)} />
                    )}
                    <input className="input" type="number" min={1} value={item.quantity} onChange={(event) => onUpdateQuoteItem(index, "quantity", numericInputValue(event.target.value))} />
                    <input className="input" type="number" min={0} value={item.customPrice ?? itemUnitPrice(item)} onChange={(event) => onUpdateQuoteItem(index, "customPrice", priceInputValue(event.target.value))} />
                    <button className="rounded-xl bg-white/10 font-black disabled:cursor-not-allowed disabled:opacity-40" disabled={!canEditWorkResources} onClick={() => onRemoveQuoteItem(index)}>×</button>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-white/5 p-3 text-sm md:flex-row md:items-center md:justify-between">
                    <span>{itemPriceLine(item)}{hasCustomProductPrice(item) ? " · kézzel módosított ár" : ""}</span>
                    <b>{ft(itemTotal(item))}</b>
                  </div>
                  {hasCustomProductPrice(item) ? (
                    <button type="button" disabled={!canEditWorkResources} onClick={() => onSyncQuoteItemPrice(index)} className="mt-2 w-full rounded-2xl bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-40">
                      Ár frissítése a klíma listaárára: {ft(prod(item.productId).price)}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-3 md:flex-row">
              <button className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950" onClick={onAddQuoteItem}>+ Klíma hozzáadása</button>
              <button className="rounded-2xl bg-amber-300 px-5 py-4 font-black text-slate-950" onClick={onAddManualQuoteItem}>+ Egyedi tétel</button>
            </div>
            <div className="mt-5 flex flex-col gap-2 rounded-3xl bg-cyan-300 p-5 text-slate-950 md:flex-row md:items-center md:justify-between">
              <b className="text-xl">{quoteIsAlternatives ? "Választható ajánlatok" : "Összesen"}</b>
              <b className="text-2xl">{quoteIsAlternatives ? `${quoteItems.length} lehetőség` : ft(totalAmount)}</b>
            </div>
          </Card>
        </Main>
        <Side>
          <Gradient title="Ajánlat státusz" value="Küldésre kész" />
          <Card title="Árajánlat értelmezése">
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm font-bold text-slate-200">
              <input
                type="checkbox"
                checked={quoteIsAlternatives}
                onChange={(event) => onQuotePricingModeChange(event.target.checked ? "alternatives" : "bundle")}
                className="mt-1 h-5 w-5 accent-cyan-300"
              />
              <span className="block text-base font-black text-slate-100">Ne adja össze a tételeket</span>
            </label>
            {quoteIsAlternatives ? (
              <div className="mt-3 rounded-2xl bg-cyan-300 p-4 text-sm font-black text-slate-950">
                Külön ajánlatokként megy ki
              </div>
            ) : null}
          </Card>
          <Card title="Gyors műveletek">
            <div className="space-y-3 [&>button]:w-full">
              <Btn color="cyan" onClick={onPreview}>Ajánlat előnézet</Btn>
              <button onClick={onSendQuoteEmail} disabled={quoteEmailBusy} className="block w-full rounded-2xl bg-gradient-to-br from-emerald-400 to-green-500 px-5 py-4 text-center font-black text-slate-950 shadow-xl disabled:cursor-wait disabled:opacity-60">
                {quoteEmailBusy ? "Küldés folyamatban..." : "Ajánlat küldése emailben"}
              </button>
              <Btn color="blue" onClick={onSchedule}>Időpont keresése</Btn>
            </div>
          </Card>
        </Side>
      </Layout>
    </Shell>
  );
}
