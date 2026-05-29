"use client";

import type { ClimateProduct, Customer, QuoteItem } from "@/lib/alinflow/types";
import { ft } from "@/lib/alinflow/format";
import { hasCustomProductPrice, isCustomQuoteItem, itemName, itemPriceLine, itemTotal, itemUnitPrice, prod, sortProducts } from "@/lib/alinflow/products";
import { Back, Btn, Card, Gradient, Hero, InfoRow, Layout, Main, Shell, Side } from "@/components/alinflow/LayoutPrimitives";

type QuoteBuilderPanelProps = {
  selected: Customer;
  quoteItems: QuoteItem[];
  products: ClimateProduct[];
  totalAmount: number;
  installerAmount: number;
  materialAmount: number;
  quoteEmailBusy: boolean;
  canEditWorkResources: boolean;
  onBack: () => void;
  onPreview: () => void;
  onSendQuoteEmail: () => void;
  onSchedule: () => void;
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

export function QuoteBuilderPanel({
  selected,
  quoteItems,
  products,
  totalAmount,
  installerAmount,
  materialAmount,
  quoteEmailBusy,
  canEditWorkResources,
  onBack,
  onPreview,
  onSendQuoteEmail,
  onSchedule,
  onUpdateQuoteItem,
  onUpdateQuoteProduct,
  onRemoveQuoteItem,
  onSyncQuoteItemPrice,
  onAddQuoteItem,
  onAddManualQuoteItem,
}: QuoteBuilderPanelProps) {
  return (
    <Shell>
      <Back onClick={onBack} />
      <Hero title="Klíma ajánlat összeállítása" sub={`${selected.name} · ${selected.city}`} action="Ajánlat előnézet" onAction={onPreview} />
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
                    <input className="input" type="number" min={1} value={item.quantity} onChange={(event) => onUpdateQuoteItem(index, "quantity", Math.max(1, Number(event.target.value || 1)))} />
                    <input className="input" type="number" min={0} value={itemUnitPrice(item)} onChange={(event) => onUpdateQuoteItem(index, "customPrice", Math.max(0, Number(event.target.value || 0)))} />
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
          </Card>
          <Card title="Ár és belső bontás">
            {quoteItems.map((item, index) => <InfoRow key={index} label={`${item.quantity} db · ${itemName(item)}`} value={ft(itemTotal(item))} />)}
            <div className="mt-3 flex justify-between rounded-3xl bg-cyan-300 p-5 text-xl text-slate-950"><b>Ügyfél által fizetendő</b><b>{ft(totalAmount)}</b></div>
            <div className="mt-6 rounded-[2rem] border border-white/10 bg-slate-950/70 p-5">
              <InfoRow label="Adorján Alin E.V. — telepítési munkadíj" value={ft(installerAmount)} />
              <InfoRow label="AMOVA 4U Kft. — klíma + szerelési anyagok" value={ft(materialAmount)} />
            </div>
          </Card>
        </Main>
        <Side>
          <Gradient title="Ajánlat státusz" value="Küldésre kész" />
          <Card title="Gyors műveletek">
            <button onClick={onSendQuoteEmail} disabled={quoteEmailBusy} className="block w-full rounded-3xl bg-gradient-to-br from-blue-400 to-indigo-500 px-5 py-4 text-center font-black text-white shadow-xl disabled:cursor-wait disabled:opacity-60">
              {quoteEmailBusy ? "Küldés folyamatban..." : "Ajánlat küldése emailben"}
            </button>
            <Btn color="cyan" onClick={onSchedule}>Időpont keresése</Btn>
          </Card>
        </Side>
      </Layout>
    </Shell>
  );
}
