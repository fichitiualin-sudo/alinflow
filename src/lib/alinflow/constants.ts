import type { ClimateProduct, Customer, InventoryItem, QuoteItem, View, WorkChecklistState } from "./types";

export const RETURN_CONTEXT_KEY = "alinflow:returnContext";
export const CUSTOMER_DRAFT_KEY = "alinflow:customerDraft";
export const RESTORABLE_VIEWS: View[] = ["lead", "quote", "quotePreview", "schedule", "work", "workReport", "documentPreview"];

export const EMPTY_WORK_CHECKLIST: WorkChecklistState = {
  worksheet: false,
  signature: false,
  purchaseDeclaration: false,
  alinInvoice: false,
  amovaInvoice: false,
  nkvh: false,
  docsSent: false,
};

export const STATUS_OPTIONS = [
  "Visszahívandó",
  "Ajánlat elküldve",
  "Időpont foglalva",
  "Szerelés kész – admin folyamatban",
  "Lezárva",
  "Lemondva",
];

export const ARCHIVED_STATUSES = ["Lezárva", "Lemondva"];

export const PRODUCTS = [
  { id: "auratsu-osaka-3-4-kw-tcl", name: "Auratsu Osaka 3,4 kW (TCL)", price: 220000, priceText: "220 000 Ft (telepítéssel együtt)" },
  { id: "mdv-one-3-5-kw-by-midea", name: "MDV One 3,5 kW (by Midea)", price: 240000, priceText: "240 000 Ft (telepítéssel együtt)" },
  { id: "kinghome-by-gree-primor-3-2-kw", name: "Kinghome (by Gree) Primor 3,2 kW", price: 235000, priceText: "235 000 Ft (telepítéssel együtt)" },
  { id: "tcl-t-pro-3-5-kw", name: "TCL T-Pro 3,5 kW", price: 270000, priceText: "270 000 Ft (telepítéssel együtt)" },
  { id: "kinghome-by-gree-maximus-3-51-kw", name: "Kinghome (by Gree) Maximus 3,51 kW", price: 250000, priceText: "250 000 Ft (telepítéssel együtt)" },
  { id: "midea-xtreme-save-3-5-kw", name: "Midea Xtreme Save 3,5 kW", price: 290000, priceText: "290 000 Ft (telepítéssel együtt)" },
  { id: "syen-by-gree-muse-next-3-5-kw", name: "Syen (by Gree) Muse Next 3,5 kW", price: 275000, priceText: "275 000 Ft (telepítéssel együtt)" },
  { id: "nord-quantum-3-6-kw", name: "Nord Quantum 3,6 kW", price: 285000, priceText: "285 000 Ft (telepítéssel együtt)" },
  { id: "kaisai-ice-3-5-kw", name: "Kaisai Ice 3,5 kW", price: 280000, priceText: "280 000 Ft (telepítéssel együtt)" },
  { id: "midea-xtreme-save-pro-3-5-kw", name: "Midea Xtreme Save Pro 3,5 kW", price: 325000, priceText: "325 000 Ft (telepítéssel együtt)" },
  { id: "midea-breezeless-e-3-5-kw-huzatmentes", name: "Midea Breezeless E 3,5 kW (huzatmentes)", price: 305000, priceText: "305 000 Ft (telepítéssel együtt)" },
  { id: "fisher-comfort-plus-3-5-kw", name: "Fisher Comfort Plus 3,5 kW", price: 295000, priceText: "295 000 Ft (telepítéssel együtt)" },
  { id: "gree-comfort-pro-3-5-kw", name: "Gree Comfort Pro 3,5 kW", price: 305000, priceText: "305 000 Ft (telepítéssel együtt)" },
  { id: "fisher-art-3-52-kw-fekete", name: "Fisher Art 3,52 kW (fekete)", price: 360000, priceText: "360 000 Ft (telepítéssel együtt)" },
  { id: "midea-solstice-3-5-kw", name: "Midea Solstice 3,5 kW", price: 325000, priceText: "325 000 Ft (telepítéssel együtt)" },
  { id: "fisher-nordic-3-5-kw", name: "Fisher Nordic 3,5 kW", price: 400000, priceText: "400 000 Ft (telepítéssel együtt)" },
  { id: "midea-oasis-3-5-kw", name: "Midea Oasis 3,5 kW", price: 460000, priceText: "460 000 Ft (telepítéssel együtt)" },
] as const;

export const DEFAULT_INSTALL_PRICE = 60000;
export const EMPTY_PRODUCT: ClimateProduct = { id: "", name: "Válassz klímát", price: 0, installPrice: 0, priceText: "Nincs klíma kiválasztva", active: true };
export const EMPTY_QUOTE_ITEMS: QuoteItem[] = [];

export const INITIAL_CUSTOMERS: Customer[] = [
  { id:"c1", name:"Kovács Réka", city:"Hévízgyörk", postalCode:"2192", phone:"+36 30 123 4567", email:"reka@email.hu", address:"2192 Hévízgyörk, Minta utca 12.", source:"Facebook hirdetés", status:"Időpont foglalva", need:"Hűtés · 35 m² nappali", date:"2026-05-12", time:"08:00", quoteItems:[{ productId: PRODUCTS[6]?.id || PRODUCTS[0].id, quantity:1 }] },
  { id:"c2", name:"Kovács Béla", city:"Gödöllő", postalCode:"2100", phone:"+36 30 111 1111", email:"bela@email.hu", address:"2100 Gödöllő, Fő utca 4.", source:"Telefon", status:"Időpont foglalva", need:"Hűtés + fűtés · 42 m² nappali", date:"2026-05-11", time:"08:00", quoteItems:[{ productId: PRODUCTS[12]?.id || PRODUCTS[0].id, quantity:1 }] },
  { id:"c3", name:"Nagy István", city:"Hatvan", postalCode:"3000", phone:"+36 30 222 2222", email:"istvan@email.hu", address:"3000 Hatvan, Kossuth tér 2.", source:"Weboldal", status:"Visszahívandó", need:"Felmérés · 2 helyiség", date:"2026-05-11", time:"12:00", quoteItems:[{ productId: PRODUCTS[1]?.id || PRODUCTS[0].id, quantity:1 }] },
  { id:"l1", name:"Balogh Réka", city:"Hévízgyörk", postalCode:"2192", phone:"+36 30 222 3344", email:"balogh.reka@email.hu", address:"2192 Hévízgyörk, Dózsa György út 5.", source:"Facebook hirdetés", status:"Visszahívandó", need:"Hűtés · 35 m² nappali", quoteItems:[{ productId: PRODUCTS[6]?.id || PRODUCTS[0].id, quantity:1 }] },
  { id:"l2", name:"Molnár Gábor", city:"Kartal", postalCode:"2173", phone:"+36 30 666 6666", email:"gabor@email.hu", address:"2173 Kartal, Béke utca 9.", source:"Facebook hirdetés", status:"Ajánlat elküldve", need:"Hűtés + fűtés · 40 m² nappali", quoteItems:[{ productId: PRODUCTS[12]?.id || PRODUCTS[0].id, quantity:1 }] },
];

export const DEFAULT_MATERIALS = [
  { name:"Alukasírozott rézcső", qty:"3", unit:"m", isExtra:false },
  { name:"Konzol", qty:"450-es konzol", unit:"1 db", isExtra:false },
  { name:"Rezgéscsillapító", qty:"1", unit:"készlet", isExtra:false },
  { name:"3×1,5 gumikábel", qty:"5", unit:"m", isExtra:false },
  { name:"5×1,5 gumikábel", qty:"2,5", unit:"m", isExtra:false },
  { name:"160-as csavar", qty:"4", unit:"db", isExtra:false },
];

export const MATERIAL_STOCK = [
  { name: "Alukasírozott rézcső", stock: 41, unit: "m", lowAt: 15 },
  { name: "450-es konzol", stock: 3, unit: "db", lowAt: 4 },
  { name: "550-es konzol", stock: 6, unit: "db", lowAt: 4 },
  { name: "Rezgéscsillapító", stock: 12, unit: "készlet", lowAt: 5 },
  { name: "3×1,5 gumikábel", stock: 52, unit: "m", lowAt: 20 },
  { name: "5×1,5 gumikábel", stock: 28, unit: "m", lowAt: 10 },
  { name: "160-as csavar", stock: 64, unit: "db", lowAt: 20 },
];

export const DEFAULT_INVENTORY: InventoryItem[] = PRODUCTS.slice(0, 10).map((product, index) => ({
  productId: product.id,
  stock: [4, 3, 5, 2, 8, 1, 2, 3, 1, 2][index] ?? 0,
}));

export const BASE_SLOTS = ["08:00", "12:00", "16:00"];

export const EMPTY_CUSTOMER: Customer = {
  id: "",
  name: "",
  city: "",
  postalCode: "",
  phone: "",
  email: "",
  address: "",
  source: "Kézi rögzítés",
  status: "Visszahívandó",
  need: "",
  notes: "",
  quoteItems: EMPTY_QUOTE_ITEMS,
  quotePricingMode: "bundle",
};

export function normalizeStatus(status?: string) {
  if (status && STATUS_OPTIONS.includes(status)) return status;
  if (status === "Ajánlat készül" || status === "Időpont egyeztetés" || status === "Beszélve") return "Ajánlat elküldve";
  if (status === "Szerelés folyamatban") return "Időpont foglalva";
  return "Visszahívandó";
}

export function isArchivedCustomer(customer: Customer) {
  return ARCHIVED_STATUSES.includes(customer.status);
}
