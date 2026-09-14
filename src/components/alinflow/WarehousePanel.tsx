import { useRef, useState, type ReactNode } from "react";
import type { ClimateProduct } from "@/lib/alinflow/types";
import { ft } from "@/lib/alinflow/format";
import { inventoryPriceKey } from "@/lib/alinflow/inventory-purchase-prices";
import { groupWarehouseItems, summarizeWarehouseValue } from "@/lib/alinflow/warehouse-value";
import { InventoryPurchasePriceEditor, useInventoryPurchasePrices } from "./InventoryPurchasePrice";

type MaterialInventoryItem = {
  name: string;
  stock: number;
  unit: string;
  lowAt: number;
};

type WarehousePanelProps = {
  workspaceId?: string;
  onBack: () => void;
  products: ClimateProduct[];
  materialInventory: MaterialInventoryItem[];
  showClimateProductManager: boolean;
  onToggleClimateProductManager: () => void;
  newProductName: string;
  onNewProductName: (value: string) => void;
  newProductPrice: string;
  onNewProductPrice: (value: string) => void;
  newProductInstallPrice: string;
  onNewProductInstallPrice: (value: string) => void;
  productBusy: boolean;
  productMessage: string;
  onAddClimateProduct: () => void;
  onSyncKlimalinProducts: () => void | Promise<void>;
  onUpdateProductName: (productId: string, value: string) => void;
  onUpdateProductDevicePrice: (productId: string, value: string) => void;
  onUpdateProductInstallPrice: (productId: string, value: string) => void;
  onSaveClimateProduct: (product: ClimateProduct) => void | Promise<void>;
  onDeleteClimateProduct: (product: ClimateProduct) => Promise<boolean>;
  stockOf: (productId: string) => number;
  reservedForProduct: (productId: string) => number;
  addStock: (productId: string, amount: number) => void | Promise<void>;
  materialReserved: (materialName: string) => number;
  addMaterialStock: (materialName: string, amount: number) => void | Promise<void>;
  onAddMaterialItem: (item: MaterialInventoryItem) => void | Promise<void>;
};

function productDevicePrice(product: ClimateProduct) {
  return Math.max(0, Number(product.price || 0) - Number(product.installPrice || 0));
}

export function WarehousePanel({
  workspaceId,
  onBack,
  products,
  materialInventory,
  showClimateProductManager,
  onToggleClimateProductManager,
  newProductName,
  onNewProductName,
  newProductPrice,
  onNewProductPrice,
  newProductInstallPrice,
  onNewProductInstallPrice,
  productBusy,
  productMessage,
  onAddClimateProduct,
  onSyncKlimalinProducts,
  onUpdateProductName,
  onUpdateProductDevicePrice,
  onUpdateProductInstallPrice,
  onSaveClimateProduct,
  onDeleteClimateProduct,
  stockOf,
  reservedForProduct,
  addStock,
  materialReserved,
  addMaterialStock,
  onAddMaterialItem,
}: WarehousePanelProps) {
  const [search, setSearch] = useState("");
  const purchasePrices = useInventoryPurchasePrices(workspaceId);
  const [showMaterialManager, setShowMaterialManager] = useState(false);
  const [newMaterialName, setNewMaterialName] = useState("");
  const [newMaterialUnit, setNewMaterialUnit] = useState("db");
  const [newMaterialStock, setNewMaterialStock] = useState("0");
  const [newMaterialLowAt, setNewMaterialLowAt] = useState("1");
  const [materialMessage, setMaterialMessage] = useState("");
  const query = search.trim().toLocaleLowerCase("hu-HU");
  const visibleProducts = products.filter((product) => product.name.toLocaleLowerCase("hu-HU").includes(query));
  const visibleMaterials = materialInventory.filter((item) => item.name.toLocaleLowerCase("hu-HU").includes(query));
  const productGroups = groupWarehouseItems(visibleProducts, (product) => stockOf(product.id));
  const materialGroups = groupWarehouseItems(visibleMaterials, (item) => item.stock);
  const stockValue = summarizeWarehouseValue([
    ...products.map((product) => ({ itemType: "climate" as const, itemKey: product.id, stock: stockOf(product.id), reserved: reservedForProduct(product.id) })),
    ...materialInventory.map((item) => ({ itemType: "material" as const, itemKey: item.name, stock: item.stock, reserved: materialReserved(item.name) })),
  ], purchasePrices.prices);

  async function addMaterialItem() {
    const name = newMaterialName.trim();
    if (!name) {
      setMaterialMessage("Add meg az anyag nevét.");
      return;
    }
    if (materialInventory.some((item) => item.name.toLocaleLowerCase("hu-HU") === name.toLocaleLowerCase("hu-HU"))) {
      setMaterialMessage("Ez az anyag már szerepel a raktárban.");
      return;
    }

    try {
      await onAddMaterialItem({
        name,
        unit: newMaterialUnit.trim() || "db",
        stock: Math.max(0, Number(newMaterialStock || 0)),
        lowAt: Math.max(0, Number(newMaterialLowAt || 0)),
      });
      setNewMaterialName("");
      setNewMaterialUnit("db");
      setNewMaterialStock("0");
      setNewMaterialLowAt("1");
      setMaterialMessage("Anyag hozzáadva ✓");
    } catch (error: any) {
      setMaterialMessage(`Anyag mentési hiba: ${error.message || "ismeretlen hiba"}`);
    }
  }

  return (
    <Shell>
      <Back onClick={onBack} />
      <WarehouseValueSummary value={stockValue} loading={purchasePrices.loading} error={Boolean(purchasePrices.error)} />
      <ClimateProductManager
        products={products}
        showClimateProductManager={showClimateProductManager}
        onToggleClimateProductManager={onToggleClimateProductManager}
        newProductName={newProductName}
        onNewProductName={onNewProductName}
        newProductPrice={newProductPrice}
        onNewProductPrice={onNewProductPrice}
        newProductInstallPrice={newProductInstallPrice}
        onNewProductInstallPrice={onNewProductInstallPrice}
        productBusy={productBusy}
        productMessage={productMessage}
        onAddClimateProduct={onAddClimateProduct}
        onSyncKlimalinProducts={onSyncKlimalinProducts}
        onUpdateProductName={onUpdateProductName}
        onUpdateProductDevicePrice={onUpdateProductDevicePrice}
        onUpdateProductInstallPrice={onUpdateProductInstallPrice}
        onSaveClimateProduct={onSaveClimateProduct}
        onDeleteClimateProduct={onDeleteClimateProduct}
      />
      <div className="space-y-3 print:hidden">
        <label className="block text-sm font-bold text-slate-300">Keresés a klímák és anyagok között
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Klíma vagy anyag neve" className="input mt-2" />
        </label>
        <p className="text-sm text-slate-400">A beszerzési árak csak a belső raktárban láthatók, ügyféldokumentumba és emailbe nem kerülnek.</p>
        {purchasePrices.loading ? <p role="status" className="text-sm text-slate-300">Beszerzési árak betöltése...</p> : null}
        {purchasePrices.error ? <div role="alert" className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
          <p>{purchasePrices.error}</p>
          <button type="button" onClick={purchasePrices.retry} className="mt-2 rounded-xl bg-white/10 px-3 py-2 font-bold">Árak betöltésének újrapróbálása</button>
        </div> : null}
      </div>
      <div className="space-y-6">
          <Card title="Klíma készlet">
            <div className="space-y-3">
              {productGroups.flatMap((group) => group.items.length ? [
                <h3 key={`heading-${group.key}`} className="border-b border-white/10 pb-2 pt-3 text-lg font-black text-slate-200">{group.title}</h3>,
                ...group.items.map((product) => {
                const stock = stockOf(product.id);
                const reserved = reservedForProduct(product.id);
                const free = stock - reserved;

                return (
                  <div key={`climate-${product.id}`} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-lg font-black">{product.name}</p>
                        <p className="text-sm text-slate-400">{product.priceText}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-sm">
                        <StockBadge label="Raktáron" value={`${stock} db`} />
                        <StockBadge label="Lefoglalva" value={`${reserved} db`} tone="amber" />
                        <StockBadge label="Szabad" value={`${free} db`} tone={free > 0 ? "green" : "red"} />
                      </div>
                    </div>

                    <InventoryPurchasePriceEditor
                      item={{ itemType: "climate", itemKey: product.id }} itemName={product.name} unit="db"
                      price={purchasePrices.prices.get(inventoryPriceKey({ itemType: "climate", itemKey: product.id }))}
                      disabled={purchasePrices.loading || Boolean(purchasePrices.error)} onSave={purchasePrices.save}
                    />
                    {reserved > stock ? (
                      <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/20 p-4 text-sm font-black text-red-100">
                        Figyelem: {reserved - stock} db-bal több van lefoglalva, mint amennyi raktáron van.
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                      <input id={`stock-${product.id}`} type="number" defaultValue={1} className="input md:max-w-[140px]" />
                      <button
                        onClick={() => {
                          const input = document.getElementById(`stock-${product.id}`) as HTMLInputElement | null;
                          addStock(product.id, Number(input?.value || 0));
                        }}
                        className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950"
                      >
                        Készlet módosítása
                      </button>
                    </div>
                  </div>
                );
              })] : [])}
            </div>
            {!visibleProducts.length ? <p className="mt-3 text-sm text-slate-400">{query ? "Nincs megfelelő klíma." : "Nincs aktív klímatípus."}</p> : null}
          </Card>

          <Card title="Szerelési anyagok">
            <button
              type="button"
              onClick={() => setShowMaterialManager((open) => !open)}
              className="mb-5 w-full rounded-2xl bg-emerald-300 px-5 py-4 font-black text-slate-950"
            >
              {showMaterialManager ? "Anyag hozzáadás elrejtése" : "Új szerelési anyag hozzáadása"}
            </button>

            {showMaterialManager ? (
              <div className="mb-5 rounded-3xl border border-emerald-300/20 bg-emerald-300/10 p-4">
                <p className="mb-3 text-lg font-black">Új szerelési anyag</p>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_120px_120px_120px_auto] lg:items-end">
                  <Field label="Anyag neve">
                    <input className="input" value={newMaterialName} onChange={(event) => setNewMaterialName(event.target.value)} placeholder="pl. 5 eres kábel" />
                  </Field>
                  <Field label="Egység">
                    <input className="input" value={newMaterialUnit} onChange={(event) => setNewMaterialUnit(event.target.value)} placeholder="m / db" />
                  </Field>
                  <Field label="Készlet">
                    <input className="input" type="number" min={0} step="0.1" value={newMaterialStock} onChange={(event) => setNewMaterialStock(event.target.value)} />
                  </Field>
                  <Field label="Alacsony szint">
                    <input className="input" type="number" min={0} step="0.1" value={newMaterialLowAt} onChange={(event) => setNewMaterialLowAt(event.target.value)} />
                  </Field>
                  <button type="button" onClick={() => void addMaterialItem()} className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950">
                    + Hozzáadás
                  </button>
                </div>
                {materialMessage ? <p className="mt-3 text-sm font-bold text-emerald-100">{materialMessage}</p> : null}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {materialGroups.flatMap((group) => group.items.length ? [
                <h3 key={`heading-${group.key}`} className="col-span-full border-b border-white/10 pb-2 pt-3 text-lg font-black text-slate-200">{group.title}</h3>,
                ...group.items.map((item) => {
                const reserved = materialReserved(item.name);
                const free = item.stock - reserved;
                const status = free <= 0 ? "hiány" : free <= item.lowAt ? "alacsony" : "rendben";

                return (
                  <div key={`material-${item.name}`} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black">{item.name}</p>
                        <p className="mt-1 text-xs text-slate-400">egység: {item.unit}</p>
                      </div>
                      <span className={statusPillClass(status)}>{status}</span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                      <StockBadge label="Raktáron" value={`${item.stock} ${item.unit}`} />
                      <StockBadge label="Lefoglalva" value={`${reserved} ${item.unit}`} tone="amber" />
                      <StockBadge label="Szabad" value={`${free} ${item.unit}`} tone={free > 0 ? "green" : "red"} />
                    </div>

                    <InventoryPurchasePriceEditor
                      item={{ itemType: "material", itemKey: item.name }} itemName={item.name} unit={item.unit}
                      price={purchasePrices.prices.get(inventoryPriceKey({ itemType: "material", itemKey: item.name }))}
                      disabled={purchasePrices.loading || Boolean(purchasePrices.error)} onSave={purchasePrices.save}
                    />
                    {reserved > item.stock ? (
                      <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/20 p-4 text-sm font-black text-red-100">
                        Figyelem: {reserved - item.stock} {item.unit} hiányzik a lefoglalt munkákhoz.
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                      <input id={`mat-${item.name}`} type="number" defaultValue={1} className="input md:max-w-[140px]" />
                      <button
                        onClick={() => {
                          const input = document.getElementById(`mat-${item.name}`) as HTMLInputElement | null;
                          addMaterialStock(item.name, Number(input?.value || 0));
                        }}
                        className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950"
                      >
                        Készlet módosítása
                      </button>
                    </div>
                  </div>
                );
              })] : [])}
            </div>
            {!visibleMaterials.length ? <p className="mt-3 text-sm text-slate-400">{query ? "Nincs megfelelő szerelési anyag." : "Nincs szerelési anyag a raktárban."}</p> : null}
          </Card>
      </div>
    </Shell>
  );
}

function WarehouseValueSummary({ value, loading, error }: { value: ReturnType<typeof summarizeWarehouseValue>; loading: boolean; error: boolean }) {
  const incomplete = value.missingStockPriceCount > 0;
  const unavailable = loading || error || (incomplete && value.pricedStockItemCount === 0);
  return <section data-internal-stock-value className="rounded-[2rem] border border-cyan-200/20 bg-cyan-200/5 p-5 print:hidden sm:p-6">
    <h2 className="text-2xl font-black">Raktárkészlet értéke</h2>
    <p className="mt-1 text-sm text-slate-300">Teljes raktár · klímák és anyagok · bruttó beszerzési érték</p>
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[
        ["Raktáron összesen", value.grossStockValue],
        ["Ebből lefoglalva", value.reservedValue],
        ["Szabad készlet", value.freeValue],
      ].map(([label, amount]) => <div key={label} className="min-w-0 rounded-2xl bg-slate-900/80 p-4">
        <p className="text-sm text-slate-300">{label}</p>
        <p className="mt-2 break-words text-2xl font-black tabular-nums text-cyan-100">{unavailable ? "—" : ft(Number(amount))}</p>
      </div>)}
    </div>
    {loading ? <p className="mt-3 text-sm text-slate-300">Értékek betöltése...</p> : error ? <p className="mt-3 text-sm text-amber-100">Az értékek az árak sikeres betöltése után jelennek meg.</p> : incomplete ? <p className="mt-3 text-sm text-amber-100">{value.missingStockPriceCount} raktáron lévő tételnél hiányzik a beszerzési ár. {value.pricedStockItemCount ? "A kijelzett értékek az ismert árú tételek részösszegei." : "Az összesítéshez add meg a beszerzési árakat."}</p> : null}
  </section>;
}

type ClimateProductManagerProps = Pick<WarehousePanelProps,
  | "products"
  | "showClimateProductManager"
  | "onToggleClimateProductManager"
  | "newProductName"
  | "onNewProductName"
  | "newProductPrice"
  | "onNewProductPrice"
  | "newProductInstallPrice"
  | "onNewProductInstallPrice"
  | "productBusy"
  | "productMessage"
  | "onAddClimateProduct"
  | "onSyncKlimalinProducts"
  | "onUpdateProductName"
  | "onUpdateProductDevicePrice"
  | "onUpdateProductInstallPrice"
  | "onSaveClimateProduct"
  | "onDeleteClimateProduct"
>;

function ClimateProductManager({
  products,
  showClimateProductManager,
  onToggleClimateProductManager,
  newProductName,
  onNewProductName,
  newProductPrice,
  onNewProductPrice,
  newProductInstallPrice,
  onNewProductInstallPrice,
  productBusy,
  productMessage,
  onAddClimateProduct,
  onSyncKlimalinProducts,
  onUpdateProductName,
  onUpdateProductDevicePrice,
  onUpdateProductInstallPrice,
  onSaveClimateProduct,
  onDeleteClimateProduct,
}: ClimateProductManagerProps) {
  const [archiveProductId, setArchiveProductId] = useState<string | null>(null);
  const [archiveAttempted, setArchiveAttempted] = useState(false);
  const archiveInFlight = useRef(false);
  const archiveTrigger = useRef<HTMLButtonElement | null>(null);

  function cancelArchive() {
    if (archiveInFlight.current) return;
    setArchiveProductId(null);
    archiveTrigger.current?.focus();
  }

  async function confirmArchive(product: ClimateProduct) {
    if (productBusy || archiveInFlight.current || archiveProductId !== product.id) return;
    archiveInFlight.current = true;
    setArchiveAttempted(true);
    try {
      if (await onDeleteClimateProduct(product)) setArchiveProductId(null);
    } finally {
      archiveInFlight.current = false;
    }
  }

  return (
    <Card title="Klímatípusok és árak">
      <button
        onClick={() => {
          if (productBusy) return;
          setArchiveProductId(null);
          onToggleClimateProductManager();
        }}
        disabled={productBusy}
        className="w-full rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950"
      >
        {showClimateProductManager ? "Klímatípus-kezelő bezárása" : "Klímatípus-kezelő megnyitása"}
      </button>

      {showClimateProductManager ? (
        <div className="mt-5 space-y-5">
          <button
            type="button"
            onClick={() => void onSyncKlimalinProducts()}
            disabled={productBusy}
            className="w-full rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950 disabled:cursor-wait disabled:opacity-60"
          >
            {productBusy ? "Szinkronizálás folyamatban..." : "KLIMAlin kínálat és árak szinkronizálása"}
          </button>

          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm font-bold text-cyan-100">
            A készülék árát és a szerelési árat külön add meg. Az ügyfélnek mutatott ár: készülék ár + szerelési ár.
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <p className="mb-3 text-lg font-black">Új klímatípus hozzáadása</p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_150px_150px_150px_auto] lg:items-end">
              <Field label="Klíma megnevezése">
                <input className="input" value={newProductName} onChange={(event) => onNewProductName(event.target.value)} placeholder="pl. Gree Comfort Pro 3,5 kW" />
              </Field>
              <Field label="Készülék ár">
                <input className="input" type="number" value={newProductPrice} onChange={(event) => onNewProductPrice(event.target.value)} placeholder="160000" />
              </Field>
              <Field label="Szerelési ár">
                <input className="input" type="number" value={newProductInstallPrice} onChange={(event) => onNewProductInstallPrice(event.target.value)} placeholder="60000" />
              </Field>
              <div className="rounded-2xl bg-white/10 p-3 text-sm">
                <p className="text-slate-400">Készülék + szerelés</p>
                <p className="font-black text-slate-100">{ft((Number(newProductPrice || 0) || 0) + (Number(newProductInstallPrice || 0) || 0))}</p>
              </div>
              <button onClick={onAddClimateProduct} disabled={productBusy} className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950 disabled:cursor-wait disabled:opacity-60">
                + Hozzáadás
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {products.map((product) => {
              const devicePrice = productDevicePrice(product);
              const customerPrice = Math.max(0, devicePrice + Number(product.installPrice || 0));
              return (
                <div key={product.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_140px_140px_150px_auto] xl:items-end">
                    <Field label="Megnevezés">
                      <input className="input" value={product.name} onChange={(event) => onUpdateProductName(product.id, event.target.value)} />
                    </Field>
                    <Field label="Készülék ár">
                      <input className="input" type="number" value={devicePrice} onChange={(event) => onUpdateProductDevicePrice(product.id, event.target.value)} />
                    </Field>
                    <Field label="Szerelési ár">
                      <input className="input" type="number" value={product.installPrice} onChange={(event) => onUpdateProductInstallPrice(product.id, event.target.value)} />
                    </Field>
                    <div className="rounded-2xl bg-white/10 p-3 text-sm">
                      <p className="text-slate-400">Készülék + szerelés</p>
                      <p className="font-black text-slate-100">{ft(customerPrice)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
                      <button type="button" onClick={() => onSaveClimateProduct(product)} disabled={productBusy} className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950 disabled:cursor-wait disabled:opacity-60">
                        Mentés
                      </button>
                      <button type="button" onClick={(event) => {
                        archiveTrigger.current = event.currentTarget;
                        setArchiveAttempted(false);
                        setArchiveProductId(product.id);
                      }} aria-expanded={archiveProductId === product.id} disabled={productBusy} className="rounded-2xl bg-red-500 px-5 py-4 font-black text-white disabled:cursor-wait disabled:opacity-60">
                        Törlés
                      </button>
                    </div>
                  </div>
                  {archiveProductId === product.id ? (
                    <div role="group" aria-label={`Klíma archiválása: ${product.name}`} onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelArchive();
                      }
                    }} className="mt-4 rounded-2xl border-2 border-amber-300 bg-slate-950 p-4">
                      <p className="font-black text-amber-200">Archiválod ezt a klímát?</p>
                      <p className="mt-2 break-words font-black text-white">{product.name}</p>
                      <p className="mt-2 text-sm text-slate-200">Csak az aktív kínálatból kerül ki. A korábbi ajánlatok, munkák és munkalapok megmaradnak.</p>
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button type="button" autoFocus onClick={cancelArchive} disabled={productBusy} className="rounded-xl bg-slate-200 px-5 py-4 font-black text-slate-950 disabled:opacity-60">Mégse</button>
                        <button type="button" onClick={() => void confirmArchive(product)} disabled={productBusy} className="rounded-xl bg-red-500 px-5 py-4 font-black text-slate-950 disabled:cursor-wait disabled:opacity-60">{productBusy ? "Archiválás..." : "Archiválás"}</button>
                      </div>
                      {archiveAttempted && !productBusy && productMessage ? <p role="status" className="mt-3 text-sm font-bold text-slate-100">{productMessage}</p> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {productMessage ? <div role="status" className="rounded-2xl bg-slate-950/70 p-4 text-sm font-bold text-slate-100">{productMessage}</div> : null}
        </div>
      ) : null}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function statusPillClass(status: string) {
  if (status === "hiány") return "rounded-full bg-red-500/20 px-3 py-1 text-xs font-black text-red-200";
  if (status === "alacsony") return "rounded-full bg-amber-400/20 px-3 py-1 text-xs font-black text-amber-200";
  return "rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-black text-emerald-200";
}

function StockBadge({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "amber" | "green" | "red" }) {
  const bg = tone === "amber" ? "bg-amber-400/20" : tone === "green" ? "bg-emerald-400/20" : tone === "red" ? "bg-red-500/20" : "bg-white/10";
  const color = tone === "amber" ? "text-amber-200" : tone === "green" ? "text-emerald-200" : tone === "red" ? "text-red-200" : "text-slate-400";
  return (
    <div className={`rounded-2xl p-3 ${bg}`}>
      <p className={color}>{label}</p>
      <b>{value}</b>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-[#08111F] p-4 text-white print:bg-white print:p-0 print:text-black md:p-8"><div className="mx-auto max-w-7xl space-y-8 print:max-w-none print:space-y-0">{children}</div></main>;
}
function Card({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl"><h2 className="mb-5 text-2xl font-black">{title}</h2>{children}</section>; }
function Back({ onClick }: { onClick: () => void }) { return <div className="sticky top-3 z-50 w-fit print:hidden"><button onClick={onClick} className="rounded-2xl border border-cyan-200/20 bg-slate-900/95 px-5 py-3 font-black text-cyan-100 shadow-2xl shadow-slate-950/40 backdrop-blur">← Vissza</button></div>; }
