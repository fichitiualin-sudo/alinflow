import { useEffect, useRef, useState } from "react";
import { ft } from "@/lib/alinflow/format";
import { grossPurchasePrice } from "@/lib/alinflow/warehouse-value";
import {
  inventoryPriceKey, listInventoryPurchasePrices, saveInventoryPurchasePrice, parsePurchasePrice,
  type InventoryPriceItem, type InventoryPurchasePrice, type PurchaseTaxBasis,
} from "@/lib/alinflow/inventory-purchase-prices";

export function useInventoryPurchasePrices(workspaceId?: string) {
  const [prices, setPrices] = useState<Map<string, InventoryPurchasePrice>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    setPrices(new Map());
    setLoading(true);
    setError("");
    if (!workspaceId) {
      setError("A beszerzési árakhoz jelentkezz be egy munkaterületre.");
      setLoading(false);
      return;
    }
    void listInventoryPurchasePrices(workspaceId).then((records) => {
      if (generation.current === request) setPrices(new Map(records.map((record) => [inventoryPriceKey(record), record])));
    }).catch((failure: unknown) => {
      if (generation.current === request) setError(failure instanceof Error ? failure.message : "A beszerzési árak nem tölthetők be.");
    }).finally(() => {
      if (generation.current === request) setLoading(false);
    });
    return () => { generation.current++; };
  }, [workspaceId, retry]);

  async function save(item: InventoryPriceItem, value: string, basis: PurchaseTaxBasis) {
    if (!workspaceId || loading || error) throw new Error("A beszerzési árak betöltése szükséges a mentéshez.");
    const request = generation.current;
    const saved = await saveInventoryPurchasePrice(workspaceId, item, value, basis, prices.get(inventoryPriceKey(item)));
    if (request !== generation.current) throw new Error("A raktár közben megváltozott. Nyisd meg újra az aktuális készletet.");
    setPrices((previous) => new Map(previous).set(inventoryPriceKey(saved), saved));
    return saved;
  }
  return { prices, loading, error, retry: () => setRetry((previous) => previous + 1), save };
}

type PriceEditorProps = {
  item: InventoryPriceItem;
  itemName: string;
  unit: string;
  price?: InventoryPurchasePrice;
  disabled: boolean;
  onSave: (item: InventoryPriceItem, value: string, basis: PurchaseTaxBasis) => Promise<InventoryPurchasePrice>;
};

export function InventoryPurchasePriceEditor({ item, itemName, unit, price, disabled, onSave }: PriceEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [basis, setBasis] = useState<PurchaseTaxBasis>("gross");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const grossPrice = grossPurchasePrice(price);
  let previewGross: number | null = null;
  if (editing) {
    try { previewGross = grossPurchasePrice({ purchasePrice: parsePurchasePrice(value), taxBasis: basis }); }
    catch { /* An incomplete input is validated when saving. */ }
  }

  function edit() {
    setValue(price?.purchasePrice === null || price?.purchasePrice === undefined ? "" : String(price.purchasePrice));
    setBasis(price?.taxBasis || "gross");
    setMessage("");
    setEditing(true);
  }
  async function save() {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      await onSave(item, value, basis);
      if (mounted.current) { setEditing(false); setMessage("Beszerzési ár mentve."); }
    } catch (failure) {
      if (mounted.current) setMessage(failure instanceof Error ? failure.message : "A beszerzési ár mentése sikertelen.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <div className="mt-4 rounded-2xl border border-amber-200/15 bg-amber-200/5 p-3 print:hidden" data-internal-purchase-price>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-sm">
        <p className="text-slate-400">Bruttó beszerzési egységár · belső</p>
        <p className="mt-1 font-black text-amber-100">{disabled ? "Nem elérhető" : grossPrice === null ? "Nincs megadva" : `${ft(grossPrice)} / ${unit}`}</p>
      </div>
      {!editing ? <button type="button" disabled={disabled} aria-label={`Beszerzési ár megadása vagy módosítása: ${itemName}`} onClick={edit} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold disabled:opacity-40">{price?.purchasePrice === null || price?.purchasePrice === undefined ? "Ár megadása" : "Ár módosítása"}</button> : null}
    </div>
    {editing ? <div className="mt-3 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold">Beszerzési ár (Ft / {unit})
          <input autoFocus value={value} disabled={busy || disabled} onChange={(event) => setValue(event.target.value)} inputMode="decimal" placeholder="Nincs megadva" className="input mt-1" />
        </label>
        <label className="text-sm font-bold">Ár típusa
          <select value={basis} disabled={busy || disabled} onChange={(event) => setBasis(event.target.value as PurchaseTaxBasis)} className="input mt-1">
            <option value="gross">Bruttó (áfával)</option><option value="net">Nettó (áfa nélkül)</option>
          </select>
        </label>
      </div>
      <p className="text-sm text-slate-300">Nettó ár megadásakor 27% áfával számolunk.{previewGross !== null ? <span className="mt-1 block font-bold text-amber-100">Bruttó egységár: {ft(previewGross)} / {unit}</span> : null}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={busy || disabled} className="rounded-xl bg-emerald-300 px-4 py-2 font-black text-slate-950 disabled:opacity-40">{busy ? "Mentés..." : "Beszerzési ár mentése"}</button>
        <button type="button" disabled={busy} onClick={() => { setEditing(false); setMessage(""); }} className="rounded-xl bg-white/10 px-4 py-2 font-bold disabled:opacity-40">Mégse</button>
      </div>
    </div> : null}
    {message ? <p role="status" className="mt-2 text-sm text-amber-100">{message}</p> : null}
  </div>;
}
