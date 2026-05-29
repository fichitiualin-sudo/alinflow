import type { ReactNode } from "react";
import type { ClimateProduct } from "@/lib/alinflow/types";
import { ft } from "@/lib/alinflow/format";

type MaterialInventoryItem = {
  name: string;
  stock: number;
  unit: string;
  lowAt: number;
};

type WarehousePanelProps = {
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
  onUpdateProductName: (productId: string, value: string) => void;
  onUpdateProductDevicePrice: (productId: string, value: string) => void;
  onUpdateProductInstallPrice: (productId: string, value: string) => void;
  onSaveClimateProduct: (product: ClimateProduct) => void | Promise<void>;
  stockOf: (productId: string) => number;
  reservedForProduct: (productId: string) => number;
  addStock: (productId: string, amount: number) => void | Promise<void>;
  materialReserved: (materialName: string) => number;
  addMaterialStock: (materialName: string, amount: number) => void | Promise<void>;
};

function productDevicePrice(product: ClimateProduct) {
  return Math.max(0, Number(product.price || 0) - Number(product.installPrice || 0));
}

export function WarehousePanel({
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
  onUpdateProductName,
  onUpdateProductDevicePrice,
  onUpdateProductInstallPrice,
  onSaveClimateProduct,
  stockOf,
  reservedForProduct,
  addStock,
  materialReserved,
  addMaterialStock,
}: WarehousePanelProps) {
  return (
    <Shell>
      <Back onClick={onBack} />
      <Layout>
        <Main>
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
            onUpdateProductName={onUpdateProductName}
            onUpdateProductDevicePrice={onUpdateProductDevicePrice}
            onUpdateProductInstallPrice={onUpdateProductInstallPrice}
            onSaveClimateProduct={onSaveClimateProduct}
          />

          <Card title="Klíma készlet">
            <div className="space-y-3">
              {products.map((product) => {
                const stock = stockOf(product.id);
                const reserved = reservedForProduct(product.id);
                const free = stock - reserved;

                return (
                  <div key={product.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
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

                    {reserved > stock ? (
                      <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/20 p-4 text-sm font-black text-red-100">
                        Figyelem: {reserved - stock} db-bal több van lefoglalva, mint amennyi raktáron van.
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                      <input id={`stock-${product.id}`} type="number" min={1} defaultValue={1} className="input md:max-w-[140px]" />
                      <button
                        onClick={() => {
                          const input = document.getElementById(`stock-${product.id}`) as HTMLInputElement | null;
                          addStock(product.id, Number(input?.value || 0));
                        }}
                        className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950"
                      >
                        + Bevételezés
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Szerelési anyagok">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {materialInventory.map((item) => {
                const reserved = materialReserved(item.name);
                const free = item.stock - reserved;
                const status = free <= 0 ? "hiány" : free <= item.lowAt ? "alacsony" : "rendben";

                return (
                  <div key={item.name} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
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

                    {reserved > item.stock ? (
                      <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/20 p-4 text-sm font-black text-red-100">
                        Figyelem: {reserved - item.stock} {item.unit} hiányzik a lefoglalt munkákhoz.
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                      <input id={`mat-${item.name}`} type="number" min={1} defaultValue={1} className="input md:max-w-[140px]" />
                      <button
                        onClick={() => {
                          const input = document.getElementById(`mat-${item.name}`) as HTMLInputElement | null;
                          addMaterialStock(item.name, Number(input?.value || 0));
                        }}
                        className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950"
                      >
                        + Bevételezés
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </Main>

        <Side>
          <Gradient title="Raktár logika" value="Foglalás ≠ levonás" tone="blue" />
          <Card title="Mit jelent?">
            <InfoRow label="Raktáron" value="fizikailag nálad van" />
            <InfoRow label="Lefoglalva" value="már időpontra van téve" />
            <InfoRow label="Szabad" value="még eladható" />
          </Card>
        </Side>
      </Layout>
    </Shell>
  );
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
  | "onUpdateProductName"
  | "onUpdateProductDevicePrice"
  | "onUpdateProductInstallPrice"
  | "onSaveClimateProduct"
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
  onUpdateProductName,
  onUpdateProductDevicePrice,
  onUpdateProductInstallPrice,
  onSaveClimateProduct,
}: ClimateProductManagerProps) {
  return (
    <Card title="Klímatípusok és árak">
      <button
        onClick={onToggleClimateProductManager}
        className="w-full rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950"
      >
        {showClimateProductManager ? "Klímatípus-kezelő bezárása" : "Klímatípus-kezelő megnyitása"}
      </button>

      {showClimateProductManager ? (
        <div className="mt-5 space-y-5">
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
                    <button onClick={() => onSaveClimateProduct(product)} disabled={productBusy} className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950 disabled:cursor-wait disabled:opacity-60">
                      Mentés
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {productMessage ? <div className="rounded-2xl bg-slate-950/70 p-4 text-sm font-bold text-slate-100">{productMessage}</div> : null}
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
function Layout({ children }: { children: ReactNode }) { return <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">{children}</section>; }
function Main({ children }: { children: ReactNode }) { return <div className="space-y-6 xl:col-span-2">{children}</div>; }
function Side({ children }: { children: ReactNode }) { return <aside className="space-y-6">{children}</aside>; }
function Card({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl"><h2 className="mb-5 text-2xl font-black">{title}</h2>{children}</section>; }
function Back({ onClick }: { onClick: () => void }) { return <div className="sticky top-3 z-50 w-fit print:hidden"><button onClick={onClick} className="rounded-2xl border border-cyan-200/20 bg-slate-900/95 px-5 py-3 font-black text-cyan-100 shadow-2xl shadow-slate-950/40 backdrop-blur">← Vissza</button></div>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="mb-3 flex justify-between gap-4 rounded-2xl bg-slate-900/80 p-4"><span>{label}</span><b>{value}</b></div>; }
function Gradient({ title, value, tone }: { title: string; value: string; tone?: string }) {
  const bg = tone === "blue" ? "from-blue-400 to-cyan-300" : "from-cyan-300 to-emerald-300";
  return <div className={`rounded-[2rem] bg-gradient-to-br ${bg} p-6 text-slate-950 shadow-2xl`}><p className="text-sm font-black uppercase opacity-70">{title}</p><p className="mt-2 text-3xl font-black">{value}</p></div>;
}
