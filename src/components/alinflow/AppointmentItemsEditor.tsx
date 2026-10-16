"use client";

import type { ClimateProduct, QuoteItem } from "@/lib/alinflow/types";
import { isCustomQuoteItem, itemTotal, itemUnitPrice, sortProducts, total } from "@/lib/alinflow/products";
import { ft } from "@/lib/alinflow/format";

type Props = { items: QuoteItem[]; products: ClimateProduct[]; onChange: (items: QuoteItem[]) => void; extraOnly?: boolean };
const numberValue = (value: string, minimum: number): number | "" => value === "" ? "" : Math.max(minimum, Number(value) || 0);

export function AppointmentItemsEditor({ items, products, onChange, extraOnly = false }: Props) {
  const sortedProducts = sortProducts(products);
  function patch(index: number, value: Partial<QuoteItem>) {
    onChange(items.map((item, row) => row === index ? { ...item, ...value } : item));
  }
  return <section className="min-w-0 rounded-3xl border border-white/10 bg-white/5 p-4" aria-label="Időpont tételei">
    <h3 className="mb-3 font-black">{extraOnly ? "Elvégzendő munka és díja" : "Klímák és egyéb tételek"}</h3>
    <div className="space-y-3">
      {items.map((item, index) => <div key={index} className="min-w-0 rounded-2xl border border-white/10 p-3" role="group" aria-label={`${index + 1}. tétel`}>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] items-end gap-3 md:grid-cols-[minmax(0,1fr)_80px_140px_44px]">
          <label className="col-span-3 min-w-0 md:col-span-1"><span className="mb-1 block text-xs font-bold">{item.itemType === "extra" ? "Egyéb tétel" : "Klíma"}</span>
            {isCustomQuoteItem(item) ? <input className="input" value={item.customName || ""} placeholder={extraOnly ? "Pl. javítás, leszerelés" : "Tétel megnevezése"} onChange={event => patch(index, {customName: event.target.value})} />
              : <select className="input" value={item.productId} onChange={event => {
                const product = sortedProducts.find(value => value.id === event.target.value);
                patch(index, {productId: product?.id || "", productName: product?.name, customName: undefined, isManual: false, customPrice: product?.price ?? "", customInstallPrice: product?.installPrice ?? 0});
              }}><option value="">Válassz klímát...</option>{sortedProducts.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select>}
          </label>
          <label className="min-w-0"><span className="mb-1 block text-xs font-bold">Mennyiség</span><input className="input" type="number" min={1} step={1} value={item.quantity} onChange={event => patch(index, {quantity: numberValue(event.target.value, 1)})} /></label>
          <label className="min-w-0"><span className="mb-1 block text-xs font-bold">Egységár (Ft)</span><input className="input" type="number" min={0} value={item.customPrice ?? itemUnitPrice(item)} onChange={event => patch(index, {customPrice: numberValue(event.target.value, 0)})} /></label>
          <button type="button" aria-label={`${index + 1}. tétel eltávolítása`} className="min-h-11 rounded-xl bg-white/10 px-3 font-black md:col-span-1" onClick={() => onChange(items.filter((_, row) => row !== index))}>×</button>
        </div>
        <p className="mt-2 text-right text-sm font-bold">{ft(itemTotal(item))}</p>
      </div>)}
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      {!extraOnly ? <button type="button" className="min-h-11 rounded-xl bg-cyan-300 px-4 py-2 font-black text-slate-950" onClick={() => onChange([...items, {productId: "", quantity: 1}])}>+ Klíma hozzáadása</button> : null}
      <button type="button" className="min-h-11 rounded-xl bg-amber-300 px-4 py-2 font-black text-slate-950" onClick={() => onChange([...items, {productId: "", quantity: 1, customName: "", customPrice: 0, customInstallPrice: 0, isManual: true, itemType: "extra"}])}>+ Egyéb tétel</button>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cyan-300/15 p-3 font-black"><span>Összesen</span><span>{ft(total(items))}</span></div>
    {!extraOnly ? <p className="mt-2 text-xs text-slate-400">A klímák egységára a szerelést is tartalmazza.</p> : null}
  </section>;
}