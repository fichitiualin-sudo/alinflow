"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type View = "dashboard" | "lead" | "quote" | "quotePreview" | "schedule" | "work" | "workReport" | "warehouse" | "tasks" | "archive" | "documents" | "documentPreview";
const RETURN_CONTEXT_KEY = "alinflow:returnContext";
const CUSTOMER_DRAFT_KEY = "alinflow:customerDraft";
const RESTORABLE_VIEWS: View[] = ["lead", "quote", "quotePreview", "schedule", "work", "workReport", "documentPreview"];

type CalendarMode = "week" | "month";
type DocumentPreviewType = "work_report" | "purchase_declaration" | "appointment_confirmation" | "quote_document";
type QuoteItem = { productId: string; quantity: number; customPrice?: number; customName?: string; isManual?: boolean };
type InventoryItem = {
  productId: string;
  stock: number;
};

type Customer = {
  id: string;
  name: string;
  city: string;
  phone: string;
  email: string;
  address: string;
  source: string;
  status: string;
  need: string;
  notes?: string;
  date?: string;
  time?: string;
  quoteItems: QuoteItem[];
  productId?: string;
  isFresh?: boolean;
  stockDeducted?: boolean;
};

type WorkReport = {
  id?: string;
  customerId?: string;
  workDescription: string;
  notes: string;
  signatureDataUrl: string;
  signerName: string;
  signedAt?: string;
  emailSentAt?: string;
};

type DocumentRecord = {
  id?: string;
  customerId: string;
  type: string;
  title: string;
  status: string;
  sentAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type LeadImportCandidate = {
  id: string;
  rowNumber: number;
  name: string;
  phone: string;
  email: string;
  duplicate: boolean;
  duplicateReason?: string;
  invalid?: boolean;
  invalidReason?: string;
  mergedRows?: number;
};

type WorkChecklistState = {
  worksheet: boolean;
  signature: boolean;
  purchaseDeclaration: boolean;
  alinInvoice: boolean;
  amovaInvoice: boolean;
  nkvh: boolean;
  docsSent: boolean;
};

const EMPTY_WORK_CHECKLIST: WorkChecklistState = {
  worksheet: false,
  signature: false,
  purchaseDeclaration: false,
  alinInvoice: false,
  amovaInvoice: false,
  nkvh: false,
  docsSent: false,
};

const STATUS_OPTIONS = [
  "Visszahívandó",
  "Ajánlat elküldve",
  "Időpont foglalva",
  "Szerelés kész – admin folyamatban",
  "Lezárva",
  "Lemondva",
];

const ARCHIVED_STATUSES = ["Lezárva", "Lemondva"];

const PRODUCTS = [
  {
    "id": "auratsu-osaka-3-4-kw-tcl",
    "name": "Auratsu Osaka 3,4 kW (TCL)",
    "price": 220000,
    "priceText": "220 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "mdv-one-3-5-kw-by-midea",
    "name": "MDV One 3,5 kW (by Midea)",
    "price": 240000,
    "priceText": "240 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "kinghome-by-gree-primor-3-2-kw",
    "name": "Kinghome (by Gree) Primor 3,2 kW",
    "price": 235000,
    "priceText": "235 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "tcl-t-pro-3-5-kw",
    "name": "TCL T-Pro 3,5 kW",
    "price": 270000,
    "priceText": "270 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "kinghome-by-gree-maximus-3-51-kw",
    "name": "Kinghome (by Gree) Maximus 3,51 kW",
    "price": 250000,
    "priceText": "250 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "midea-xtreme-save-3-5-kw",
    "name": "Midea Xtreme Save 3,5 kW",
    "price": 290000,
    "priceText": "290 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "syen-by-gree-muse-next-3-5-kw",
    "name": "Syen (by Gree) Muse Next 3,5 kW",
    "price": 275000,
    "priceText": "275 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "nord-quantum-3-6-kw",
    "name": "Nord Quantum 3,6 kW",
    "price": 285000,
    "priceText": "285 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "kaisai-ice-3-5-kw",
    "name": "Kaisai Ice 3,5 kW",
    "price": 280000,
    "priceText": "280 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "midea-xtreme-save-pro-3-5-kw",
    "name": "Midea Xtreme Save Pro 3,5 kW",
    "price": 325000,
    "priceText": "325 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "midea-breezeless-e-3-5-kw-huzatmentes",
    "name": "Midea Breezeless E 3,5 kW (huzatmentes)",
    "price": 305000,
    "priceText": "305 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "fisher-comfort-plus-3-5-kw",
    "name": "Fisher Comfort Plus 3,5 kW",
    "price": 295000,
    "priceText": "295 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "gree-comfort-pro-3-5-kw",
    "name": "Gree Comfort Pro 3,5 kW",
    "price": 305000,
    "priceText": "305 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "fisher-art-3-52-kw-fekete",
    "name": "Fisher Art 3,52 kW (fekete)",
    "price": 360000,
    "priceText": "360 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "midea-solstice-3-5-kw",
    "name": "Midea Solstice 3,5 kW",
    "price": 325000,
    "priceText": "325 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "fisher-nordic-3-5-kw",
    "name": "Fisher Nordic 3,5 kW",
    "price": 400000,
    "priceText": "400 000 Ft (telepítéssel együtt)"
  },
  {
    "id": "midea-oasis-3-5-kw",
    "name": "Midea Oasis 3,5 kW",
    "price": 460000,
    "priceText": "460 000 Ft (telepítéssel együtt)"
  }
];

const INITIAL_CUSTOMERS: Customer[] = [
  { id:"c1", name:"Kovács Réka", city:"Hévízgyörk", phone:"+36 30 123 4567", email:"reka@email.hu", address:"2192 Hévízgyörk, Minta utca 12.", source:"Facebook hirdetés", status:"Időpont foglalva", need:"Hűtés · 35 m² nappali", date:"2026-05-12", time:"08:00", quoteItems:[{ productId: PRODUCTS[6]?.id || PRODUCTS[0].id, quantity:1 }] },
  { id:"c2", name:"Kovács Béla", city:"Gödöllő", phone:"+36 30 111 1111", email:"bela@email.hu", address:"2100 Gödöllő, Fő utca 4.", source:"Telefon", status:"Időpont foglalva", need:"Hűtés + fűtés · 42 m² nappali", date:"2026-05-11", time:"08:00", quoteItems:[{ productId: PRODUCTS[12]?.id || PRODUCTS[0].id, quantity:1 }] },
  { id:"c3", name:"Nagy István", city:"Hatvan", phone:"+36 30 222 2222", email:"istvan@email.hu", address:"3000 Hatvan, Kossuth tér 2.", source:"Weboldal", status:"Visszahívandó", need:"Felmérés · 2 helyiség", date:"2026-05-11", time:"12:00", quoteItems:[{ productId: PRODUCTS[1]?.id || PRODUCTS[0].id, quantity:1 }] },
  { id:"l1", name:"Balogh Réka", city:"Hévízgyörk", phone:"+36 30 222 3344", email:"balogh.reka@email.hu", address:"2192 Hévízgyörk, Dózsa György út 5.", source:"Facebook hirdetés", status:"Visszahívandó", need:"Hűtés · 35 m² nappali", quoteItems:[{ productId: PRODUCTS[6]?.id || PRODUCTS[0].id, quantity:1 }] },
  { id:"l2", name:"Molnár Gábor", city:"Kartal", phone:"+36 30 666 6666", email:"gabor@email.hu", address:"2173 Kartal, Béke utca 9.", source:"Facebook hirdetés", status:"Ajánlat elküldve", need:"Hűtés + fűtés · 40 m² nappali", quoteItems:[{ productId: PRODUCTS[12]?.id || PRODUCTS[0].id, quantity:1 }] },
];

const DEFAULT_MATERIALS = [
  { name:"Alukasírozott rézcső", qty:"3", unit:"m", isExtra:false },
  { name:"Konzol", qty:"450-es konzol", unit:"1 db", isExtra:false },
  { name:"Rezgéscsillapító", qty:"1", unit:"készlet", isExtra:false },
  { name:"3×1,5 gumikábel", qty:"5", unit:"m", isExtra:false },
  { name:"5×1,5 gumikábel", qty:"2,5", unit:"m", isExtra:false },
  { name:"160-as csavar", qty:"4", unit:"db", isExtra:false },
];
const MATERIAL_STOCK = [
  { name: "Alukasírozott rézcső", stock: 41, unit: "m", lowAt: 15 },
  { name: "450-es konzol", stock: 3, unit: "db", lowAt: 4 },
  { name: "550-es konzol", stock: 6, unit: "db", lowAt: 4 },
  { name: "Rezgéscsillapító", stock: 12, unit: "készlet", lowAt: 5 },
  { name: "3×1,5 gumikábel", stock: 52, unit: "m", lowAt: 20 },
  { name: "5×1,5 gumikábel", stock: 28, unit: "m", lowAt: 10 },
  { name: "160-as csavar", stock: 64, unit: "db", lowAt: 20 },
];


const DEFAULT_INVENTORY: InventoryItem[] = PRODUCTS.slice(0, 10).map((product, index) => ({
  productId: product.id,
  stock: [4, 3, 5, 2, 8, 1, 2, 3, 1, 2][index] ?? 0,
}));


const BASE_SLOTS = ["08:00", "12:00", "16:00"];

function ft(n:number) { return n.toLocaleString("hu-HU") + " Ft"; }
function pad(n:number) { return String(n).padStart(2,"0"); }
function iso(d:Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayIso() { return iso(new Date()); }
function offsetIso(days:number) { const d = new Date(); d.setDate(d.getDate()+days); return iso(d); }
function fullCustomerAddress(customer: Pick<Customer, "city" | "address">) {
  const city = (customer.city || "").trim();
  const address = (customer.address || "").trim();
  if (city && address) {
    return address.toLowerCase().includes(city.toLowerCase()) ? address : `${city}, ${address}`;
  }
  return address || city || "nincs megadva";
}
function weekStart(d:Date) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay()+6)%7)); return x; }
function calLabel(mode:CalendarMode, d:Date) {
  if (mode==="month") return `${d.getFullYear()}. ${pad(d.getMonth()+1)}`;
  const a = weekStart(d); const b = new Date(a); b.setDate(a.getDate()+6);
  return `${a.getFullYear()}. ${pad(a.getMonth()+1)}.${pad(a.getDate())} – ${pad(b.getMonth()+1)}.${pad(b.getDate())}`;
}
function prod(id:string) { return PRODUCTS.find((p:any)=>p.id===id) || PRODUCTS[0]; }
function qty(items:QuoteItem[]) { return items.reduce((s,i)=>s+i.quantity,0); }
function itemName(item: QuoteItem) {
  return item.customName?.trim() || prod(item.productId).name;
}
function itemUnitPrice(item: QuoteItem) {
  return typeof item.customPrice === "number" && !Number.isNaN(item.customPrice) ? item.customPrice : prod(item.productId).price;
}
function itemTotal(item: QuoteItem) {
  return itemUnitPrice(item) * item.quantity;
}
function itemPriceLine(item: QuoteItem) {
  return item.isManual ? "Egyedi tétel" : `${ft(itemUnitPrice(item))} / db (telepítéssel együtt)`;
}
function hasCustomProductPrice(item: QuoteItem) {
  return !item.isManual && itemUnitPrice(item) !== prod(item.productId).price;
}
function total(items:QuoteItem[]) { return items.reduce((s,i)=>s+itemTotal(i),0); }
function occupiedSlots(customer:Customer) {
  if (!customer.time) return [];
  if (qty(customer.quoteItems) >= 2 || customer.time.includes("+")) return ["08:00","12:00"];
  return [customer.time];
}


function telHref(phone: string) {
  const cleaned = phone.replace(/[^+0-9]/g, "");
  return `tel:${cleaned}`;
}

function mapsHref(customer: Customer) {
  const destination = displayAddress(customer) || customer.name || "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

type ReturnContext = { customerId: string; view: View; at: number };
type CustomerDraft = {
  customer: Customer;
  quoteItems: QuoteItem[];
  scheduleDate: string;
  scheduleTime: string;
  view: View;
  editCustomer: boolean;
  allowWorkResourceEdit: boolean;
  at: number;
};

function safeReturnView(value: unknown): View {
  return typeof value === "string" && RESTORABLE_VIEWS.includes(value as View) ? (value as View) : "work";
}

function readReturnContext(): ReturnContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RETURN_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReturnContext>;
    if (!parsed.customerId) return null;
    const at = typeof parsed.at === "number" ? parsed.at : Date.now();
    const maxAgeMs = 6 * 60 * 60 * 1000;
    if (Date.now() - at > maxAgeMs) {
      window.sessionStorage.removeItem(RETURN_CONTEXT_KEY);
      return null;
    }
    return { customerId: parsed.customerId, view: safeReturnView(parsed.view), at };
  } catch {
    window.sessionStorage.removeItem(RETURN_CONTEXT_KEY);
    return null;
  }
}

function readCustomerDraft(): CustomerDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CUSTOMER_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomerDraft>;
    if (!parsed.customer?.id) return null;
    const at = typeof parsed.at === "number" ? parsed.at : Date.now();
    const maxAgeMs = 6 * 60 * 60 * 1000;
    if (Date.now() - at > maxAgeMs) {
      window.sessionStorage.removeItem(CUSTOMER_DRAFT_KEY);
      return null;
    }
    return {
      customer: parsed.customer as Customer,
      quoteItems: Array.isArray(parsed.quoteItems) && parsed.quoteItems.length ? parsed.quoteItems as QuoteItem[] : (parsed.customer as Customer).quoteItems || [{ productId: PRODUCTS[0].id, quantity: 1 }],
      scheduleDate: typeof parsed.scheduleDate === "string" ? parsed.scheduleDate : (parsed.customer as Customer).date || todayIso(),
      scheduleTime: typeof parsed.scheduleTime === "string" ? parsed.scheduleTime : (parsed.customer as Customer).time?.split(" ")[0] || "08:00",
      view: safeReturnView(parsed.view),
      editCustomer: Boolean(parsed.editCustomer),
      allowWorkResourceEdit: Boolean(parsed.allowWorkResourceEdit),
      at,
    };
  } catch {
    window.sessionStorage.removeItem(CUSTOMER_DRAFT_KEY);
    return null;
  }
}

function writeCustomerDraft(draft: CustomerDraft) {
  if (typeof window === "undefined" || !draft.customer?.id) return;
  try {
    window.sessionStorage.setItem(CUSTOMER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A sessionStorage csak kényelmi biztonsági mentés. Ha megtelik vagy tiltott, az app működjön tovább.
  }
}

function clearCustomerDraft(customerId?: string) {
  if (typeof window === "undefined") return;
  if (!customerId) {
    window.sessionStorage.removeItem(CUSTOMER_DRAFT_KEY);
    return;
  }
  const current = readCustomerDraft();
  if (current?.customer.id === customerId) window.sessionStorage.removeItem(CUSTOMER_DRAFT_KEY);
}

function compactCalendarDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}T${h}${min}00`;
}

function parseCalendarTime(value?: string) {
  const firstTime = (value || "08:00").match(/\d{1,2}:\d{2}/)?.[0] || "08:00";
  const [hour, minute] = firstTime.split(":").map(Number);
  return { hour: Number.isFinite(hour) ? hour : 8, minute: Number.isFinite(minute) ? minute : 0 };
}

function googleCalendarHref(customer: Customer) {
  const dateIso = customer.date || todayIso();
  const { hour, minute } = parseCalendarTime(customer.time);
  const start = new Date(`${dateIso}T00:00:00`);
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start);
  const isLongSlot = Number(qty(customer.quoteItems)) >= 2 || String(customer.time || "").includes("+");
  if (isLongSlot) {
    end.setHours(16, 0, 0, 0);
  } else if (hour >= 16) {
    end.setHours(hour + 2, minute, 0, 0);
  } else {
    end.setHours(hour + 4, minute, 0, 0);
  }

  const title = `Klímaszerelés – ${customer.name || "ügyfél"}`;
  const details = [
    customer.name ? `Ügyfél: ${customer.name}` : "",
    customer.phone ? `Telefon: ${customer.phone}` : "",
    customer.email ? `Email: ${customer.email}` : "",
    climateSummary(customer.quoteItems) ? `Klíma: ${climateSummary(customer.quoteItems)} – szereléssel együtt` : "",
    customer.need ? `Igény: ${customer.need}` : "",
    customer.notes ? `Megjegyzés: ${customer.notes}` : "",
    customer.status ? `Státusz: ${customer.status}` : "",
  ].filter(Boolean).join("\n");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${compactCalendarDate(start)}/${compactCalendarDate(end)}`,
    ctz: "Europe/Budapest",
    details,
    location: displayAddress(customer),
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function displayAddress(customer: Pick<Customer, "city" | "address">) {
  const city = (customer.city || "").trim();
  const address = (customer.address || "").trim();
  if (city && address) {
    return address.toLocaleLowerCase("hu-HU").includes(city.toLocaleLowerCase("hu-HU")) ? address : `${city}, ${address}`;
  }
  return address || city || "";
}

const EMPTY_CUSTOMER: Customer = {
  id: "",
  name: "",
  city: "",
  phone: "",
  email: "",
  address: "",
  source: "Kézi rögzítés",
  status: "Visszahívandó",
  need: "",
  notes: "",
  quoteItems: [{ productId: PRODUCTS[0].id, quantity: 1 }],
};

function normalizeStatus(status?: string) {
  if (status && STATUS_OPTIONS.includes(status)) return status;
  if (status === "Ajánlat készül" || status === "Időpont egyeztetés" || status === "Beszélve") return "Ajánlat elküldve";
  if (status === "Szerelés folyamatban") return "Időpont foglalva";
  return "Visszahívandó";
}

function isArchivedCustomer(customer: Customer) {
  return ARCHIVED_STATUSES.includes(customer.status);
}

function climateSummary(items?: QuoteItem[]) {
  const activeItems = items?.filter((item) => item.quantity > 0) || [];
  if (!activeItems.length) return "Nincs klíma megadva";
  return activeItems.map((item) => `${item.quantity} db ${itemName(item)}`).join(" + ");
}

function defaultWorkDescription() {
  return "Klímaberendezés telepítése, szükséges szerelési anyagok beépítése, nyomáspróba, vákuumozás, beüzemelés, működési próba és felhasználói betanítás.";
}

function workAcceptanceText() {
  return "Az ügyfél a munkalap aláírásával igazolja, hogy a fenti munkát átvette, a készülék működését bemutatták, és az alapvető használati tudnivalókról tájékoztatást kapott.";
}

function emptyWorkReport(customer?: Customer): WorkReport {
  return {
    customerId: customer?.id,
    workDescription: defaultWorkDescription(),
    notes: "",
    signatureDataUrl: "",
    signerName: customer?.name || "",
  };
}

function formatSignedAt(value?: string) {
  if (!value) return "nincs aláírva";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function quoteItemFromRow(row: any): QuoteItem {
  const productById = PRODUCTS.find((product) => product.id === row.description);
  const productByName = PRODUCTS.find((product) => product.name === row.product_name);
  const matchedProduct = productById || productByName;

  return {
    productId: matchedProduct?.id || PRODUCTS[0].id,
    quantity: Number(row.quantity || 1),
    customPrice: Number(row.unit_price || matchedProduct?.price || 0),
    customName: matchedProduct ? undefined : row.product_name,
    isManual: !matchedProduct,
  };
}

function quoteItemToRow(item: QuoteItem, quoteId: string) {
  return {
    quote_id: quoteId,
    product_name: itemName(item),
    description: item.productId,
    quantity: item.quantity,
    unit_price: itemUnitPrice(item),
    total_price: itemTotal(item),
  };
}

function LoginScreen({
  email,
  password,
  message,
  loading,
  onEmail,
  onPassword,
  onSubmit,
}: {
  email: string;
  password: string;
  message: string;
  loading: boolean;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
        <div className="w-full rounded-[2rem] border border-white/10 bg-slate-900/90 p-6 shadow-2xl">
          <div className="mb-6 text-center">
            <p className="mb-3 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-200">AlinFlow admin</p>
            <h1 className="text-4xl font-black">Bejelentkezés</h1>
            <p className="mt-2 text-sm text-slate-400">Csak bejelentkezés után látható az ügyfél- és munkaadatbázis.</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-black text-slate-300">Email</label>
              <input className="input" value={email} onChange={(event) => onEmail(event.target.value)} placeholder="email@pelda.hu" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-black text-slate-300">Jelszó</label>
              <input className="input" type="password" value={password} onChange={(event) => onPassword(event.target.value)} placeholder="••••••••" onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }} />
            </div>
            {message ? <div className="rounded-2xl border border-red-300/30 bg-red-400/10 p-4 text-sm font-bold text-red-100">{message}</div> : null}
            <button onClick={onSubmit} disabled={loading} className="w-full rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950 shadow-xl transition hover:scale-[1.01] disabled:cursor-wait disabled:opacity-60">
              {loading ? "Beléptetés..." : "Belépés"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  const [view,setView] = useState<View>("dashboard");
  const [taskFilter,setTaskFilter] = useState<"today" | "tomorrow" | "closing" | "stock" | "callback">("today");
  const [mode,setMode] = useState<CalendarMode>("week");
  const [calDate,setCalDate] = useState(() => new Date());
  const [customers,setCustomers] = useState<Customer[]>([]);
  const [customerSearch,setCustomerSearch] = useState("");
  const [customerStatusFilter,setCustomerStatusFilter] = useState("all");
  const [archiveVisibleCount,setArchiveVisibleCount] = useState(30);
  const [selected,setSelected] = useState<Customer>(EMPTY_CUSTOMER);
  const [quoteItems,setQuoteItems] = useState<QuoteItem[]>(EMPTY_CUSTOMER.quoteItems);
  const [scheduleDate,setScheduleDate] = useState(() => todayIso());
  const [scheduleTime,setScheduleTime] = useState("08:00");
  const [materials,setMaterials] = useState(DEFAULT_MATERIALS);
  const [materialOverrides,setMaterialOverrides] = useState<Record<string,string>>({});
  const [inventory,setInventory] = useState<InventoryItem[]>(DEFAULT_INVENTORY);
  const [materialInventory,setMaterialInventory] = useState(MATERIAL_STOCK);
  const [message,setMessage] = useState("");
  const [user,setUser] = useState<User | null>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [dataLoading,setDataLoading] = useState(false);
  const [loginEmail,setLoginEmail] = useState("");
  const [loginPassword,setLoginPassword] = useState("");
  const [loginBusy,setLoginBusy] = useState(false);
  const [loginMessage,setLoginMessage] = useState("");
  const [quoteEmailBusy,setQuoteEmailBusy] = useState(false);
  const [appointmentEmailBusy,setAppointmentEmailBusy] = useState(false);
  const [sendAppointmentNotice,setSendAppointmentNotice] = useState(true);
  const [workReport,setWorkReport] = useState<WorkReport>(emptyWorkReport());
  const [workReportsByCustomer,setWorkReportsByCustomer] = useState<Record<string, WorkReport>>({});
  const [documentsByCustomer,setDocumentsByCustomer] = useState<Record<string, DocumentRecord[]>>({});
  const [workChecklistsByCustomer,setWorkChecklistsByCustomer] = useState<Record<string, WorkChecklistState>>({});
  const [documentPreviewType,setDocumentPreviewType] = useState<DocumentPreviewType>("work_report");
  const [documentBackView,setDocumentBackView] = useState<"documents" | "work">("work");
  const [workReportBusy,setWorkReportBusy] = useState(false);
  const [workReportEmailBusy,setWorkReportEmailBusy] = useState(false);
  const [editCustomer,setEditCustomer] = useState(false);
  const [allowWorkResourceEdit,setAllowWorkResourceEdit] = useState(false);
  const [workChecklist,setWorkChecklist] = useState<WorkChecklistState>(EMPTY_WORK_CHECKLIST);
  const [leadImportRows,setLeadImportRows] = useState<LeadImportCandidate[]>([]);
  const [leadImportMessage,setLeadImportMessage] = useState("");
  const [leadImportBusy,setLeadImportBusy] = useState(false);
  const leadImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (view === "dashboard" || view === "schedule") {
      setMode("week");
      setCalDate(new Date());
    }
  }, [view]);

  useEffect(() => {
    setArchiveVisibleCount(30);
  }, [customerSearch, customerStatusFilter, view]);

  const q = qty(quoteItems);
  const t = total(quoteItems);
  const installer = Math.min(60000*q, t);
  const materialPrice = Math.max(0, t-installer);
  const isMultiDayJob = q >= 2;
  const shownTime = isMultiDayJob ? "08:00 + 12:00" : scheduleTime;
  const activeCustomers = customers.filter((customer) => !isArchivedCustomer(customer));
  const archivedCustomers = customers.filter(isArchivedCustomer);
  const calendarCustomers = customers.filter((customer) => Boolean(customer.date) && customer.status !== "Lemondva");
  const workResourceEditLocked = selected.status === "Szerelés kész – admin folyamatban" || selected.status === "Lezárva";
  const canEditWorkResources = !workResourceEditLocked || allowWorkResourceEdit;
  const hasCustomerFilter = customerSearch.trim().length > 0 || customerStatusFilter !== "all";
  const filteredCustomers = customers.filter((customer) => customerMatchesSearch(customer));
  const filteredActiveCustomers = activeCustomers.filter((customer) => customerMatchesSearch(customer));
  const filteredArchivedCustomers = archivedCustomers.filter((customer) => customerMatchesSearch(customer));
  const visibleArchivedCustomers = filteredArchivedCustomers.slice(0, archiveVisibleCount);
  const hasMoreArchivedCustomers = filteredArchivedCustomers.length > visibleArchivedCustomers.length;

  function normalizeSearch(value?: string) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function customerMatchesSearch(customer: Customer, search = customerSearch, status = customerStatusFilter) {
    const statusOk = status === "all" || (customer.status || "") === status;
    if (!statusOk) return false;

    const needle = normalizeSearch(search);
    if (!needle) return true;

    const haystack = normalizeSearch([
      customer.name,
      customer.city,
      customer.address,
      customer.phone,
      customer.email,
      customer.status,
      customer.source,
      customer.need,
      customer.notes,
      climateSummary(customer.quoteItems),
    ].filter(Boolean).join(" "));

    return haystack.includes(needle);
  }

  function clearCustomerFilter() {
    setCustomerSearch("");
    setCustomerStatusFilter("all");
    setArchiveVisibleCount(30);
  }

  function normalizeEmailForCompare(value?: string) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizePhoneForStorage(value?: string) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    const digits = raw.replace(/\D/g, "");
    if (!digits) return "";

    if (digits.startsWith("0036")) return `06${digits.slice(4)}`;
    if (digits.startsWith("36")) return `06${digits.slice(2)}`;
    if (digits.startsWith("06")) return digits;
    if (digits.startsWith("0")) return digits;

    return `06${digits}`;
  }

  function normalizePhoneForCompare(value?: string) {
    return normalizePhoneForStorage(value).replace(/\D/g, "");
  }

  function normalizeCsvHeader(value?: string) {
    return normalizeSearch(value).replace(/[^a-z0-9]/g, "");
  }

  function parseCsvText(text: string) {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === "," && !inQuotes) {
        row.push(cell.trim());
        cell = "";
        continue;
      }

      if ((ch === "
" || ch === "") && !inQuotes) {
        if (ch === "" && next === "
") i += 1;
        row.push(cell.trim());
        cell = "";
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
        continue;
      }

      cell += ch;
    }

    row.push(cell.trim());
    if (row.some((value) => value.trim())) rows.push(row);
    return rows;
  }

  function findCsvIndex(headers: string[], variants: string[]) {
    const normalizedHeaders = headers.map(normalizeCsvHeader);
    const normalizedVariants = variants.map(normalizeCsvHeader);
    return normalizedHeaders.findIndex((header) => normalizedVariants.includes(header));
  }

  function buildLeadImportPreview(text: string): LeadImportCandidate[] {
    const rows = parseCsvText(text.replace(/^﻿/, ""));
    if (rows.length < 2) return [];

    const headers = rows[0];
    const nameIndex = findCsvIndex(headers, ["Név", "Nev", "Name", "Full name", "Teljes név"]);
    const emailIndex = findCsvIndex(headers, ["E-mail-cím", "Email", "E-mail", "Email cím", "E-mail cím"]);
    const phoneIndex = findCsvIndex(headers, ["Telefon", "Phone", "Telefonszám", "Phone number", "Mobile"]);

    const existingPhones = new Set(customers.map((customer) => normalizePhoneForCompare(customer.phone)).filter(Boolean));
    const existingEmails = new Set(customers.map((customer) => normalizeEmailForCompare(customer.email)).filter(Boolean));
    const keptByKey = new Map<string, LeadImportCandidate>();
    const keptRows: LeadImportCandidate[] = [];
    const skippedRows: LeadImportCandidate[] = [];

    rows.slice(1).forEach((cells, index) => {
      const rowNumber = index + 2;
      const name = nameIndex >= 0 ? String(cells[nameIndex] || "").trim() : "";
      const email = emailIndex >= 0 ? normalizeEmailForCompare(cells[emailIndex]) : "";
      const phone = phoneIndex >= 0 ? normalizePhoneForStorage(cells[phoneIndex]) : "";
      const phoneKey = normalizePhoneForCompare(phone);
      const emailKey = normalizeEmailForCompare(email);

      let invalid = false;
      let invalidReason = "";

      if (!name && !phone && !email) {
        invalid = true;
        invalidReason = "üres sor";
      } else if (!name) {
        invalid = true;
        invalidReason = "hiányzó név";
      } else if (!phone && !email) {
        invalid = true;
        invalidReason = "hiányzó telefonszám és email";
      }

      if (invalid) {
        skippedRows.push({
          id: `${rowNumber}-${phoneKey || emailKey || name || "invalid"}`,
          rowNumber,
          name,
          phone,
          email,
          duplicate: false,
          invalid: true,
          invalidReason,
        });
        return;
      }

      if (phoneKey && existingPhones.has(phoneKey)) {
        skippedRows.push({
          id: `${rowNumber}-${phoneKey}`,
          rowNumber,
          name,
          phone,
          email,
          duplicate: true,
          duplicateReason: "már létező telefonszám",
        });
        return;
      }

      if (emailKey && existingEmails.has(emailKey)) {
        skippedRows.push({
          id: `${rowNumber}-${emailKey}`,
          rowNumber,
          name,
          phone,
          email,
          duplicate: true,
          duplicateReason: "már létező email",
        });
        return;
      }

      const keys = [phoneKey ? `p:${phoneKey}` : "", emailKey ? `e:${emailKey}` : ""].filter(Boolean);
      const existingKey = keys.find((key) => keptByKey.has(key));

      if (existingKey) {
        const kept = keptByKey.get(existingKey)!;
        kept.name = kept.name || name;
        kept.phone = kept.phone || phone;
        kept.email = kept.email || email;
        kept.mergedRows = (kept.mergedRows || 1) + 1;
        keys.forEach((key) => keptByKey.set(key, kept));
        return;
      }

      const candidate: LeadImportCandidate = {
        id: `${rowNumber}-${phoneKey || emailKey || name}`,
        rowNumber,
        name,
        phone,
        email,
        duplicate: false,
        mergedRows: 1,
      };
      keys.forEach((key) => keptByKey.set(key, candidate));
      keptRows.push(candidate);
    });

    return [...keptRows, ...skippedRows].filter((candidate) => candidate.name || candidate.phone || candidate.email || candidate.invalid);
  }

  async function handleLeadCsvFile(file?: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      const preview = buildLeadImportPreview(text);
      const importable = preview.filter((row) => !row.duplicate && !row.invalid).length;
      const duplicates = preview.filter((row) => row.duplicate).length;
      const invalid = preview.filter((row) => row.invalid).length;
      const merged = preview.filter((row) => !row.duplicate && !row.invalid && (row.mergedRows || 1) > 1).length;
      setLeadImportRows(preview);
      setLeadImportMessage(`${preview.length} előnézeti sor · ${importable} új érdeklődő · ${duplicates} meglévő duplikáció kihagyva${merged ? ` · ${merged} fájlon belüli duplikáció összevonva` : ""}${invalid ? ` · ${invalid} hibás sor` : ""}`);
    } catch (error: any) {
      setLeadImportRows([]);
      setLeadImportMessage(`Nem sikerült beolvasni a CSV fájlt: ${error.message}`);
    }
  }

  async function importLeadRows() {
    const importable = leadImportRows.filter((row) => !row.duplicate && !row.invalid);
    if (!importable.length) {
      setLeadImportMessage("Nincs importálható új érdeklődő.");
      return;
    }

    setLeadImportBusy(true);
    setLeadImportMessage("Importálás folyamatban...");

    try {
      const now = new Date().toISOString();
      const rows = importable.map((lead) => ({
        id: crypto.randomUUID(),
        name: lead.name,
        phone: lead.phone || null,
        email: lead.email || null,
        city: null,
        address: null,
        source: "Kézi rögzítés",
        status: "Visszahívandó",
        need: null,
        notes: null,
        created_by: user?.id || null,
        created_at: now,
        updated_at: now,
      }));

      const { data, error } = await supabase.from("customers").insert(rows).select("*");
      if (error) throw error;

      const newCustomers = (data || []).map((row: any) => ({
        id: row.id,
        name: row.name || "",
        city: row.city || "",
        phone: row.phone || "",
        email: row.email || "",
        address: row.address || "",
        source: row.source || "Kézi rögzítés",
        status: normalizeStatus(row.status || "Visszahívandó"),
        need: row.need || "",
        notes: row.notes || "",
        quoteItems: [{ productId: PRODUCTS[0].id, quantity: 1 }],
      })) as Customer[];

      setCustomers((prev) => [...newCustomers, ...prev]);
      setLeadImportRows([]);
      setLeadImportMessage(`${newCustomers.length} új érdeklődő importálva ✅ A fájlon belüli duplikációkból egy ügyfél készült, a meglévő ügyfeleket kihagytam.`);
    } catch (error: any) {
      setLeadImportMessage(`Importálási hiba: ${error.message}`);
    } finally {
      setLeadImportBusy(false);
    }
  }

  function openCustomerFromSearch(customer: Customer) {
    openCustomer(customer, customer.date ? "work" : "lead");
  }

  function rememberExternalCustomer(customer: Customer, returnView: View = view) {
    if (typeof window === "undefined" || !customer.id) return;
    window.sessionStorage.setItem(
      RETURN_CONTEXT_KEY,
      JSON.stringify({ customerId: customer.id, view: safeReturnView(returnView), at: Date.now() })
    );
  }

  useEffect(() => {
    if (!selected.id || !RESTORABLE_VIEWS.includes(view)) return;
    writeCustomerDraft({
      customer: { ...selected, quoteItems: quoteItems.length ? quoteItems : selected.quoteItems || [{ productId: PRODUCTS[0].id, quantity: 1 }] },
      quoteItems: quoteItems.length ? quoteItems : selected.quoteItems || [{ productId: PRODUCTS[0].id, quantity: 1 }],
      scheduleDate,
      scheduleTime,
      view,
      editCustomer,
      allowWorkResourceEdit,
      at: Date.now(),
    });
  }, [selected, quoteItems, scheduleDate, scheduleTime, view, editCustomer, allowWorkResourceEdit]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [view]);


  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const currentUser = data.session?.user ?? null;
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) void loadCustomersFromDb();
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) void loadCustomersFromDb();
      else {
        setCustomers([]);
        setSelected(EMPTY_CUSTOMER);
        setQuoteItems(EMPTY_CUSTOMER.quoteItems);
        setWorkReportsByCustomer({});
        setDocumentsByCustomer({});
        setWorkChecklistsByCustomer({});
        setWorkChecklist(EMPTY_WORK_CHECKLIST);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const checklistItems: { key: keyof WorkChecklistState; label: string }[] = [
    { key: "nkvh", label: "NKVH adatok rögzítése" },
    { key: "worksheet", label: "Munkalap kitöltve" },
    { key: "purchaseDeclaration", label: "Vásárlási nyilatkozat kész" },
    { key: "signature", label: "Ügyfél aláírása megvan" },
    { key: "alinInvoice", label: "Adorján Alin E.V. számla kész" },
    { key: "amovaInvoice", label: "AMOVA 4U Kft. számla kész" },
    { key: "docsSent", label: "Dokumentumcsomag elküldve" },
  ];

  const currentWorkChecklist = selected.id ? effectiveChecklistFor(selected) : workChecklist;
  const missingChecklist = checklistItems.filter((item) => !currentWorkChecklist[item.key]).map((item) => item.label);
  const checklistReady = missingChecklist.length === 0;

  function openCustomer(c:Customer, v:View) {
    setSelected(c);
    setQuoteItems(c.quoteItems);
    setScheduleDate(c.date || todayIso());
    setScheduleTime(c.time?.split(" ")[0] || "08:00");
    setWorkReport(emptyWorkReport(c));
    setWorkChecklist(effectiveChecklistFor(c));
    setEditCustomer(false);
    setAllowWorkResourceEdit(false);
    setView(v);
  }

  function openTask(filter: "today" | "tomorrow" | "closing" | "stock" | "callback") {
    setTaskFilter(filter);
    setView("tasks");
  }


  async function handleLogin() {
    setLoginBusy(true);
    setLoginMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });

    setLoginBusy(false);
    if (error) {
      setLoginMessage("Nem sikerült belépni. Ellenőrizd az emailt és a jelszót.");
    }
  }

  async function handleLogout() {
    clearCustomerDraft();
    await supabase.auth.signOut();
    setView("dashboard");
  }

  async function loadCustomersFromDb() {
    setDataLoading(true);
    setMessage("");

    const { data: customerRows, error: customerError } = await supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });

    if (customerError) {
      setMessage(`Nem sikerült betölteni az ügyfeleket: ${customerError.message}`);
      setDataLoading(false);
      return;
    }

    const { data: quoteRows } = await supabase
      .from("quotes")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: itemRows } = await supabase
      .from("quote_items")
      .select("*");

    const { data: jobRows } = await supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: workReportRows } = await supabase
      .from("work_reports")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: documentRows } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: checklistRows } = await supabase
      .from("work_checklists")
      .select("*");

    const quotesByCustomer = new Map<string, any>();
    (quoteRows || []).forEach((quote: any) => {
      if (!quotesByCustomer.has(quote.customer_id)) quotesByCustomer.set(quote.customer_id, quote);
    });

    const itemsByQuote = new Map<string, any[]>();
    (itemRows || []).forEach((item: any) => {
      const current = itemsByQuote.get(item.quote_id) || [];
      current.push(item);
      itemsByQuote.set(item.quote_id, current);
    });

    const jobsByCustomer = new Map<string, any>();
    (jobRows || []).forEach((job: any) => {
      if (!jobsByCustomer.has(job.customer_id)) jobsByCustomer.set(job.customer_id, job);
    });

    const workReportsMap: Record<string, WorkReport> = {};
    (workReportRows || []).forEach((row: any) => {
      if (!row.customer_id) return;
      workReportsMap[row.customer_id] = workReportFromRow(row);
    });

    const documentsMap: Record<string, DocumentRecord[]> = {};
    (documentRows || []).forEach((row: any) => {
      if (!row.customer_id) return;
      const current = documentsMap[row.customer_id] || [];
      current.push(documentFromRow(row));
      documentsMap[row.customer_id] = current;
    });

    const checklistsMap: Record<string, WorkChecklistState> = {};
    (checklistRows || []).forEach((row: any) => {
      if (!row.customer_id) return;
      checklistsMap[row.customer_id] = workChecklistFromRow(row);
    });

    const loadedCustomers: Customer[] = (customerRows || []).map((row: any) => {
      const quote = quotesByCustomer.get(row.id);
      const job = jobsByCustomer.get(row.id);
      const quoteItemsFromDb = quote ? (itemsByQuote.get(quote.id) || []).map(quoteItemFromRow) : [];

      return {
        id: row.id,
        name: row.name || "",
        city: row.city || "",
        phone: row.phone || "",
        email: row.email || "",
        address: row.address || job?.address || "",
        source: row.source || "Kézi rögzítés",
        status: normalizeStatus(row.status || job?.status || "Visszahívandó"),
        need: row.need || "",
        notes: row.notes || "",
        date: job?.scheduled_date || undefined,
        time: job?.scheduled_time || undefined,
        quoteItems: quoteItemsFromDb.length ? quoteItemsFromDb : [{ productId: PRODUCTS[0].id, quantity: 1 }],
        productId: quoteItemsFromDb[0]?.productId,
      };
    });

    const returnContext = readReturnContext();
    const customerDraft = readCustomerDraft();
    const selectedFromReturn = returnContext?.customerId
      ? loadedCustomers.find((customer) => customer.id === returnContext.customerId)
      : undefined;
    const selectedFromDraftDb = customerDraft?.customer.id
      ? loadedCustomers.find((customer) => customer.id === customerDraft.customer.id)
      : undefined;
    const selectedFromDraft = customerDraft
      ? {
          ...(selectedFromDraftDb || {}),
          ...customerDraft.customer,
          quoteItems: customerDraft.quoteItems.length ? customerDraft.quoteItems : customerDraft.customer.quoteItems,
        } as Customer
      : undefined;
    const selectedFromCurrentState = selected.id
      ? loadedCustomers.find((customer) => customer.id === selected.id)
      : undefined;
    const unsavedSelected = selected.id ? selected : undefined;
    const nextSelected = selectedFromReturn || selectedFromDraft || selectedFromCurrentState || unsavedSelected || loadedCustomers[0] || EMPTY_CUSTOMER;
    const nextQuoteItems = selectedFromDraft ? (customerDraft?.quoteItems || nextSelected.quoteItems) : nextSelected.quoteItems;

    setCustomers(loadedCustomers);
    setWorkReportsByCustomer(workReportsMap);
    setDocumentsByCustomer(documentsMap);
    setWorkChecklistsByCustomer(checklistsMap);
    setSelected(nextSelected);
    setQuoteItems(nextQuoteItems);
    setWorkChecklist(effectiveChecklistFor(nextSelected, workReportsMap, documentsMap, checklistsMap));

    if (selectedFromReturn && returnContext) {
      setScheduleDate(nextSelected.date || todayIso());
      setScheduleTime(nextSelected.time?.split(" ")[0] || "08:00");
      setWorkReport(emptyWorkReport(nextSelected));
      setEditCustomer(false);
      setView(returnContext.view);
      if (typeof window !== "undefined") window.sessionStorage.removeItem(RETURN_CONTEXT_KEY);
    } else if (customerDraft && selectedFromDraft) {
      setScheduleDate(customerDraft.scheduleDate || nextSelected.date || todayIso());
      setScheduleTime(customerDraft.scheduleTime || nextSelected.time?.split(" ")[0] || "08:00");
      setEditCustomer(customerDraft.editCustomer);
      setAllowWorkResourceEdit(customerDraft.allowWorkResourceEdit);
      if (RESTORABLE_VIEWS.includes(customerDraft.view)) setView(customerDraft.view);
    }

    setDataLoading(false);
  }

  async function persistCustomerToDb(customer: Customer) {
    if (!user || !customer.id || !customer.name.trim()) return;

    const { error: customerError } = await supabase.from("customers").upsert({
      id: customer.id,
      name: customer.name,
      phone: customer.phone || null,
      email: customer.email || null,
      city: customer.city || null,
      address: customer.address || null,
      source: customer.source || "Kézi rögzítés",
      status: customer.status || "Visszahívandó",
      need: customer.need || null,
      notes: customer.notes || null,
      created_by: user.id,
    });

    if (customerError) throw customerError;

    const { data: existingQuotes } = await supabase
      .from("quotes")
      .select("id")
      .eq("customer_id", customer.id)
      .limit(1);

    let quoteId = existingQuotes?.[0]?.id as string | undefined;
    const quotePayload = {
      customer_id: customer.id,
      status: normalizeStatus(customer.status || "Ajánlat elküldve"),
      total_amount: total(customer.quoteItems || []),
      notes: null,
      created_by: user.id,
    };

    if (quoteId) {
      const { error } = await supabase.from("quotes").update(quotePayload).eq("id", quoteId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("quotes").insert(quotePayload).select("id").single();
      if (error) throw error;
      quoteId = data.id;
    }

    if (quoteId) {
      await supabase.from("quote_items").delete().eq("quote_id", quoteId);
      if (customer.quoteItems?.length) {
        const { error } = await supabase.from("quote_items").insert(customer.quoteItems.map((item) => quoteItemToRow(item, quoteId as string)));
        if (error) throw error;
      }
    }

    if (customer.date) {
      const { data: existingJobs } = await supabase
        .from("jobs")
        .select("id")
        .eq("customer_id", customer.id)
        .limit(1);

      const jobPayload = {
        customer_id: customer.id,
        quote_id: quoteId || null,
        title: customer.name,
        scheduled_date: customer.date,
        scheduled_time: customer.time || "08:00",
        status: normalizeStatus(customer.status || "Időpont foglalva"),
        address: customer.address || null,
        notes: customer.notes || customer.need || null,
        created_by: user.id,
      };

      const jobId = existingJobs?.[0]?.id as string | undefined;
      const { error } = jobId
        ? await supabase.from("jobs").update(jobPayload).eq("id", jobId)
        : await supabase.from("jobs").insert(jobPayload);
      if (error) throw error;
    } else if (customer.status === "Lemondva") {
      await supabase.from("jobs").delete().eq("customer_id", customer.id);
    }
  }

  function startNewCustomer() {
    const fresh: Customer = {
      id: crypto.randomUUID(),
      name: "",
      city: "",
      phone: "",
      email: "",
      address: "",
      source: "Kézi rögzítés",
      status: "Visszahívandó",
      need: "",
      notes: "",
      quoteItems: [{ productId: PRODUCTS[0].id, quantity: 1 }],
    };

    setSelected(fresh);
    setQuoteItems(fresh.quoteItems);
    setScheduleDate(todayIso());
    setScheduleTime("08:00");
    setAllowWorkResourceEdit(false);
    setView("lead");
  }

  function updateSelectedField(field: keyof Customer, value: string) {
    setSelected((prev) => ({ ...prev, [field]: value }));
  }

  async function saveCustomerData() {
    try {
      await persistCustomerToDb(selected);
      setCustomers((prev) => prev.map((customer) => customer.id === selected.id ? selected : customer));
      setEditCustomer(false);
      setMessage("Ügyféladatok mentve ✅");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  function updateCustomerStatus(value: string) {
    setSelected((prev) => ({ ...prev, status: normalizeStatus(value) }));
  }

  async function persistWorkChecklist(customer: Customer, checklist: WorkChecklistState) {
    if (!customer.id || !user) return;

    const payload = {
      customer_id: customer.id,
      worksheet: checklist.worksheet,
      signature: checklist.signature,
      purchase_declaration: checklist.purchaseDeclaration,
      alin_invoice: checklist.alinInvoice,
      amova_invoice: checklist.amovaInvoice,
      nkvh: checklist.nkvh,
      docs_sent: checklist.docsSent,
      updated_by: user.id,
    };

    const { error } = await supabase
      .from("work_checklists")
      .upsert(payload, { onConflict: "customer_id" });

    if (error) {
      console.warn("work_checklists mentési hiba", error.message);
      setMessage("A lezárási ellenőrzőlista nem mentődött. Futtasd a WORK_CHECKLIST_SQL.sql fájlt a Supabase-ben.");
    }
  }

  async function updateChecklistForCustomer(customer: Customer, patch: Partial<WorkChecklistState>) {
    const base = effectiveChecklistFor(customer);
    const next: WorkChecklistState = { ...base, ...patch };
    setWorkChecklist(next);
    setWorkChecklistsByCustomer((prev) => ({ ...prev, [customer.id]: next }));
    await persistWorkChecklist(customer, next);
    return next;
  }

  async function toggleChecklist(key: keyof WorkChecklistState) {
    const base = selected.id ? effectiveChecklistFor(selected) : workChecklist;
    const next: WorkChecklistState = { ...base, [key]: !base[key] };
    setWorkChecklist(next);

    if (selected.id) {
      setWorkChecklistsByCustomer((prev) => ({ ...prev, [selected.id]: next }));
      await persistWorkChecklist(selected, next);
    }
  }

  async function saveCustomer(nextView: View = "quote") {
    const autoStatus =
      nextView === "quote"
        ? "Ajánlat elküldve"
        : nextView === "schedule"
        ? "Ajánlat elküldve"
        : normalizeStatus(selected.status || "Visszahívandó");

    const customerToSave: Customer = {
      ...selected,
      source: selected.source || "Kézi rögzítés",
      status: autoStatus,
      quoteItems: quoteItems.length ? quoteItems : [{ productId: PRODUCTS[0].id, quantity: 1 }],
    };

    setSelected(customerToSave);
    setCustomers((prev) => {
      const exists = prev.some((customer) => customer.id === customerToSave.id);
      if (exists) {
        return prev.map((customer) => customer.id === customerToSave.id ? customerToSave : customer);
      }
      return [customerToSave, ...prev];
    });

    try {
      await persistCustomerToDb(customerToSave);
      setMessage("Ügyfél mentve ✅");
      setView(nextView);
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  async function saveCustomerOnly() {
    const customerToSave: Customer = {
      ...selected,
      source: selected.source || "Kézi rögzítés",
      status: normalizeStatus(selected.status || "Visszahívandó"),
      quoteItems: quoteItems.length ? quoteItems : [{ productId: PRODUCTS[0].id, quantity: 1 }],
    };

    setSelected(customerToSave);
    setCustomers((prev) => {
      const exists = prev.some((customer) => customer.id === customerToSave.id);
      if (exists) {
        return prev.map((customer) => customer.id === customerToSave.id ? customerToSave : customer);
      }
      return [customerToSave, ...prev];
    });

    try {
      await persistCustomerToDb(customerToSave);
      setMessage("Ügyféladatok mentve ✅");
      clearCustomerDraft(customerToSave.id);
      setView("dashboard");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }
  function step(d:number) {
    const n = new Date(calDate);
    if (mode==="week") n.setDate(n.getDate()+d*7); else n.setMonth(n.getMonth()+d);
    setCalDate(n);
  }
  function addQuoteItem() { setQuoteItems(prev=>[...prev, { productId: PRODUCTS[0].id, quantity: 1 }]); }
  function addManualQuoteItem() { setQuoteItems(prev=>[...prev, { productId: PRODUCTS[0].id, customName: "Egyedi tétel", customPrice: 0, quantity: 1, isManual: true }]); }
  function updateQuoteItem(i:number, key:keyof QuoteItem, value:string|number|boolean) {
    setQuoteItems(prev=>prev.map((it,idx)=>idx===i ? {...it, [key]: value} : it));
  }
  function updateQuoteProduct(i:number, productId:string) {
    setQuoteItems(prev=>prev.map((it,idx)=>idx===i ? {
      ...it,
      productId,
      isManual: false,
      customName: undefined,
      customPrice: prod(productId).price,
    } : it));
  }
  function syncQuoteItemPrice(i:number) {
    setQuoteItems(prev=>prev.map((it,idx)=>idx===i ? { ...it, customPrice: prod(it.productId).price } : it));
  }
  function removeQuoteItem(i:number) { setQuoteItems(prev=>prev.length===1 ? prev : prev.filter((_,idx)=>idx!==i)); }
  async function saveSchedule() {
    const wasExistingSchedule = Boolean(selected.date);
    const updated:Customer = {...selected, date:scheduleDate, time:shownTime, status:"Időpont foglalva", quoteItems, productId:quoteItems[0].productId, isFresh:true};
    try {
      await persistCustomerToDb(updated);
      setCustomers(prev=>prev.map(c=>c.id===updated.id ? updated : c));
      setSelected(updated);

      if (sendAppointmentNotice) {
        const sent = await sendAppointmentEmailFor(updated);
        setMessage(sent ? (wasExistingSchedule ? "Időpont módosítva és tájékoztató email elküldve ✅" : "Időpont mentve és tájékoztató email elküldve ✅") : "Időpont mentve, de az email küldése nem sikerült.");
      } else {
        setMessage(wasExistingSchedule ? "Időpont módosítva ✅ Email nem ment ki." : "Időpont mentve a naptárba ✅ Email nem ment ki.");
      }

      setView(wasExistingSchedule ? "work" : "dashboard");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  async function saveWorkChanges() {
    if (workResourceEditLocked && !allowWorkResourceEdit) {
      setMessage("A szerelés készre jelölése után a klímák és anyagok csak a Módosítás engedélyezése gombbal szerkeszthetők.");
      return;
    }

    const newQty = qty(quoteItems);
    const updatedTime = newQty >= 2 ? "08:00 + 12:00" : (selected.time || scheduleTime || "08:00");
    const updated: Customer = {
      ...selected,
      quoteItems,
      productId: quoteItems[0]?.productId || selected.productId,
      time: updatedTime,
      status: selected.status || "Időpont foglalva",
      isFresh: true,
    };

    try {
      await persistCustomerToDb(updated);
      setSelected(updated);
      setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
      setAllowWorkResourceEdit(false);
      setMessage("Időponthoz tartozó klímák és anyagok módosítva ✅");
      setView("work");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  function perClimateMaterialAmount(materialName: string) {
    const perClimate: Record<string, number> = {
      "Alukasírozott rézcső": 3,
      "450-es konzol": 1,
      "550-es konzol": 0,
      "Rezgéscsillapító": 1,
      "3×1,5 gumikábel": 5,
      "5×1,5 gumikábel": 2.5,
      "160-as csavar": 4,
    };
    return perClimate[materialName] ?? 0;
  }

  function stockErrorMessage() {
    const shortageProduct = quoteItems.find((q) => reservedForProduct(q.productId) > stockOf(q.productId));
    if (shortageProduct) {
      const p = prod(shortageProduct.productId);
      return `Nem zárható le: ${p.name} készlethiányos. Raktáron: ${stockOf(shortageProduct.productId)} db, lefoglalva: ${reservedForProduct(shortageProduct.productId)} db.`;
    }

    const shortageMaterial = materialInventory.find((item: any) => usedMaterialAmountForStock(item.name) > item.stock);
    if (shortageMaterial) {
      const used = usedMaterialAmountForStock(shortageMaterial.name);
      return `Nem zárható le: ${shortageMaterial.name} készlethiányos. Raktáron: ${shortageMaterial.stock} ${shortageMaterial.unit}, szükséges: ${used} ${shortageMaterial.unit}.`;
    }

    return "";
  }

  function deductStockIfNeeded() {
    if (selected.stockDeducted) return;

    setInventory(prev => prev.map(item => {
      const used = quoteItems
        .filter(q => q.productId === item.productId)
        .reduce((sum, q) => sum + q.quantity, 0);
      return used > 0 ? { ...item, stock: Math.max(0, item.stock - used) } : item;
    }));

    setMaterialInventory(prev => prev.map((item: any) => {
      const used = usedMaterialAmountForStock(item.name);
      return used > 0 ? { ...item, stock: Math.max(0, Math.round((item.stock - used) * 10) / 10) } : item;
    }));
  }

  async function markInstallationDone() {
    const error = stockErrorMessage();
    if (error) {
      setMessage(error);
      setView("dashboard");
      return;
    }

    deductStockIfNeeded();

    const updated: Customer = {
      ...selected,
      quoteItems,
      status: "Szerelés kész – admin folyamatban",
      isFresh: false,
      stockDeducted: true,
    };

    try {
      await persistCustomerToDb(updated);
      setSelected(updated);
      setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
      setAllowWorkResourceEdit(false);
      setMessage("Szerelés kész ✅ A klímák és az anyagok zárolva, admin még folyamatban.");
      setView("work");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  async function closeWork() {
    const error = stockErrorMessage();
    if (error) {
      setMessage(error);
      setView("dashboard");
      return;
    }

    if (!checklistReady) {
      setMessage(`Nem zárható teljesen. Hiányzik: ${missingChecklist.join(", ")}.`);
      return;
    }

    deductStockIfNeeded();

    const updated: Customer = {
      ...selected,
      quoteItems,
      status: "Lezárva",
      isFresh: false,
      stockDeducted: true,
    };

    try {
      await persistCustomerToDb(updated);
      setSelected(updated);
      setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
      setAllowWorkResourceEdit(false);
      setMessage("Munka teljesen lezárva ✅ A naptárban sötétzöld lezárt munkaként megmarad.");
      setView("dashboard");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  async function cancelAppointment() {
    const updated: Customer = {
      ...selected,
      date: undefined,
      time: undefined,
      status: "Lemondva",
      isFresh: false,
    };

    try {
      await persistCustomerToDb(updated);
      setSelected(updated);
      setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
      setMessage("Időpont törölve / lemondva ✅ A foglalás felszabadult.");
      setView("dashboard");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }
  async function restoreArchivedCustomer(customer: Customer) {
    const restored: Customer = {
      ...customer,
      status: customer.date ? "Időpont foglalva" : "Visszahívandó",
      isFresh: true,
    };

    try {
      await persistCustomerToDb(restored);
      setCustomers((prev) => prev.map((item) => item.id === restored.id ? restored : item));
      setSelected(restored);
      setMessage(`${restored.name || "Ügyfél"} visszaállítva ✅`);
      setView(restored.date ? "work" : "lead");
    } catch (error: any) {
      setMessage(`Visszaállítási hiba: ${error.message}`);
    }
  }

  function addExtraMaterial() { setMaterials(prev=>[...prev, { name:"Egyéb anyag", qty:"1", unit:"db", isExtra:true }]); }
  function updateMaterial(i:number, key:"name"|"qty"|"unit", value:string) {
    setMaterials(prev=>prev.map((m,idx)=>idx===i ? {...m, [key]:value} : m));
  }


  function reservedForProduct(productId: string) {
    return customers
      .filter((customer) => Boolean(customer.date) && customer.status !== "Lezárva" && customer.status !== "Lemondva")
      .reduce((sum, customer) => {
        const items = customer.quoteItems ?? [];
        return sum + items
          .filter((item) => item.productId === productId)
          .reduce((itemSum, item) => itemSum + item.quantity, 0);
      }, 0);
  }

  function stockOf(productId: string) {
    return inventory.find((item) => item.productId === productId)?.stock ?? 0;
  }

  function freeStock(productId: string) {
    return stockOf(productId) - reservedForProduct(productId);
  }

  function addStock(productId: string, amount: number) {
    if (!amount || amount <= 0) return;
    setInventory((prev) => {
      const exists = prev.some((item) => item.productId === productId);
      if (exists) {
        return prev.map((item) => item.productId === productId ? { ...item, stock: item.stock + amount } : item);
      }
      return [...prev, { productId, stock: amount }];
    });
  }




  function baseMaterialAmountPerClimate(materialName: string) {
    const perClimate: Record<string, number> = {
      "Alukasírozott rézcső": 3,
      "450-es konzol": 1,
      "550-es konzol": 0,
      "Rezgéscsillapító": 1,
      "3×1,5 gumikábel": 5,
      "5×1,5 gumikábel": 2.5,
      "160-as csavar": 4,
    };
    return perClimate[materialName] ?? 0;
  }

  function materialReserved(materialName: string) {
    const activeJobs = customers.filter((customer: any) => Boolean(customer.date) && customer.status !== "Lezárva" && customer.status !== "Lemondva");

    return Math.round(activeJobs.reduce((sum: number, customer: any) => {
      const items = customer.quoteItems ?? [];
      const climateCount = Math.max(1, items.reduce((s: number, item: any) => s + (item.quantity ?? 1), 0));

      // Ha az aktuálisan megnyitott munkán módosítod az anyagmennyiséget,
      // akkor a raktár lefoglalás és a készlethiány figyelmeztetés már ezt vegye figyelembe.
      if (customer.id === selected.id) {
        return sum + usedMaterialAmountForStock(materialName);
      }

      return sum + (baseMaterialAmountPerClimate(materialName) * climateCount);
    }, 0) * 10) / 10;
  }

  function addMaterialStock(materialName: string, amount: number) {
    if (!amount || amount <= 0) return;
    setMaterialInventory((prev: any[]) => prev.map((item: any) => item.name === materialName ? { ...item, stock: item.stock + amount } : item));
  }


  function climateCountForMaterials() {
    return Math.max(1, qty(quoteItems));
  }

  function multiplyQty(value: string, count: number) {
    const normalized = String(value).replace(",", ".");
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return value;

    const result = Math.round(numeric * count * 10) / 10;
    return String(result).replace(".", ",");
  }

  function materialDisplayQty(material: any) {
    if (material.isExtra) return material.qty;
    if (material.name === "Konzol") return material.qty;
    return multiplyQty(material.qty, climateCountForMaterials());
  }

  function materialDisplayUnit(material: any) {
    if (material.name === "Konzol") return `${climateCountForMaterials()} db`;
    return material.unit;
  }

  function finalMaterialQty(material: any) {
    return materialOverrides[material.name] ?? materialDisplayQty(material);
  }

  function updateFinalMaterialQty(materialName: string, value: string) {
    setMaterialOverrides((prev) => ({ ...prev, [materialName]: value }));
  }

  function toNumber(value: string) {
    const n = Number(String(value).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  function usedMaterialAmountForStock(itemName: string) {
    const climateCount = climateCountForMaterials();
    const selectedConsole = materials.find((m:any) => m.name === "Konzol")?.qty ?? "450-es konzol";

    if (itemName === "450-es konzol") return selectedConsole === "450-es konzol" ? climateCount : 0;
    if (itemName === "550-es konzol") return selectedConsole === "550-es konzol" ? climateCount : 0;

    const material = materials.find((m:any) => m.name === itemName);
    if (!material) return 0;

    return toNumber(finalMaterialQty(material));
  }



  if (authLoading) {
    return <main className="min-h-screen bg-slate-950 p-8 text-slate-100"><div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-slate-900/80 p-6 font-black">AlinFlow betöltése...</div></main>;
  }

  if (!user) {
    return <LoginScreen email={loginEmail} password={loginPassword} message={loginMessage} loading={loginBusy} onEmail={setLoginEmail} onPassword={setLoginPassword} onSubmit={handleLogin} />;
  }

  if (dataLoading) {
    return <main className="min-h-screen bg-slate-950 p-8 text-slate-100"><div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-slate-900/80 p-6 font-black">Adatok betöltése Supabase-ből...</div></main>;
  }

  if (view==="tasks") {
    const taskTitleMap: Record<string, string> = {
      today: "Mai munkák",
      tomorrow: "Holnapi munkák",
      closing: "Lezárásra vár",
      stock: "Készlethiány / raktár figyelmeztetés",
      callback: "Visszahívandó leadek",
    };

    const today = todayIso();
    const tomorrow = offsetIso(1);
    const todayList = activeCustomers.filter(c => c.date === today);
    const tomorrowList = activeCustomers.filter(c => c.date === tomorrow);
    const closingList = activeCustomers.filter(c => c.status === "Szerelés kész – admin folyamatban");
    const callbackList = activeCustomers.filter(c => !c.date && c.status === "Visszahívandó");
    const stockList = PRODUCTS.filter((p:any) => reservedForProduct(p.id) > stockOf(p.id));

    const activeList =
      taskFilter === "today" ? todayList :
      taskFilter === "tomorrow" ? tomorrowList :
      taskFilter === "closing" ? closingList :
      taskFilter === "callback" ? callbackList :
      [];

    return (
      <Shell>
        <Back onClick={()=>setView("dashboard")}/>
        <Hero title={taskTitleMap[taskFilter]} sub="Összegyűjtött teendők és figyelmeztetések" action="Vissza a főoldalra" onAction={()=>setView("dashboard")}/>
        <Layout>
          <Main>
            {taskFilter === "stock" ? (
              <Card title="Készlethiányok">
                <div className="space-y-3">
                  {stockList.length === 0 ? <div className="rounded-2xl bg-emerald-400/20 p-4 font-black text-emerald-200">Nincs készlethiány ✅</div> : null}
                  {stockList.map((p:any) => (
                    <button key={p.id} onClick={()=>setView("warehouse")} className="w-full rounded-3xl border border-red-400/30 bg-red-500/15 p-4 text-left">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-lg font-black text-red-100">{p.name}</p>
                          <p className="text-sm text-red-200">Raktáron: {stockOf(p.id)} db · Lefoglalva: {reservedForProduct(p.id)} db</p>
                        </div>
                        <span className="rounded-2xl bg-red-500/30 px-4 py-3 font-black text-red-100">{reservedForProduct(p.id) - stockOf(p.id)} db hiány</span>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>
            ) : (
              <Card title={taskTitleMap[taskFilter]}>
                <div className="space-y-3">
                  {activeList.length === 0 ? <div className="rounded-2xl bg-white/10 p-4 font-black text-slate-300">Nincs ilyen teendő.</div> : null}
                  {activeList.map((c:any) => (
                    <button key={c.id} onClick={()=>openCustomer(c, c.date ? "work" : "lead")} className="w-full rounded-3xl border border-white/10 bg-slate-900/80 p-4 text-left transition hover:border-cyan-300/40">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-lg font-black">{c.name}</p>
                          <p className="text-sm text-slate-400">{c.city} · {c.email || "nincs email"}</p>
                          <p className="mt-1 text-xs text-slate-500">{c.date ? `${c.date} · ${c.time}` : "nincs időpont"}</p><p className="mt-1 text-xs text-cyan-200/80">{climateSummary(c.quoteItems)}</p>
                        </div>
                        <span className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold">{c.status}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </Main>
          <Side>
            <Card title="Gyors szűrők">
              <div className="space-y-3">
                <Btn onClick={()=>openTask("today")}>Mai munkák</Btn>
                <Btn onClick={()=>openTask("tomorrow")}>Holnapi munkák</Btn>
                <Btn onClick={()=>openTask("closing")}>Lezárásra vár</Btn>
                <Btn onClick={()=>openTask("stock")}>Készlethiány</Btn>
                <Btn onClick={()=>openTask("callback")}>Visszahívandó</Btn>
              </div>
            </Card>
          </Side>
        </Layout>
      </Shell>
    );
  }

  if (view === "archive") {
    return (
      <Shell>
        <Back onClick={() => setView("dashboard")} />
        <Hero
          title="Lezárt / lemondott ügyfelek"
          sub="Külön lista azoknak, akik már lezárva vagy lemondva státuszban vannak."
          action="Vissza a főoldalra"
          onAction={() => setView("dashboard")}
        />
        <Layout>
          <Main>
            {renderCustomerSearchPanel("Archív kereső")}
            <Card title="Archív ügyfelek">
              <div className="mb-4 flex flex-col gap-2 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                <span>{filteredArchivedCustomers.length} lezárt / lemondott ügyfél</span>
                {!hasCustomerFilter && filteredArchivedCustomers.length > archiveVisibleCount ? <span>Első {archiveVisibleCount} megjelenítve</span> : null}
              </div>
              <div className="space-y-3">
                {filteredArchivedCustomers.length === 0 ? (
                  <div className="rounded-2xl bg-white/10 p-4 font-black text-slate-300">Még nincs ilyen lezárt vagy lemondott ügyfél.</div>
                ) : null}
                {visibleArchivedCustomers.map((customer) => (
                  <div key={customer.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="text-lg font-black">{customer.name || "Névtelen ügyfél"}</p>
                        <p className="text-sm text-slate-400">{customer.city || "nincs település"} · {customer.phone || "nincs telefonszám"}</p>
                        <p className="mt-1 text-xs text-cyan-200/80">{climateSummary(customer.quoteItems)}</p>
                        <p className="mt-1 text-xs text-slate-500">{customer.date ? `${customer.date} · ${customer.time || "nincs idő"}` : "nincs időpont"}</p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <span className={`rounded-2xl px-4 py-3 text-sm font-black ${customer.status === "Lezárva" ? "bg-emerald-400/20 text-emerald-200" : "bg-red-500/20 text-red-200"}`}>
                          {customer.status}
                        </span>
                        <button
                          onClick={() => openCustomer(customer, customer.date ? "work" : "lead")}
                          className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 font-black text-cyan-100"
                        >
                          Megnyitás
                        </button>
                        <button
                          onClick={() => restoreArchivedCustomer(customer)}
                          className="rounded-2xl bg-cyan-300 px-4 py-3 font-black text-slate-950"
                        >
                          Visszaállítás
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {hasMoreArchivedCustomers ? (
                  <button
                    onClick={() => setArchiveVisibleCount((count) => count + 30)}
                    className="w-full rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-5 py-4 font-black text-cyan-100"
                  >
                    További 30 ügyfél betöltése
                  </button>
                ) : null}
              </div>
            </Card>
          </Main>
          <Side>
            <Gradient title="Archív" value={`${filteredArchivedCustomers.length} ügyfél`} />
            <Card title="Visszaállítás">
              <p className="text-sm leading-relaxed text-slate-400">A visszaállítás gombbal az ügyfél újra aktív lesz. Időpontos ügyfélnél „Időpont foglalva”, időpont nélkülinél „Visszahívandó” státuszra kerül.</p>
            </Card>
          </Side>
        </Layout>
      </Shell>
    );
  }

  if (view === "warehouse") {
    return (
      <Shell>
        <Back onClick={() => setView("dashboard")} />
        <Hero
          title="Raktárkészlet"
          sub="Készletkezelés és bevételezés."
          action="Készlet kezelése"
        />

        <Layout>
          <Main>
            <Card title="Klíma készlet">
              <div className="space-y-3">
                {PRODUCTS.map((product) => {
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
                          <div className="rounded-2xl bg-white/10 p-3">
                            <p className="text-slate-400">Raktáron</p>
                            <b>{stock} db</b>
                          </div>
                          <div className="rounded-2xl bg-amber-400/20 p-3">
                            <p className="text-amber-200">Lefoglalva</p>
                            <b>{reserved} db</b>
                          </div>
                          <div className={`rounded-2xl p-3 ${free > 0 ? "bg-emerald-400/20" : "bg-red-500/20"}`}>
                            <p className={free > 0 ? "text-emerald-200" : "text-red-200"}>Szabad</p>
                            <b>{free} db</b>
                          </div>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {materialInventory.map((item: any) => {
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
                        <span className={
                          status === "hiány"
                            ? "rounded-full bg-red-500/20 px-3 py-1 text-xs font-black text-red-200"
                            : status === "alacsony"
                            ? "rounded-full bg-amber-400/20 px-3 py-1 text-xs font-black text-amber-200"
                            : "rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-black text-emerald-200"
                        }>
                          {status}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                        <div className="rounded-2xl bg-white/10 p-3">
                          <p className="text-slate-400">Raktáron</p>
                          <b>{item.stock} {item.unit}</b>
                        </div>
                        <div className="rounded-2xl bg-amber-400/20 p-3">
                          <p className="text-amber-200">Lefoglalva</p>
                          <b>{reserved} {item.unit}</b>
                        </div>
                        <div className={`rounded-2xl p-3 ${free > 0 ? "bg-emerald-400/20" : "bg-red-500/20"}`}>
                          <p className={free > 0 ? "text-emerald-200" : "text-red-200"}>Szabad</p>
                          <b>{free} {item.unit}</b>
                        </div>
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


  function quotePayload(customer: Customer = selected, items: QuoteItem[] = quoteItems) {
    const quoteTotal = total(items);
    const quoteCount = qty(items);
    const installerAmount = Math.min(60000 * quoteCount, quoteTotal);
    const materialAmount = Math.max(0, quoteTotal - installerAmount);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        city: customer.city,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        need: customer.need,
        date: customer.date,
        time: customer.time,
      },
      items: items.map((item) => ({
        name: itemName(item),
        quantity: item.quantity,
        unitPrice: itemUnitPrice(item),
        totalPrice: itemTotal(item),
      })),
      totalAmount: quoteTotal,
      installerAmount,
      materialAmount,
    };
  }

  async function sendQuoteEmail() {
    if (!selected.email?.trim()) {
      setMessage("Az ajánlat elküldéséhez előbb add meg az ügyfél email címét.");
      return;
    }

    setQuoteEmailBusy(true);
    setMessage("Ajánlat email küldése folyamatban... Telefonról is ugyanígy működik.");

    try {
      const response = await fetch("/api/send-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quotePayload()),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result?.error || "Nem sikerült elküldeni az ajánlat emailt.");
      }

      const updated: Customer = {
        ...selected,
        status: "Ajánlat elküldve",
        quoteItems,
      };

      await persistCustomerToDb(updated);
      await logDocument(updated, "quote_email", "Ajánlat email", "Elküldve");
      setSelected(updated);
      setCustomers((prev) => prev.map((customer) => customer.id === updated.id ? updated : customer));
      setMessage("Ajánlat elküldve emailben ✅");
    } catch (error: any) {
      setMessage(`Email küldési hiba: ${error.message}`);
    } finally {
      setQuoteEmailBusy(false);
    }
  }

  async function sendAppointmentEmailFor(customer: Customer) {
    if (!customer.email?.trim()) {
      setMessage("Az időpont emailhez előbb add meg az ügyfél email címét.");
      return false;
    }

    setAppointmentEmailBusy(true);

    try {
      const response = await fetch("/api/send-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quotePayload(customer, customer.quoteItems || quoteItems)),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result?.error || "Nem sikerült elküldeni az időpont emailt.");
      }

      await logDocument(customer, "appointment_email", "Időpont-visszaigazolás", "Elküldve");
      setMessage("Időpont tájékoztató email elküldve ✅");
      return true;
    } catch (error: any) {
      setMessage(`Időpont email küldési hiba: ${error.message}`);
      return false;
    } finally {
      setAppointmentEmailBusy(false);
    }
  }


  function workReportPayload(report: WorkReport = workReport, customer: Customer = selected) {
    const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        city: customer.city,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        need: customer.need,
        date: customer.date,
        time: customer.time,
      },
      items: items.map((item) => ({
        name: itemName(item),
        quantity: item.quantity,
        unitPrice: itemUnitPrice(item),
        totalPrice: itemTotal(item),
      })),
      report: {
        workDescription: report.workDescription,
        notes: report.notes,
        signatureDataUrl: report.signatureDataUrl,
        signerName: report.signerName || customer.name,
        signedAt: report.signedAt,
      },
    };
  }

  function workReportFromRow(row: any): WorkReport {
    return {
      id: row.id,
      customerId: row.customer_id,
      workDescription: row.work_description || defaultWorkDescription(),
      notes: row.notes || "",
      signatureDataUrl: row.signature_data_url || "",
      signerName: row.signer_name || row.customer_name || "",
      signedAt: row.signed_at || undefined,
      emailSentAt: row.email_sent_at || undefined,
    };
  }

  function documentFromRow(row: any): DocumentRecord {
    return {
      id: row.id,
      customerId: row.customer_id,
      type: row.document_type || row.type || "document",
      title: row.title || "Dokumentum",
      status: row.status || "Mentve",
      sentAt: row.sent_at || undefined,
      createdAt: row.created_at || undefined,
      updatedAt: row.updated_at || undefined,
    };
  }

  function workChecklistFromRow(row: any): WorkChecklistState {
    return {
      worksheet: Boolean(row.worksheet),
      signature: Boolean(row.signature),
      purchaseDeclaration: Boolean(row.purchase_declaration),
      alinInvoice: Boolean(row.alin_invoice),
      amovaInvoice: Boolean(row.amova_invoice),
      nkvh: Boolean(row.nkvh),
      docsSent: Boolean(row.docs_sent),
    };
  }

  function statusMeansDone(status?: string) {
    const text = (status || "").toLowerCase();
    return text.includes("elküld") || text.includes("kész") || text.includes("aláír") || text.includes("elkészült") || text.includes("mentve");
  }

  function statusMeansSent(status?: string) {
    return (status || "").toLowerCase().includes("elküld");
  }

  function effectiveChecklistFor(
    customer: Customer = selected,
    reportsMap: Record<string, WorkReport> = workReportsByCustomer,
    docsMap: Record<string, DocumentRecord[]> = documentsByCustomer,
    checklistsMap: Record<string, WorkChecklistState> = workChecklistsByCustomer
  ): WorkChecklistState {
    if (!customer.id) return { ...workChecklist };

    const saved = checklistsMap[customer.id] || EMPTY_WORK_CHECKLIST;
    const report = reportsMap[customer.id];
    const docs = docsMap[customer.id] || [];
    const workDoc = docs.find((doc) => doc.type === "work_report");
    const purchaseDoc = docs.find((doc) => doc.type === "purchase_declaration");

    const hasSignature = Boolean(report?.signatureDataUrl || saved.signature);
    const workReportReady = Boolean(report?.id || report?.signatureDataUrl || statusMeansDone(workDoc?.status));
    const purchaseReady = Boolean(purchaseDoc || hasSignature || report?.emailSentAt || saved.purchaseDeclaration);
    const documentsSent = Boolean(
      saved.docsSent ||
      report?.emailSentAt ||
      statusMeansSent(workDoc?.status) ||
      statusMeansSent(purchaseDoc?.status)
    );

    return {
      ...EMPTY_WORK_CHECKLIST,
      ...saved,
      worksheet: Boolean(saved.worksheet || workReportReady),
      signature: Boolean(saved.signature || hasSignature),
      purchaseDeclaration: Boolean(saved.purchaseDeclaration || purchaseReady),
      docsSent: documentsSent,
    };
  }

  function savedReportFor(customer: Customer = selected) {
    if (!customer.id) return undefined;
    if (workReport.customerId === customer.id || workReport.id) return workReport.customerId === customer.id ? workReport : workReportsByCustomer[customer.id];
    return workReportsByCustomer[customer.id];
  }

  function docsFor(customer: Customer) {
    return customer.id ? (documentsByCustomer[customer.id] || []) : [];
  }

  function docFor(customer: Customer, type: string) {
    return docsFor(customer).find((doc) => doc.type === type);
  }

  function docStatus(customer: Customer, type: string, fallback = "Nincs kész") {
    const doc = docFor(customer, type);
    return doc?.status || fallback;
  }

  async function logDocument(customer: Customer, type: string, title: string, status = "Elküldve") {
    if (!customer.id || !user) return;

    const payload = {
      customer_id: customer.id,
      document_type: type,
      title,
      status,
      sent_at: status.toLowerCase().includes("elküld") ? new Date().toISOString() : null,
      created_by: user.id,
    };

    const { data, error } = await supabase
      .from("documents")
      .upsert(payload, { onConflict: "customer_id,document_type" })
      .select("*")
      .single();

    if (error) return;

    const saved = documentFromRow(data);
    setDocumentsByCustomer((prev) => {
      const current = prev[customer.id] || [];
      const withoutCurrent = current.filter((doc) => doc.type !== saved.type);
      return { ...prev, [customer.id]: [saved, ...withoutCurrent] };
    });
  }

  function workReportDocumentStatus(customer: Customer) {
    const report = savedReportFor(customer);
    if (report?.emailSentAt) return "Elküldve";
    if (report?.signatureDataUrl) return "Aláírva, mentve";
    if (report?.id) return "Mentve";
    return "Nincs kész";
  }

  function purchaseDeclarationStatus(customer: Customer) {
    const report = savedReportFor(customer);
    if (docFor(customer, "purchase_declaration")?.status) return docFor(customer, "purchase_declaration")!.status;
    if (report?.emailSentAt) return "Elküldve";
    if (report?.signatureDataUrl) return "Elkészült";
    return "Aláírásra vár";
  }

  function workAndDeclarationStatus(customer: Customer) {
    const report = savedReportFor(customer);
    const workStatus = workReportDocumentStatus(customer);
    const declarationStatus = purchaseDeclarationStatus(customer);

    if (report?.emailSentAt || workStatus.includes("Elküld") || declarationStatus.includes("Elküld")) return "Elküldve";
    if (report?.signatureDataUrl || declarationStatus.includes("Elkészült") || declarationStatus.includes("Aláír")) return "Elkészült";
    if (report?.id || workStatus.includes("Mentve")) return "Mentve";
    return "Nincs kész";
  }

  function documentRowsFor(customer: Customer) {
    return [
      { title: "Ajánlat email", status: docStatus(customer, "quote_email", customer.status === "Ajánlat elküldve" ? "Elküldve" : "Nincs elküldve"), action: "Ajánlat" },
      { title: "Időpont-visszaigazolás", status: docStatus(customer, "appointment_email", customer.date ? "Időpont rögzítve" : "Nincs időpont"), action: "Időpont" },
      { title: "Munkalap és vásárlási nyilatkozat", status: workAndDeclarationStatus(customer), action: "MunkalapNyilatkozat" },
      { title: "Adorján Alin E.V. számla", status: effectiveChecklistFor(customer).alinInvoice ? "Kész" : "Számlázz.hu később", action: "Számla" },
      { title: "AMOVA 4U Kft. számla", status: effectiveChecklistFor(customer).amovaInvoice ? "Kész" : "Számlázz.hu később", action: "Számla" },
    ];
  }



  async function loadWorkReportFor(customer: Customer) {
    setWorkReport(emptyWorkReport(customer));
    if (!customer.id) return;

    const { data, error } = await supabase
      .from("work_reports")
      .select("*")
      .eq("customer_id", customer.id)
      .maybeSingle();

    if (error) {
      setMessage("A munkalap tábla még nincs kész vagy nem tölthető be. Futtasd a munkalap SQL-t a Supabase-ben.");
      return;
    }

    if (data) {
      const loadedReport = workReportFromRow(data);
      setWorkReport({ ...loadedReport, signerName: loadedReport.signerName || customer.name || "" });
      setWorkReportsByCustomer((prev) => ({ ...prev, [customer.id]: loadedReport }));
    }
  }

  function openWorkReportFor(customer: Customer = selected) {
    const customerForReport = { ...customer, quoteItems: customer.quoteItems?.length ? customer.quoteItems : quoteItems };
    setSelected(customerForReport);
    setQuoteItems(customerForReport.quoteItems);
    void loadWorkReportFor(customerForReport);
    setView("workReport");
  }

  function openWorkReport() {
    openWorkReportFor(selected);
  }

  function openDocumentPreview(customer: Customer, type: DocumentPreviewType) {
    const customerForPreview = { ...customer, quoteItems: customer.quoteItems?.length ? customer.quoteItems : quoteItems };
    setSelected(customerForPreview);
    setQuoteItems(customerForPreview.quoteItems);
    setDocumentPreviewType(type);
    setDocumentBackView(view === "documents" ? "documents" : "work");
    if (type === "work_report" || type === "purchase_declaration") {
      void loadWorkReportFor(customerForPreview);
    }
    setView("documentPreview");
  }

  function updateWorkReportField(field: keyof WorkReport, value: string) {
    setWorkReport((prev) => ({ ...prev, [field]: value }));
  }

  async function saveWorkReport(sendEmail = false) {
    if (!selected.id) {
      setMessage("Előbb mentsd az ügyfelet, utána készíthető munkalap.");
      return;
    }

    if (sendEmail && !selected.email?.trim()) {
      setMessage("Munkalap emailhez előbb add meg az ügyfél email címét.");
      return;
    }

    if (sendEmail && !workReport.signatureDataUrl) {
      setMessage("Küldés előtt szükséges az egyszerű ügyfél aláírás.");
      return;
    }

    const signedAt = workReport.signatureDataUrl ? (workReport.signedAt || new Date().toISOString()) : null;
    const reportToSave: WorkReport = {
      ...workReport,
      signerName: workReport.signerName || selected.name,
      signedAt: signedAt || undefined,
    };

    setWorkReportBusy(true);
    setMessage(sendEmail ? "Munkalap mentése és email küldése folyamatban..." : "Munkalap mentése folyamatban...");

    try {
      const basePayload = {
        customer_id: selected.id,
        work_date: selected.date || scheduleDate || null,
        work_time: selected.time || shownTime || null,
        customer_name: selected.name || null,
        customer_email: selected.email || null,
        customer_phone: selected.phone || null,
        customer_address: fullCustomerAddress(selected) || null,
        climate_summary: climateSummary(quoteItems),
        work_description: reportToSave.workDescription || defaultWorkDescription(),
        notes: reportToSave.notes || null,
        signature_data_url: reportToSave.signatureDataUrl || null,
        signer_name: reportToSave.signerName || selected.name || null,
        signed_at: signedAt,
        created_by: user?.id || null,
      };

      const { data, error } = await supabase
        .from("work_reports")
        .upsert(basePayload, { onConflict: "customer_id" })
        .select("*")
        .single();

      if (error) throw error;

      let emailSentAt = data?.email_sent_at || undefined;
      if (sendEmail) {
        setWorkReportEmailBusy(true);
        const response = await fetch("/api/send-work-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(workReportPayload(reportToSave, { ...selected, quoteItems })),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error || "Nem sikerült elküldeni a munkalap emailt.");

        emailSentAt = new Date().toISOString();
        await supabase.from("work_reports").update({ email_sent_at: emailSentAt }).eq("id", data.id);
      }

      await logDocument(selected, "work_report", "Klímaszerelési munkalap", sendEmail ? "Elküldve" : "Mentve");
      if (reportToSave.signatureDataUrl || sendEmail) {
        await logDocument(selected, "purchase_declaration", "Vásárlási nyilatkozat", sendEmail ? "Elküldve" : "Elkészült");
      }

      await updateChecklistForCustomer(selected, {
        worksheet: true,
        purchaseDeclaration: Boolean(reportToSave.signatureDataUrl) || sendEmail,
        signature: Boolean(reportToSave.signatureDataUrl),
        docsSent: sendEmail,
      });

      const savedReportForState: WorkReport = {
        id: data.id,
        customerId: data.customer_id,
        workDescription: data.work_description || reportToSave.workDescription,
        notes: data.notes || "",
        signatureDataUrl: data.signature_data_url || reportToSave.signatureDataUrl,
        signerName: data.signer_name || reportToSave.signerName,
        signedAt: data.signed_at || reportToSave.signedAt,
        emailSentAt,
      };
      setWorkReportsByCustomer((prev) => ({ ...prev, [selected.id]: savedReportForState }));
      setWorkReport(savedReportForState);
      setMessage(sendEmail ? "Munkalap mentve és emailben elküldve ✅" : "Munkalap mentve ✅");
      setView("work");
    } catch (error: any) {
      setMessage(`Munkalap hiba: ${error.message}`);
    } finally {
      setWorkReportBusy(false);
      setWorkReportEmailBusy(false);
    }
  }


  function formatDocumentDate(value?: string) {
    if (!value) return "nincs megadva";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  }

  function documentReportFor(customer: Customer = selected) {
    return savedReportFor(customer) || emptyWorkReport(customer);
  }

  function dottedLine(value?: string) {
    return <span className="inline-block min-w-[180px] border-b border-dotted border-slate-900 px-1 pb-0.5 font-bold">{value || "\u00A0"}</span>;
  }

  function documentIsReady(customer: Customer, row: { action: string; title: string; status: string }) {
    const report = savedReportFor(customer);
    if (row.action === "Munkalap") return Boolean(report?.id || report?.signatureDataUrl || report?.emailSentAt);
    if (row.action === "Nyilatkozat") return Boolean(report?.signatureDataUrl || report?.emailSentAt || docFor(customer, "purchase_declaration"));
    if (row.action === "MunkalapNyilatkozat") return Boolean(report?.id || report?.signatureDataUrl || report?.emailSentAt || docFor(customer, "work_report") || docFor(customer, "purchase_declaration"));
    if (row.action === "Ajánlat") return row.status.includes("Elküld") || customer.status === "Ajánlat elküldve";
    if (row.action === "Időpont") return Boolean(customer.date || row.status.includes("Elküld"));
    if (row.action === "Számla") return row.status.includes("Kész") || row.status.includes("Kiállít");
    return false;
  }

  function DocumentLibraryActions({ customer, row }: { customer: Customer; row: { action: string; title: string; status: string } }) {
    const ready = documentIsReady(customer, row);
    if (!ready) return null;

    if (row.action === "MunkalapNyilatkozat") {
      return (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button onClick={()=>openDocumentPreview(customer,"work_report")} className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white">Munkalap</button>
          <button onClick={()=>openDocumentPreview(customer,"purchase_declaration")} className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white">Nyilatkozat</button>
        </div>
      );
    }
    if (row.action === "Munkalap") {
      return <button onClick={()=>openDocumentPreview(customer,"work_report")} className="mt-3 w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white">Megtekintés / nyomtatás</button>;
    }
    if (row.action === "Nyilatkozat") {
      return <button onClick={()=>openDocumentPreview(customer,"purchase_declaration")} className="mt-3 w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white">Megtekintés / nyomtatás</button>;
    }
    if (row.action === "Ajánlat") {
      return <button onClick={()=>openDocumentPreview(customer,"quote_document")} className="mt-3 w-full rounded-2xl bg-blue-400/20 px-4 py-3 text-sm font-black text-blue-100">Ajánlat megtekintése</button>;
    }
    if (row.action === "Időpont") {
      return <button onClick={()=>openDocumentPreview(customer,"appointment_confirmation")} className="mt-3 w-full rounded-2xl bg-cyan-300/15 px-4 py-3 text-sm font-black text-cyan-100">Időpont megtekintése</button>;
    }

    return null;
  }

  function DocumentActions({ customer, row }: { customer: Customer; row: { action: string; title: string; status: string } }) {
    const baseButton = "rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-wait disabled:opacity-60";
    const viewButton = `${baseButton} bg-white/10 text-white hover:bg-white/15`;
    const sendButton = `${baseButton} bg-blue-400/20 text-blue-100 hover:bg-blue-400/30`;
    const editButton = `${baseButton} bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30`;
    const helperButton = `${baseButton} bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25`;
    const gridClass = "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2";

    if (row.action === "MunkalapNyilatkozat") {
      return (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button onClick={()=>openDocumentPreview(customer,"work_report")} className={viewButton}>Munkalap</button>
          <button onClick={()=>openDocumentPreview(customer,"purchase_declaration")} className={viewButton}>Nyilatkozat</button>
          <button onClick={()=>openWorkReportFor(customer)} className={`${editButton} sm:col-span-2`}>Szerkesztés / aláírás</button>
        </div>
      );
    }
    if (row.action === "Munkalap") {
      return <div className={gridClass}><button onClick={()=>openDocumentPreview(customer,"work_report")} className={viewButton}>Megtekintés</button><button onClick={()=>openWorkReportFor(customer)} className={editButton}>Szerkesztés / aláírás</button></div>;
    }
    if (row.action === "Nyilatkozat") {
      return <div className={gridClass}><button onClick={()=>openDocumentPreview(customer,"purchase_declaration")} className={viewButton}>Megtekintés</button><button onClick={()=>openWorkReportFor(customer)} className={helperButton}>Aláíráshoz</button></div>;
    }
    if (row.action === "Ajánlat") {
      return <div className={gridClass}><button onClick={()=>openDocumentPreview(customer,"quote_document")} className={viewButton}>Megtekintés</button><button onClick={sendQuoteEmail} disabled={quoteEmailBusy} className={sendButton}>{quoteEmailBusy ? "Küldés..." : "Küldés"}</button></div>;
    }
    if (row.action === "Időpont") {
      return <div className={gridClass}><button onClick={()=>openDocumentPreview(customer,"appointment_confirmation")} className={viewButton}>Megtekintés</button><button onClick={()=>sendAppointmentEmailFor(customer)} disabled={appointmentEmailBusy} className={helperButton}>{appointmentEmailBusy ? "Küldés..." : "Email"}</button></div>;
    }
    return null;
  }

  function renderCustomerSearchPanel(title = "Ügyfélkereső") {
    const results = filteredCustomers.slice(0, 8);
    return (
      <Card title={title}>
        <div className="space-y-3">
          <input
            className="input"
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
            placeholder="Keresés név, telefon, település, cím, klíma alapján..."
          />
          <select
            className="input"
            value={customerStatusFilter}
            onChange={(event) => setCustomerStatusFilter(event.target.value)}
          >
            <option value="all">Összes státusz</option>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          {hasCustomerFilter ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-400">
                <span>{filteredCustomers.length} találat</span>
                <button onClick={clearCustomerFilter} className="rounded-xl bg-white/10 px-3 py-2 text-cyan-100">Szűrő törlése</button>
              </div>
              {results.length === 0 ? <div className="rounded-2xl bg-white/10 p-4 text-sm font-black text-slate-300">Nincs találat.</div> : null}
              {results.map((customer) => (
                <button
                  key={customer.id}
                  onClick={() => openCustomerFromSearch(customer)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-left transition hover:border-cyan-300/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-white">{customer.name || "Névtelen ügyfél"}</p>
                      <p className="mt-1 text-xs text-slate-400">{customer.city || "nincs település"} · {customer.phone || customer.email || "nincs elérhetőség"}</p>
                      <p className="mt-1 text-xs text-cyan-200/80">{climateSummary(customer.quoteItems)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-[11px] font-black text-slate-200">{customer.status || "nincs státusz"}</span>
                  </div>
                </button>
              ))}
              {filteredCustomers.length > results.length ? <p className="text-xs text-slate-500">Csak az első {results.length} találat látszik. Pontosíts a keresésen.</p> : null}
            </div>
          ) : null}
        </div>
      </Card>
    );
  }


  function renderLeadImportPanel() {
    const importable = leadImportRows.filter((row) => !row.duplicate && !row.invalid);
    const skipped = leadImportRows.filter((row) => row.duplicate || row.invalid);
    const merged = leadImportRows.filter((row) => !row.duplicate && !row.invalid && (row.mergedRows || 1) > 1).length;
    const previewRows = leadImportRows.slice(0, 6);

    return (
      <Card title="Meta lead import">
        <input
          ref={leadImportInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            handleLeadCsvFile(file);
            event.currentTarget.value = "";
          }}
        />
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => leadImportInputRef.current?.click()}
            className="w-full rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950"
          >
            CSV feltöltése
          </button>
          {leadImportMessage ? <div className="rounded-2xl bg-slate-950/60 p-3 text-sm font-bold text-slate-200">{leadImportMessage}</div> : null}

          {leadImportRows.length ? (
            <div className="space-y-2">
              {previewRows.map((row) => (
                <div key={row.id} className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-white">{row.name || "Névtelen sor"}</p>
                      <p className="mt-1 text-xs text-slate-400">{row.phone || "nincs telefonszám"} · {row.email || "nincs email"}</p>
                      {!row.duplicate && !row.invalid && (row.mergedRows || 1) > 1 ? <p className="mt-1 text-xs font-bold text-cyan-200">{row.mergedRows} azonos lead összevonva egy ügyféllé</p> : null}
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${row.invalid ? "bg-red-400/20 text-red-200" : row.duplicate ? "bg-amber-400/20 text-amber-200" : "bg-emerald-400/20 text-emerald-200"}`}>
                      {row.invalid ? "hibás" : row.duplicate ? "kihagyva" : "új"}
                    </span>
                  </div>
                  {row.duplicateReason || row.invalidReason ? <p className="mt-2 text-xs font-bold text-slate-500">{row.duplicateReason || row.invalidReason}</p> : null}
                </div>
              ))}
              {leadImportRows.length > previewRows.length ? <p className="text-xs text-slate-500">+ {leadImportRows.length - previewRows.length} további sor az előnézetben.</p> : null}
              <button
                type="button"
                disabled={leadImportBusy || !importable.length}
                onClick={importLeadRows}
                className="w-full rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {leadImportBusy ? "Importálás..." : `${importable.length} új érdeklődő importálása`}
              </button>
              {merged ? <p className="text-xs text-cyan-200/80">A CSV-n belüli duplikációkból egy ügyfél készül, a hiányzó adatokat összevonja.</p> : null}
              {skipped.length ? <p className="text-xs text-slate-500">A már meglévő ügyfeleket és hibás sorokat a rendszer kihagyja.</p> : null}
            </div>
          ) : null}
        </div>
      </Card>
    );
  }


  function WorkReportDocument({ customer, report }: { customer: Customer; report: WorkReport }) {
    const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
    const shownItems = items.length ? items : [{ productId: PRODUCTS[0]?.id || "", quantity: 1 }];
    return (
      <article className="doc-print-page work-report-doc mx-auto max-w-[210mm] rounded-3xl bg-white p-8 font-serif text-[13px] leading-snug text-slate-950 shadow-2xl print:m-0 print:h-[297mm] print:min-h-[297mm] print:w-[210mm] print:max-w-[210mm] print:overflow-hidden print:rounded-none print:border-0 print:p-[14mm] print:text-[11.5px] print:shadow-none">
        <div className="text-center">
          <h2 className="text-xl font-black leading-none tracking-tight print:text-[17px]">KLÍMASZERELÉSI<br />MUNKALAP</h2>
          <p className="mt-1 text-xs font-bold print:text-[9.5px]">az elvégzett klímaszerelési munka és átadás-átvétel visszaigazolására</p>
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
            <h3 className="mb-1 font-black">Szerelés adatai:</h3>
            <div className="ml-3 space-y-0.5">
              <p>szerelés dátuma: {dottedLine(formatDocumentDate(customer.date))}</p>
              <p>idősáv: {dottedLine(customer.time || "egyeztetés szerint")}</p>
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
                  <td className="border border-slate-900 p-1.5 text-center font-bold print:p-1">{item.quantity}</td>
                  <td className="border border-slate-900 p-1.5 print:p-1">szereléssel együtt</td>
                </tr>)}
              </tbody>
            </table>
          </section>

          <section>
            <h3 className="mb-1 font-black">Elvégzett munka:</h3>
            <p className="whitespace-pre-wrap border border-slate-900 p-2.5 text-justify print:p-2">{report.workDescription || defaultWorkDescription()}</p>
          </section>

          <section>
            <h3 className="mb-1 font-black">Átadás-átvételi nyilatkozat:</h3>
            <p className="border border-slate-900 p-2.5 text-justify print:p-2">{workAcceptanceText()}</p>
          </section>

          {report.notes ? <section><h3 className="mb-1 font-black">Megjegyzés:</h3><p className="whitespace-pre-wrap border border-slate-900 p-2 print:p-1.5">{report.notes}</p></section> : null}

          <section className="mt-4 flex items-end justify-between gap-4 print:mt-3">
            <div className="min-w-0">
              <p>Kelt: {dottedLine(formatDocumentDate(customer.date) || new Date().toLocaleDateString("hu-HU"))}</p>
            </div>
            <div className="w-[56mm] text-center">
              {report.signatureDataUrl ? <img src={report.signatureDataUrl} alt="Ügyfél aláírása" className="mx-auto mb-1 max-h-[22mm] max-w-full object-contain print:max-h-[18mm]"/> : <div className="mb-1 h-[18mm] border border-dashed border-slate-400"/>}
              <div className="border-t border-slate-900 pt-1 italic">Ügyfél aláírása</div>
              {report.signedAt ? <p className="mt-0.5 text-[10px] print:text-[8.5px]">Aláírva: {formatSignedAt(report.signedAt)}</p> : null}
            </div>
          </section>

          <div className="border-t border-slate-900 pt-1 text-[10px] leading-tight print:text-[8.5px]">
            Üdvözlettel,<br /><strong>Adorján Alin · KLIMAlin</strong><br />klimalin.hu · legkondikalkulator.hu · 06 30 700 4908
          </div>
        </div>
      </article>
    );
  }

  function PurchaseDeclarationDocument({ customer, report }: { customer: Customer; report: WorkReport }) {
    const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
    const shownItems = items.length ? items : [{ productId: PRODUCTS[0]?.id || "", quantity: 1 }];
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
              <p>neve: {dottedLine("AMOVA 4U Kft.")}</p>
              <p>adószáma: {dottedLine("29253630-2-13")}</p>
              <p>a képviseletében eljáró természetes személy neve: {dottedLine("Adorján Mirjam")}</p>
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
                <td className="border border-slate-900 p-1.5 text-center font-bold print:p-1">{item.quantity}</td>
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

  function QuoteDocument({ customer }: { customer: Customer }) {
    const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
    const sum = total(items);
    const installerAmount = Math.min(60000 * Math.max(1, qty(items)), sum);
    const materialAmount = Math.max(0, sum - installerAmount);
    return <article className="mx-auto max-w-[760px] rounded-3xl bg-white p-6 text-slate-950 shadow-2xl print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <img src="/alin-klima-logo.png" alt="KLIMAlin logo" className="h-16 w-auto object-contain" />
          <div>
            <h2 className="text-3xl font-black">KLIMAlin árajánlat</h2>
            <p className="mt-2 text-sm text-slate-600">Klímaberendezés alapszereléssel együtt</p>
          </div>
        </div>
        <div className="text-sm text-slate-600 md:text-right">
          <p>Ajánlat érvényessége: 7 nap</p>
          <p>Kapcsolat: 06 30 700 4908</p>
          <p>klimalin.hu</p>
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
        <p className="mt-1 text-3xl font-black">{ft(sum)}</p>
        <p className="mt-1 text-sm text-slate-600">Bruttó végösszeg alapszereléssel</p>
      </div>

      <div className="mt-6 space-y-3">
        {items.map((item, index)=><div key={`${item.productId}-${index}`} className="rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-lg font-black">{item.quantity} db · {itemName(item)}</p>
              <p className="mt-1 text-sm text-slate-600">{ft(prod(item.productId).price)} / db · telepítéssel együtt</p>
            </div>
            <p className="text-xl font-black">{ft(itemTotal(item))}</p>
          </div>
        </div>)}
      </div>

      <div className="mt-6 flex flex-col gap-2 rounded-2xl bg-slate-950 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xl font-black">Fizetendő bruttó végösszeg</p>
        <p className="text-2xl font-black">{ft(sum)}</p>
      </div>

      <div className="mt-6 rounded-2xl bg-slate-100 p-5 text-sm leading-relaxed">
        <h3 className="text-lg font-black">Alapszerelés tartalma</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>max. 3 m szigetelt rézcső-pár / klíma</li>
          <li>1 db faláttörés, tömítés és esztétikus lezárás</li>
          <li>kondenzvíz elvezetés kialakítása gravitációsan, megfelelő lejtéssel, adottság szerint</li>
          <li>kültéri fali konzol vastag rezgéscsillapítókkal</li>
          <li>nyomáspróba, vákuumozás, beüzemelés és működési teszt</li>
          <li>felhasználói betanítás és rendrakás</li>
        </ul>
      </div>

      <div className="mt-4 rounded-2xl bg-slate-100 p-5 text-sm leading-relaxed">
        <h3 className="text-lg font-black">Minőségi kivitelezés</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>Alukasírozott, hőszigetelt rézcső-pár.</li>
          <li>Időjárásálló gumikábel a teljes nyomvonalon.</li>
          <li>Stabil konzol + vastag rezgéscsillapítók a kültéri egységnél.</li>
          <li>Szakszerű faláttörés, tömítés és esztétikus lezárás.</li>
          <li>Nyomáspróba + vákuumozás, majd beüzemelés és működési teszt.</li>
        </ul>
      </div>

      <div className="mt-4 rounded-2xl bg-amber-50 p-5 text-sm leading-relaxed text-slate-800">
        <h3 className="font-black">Belső számlázási bontás</h3>
        <p className="mt-3">Adorján Alin E.V. – klímatelepítési munkadíj: <strong>{ft(installerAmount)}</strong></p>
        <p>AMOVA 4U Kft. – klímaberendezés + szerelési anyagok: <strong>{ft(materialAmount)}</strong></p>
        <p className="mt-2 text-xs">Ez a bontás az ügyfél által fizetendő végösszeget nem módosítja.</p>
      </div>

      <div className="mt-8 text-sm text-slate-700">
        <p>Üdvözlettel,</p>
        <p className="font-black">Adorján Alin · KLIMAlin</p>
        <p>klimalin.hu · legkondikalkulator.hu · 06 30 700 4908</p>
      </div>
    </article>;
  }

  function AppointmentConfirmationDocument({ customer }: { customer: Customer }) {
    const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
    return <article className="mx-auto max-w-[760px] rounded-3xl bg-white p-6 text-slate-950 shadow-2xl print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <img src="/alin-klima-logo.png" alt="KLIMAlin logo" className="h-16 w-auto object-contain" />
          <div>
            <h2 className="text-3xl font-black">Időpont-visszaigazolás</h2>
            <p className="mt-2 text-sm text-slate-600">Klímaszerelési időpont és helyszín összesítő</p>
          </div>
        </div>
        <div className="text-sm text-slate-600 md:text-right">
          <p>Kapcsolat: 06 30 700 4908</p>
          <p>klimalin.hu</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-slate-100 p-5 text-sm leading-relaxed">
        <p className="text-lg font-black">Tisztelt {customer.name || "Ügyfelünk"}!</p>
        <p className="mt-3">Ezúton visszaigazoljuk az egyeztetett klímaszerelési időpontot. Kérjük, hogy a megadott időpontban a szerelési helyszín legyen hozzáférhető, és a beltéri, illetve kültéri egység tervezett helye körül legyen elegendő munkaterület.</p>
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
          <p className="mt-1">{customer.time || "egyeztetés szerint"}</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-slate-100 p-4">
        <p className="text-sm text-slate-500">Telepítési helyszín</p>
        <p className="mt-1 text-lg font-black">{fullCustomerAddress(customer) || "nincs megadva"}</p>
      </div>

      <div className="mt-6 space-y-3">
        {items.map((item, i)=><div key={`${item.productId}-${i}`} className="rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-lg font-black">{item.quantity} db · {itemName(item)}</p>
            <p className="text-sm text-slate-600">szereléssel együtt</p>
          </div>
        </div>)}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 p-5 text-sm leading-relaxed">
        <p className="font-black">Fontos tudnivalók</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-700">
          <li>Kérjük, hogy a szerelési helyszín legyen megközelíthető.</li>
          <li>A beltéri és kültéri egység tervezett helye legyen hozzáférhető.</li>
          <li>Amennyiben az időponttal kapcsolatban bármi változna, kérjük, jelezze telefonon.</li>
        </ul>
      </div>

      <div className="mt-8 text-sm text-slate-700">
        <p>Üdvözlettel,</p>
        <p className="font-black">Adorján Alin · KLIMAlin</p>
        <p>klimalin.hu · legkondikalkulator.hu · 06 30 700 4908</p>
      </div>
    </article>;
  }


  if (view==="documentPreview") {
    const report = documentReportFor(selected);
    const isAppointmentPreview = documentPreviewType === "appointment_confirmation";
    const isQuotePreview = documentPreviewType === "quote_document";
    const title = documentPreviewType === "purchase_declaration" ? "Vásárlási nyilatkozat" : isAppointmentPreview ? "Időpont-visszaigazolás" : isQuotePreview ? "Árajánlat" : "Klímaszerelési munkalap";
    return <Shell><style>{`@media print { @page { size: A4 portrait; margin: 0; } html, body { width: 210mm !important; min-height: 297mm !important; margin: 0 !important; background: #fff !important; } body * { visibility: hidden !important; } .print-document-area, .print-document-area * { visibility: visible !important; } .print-document-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 210mm !important; background: #fff !important; } .doc-print-page { box-sizing: border-box !important; width: 210mm !important; max-width: 210mm !important; min-height: 297mm !important; height: 297mm !important; margin: 0 !important; box-shadow: none !important; border: 0 !important; border-radius: 0 !important; overflow: hidden !important; page-break-after: always !important; break-after: page !important; } .work-report-doc { padding: 14mm !important; font-size: 11.5px !important; line-height: 1.2 !important; } .purchase-doc { padding: 12mm !important; font-size: 10px !important; line-height: 1.18 !important; } .doc-print-page * { box-sizing: border-box !important; } .doc-print-page:last-child { page-break-after: auto !important; break-after: auto !important; } }`}</style><Back onClick={()=>setView(documentBackView)}/><div className="print:hidden"><Hero title={title} sub={`${selected.name || "Ügyfél"} · ${fullCustomerAddress(selected)}`} action="Nyomtatás" onAction={()=>window.print()}/>{message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}{documentBackView === "documents" || isAppointmentPreview || isQuotePreview ? <div className="mb-5"><button onClick={()=>window.print()} className="w-full rounded-2xl bg-white/10 px-5 py-4 font-black text-white sm:w-auto">Nyomtatás / mentés PDF-be</button></div> : <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2"><button onClick={()=>openWorkReportFor(selected)} className="rounded-2xl bg-emerald-400/20 px-5 py-4 font-black text-emerald-100">Munkalap szerkesztése / aláírás</button><button onClick={()=>saveWorkReport(true)} className="rounded-2xl bg-blue-400/20 px-5 py-4 font-black text-blue-100">Mentés és email küldése</button></div>}{!isAppointmentPreview && !isQuotePreview && !report.id && !report.signatureDataUrl ? <div className="mb-5 rounded-2xl border border-amber-300/30 bg-amber-400/20 p-4 text-sm font-bold text-amber-100">Ehhez az ügyfélhez még nincs mentett munkalap vagy aláírás. A dokumentum előnézete az ügyféladatokból készül, de hivatalosan előbb érdemes aláíratni és menteni.</div> : null}</div><div className="print-document-area print:bg-white">{documentPreviewType === "purchase_declaration" ? <PurchaseDeclarationDocument customer={selected} report={report}/> : isAppointmentPreview ? <AppointmentConfirmationDocument customer={selected}/> : isQuotePreview ? <QuoteDocument customer={selected}/> : <WorkReportDocument customer={selected} report={report}/>}</div></Shell>;
  }

  if (view==="documents") {
    const documentCustomers = filteredCustomers;
    return (
      <Shell>
        <Back onClick={()=>setView("dashboard")}/>
        <Hero title="Dokumentumtár" sub="" action="Frissítés" onAction={loadCustomersFromDb}/>
        <Layout>
          <Main>
            <Card title="Dokumentumok ügyfelenként">
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
                <input className="input" value={customerSearch} onChange={(event)=>setCustomerSearch(event.target.value)} placeholder="Keresés név, telefon, település, cím vagy klíma alapján..." />
                <select className="input" value={customerStatusFilter} onChange={(event)=>setCustomerStatusFilter(event.target.value)}>
                  <option value="all">Összes státusz</option>
                  {STATUS_OPTIONS.map((status)=><option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              {hasCustomerFilter ? <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-white/5 p-3 text-sm font-bold text-slate-300"><span>{documentCustomers.length} találat</span><button onClick={clearCustomerFilter} className="rounded-xl bg-white/10 px-3 py-2 text-cyan-100">Szűrő törlése</button></div> : null}
              <div className="space-y-4">
                {documentCustomers.length === 0 ? <div className="rounded-2xl bg-white/10 p-4 font-black text-slate-300">Nincs találat.</div> : null}
                {documentCustomers.map((customer)=><div key={customer.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4"><div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><p className="text-xl font-black">{customer.name || "Névtelen ügyfél"}</p><p className="mt-1 text-sm text-slate-400">{fullCustomerAddress(customer)}{customer.date ? ` · ${customer.date.replaceAll("-", ".")} ${customer.time || ""}` : ""}</p><p className="mt-1 text-xs font-bold text-cyan-200/80">{climateSummary(customer.quoteItems)}</p></div><button onClick={()=>openCustomer(customer,"work")} className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">Ügyfél megnyitása</button></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2">{documentRowsFor(customer).map((row)=><div key={row.title} className="rounded-2xl bg-white/5 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{row.title}</p></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${row.status.includes("Elküld") || row.status.includes("Kész") || row.status.includes("Aláírva") || row.status.includes("Elkészült") ? "bg-emerald-400/20 text-emerald-200" : row.status.includes("később") ? "bg-slate-500/20 text-slate-300" : "bg-amber-400/20 text-amber-200"}`}>{row.status}</span></div><DocumentLibraryActions customer={customer} row={row}/></div>)}</div></div>)}
              </div>
            </Card>
          </Main>
          <Side><Gradient title="Dokumentum állapot" value={`${documentCustomers.length} ügyfél`}/>{renderCustomerSearchPanel("Gyors kereső")}</Side>
        </Layout>
      </Shell>
    );
  }

  if (view==="lead") return <Shell><Back onClick={()=>setView("dashboard")}/><Hero title={selected.name || "Új ügyfél"} sub={`Státusz: ${selected.status || "Visszahívandó"}`} action="Mentés" onAction={saveCustomerOnly}/><Layout><Main><Card title="Ügyféladatok szerkesztése"><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><EditField label="Név" value={selected.name} onChange={v=>updateSelectedField("name",v)}/><EditField label="Telefonszám" value={selected.phone} onChange={v=>updateSelectedField("phone",v)}/><EditField label="Email" value={selected.email} onChange={v=>updateSelectedField("email",v)}/><EditField label="Település" value={selected.city} onChange={v=>updateSelectedField("city",v)}/><div><EditField label="Cím" value={selected.address} onChange={v=>updateSelectedField("address",v)}/>{selected.address || selected.city ? <a href={mapsHref(selected)} target="_blank" rel="noreferrer" onClick={()=>rememberExternalCustomer(selected,"lead")} className="mt-3 block rounded-2xl bg-cyan-300 px-5 py-4 text-center font-black text-slate-950">Útvonal tervezése Google Térképpel</a> : null}</div></div></Card><Card title="Telefonos jegyzet"><textarea className="input min-h-32" value={selected.notes || ""} onChange={e=>updateSelectedField("notes", e.target.value)} placeholder="Például: mikor hívjam vissza, mit kért, fontos tudnivalók..."/></Card></Main><Side><Gradient title="Aktuális státusz" value={selected.status || "Visszahívandó"}/><StatusControl value={selected.status || "Visszahívandó"} onChange={updateCustomerStatus}/><Card title="Következő lépések">
              <div className="grid grid-cols-1 gap-3">
                <StepButton color="green" href={telHref(selected.phone)} onClick={()=>rememberExternalCustomer(selected,"lead")}>Hívás</StepButton>
                <StepButton color="amber" onClick={saveCustomerOnly}>Mentés</StepButton>
                <StepButton color="blue" onClick={()=>saveCustomer("quote")}>Mentés és ajánlat</StepButton>
              </div>
            </Card></Side></Layout></Shell>;

  if (view==="quote") return <Shell><Back onClick={()=>setView("dashboard")}/><Hero title="Klíma ajánlat összeállítása" sub={`${selected.name} · ${selected.city}`} action="Ajánlat előnézet" onAction={()=>setView("quotePreview")}/><Layout><Main><Card title="Ajánlatban szereplő tételek">
              <p className="mb-4 text-sm text-slate-400">Az ár automatikusan jön a klímából, de kézzel módosítható. Külön egyedi tételt is hozzáadhatsz.</p>
              <div className="space-y-3">
                {quoteItems.map((it,i)=>
                  <div key={i} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_150px_44px]">
                      {it.isManual ? (
                        <input className="input" value={it.customName || ""} onChange={e=>updateQuoteItem(i,"customName",e.target.value)} placeholder="Tétel megnevezése" />
                      ) : (
                        <ProductSelect value={it.productId} onChange={v=>updateQuoteProduct(i,v)}/>
                      )}
                      <input className="input" type="number" min={1} value={it.quantity} onChange={e=>updateQuoteItem(i,"quantity",Math.max(1,Number(e.target.value||1)))}/>
                      <input className="input" type="number" min={0} value={itemUnitPrice(it)} onChange={e=>updateQuoteItem(i,"customPrice",Math.max(0,Number(e.target.value||0)))}/>
                      <button className="rounded-xl bg-white/10 font-black disabled:cursor-not-allowed disabled:opacity-40" disabled={!canEditWorkResources} onClick={()=>removeQuoteItem(i)}>×</button>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-white/5 p-3 text-sm md:flex-row md:items-center md:justify-between">
                      <span>{itemPriceLine(it)}{hasCustomProductPrice(it) ? " · kézzel módosított ár" : ""}</span>
                      <b>{ft(itemTotal(it))}</b>
                    </div>
                    {hasCustomProductPrice(it) ? (
                      <button type="button" disabled={!canEditWorkResources} onClick={()=>syncQuoteItemPrice(i)} className="mt-2 w-full rounded-2xl bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-40">
                        Ár frissítése a klíma listaárára: {ft(prod(it.productId).price)}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-col gap-3 md:flex-row">
                <button className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950" onClick={addQuoteItem}>+ Klíma hozzáadása</button>
                <button className="rounded-2xl bg-amber-300 px-5 py-4 font-black text-slate-950" onClick={addManualQuoteItem}>+ Egyedi tétel</button>
              </div>
            </Card><Card title="Ár és belső bontás">{quoteItems.map((it,i)=><InfoRow key={i} label={`${it.quantity} db · ${itemName(it)}`} value={ft(itemTotal(it))} />)}<div className="mt-3 flex justify-between rounded-3xl bg-cyan-300 p-5 text-xl text-slate-950"><b>Ügyfél által fizetendő</b><b>{ft(t)}</b></div><div className="mt-6 rounded-[2rem] border border-white/10 bg-slate-950/70 p-5"><InfoRow label="Adorján Alin E.V. — telepítési munkadíj" value={ft(installer)}/><InfoRow label="AMOVA 4U Kft. — klíma + szerelési anyagok" value={ft(materialPrice)}/></div></Card></Main><Side><Gradient title="Ajánlat státusz" value="Küldésre kész"/><Card title="Gyors műveletek"><p className="mb-3 text-sm leading-relaxed text-slate-400">Az ajánlat email telefonról is ugyanígy küldhető, nem kell külön levelezőappot megnyitni.</p><button onClick={sendQuoteEmail} disabled={quoteEmailBusy} className="block w-full rounded-3xl bg-gradient-to-br from-blue-400 to-indigo-500 px-5 py-4 text-center font-black text-white shadow-xl disabled:cursor-wait disabled:opacity-60">{quoteEmailBusy ? "Küldés folyamatban..." : "Ajánlat küldése emailben"}</button><Btn color="cyan" onClick={()=>{updateCustomerStatus("Ajánlat elküldve"); setView("schedule")}}>Időpont keresése</Btn></Card></Side></Layout></Shell>;


  if (view==="quotePreview") {
    return (
      <Shell>
        <div className="no-print"><Back onClick={()=>setView("quote")}/><Hero title="Ajánlat előnézet" sub={`${selected.name} · ${selected.city}`} action="Nyomtatás / mentés PDF-be" onAction={()=>window.print()}/></div>
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
                    <p>Ajánlat érvényessége: 7 nap</p>
                    <p>Kapcsolat: 06 30 700 4908</p>
                    <p>klimalin.hu</p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-sm text-slate-500">Ügyfél</p>
                    <p className="mt-1 text-xl font-black">{selected.name || "Nincs név"}</p>
                    <p className="mt-1">{selected.city}</p>
                    <p>{displayAddress(selected)}</p>
                    <p>{selected.email}</p>
                    <p>{selected.phone}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-sm text-slate-500">Ajánlat összesítő</p>
                    <p className="mt-1 text-xl font-black">{ft(t)}</p>
                    <p className="mt-1 text-sm text-slate-600">Bruttó végösszeg alapszereléssel</p>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {quoteItems.map((item, index) => {
                    return (
                      <div key={index} className="quote-item flex flex-col gap-2 rounded-2xl border border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-black">{item.quantity} db · {itemName(item)}</p>
                          <p className="text-sm text-slate-500">{itemPriceLine(item)}</p>
                        </div>
                        <b>{ft(itemTotal(item))}</b>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 rounded-2xl bg-slate-950 p-5 text-white">
                  <div className="flex justify-between gap-4 text-xl">
                    <span className="font-black">Fizetendő bruttó végösszeg</span>
                    <b>{ft(t)}</b>
                  </div>
                </div>

                <div className="quote-second-page mt-6 rounded-2xl bg-slate-100 p-5">
                  <h3 className="text-xl font-black">Alapszerelés tartalma</h3>
                  <div className="mt-3 space-y-2 text-sm leading-relaxed">
                    <p>• max. 3 m szigetelt rézcső-pár / klíma</p>
                    <p>• 1 db faláttörés, tömítés és esztétikus lezárás</p>
                    <p>• kondenzvíz elvezetés kialakítása gravitációsan, megfelelő lejtéssel (adottság szerint)</p>
                    <p>• kültéri fali konzol vastag rezgéscsillapítókkal, elhelyezés max. 4 m szerelési magasságig (létraállással)</p>
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
                    <p>• Betanítás (üzemmódok, szűrőtisztítás) + rendrakás a végén.</p>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl bg-amber-50 p-5 text-sm text-slate-800">
                  <h3 className="font-black">Belső számlázási bontás</h3>
                  <p className="mt-2">Adorján Alin E.V. – klímatelepítési munkadíj: {ft(installer)}</p>
                  <p>AMOVA 4U Kft. – klímaberendezés + szerelési anyagok: {ft(materialPrice)}</p>
                  <p className="mt-2 text-slate-600">Ez a bontás az ügyfél által fizetendő végösszeget nem módosítja.</p>
                </div>

                <div className="mt-6 text-sm text-slate-600">
                  <p>Üdvözlettel,</p>
                  <p className="font-black text-slate-950">Adorján Alin · KLIMAlin</p>
                  <p>klimalin.hu · legkondikalkulator.hu · 06 30 700 4908</p>
                </div>
              </div>
            </Card>
          </Main>
          <Side>
            <div className="no-print"><Card title="Ajánlat műveletek">
              <div className="space-y-3">
                <p className="rounded-2xl bg-slate-950/60 p-4 text-sm leading-relaxed text-slate-300">Az ajánlatot szépen formázott emailben küldi el. Telefonon is ugyanígy működik.</p>
                <button onClick={sendQuoteEmail} disabled={quoteEmailBusy} className="block w-full rounded-2xl bg-emerald-400 px-5 py-4 text-center font-black text-slate-950 disabled:cursor-wait disabled:opacity-60">{quoteEmailBusy ? "Küldés folyamatban..." : "Ajánlat küldése emailben"}</button>
                <Btn color="cyan" onClick={()=>setView("schedule")}>Időpont keresése</Btn>
              </div>
            </Card></div>
          </Side>
        </Layout>
      </Shell>
    );
  }

  if (view==="schedule") {
    const booked = customers.filter(c=>c.id!==selected.id && c.date===scheduleDate).flatMap(c=>occupiedSlots(c));
    const free = BASE_SLOTS.filter(s=>!booked.includes(s));
    const isExistingSchedule = Boolean(selected.date);
    return <Shell><Back onClick={()=>setView(isExistingSchedule ? "work" : "quote")}/><Hero title={isExistingSchedule ? "Időpont módosítása" : "Időpont választása"} sub={`${selected.name} · ${selected.city}`} action={isExistingSchedule ? "Időpont frissítése" : "Időpont mentése"} onAction={saveSchedule}/><Layout><Main><Calendar mode={mode} date={calDate} customers={calendarCustomers} selectable selectedDate={scheduleDate} onSelect={setScheduleDate} onMode={setMode} onStep={step} onOpen={c=>openCustomer(c,"work")}/><Card title="Választható időpontok">{isMultiDayJob ? <div className="rounded-2xl bg-emerald-400/20 p-4 font-black text-emerald-100">2 vagy több klíma esetén automatikusan lefoglaljuk a 08:00 és 12:00 idősávot.</div> : <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{free.length===0 ? <div className="rounded-2xl bg-red-500/20 p-4 font-black text-red-200">Erre a napra nincs szabad idősáv.</div> : free.map(s=><button key={s} className={scheduleTime===s ? "slot-active" : "slot"} onClick={()=>setScheduleTime(s)}>{s==="16:00" ? "+1 extra" : s}</button>)}</div>}</Card></Main><Side><Gradient title="Kiválasztott időpont" value={`${scheduleDate.replaceAll("-",".")} · ${shownTime}`}/><Card title="Időpontba kerülő klímák"><p className="mb-4 text-sm leading-relaxed text-slate-400">Mentéskor kérés szerint automatikus, magázódó időpont-visszaigazoló emailt küldünk. Telefonról is ugyanígy működik.</p>{quoteItems.map((it,i)=><div key={i} className="mb-3 rounded-2xl bg-slate-900/80 p-4"><p className="font-black">{prod(it.productId).name}</p><div className="mt-3 grid grid-cols-[1fr_90px] gap-3"><ProductSelect value={it.productId} onChange={v=>updateQuoteProduct(i,v)}/><input className="input" type="number" min={1} value={it.quantity} onChange={e=>updateQuoteItem(i,"quantity",Math.max(1,Number(e.target.value||1)))}/></div></div>)}<button className="mb-4 rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950" onClick={addQuoteItem}>+ Klíma hozzáadása</button><InfoRow label="Összes klíma" value={`${q} db`}/><label className="mb-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm font-bold text-slate-200"><input type="checkbox" checked={sendAppointmentNotice} onChange={e=>setSendAppointmentNotice(e.target.checked)} className="mt-1 h-5 w-5 accent-cyan-300"/><span>Tájékoztató email küldése az ügyfélnek az időpont rögzítésekor</span></label><Btn color="green" onClick={saveSchedule}>{appointmentEmailBusy ? "Mentés és email küldés..." : (isExistingSchedule ? "Időpont frissítése" : "Időpont mentése")}</Btn></Card></Side></Layout></Shell>;
  }

  if (view==="workReport") return <Shell><Back onClick={()=>setView("work")}/><Hero title="Klímás munkalap" sub={`${selected.name} · ${selected.city} · ${selected.date || scheduleDate}`} action={workReportBusy ? "Mentés..." : "Munkalap mentése"} onAction={()=>saveWorkReport(false)}/>{message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}<Layout><Main><Card title="Munkalap adatai"><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Field label="Ügyfél" value={selected.name || "nincs megadva"}/><Field label="Telepítési cím" value={fullCustomerAddress(selected)}/><Field label="Időpont" value={`${selected.date || scheduleDate} · ${selected.time || shownTime}`}/><Field label="Klíma" value={climateSummary(quoteItems)}/></div><label className="mt-5 block rounded-2xl bg-slate-900/80 p-4"><span className="text-sm text-slate-400">Elvégzett munka leírása</span><textarea className="mt-2 min-h-32 w-full bg-transparent text-base font-bold leading-relaxed outline-none" value={workReport.workDescription} onChange={(event)=>updateWorkReportField("workDescription", event.target.value)} /></label><label className="mt-4 block rounded-2xl bg-slate-900/80 p-4"><span className="text-sm text-slate-400">Munkalap megjegyzés</span><textarea className="mt-2 min-h-28 w-full bg-transparent text-base font-bold leading-relaxed outline-none" value={workReport.notes} onChange={(event)=>updateWorkReportField("notes", event.target.value)} placeholder="Például: ügyfél tájékoztatva, rendben átadva, egyedi megjegyzés..." /></label></Card><Card title="Egyszerű ügyfél aláírás"><EditField label="Aláíró neve" value={workReport.signerName || selected.name || ""} onChange={(value)=>updateWorkReportField("signerName", value)} /><SignaturePad value={workReport.signatureDataUrl} onChange={(value)=>setWorkReport((prev)=>({ ...prev, signatureDataUrl: value, signedAt: value ? new Date().toISOString() : undefined }))}/>{workReport.signedAt ? <p className="mt-3 text-sm font-bold text-emerald-200">Aláírva: {formatSignedAt(workReport.signedAt)}</p> : <p className="mt-3 text-sm font-bold text-amber-200">Még nincs aláírás.</p>}</Card></Main><Side><Gradient title="Munkalap státusz" value={workReport.signatureDataUrl ? "Aláírva" : "Aláírásra vár"}/><Card title="Műveletek"><div className="grid grid-cols-1 gap-3"><StepButton color="green" onClick={()=>saveWorkReport(false)}>{workReportBusy && !workReportEmailBusy ? "Mentés..." : "Munkalap mentése"}</StepButton><StepButton color="blue" onClick={()=>saveWorkReport(true)}>{workReportEmailBusy ? "Email küldése..." : "Mentés és email küldése"}</StepButton></div><p className="mt-4 text-sm leading-relaxed text-slate-400">Az email telefonról és laptopról is ugyanazzal a Resend küldéssel megy ki. PDF nincs, így az ékezetek rendben maradnak.</p></Card><Card title="Email állapot"><InfoRow label="Ügyfél email" value={selected.email || "nincs megadva"}/><InfoRow label="Elküldve" value={workReport.emailSentAt ? formatSignedAt(workReport.emailSentAt) : "még nem"}/></Card></Side></Layout></Shell>;

  if (view==="work") return <Shell><Back onClick={()=>setView("dashboard")}/><Hero title={`${selected.name} — Munkaoldal`} sub={`${selected.city} · ${selected.date || scheduleDate} · ${selected.time || shownTime}`} action="Teljes lezárás ellenőrzése" onAction={closeWork}/>{message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}<Layout><Main><Card title="Ügyféladatok"><div className="mb-4 flex flex-wrap gap-3">{editCustomer ? <Btn color="green" onClick={saveCustomerData}>Ügyféladatok mentése</Btn> : <Btn color="blue" onClick={()=>setEditCustomer(true)}>Ügyféladatok szerkesztése</Btn>}{editCustomer ? <button onClick={()=>setEditCustomer(false)} className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-cyan-200">Mégse</button> : null}</div><CustomerGrid c={selected} editable={editCustomer} onChange={updateSelectedField} onExternalOpen={()=>rememberExternalCustomer(selected,"work")}/>{selected.date ? <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Időpont</p><p className="text-base font-black text-slate-100">{selected.date.replaceAll("-", ".")} · {selected.time || shownTime}</p></div><button type="button" onClick={()=>{setScheduleDate(selected.date || todayIso()); setScheduleTime(selected.time?.split(" ")[0] || "08:00"); setView("schedule");}} className="shrink-0 rounded-2xl bg-cyan-300/15 px-4 py-3 text-sm font-black text-cyan-100 ring-1 ring-cyan-200/20">Időpont módosítása</button></div></div> : null}</Card><Card title="Időponthoz tartozó klímák">
              {workResourceEditLocked && !allowWorkResourceEdit ? <div className="mb-4 rounded-2xl border border-amber-300/30 bg-amber-400/15 p-4 text-sm font-bold text-amber-100">A szerelés készre jelölése után a klímák és a szerelési anyagok zárolva vannak. Szerkesztéshez nyomd meg a Módosítás engedélyezése gombot.</div> : null}
              <div className="space-y-3">
                {quoteItems.map((it,i)=>
                  <div key={i} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_110px_44px] gap-3">
                      <ProductSelect value={it.productId} onChange={v=>updateQuoteProduct(i,v)} disabled={!canEditWorkResources} />
                      <input className="input disabled:cursor-not-allowed disabled:opacity-60" type="number" min={1} value={it.quantity} disabled={!canEditWorkResources} onChange={e=>updateQuoteItem(i,"quantity",Math.max(1,Number(e.target.value||1)))} />
                      <button className="rounded-xl bg-white/10 font-black disabled:cursor-not-allowed disabled:opacity-40" disabled={!canEditWorkResources} onClick={()=>removeQuoteItem(i)}>×</button>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-white/5 p-3 text-sm md:flex-row md:items-center md:justify-between">
                      <span>{itemPriceLine(it)}{hasCustomProductPrice(it) ? " · kézzel módosított ár" : ""}</span>
                      <b>{ft(itemTotal(it))}</b>
                    </div>
                    {hasCustomProductPrice(it) ? (
                      <button type="button" disabled={!canEditWorkResources} onClick={()=>syncQuoteItemPrice(i)} className="mt-2 w-full rounded-2xl bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-40">
                        Ár frissítése a klíma listaárára: {ft(prod(it.productId).price)}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-col md:flex-row gap-3">
                <button className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canEditWorkResources} onClick={addQuoteItem}>+ Klíma hozzáadása</button>
                {workResourceEditLocked && !allowWorkResourceEdit ? <button className="rounded-2xl bg-amber-300 px-5 py-4 font-black text-slate-950" onClick={()=>setAllowWorkResourceEdit(true)}>Módosítás engedélyezése</button> : null}
                {canEditWorkResources ? <button className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950" onClick={saveWorkChanges}>Módosítás mentése az időpontra</button> : null}
              </div>
              <div className="mt-4 rounded-2xl bg-slate-950/60 p-4">
                <InfoRow label="Összesen" value={ft(total(quoteItems))} />
                <InfoRow label="Klímák száma" value={`${qty(quoteItems)} db`} />
                <InfoRow label="Idősáv logika" value={qty(quoteItems) >= 2 ? "08:00 + 12:00" : (selected.time || scheduleTime || "08:00")} />
              </div>
            </Card><Card title="Felhasznált anyagok"><div className="mb-4 flex justify-end"><button className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canEditWorkResources} onClick={addExtraMaterial}>+ Egyéb anyag</button></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{materials.map((m,i)=><div key={i} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {m.isExtra ? <input className="input disabled:cursor-not-allowed disabled:opacity-60" disabled={!canEditWorkResources} value={m.name} onChange={e=>updateMaterial(i,"name",e.target.value)}/> : <p className="font-black">{m.name}</p>}
                      {m.isExtra ? <p className="mt-1 text-xs text-slate-400">Egyéb anyag</p> : null}
                    </div>
                    {!m.isExtra ? <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-200">x{climateCountForMaterials()}</span> : null}
                  </div>

                  <div className="mt-4">
                    {m.name==="Konzol" ? (
                      <select className="input disabled:cursor-not-allowed disabled:opacity-60" disabled={!canEditWorkResources} value={m.qty} onChange={e=>updateMaterial(i,"qty",e.target.value)}>
                        <option>450-es konzol</option>
                        <option>550-es konzol</option>
                        <option>Egyedi konzol</option>
                      </select>
                    ) : (
                      <input
                        className="input disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!canEditWorkResources}
                        value={finalMaterialQty(m)}
                        onChange={e=>updateFinalMaterialQty(m.name,e.target.value)}
                      />
                    )}
                  </div>

                  <div className="mt-3 rounded-2xl bg-white/5 p-3 text-sm">
                    <span className="text-slate-400">Egység / mennyiség:</span>
                    <b className="ml-2">{materialDisplayUnit(m)}</b>
                  </div>

                  {m.isExtra ? <div className="mt-3"><input className="input disabled:cursor-not-allowed disabled:opacity-60" disabled={!canEditWorkResources} value={m.unit} onChange={e=>updateMaterial(i,"unit",e.target.value)} placeholder="egység"/></div> : null}
                </div>)}</div></Card></Main><Side><Gradient title="Munka státusz" value={selected.status || "Folyamatban"}/><Card title="Dokumentumok"><div className="space-y-3">{documentRowsFor(selected).map((row)=><div key={row.title} className="rounded-2xl border border-white/10 bg-slate-900/80 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{row.title}</p></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${row.status.includes("Elküld") || row.status.includes("Kész") || row.status.includes("Aláírva") || row.status.includes("Elkészült") ? "bg-emerald-400/20 text-emerald-200" : row.status.includes("később") ? "bg-slate-500/20 text-slate-300" : "bg-amber-400/20 text-amber-200"}`}>{row.status}</span></div><DocumentActions customer={selected} row={row}/></div>)}</div></Card><Card title="Lezárási műveletek">
              <div className="space-y-3">
                <StepButton color="cyan" onClick={openWorkReport}>Munkalap és egyszerű aláírás</StepButton>
                
                <StepButton color="blue" onClick={()=>sendAppointmentEmailFor(selected)}>{appointmentEmailBusy ? "Email küldése..." : "Időpont email újraküldése"}</StepButton>
                <StepButton color="amber" onClick={markInstallationDone}>Szerelés kész – admin folyamatban</StepButton>
                <StepButton color="green" onClick={closeWork}>Teljes lezárás</StepButton>
                <button onClick={cancelAppointment} className="group flex w-full items-center justify-between gap-3 rounded-3xl bg-gradient-to-br from-red-500 to-rose-500 px-5 py-4 text-left font-black text-white shadow-xl transition hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99]">
                  <span>Időpont törlése / lemondva</span>
                  <span className="rounded-full bg-black/10 px-3 py-1 text-sm">×</span>
                </button>
              </div>
            </Card><Card title="Lezárási ellenőrzőlista">
              <div className="space-y-3">
                {checklistItems.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => toggleChecklist(item.key)}
                    className={`w-full rounded-2xl p-4 text-left font-black transition ${currentWorkChecklist[item.key] ? "bg-emerald-400/20 text-emerald-200 border border-emerald-300/30" : "bg-slate-900/80 text-slate-200 border border-white/10"}`}
                  >
                    <span className="mr-3">{currentWorkChecklist[item.key] ? "✓" : "○"}</span>
                    {item.label}
                  </button>
                ))}
              </div>
              <div className={`mt-4 rounded-2xl p-4 font-black ${checklistReady ? "bg-emerald-400/20 text-emerald-200" : "bg-amber-400/20 text-amber-200"}`}>
                {checklistReady ? "Teljes lezárás engedélyezve ✅" : `Admin hiányos: ${missingChecklist.length} tétel`}
              </div>
            </Card>
            </Side></Layout></Shell>;

  return <Shell><header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div><p className="mb-3 inline-flex rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-cyan-200">AlinFlow v64 · CSV import javítás</p><h1 className="text-5xl font-black">Alin<span className="text-cyan-300">Flow</span></h1></div><div className="flex flex-wrap gap-3"><Btn onClick={startNewCustomer}>+ Új ügyfél</Btn><Btn color="blue" onClick={() => setView("documents")}>Dokumentumok</Btn><Btn color="green" onClick={() => setView("warehouse")}>Raktár</Btn><Btn color="blue" onClick={() => setView("archive")}>Lezárt / lemondott ({archivedCustomers.length})</Btn><button onClick={handleLogout} className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-cyan-100">Kilépés</button></div></header>{message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}<Stats customers={activeCustomers} stockOf={stockOf} reservedForProduct={reservedForProduct} onSelect={openTask}/><Layout><Main><Calendar mode={mode} date={calDate} customers={calendarCustomers} onMode={setMode} onStep={step} onOpen={c=>openCustomer(c,"work")}/><Card title="Új érdeklődők"><div className="space-y-3">{filteredActiveCustomers.filter(c=>!c.date).map(c=><button key={c.id} onClick={()=>openCustomer(c,"lead")} className="w-full rounded-3xl border border-white/10 bg-slate-900/80 p-4 text-left transition hover:border-cyan-300/40"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><p className="text-lg font-black">{c.name}</p><p className="text-sm text-slate-400">{c.city} · {c.email || "nincs email"}</p><p className="mt-1 text-xs text-cyan-200/80">{climateSummary(c.quoteItems)}</p></div><span className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold">{c.status}</span></div></button>)}</div></Card></Main><Side>{renderCustomerSearchPanel()}{renderLeadImportPanel()}<Card title="Raktár gyorsnézet">
            <div className="space-y-3">
              {PRODUCTS.map((product: any) => {
                const stock = stockOf(product.id);
                const reserved = reservedForProduct(product.id);
                const free = stock - reserved;
                if (stock <= 0 && reserved <= 0) return null;

                return (
                  <div key={product.id} className="rounded-2xl bg-slate-900/80 p-4">
                    <div className="flex justify-between gap-3">
                      <span className="font-black">{product.name}</span>
                      <b className={free >= 0 ? "text-emerald-300" : "text-red-300"}>{free >= 0 ? `${free} szabad` : `${Math.abs(free)} db hiány`}</b>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      raktáron: {stock} db · lefoglalva: {reserved} db
                      {reserved > stock ? <span className="mt-2 block font-black text-red-300">Figyelem: több van lefoglalva, mint készleten.</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </Side></Layout></Shell>;
}


function calendarStatusStyle(status: string) {
  if (status === "Lezárva") return "border border-emerald-700/70 bg-emerald-950/90 text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]";
  if (status === "Szerelés kész – admin folyamatban") return "border border-amber-300/45 bg-amber-400/20 text-amber-50 shadow-[0_0_0_1px_rgba(251,191,36,0.10)]";
  if (status === "Időpont foglalva") return "border border-sky-300/45 bg-sky-400/20 text-sky-50 shadow-[0_0_0_1px_rgba(56,189,248,0.10)]";
  if (status === "Ajánlat elküldve") return "border border-violet-300/40 bg-violet-400/15 text-violet-50";
  return "border border-white/10 bg-white/10 text-white";
}

function calendarStatusLabel(status: string) {
  if (status === "Szerelés kész – admin folyamatban") return "Admin";
  if (status === "Időpont foglalva") return "Foglalva";
  if (status === "Lezárva") return "Lezárva";
  if (status === "Ajánlat elküldve") return "Ajánlat";
  if (status === "Visszahívandó") return "Visszahívandó";
  return status || "Munka";
}

function Calendar({ mode, date, customers, onMode, onStep, onOpen, selectable, selectedDate, onSelect }: { mode:CalendarMode; date:Date; customers:Customer[]; onMode:(m:CalendarMode)=>void; onStep:(n:number)=>void; onOpen:(c:Customer)=>void; selectable?:boolean; selectedDate?:string; onSelect?:(d:string)=>void }) {
  const start = weekStart(date);
  const weekdayNames = ["Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek", "Szombat", "Vasárnap"];
  const days = useMemo(()=> {
    if (mode==="week") return Array.from({length:7},(_,i)=>{ const d=new Date(start); d.setDate(start.getDate()+i); return {d,current:true}; });
    const first=new Date(date.getFullYear(),date.getMonth(),1); const offset=(first.getDay()+6)%7; const last=new Date(date.getFullYear(),date.getMonth()+1,0); const total=Math.ceil((offset+last.getDate())/7)*7;
    return Array.from({length:total},(_,i)=>{ const d=new Date(date.getFullYear(),date.getMonth(),i-offset+1); return {d,current:d.getMonth()===date.getMonth()}; });
  }, [mode,date,start]);

  return (
    <Card title={selectable ? "Válassz napot a naptárból" : mode==="week" ? "Heti naptár" : "Havi naptár"}>
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex justify-end gap-2">
          <button onClick={()=>onMode("week")} className={mode==="week"?"tab-active":"tab"}>Heti</button>
          <button onClick={()=>onMode("month")} className={mode==="month"?"tab-active":"tab"}>Havi</button>
        </div>
        <div className="grid grid-cols-[46px_minmax(0,1fr)_46px] items-center gap-2 sm:grid-cols-[52px_minmax(0,1fr)_52px] sm:gap-3">
          <button onClick={()=>onStep(-1)} className="arrow">‹</button>
          <div className="min-w-0 rounded-2xl bg-cyan-300 px-3 py-3 text-center text-base font-black text-slate-950 sm:px-5 sm:text-lg md:text-xl">
            {calLabel(mode,date)}
          </div>
          <button onClick={()=>onStep(1)} className="arrow">›</button>
        </div>
      </div>

      {!selectable ? (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-3xl border border-white/10 bg-slate-950/40 p-3 text-[11px] font-black text-slate-200 sm:grid-cols-3 md:flex md:flex-wrap md:items-center">
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-full bg-sky-400/70" /> Időpont foglalva</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-full bg-amber-400/80" /> Admin folyamatban</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-full bg-emerald-800" /> Lezárva</span>
        </div>
      ) : null}

      {/* Telefonon lista nézetet használunk, ezért a heti fejlécet csak asztali/tablet szélességnél mutatjuk. */}
      <div className="mb-2 hidden grid-cols-7 gap-2 text-center text-[11px] font-black text-slate-400 md:grid">
        {weekdayNames.map(day => <div key={day}>{day}</div>)}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-7">
        {days.map(({d,current})=>{
          const dayIso=iso(d);
          const jobs=customers.filter(c=>c.date===dayIso);
          const isSel=selectable&&selectedDate===dayIso;
          const weekdayName = weekdayNames[(d.getDay()+6)%7];

          return (
            <div
              key={dayIso}
              onClick={()=>selectable&&onSelect?.(dayIso)}
              className={`min-h-[96px] rounded-3xl border p-3 md:min-h-[125px] ${isSel?"border-emerald-300 bg-emerald-400/20":current?"border-white/10 bg-slate-900/80":"border-white/5 bg-slate-950/40 opacity-40"} ${selectable?"cursor-pointer hover:ring-2 hover:ring-emerald-300/50":""}`}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-400 md:hidden">{weekdayName}</p>
                  <b className="text-2xl leading-none md:text-base">{d.getDate()}</b>
                </div>
                {jobs.length===0&&current?<span className="shrink-0 rounded-full bg-cyan-300/10 px-2 py-1 text-[11px] text-cyan-200 md:text-[10px]">üres</span>:null}
              </div>
              <div className="space-y-2">
                {jobs.map(j=>(
                  <div
                    key={j.id}
                    className={`w-full rounded-2xl p-3 text-left transition hover:ring-2 hover:ring-cyan-300/50 md:p-2 ${calendarStatusStyle(j.status)}`}
                  >
                    <button
                      type="button"
                      onClick={e=>{e.stopPropagation();onOpen(j)}}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-black">{j.time}</p>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold md:text-xs">{j.name}</p>
                      <p className="truncate text-xs text-cyan-100/80 md:text-[11px]">{climateSummary(j.quoteItems)}</p>
                      <p className="truncate text-xs opacity-70 md:text-[11px]">{j.city}</p>
                    </button>
                    {mode === "week" && !selectable ? (
                      <a
                        href={googleCalendarHref(j)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="mt-2 inline-flex items-center justify-center rounded-full border border-amber-200/20 bg-amber-300/15 px-2.5 py-1 text-[10px] font-black text-amber-100 transition hover:bg-amber-300/25"
                        title="Hozzáadás Google Naptárhoz"
                      >
                        + Naptár
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Shell({children}:{children:React.ReactNode}){return <main className="min-h-screen bg-[#08111F] p-4 text-white print:bg-white print:p-0 print:text-black md:p-8"><div className="mx-auto max-w-7xl space-y-8 print:max-w-none print:space-y-0">{children}</div></main>}
function Layout({children}:{children:React.ReactNode}){return <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">{children}</section>}
function Main({children}:{children:React.ReactNode}){return <div className="space-y-6 xl:col-span-2">{children}</div>}
function Side({children}:{children:React.ReactNode}){return <aside className="space-y-6">{children}</aside>}
function Card({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl"><h2 className="mb-5 text-2xl font-black">{title}</h2>{children}</section>}
function Hero({title,sub,action,onAction}:{title:string;sub:string;action:string;onAction?:()=>void}){return <section className="rounded-[2.5rem] border border-cyan-300/20 bg-gradient-to-br from-slate-950 to-slate-900 p-6 shadow-2xl md:p-8"><div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between"><div><h1 className="text-4xl font-black leading-tight md:text-5xl">{title}</h1>{sub ? <p className="mt-3 text-lg text-slate-400">{sub}</p> : null}</div><Btn onClick={onAction}>{action}</Btn></div></section>}
function Back({onClick}:{onClick:()=>void}){return <div className="sticky top-3 z-50 w-fit print:hidden"><button onClick={onClick} className="rounded-2xl border border-cyan-200/20 bg-slate-900/95 px-5 py-3 font-black text-cyan-100 shadow-2xl shadow-slate-950/40 backdrop-blur">← Vissza</button></div>}

function StepButton({
  children,
  color = "cyan",
  onClick,
  href,
}: {
  children: React.ReactNode;
  color?: "cyan" | "green" | "blue" | "amber" | "red";
  onClick?: () => void;
  href?: string;
}) {
  const colorClass = {
    cyan: "from-cyan-300 to-sky-400 text-slate-950 shadow-cyan-500/20",
    green: "from-emerald-400 to-green-500 text-slate-950 shadow-emerald-500/20",
    blue: "from-blue-400 to-indigo-500 text-white shadow-blue-500/20",
    amber: "from-amber-300 to-orange-400 text-slate-950 shadow-amber-500/20",
    red: "from-red-500 to-rose-500 text-white shadow-red-500/20",
  }[color];

  const className = `group flex w-full items-center justify-between gap-3 rounded-3xl bg-gradient-to-br ${colorClass} px-5 py-4 text-left font-black shadow-xl transition hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99]`;

  const content = (
    <>
      <span>{children}</span>
      <span className="rounded-full bg-black/10 px-3 py-1 text-sm transition group-hover:translate-x-1">→</span>
    </>
  );

  if (href) {
    return <a href={href} onClick={onClick} className={className}>{content}</a>;
  }

  return <button onClick={onClick} className={className}>{content}</button>;
}

function Btn({children,onClick,color="cyan"}:{children:React.ReactNode;onClick?:()=>void;color?:"cyan"|"green"|"blue"}){const c=color==="green"?"bg-emerald-400":color==="blue"?"bg-blue-400":"bg-cyan-300"; return <button onClick={onClick} className={`${c} rounded-2xl px-5 py-4 font-black text-slate-950`}>{children}</button>}
function InfoRow({label,value}:{label:string;value:string}){return <div className="mb-3 flex justify-between gap-4 rounded-2xl bg-slate-900/80 p-4"><span>{label}</span><b>{value}</b></div>}
function Field({label,value}:{label:string;value:string}){return <div className="rounded-2xl bg-slate-900/80 p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-1 text-lg font-black">{value}</p></div>}
function CustomerGrid({
  c,
  editable = false,
  onChange,
  onExternalOpen,
}: {
  c: Customer;
  editable?: boolean;
  onChange?: (field: keyof Customer, value: string) => void;
  onExternalOpen?: () => void;
}) {
  if (editable) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EditField label="Név" value={c.name} onChange={(value) => onChange?.("name", value)} />
        <EditField label="Telefonszám" value={c.phone} onChange={(value) => onChange?.("phone", value)} />
        <EditField label="Email" value={c.email || ""} onChange={(value) => onChange?.("email", value)} />
        <EditField label="Település" value={c.city} onChange={(value) => onChange?.("city", value)} />
        <EditField label="Cím" value={c.address} onChange={(value) => onChange?.("address", value)} />
        <label className="rounded-2xl bg-slate-900/80 p-4 md:col-span-2">
          <span className="text-sm text-slate-400">Telefonos jegyzet</span>
          <textarea
            className="mt-2 min-h-28 w-full bg-transparent text-base font-bold leading-relaxed outline-none"
            value={c.notes || ""}
            onChange={(event) => onChange?.("notes", event.target.value)}
            placeholder="Hívás közbeni megjegyzés..."
          />
        </label>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="Név" value={c.name} />
      <div className="rounded-2xl bg-slate-900/80 p-4">
        <p className="text-sm text-slate-400">Telefonszám</p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-lg font-black">{c.phone || "nincs megadva"}</p>
          {c.phone ? <a href={telHref(c.phone)} onClick={onExternalOpen} className="rounded-xl bg-emerald-400 px-4 py-3 text-center font-black text-slate-950">Hívás</a> : null}
        </div>
      </div>
      <Field label="Email" value={c.email || "nincs megadva"} />
      <Field label="Település" value={c.city} />
      <div className="rounded-2xl bg-slate-900/80 p-4">
        <p className="text-sm text-slate-400">Cím</p>
        <p className="mt-1 text-lg font-black">{displayAddress(c) || "nincs megadva"}</p>
        {c.address || c.city ? <a href={mapsHref(c)} target="_blank" rel="noreferrer" onClick={onExternalOpen} className="mt-3 block rounded-xl bg-cyan-300 px-4 py-3 text-center font-black text-slate-950">Útvonal tervezése</a> : null}
      </div>
      <div className="rounded-2xl bg-slate-900/80 p-4 md:col-span-2">
        <p className="text-sm text-slate-400">Telefonos jegyzet</p>
        <p className="mt-2 whitespace-pre-wrap text-base font-bold leading-relaxed text-slate-100">{c.notes || "nincs megjegyzés"}</p>
      </div>
    </div>
  );
}

function EditField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return (
    <label className="rounded-2xl bg-slate-900/80 p-4">
      <span className="text-sm text-slate-400">{label}</span>
      <input className="mt-2 w-full bg-transparent text-lg font-black outline-none" value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SignaturePad({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  function prepareCanvas(redrawValue = value) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    canvas.width = width;
    canvas.height = height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(ratio, ratio);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = "#020617";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (redrawValue) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, rect.width, rect.height);
      };
      image.src = redrawValue;
    }
  }

  useEffect(() => {
    prepareCanvas(value);
    const onResize = () => prepareCanvas(value);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [value]);

  function pointFromEvent(event: any) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function drawLine(from: { x: number; y: number }, to: { x: number; y: number }) {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  function finishSignature() {
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  }

  function clearSignature() {
    prepareCanvas("");
    onChange("");
  }

  return (
    <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-white p-3">
      <canvas
        ref={canvasRef}
        className="h-56 w-full rounded-2xl bg-white"
        style={{ touchAction: "none" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drawingRef.current = true;
          const point = pointFromEvent(event);
          lastPointRef.current = point;
          if (point) drawLine(point, { x: point.x + 0.1, y: point.y + 0.1 });
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return;
          const point = pointFromEvent(event);
          const last = lastPointRef.current;
          if (point && last) drawLine(last, point);
          lastPointRef.current = point;
        }}
        onPointerUp={finishSignature}
        onPointerCancel={finishSignature}
        onPointerLeave={() => { if (drawingRef.current) finishSignature(); }}
      />
      <button onClick={clearSignature} className="mt-3 w-full rounded-2xl bg-slate-900 px-5 py-4 font-black text-white">Aláírás törlése</button>
    </div>
  );
}


function Gradient({title,value}:{title:string;value:string;tone?:string}) {
  return (
    <section className="rounded-[2rem] bg-gradient-to-br from-cyan-300 to-blue-400 p-6 text-slate-950 shadow-2xl">
      <p className="text-sm font-black opacity-80">{title}</p>
      <h3 className="mt-2 text-3xl font-black">{value}</h3>
    </section>
  );
}

function ProductSelect({value,onChange,disabled=false}:{value:string;onChange:(v:string)=>void;disabled?:boolean}) {
  return (
    <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} className="input disabled:cursor-not-allowed disabled:opacity-60">
      {PRODUCTS.map((p:any)=>
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      )}
    </select>
  );
}


function StatusControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Card title="Státusz kezelése">
      <p className="mb-4 text-sm text-slate-400">
        A státusz automatikusan is változik a folyamat során, de itt kézzel is átállítható.
      </p>
      <div className="grid grid-cols-1 gap-2">
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            onClick={() => onChange(status)}
            className={`rounded-2xl px-4 py-3 text-left font-black transition ${
              value === status
                ? "bg-cyan-300 text-slate-950"
                : "bg-slate-900/80 text-slate-200 border border-white/10 hover:border-cyan-300/40"
            }`}
          >
            {status}
          </button>
        ))}
      </div>
    </Card>
  );
}


function Stats({
  customers,
  stockOf,
  reservedForProduct,
  onSelect,
}: {
  customers: Customer[];
  stockOf: (productId: string) => number;
  reservedForProduct: (productId: string) => number;
  onSelect?: (filter: "today" | "tomorrow" | "closing" | "stock" | "callback") => void;
}) {
  const today = todayIso();
  const tomorrow = offsetIso(1);
  const todayJobs = customers.filter(c => c.date === today).length;
  const tomorrowJobs = customers.filter(c => c.date === tomorrow).length;
  const closingJobs = customers.filter(c => c.status === "Szerelés kész – admin folyamatban").length;
  const callbackLeads = customers.filter(c => !c.date && c.status === "Visszahívandó").length;

  const climateShortages = PRODUCTS.filter((p: any) => {
    const stock = stockOf(p.id);
    const reserved = reservedForProduct(p.id);
    return reserved > stock;
  }).length;

  const s = [
    ["Mai munkák", String(todayJobs), "mai szerelés / felmérés", "bg-emerald-500", "today"],
    ["Holnapi munkák", String(tomorrowJobs), "következő nap", "bg-cyan-500", "tomorrow"],
    ["Lezárásra vár", String(closingJobs), "admin / dokumentum", "bg-purple-500", "closing"],
    ["Készlethiány", String(climateShortages), "raktár figyelmeztetés", "bg-red-500", "stock"],
    ["Visszahívandó", String(callbackLeads), "leadek", "bg-amber-500", "callback"],
  ] as const;

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {s.map(([a, b, c, color, filter]) => (
        <button
          key={a}
          onClick={() => onSelect?.(filter)}
          className="rounded-3xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-cyan-300/50 hover:bg-white/10"
        >
          <div className={`mb-4 h-11 w-11 rounded-2xl ${color}`} />
          <p className="text-slate-300">{a}</p>
          <p className="text-3xl font-black">{b}</p>
          <p className="text-xs text-slate-400">{c}</p>
        </button>
      ))}
    </section>
  );
}

