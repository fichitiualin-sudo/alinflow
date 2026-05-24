"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type View = "dashboard" | "lead" | "quote" | "quotePreview" | "schedule" | "work" | "warehouse" | "tasks" | "archive";
type CalendarMode = "week" | "month";
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
  date?: string;
  time?: string;
  quoteItems: QuoteItem[];
  productId?: string;
  isFresh?: boolean;
  stockDeducted?: boolean;
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
  { name:"6-os / 8-as / 10-es csavar", qty:"faltól függően", unit:"db", isExtra:false },
  { name:"Kondenzvízcső", qty:"szükség szerint", unit:"m", isExtra:false },
];
const MATERIAL_STOCK = [
  { name: "Alukasírozott rézcső", stock: 41, unit: "m", lowAt: 15 },
  { name: "450-es konzol", stock: 3, unit: "db", lowAt: 4 },
  { name: "550-es konzol", stock: 6, unit: "db", lowAt: 4 },
  { name: "Rezgéscsillapító", stock: 12, unit: "készlet", lowAt: 5 },
  { name: "3×1,5 gumikábel", stock: 52, unit: "m", lowAt: 20 },
  { name: "5×1,5 gumikábel", stock: 28, unit: "m", lowAt: 10 },
  { name: "160-as csavar", stock: 64, unit: "db", lowAt: 20 },
  { name: "6/8/10-es csavar", stock: 80, unit: "db", lowAt: 25 },
  { name: "Kondenzvízcső", stock: 35, unit: "m", lowAt: 15 },
];


const DEFAULT_INVENTORY: InventoryItem[] = PRODUCTS.slice(0, 10).map((product, index) => ({
  productId: product.id,
  stock: [4, 3, 5, 2, 8, 1, 2, 3, 1, 2][index] ?? 0,
}));


const BASE_SLOTS = ["08:00", "12:00", "16:00"];

function ft(n:number) { return n.toLocaleString("hu-HU") + " Ft"; }
function pad(n:number) { return String(n).padStart(2,"0"); }
function iso(d:Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
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
  const [calDate,setCalDate] = useState(new Date(2026,4,12));
  const [customers,setCustomers] = useState<Customer[]>([]);
  const [selected,setSelected] = useState<Customer>(EMPTY_CUSTOMER);
  const [quoteItems,setQuoteItems] = useState<QuoteItem[]>(EMPTY_CUSTOMER.quoteItems);
  const [scheduleDate,setScheduleDate] = useState("2026-05-13");
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
  const [editCustomer,setEditCustomer] = useState(false);
  const [workChecklist,setWorkChecklist] = useState<Record<string, boolean>>({
    worksheet: false,
    signature: false,
    purchaseDeclaration: false,
    alinInvoice: false,
    amovaInvoice: false,
    nkvh: false,
    docsSent: false,
  });

  const q = qty(quoteItems);
  const t = total(quoteItems);
  const installer = Math.min(60000*q, t);
  const materialPrice = Math.max(0, t-installer);
  const isMultiDayJob = q >= 2;
  const shownTime = isMultiDayJob ? "08:00 + 12:00" : scheduleTime;
  const activeCustomers = customers.filter((customer) => !isArchivedCustomer(customer));
  const archivedCustomers = customers.filter(isArchivedCustomer);

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
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const checklistItems = [
    { key: "worksheet", label: "Munkalap kitöltve" },
    { key: "signature", label: "Ügyfél aláírása megvan" },
    { key: "purchaseDeclaration", label: "Vásárlási nyilatkozat kész" },
    { key: "alinInvoice", label: "Adorján Alin E.V. számla kész" },
    { key: "amovaInvoice", label: "AMOVA 4U Kft. számla kész" },
    { key: "nkvh", label: "NKVH adatok rögzítve" },
    { key: "docsSent", label: "Dokumentumcsomag elküldve" },
  ];

  const missingChecklist = checklistItems.filter((item) => !workChecklist[item.key]).map((item) => item.label);
  const checklistReady = missingChecklist.length === 0;

  function openCustomer(c:Customer, v:View) {
    setSelected(c);
    setQuoteItems(c.quoteItems);
    setScheduleDate(c.date || "2026-05-13");
    setScheduleTime(c.time?.split(" ")[0] || "08:00");
    setEditCustomer(false);
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
        date: job?.scheduled_date || undefined,
        time: job?.scheduled_time || undefined,
        quoteItems: quoteItemsFromDb.length ? quoteItemsFromDb : [{ productId: PRODUCTS[0].id, quantity: 1 }],
        productId: quoteItemsFromDb[0]?.productId,
      };
    });

    setCustomers(loadedCustomers);
    setSelected(loadedCustomers[0] || EMPTY_CUSTOMER);
    setQuoteItems((loadedCustomers[0] || EMPTY_CUSTOMER).quoteItems);
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
      notes: null,
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
        notes: customer.need || null,
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
      quoteItems: [{ productId: PRODUCTS[0].id, quantity: 1 }],
    };

    setSelected(fresh);
    setQuoteItems(fresh.quoteItems);
    setScheduleDate("2026-05-13");
    setScheduleTime("08:00");
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

  function toggleChecklist(key: string) {
    setWorkChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
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
  function removeQuoteItem(i:number) { setQuoteItems(prev=>prev.length===1 ? prev : prev.filter((_,idx)=>idx!==i)); }
  async function saveSchedule() {
    const updated:Customer = {...selected, date:scheduleDate, time:shownTime, status:"Időpont foglalva", quoteItems, productId:quoteItems[0].productId, isFresh:true};
    try {
      await persistCustomerToDb(updated);
      setCustomers(prev=>prev.map(c=>c.id===updated.id ? updated : c));
      setSelected(updated);

      if (sendAppointmentNotice) {
        const sent = await sendAppointmentEmailFor(updated);
        setMessage(sent ? "Időpont mentve és tájékoztató email elküldve ✅" : "Időpont mentve, de az email küldése nem sikerült.");
      } else {
        setMessage("Időpont mentve a naptárba ✅ Email nem ment ki.");
      }

      setView("dashboard");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  async function saveWorkChanges() {
    const newQty = qty(quoteItems);
    const updatedTime = newQty >= 2 ? "08:00 + 12:00" : (selected.time || scheduleTime || "08:00");
    const updated: Customer = {
      ...selected,
      quoteItems,
      productId: quoteItems[0]?.productId || selected.productId,
      time: updatedTime,
      status: "Időpont foglalva",
      isFresh: true,
    };

    try {
      await persistCustomerToDb(updated);
      setSelected(updated);
      setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
      setMessage("Időpont klímái módosítva ✅");
      setView("dashboard");
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
      "6/8/10-es csavar": 4,
      "Kondenzvízcső": 3,
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
      setMessage("Szerelés kész ✅ Készlet levonva, admin még folyamatban.");
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
      setMessage("Munka teljesen lezárva ✅ Készlet levonva, admin ellenőrzés kész.");
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
      "6/8/10-es csavar": 4,
      "Kondenzvízcső": 3,
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

    const todayList = activeCustomers.filter(c => c.date === "2026-05-12");
    const tomorrowList = activeCustomers.filter(c => c.date === "2026-05-13");
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
            <Card title="Archív ügyfelek">
              <div className="space-y-3">
                {archivedCustomers.length === 0 ? (
                  <div className="rounded-2xl bg-white/10 p-4 font-black text-slate-300">Még nincs lezárt vagy lemondott ügyfél.</div>
                ) : null}
                {archivedCustomers.map((customer) => (
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
              </div>
            </Card>
          </Main>
          <Side>
            <Gradient title="Archív" value={`${archivedCustomers.length} ügyfél`} />
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

      setMessage("Időpont tájékoztató email elküldve ✅");
      return true;
    } catch (error: any) {
      setMessage(`Időpont email küldési hiba: ${error.message}`);
      return false;
    } finally {
      setAppointmentEmailBusy(false);
    }
  }

  if (view==="lead") return <Shell><Back onClick={()=>setView("dashboard")}/><Hero title={selected.name || "Új ügyfél"} sub={`Státusz: ${selected.status || "Visszahívandó"}`} action="Mentés" onAction={saveCustomerOnly}/><Layout><Main><Card title="Ügyféladatok szerkesztése"><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><EditField label="Név" value={selected.name} onChange={v=>updateSelectedField("name",v)}/><EditField label="Telefonszám" value={selected.phone} onChange={v=>updateSelectedField("phone",v)}/><EditField label="Email" value={selected.email} onChange={v=>updateSelectedField("email",v)}/><EditField label="Település" value={selected.city} onChange={v=>updateSelectedField("city",v)}/><EditField label="Cím" value={selected.address} onChange={v=>updateSelectedField("address",v)}/></div></Card><Card title="Telefonos jegyzet"><textarea className="input min-h-32" defaultValue=""/></Card></Main><Side><Gradient title="Aktuális státusz" value={selected.status || "Visszahívandó"}/><StatusControl value={selected.status || "Visszahívandó"} onChange={updateCustomerStatus}/><Card title="Következő lépések">
              <p className="mb-4 text-sm text-slate-400">Először mentsd az ügyfelet, majd készíts ajánlatot. Időpontot az ajánlat után adunk.</p>
              <div className="grid grid-cols-1 gap-3">
                <StepButton color="green" href={telHref(selected.phone)}>Hívás</StepButton>
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
                        <ProductSelect value={it.productId} onChange={v=>updateQuoteItem(i,"productId",v)}/>
                      )}
                      <input className="input" type="number" min={1} value={it.quantity} onChange={e=>updateQuoteItem(i,"quantity",Math.max(1,Number(e.target.value||1)))}/>
                      <input className="input" type="number" min={0} value={itemUnitPrice(it)} onChange={e=>updateQuoteItem(i,"customPrice",Math.max(0,Number(e.target.value||0)))}/>
                      <button className="rounded-xl bg-white/10 font-black" onClick={()=>removeQuoteItem(i)}>×</button>
                    </div>
                    <div className="mt-3 flex justify-between rounded-2xl bg-white/5 p-3 text-sm">
                      <span>{it.isManual ? "Egyedi tétel" : prod(it.productId).priceText}</span>
                      <b>{ft(itemTotal(it))}</b>
                    </div>
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
                    <p>{selected.address}</p>
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
                    const p = prod(item.productId);
                    return (
                      <div key={index} className="quote-item flex flex-col gap-2 rounded-2xl border border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-black">{item.quantity} db · {itemName(item)}</p>
                          <p className="text-sm text-slate-500">{item.isManual ? "Egyedi tétel" : p.priceText}</p>
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
    const booked = customers.filter(c=>c.date===scheduleDate).flatMap(c=>occupiedSlots(c));
    const free = BASE_SLOTS.filter(s=>!booked.includes(s));
    return <Shell><Back onClick={()=>setView("quote")}/><Hero title="Időpont választása" sub={`${selected.name} · ${selected.city}`} action="Időpont mentése" onAction={saveSchedule}/><Layout><Main><Calendar mode={mode} date={calDate} customers={activeCustomers} selectable selectedDate={scheduleDate} onSelect={setScheduleDate} onMode={setMode} onStep={step} onOpen={c=>openCustomer(c,"work")}/><Card title="Választható időpontok">{isMultiDayJob ? <div className="rounded-2xl bg-emerald-400/20 p-4 font-black text-emerald-100">2 vagy több klíma esetén automatikusan lefoglaljuk a 08:00 és 12:00 idősávot.</div> : <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{free.length===0 ? <div className="rounded-2xl bg-red-500/20 p-4 font-black text-red-200">Erre a napra nincs szabad idősáv.</div> : free.map(s=><button key={s} className={scheduleTime===s ? "slot-active" : "slot"} onClick={()=>setScheduleTime(s)}>{s==="16:00" ? "+1 extra" : s}</button>)}</div>}</Card></Main><Side><Gradient title="Kiválasztott időpont" value={`${scheduleDate.replaceAll("-",".")} · ${shownTime}`}/><Card title="Időpontba kerülő klímák"><p className="mb-4 text-sm leading-relaxed text-slate-400">Mentéskor kérés szerint automatikus, magázódó időpont-visszaigazoló emailt küldünk. Telefonról is ugyanígy működik.</p>{quoteItems.map((it,i)=><div key={i} className="mb-3 rounded-2xl bg-slate-900/80 p-4"><p className="font-black">{prod(it.productId).name}</p><div className="mt-3 grid grid-cols-[1fr_90px] gap-3"><ProductSelect value={it.productId} onChange={v=>updateQuoteItem(i,"productId",v)}/><input className="input" type="number" min={1} value={it.quantity} onChange={e=>updateQuoteItem(i,"quantity",Math.max(1,Number(e.target.value||1)))}/></div></div>)}<button className="mb-4 rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950" onClick={addQuoteItem}>+ Klíma hozzáadása</button><InfoRow label="Összes klíma" value={`${q} db`}/><label className="mb-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm font-bold text-slate-200"><input type="checkbox" checked={sendAppointmentNotice} onChange={e=>setSendAppointmentNotice(e.target.checked)} className="mt-1 h-5 w-5 accent-cyan-300"/><span>Tájékoztató email küldése az ügyfélnek az időpont rögzítésekor</span></label><Btn color="green" onClick={saveSchedule}>{appointmentEmailBusy ? "Mentés és email küldés..." : "Időpont mentése"}</Btn></Card></Side></Layout></Shell>;
  }

  if (view==="work") return <Shell><Back onClick={()=>setView("dashboard")}/><Hero title={`${selected.name} — Munkaoldal`} sub={`${selected.city} · ${selected.date || scheduleDate} · ${selected.time || shownTime}`} action="Teljes lezárás ellenőrzése" onAction={closeWork}/>{message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}<Layout><Main><Card title="Ügyféladatok"><div className="mb-4 flex flex-wrap gap-3">{editCustomer ? <Btn color="green" onClick={saveCustomerData}>Ügyféladatok mentése</Btn> : <Btn color="blue" onClick={()=>setEditCustomer(true)}>Ügyféladatok szerkesztése</Btn>}{editCustomer ? <button onClick={()=>setEditCustomer(false)} className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-cyan-200">Mégse</button> : null}</div><CustomerGrid c={selected} editable={editCustomer} onChange={updateSelectedField}/></Card><Card title="Időponthoz tartozó klímák">
              <p className="mb-4 text-sm text-slate-400">Itt utólag is módosítható a kiválasztott klíma és a darabszám. Ha 2 vagy több klíma kerül az időpontra, automatikusan 08:00 + 12:00 idősávra áll.</p>
              <div className="space-y-3">
                {quoteItems.map((it,i)=>
                  <div key={i} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_110px_44px] gap-3">
                      <ProductSelect value={it.productId} onChange={v=>updateQuoteItem(i,"productId",v)} />
                      <input className="input" type="number" min={1} value={it.quantity} onChange={e=>updateQuoteItem(i,"quantity",Math.max(1,Number(e.target.value||1)))} />
                      <button className="rounded-xl bg-white/10 font-black" onClick={()=>removeQuoteItem(i)}>×</button>
                    </div>
                    <div className="mt-3 flex justify-between rounded-2xl bg-white/5 p-3 text-sm">
                      <span>{it.isManual ? "Egyedi tétel" : prod(it.productId).priceText}</span>
                      <b>{ft(itemTotal(it))}</b>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-col md:flex-row gap-3">
                <button className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950" onClick={addQuoteItem}>+ Klíma hozzáadása</button>
                <button className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950" onClick={saveWorkChanges}>Módosítás mentése az időpontra</button>
              </div>
              <div className="mt-4 rounded-2xl bg-slate-950/60 p-4">
                <InfoRow label="Összesen" value={ft(total(quoteItems))} />
                <InfoRow label="Klímák száma" value={`${qty(quoteItems)} db`} />
                <InfoRow label="Idősáv logika" value={qty(quoteItems) >= 2 ? "08:00 + 12:00" : (selected.time || scheduleTime || "08:00")} />
              </div>
            </Card><Card title="Felhasznált anyagok"><div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"><p className="text-sm text-slate-400">A fix anyagok mennyisége automatikusan indul a klímák darabszáma alapján, de lezárás előtt módosítható. A módosított mennyiség azonnal lefoglaltnak számít a raktárban és a készlethiány figyelmeztetésben is.</p><button className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950" onClick={addExtraMaterial}>+ Egyéb anyag</button></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{materials.map((m,i)=><div key={i} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {m.isExtra ? <input className="input" value={m.name} onChange={e=>updateMaterial(i,"name",e.target.value)}/> : <p className="font-black">{m.name}</p>}
                      <p className="mt-1 text-xs text-slate-400">
                        {m.isExtra ? "Egyéb anyag" : `Automatikus alap ${climateCountForMaterials()} klímára · módosítható`}
                      </p>
                    </div>
                    {!m.isExtra ? <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-200">x{climateCountForMaterials()}</span> : null}
                  </div>

                  <div className="mt-4">
                    {m.name==="Konzol" ? (
                      <select className="input" value={m.qty} onChange={e=>updateMaterial(i,"qty",e.target.value)}>
                        <option>450-es konzol</option>
                        <option>550-es konzol</option>
                        <option>Egyedi konzol</option>
                      </select>
                    ) : (
                      <input
                        className="input"
                        value={finalMaterialQty(m)}
                        onChange={e=>updateFinalMaterialQty(m.name,e.target.value)}
                      />
                    )}
                  </div>

                  <div className="mt-3 rounded-2xl bg-white/5 p-3 text-sm">
                    <span className="text-slate-400">Egység / mennyiség:</span>
                    <b className="ml-2">{materialDisplayUnit(m)}</b>
                  </div>

                  {m.isExtra ? <div className="mt-3"><input className="input" value={m.unit} onChange={e=>updateMaterial(i,"unit",e.target.value)} placeholder="egység"/></div> : null}
                </div>)}</div></Card></Main><Side><Gradient title="Munka státusz" value={selected.status || "Folyamatban"}/><Card title="Lezárási ellenőrzőlista">
              <div className="space-y-3">
                {checklistItems.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => toggleChecklist(item.key)}
                    className={`w-full rounded-2xl p-4 text-left font-black transition ${workChecklist[item.key] ? "bg-emerald-400/20 text-emerald-200 border border-emerald-300/30" : "bg-slate-900/80 text-slate-200 border border-white/10"}`}
                  >
                    <span className="mr-3">{workChecklist[item.key] ? "✓" : "○"}</span>
                    {item.label}
                  </button>
                ))}
              </div>
              <div className={`mt-4 rounded-2xl p-4 font-black ${checklistReady ? "bg-emerald-400/20 text-emerald-200" : "bg-amber-400/20 text-amber-200"}`}>
                {checklistReady ? "Teljes lezárás engedélyezve ✅" : `Admin hiányos: ${missingChecklist.length} tétel`}
              </div>
            </Card>
            <Card title="Lezárási műveletek">
              <p className="mb-4 text-sm text-slate-400">Először jelöld készre a szerelést, majd az admin dokumentumok után jöhet a teljes lezárás.</p>
              <div className="space-y-3">
                <StepButton color="blue" onClick={()=>sendAppointmentEmailFor(selected)}>{appointmentEmailBusy ? "Email küldése..." : "Időpont email újraküldése"}</StepButton>
                <StepButton color="green" onClick={markInstallationDone}>Szerelés kész – admin folyamatban</StepButton>
                <StepButton color="blue" onClick={closeWork}>Teljes lezárás</StepButton>
                <button onClick={cancelAppointment} className="group flex w-full items-center justify-between gap-3 rounded-3xl bg-gradient-to-br from-red-500 to-rose-500 px-5 py-4 text-left font-black text-white shadow-xl transition hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99]">
                  <span>Időpont törlése / lemondva</span>
                  <span className="rounded-full bg-black/10 px-3 py-1 text-sm">×</span>
                </button>
              </div>
            </Card></Side></Layout></Shell>;

  return <Shell><header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div><p className="mb-3 inline-flex rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-cyan-200">AlinFlow v48 · mobil email küldés</p><h1 className="text-5xl font-black">Alin<span className="text-cyan-300">Flow</span></h1></div><div className="flex flex-wrap gap-3"><Btn onClick={startNewCustomer}>+ Új ügyfél</Btn><Btn color="green" onClick={() => setView("warehouse")}>Raktár</Btn><Btn color="blue" onClick={() => setView("archive")}>Lezárt / lemondott ({archivedCustomers.length})</Btn><button onClick={handleLogout} className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-cyan-100">Kilépés</button></div></header>{message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}<Stats customers={activeCustomers} stockOf={stockOf} reservedForProduct={reservedForProduct} onSelect={openTask}/><Layout><Main><Calendar mode={mode} date={calDate} customers={activeCustomers} onMode={setMode} onStep={step} onOpen={c=>openCustomer(c,"work")}/><Card title="Új érdeklődők"><div className="space-y-3">{activeCustomers.filter(c=>!c.date).map(c=><button key={c.id} onClick={()=>openCustomer(c,"lead")} className="w-full rounded-3xl border border-white/10 bg-slate-900/80 p-4 text-left transition hover:border-cyan-300/40"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><p className="text-lg font-black">{c.name}</p><p className="text-sm text-slate-400">{c.city} · {c.email || "nincs email"}</p><p className="mt-1 text-xs text-cyan-200/80">{climateSummary(c.quoteItems)}</p></div><span className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold">{c.status}</span></div></button>)}</div></Card></Main><Side><Card title="Raktár gyorsnézet">
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

function Calendar({ mode, date, customers, onMode, onStep, onOpen, selectable, selectedDate, onSelect }: { mode:CalendarMode; date:Date; customers:Customer[]; onMode:(m:CalendarMode)=>void; onStep:(n:number)=>void; onOpen:(c:Customer)=>void; selectable?:boolean; selectedDate?:string; onSelect?:(d:string)=>void }) {
  const start = weekStart(date);
  const days = useMemo(()=> {
    if (mode==="week") return Array.from({length:7},(_,i)=>{ const d=new Date(start); d.setDate(start.getDate()+i); return {d,current:true}; });
    const first=new Date(date.getFullYear(),date.getMonth(),1); const offset=(first.getDay()+6)%7; const last=new Date(date.getFullYear(),date.getMonth()+1,0); const total=Math.ceil((offset+last.getDate())/7)*7;
    return Array.from({length:total},(_,i)=>{ const d=new Date(date.getFullYear(),date.getMonth(),i-offset+1); return {d,current:d.getMonth()===date.getMonth()}; });
  }, [mode,date,start]);
  return <Card title={selectable ? "Válassz napot a naptárból" : mode==="week" ? "Heti naptár" : "Havi naptár"}><div className="mb-5 flex flex-col gap-4"><div className="flex justify-end gap-2"><button onClick={()=>onMode("week")} className={mode==="week"?"tab-active":"tab"}>Heti</button><button onClick={()=>onMode("month")} className={mode==="month"?"tab-active":"tab"}>Havi</button></div><div className="grid grid-cols-[44px_1fr_44px] items-center gap-3"><button onClick={()=>onStep(-1)} className="arrow">‹</button><div className="rounded-2xl bg-cyan-300 px-5 py-3 text-center font-black text-slate-950">{calLabel(mode,date)}</div><button onClick={()=>onStep(1)} className="arrow">›</button></div></div><div className="mb-2 grid grid-cols-7 gap-2 text-center text-[11px] font-black text-slate-400"><div>Hétfő</div><div>Kedd</div><div>Szerda</div><div>Csütörtök</div><div>Péntek</div><div>Szombat</div><div>Vasárnap</div></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-7">{days.map(({d,current})=>{ const dayIso=iso(d); const jobs=customers.filter(c=>c.date===dayIso); const isSel=selectable&&selectedDate===dayIso; return <div key={dayIso} onClick={()=>selectable&&onSelect?.(dayIso)} className={`min-h-[125px] rounded-3xl border p-3 ${isSel?"border-emerald-300 bg-emerald-400/20":current?"border-white/10 bg-slate-900/80":"border-white/5 bg-slate-950/40 opacity-40"} ${selectable?"cursor-pointer hover:ring-2 hover:ring-emerald-300/50":""}`}><div className="mb-2 flex items-center justify-between"><b>{d.getDate()}</b>{jobs.length===0&&current?<span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-200">üres</span>:null}</div><div className="space-y-2">{jobs.map(j=><button key={j.id} onClick={e=>{e.stopPropagation();onOpen(j)}} className={`w-full rounded-2xl p-2 text-left hover:ring-2 hover:ring-cyan-300/50 ${j.isFresh?"bg-emerald-400/30 border border-emerald-300/40":"bg-white/10"}`}><p className="text-xs font-black">{j.time}</p><p className="mt-1 truncate text-xs font-semibold">{j.name}</p><p className="truncate text-[11px] text-cyan-100/80">{climateSummary(j.quoteItems)}</p><p className="truncate text-[11px] opacity-70">{j.city}</p></button>)}</div></div>})}</div></Card>
}

function Shell({children}:{children:React.ReactNode}){return <main className="min-h-screen bg-[#08111F] p-4 text-white md:p-8"><div className="mx-auto max-w-7xl space-y-8">{children}</div></main>}
function Layout({children}:{children:React.ReactNode}){return <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">{children}</section>}
function Main({children}:{children:React.ReactNode}){return <div className="space-y-6 xl:col-span-2">{children}</div>}
function Side({children}:{children:React.ReactNode}){return <aside className="space-y-6">{children}</aside>}
function Card({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl"><h2 className="mb-5 text-2xl font-black">{title}</h2>{children}</section>}
function Hero({title,sub,action,onAction}:{title:string;sub:string;action:string;onAction?:()=>void}){return <section className="rounded-[2.5rem] border border-cyan-300/20 bg-gradient-to-br from-slate-950 to-slate-900 p-6 shadow-2xl md:p-8"><div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between"><div><h1 className="text-4xl font-black leading-tight md:text-5xl">{title}</h1><p className="mt-3 text-lg text-slate-400">{sub}</p></div><Btn onClick={onAction}>{action}</Btn></div></section>}
function Back({onClick}:{onClick:()=>void}){return <button onClick={onClick} className="rounded-2xl border border-white/10 bg-white/10 px-5 py-3 font-black text-cyan-200">← Vissza</button>}

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
}: {
  c: Customer;
  editable?: boolean;
  onChange?: (field: keyof Customer, value: string) => void;
}) {
  if (editable) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EditField label="Név" value={c.name} onChange={(value) => onChange?.("name", value)} />
        <EditField label="Telefonszám" value={c.phone} onChange={(value) => onChange?.("phone", value)} />
        <EditField label="Email" value={c.email || ""} onChange={(value) => onChange?.("email", value)} />
        <EditField label="Település" value={c.city} onChange={(value) => onChange?.("city", value)} />
        <EditField label="Cím" value={c.address} onChange={(value) => onChange?.("address", value)} />
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
          {c.phone ? <a href={telHref(c.phone)} className="rounded-xl bg-emerald-400 px-4 py-3 text-center font-black text-slate-950">Hívás</a> : null}
        </div>
      </div>
      <Field label="Email" value={c.email || "nincs megadva"} />
      <Field label="Település" value={c.city} />
      <Field label="Cím" value={c.address} />
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




function Gradient({title,value}:{title:string;value:string;tone?:string}) {
  return (
    <section className="rounded-[2rem] bg-gradient-to-br from-cyan-300 to-blue-400 p-6 text-slate-950 shadow-2xl">
      <p className="text-sm font-black opacity-80">{title}</p>
      <h3 className="mt-2 text-3xl font-black">{value}</h3>
    </section>
  );
}

function ProductSelect({value,onChange}:{value:string;onChange:(v:string)=>void}) {
  return (
    <select value={value} onChange={e=>onChange(e.target.value)} className="input">
      {PRODUCTS.map((p:any)=>
        <option key={p.id} value={p.id}>
          {p.name} — {p.priceText}
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
  const todayJobs = customers.filter(c => c.date === "2026-05-12").length;
  const tomorrowJobs = customers.filter(c => c.date === "2026-05-13").length;
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

