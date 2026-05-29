"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

import type {
  CalendarMode,
  ClimateProduct,
  Customer,
  CustomerDraft,
  DocumentPreviewType,
  DocumentRecord,
  InventoryItem,
  LeadImportCandidate,
  QuoteItem,
  View,
  WorkChecklistState,
  WorkReport,
} from "@/lib/alinflow/types";
import {
  ARCHIVED_STATUSES,
  BASE_SLOTS,
  CUSTOMER_DRAFT_KEY,
  RETURN_CONTEXT_KEY,
  RESTORABLE_VIEWS,
  DEFAULT_INSTALL_PRICE,
  DEFAULT_INVENTORY,
  DEFAULT_MATERIALS,
  EMPTY_CUSTOMER,
  EMPTY_PRODUCT,
  EMPTY_QUOTE_ITEMS,
  EMPTY_WORK_CHECKLIST,
  INITIAL_CUSTOMERS,
  MATERIAL_STOCK,
  PRODUCTS,
  STATUS_OPTIONS,
  isArchivedCustomer,
  normalizeStatus,
} from "@/lib/alinflow/constants";
import {
  cleanQuoteItems,
  climateSummary,
  hasCustomProductPrice,
  isCustomQuoteItem,
  isKnownProductId,
  isQuoteItemFilled,
  itemInstallPrice,
  itemInstallTotal,
  itemName,
  itemPriceLine,
  itemTotal,
  itemUnitPrice,
  normalizeProduct,
  occupiedSlots,
  prod,
  productPriceText,
  productSlug,
  quoteInstallTotal,
  quoteItemFromRow,
  quoteItemToRow,
  qty,
  setActiveProducts,
  sortProducts,
  total,
} from "@/lib/alinflow/products";
import {
  displayAddress,
  ft,
  fullCustomerAddress,
  mapsHref,
  offsetIso,
  telHref,
  todayIso,
} from "@/lib/alinflow/format";
import { Calendar } from "@/components/alinflow/CalendarPanel";
import { WarehousePanel } from "@/components/alinflow/WarehousePanel";
import { AppointmentConfirmationDocument, PurchaseDeclarationDocument, QuoteDocument, WorkReportDocument } from "@/components/alinflow/DocumentPreviewDocuments";
import { CustomerSearchPanel, LeadImportPanel } from "@/components/alinflow/CustomerPanels";
import { DocumentActionButtons, DocumentLibraryActionButtons, documentStatusClass } from "@/components/alinflow/DocumentCards";
import { WorkReportPanel } from "@/components/alinflow/WorkReportPanel";
import { LoginScreen } from "@/components/alinflow/LoginScreen";
import { Back, Btn, Card, Field, Gradient, Hero, InfoRow, Layout, Main, Shell, Side, StepButton } from "@/components/alinflow/LayoutPrimitives";
import { Stats } from "@/components/alinflow/StatsPanel";
import { TaskPanel, type TaskFilter } from "@/components/alinflow/TaskPanel";
import { ArchivePanel } from "@/components/alinflow/ArchivePanel";
import { QuotePreviewPanel } from "@/components/alinflow/QuotePreviewPanel";
import { SchedulePanel } from "@/components/alinflow/SchedulePanel";
import {
  clearCustomerDraft,
  draftForCustomer,
  readCustomerDraft,
  readReturnContext,
  safeReturnView,
  writeCustomerDraft,
} from "@/lib/alinflow/drafts";
import {
  defaultWorkDescription,
  emptyWorkReport,
  formatSignedAt
} from "@/lib/alinflow/work-report";
import { buildLeadImportPreview } from "@/lib/alinflow/lead-import";

export default function Home() {
  const [view,setView] = useState<View>("dashboard");
  const [taskFilter,setTaskFilter] = useState<TaskFilter>("today");
  const [returnTarget,setReturnTarget] = useState<{ view: View; taskFilter?: TaskFilter } | null>(null);
  const [draftNotice,setDraftNotice] = useState<CustomerDraft | null>(null);
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
  const [products,setProducts] = useState<ClimateProduct[]>(() => sortProducts(PRODUCTS as any));
  const [productMessage,setProductMessage] = useState("");
  const [productBusy,setProductBusy] = useState(false);
  const [newProductName,setNewProductName] = useState("");
  const [newProductPrice,setNewProductPrice] = useState("");
  const [newProductInstallPrice,setNewProductInstallPrice] = useState(String(DEFAULT_INSTALL_PRICE));
  const [showClimateProductManager,setShowClimateProductManager] = useState(false);

  setActiveProducts(products);

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
  const installer = quoteInstallTotal(quoteItems);
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

  async function handleLeadCsvFile(file?: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      const preview = buildLeadImportPreview(text, customers);
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
        quoteItems: EMPTY_QUOTE_ITEMS,
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
    const draft = {
      customer: { ...selected, quoteItems: quoteItems.length ? quoteItems : selected.quoteItems || EMPTY_QUOTE_ITEMS },
      quoteItems: quoteItems.length ? quoteItems : selected.quoteItems || EMPTY_QUOTE_ITEMS,
      scheduleDate,
      scheduleTime,
      view,
      editCustomer,
      allowWorkResourceEdit,
      at: Date.now(),
    };
    writeCustomerDraft(draft);
    setDraftNotice(draft);
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
    const target = currentReturnTarget();
    if (target) setReturnTarget(target);

    const draft = draftForCustomer(c);
    const customerToOpen = draft?.customer || c;
    const itemsToOpen = draft?.quoteItems || c.quoteItems || EMPTY_QUOTE_ITEMS;

    setSelected(customerToOpen);
    setQuoteItems(itemsToOpen);
    setScheduleDate(draft?.scheduleDate || customerToOpen.date || todayIso());
    setScheduleTime(draft?.scheduleTime || customerToOpen.time?.split(" ")[0] || "08:00");
    setWorkReport(emptyWorkReport(customerToOpen));
    setWorkChecklist(effectiveChecklistFor(customerToOpen));
    setEditCustomer(draft?.editCustomer ?? false);
    setAllowWorkResourceEdit(draft?.allowWorkResourceEdit ?? false);
    setView(v);
  }

  function openTask(filter: TaskFilter) {
    setTaskFilter(filter);
    setView("tasks");
  }

  function currentReturnTarget() {
    if (view === "tasks") return { view: "tasks" as View, taskFilter };
    if (view === "dashboard" || view === "archive" || view === "documents") return { view };
    return returnTarget;
  }

  function returnToLastMenu() {
    const target = returnTarget;
    if (target?.view === "tasks" && target.taskFilter) {
      setTaskFilter(target.taskFilter);
      setView("tasks");
      return;
    }
    setView(target?.view || "dashboard");
  }

  function continueCustomerDraft() {
    const draft = readCustomerDraft();
    if (!draft) {
      setDraftNotice(null);
      return;
    }
    setSelected(draft.customer);
    setQuoteItems(draft.quoteItems.length ? draft.quoteItems : draft.customer.quoteItems || EMPTY_QUOTE_ITEMS);
    setScheduleDate(draft.scheduleDate || draft.customer.date || todayIso());
    setScheduleTime(draft.scheduleTime || draft.customer.time?.split(" ")[0] || "08:00");
    setEditCustomer(draft.editCustomer);
    setAllowWorkResourceEdit(draft.allowWorkResourceEdit);
    setView(draft.view);
  }

  function discardCustomerDraft() {
    clearCustomerDraft(draftNotice?.customer.id);
    setDraftNotice(null);
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


  function climateProductFromRow(row: any): ClimateProduct {
    return normalizeProduct({
      id: row.id,
      name: row.name,
      price: row.price,
      install_price: row.install_price,
      active: row.active,
    });
  }

  function ensureInventoryForProducts(currentInventory: InventoryItem[], productList: ClimateProduct[]) {
    const ids = new Set(currentInventory.map((item) => item.productId));
    const missing = productList
      .filter((product) => !ids.has(product.id))
      .map((product) => ({ productId: product.id, stock: 0 }));
    return missing.length ? [...currentInventory, ...missing] : currentInventory;
  }

  async function loadProductsFromDb() {
    const fallback = sortProducts(PRODUCTS as any);
    try {
      const { data, error } = await supabase
        .from("climate_products")
        .select("*")
        .eq("active", true)
        .order("name", { ascending: true });

      if (error) throw error;

      const loaded = data && data.length ? sortProducts(data.map(climateProductFromRow)) : fallback;
      setActiveProducts(loaded);
      setProducts(loaded);
      setInventory((prev) => ensureInventoryForProducts(prev, loaded));
      return loaded;
    } catch (error: any) {
      console.warn("climate_products betöltési hiba", error?.message || error);
      setActiveProducts(fallback);
      setProducts(fallback);
      setInventory((prev) => ensureInventoryForProducts(prev, fallback));
      return fallback;
    }
  }


  function climateInventoryFromRows(rows: any[] | null | undefined, productList: ClimateProduct[]) {
    const defaults = ensureInventoryForProducts(DEFAULT_INVENTORY, productList);
    const rowMap = new Map<string, number>();
    (rows || []).forEach((row: any) => {
      if (!row?.product_id) return;
      rowMap.set(String(row.product_id), Number(row.stock ?? 0) || 0);
    });

    const merged = defaults.map((item) => (
      rowMap.has(item.productId) ? { ...item, stock: rowMap.get(item.productId) ?? item.stock } : item
    ));

    (rows || []).forEach((row: any) => {
      const productId = String(row?.product_id || "");
      if (!productId || merged.some((item) => item.productId === productId)) return;
      merged.push({ productId, stock: Number(row.stock ?? 0) || 0 });
    });

    return ensureInventoryForProducts(merged, productList);
  }

  function materialInventoryFromRows(rows: any[] | null | undefined) {
    const rowMap = new Map<string, any>();
    (rows || []).forEach((row: any) => {
      if (!row?.name) return;
      rowMap.set(String(row.name), row);
    });

    const merged = MATERIAL_STOCK.map((item) => {
      const row = rowMap.get(item.name);
      if (!row) return item;
      return {
        ...item,
        stock: Number(row.stock ?? item.stock) || 0,
        unit: row.unit || item.unit,
        lowAt: Number(row.low_at ?? item.lowAt) || item.lowAt,
      };
    });

    (rows || []).forEach((row: any) => {
      const name = String(row?.name || "");
      if (!name || merged.some((item) => item.name === name)) return;
      merged.push({
        name,
        stock: Number(row.stock ?? 0) || 0,
        unit: row.unit || "db",
        lowAt: Number(row.low_at ?? 0) || 0,
      });
    });

    return merged;
  }

  async function loadInventoryFromDb(productList: ClimateProduct[]) {
    try {
      const { data, error } = await supabase.from("inventory_stock").select("*");
      if (error) throw error;
      setInventory(climateInventoryFromRows(data, productList));
    } catch (error: any) {
      console.warn("inventory_stock betöltési hiba", error?.message || error);
      setInventory((prev) => ensureInventoryForProducts(prev, productList));
    }

    try {
      const { data, error } = await supabase.from("material_inventory").select("*");
      if (error) throw error;
      if (data && data.length) setMaterialInventory(materialInventoryFromRows(data));
    } catch (error: any) {
      console.warn("material_inventory betöltési hiba", error?.message || error);
    }
  }

  async function persistClimateStock(productId: string, stock: number) {
    const { error } = await supabase.from("inventory_stock").upsert({
      product_id: productId,
      stock: Math.max(0, Number(stock || 0)),
    }, { onConflict: "product_id" });
    if (error) throw error;
  }

  async function persistMaterialStock(item: any) {
    const { error } = await supabase.from("material_inventory").upsert({
      name: item.name,
      stock: Math.max(0, Number(item.stock || 0)),
      unit: item.unit || "db",
      low_at: Number(item.lowAt ?? item.low_at ?? 0) || 0,
    }, { onConflict: "name" });
    if (error) throw error;
  }

  function productDevicePrice(product: ClimateProduct) {
    return Math.max(0, Number(product.price || 0) - Number(product.installPrice || 0));
  }

  function updateProductName(productId: string, value: string) {
    setProducts((prev) => sortProducts(prev.map((product) => {
      if (product.id !== productId) return product;
      return { ...product, name: value };
    })));
  }

  function updateProductDevicePrice(productId: string, value: string) {
    setProducts((prev) => sortProducts(prev.map((product) => {
      if (product.id !== productId) return product;
      const devicePrice = Math.max(0, Number(value || 0));
      const installPrice = Math.max(0, Number(product.installPrice || 0));
      const next: ClimateProduct = { ...product, price: devicePrice + installPrice, installPrice };
      next.priceText = productPriceText(next);
      return next;
    })));
  }

  function updateProductInstallPrice(productId: string, value: string) {
    setProducts((prev) => sortProducts(prev.map((product) => {
      if (product.id !== productId) return product;
      const devicePrice = productDevicePrice(product);
      const installPrice = Math.max(0, Number(value || 0));
      const next: ClimateProduct = { ...product, price: devicePrice + installPrice, installPrice };
      next.priceText = productPriceText(next);
      return next;
    })));
  }

  async function saveClimateProduct(product: ClimateProduct) {
    const clean = normalizeProduct(product);
    if (!clean.name.trim()) {
      setProductMessage("A klíma megnevezése nem lehet üres.");
      return;
    }
    setProductBusy(true);
    try {
      const { error } = await supabase.from("climate_products").upsert({
        id: clean.id,
        name: clean.name.trim(),
        price: clean.price,
        install_price: clean.installPrice,
        active: true,
      }, { onConflict: "id" });
      if (error) throw error;
      const nextProducts = sortProducts(products.map((item) => item.id === clean.id ? clean : item));
      setProducts(nextProducts);
      setActiveProducts(nextProducts);
      setInventory((prev) => ensureInventoryForProducts(prev, nextProducts));
      setProductMessage(`${clean.name} mentve ✅`);
    } catch (error: any) {
      setProductMessage(`Klíma mentési hiba: ${error.message}. Futtasd a CLIMATE_PRODUCTS_SQL.sql fájlt a Supabase-ben.`);
    } finally {
      setProductBusy(false);
    }
  }

  async function addClimateProduct() {
    const name = newProductName.trim();
    const devicePrice = Math.max(0, Number(newProductPrice || 0));
    const installPrice = Math.max(0, Number(newProductInstallPrice || DEFAULT_INSTALL_PRICE));
    if (!name) {
      setProductMessage("Add meg az új klíma nevét.");
      return;
    }
    if (!devicePrice) {
      setProductMessage("Add meg az új klíma készülék árát.");
      return;
    }
    const baseId = productSlug(name);
    let id = baseId;
    let counter = 2;
    while (products.some((product) => product.id === id)) {
      id = `${baseId}-${counter}`;
      counter += 1;
    }
    const product = normalizeProduct({ id, name, price: devicePrice + installPrice, installPrice, active: true });
    setProducts((prev) => sortProducts([...prev, product]));
    setInventory((prev) => ensureInventoryForProducts(prev, [product]));
    await saveClimateProduct(product);
    setNewProductName("");
    setNewProductPrice("");
    setNewProductInstallPrice(String(DEFAULT_INSTALL_PRICE));
  }

  async function loadCustomersFromDb() {
    setDataLoading(true);
    setMessage("");

    const loadedProducts = await loadProductsFromDb();
    await loadInventoryFromDb(loadedProducts);

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
        quoteItems: quoteItemsFromDb.length ? quoteItemsFromDb : EMPTY_QUOTE_ITEMS,
        productId: quoteItemsFromDb[0]?.productId,
        stockDeducted: Boolean(row.stock_deducted),
      };
    });

    const returnContext = readReturnContext();
    const customerDraft = readCustomerDraft();
    setDraftNotice(customerDraft);
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
      // Frissítés / újratöltés után ne vigyen vissza automatikusan egy belső oldalra.
      // A folyamatban lévő szerkesztés megmarad, de a kezdőlap marad a kiindulópont.
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
      stock_deducted: Boolean(customer.stockDeducted),
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
      const rowsToInsert = cleanQuoteItems(customer.quoteItems);
      if (rowsToInsert.length) {
        const { error } = await supabase.from("quote_items").insert(rowsToInsert.map((item) => quoteItemToRow(item, quoteId as string)));
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
      quoteItems: EMPTY_QUOTE_ITEMS,
    };

    setSelected(fresh);
    setQuoteItems(fresh.quoteItems);
    setScheduleDate(todayIso());
    setScheduleTime("08:00");
    setAllowWorkResourceEdit(false);
    setReturnTarget(currentReturnTarget());
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
      clearCustomerDraft(selected.id);
      setDraftNotice(readCustomerDraft());
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
      quoteItems: quoteItems.length ? quoteItems : EMPTY_QUOTE_ITEMS,
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
      clearCustomerDraft(customerToSave.id);
      setDraftNotice(readCustomerDraft());
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
      quoteItems: quoteItems.length ? quoteItems : EMPTY_QUOTE_ITEMS,
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
      setDraftNotice(readCustomerDraft());
      setView("dashboard");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }


  async function deleteCustomer(customer: Customer) {
    if (!customer?.id) return;
    const confirmed = window.confirm(`Biztosan törlöd ezt az ügyfelet / érdeklődőt?\n\n${customer.name || "Névtelen ügyfél"}\n\nEz a művelet véglegesen eltávolítja az ügyfelet és a hozzá tartozó időpontot / ajánlatot.`);
    if (!confirmed) return;

    try {
      setMessage("");

      await supabase.from("documents").delete().eq("customer_id", customer.id);
      await supabase.from("work_checklists").delete().eq("customer_id", customer.id);
      await supabase.from("work_reports").delete().eq("customer_id", customer.id);
      await supabase.from("jobs").delete().eq("customer_id", customer.id);

      const { data: quoteRows, error: quoteReadError } = await supabase
        .from("quotes")
        .select("id")
        .eq("customer_id", customer.id);
      if (quoteReadError) throw quoteReadError;

      const quoteIds = (quoteRows || []).map((quote: any) => quote.id).filter(Boolean);
      if (quoteIds.length) {
        const { error: itemDeleteError } = await supabase
          .from("quote_items")
          .delete()
          .in("quote_id", quoteIds);
        if (itemDeleteError) throw itemDeleteError;
      }

      const { error: quoteDeleteError } = await supabase
        .from("quotes")
        .delete()
        .eq("customer_id", customer.id);
      if (quoteDeleteError) throw quoteDeleteError;

      const { error: customerDeleteError } = await supabase
        .from("customers")
        .delete()
        .eq("id", customer.id);
      if (customerDeleteError) throw customerDeleteError;

      setCustomers((prev) => prev.filter((item) => item.id !== customer.id));
      setDocumentsByCustomer((prev) => {
        const next = { ...prev };
        delete next[customer.id];
        return next;
      });
      setWorkReportsByCustomer((prev) => {
        const next = { ...prev };
        delete next[customer.id];
        return next;
      });
      setWorkChecklistsByCustomer((prev) => {
        const next = { ...prev };
        delete next[customer.id];
        return next;
      });

      if (selected.id === customer.id) {
        setSelected(EMPTY_CUSTOMER);
        setQuoteItems(EMPTY_QUOTE_ITEMS);
        setView("dashboard");
      }

      clearCustomerDraft(customer.id);
      setMessage("Ügyfél törölve ✅");
    } catch (error: any) {
      setMessage(`Törlési hiba: ${error.message}`);
    }
  }
  function step(d:number) {
    const n = new Date(calDate);
    if (mode==="week") n.setDate(n.getDate()+d*7); else n.setMonth(n.getMonth()+d);
    setCalDate(n);
  }
  function addQuoteItem() { setQuoteItems(prev=>[...prev, { productId: "", quantity: 1 }]); }
  function addManualQuoteItem() { setQuoteItems(prev=>[...prev, { productId: "", customName: "", customPrice: 0, quantity: 1, isManual: true }]); }
  function updateQuoteItem(i:number, key:keyof QuoteItem, value:string|number|boolean) {
    setQuoteItems(prev=>prev.map((it,idx)=>idx===i ? {...it, [key]: value} : it));
  }
  function updateQuoteProduct(i:number, productId:string) {
    setQuoteItems(prev=>prev.map((it,idx)=>idx===i ? {
      ...it,
      productId,
      isManual: !isKnownProductId(productId),
      customName: isKnownProductId(productId) ? undefined : it.customName,
      customPrice: isKnownProductId(productId) ? prod(productId).price : (it.customPrice ?? 0),
    } : it));
  }
  function syncQuoteItemPrice(i:number) {
    setQuoteItems(prev=>prev.map((it,idx)=>idx===i ? { ...it, customPrice: prod(it.productId).price } : it));
  }
  function removeQuoteItem(i:number) { setQuoteItems(prev=>prev.length===1 ? prev : prev.filter((_,idx)=>idx!==i)); }
  async function saveSchedule() {
    const wasExistingSchedule = Boolean(selected.date);
    const scheduledQuoteItems = cleanQuoteItems(quoteItems);
    const updated:Customer = {...selected, date:scheduleDate, time:shownTime, status:"Időpont foglalva", quoteItems: scheduledQuoteItems, productId: scheduledQuoteItems[0]?.productId || undefined, isFresh:true};
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

      clearCustomerDraft(updated.id);
      setDraftNotice(readCustomerDraft());
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

    const updatedQuoteItems = cleanQuoteItems(quoteItems);
    const newQty = qty(updatedQuoteItems);
    const updatedTime = newQty >= 2 ? "08:00 + 12:00" : (selected.time || scheduleTime || "08:00");
    const updated: Customer = {
      ...selected,
      quoteItems: updatedQuoteItems,
      productId: updatedQuoteItems[0]?.productId || selected.productId,
      time: updatedTime,
      status: selected.status || "Időpont foglalva",
      isFresh: true,
    };

    try {
      await persistCustomerToDb(updated);
      setSelected(updated);
      setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
      setAllowWorkResourceEdit(false);
      clearCustomerDraft(updated.id);
      setDraftNotice(readCustomerDraft());
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
    const shortageProduct = cleanQuoteItems(quoteItems).find((q) => isKnownProductId(q.productId) && reservedForProduct(q.productId) > stockOf(q.productId));
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

  async function deductStockIfNeeded() {
    if (selected.stockDeducted) return;

    const changedInventory: InventoryItem[] = [];
    const nextInventory = inventory.map(item => {
      const used = quoteItems
        .filter(q => q.productId === item.productId)
        .reduce((sum, q) => sum + q.quantity, 0);
      if (used <= 0) return item;
      const nextItem = { ...item, stock: Math.max(0, item.stock - used) };
      changedInventory.push(nextItem);
      return nextItem;
    });

    const changedMaterials: any[] = [];
    const nextMaterials = materialInventory.map((item: any) => {
      const used = usedMaterialAmountForStock(item.name);
      if (used <= 0) return item;
      const nextItem = { ...item, stock: Math.max(0, Math.round((item.stock - used) * 10) / 10) };
      changedMaterials.push(nextItem);
      return nextItem;
    });

    setInventory(nextInventory);
    setMaterialInventory(nextMaterials);

    await Promise.all([
      ...changedInventory.map((item) => persistClimateStock(item.productId, item.stock)),
      ...changedMaterials.map((item) => persistMaterialStock(item)),
    ]);
  }

  async function markInstallationDone() {
    const error = stockErrorMessage();
    if (error) {
      setMessage(error);
      setView("dashboard");
      return;
    }

    await deductStockIfNeeded();

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

    await deductStockIfNeeded();

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

  async function addStock(productId: string, amount: number) {
    if (!amount || amount <= 0) return;
    const nextStock = stockOf(productId) + amount;
    setInventory((prev) => {
      const exists = prev.some((item) => item.productId === productId);
      if (exists) {
        return prev.map((item) => item.productId === productId ? { ...item, stock: nextStock } : item);
      }
      return [...prev, { productId, stock: nextStock }];
    });

    try {
      await persistClimateStock(productId, nextStock);
      setMessage("Klíma készlet mentve ✅");
    } catch (error: any) {
      setMessage(`Klíma készlet mentési hiba: ${error.message}. Futtasd az INVENTORY_STOCK_SQL.sql fájlt a Supabase-ben.`);
    }
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

  async function addMaterialStock(materialName: string, amount: number) {
    if (!amount || amount <= 0) return;
    const current = materialInventory.find((item: any) => item.name === materialName);
    if (!current) return;
    const nextItem = { ...current, stock: Math.round((Number(current.stock || 0) + amount) * 10) / 10 };
    setMaterialInventory((prev: any[]) => prev.map((item: any) => item.name === materialName ? nextItem : item));

    try {
      await persistMaterialStock(nextItem);
      setMessage("Anyagkészlet mentve ✅");
    } catch (error: any) {
      setMessage(`Anyagkészlet mentési hiba: ${error.message}. Futtasd az INVENTORY_STOCK_SQL.sql fájlt a Supabase-ben.`);
    }
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
    return (
      <TaskPanel
        taskFilter={taskFilter}
        customers={customers}
        products={products}
        stockOf={stockOf}
        reservedForProduct={reservedForProduct}
        customerStatusLabel={customerStatusLabel}
        customerHasSentQuote={customerHasSentQuote}
        onBack={() => setView("dashboard")}
        onOpenTask={openTask}
        onOpenCustomer={openCustomer}
        onOpenWarehouse={() => setView("warehouse")}
      />
    );
  }

  if (view === "archive") {
    return (
      <ArchivePanel
        filteredArchivedCustomers={filteredArchivedCustomers}
        visibleArchivedCustomers={visibleArchivedCustomers}
        archiveVisibleCount={archiveVisibleCount}
        hasCustomerFilter={hasCustomerFilter}
        hasMoreArchivedCustomers={hasMoreArchivedCustomers}
        searchPanel={renderCustomerSearchPanel("Archív kereső")}
        onBack={() => setView("dashboard")}
        onLoadMore={() => setArchiveVisibleCount((count) => count + 30)}
        onOpenCustomer={openCustomer}
        onRestoreCustomer={restoreArchivedCustomer}
      />
    );
  }

  if (view === "warehouse") {
    return (
      <WarehousePanel
        onBack={() => setView("dashboard")}
        products={products}
        materialInventory={materialInventory}
        showClimateProductManager={showClimateProductManager}
        onToggleClimateProductManager={() => setShowClimateProductManager((open) => !open)}
        newProductName={newProductName}
        onNewProductName={setNewProductName}
        newProductPrice={newProductPrice}
        onNewProductPrice={setNewProductPrice}
        newProductInstallPrice={newProductInstallPrice}
        onNewProductInstallPrice={setNewProductInstallPrice}
        productBusy={productBusy}
        productMessage={productMessage}
        onAddClimateProduct={addClimateProduct}
        onUpdateProductName={updateProductName}
        onUpdateProductDevicePrice={updateProductDevicePrice}
        onUpdateProductInstallPrice={updateProductInstallPrice}
        onSaveClimateProduct={saveClimateProduct}
        stockOf={stockOf}
        reservedForProduct={reservedForProduct}
        addStock={addStock}
        materialReserved={materialReserved}
        addMaterialStock={addMaterialStock}
      />
    );
  }


  function quotePayload(customer: Customer = selected, items: QuoteItem[] = quoteItems) {
    const quoteTotal = total(items);
    const quoteCount = qty(items);
    const installerAmount = quoteInstallTotal(items);
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
      clearCustomerDraft(updated.id);
      setDraftNotice(readCustomerDraft());
      setMessage("Ajánlat elküldve emailben ✅");
      returnToLastMenu();
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

  function formatQuoteSentAt(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function quoteSentAtFor(customer: Customer) {
    const doc = docFor(customer, "quote_email");
    return doc?.sentAt || doc?.createdAt || doc?.updatedAt;
  }

  function customerHasSentQuote(customer: Customer) {
    return Boolean(docFor(customer, "quote_email") || customer.status === "Ajánlat elküldve");
  }

  function customerStatusLabel(customer: Customer) {
    const status = customer.status || "nincs státusz";
    if (status !== "Ajánlat elküldve") return status;
    const sentAt = quoteSentAtFor(customer);
    return sentAt ? `${status} · ${formatQuoteSentAt(sentAt)}` : status;
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
    const quoteDoc = docFor(customer, "quote_email");
    const quoteSentAt = quoteSentAtFor(customer);
    const quoteBaseStatus = quoteDoc?.status || (customer.status === "Ajánlat elküldve" ? "Elküldve" : "Nincs elküldve");
    const quoteDisplayStatus = quoteBaseStatus.includes("Elküld") && quoteSentAt ? `${quoteBaseStatus} · ${formatQuoteSentAt(quoteSentAt)}` : quoteBaseStatus;

    return [
      { title: "Ajánlat email", status: quoteDisplayStatus, action: "Ajánlat" },
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


  function documentReportFor(customer: Customer = selected) {
    return savedReportFor(customer) || emptyWorkReport(customer);
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


  function renderCustomerSearchPanel(title = "Ügyfélkereső") {
    return (
      <CustomerSearchPanel
        title={title}
        search={customerSearch}
        statusFilter={customerStatusFilter}
        filteredCustomers={filteredCustomers}
        hasFilter={hasCustomerFilter}
        onSearchChange={setCustomerSearch}
        onStatusFilterChange={setCustomerStatusFilter}
        onClearFilter={clearCustomerFilter}
        onOpenCustomer={openCustomerFromSearch}
        customerStatusLabel={customerStatusLabel}
      />
    );
  }



  function renderLeadImportPanel() {
    return (
      <LeadImportPanel
        inputRef={leadImportInputRef}
        rows={leadImportRows}
        message={leadImportMessage}
        busy={leadImportBusy}
        onFileSelected={handleLeadCsvFile}
        onImport={importLeadRows}
      />
    );
  }



  if (view==="documentPreview") {
    const report = documentReportFor(selected);
    const isAppointmentPreview = documentPreviewType === "appointment_confirmation";
    const isQuotePreview = documentPreviewType === "quote_document";
    const title = documentPreviewType === "purchase_declaration" ? "Vásárlási nyilatkozat" : isAppointmentPreview ? "Időpont-visszaigazolás" : isQuotePreview ? "Árajánlat" : "Klímaszerelési munkalap";
    return <Shell><style>{`@media print { @page { size: A4 portrait; margin: 0; } html, body { width: 210mm !important; min-height: 297mm !important; margin: 0 !important; background: #fff !important; } body * { visibility: hidden !important; } .print-document-area, .print-document-area * { visibility: visible !important; } .print-document-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 210mm !important; background: #fff !important; } .doc-print-page { box-sizing: border-box !important; width: 210mm !important; max-width: 210mm !important; min-height: 297mm !important; height: 297mm !important; margin: 0 !important; box-shadow: none !important; border: 0 !important; border-radius: 0 !important; overflow: hidden !important; page-break-after: always !important; break-after: page !important; } .work-report-doc { padding: 14mm !important; font-size: 11.5px !important; line-height: 1.2 !important; } .purchase-doc { padding: 12mm !important; font-size: 10px !important; line-height: 1.18 !important; } .doc-print-page * { box-sizing: border-box !important; } .doc-print-page:last-child { page-break-after: auto !important; break-after: auto !important; } }`}</style><Back onClick={()=>setView(documentBackView)}/><div className="print:hidden"><Hero title={title} sub={`${selected.name || "Ügyfél"} · ${fullCustomerAddress(selected)}`} action="Nyomtatás" onAction={()=>window.print()}/>{message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}{documentBackView === "documents" || isAppointmentPreview || isQuotePreview ? <div className="mb-5"><button onClick={()=>window.print()} className="w-full rounded-2xl bg-white/10 px-5 py-4 font-black text-white sm:w-auto">Nyomtatás / mentés PDF-be</button></div> : <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2"><button onClick={()=>openWorkReportFor(selected)} className="rounded-2xl bg-emerald-400/20 px-5 py-4 font-black text-emerald-100">Munkalap szerkesztése / aláírás</button><button onClick={()=>saveWorkReport(true)} className="rounded-2xl bg-blue-400/20 px-5 py-4 font-black text-blue-100">Mentés és email küldése</button></div>}{!isAppointmentPreview && !isQuotePreview && !report.id && !report.signatureDataUrl ? <div className="mb-5 rounded-2xl border border-amber-300/30 bg-amber-400/20 p-4 text-sm font-bold text-amber-100">Ehhez az ügyfélhez még nincs mentett munkalap vagy aláírás. A dokumentum előnézete az ügyféladatokból készül, de hivatalosan előbb érdemes aláíratni és menteni.</div> : null}</div><div className="print-document-area print:bg-white">{documentPreviewType === "purchase_declaration" ? <PurchaseDeclarationDocument customer={selected} report={report} quoteItems={quoteItems}/> : isAppointmentPreview ? <AppointmentConfirmationDocument customer={selected} quoteItems={quoteItems}/> : isQuotePreview ? <QuoteDocument customer={selected} quoteItems={quoteItems}/> : <WorkReportDocument customer={selected} report={report} quoteItems={quoteItems}/>}</div></Shell>;
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
                {documentCustomers.map((customer)=><div key={customer.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4"><div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><p className="text-xl font-black">{customer.name || "Névtelen ügyfél"}</p><p className="mt-1 text-sm text-slate-400">{fullCustomerAddress(customer)}{customer.date ? ` · ${customer.date.replaceAll("-", ".")} ${customer.time || ""}` : ""}</p><p className="mt-1 text-xs font-bold text-cyan-200/80">{climateSummary(customer.quoteItems)}</p></div><button onClick={()=>openCustomer(customer,"work")} className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">Ügyfél megnyitása</button></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2">{documentRowsFor(customer).map((row)=><div key={row.title} className="rounded-2xl bg-white/5 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{row.title}</p></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${documentStatusClass(row.status)}`}>{row.status}</span></div><DocumentLibraryActionButtons customer={customer} row={row} ready={documentIsReady(customer, row)} onPreview={openDocumentPreview}/></div>)}</div></div>)}
              </div>
            </Card>
          </Main>
          <Side><Gradient title="Dokumentum állapot" value={`${documentCustomers.length} ügyfél`}/>{renderCustomerSearchPanel("Gyors kereső")}</Side>
        </Layout>
      </Shell>
    );
  }

  if (view==="lead") return <Shell><Back onClick={()=>setView("dashboard")}/><Hero title={selected.name || "Új ügyfél"} sub={`Státusz: ${selected.status || "Visszahívandó"}`} action="Mentés" onAction={saveCustomerOnly}/><Layout><Main><Card title="Ügyféladatok szerkesztése">{selected.phone ? <a href={telHref(selected.phone)} onClick={()=>rememberExternalCustomer(selected,"lead")} className="mb-4 block rounded-2xl bg-emerald-400 px-5 py-4 text-center font-black text-slate-950">Hívás</a> : null}<div className="grid grid-cols-1 gap-4 md:grid-cols-2"><EditField label="Név" value={selected.name} onChange={v=>updateSelectedField("name",v)}/><EditField label="Telefonszám" value={selected.phone} onChange={v=>updateSelectedField("phone",v)}/><EditField label="Email" value={selected.email} onChange={v=>updateSelectedField("email",v)}/><EditField label="Település" value={selected.city} onChange={v=>updateSelectedField("city",v)}/><EditField label="Cím" value={selected.address} onChange={v=>updateSelectedField("address",v)}/></div>{selected.address || selected.city ? <a href={mapsHref(selected)} target="_blank" rel="noreferrer" onClick={()=>rememberExternalCustomer(selected,"lead")} className="mt-4 block rounded-2xl bg-cyan-300 px-5 py-4 text-center font-black text-slate-950">Útvonal tervezése Google Térképpel</a> : null}</Card><Card title="Telefonos jegyzet"><textarea className="input min-h-32" value={selected.notes || ""} onChange={e=>updateSelectedField("notes", e.target.value)} placeholder="Például: mikor hívjam vissza, mit kért, fontos tudnivalók..."/></Card></Main><Side><Gradient title="Aktuális státusz" value={selected.status || "Visszahívandó"}/><StatusControl value={selected.status || "Visszahívandó"} onChange={updateCustomerStatus}/><Card title="Következő lépések">
              <div className="grid grid-cols-1 gap-3">
                <StepButton color="green" href={telHref(selected.phone)} onClick={()=>rememberExternalCustomer(selected,"lead")}>Hívás</StepButton>
                <StepButton color="amber" onClick={saveCustomerOnly}>Mentés</StepButton>
                <StepButton color="blue" onClick={()=>saveCustomer("quote")}>Mentés és ajánlat</StepButton>
                {selected.id && customers.some((customer) => customer.id === selected.id) ? (
                  <StepButton color="red" onClick={()=>deleteCustomer(selected)}>Ügyfél törlése</StepButton>
                ) : null}
              </div>
            </Card></Side></Layout></Shell>;

  if (view==="quote") return <Shell><Back onClick={()=>setView("dashboard")}/><Hero title="Klíma ajánlat összeállítása" sub={`${selected.name} · ${selected.city}`} action="Ajánlat előnézet" onAction={()=>setView("quotePreview")}/><Layout><Main><Card title="Ajánlatban szereplő tételek">
              <p className="mb-4 text-sm text-slate-400">Az ár automatikusan jön a klímából, de kézzel módosítható. Külön egyedi tételt is hozzáadhatsz.</p>
              <div className="space-y-3">
                {quoteItems.map((it,i)=>
                  <div key={i} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_150px_44px]">
                      {isCustomQuoteItem(it) ? (
                        <input className="input" value={it.customName || ""} onChange={e=>updateQuoteItem(i,"customName",e.target.value)} placeholder="Klíma/tétel megnevezése" />
                      ) : (
                        <ProductSelect products={products} value={it.productId} onChange={v=>updateQuoteProduct(i,v)}/>
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
      <QuotePreviewPanel
        selected={selected}
        quoteItems={quoteItems}
        totalAmount={t}
        installerAmount={installer}
        materialAmount={materialPrice}
        quoteEmailBusy={quoteEmailBusy}
        onBack={() => setView("quote")}
        onPrint={() => window.print()}
        onSendQuote={sendQuoteEmail}
        onSchedule={() => setView("schedule")}
      />
    );
  }

  if (view==="schedule") {
    const booked = customers.filter(c=>c.id!==selected.id && c.date===scheduleDate).flatMap(c=>occupiedSlots(c));
    const free = BASE_SLOTS.filter(s=>!booked.includes(s));
    const isExistingSchedule = Boolean(selected.date);
    return (
      <SchedulePanel
        selected={selected}
        isExistingSchedule={isExistingSchedule}
        mode={mode}
        calDate={calDate}
        calendarCustomers={calendarCustomers}
        scheduleDate={scheduleDate}
        scheduleTime={scheduleTime}
        shownTime={shownTime}
        isMultiDayJob={isMultiDayJob}
        freeSlots={free}
        quoteItems={quoteItems}
        products={products}
        totalQuantity={q}
        sendAppointmentNotice={sendAppointmentNotice}
        appointmentEmailBusy={appointmentEmailBusy}
        onBack={()=>setView(isExistingSchedule ? "work" : "quote")}
        onSaveSchedule={saveSchedule}
        onSelectDate={setScheduleDate}
        onMode={setMode}
        onStep={step}
        onOpenCustomer={(customer)=>openCustomer(customer,"work")}
        onSetScheduleTime={setScheduleTime}
        onUpdateQuoteItem={updateQuoteItem}
        onUpdateQuoteProduct={updateQuoteProduct}
        onAddQuoteItem={addQuoteItem}
        onSetSendAppointmentNotice={setSendAppointmentNotice}
      />
    );
  }

  if (view==="workReport") return (
    <WorkReportPanel
      selected={selected}
      quoteItems={quoteItems}
      scheduleDate={scheduleDate}
      shownTime={shownTime}
      workReport={workReport}
      workReportBusy={workReportBusy}
      workReportEmailBusy={workReportEmailBusy}
      message={message}
      onBack={()=>setView("work")}
      onSave={(sendEmail)=>saveWorkReport(sendEmail)}
      onUpdateWorkReportField={updateWorkReportField}
      onSignatureChange={(value)=>setWorkReport((prev)=>({ ...prev, signatureDataUrl: value, signedAt: value ? new Date().toISOString() : undefined }))}
    />
  );

  if (view==="work") return <Shell><Back onClick={()=>setView("dashboard")}/><Hero title={`${selected.name} — Munkaoldal`} sub={`${selected.city} · ${selected.date || scheduleDate} · ${selected.time || shownTime}`} action="Teljes lezárás ellenőrzése" onAction={closeWork}/>{message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}<Layout><Main><Card title="Ügyféladatok"><div className="mb-4 flex flex-wrap gap-3">{selected.phone ? <a href={telHref(selected.phone)} onClick={()=>rememberExternalCustomer(selected,"work")} className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950">Hívás</a> : null}{editCustomer ? <Btn color="green" onClick={saveCustomerData}>Ügyféladatok mentése</Btn> : <Btn color="blue" onClick={()=>setEditCustomer(true)}>Ügyféladatok szerkesztése</Btn>}{editCustomer ? <button onClick={()=>setEditCustomer(false)} className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-cyan-200">Mégse</button> : null}</div><CustomerGrid c={selected} editable={editCustomer} onChange={updateSelectedField} onExternalOpen={()=>rememberExternalCustomer(selected,"work")}/>{selected.date ? <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Időpont</p><p className="text-base font-black text-slate-100">{selected.date.replaceAll("-", ".")} · {selected.time || shownTime}</p></div><button type="button" onClick={()=>{setScheduleDate(selected.date || todayIso()); setScheduleTime(selected.time?.split(" ")[0] || "08:00"); setView("schedule");}} className="shrink-0 rounded-2xl bg-cyan-300/15 px-4 py-3 text-sm font-black text-cyan-100 ring-1 ring-cyan-200/20">Időpont módosítása</button></div></div> : null}</Card><Card title="Időponthoz tartozó klímák">
              {workResourceEditLocked && !allowWorkResourceEdit ? <div className="mb-4 rounded-2xl border border-amber-300/30 bg-amber-400/15 p-4 text-sm font-bold text-amber-100">A szerelés készre jelölése után a klímák és a szerelési anyagok zárolva vannak. Szerkesztéshez nyomd meg a Módosítás engedélyezése gombot.</div> : null}
              <div className="space-y-3">
                {quoteItems.map((it,i)=>
                  <div key={i} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_110px_44px] gap-3">
                      {isCustomQuoteItem(it) ? <input className="input disabled:cursor-not-allowed disabled:opacity-60" disabled={!canEditWorkResources} value={it.customName || ""} onChange={e=>updateQuoteItem(i,"customName",e.target.value)} placeholder="Klíma megnevezése" /> : <ProductSelect products={products} value={it.productId} onChange={v=>updateQuoteProduct(i,v)} disabled={!canEditWorkResources} />}
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
                </div>)}</div></Card></Main><Side><Gradient title="Munka státusz" value={selected.status || "Folyamatban"}/><Card title="Dokumentumok"><div className="space-y-3">{documentRowsFor(selected).map((row)=><div key={row.title} className="rounded-2xl border border-white/10 bg-slate-900/80 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{row.title}</p></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${documentStatusClass(row.status)}`}>{row.status}</span></div><DocumentActionButtons customer={selected} row={row} onPreview={openDocumentPreview} onEditWorkReport={openWorkReportFor} onSendQuote={sendQuoteEmail} onSendAppointment={sendAppointmentEmailFor} quoteEmailBusy={quoteEmailBusy} appointmentEmailBusy={appointmentEmailBusy}/></div>)}</div></Card><Card title="Lezárási műveletek">
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

  return <Shell><header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div><p className="mb-3 inline-flex rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-cyan-200">AlinFlow v65 · klímatípus kezelés</p><h1 className="text-5xl font-black">Alin<span className="text-cyan-300">Flow</span></h1></div><div className="flex flex-wrap gap-3"><Btn onClick={startNewCustomer}>+ Új ügyfél</Btn><Btn color="blue" onClick={() => setView("documents")}>Dokumentumok</Btn><Btn color="green" onClick={() => setView("warehouse")}>Raktár / klímák</Btn><Btn color="blue" onClick={() => setView("archive")}>Lezárt / lemondott ({archivedCustomers.length})</Btn><button onClick={handleLogout} className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-cyan-100">Kilépés</button></div></header>{message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}<Stats products={products} customers={activeCustomers} sentQuoteCount={activeCustomers.filter(customerHasSentQuote).length} stockOf={stockOf} reservedForProduct={reservedForProduct} onSelect={openTask}/><Layout><Main><Calendar mode={mode} date={calDate} customers={calendarCustomers} onMode={setMode} onStep={step} onOpen={c=>openCustomer(c,"work")}/><Card title="Új érdeklődők"><div className="space-y-3">{filteredActiveCustomers.filter(c=>!c.date).map(c=><div key={c.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 transition hover:border-cyan-300/40"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><button type="button" onClick={()=>openCustomer(c,"lead")} className="min-w-0 flex-1 text-left"><p className="text-lg font-black">{c.name}</p><p className="text-sm text-slate-400">{c.city} · {c.email || "nincs email"}</p><p className="mt-1 text-xs text-cyan-200/80">{climateSummary(c.quoteItems)}</p></button><div className="flex flex-wrap items-center gap-2 md:justify-end"><span className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold">{customerStatusLabel(c)}</span></div></div></div>)}</div></Card></Main><Side>{draftNotice ? <Card title="Folyamatban lévő szerkesztés"><div className="space-y-3"><p className="text-sm font-bold text-slate-300">Van egy helyben megőrzött, még nem biztosan mentett szerkesztés.</p><div className="rounded-2xl bg-slate-950/60 p-3"><p className="font-black text-slate-100">{draftNotice.customer.name || "Névtelen ügyfél"}</p><p className="text-sm text-slate-400">{draftNotice.customer.phone || draftNotice.customer.email || draftNotice.customer.city || "nincs adat"}</p></div><div className="grid grid-cols-1 gap-2"><button onClick={continueCustomerDraft} className="rounded-2xl bg-cyan-300 px-4 py-3 font-black text-slate-950">Szerkesztés folytatása</button><button onClick={discardCustomerDraft} className="rounded-2xl bg-white/10 px-4 py-3 font-black text-slate-200">Helyi piszkozat elvetése</button></div></div></Card> : null}{renderCustomerSearchPanel()}{renderLeadImportPanel()}<Card title="Raktár gyorsnézet">
            <div className="space-y-3">
              {products.map((product: any) => {
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


function ProductSelect({products,value,onChange,disabled=false}:{products:ClimateProduct[];value:string;onChange:(v:string)=>void;disabled?:boolean}) {
  const sorted = sortProducts(products);
  const selectValue = sorted.some((product) => product.id === value) ? value : "";
  return (
    <select value={selectValue} onChange={e=>onChange(e.target.value)} disabled={disabled} className="input disabled:cursor-not-allowed disabled:opacity-60">
      <option value="">Válassz klímát...</option>
      {sorted.map((p:any)=>
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


