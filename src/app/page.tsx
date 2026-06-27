"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

import type {
  AppointmentType,
  CalendarMode,
  ClimateProduct,
  Customer,
  CustomerDraft,
  CustomerTimelineItem,
  DocumentPreviewType,
  DocumentRecord,
  InventoryItem,
  LeadImportCandidate,
  PurchaseDeclaration,
  QuoteItem,
  QuotePricingMode,
  SellerCompany,
  View,
  WorkChecklistCompletedAt,
  WorkChecklistItemKey,
  WorkChecklistState,
  WorkReport,
} from "@/lib/alinflow/types";
import {
  ARCHIVED_STATUSES,
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
  itemQuantity,
  itemTotal,
  itemUnitPrice,
  normalizeProduct,
  prod,
  productPriceText,
  productSlug,
  quoteInstallTotal,
  quoteItemFromRow,
  quotePricingModeFromNotes,
  quotePricingModeToNotes,
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
  todayIso,
} from "@/lib/alinflow/format";
import {
  appointmentBookedDocumentType,
  appointmentEmailDocumentType,
  documentFromRow,
  documentTimestamp,
  maintenanceCancellationDocumentType,
  reportDocumentType,
  statusMeansSent,
} from "@/lib/alinflow/documents";
import {
  LIST_PAGE_SIZE,
  formatCustomerCreatedAt,
  paginateItems,
  postalCodeFromCustomerData,
  sortCustomersByCreatedAtDesc,
} from "@/lib/alinflow/customers";
import {
  appointmentTimeAvailable,
  availableAppointmentSlots,
  sortCustomersBySchedule,
} from "@/lib/alinflow/schedule";
import { Calendar } from "@/components/alinflow/CalendarPanel";
import { WarehousePanel } from "@/components/alinflow/WarehousePanel";
import { AllWorkReportsDocument, AppointmentConfirmationDocument, PurchaseDeclarationDocument, QuoteDocument, WorkReportDocument } from "@/components/alinflow/DocumentPreviewDocuments";
import { CustomerSearchPanel, LeadImportPanel } from "@/components/alinflow/CustomerPanels";
import { DocumentActionButtons, DocumentLibraryActionButtons, documentStatusClass } from "@/components/alinflow/DocumentCards";
import { WorkReportPanel } from "@/components/alinflow/WorkReportPanel";
import { LeadPanel } from "@/components/alinflow/LeadPanel";
import { QuoteBuilderPanel } from "@/components/alinflow/QuoteBuilderPanel";
import { WorkPagePanel } from "@/components/alinflow/WorkPagePanel";
import { LoginScreen } from "@/components/alinflow/LoginScreen";
import { Back, Btn, Card, Field, Gradient, InfoRow, Layout, Main, Shell, Side, StepButton, ThemeToggle } from "@/components/alinflow/LayoutPrimitives";
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
  formatSignedAt,
  hasValidWorkReportSignature,
  sameReportAppointment,
  sortWorkReportsByDateDesc,
  workReportFromRow,
  workReportKeyFromReport,
  workReportMapKey,
  workReportSignatureState,
  workReportTitle,
} from "@/lib/alinflow/work-report";
import { buildLeadImportPreview } from "@/lib/alinflow/lead-import";
import { appointmentDocumentTitle, appointmentSlotOptions, appointmentSummaryLabel, appointmentTimeRangeLabel, appointmentTypeLabel, firstAppointmentTime, isInstallationAppointment, normalizeAppointmentTimeInput, normalizeAppointmentType } from "@/lib/alinflow/appointments";
import { appointmentsByCustomer, compatibleAppointmentRows, currentAppointmentsByCustomer, isMissingAppointmentsTableError } from "@/lib/alinflow/appointment-records";
import { billingKindLabel, billingPaymentMethodLabel, billingUiConfig, type BillingInvoiceKind, type BillingPaymentMethod } from "@/lib/alinflow/billing";
import { normalizePostalCodeInput, uniqueSettlementByPostalCode } from "@/lib/alinflow/postal-codes";
import {
  DEFAULT_SELLER_COMPANY,
  declarationFromRow,
  declarationToRow,
  sellerCompanyFromRow,
  sellerCompanyToRow,
  sellerSnapshot,
} from "@/lib/alinflow/purchase-declarations";

const DASHBOARD_WAREHOUSE_LIMIT = 10;

type PageDocumentRow = {
  action: string;
  title: string;
  status: string;
  appointmentType?: AppointmentType;
  reportId?: string;
  purchaseDeclarationId?: string;
  reportDate?: string;
  reportTime?: string;
  reportDateLabel?: string;
};

type WorkActionDates = {
  appointmentEmail?: string;
  workReport?: string;
  workDone?: string;
  surveyDone?: string;
  maintenanceDone?: string;
  fullClose?: string;
  cancelled?: string;
};

type StockDeductionSnapshot = {
  inventoryBefore: InventoryItem[];
  materialInventoryBefore: any[];
};

type QuickAppointmentCustomerMode = "new" | "existing";

type QuickAppointmentDraft = {
  date: string;
  time: string;
  appointmentType?: AppointmentType;
  customerMode?: QuickAppointmentCustomerMode;
  search: string;
  selectedCustomerId?: string;
  name: string;
  phone: string;
  email: string;
  postalCode: string;
  city: string;
  address: string;
  notes: string;
  productId: string;
  quantity: number | "";
  price: number | "";
  maintenanceInstallationIds: string[];
};

function customerInquiryLabel(customer: Customer) {
  const created = formatCustomerCreatedAt(customer.createdAt);
  return created ? `Érdeklődött: ${created}` : "";
}

function isMissingPostalCodeColumnError(error: any) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`.toLocaleLowerCase("hu-HU");
  return text.includes("postal_code") && (text.includes("column") || text.includes("schema") || text.includes("cache") || text.includes("could not find"));
}

function isMissingChecklistCompletedAtColumnError(error: any) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`.toLocaleLowerCase("hu-HU");
  return text.includes("completed_at") && (text.includes("column") || text.includes("schema") || text.includes("cache") || text.includes("could not find"));
}

function isMissingSellerTableError(error: any) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`.toLocaleLowerCase("hu-HU");
  return (text.includes("seller_companies") || text.includes("purchase_declarations")) && (text.includes("relation") || text.includes("schema") || text.includes("cache") || text.includes("could not find"));
}

function withoutPostalCode<T extends Record<string, any>>(row: T) {
  const { postal_code, ...rest } = row;
  return rest;
}

function timeValue(value?: string) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function differentEnough(a?: string, b?: string) {
  const first = timeValue(a);
  const second = timeValue(b);
  if (!first || !second) return Boolean(a || b);
  return Math.abs(first - second) > 60_000;
}

function appointmentSummary(customer: Customer) {
  if (!customer.date) return "";
  return `${customer.date.replaceAll("-", ".")} · ${customer.time || "idő nélkül"}`;
}

function customerTimelineItems(customer: Customer): CustomerTimelineItem[] {
  const inquiredAt = customer.createdAt || customer.timeline?.inquiredAt;
  const calledAt = customer.lastCalledAt || customer.timeline?.calledAt;
  const quoteSentAt = customer.quoteSentAt || customer.timeline?.quoteSentAt;
  const appointmentRecordedAt =
    customer.appointmentUpdatedAt ||
    customer.timeline?.appointmentUpdatedAt ||
    customer.appointmentBookedAt ||
    customer.timeline?.appointmentBookedAt;
  const updatedAtCandidate = customer.updatedAt || customer.timeline?.updatedAt;
  const activityTimes = [calledAt, quoteSentAt, appointmentRecordedAt].filter(Boolean) as string[];
  const hasSeparateUpdate =
    Boolean(updatedAtCandidate) &&
    differentEnough(updatedAtCandidate, inquiredAt) &&
    activityTimes.every((time) => differentEnough(updatedAtCandidate, time));
  const appointment = customer.date ? appointmentSummaryLabel(customer) : "";
  const appointmentLabel = customer.appointmentType ? `${appointmentTypeLabel(customer.appointmentType)} időpont` : "Időpont rögzítve";

  return [
    { label: "Érdeklődött", value: inquiredAt, tone: inquiredAt ? "emerald" : "slate", muted: !inquiredAt },
    { label: "Hívva", value: calledAt, tone: calledAt ? "cyan" : "slate", muted: !calledAt },
    { label: "Ajánlat küldve", value: quoteSentAt, tone: quoteSentAt ? "blue" : "slate", muted: !quoteSentAt },
    {
      label: appointmentLabel,
      value: appointmentRecordedAt,
      hint: appointment || undefined,
      tone: appointmentRecordedAt || appointment ? "amber" : "slate",
      muted: !appointmentRecordedAt && !appointment,
    },
    { label: "Utolsó módosítás", value: hasSeparateUpdate ? updatedAtCandidate : undefined, tone: hasSeparateUpdate ? "violet" : "slate", muted: !hasSeparateUpdate },
  ];
}

function PaginationControls({
  currentPage,
  pageCount,
  totalCount,
  label = "elem",
  onPageChange,
}: {
  currentPage: number;
  pageCount: number;
  totalCount: number;
  label?: string;
  onPageChange: (page: number) => void;
}) {
  if (totalCount <= LIST_PAGE_SIZE) return null;

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm font-bold text-slate-300 sm:flex-row sm:items-center sm:justify-between">
      <span>{currentPage}. oldal / {pageCount} · maximum {LIST_PAGE_SIZE} {label} oldalanként</span>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="rounded-xl bg-white/10 px-4 py-2 font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Előző
        </button>
        <button
          type="button"
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
          className="rounded-xl bg-cyan-300 px-4 py-2 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Következő
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [view,setView] = useState<View>("dashboard");
  const [taskFilter,setTaskFilter] = useState<TaskFilter>("today");
  const [returnTarget,setReturnTarget] = useState<{ view: View; taskFilter?: TaskFilter } | null>(null);
  const [draftNotice,setDraftNotice] = useState<CustomerDraft | null>(null);
  const [mode,setMode] = useState<CalendarMode>("week");
  const [calDate,setCalDate] = useState(() => new Date());
  const [customers,setCustomers] = useState<Customer[]>([]);
  const [workHistoryByCustomer,setWorkHistoryByCustomer] = useState<Record<string, Customer[]>>({});
  const [customerSearch,setCustomerSearch] = useState("");
  const [customerStatusFilter,setCustomerStatusFilter] = useState("all");
  const [leadPage,setLeadPage] = useState(1);
  const [archivePage,setArchivePage] = useState(1);
  const [documentPage,setDocumentPage] = useState(1);
  const [selected,setSelected] = useState<Customer>(EMPTY_CUSTOMER);
  const [quoteItems,setQuoteItems] = useState<QuoteItem[]>(EMPTY_CUSTOMER.quoteItems);
  const [scheduleDate,setScheduleDate] = useState(() => todayIso());
  const [scheduleTime,setScheduleTime] = useState("08:00");
  const [scheduleAppointmentType,setScheduleAppointmentType] = useState<AppointmentType>("installation");
  const [quickAppointment,setQuickAppointment] = useState<QuickAppointmentDraft | null>(null);
  const [quickAppointmentEmailPrompt,setQuickAppointmentEmailPrompt] = useState<Customer | null>(null);
  const [materials,setMaterials] = useState(DEFAULT_MATERIALS);
  const [materialOverrides,setMaterialOverrides] = useState<Record<string,string>>({});
  const [inventory,setInventory] = useState<InventoryItem[]>(DEFAULT_INVENTORY);
  const [materialInventory,setMaterialInventory] = useState(MATERIAL_STOCK);
  const [message,setMessage] = useState("");
  const [user,setUser] = useState<User | null>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [dataLoading,setDataLoading] = useState(false);
  const [initialDataReady,setInitialDataReady] = useState(false);
  const [loginEmail,setLoginEmail] = useState("");
  const [loginPassword,setLoginPassword] = useState("");
  const [loginBusy,setLoginBusy] = useState(false);
  const [loginMessage,setLoginMessage] = useState("");
  const [quoteEmailBusy,setQuoteEmailBusy] = useState(false);
  const [appointmentEmailBusy,setAppointmentEmailBusy] = useState(false);
  const [thankYouEmailBusy,setThankYouEmailBusy] = useState(false);
  const [invoiceBusy,setInvoiceBusy] = useState<BillingInvoiceKind | null>(null);
  const [sendAppointmentNotice,setSendAppointmentNotice] = useState(true);
  const [workReport,setWorkReport] = useState<WorkReport>(emptyWorkReport());
  const [workReportsByCustomer,setWorkReportsByCustomer] = useState<Record<string, WorkReport>>({});
  const [maintenanceReportsByCustomer,setMaintenanceReportsByCustomer] = useState<Record<string, WorkReport[]>>({});
  const [documentsByCustomer,setDocumentsByCustomer] = useState<Record<string, DocumentRecord[]>>({});
  const [sellerCompanies,setSellerCompanies] = useState<SellerCompany[]>([DEFAULT_SELLER_COMPANY]);
  const [purchaseDeclarationsByCustomer,setPurchaseDeclarationsByCustomer] = useState<Record<string, PurchaseDeclaration[]>>({});
  const [selectedSellerId,setSelectedSellerId] = useState(DEFAULT_SELLER_COMPANY.id);
  const [newSellerName,setNewSellerName] = useState("");
  const [newSellerTaxNumber,setNewSellerTaxNumber] = useState("");
  const [newSellerRepresentative,setNewSellerRepresentative] = useState("");
  const [purchaseDeclarationItemKeys,setPurchaseDeclarationItemKeys] = useState<string[]>([]);
  const [workChecklistsByCustomer,setWorkChecklistsByCustomer] = useState<Record<string, WorkChecklistState>>({});
  const [detailDataLoadedByCustomer,setDetailDataLoadedByCustomer] = useState<Record<string, boolean>>({});
  const [detailDataLoadingByCustomer,setDetailDataLoadingByCustomer] = useState<Record<string, boolean>>({});
  const [documentPreviewType,setDocumentPreviewType] = useState<DocumentPreviewType>("work_report");
  const [documentBackView,setDocumentBackView] = useState<"documents" | "work">("work");
  const [documentPreviewReportId,setDocumentPreviewReportId] = useState<string | undefined>(undefined);
  const [documentPreviewDeclarationId,setDocumentPreviewDeclarationId] = useState<string | undefined>(undefined);
  const [quoteIssuedAt,setQuoteIssuedAt] = useState("");
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
    setPurchaseDeclarationItemKeys((current) => {
      const allKeys = quoteItems.map((_, index) => String(index));
      if (!allKeys.length) return [];
      const kept = current.filter((key) => allKeys.includes(key));
      return kept.length ? kept : allKeys;
    });
  }, [quoteItems]);

  const currentViewRef = useRef<View>(view);
  const viewHistoryRef = useRef<View[]>([]);
  const loadedUserIdRef = useRef<string | null>(null);
  const loadCustomersPromiseRef = useRef<Promise<void> | null>(null);
  const initialDataReadyRef = useRef(false);
  const detailDataLoadedRef = useRef<Record<string, boolean>>({});
  const detailDataLoadingRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    currentViewRef.current = view;
  }, [view]);

  useEffect(() => {
    initialDataReadyRef.current = initialDataReady;
  }, [initialDataReady]);

  function navigateToView(nextView: View) {
    const currentView = currentViewRef.current;
    if (nextView === currentView) return;
    viewHistoryRef.current = [...viewHistoryRef.current, currentView].slice(-25);
    currentViewRef.current = nextView;
    setView(nextView);
  }

  function replaceView(nextView: View) {
    currentViewRef.current = nextView;
    setView(nextView);
  }

  function goBack(fallbackView: View = "dashboard") {
    const history = viewHistoryRef.current;
    const previousView = history.pop();
    viewHistoryRef.current = history;
    replaceView(previousView || fallbackView);
  }

  useEffect(() => {
    if (view === "dashboard" || view === "schedule") {
      setMode("week");
      setCalDate(new Date());
    }
  }, [view]);

  useEffect(() => {
    setLeadPage(1);
    setArchivePage(1);
    setDocumentPage(1);
  }, [customerSearch, customerStatusFilter, view]);

  const q = qty(quoteItems);
  const t = total(quoteItems);
  const installer = quoteInstallTotal(quoteItems);
  const materialPrice = Math.max(0, t-installer);
  const normalizedScheduleAppointmentType = normalizeAppointmentType(scheduleAppointmentType);
  const isMultiDayJob = isInstallationAppointment(normalizedScheduleAppointmentType) && q >= 2;
  const normalizedScheduleTime = normalizeAppointmentTimeInput(scheduleTime) || "08:00";
  const scheduleStoredTime = isMultiDayJob ? "08:00 + 12:00" : normalizedScheduleTime;
  const shownTime = appointmentTimeRangeLabel({ appointmentType: normalizedScheduleAppointmentType, time: scheduleStoredTime, quoteItems }, normalizedScheduleTime);
  const sortedCustomers = sortCustomersByCreatedAtDesc(customers);
  const allWorkCustomers = workCustomersForScheduling(sortedCustomers, workHistoryByCustomer);
  const activeCustomers = sortedCustomers.filter((customer) => !isArchivedCustomer(customer));
  const archivedCustomers = sortedCustomers.filter(isArchivedCustomer);
  const calendarCustomers = sortCustomersBySchedule(allWorkCustomers.filter((customer) => Boolean(customer.date) && customer.status !== "Lemondva"));
  const workResourceEditLocked = selected.status === "Szerelés kész – admin folyamatban" || selected.status === "Lezárva";
  const canEditWorkResources = !workResourceEditLocked || allowWorkResourceEdit;
  const hasCustomerFilter = customerSearch.trim().length > 0 || customerStatusFilter !== "all";
  const filteredCustomers = sortedCustomers.filter((customer) => customerMatchesSearch(customer));
  const filteredActiveCustomers = activeCustomers.filter((customer) => customerMatchesSearch(customer));
  const filteredArchivedCustomers = archivedCustomers.filter((customer) => customerMatchesSearch(customer));
  const dashboardLeadCustomers = filteredActiveCustomers.filter((customer) => !customer.date);
  const dashboardLeadPagination = paginateItems(dashboardLeadCustomers, leadPage);
  const archivePagination = paginateItems(filteredArchivedCustomers, archivePage);
  const documentCustomerPagination = paginateItems(filteredCustomers, documentPage);
  const visibleLeadCustomers = dashboardLeadPagination.items;
  const visibleArchivedCustomers = archivePagination.items;
  const visibleDocumentCustomersForLoad = documentCustomerPagination.items;
  const visibleDocumentCustomersForLoadKey = visibleDocumentCustomersForLoad.map((customer) => customer.id).join("|");

  useEffect(() => {
    if (!user || !initialDataReady) return;
    if (["lead", "quote", "quotePreview", "schedule", "work", "workReport", "documentPreview"].includes(view) && selected.id) {
      void loadCustomerDetailData([selected.id]);
    }
  }, [user?.id, initialDataReady, view, selected.id]);

  useEffect(() => {
    if (!user || !initialDataReady || view !== "documents") return;
    void loadCustomerDetailData(visibleDocumentCustomersForLoad.map((customer) => customer.id));
  }, [user?.id, initialDataReady, view, documentPage, customerSearch, customerStatusFilter, visibleDocumentCustomersForLoadKey]);

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
      customer.postalCode,
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
    setLeadPage(1);
    setArchivePage(1);
    setDocumentPage(1);
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
      const rows = importable.map((lead) => {
        const inquiryTime = lead.inquiredAt || now;
        return {
          id: crypto.randomUUID(),
          name: lead.name,
          phone: lead.phone || null,
          email: lead.email || null,
          city: lead.city || null,
          postal_code: lead.postalCode || null,
          address: null,
          source: "CSV import",
          status: "Visszahívandó",
          need: null,
          notes: null,
          created_by: user?.id || null,
          created_at: inquiryTime,
          updated_at: now,
        };
      });

      let insertResult = await supabase.from("customers").insert(rows).select("*");
      if (insertResult.error && isMissingPostalCodeColumnError(insertResult.error)) {
        insertResult = await supabase.from("customers").insert(rows.map(withoutPostalCode)).select("*");
      }

      if (insertResult.error) throw insertResult.error;

      const newCustomers = (insertResult.data || []).map((row: any) => ({
        id: row.id,
        name: row.name || "",
        city: row.city || "",
        postalCode: postalCodeFromCustomerData(row.city, row.postal_code, row.address),
        phone: row.phone || "",
        email: row.email || "",
        address: row.address || "",
        source: row.source || "CSV import",
        status: normalizeStatus(row.status || "Visszahívandó"),
        need: row.need || "",
        notes: row.notes || "",
        createdAt: row.created_at || now,
        updatedAt: row.updated_at || now,
        quoteItems: EMPTY_QUOTE_ITEMS,
      })) as Customer[];

      setCustomers((prev) => sortCustomersByCreatedAtDesc([...newCustomers, ...prev]));
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

  function updateCustomerActivityInState(customerId: string, patch: Partial<Customer>) {
    setSelected((prev) => prev.id === customerId ? { ...prev, ...patch } : prev);
    setCustomers((prev) => prev.map((customer) => customer.id === customerId ? { ...customer, ...patch } : customer));
  }

  async function recordCustomerPhoneCall(customer: Customer, returnView: View = view) {
    rememberExternalCustomer(customer, returnView);
    if (!customer.id) return;

    const calledAt = new Date().toISOString();
    updateCustomerActivityInState(customer.id, { lastCalledAt: calledAt, updatedAt: calledAt });
    await supabase.from("customers").update({ updated_at: calledAt }).eq("id", customer.id);
    await logDocument(customer, "phone_call", "Telefonhívás", "Felhívva", calledAt);
  }

  useEffect(() => {
    if (!selected.id || !RESTORABLE_VIEWS.includes(view)) return;
    const draft = {
      customer: { ...selected, quoteItems: quoteItems.length ? quoteItems : selected.quoteItems || EMPTY_QUOTE_ITEMS },
      quoteItems: quoteItems.length ? quoteItems : selected.quoteItems || EMPTY_QUOTE_ITEMS,
      scheduleDate,
      scheduleTime,
      scheduleAppointmentType,
      view,
      editCustomer,
      allowWorkResourceEdit,
      at: Date.now(),
    };
    writeCustomerDraft(draft);
    setDraftNotice(draft);
  }, [selected, quoteItems, scheduleDate, scheduleTime, scheduleAppointmentType, view, editCustomer, allowWorkResourceEdit]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [view]);


  function requestDataLoadForUser(currentUser: User, force = false) {
    if (!force && loadedUserIdRef.current === currentUser.id && initialDataReadyRef.current) return;
    loadedUserIdRef.current = currentUser.id;
    void loadCustomersFromDb({ background: initialDataReadyRef.current });
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const currentUser = data.session?.user ?? null;
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) requestDataLoadForUser(currentUser);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser) {
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || loadedUserIdRef.current !== currentUser.id) {
          requestDataLoadForUser(currentUser);
        }
        return;
      }

      loadedUserIdRef.current = null;
      initialDataReadyRef.current = false;
      setInitialDataReady(false);
      setDataLoading(false);
      setCustomers([]);
      setSelected(EMPTY_CUSTOMER);
      setQuoteItems(EMPTY_CUSTOMER.quoteItems);
      setWorkReportsByCustomer({});
      setMaintenanceReportsByCustomer({});
      setDocumentsByCustomer({});
      setSellerCompanies([DEFAULT_SELLER_COMPANY]);
      setPurchaseDeclarationsByCustomer({});
      setSelectedSellerId(DEFAULT_SELLER_COMPANY.id);
      setWorkChecklistsByCustomer({});
      setDetailDataLoadedByCustomer({});
      setDetailDataLoadingByCustomer({});
      detailDataLoadedRef.current = {};
      detailDataLoadingRef.current = {};
      setWorkChecklist(EMPTY_WORK_CHECKLIST);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const currentWorkChecklist = selected.id ? effectiveChecklistFor(selected) : workChecklist;
  const closeRequirementItems = [
    {
      label: "Munkalap és egyszerű aláírás",
      done: Boolean(currentWorkChecklist.worksheet && currentWorkChecklist.signature && currentWorkChecklist.purchaseDeclaration),
    },
    { label: "NKVH", done: Boolean(currentWorkChecklist.nkvh) },
    { label: "Számlázás", done: Boolean(currentWorkChecklist.alinInvoice && currentWorkChecklist.amovaInvoice) },
  ];
  const missingChecklist = closeRequirementItems.filter((item) => !item.done).map((item) => item.label);
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
    setScheduleTime(draft?.scheduleTime || firstAppointmentTime(customerToOpen.time));
    setScheduleAppointmentType(normalizeAppointmentType(draft?.scheduleAppointmentType || customerToOpen.appointmentType));
    setWorkReport(emptyWorkReport(customerToOpen));
    setWorkChecklist(effectiveChecklistFor(customerToOpen));
    if (customerToOpen.id) void loadCustomerDetailData([customerToOpen.id]);
    setEditCustomer(draft?.editCustomer ?? false);
    setAllowWorkResourceEdit(draft?.allowWorkResourceEdit ?? false);
    navigateToView(v);
  }

  function openWorkVersion(work: Customer) {
    const next: Customer = {
      ...selected,
      ...work,
      id: selected.id,
      name: selected.name || work.name,
      phone: selected.phone || work.phone,
      email: selected.email || work.email,
      postalCode: selected.postalCode || work.postalCode,
      city: selected.city || work.city,
      address: work.address || selected.address,
    };
    setSelected(next);
    setQuoteItems(next.quoteItems || EMPTY_QUOTE_ITEMS);
    setScheduleDate(next.date || todayIso());
    setScheduleTime(firstAppointmentTime(next.time));
    setScheduleAppointmentType(normalizeAppointmentType(next.appointmentType));
    setWorkReport(emptyWorkReport(next));
    setWorkChecklist(effectiveChecklistFor(next));
    setAllowWorkResourceEdit(false);
    navigateToView("work");
  }

  function openTask(filter: TaskFilter) {
    setTaskFilter(filter);
    navigateToView("tasks");
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
      replaceView("tasks");
      return;
    }
    replaceView(target?.view || "dashboard");
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
    setScheduleTime(draft.scheduleTime || firstAppointmentTime(draft.customer.time));
    setScheduleAppointmentType(normalizeAppointmentType(draft.scheduleAppointmentType || draft.customer.appointmentType));
    setEditCustomer(draft.editCustomer);
    setAllowWorkResourceEdit(draft.allowWorkResourceEdit);
    navigateToView(draft.view);
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
    replaceView("dashboard");
    setWorkHistoryByCustomer({});
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

  function customerWithDetailDocuments(customer: Customer, docs: DocumentRecord[]) {
    const type = normalizeAppointmentType(customer.appointmentType);
    const scopedDocs = documentsForCustomerScope(customer, docs);
    const quoteSentAt = documentTimestamp(scopedDocs, "quote_email") || customer.quoteSentAt;
    const appointmentEmailAt = documentTimestamp(scopedDocs, appointmentEmailDocumentType(type));
    const appointmentBookedAt = documentTimestamp(scopedDocs, appointmentBookedDocumentType(type));
    const lastCalledAt = documentTimestamp(scopedDocs, "phone_call") || customer.lastCalledAt;

    return {
      ...customer,
      lastCalledAt,
      quoteSentAt,
      appointmentBookedAt: appointmentBookedAt || customer.appointmentBookedAt || appointmentEmailAt,
      appointmentUpdatedAt: appointmentEmailAt || customer.appointmentUpdatedAt,
    };
  }

  function stockDeductedFromWorkStatus(status?: string | null) {
    return status === "Szerelés kész – admin folyamatban" || status === "Lezárva";
  }

  function workScopeKey(customer: Pick<Customer, "id" | "activeAppointmentId">) {
    return customer.activeAppointmentId ? `${customer.id}:${customer.activeAppointmentId}` : customer.id;
  }

  function documentsForCustomerScope(customer: Pick<Customer, "activeAppointmentId">, docs: DocumentRecord[] = []) {
    if (!customer.activeAppointmentId) return docs;
    const scoped = docs.filter((doc) => doc.appointmentId === customer.activeAppointmentId);
    return scoped;
  }

  function workCustomersForScheduling(primaryCustomers: Customer[], historyByCustomer: Record<string, Customer[]>) {
    const byWork = new Map<string, Customer>();
    primaryCustomers.forEach((customer) => byWork.set(customer.activeAppointmentId || `customer:${customer.id}`, customer));
    Object.values(historyByCustomer).flat().forEach((customer) => {
      byWork.set(customer.activeAppointmentId || `customer:${customer.id}`, customer);
    });
    return Array.from(byWork.values());
  }

  function customerInstallationWorks(customer: Customer | undefined) {
    if (!customer?.id) return [];
    return workCustomersForScheduling([customer], { [customer.id]: workHistoryByCustomer[customer.id] || [] })
      .filter((work) => isInstallationAppointment(work.appointmentType) && work.activeAppointmentId)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.time || "").localeCompare(String(a.time || "")));
  }

  function updateWorkHistory(savedWork: Customer) {
    if (!savedWork.id) return;
    setWorkHistoryByCustomer((prev) => {
      const key = savedWork.activeAppointmentId || `customer:${savedWork.id}`;
      const current = prev[savedWork.id] || [];
      const next = [savedWork, ...current.filter((work) => (work.activeAppointmentId || `customer:${work.id}`) !== key)];
      return { ...prev, [savedWork.id]: sortCustomersBySchedule(next).reverse() };
    });
  }

  function shouldPromoteWorkToCustomerList(customer: Customer) {
    return normalizeAppointmentType(customer.appointmentType) !== "maintenance";
  }

  function promoteCustomerWork(savedWork: Customer) {
    updateWorkHistory(savedWork);
    if (!shouldPromoteWorkToCustomerList(savedWork)) return;
    setCustomers((prev) => {
      const exists = prev.some((customer) => customer.id === savedWork.id);
      const next = exists ? prev.map((customer) => customer.id === savedWork.id ? savedWork : customer) : [savedWork, ...prev];
      return sortCustomersByCreatedAtDesc(next);
    });
  }

  function replaceLoadedDetailIds(ids: string[]) {
    const donePatch = Object.fromEntries(ids.map((id) => [id, true]));
    const loadingPatch = Object.fromEntries(ids.map((id) => [id, false]));
    detailDataLoadedRef.current = { ...detailDataLoadedRef.current, ...donePatch };
    detailDataLoadingRef.current = { ...detailDataLoadingRef.current, ...loadingPatch };
    setDetailDataLoadedByCustomer((prev) => ({ ...prev, ...donePatch }));
    setDetailDataLoadingByCustomer((prev) => ({ ...prev, ...loadingPatch }));
  }

  async function loadCustomerDetailData(customerIds: string[], options: { force?: boolean } = {}) {
    if (!user) return;

    const uniqueIds = Array.from(new Set(customerIds.filter(Boolean)));
    const idsToLoad = options.force
      ? uniqueIds
      : uniqueIds.filter((id) => !detailDataLoadedRef.current[id] && !detailDataLoadingRef.current[id]);

    if (!idsToLoad.length) return;

    const loadingPatch = Object.fromEntries(idsToLoad.map((id) => [id, true]));
    detailDataLoadingRef.current = { ...detailDataLoadingRef.current, ...loadingPatch };
    setDetailDataLoadingByCustomer((prev) => ({ ...prev, ...loadingPatch }));

    try {
      const [workReportResult, documentResult, checklistResult, purchaseDeclarationResult] = await Promise.all([
        supabase.from("work_reports").select("*").in("customer_id", idsToLoad).order("created_at", { ascending: false }),
        supabase.from("documents").select("*").in("customer_id", idsToLoad).order("created_at", { ascending: false }),
        supabase.from("work_checklists").select("*").in("customer_id", idsToLoad),
        supabase.from("purchase_declarations").select("*").in("customer_id", idsToLoad).order("created_at", { ascending: false }),
      ]);

      if (workReportResult.error) console.warn("work_reports részletes betöltési hiba", workReportResult.error.message);
      if (documentResult.error) console.warn("documents részletes betöltési hiba", documentResult.error.message);
      if (checklistResult.error) console.warn("work_checklists részletes betöltési hiba", checklistResult.error.message);
      if (purchaseDeclarationResult.error && !isMissingSellerTableError(purchaseDeclarationResult.error)) console.warn("purchase_declarations részletes betöltési hiba", purchaseDeclarationResult.error.message);

      const idSet = new Set(idsToLoad);
      const loadedReportsByKey: Record<string, WorkReport> = {};
      const loadedMaintenanceReports: Record<string, WorkReport[]> = Object.fromEntries(idsToLoad.map((id) => [id, [] as WorkReport[]]));
      const loadedDocuments: Record<string, DocumentRecord[]> = Object.fromEntries(idsToLoad.map((id) => [id, [] as DocumentRecord[]]));
      const loadedPurchaseDeclarations: Record<string, PurchaseDeclaration[]> = Object.fromEntries(idsToLoad.map((id) => [id, [] as PurchaseDeclaration[]]));
      const loadedChecklists: Record<string, WorkChecklistState> = {};

      (workReportResult.data || []).forEach((row: any) => {
        if (!row.customer_id || !idSet.has(row.customer_id)) return;
        const report = workReportFromRow(row);
        if (normalizeAppointmentType(report.appointmentType) === "maintenance") {
          loadedMaintenanceReports[row.customer_id] = [...(loadedMaintenanceReports[row.customer_id] || []), report];
          return;
        }
        loadedReportsByKey[workReportKeyFromReport(report, row.customer_id)] = report;
      });

      Object.keys(loadedMaintenanceReports).forEach((customerId) => {
        loadedMaintenanceReports[customerId] = loadedMaintenanceReports[customerId].sort(compareWorkReportsDesc);
      });

      (documentResult.data || []).forEach((row: any) => {
        if (!row.customer_id || !idSet.has(row.customer_id)) return;
        loadedDocuments[row.customer_id] = [...(loadedDocuments[row.customer_id] || []), documentFromRow(row)];
      });

      (purchaseDeclarationResult.data || []).forEach((row: any) => {
        if (!row.customer_id || !idSet.has(row.customer_id)) return;
        loadedPurchaseDeclarations[row.customer_id] = [...(loadedPurchaseDeclarations[row.customer_id] || []), declarationFromRow(row)];
      });

      (checklistResult.data || []).forEach((row: any) => {
        if (!row.customer_id || !idSet.has(row.customer_id)) return;
        const key = row.appointment_id ? `${row.customer_id}:${row.appointment_id}` : row.customer_id;
        loadedChecklists[key] = workChecklistFromRow(row);
      });

      setWorkReportsByCustomer((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          if (next[key]?.customerId && idSet.has(next[key].customerId as string)) delete next[key];
        });
        return { ...next, ...loadedReportsByKey };
      });

      setMaintenanceReportsByCustomer((prev) => {
        const next = { ...prev };
        idsToLoad.forEach((id) => {
          next[id] = loadedMaintenanceReports[id] || [];
        });
        return next;
      });

      setDocumentsByCustomer((prev) => {
        const next = { ...prev };
        idsToLoad.forEach((id) => {
          next[id] = loadedDocuments[id] || [];
        });
        return next;
      });

      setPurchaseDeclarationsByCustomer((prev) => {
        const next = { ...prev };
        idsToLoad.forEach((id) => {
          next[id] = loadedPurchaseDeclarations[id] || [];
        });
        return next;
      });

      setWorkChecklistsByCustomer((prev) => {
        const next = { ...prev };
        idsToLoad.forEach((id) => {
          Object.keys(next).forEach((key) => {
            if (key === id || key.startsWith(`${id}:`)) delete next[key];
          });
        });
        return { ...next, ...loadedChecklists };
      });

      setCustomers((prev) => prev.map((customer) => (
        idSet.has(customer.id) ? customerWithDetailDocuments(customer, loadedDocuments[customer.id] || []) : customer
      )));
      setSelected((prev) => (
        prev.id && idSet.has(prev.id) ? customerWithDetailDocuments(prev, loadedDocuments[prev.id] || []) : prev
      ));

      replaceLoadedDetailIds(idsToLoad);
    } catch (error: any) {
      console.warn("Részletes ügyféladatok betöltési hiba", error?.message || error);
      const failedPatch = Object.fromEntries(idsToLoad.map((id) => [id, false]));
      detailDataLoadingRef.current = { ...detailDataLoadingRef.current, ...failedPatch };
      setDetailDataLoadingByCustomer((prev) => ({ ...prev, ...failedPatch }));
    }
  }

  async function refreshVisibleDocumentData() {
    await loadCustomersFromDb({ background: true });
    await loadCustomerDetailData(visibleDocumentCustomersForLoad.map((customer) => customer.id), { force: true });
  }

  async function loadSellerCompaniesFromDb() {
    const result = await supabase.from("seller_companies").select("*").eq("active", true).order("is_default", { ascending: false }).order("name", { ascending: true });
    if (result.error) {
      if (!isMissingSellerTableError(result.error)) console.warn("Eladó cégek betöltési hiba", result.error.message);
      setSellerCompanies([DEFAULT_SELLER_COMPANY]);
      setSelectedSellerId(DEFAULT_SELLER_COMPANY.id);
      return [DEFAULT_SELLER_COMPANY];
    }

    const sellers = [DEFAULT_SELLER_COMPANY, ...(result.data || []).map(sellerCompanyFromRow).filter((seller) => seller.name !== DEFAULT_SELLER_COMPANY.name)];
    setSellerCompanies(sellers);
    setSelectedSellerId((current) => sellers.some((seller) => seller.id === current) ? current : sellers[0].id);
    return sellers;
  }

  async function loadCustomersFromDb(options: { background?: boolean } = {}) {
    if (loadCustomersPromiseRef.current) return loadCustomersPromiseRef.current;

    const loadPromise = (async () => {
      setDataLoading(true);
      if (!options.background) setMessage("");

      const loadedProductsPromise = loadProductsFromDb();
      const loadedSellersPromise = loadSellerCompaniesFromDb();
      const dataPromise = Promise.all([
        supabase.from("customers").select("*").order("created_at", { ascending: false }),
        supabase.from("quotes").select("*").order("created_at", { ascending: false }),
        supabase.from("quote_items").select("*"),
        supabase.from("appointments").select("*").order("created_at", { ascending: false }),
        supabase.from("jobs").select("*").order("created_at", { ascending: false }),
      ]);

      const loadedProducts = await loadedProductsPromise;
      await loadedSellersPromise;
      void loadInventoryFromDb(loadedProducts);

      const [
        customerResult,
        quoteResult,
        itemResult,
        appointmentResult,
        jobResult,
      ] = await dataPromise;

      const { data: customerRows, error: customerError } = customerResult;

      if (customerError) {
        setMessage(`Nem sikerült betölteni az ügyfeleket: ${customerError.message}`);
        initialDataReadyRef.current = true;
        setInitialDataReady(true);
        return;
      }

      const quoteRows = quoteResult.data || [];
      const itemRows = itemResult.data || [];
      const jobRows = jobResult.data || [];
      const appointmentRows = appointmentResult.data || [];

      if (appointmentResult.error && !isMissingAppointmentsTableError(appointmentResult.error)) {
        console.warn("Appointments betöltési hiba, jobs kompatibilitási fallback aktív", appointmentResult.error.message);
      }
      if (jobResult.error && !appointmentRows.length) {
        console.warn("Jobs kompatibilitási fallback betöltési hiba", jobResult.error.message);
      }
      if (appointmentResult.error && jobResult.error) {
        setMessage(`Nem sikerült betölteni az időpontokat: ${appointmentResult.error.message}`);
      }

    const quotesByCustomer = new Map<string, any>();
    const quotesById = new Map<string, any>();
    const quotesByAppointment = new Map<string, any>();
    (quoteRows || []).forEach((quote: any) => {
      if (quote.id) quotesById.set(quote.id, quote);
      if (quote.appointment_id) quotesByAppointment.set(quote.appointment_id, quote);
      if (!quotesByCustomer.has(quote.customer_id)) quotesByCustomer.set(quote.customer_id, quote);
    });

    const itemsByQuote = new Map<string, any[]>();
    (itemRows || []).forEach((item: any) => {
      const current = itemsByQuote.get(item.quote_id) || [];
      current.push(item);
      itemsByQuote.set(item.quote_id, current);
    });

    const compatibleRows = compatibleAppointmentRows(appointmentRows, jobRows, {
      jobsReadSucceeded: !jobResult.error,
    });
    const currentAppointmentMap = currentAppointmentsByCustomer(compatibleRows);
    const appointmentHistoryMap = appointmentsByCustomer(compatibleRows);
    const activeWorkPriority = (row: any) => {
      const type = normalizeAppointmentType(row.appointment_type);
      const status = normalizeStatus(row.status || "");
      if (type === "maintenance" || status === "Lemondva") return 99;
      if (status === "Időpont foglalva" || status === "Szerelés folyamatban") return 0;
      if (status === "Ajánlat elküldve" || status === "Visszahívandó") return 1;
      if (status === "Szerelés kész – admin folyamatban") return 2;
      if (status === "Lezárva") return 3;
      return 4;
    };
    const comparePrimaryWork = (first: any, second: any) => {
      const priorityDiff = activeWorkPriority(first) - activeWorkPriority(second);
      if (priorityDiff !== 0) return priorityDiff;
      const dateDiff = String(second.scheduled_date || "").localeCompare(String(first.scheduled_date || ""));
      if (dateDiff !== 0) return dateDiff;
      const updatedDiff = String(second.updated_at || "").localeCompare(String(first.updated_at || ""));
      if (updatedDiff !== 0) return updatedDiff;
      return String(second.created_at || "").localeCompare(String(first.created_at || ""));
    };
    const primaryAppointmentFor = (customerId: string) => {
      const rows = appointmentHistoryMap.get(customerId) || [];
      return [...rows]
        .filter((row: any) => normalizeAppointmentType(row.appointment_type) !== "maintenance" && normalizeStatus(row.status || "") !== "Lemondva")
        .sort(comparePrimaryWork)[0]
        || currentAppointmentMap.get(customerId);
    };

    const quoteForAppointment = (row: any, appointment?: any) => {
      if (appointment?.quote_id && quotesById.has(appointment.quote_id)) return quotesById.get(appointment.quote_id);
      if (appointment?.id && quotesByAppointment.has(appointment.id)) return quotesByAppointment.get(appointment.id);
      if (appointment?.id) return undefined;
      return quotesByCustomer.get(row.id);
    };

    const customerFromAppointment = (row: any, appointment?: any): Customer => {
      const quote = quoteForAppointment(row, appointment);
      const existingDocs = documentsByCustomer[row.id] || [];
      const loadedAppointmentType = normalizeAppointmentType(appointment?.appointment_type);
      const quoteSentAt = quote?.sent_at || quote?.updated_at || quote?.created_at || undefined;
      const quoteItemsFromDb = quote ? (itemsByQuote.get(quote.id) || []).map(quoteItemFromRow) : [];

      const customer: Customer = {
        id: row.id,
        name: row.name || "",
        city: row.city || "",
        postalCode: postalCodeFromCustomerData(row.city, row.postal_code, row.address),
        phone: row.phone || "",
        email: row.email || "",
        address: row.address || appointment?.address || "",
        source: row.source || "Kézi rögzítés",
        status: normalizeStatus(appointment?.status || row.status || "Visszahívandó"),
        need: row.need || "",
        notes: row.notes || "",
        date: appointment?.scheduled_date || undefined,
        time: appointment?.scheduled_time || undefined,
        createdAt: row.created_at || undefined,
        updatedAt: row.updated_at || undefined,
        lastCalledAt: undefined,
        quoteSentAt,
        appointmentBookedAt: appointment?.created_at || quoteSentAt,
        appointmentUpdatedAt: appointment?.updated_at || quoteSentAt,
        appointmentType: loadedAppointmentType,
        activeAppointmentId: appointment?.id || undefined,
        activeQuoteId: quote?.id || undefined,
        quoteItems: quoteItemsFromDb.length ? quoteItemsFromDb : EMPTY_QUOTE_ITEMS,
        productId: quoteItemsFromDb[0]?.productId,
        quotePricingMode: quotePricingModeFromNotes(quote?.notes),
        stockDeducted: appointment?.id
          ? stockDeductedFromWorkStatus(appointment.status)
          : Boolean(row.stock_deducted) || stockDeductedFromWorkStatus(row.status),
      };

      return existingDocs.length ? customerWithDetailDocuments(customer, existingDocs) : customer;
    };

    const loadedCustomers: Customer[] = sortCustomersByCreatedAtDesc((customerRows || []).map((row: any) => (
      customerFromAppointment(row, primaryAppointmentFor(row.id))
    )));

    const nextWorkHistory: Record<string, Customer[]> = {};
    (customerRows || []).forEach((row: any) => {
      nextWorkHistory[row.id] = (appointmentHistoryMap.get(row.id) || []).map((appointment) => customerFromAppointment(row, appointment));
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
    setWorkHistoryByCustomer(nextWorkHistory);
    setSelected(nextSelected);
    setQuoteItems(nextQuoteItems);
    setWorkChecklist(effectiveChecklistFor(nextSelected));
    initialDataReadyRef.current = true;
    setInitialDataReady(true);
    void loadCustomerDetailData([nextSelected.id, ...loadedCustomers.slice(0, LIST_PAGE_SIZE).map((customer) => customer.id)].filter(Boolean));

    if (selectedFromReturn && returnContext) {
      setScheduleDate(nextSelected.date || todayIso());
      setScheduleTime(firstAppointmentTime(nextSelected.time));
      setScheduleAppointmentType(normalizeAppointmentType(nextSelected.appointmentType));
      setWorkReport(emptyWorkReport(nextSelected));
      setEditCustomer(false);
      replaceView(returnContext.view);
      if (typeof window !== "undefined") window.sessionStorage.removeItem(RETURN_CONTEXT_KEY);
    } else if (customerDraft && selectedFromDraft) {
      setScheduleDate(customerDraft.scheduleDate || nextSelected.date || todayIso());
      setScheduleTime(customerDraft.scheduleTime || firstAppointmentTime(nextSelected.time));
      setScheduleAppointmentType(normalizeAppointmentType(nextSelected.appointmentType));
      setEditCustomer(customerDraft.editCustomer);
      setAllowWorkResourceEdit(customerDraft.allowWorkResourceEdit);
      // Frissítés / újratöltés után ne vigyen vissza automatikusan egy belső oldalra.
      // A folyamatban lévő szerkesztés megmarad, de a kezdőlap marad a kiindulópont.
    }

    })().finally(() => {
      setDataLoading(false);
      loadCustomersPromiseRef.current = null;
    });

    loadCustomersPromiseRef.current = loadPromise;
    return loadPromise;
  }

  type PersistCustomerResult = {
    appointmentId?: string;
    jobId?: string;
    quoteId?: string;
  };

  async function saveAppointmentWithJobMirror(customer: Customer, quoteId?: string): Promise<PersistCustomerResult> {
    const { data, error } = await supabase.rpc("save_appointment_with_job_mirror", {
      p_appointment_id: customer.activeAppointmentId || null,
      p_customer_id: customer.id,
      p_quote_id: quoteId || null,
      p_title: customer.name,
      p_scheduled_date: customer.date,
      p_scheduled_time: customer.time || "08:00",
      p_appointment_type: normalizeAppointmentType(customer.appointmentType),
      p_status: normalizeStatus(customer.status || "Időpont foglalva"),
      p_address: customer.address || null,
      p_notes: customer.notes || customer.need || null,
      p_created_by: user?.id || null,
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return {
      appointmentId: row?.appointment_id || undefined,
      jobId: row?.job_id || undefined,
    };
  }

  async function cancelAppointmentWithJobMirror(customer: Customer, cancelledAt: string): Promise<PersistCustomerResult> {
    const { data, error } = await supabase.rpc("cancel_appointment_with_job_mirror", {
      p_appointment_id: customer.activeAppointmentId || null,
      p_customer_id: customer.id,
      p_cancelled_at: cancelledAt,
      p_status: "Lemondva",
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return {
      appointmentId: row?.appointment_id || undefined,
      jobId: row?.job_id || undefined,
    };
  }

  async function persistCustomerToDb(customer: Customer): Promise<PersistCustomerResult | undefined> {
    if (!user || !customer.id || !customer.name.trim()) return;

    const customerPayload = {
      id: customer.id,
      name: customer.name,
      phone: customer.phone || null,
      email: customer.email || null,
      city: customer.city || null,
      postal_code: customer.postalCode || null,
      address: customer.address || null,
      source: customer.source || "Kézi rögzítés",
      status: customer.status || "Visszahívandó",
      need: customer.need || null,
      notes: customer.notes || null,
      stock_deducted: Boolean(customer.stockDeducted),
      created_at: customer.createdAt || undefined,
      updated_at: customer.updatedAt || new Date().toISOString(),
      created_by: user.id,
    };

    let customerResult = await supabase.from("customers").upsert(customerPayload);
    if (customerResult.error && isMissingPostalCodeColumnError(customerResult.error)) {
      customerResult = await supabase.from("customers").upsert(withoutPostalCode(customerPayload));
    }

    if (customerResult.error) throw customerResult.error;

    let quoteId = customer.activeQuoteId;
    if (quoteId && customer.activeAppointmentId) {
      const { data: quoteScope } = await supabase
        .from("quotes")
        .select("appointment_id")
        .eq("id", quoteId)
        .maybeSingle();
      if (quoteScope?.appointment_id && quoteScope.appointment_id !== customer.activeAppointmentId) {
        quoteId = undefined;
      }
    }
    if (!quoteId && customer.activeAppointmentId) {
      const { data: appointmentQuote } = await supabase
        .from("appointments")
        .select("quote_id")
        .eq("id", customer.activeAppointmentId)
        .maybeSingle();
      quoteId = appointmentQuote?.quote_id || undefined;
    }
    if (!quoteId && !customer.date) {
      const { data: existingQuotes } = await supabase
        .from("quotes")
        .select("id")
        .eq("customer_id", customer.id)
        .limit(1);
      quoteId = existingQuotes?.[0]?.id as string | undefined;
    }
    const quotePayload = {
      customer_id: customer.id,
      appointment_id: customer.activeAppointmentId || null,
      status: normalizeStatus(customer.status || "Ajánlat elküldve"),
      total_amount: total(customer.quoteItems || []),
      notes: quotePricingModeToNotes(customer.quotePricingMode),
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
      const result = await saveAppointmentWithJobMirror(customer, quoteId);
      if (result.appointmentId && quoteId) {
        const [quoteLinkResult, appointmentLinkResult] = await Promise.all([
          supabase
            .from("quotes")
            .update({ appointment_id: result.appointmentId })
            .eq("id", quoteId),
          supabase
            .from("appointments")
            .update({ quote_id: quoteId })
            .eq("id", result.appointmentId),
        ]);
        if (quoteLinkResult.error) throw quoteLinkResult.error;
        if (appointmentLinkResult.error) throw appointmentLinkResult.error;
      }
      return { ...result, quoteId };
    }

    if (customer.status === "Lemondva") {
      const result = await cancelAppointmentWithJobMirror(customer, customer.updatedAt || new Date().toISOString());
      return { ...result, quoteId };
    }

  }

  function startNewCustomer() {
    const now = new Date().toISOString();
    const fresh: Customer = {
      id: crypto.randomUUID(),
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
      createdAt: now,
      updatedAt: now,
      quoteItems: EMPTY_QUOTE_ITEMS,
      quotePricingMode: "bundle",
      appointmentType: "installation",
    };

    setSelected(fresh);
    setQuoteItems(fresh.quoteItems);
    setScheduleDate(todayIso());
    setScheduleTime("08:00");
    setScheduleAppointmentType("installation");
    setAllowWorkResourceEdit(false);
    setReturnTarget(currentReturnTarget());
    navigateToView("lead");
  }

  function updateSelectedField(field: keyof Customer, value: string) {
    setSelected((prev) => ({ ...prev, [field]: value }));
  }

  function updateScheduleAppointmentType(value: AppointmentType) {
    const nextType = normalizeAppointmentType(value);
    setScheduleAppointmentType(nextType);
    const slots = isInstallationAppointment(nextType) && qty(quoteItems) >= 2 ? ["08:00"] : appointmentSlotOptions(nextType, quoteItems);
    setScheduleTime((previous) => normalizeAppointmentTimeInput(previous) || slots[0] || "08:00");
  }

  function openQuickAppointment(date: string) {
    setQuickAppointment({
      date,
      time: "08:00",
      search: "",
      name: "",
      phone: "",
      email: "",
      postalCode: "",
      city: "",
      address: "",
      notes: "",
      productId: "",
      quantity: 1,
      price: "",
      maintenanceInstallationIds: [],
    });
    setMessage("");
  }

  function updateQuickAppointment(patch: Partial<QuickAppointmentDraft>) {
    setQuickAppointment((prev) => prev ? { ...prev, ...patch } : prev);
  }

  function updateQuickAppointmentPostalCode(value: string) {
    const postalCode = normalizePostalCodeInput(value);
    const exact = uniqueSettlementByPostalCode(postalCode);
    updateQuickAppointment({
      postalCode,
      ...(exact ? { city: exact.city } : {}),
    });
  }

  function chooseQuickAppointmentType(appointmentType: AppointmentType) {
    const nextType = normalizeAppointmentType(appointmentType);
    setQuickAppointment((prev) => prev ? {
      ...prev,
      appointmentType: nextType,
      customerMode: nextType === "maintenance" ? "existing" : prev.customerMode,
      selectedCustomerId: undefined,
      search: "",
      productId: "",
      quantity: 1,
      price: "",
      maintenanceInstallationIds: [],
    } : prev);
  }

  function chooseQuickAppointmentCustomerMode(customerMode: QuickAppointmentCustomerMode) {
    setQuickAppointment((prev) => prev ? {
      ...prev,
      customerMode,
      selectedCustomerId: undefined,
      search: "",
      maintenanceInstallationIds: [],
    } : prev);
  }

  function updateQuickAppointmentProduct(productId: string) {
    const product = products.find((item) => item.id === productId);
    updateQuickAppointment({ productId, price: product ? product.price : "" });
  }

  function quickAppointmentSelectedCustomer(draft: QuickAppointmentDraft | null = quickAppointment) {
    if (!draft?.selectedCustomerId) return undefined;
    return customers.find((customer) => customer.id === draft.selectedCustomerId);
  }

  function selectQuickAppointmentCustomer(customer: Customer) {
    const installationIds = customerInstallationWorks(customer)
      .map((work) => work.activeAppointmentId)
      .filter(Boolean) as string[];
    updateQuickAppointment({
      selectedCustomerId: customer.id,
      search: customer.name,
      maintenanceInstallationIds: installationIds,
    });
  }

  function quickAppointmentQuoteItems(draft: QuickAppointmentDraft, existingCustomer?: Customer): QuoteItem[] {
    const type = normalizeAppointmentType(draft.appointmentType);
    if (type === "maintenance") {
      const selectedIds = new Set(draft.maintenanceInstallationIds || []);
      const selectedWorks = customerInstallationWorks(existingCustomer)
        .filter((work) => selectedIds.size === 0 || (work.activeAppointmentId && selectedIds.has(work.activeAppointmentId)));
      return cleanQuoteItems(selectedWorks.flatMap((work) => work.quoteItems || []));
    }
    if (type === "survey") return existingCustomer ? cleanQuoteItems(existingCustomer.quoteItems || []) : EMPTY_QUOTE_ITEMS;
    if (!draft.productId) return EMPTY_QUOTE_ITEMS;
    return cleanQuoteItems([{
      productId: draft.productId,
      quantity: draft.quantity || 1,
      customPrice: draft.price,
    }]);
  }

  async function saveMaintenanceAppointmentLinks(maintenanceCustomer: Customer, installationAppointmentIds: string[]) {
    if (!maintenanceCustomer.activeAppointmentId || !maintenanceCustomer.id) return;
    const ids = Array.from(new Set(installationAppointmentIds.filter(Boolean)));
    const { error: deleteError } = await supabase
      .from("maintenance_appointment_items")
      .delete()
      .eq("maintenance_appointment_id", maintenanceCustomer.activeAppointmentId);
    if (deleteError) throw deleteError;
    if (!ids.length) return;
    const rows = ids.map((installationId) => ({
      maintenance_appointment_id: maintenanceCustomer.activeAppointmentId,
      installation_appointment_id: installationId,
      customer_id: maintenanceCustomer.id,
      legacy_source_key: `quick-maintenance:${maintenanceCustomer.activeAppointmentId}:${installationId}`,
    }));
    const { error } = await supabase
      .from("maintenance_appointment_items")
      .upsert(rows, { onConflict: "maintenance_appointment_id,installation_appointment_id" });
    if (error) throw error;
  }

  async function saveQuickAppointment() {
    if (!quickAppointment?.appointmentType) {
      setMessage("Válaszd ki, mit szeretnél rögzíteni.");
      return;
    }

    const appointmentType = normalizeAppointmentType(quickAppointment.appointmentType);
    const normalizedTime = normalizeAppointmentTimeInput(quickAppointment.time);
    if (!normalizedTime) {
      setMessage("Adj meg érvényes időpontot, például 10:00 vagy 13:30.");
      return;
    }

    const existingCustomer = quickAppointmentSelectedCustomer();
    if (quickAppointment.customerMode === "existing" && !existingCustomer) {
      setMessage("Válassz ki egy meglévő ügyfelet az időponthoz.");
      return;
    }

    if (quickAppointment.customerMode === "new" && !quickAppointment.name.trim()) {
      setMessage("Az új ügyfélhez legalább nevet adj meg.");
      return;
    }

    if (appointmentType === "installation" && !quickAppointment.productId) {
      setMessage("Szereléshez válassz klímát.");
      return;
    }

    const now = new Date().toISOString();
    const quoteItemsForAppointment = quickAppointmentQuoteItems(quickAppointment, existingCustomer);
    const slotIsAvailable = appointmentTimeAvailable({
      customers: allWorkCustomers,
      date: quickAppointment.date,
      appointmentType,
      items: quoteItemsForAppointment,
      time: normalizedTime,
    });

    if (!slotIsAvailable) {
      setMessage("Ez az idősáv foglalt. Adj meg másik időpontot.");
      return;
    }

    const baseCustomer: Customer = existingCustomer || {
      id: crypto.randomUUID(),
      name: quickAppointment.name.trim(),
      city: quickAppointment.city.trim(),
      postalCode: quickAppointment.postalCode.trim(),
      phone: quickAppointment.phone.trim(),
      email: quickAppointment.email.trim(),
      address: quickAppointment.address.trim(),
      source: "Naptár gyors rögzítés",
      status: "Időpont foglalva",
      need: "",
      notes: quickAppointment.notes.trim(),
      createdAt: now,
      updatedAt: now,
      quoteItems: EMPTY_QUOTE_ITEMS,
      quotePricingMode: "bundle",
    };

    const customerToSave: Customer = {
      ...baseCustomer,
      name: existingCustomer ? baseCustomer.name : quickAppointment.name.trim(),
      phone: existingCustomer ? baseCustomer.phone : quickAppointment.phone.trim(),
      email: existingCustomer ? baseCustomer.email : quickAppointment.email.trim(),
      postalCode: existingCustomer ? baseCustomer.postalCode : quickAppointment.postalCode.trim(),
      city: existingCustomer ? baseCustomer.city : quickAppointment.city.trim(),
      address: existingCustomer ? baseCustomer.address : quickAppointment.address.trim(),
      notes: quickAppointment.notes.trim() || baseCustomer.notes || "",
      date: quickAppointment.date,
      time: normalizedTime,
      appointmentType,
      activeAppointmentId: undefined,
      activeQuoteId: undefined,
      activeWorkReportId: undefined,
      status: "Időpont foglalva",
      stockDeducted: false,
      quoteItems: quoteItemsForAppointment,
      productId: quoteItemsForAppointment[0]?.productId || undefined,
      isFresh: true,
      appointmentBookedAt: baseCustomer.appointmentBookedAt || now,
      appointmentUpdatedAt: now,
      updatedAt: now,
    };

    try {
      const persisted = await persistCustomerToDb(customerToSave);
      const savedCustomer: Customer = {
        ...customerToSave,
        activeAppointmentId: persisted?.appointmentId || customerToSave.activeAppointmentId,
        activeQuoteId: persisted?.quoteId || customerToSave.activeQuoteId,
      };
      if (appointmentType !== "maintenance") {
        await logDocument(savedCustomer, appointmentBookedDocumentType(appointmentType), `${appointmentTypeLabel(appointmentType)} időpont rögzítése`, "Rögzítve", now);
      } else {
        await saveMaintenanceAppointmentLinks(savedCustomer, quickAppointment.maintenanceInstallationIds);
      }
      promoteCustomerWork(savedCustomer);
      setSelected(savedCustomer);
      setQuoteItems(savedCustomer.quoteItems);
      setScheduleDate(savedCustomer.date || quickAppointment.date);
      setScheduleTime(firstAppointmentTime(savedCustomer.time));
      setScheduleAppointmentType(appointmentType);
      setQuickAppointment(null);
      setQuickAppointmentEmailPrompt(savedCustomer);
      setMessage(`${appointmentTypeLabel(appointmentType)} időpont rögzítve a naptárból ✅`);
      if (savedCustomer.id) void loadCustomerDetailData([savedCustomer.id]);
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  async function saveCustomerData() {
    const now = new Date().toISOString();
    const updated: Customer = { ...selected, updatedAt: now };
    try {
      const persisted = await persistCustomerToDb(updated);
      const savedUpdated: Customer = {
        ...updated,
        activeAppointmentId: persisted?.appointmentId || updated.activeAppointmentId,
        activeQuoteId: persisted?.quoteId || updated.activeQuoteId,
      };
      setSelected(savedUpdated);
      promoteCustomerWork(savedUpdated);
      setEditCustomer(false);
      clearCustomerDraft(savedUpdated.id);
      setDraftNotice(readCustomerDraft());
      setMessage("Ügyféladatok mentve ✅");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  function updateCustomerStatus(value: string) {
    setSelected((prev) => ({ ...prev, status: normalizeStatus(value) }));
  }

  function updateQuotePricingMode(value: QuotePricingMode) {
    setSelected((prev) => ({ ...prev, quotePricingMode: value }));
  }

  function startInstallationScheduleFromQuote() {
    updateCustomerStatus("Ajánlat elküldve");
    setScheduleAppointmentType("installation");
    setScheduleDate(todayIso());
    setScheduleTime((previous) => {
      const slots = appointmentSlotOptions("installation", quoteItems);
      return normalizeAppointmentTimeInput(previous) || slots[0] || "08:00";
    });
    navigateToView("schedule");
  }


  async function persistWorkChecklist(customer: Customer, checklist: WorkChecklistState) {
    if (!customer.id || !user) return;

    const basePayload = {
      customer_id: customer.id,
      appointment_id: customer.activeAppointmentId || null,
      worksheet: checklist.worksheet,
      signature: checklist.signature,
      purchase_declaration: checklist.purchaseDeclaration,
      alin_invoice: checklist.alinInvoice,
      amova_invoice: checklist.amovaInvoice,
      nkvh: checklist.nkvh,
      docs_sent: checklist.docsSent,
      updated_by: user.id,
    };
    const payload = {
      ...basePayload,
      completed_at: checklist.completedAt || {},
    };

    const { error } = await supabase
      .from("work_checklists")
      .upsert(payload, { onConflict: customer.activeAppointmentId ? "customer_id,appointment_id" : "customer_id" });

    if (error && isMissingChecklistCompletedAtColumnError(error)) {
      const { appointment_id, completed_at, ...basePayloadWithoutScopedColumns } = basePayload as any;
      const { error: retryError } = await supabase
        .from("work_checklists")
        .upsert(basePayloadWithoutScopedColumns, { onConflict: "customer_id" });
      if (retryError) {
        console.warn("work_checklists mentési hiba", retryError.message);
        setMessage("A lezárási ellenőrzőlista nem mentődött. Futtasd a WORK_CHECKLIST_SQL.sql fájlt a Supabase-ben.");
      }
      return;
    }

    if (error && customer.activeAppointmentId) {
      const { appointment_id, completed_at, ...legacyPayload } = payload as any;
      const { error: retryError } = await supabase
        .from("work_checklists")
        .upsert(legacyPayload, { onConflict: "customer_id" });
      if (retryError) console.warn("work_checklists mentĂ©si hiba", retryError.message);
      return;
    }

    if (error) {
      console.warn("work_checklists mentési hiba", error.message);
      setMessage("A lezárási ellenőrzőlista nem mentődött. Futtasd a WORK_CHECKLIST_SQL.sql fájlt a Supabase-ben.");
    }
  }

  async function updateChecklistForCustomer(customer: Customer, patch: Partial<WorkChecklistState>) {
    const base = effectiveChecklistFor(customer);
    const completedAt: WorkChecklistCompletedAt = { ...(base.completedAt || {}) };
    (["worksheet", "signature", "purchaseDeclaration", "alinInvoice", "amovaInvoice", "nkvh", "docsSent"] as WorkChecklistItemKey[]).forEach((key) => {
      const value = patch[key];
      if (typeof value !== "boolean") return;
      if (value) completedAt[key] = completedAt[key] || new Date().toISOString();
      else delete completedAt[key];
    });
    const next: WorkChecklistState = { ...base, ...patch, completedAt };
    setWorkChecklist(next);
    setWorkChecklistsByCustomer((prev) => ({ ...prev, [workScopeKey(customer)]: next }));
    await persistWorkChecklist(customer, next);
    return next;
  }

  async function toggleChecklist(key: WorkChecklistItemKey) {
    const base = selected.id ? effectiveChecklistFor(selected) : workChecklist;
    if ((key === "worksheet" || key === "purchaseDeclaration") && !base.signature) {
      setMessage("A munkalap és a vásárlási nyilatkozat csak ügyfélaláírás után jelölhető elkészültként.");
      return;
    }

    const nextValue = !base[key];
    const completedAt: WorkChecklistCompletedAt = { ...(base.completedAt || {}) };
    if (nextValue) completedAt[key] = completedAt[key] || new Date().toISOString();
    else delete completedAt[key];

    const next: WorkChecklistState = { ...base, [key]: nextValue, completedAt };
    setWorkChecklist(next);

    if (selected.id) {
      setWorkChecklistsByCustomer((prev) => ({ ...prev, [workScopeKey(selected)]: next }));
      await persistWorkChecklist(selected, next);
    }
  }

  async function setChecklistItem(key: WorkChecklistItemKey, value: boolean) {
    const base = selected.id ? effectiveChecklistFor(selected) : workChecklist;
    if ((key === "worksheet" || key === "purchaseDeclaration") && value && !base.signature) {
      setMessage("A munkalap és a vásárlási nyilatkozat csak ügyfélaláírás után jelölhető elkészültként.");
      return;
    }

    if (base[key] === value) return;
    const next = { [key]: value } as Partial<WorkChecklistState>;
    if (selected.id) {
      await updateChecklistForCustomer(selected, next);
    } else {
      const completedAt: WorkChecklistCompletedAt = { ...(base.completedAt || {}) };
      if (value) completedAt[key] = completedAt[key] || new Date().toISOString();
      else delete completedAt[key];
      setWorkChecklist({ ...base, [key]: value, completedAt });
    }
  }

  async function createInvoice(kind: BillingInvoiceKind, amountValue: string, paymentMethod: BillingPaymentMethod) {
    if (!selected.id) return;
    const amount = Number(String(amountValue || "").replace(/\s/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Számla készítéséhez adj meg érvényes összeget.");
      return;
    }

    const label = billingKindLabel(kind, billingUiConfig());
    const confirmed = window.confirm(`${label} számla létrehozása ${ft(Math.round(amount))} összeggel, fizetési mód: ${billingPaymentMethodLabel(paymentMethod)}?`);
    if (!confirmed) return;

    setInvoiceBusy(kind);
    setMessage(`${label} számla készítése folyamatban...`);

    try {
      const response = await fetch("/api/create-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          amount: Math.round(amount),
          paymentMethod,
          customer: selected,
          quoteItems,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.error || "A Számlázz.hu számlakészítés sikertelen.");

      await setChecklistItem(kind === "device" ? "amovaInvoice" : "alinInvoice", true);
      setMessage(`${label} számla elkészült ✅${result.invoiceNumber ? ` Számlaszám: ${result.invoiceNumber}` : ""}`);
    } catch (error: any) {
      setMessage(`Számlázási hiba: ${error.message}`);
    } finally {
      setInvoiceBusy(null);
    }
  }

  async function saveCustomer(nextView: View = "quote") {
    const now = new Date().toISOString();
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
      createdAt: selected.createdAt || now,
      updatedAt: now,
      quoteItems: quoteItems.length ? quoteItems : EMPTY_QUOTE_ITEMS,
    };

    setSelected(customerToSave);
    setCustomers((prev) => {
      const exists = prev.some((customer) => customer.id === customerToSave.id);
      if (exists) {
        return sortCustomersByCreatedAtDesc(prev.map((customer) => customer.id === customerToSave.id ? customerToSave : customer));
      }
      return sortCustomersByCreatedAtDesc([customerToSave, ...prev]);
    });

    try {
      await persistCustomerToDb(customerToSave);
      clearCustomerDraft(customerToSave.id);
      setDraftNotice(readCustomerDraft());
      setMessage("Ügyfél mentve ✅");
      navigateToView(nextView);
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  async function saveCustomerAndScheduleSurvey() {
    const now = new Date().toISOString();
    const customerToSave: Customer = {
      ...selected,
      source: selected.source || "Kézi rögzítés",
      status: normalizeStatus(selected.status || "Visszahívandó"),
      createdAt: selected.createdAt || now,
      updatedAt: now,
      appointmentType: "survey",
      quoteItems: EMPTY_QUOTE_ITEMS,
      productId: undefined,
    };

    setSelected(customerToSave);
    setQuoteItems(EMPTY_QUOTE_ITEMS);
    setScheduleAppointmentType("survey");
    setScheduleDate(todayIso());
    setScheduleTime("08:00");
    setSendAppointmentNotice(true);

    setCustomers((prev) => {
      const exists = prev.some((customer) => customer.id === customerToSave.id);
      if (exists) {
        return sortCustomersByCreatedAtDesc(prev.map((customer) => customer.id === customerToSave.id ? customerToSave : customer));
      }
      return sortCustomersByCreatedAtDesc([customerToSave, ...prev]);
    });

    try {
      await persistCustomerToDb(customerToSave);
      clearCustomerDraft(customerToSave.id);
      setDraftNotice(readCustomerDraft());
      setMessage("Felmérési időpont választható ✅");
      navigateToView("schedule");
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  async function saveCustomerOnly() {
    const now = new Date().toISOString();
    const customerToSave: Customer = {
      ...selected,
      source: selected.source || "Kézi rögzítés",
      status: normalizeStatus(selected.status || "Visszahívandó"),
      createdAt: selected.createdAt || now,
      updatedAt: now,
      quoteItems: quoteItems.length ? quoteItems : EMPTY_QUOTE_ITEMS,
    };

    setSelected(customerToSave);
    setCustomers((prev) => {
      const exists = prev.some((customer) => customer.id === customerToSave.id);
      if (exists) {
        return sortCustomersByCreatedAtDesc(prev.map((customer) => customer.id === customerToSave.id ? customerToSave : customer));
      }
      return sortCustomersByCreatedAtDesc([customerToSave, ...prev]);
    });

    try {
      await persistCustomerToDb(customerToSave);
      setMessage("Ügyféladatok mentve ✅");
      clearCustomerDraft(customerToSave.id);
      setDraftNotice(readCustomerDraft());
      returnToLastMenu();
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
        returnToLastMenu();
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
      customInstallPrice: isKnownProductId(productId) ? prod(productId).installPrice : (it.customInstallPrice ?? DEFAULT_INSTALL_PRICE),
    } : it));
  }
  function syncQuoteItemPrice(i:number) {
    setQuoteItems(prev=>prev.map((it,idx)=>idx===i ? { ...it, customPrice: prod(it.productId).price, customInstallPrice: prod(it.productId).installPrice } : it));
  }
  function removeQuoteItem(i:number) { setQuoteItems(prev=>prev.length===1 ? prev : prev.filter((_,idx)=>idx!==i)); }
  async function saveSchedule() {
    const wasExistingSchedule = Boolean(selected.date);
    const slotToValidate = isMultiDayJob ? scheduleStoredTime : normalizeAppointmentTimeInput(scheduleTime);
    if (!slotToValidate) {
      setMessage("Adj meg érvényes időpontot, például 10:00 vagy 13:30.");
      return;
    }
    const slotIsAvailable = appointmentTimeAvailable({
      customers: allWorkCustomers,
      date: scheduleDate,
      appointmentType: normalizedScheduleAppointmentType,
      items: quoteItems,
      selectedCustomerId: selected.id,
      selectedAppointmentId: selected.activeAppointmentId,
      time: slotToValidate,
    });
    if (!slotIsAvailable) {
      setMessage("Ez az idősáv közben foglalt lett. Adj meg másik időpontot.");
      return;
    }

    const appointmentBookedAt = new Date().toISOString();
    const scheduledQuoteItems = cleanQuoteItems(quoteItems);
    const updated:Customer = {
      ...selected,
      date:scheduleDate,
      time:slotToValidate,
      appointmentType: normalizedScheduleAppointmentType,
      status:"Időpont foglalva",
      quoteItems: scheduledQuoteItems,
      productId: scheduledQuoteItems[0]?.productId || undefined,
      isFresh:true,
      appointmentBookedAt: selected.appointmentBookedAt || appointmentBookedAt,
      appointmentUpdatedAt: appointmentBookedAt,
      updatedAt: appointmentBookedAt,
    };
    try {
      const persisted = await persistCustomerToDb(updated);
      const savedUpdated: Customer = {
        ...updated,
        activeAppointmentId: persisted?.appointmentId || updated.activeAppointmentId,
        activeQuoteId: persisted?.quoteId || updated.activeQuoteId,
      };
      if (normalizeAppointmentType(savedUpdated.appointmentType) !== "maintenance") {
        await logDocument(savedUpdated, appointmentBookedDocumentType(savedUpdated.appointmentType), `${appointmentTypeLabel(savedUpdated.appointmentType)} időpont rögzítése`, "Rögzítve", appointmentBookedAt);
      }
      promoteCustomerWork(savedUpdated);
      setSelected(savedUpdated);

      if (sendAppointmentNotice) {
        const sent = await sendAppointmentEmailFor(savedUpdated);
        setMessage(sent ? (wasExistingSchedule ? "Időpont módosítva és tájékoztató email elküldve ✅" : "Időpont mentve és tájékoztató email elküldve ✅") : "Időpont mentve, de az email küldése nem sikerült.");
      } else {
        setMessage(wasExistingSchedule ? "Időpont módosítva ✅ Email nem ment ki." : "Időpont mentve a naptárba ✅ Email nem ment ki.");
      }

      clearCustomerDraft(savedUpdated.id);
      setDraftNotice(readCustomerDraft());
      replaceView(wasExistingSchedule ? "work" : "dashboard");
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
    const updatedTime = isInstallationAppointment(selected.appointmentType) && newQty >= 2 ? "08:00 + 12:00" : firstAppointmentTime(selected.time || scheduleTime || "08:00");
    const changedAt = new Date().toISOString();
    const updated: Customer = {
      ...selected,
      quoteItems: updatedQuoteItems,
      productId: updatedQuoteItems[0]?.productId || selected.productId,
      time: updatedTime,
      status: selected.status || "Időpont foglalva",
      isFresh: true,
      updatedAt: changedAt,
    };

    try {
      const persisted = await persistCustomerToDb(updated);
      const savedUpdated: Customer = {
        ...updated,
        activeAppointmentId: persisted?.appointmentId || updated.activeAppointmentId,
        activeQuoteId: persisted?.quoteId || updated.activeQuoteId,
      };
      setSelected(savedUpdated);
      promoteCustomerWork(savedUpdated);
      setAllowWorkResourceEdit(false);
      clearCustomerDraft(savedUpdated.id);
      setDraftNotice(readCustomerDraft());
      setMessage("Időponthoz tartozó klímák és anyagok módosítva ✅");
      replaceView("work");
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
    if (selected.stockDeducted) return "";

    const neededByProduct = cleanQuoteItems(quoteItems).reduce((map, item) => {
      if (!isKnownProductId(item.productId)) return map;
      map.set(item.productId, (map.get(item.productId) || 0) + itemQuantity(item));
      return map;
    }, new Map<string, number>());

    for (const [productId, needed] of neededByProduct) {
      const otherReserved = reservedForProduct(productId, selected.activeAppointmentId || selected.id);
      const available = stockOf(productId);
      if (needed + otherReserved > available) {
        const p = prod(productId);
        return `Nem zárható le: ${p.name} készlethiányos. Raktáron: ${available} db, más munkákhoz lefoglalva: ${otherReserved} db, ehhez az időponthoz szükséges: ${needed} db.`;
      }
    }

    const shortageMaterial = materialInventory.find((item: any) => {
      const needed = usedMaterialAmountForStock(item.name);
      return needed + materialReserved(item.name, selected.activeAppointmentId || selected.id) > item.stock;
    });
    if (shortageMaterial) {
      const used = usedMaterialAmountForStock(shortageMaterial.name);
      const otherReserved = materialReserved(shortageMaterial.name, selected.activeAppointmentId || selected.id);
      return `Nem zárható le: ${shortageMaterial.name} készlethiányos. Raktáron: ${shortageMaterial.stock} ${shortageMaterial.unit}, más munkákhoz lefoglalva: ${otherReserved} ${shortageMaterial.unit}, ehhez az időponthoz szükséges: ${used} ${shortageMaterial.unit}.`;
    }

    return "";
  }

  async function deductStockIfNeeded(): Promise<StockDeductionSnapshot | undefined> {
    if (selected.stockDeducted) return undefined;

    const changedInventory: InventoryItem[] = [];
    const nextInventory = inventory.map(item => {
      const used = quoteItems
        .filter(q => q.productId === item.productId)
        .reduce((sum, q) => sum + itemQuantity(q), 0);
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

    await Promise.all([
      ...changedInventory.map((item) => persistClimateStock(item.productId, item.stock)),
      ...changedMaterials.map((item) => persistMaterialStock(item)),
    ]);

    setInventory(nextInventory);
    setMaterialInventory(nextMaterials);
    return {
      inventoryBefore: inventory,
      materialInventoryBefore: materialInventory,
    };
  }

  async function restoreStockDeduction(snapshot?: StockDeductionSnapshot) {
    if (!snapshot) return;
    await Promise.all([
      ...snapshot.inventoryBefore.map((item) => persistClimateStock(item.productId, item.stock)),
      ...snapshot.materialInventoryBefore.map((item: any) => persistMaterialStock(item)),
    ]);
    setInventory(snapshot.inventoryBefore);
    setMaterialInventory(snapshot.materialInventoryBefore);
  }

  async function markInstallationDone() {
    const currentAppointmentType = normalizeAppointmentType(selected.appointmentType);

    if (currentAppointmentType === "survey") {
      const changedAt = new Date().toISOString();
      const updated: Customer = {
        ...selected,
        quoteItems: quoteItems.length ? quoteItems : selected.quoteItems || EMPTY_QUOTE_ITEMS,
        isFresh: true,
        updatedAt: changedAt,
      };

      try {
        await persistCustomerToDb(updated);
        await logDocument(updated, "survey_done", "Felmérés megtörtént", "Kész", changedAt);
        setSelected(updated);
        promoteCustomerWork(updated);
        setAllowWorkResourceEdit(false);
        setScheduleAppointmentType("installation");
        setScheduleTime("08:00");
        setMessage("Felmérés kész ✅ Következhet az árajánlat.");
        navigateToView("quote");
      } catch (error: any) {
        setMessage(`Mentési hiba: ${error.message}`);
      }
      return;
    }

    if (currentAppointmentType === "maintenance") {
      const maintenanceReport = savedReportFor(selected, "maintenance");
      if (!maintenanceReport?.id || !hasValidWorkReportSignature(maintenanceReport)) {
        setMessage("Karbantartás lezárása előtt készítsd el és írasd alá a karbantartási munkalapot.");
        return;
      }

      const changedAt = new Date().toISOString();
      const updated: Customer = {
        ...selected,
        quoteItems,
        status: "Lezárva",
        isFresh: false,
        stockDeducted: selected.stockDeducted,
        updatedAt: changedAt,
      };

      try {
        await persistCustomerToDb(updated);
        await logDocument(updated, "maintenance_done", "Karbantartás lezárva", "Kész", changedAt);
        setSelected(updated);
        updateWorkHistory(updated);
        setAllowWorkResourceEdit(false);
        setMessage("Karbantartás lezárva ✅ Visszanézhető a Lezárt / lemondott ügyfelek között.");
        replaceView("work");
      } catch (error: any) {
        setMessage(`Mentési hiba: ${error.message}`);
      }
      return;
    }

    const isInstallation = isInstallationAppointment(currentAppointmentType);
    const error = isInstallation ? stockErrorMessage() : "";
    if (error) {
      setMessage(error);
      return;
    }

    const changedAt = new Date().toISOString();
    const updated: Customer = {
      ...selected,
      quoteItems,
      status: "Szerelés kész – admin folyamatban",
      isFresh: false,
      stockDeducted: isInstallation ? true : selected.stockDeducted,
      updatedAt: changedAt,
    };

    let stockRollback: StockDeductionSnapshot | undefined;
    try {
      if (isInstallation) stockRollback = await deductStockIfNeeded();
      await persistCustomerToDb(updated);
      await logDocument(updated, "installation_done", `${appointmentTypeLabel(updated.appointmentType)} kész – admin folyamatban`, "Kész", changedAt);
      setSelected(updated);
      promoteCustomerWork(updated);
      setAllowWorkResourceEdit(false);
      setMessage(`${appointmentTypeLabel(updated.appointmentType)} kész ✅ Admin még folyamatban.`);
      replaceView("work");
    } catch (error: any) {
      if (stockRollback) {
        try {
          await restoreStockDeduction(stockRollback);
        } catch (restoreError: any) {
          setMessage(`Mentési hiba: ${error.message}. A készlet visszaállítása sem sikerült: ${restoreError.message}`);
          return;
        }
      }
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  async function closeWork() {
    const isInstallation = isInstallationAppointment(selected.appointmentType);
    const error = isInstallation ? stockErrorMessage() : "";
    if (error) {
      setMessage(error);
      return;
    }

    if (!checklistReady) {
      setMessage(`Nem zárható teljesen. Hiányzik: ${missingChecklist.join(", ")}.`);
      return;
    }

    const changedAt = new Date().toISOString();
    const updated: Customer = {
      ...selected,
      quoteItems,
      status: "Lezárva",
      isFresh: false,
      stockDeducted: isInstallation ? true : selected.stockDeducted,
      updatedAt: changedAt,
    };

    let stockRollback: StockDeductionSnapshot | undefined;
    try {
      if (isInstallation) stockRollback = await deductStockIfNeeded();
      await persistCustomerToDb(updated);
      await logDocument(updated, "work_closed", "Teljes lezárás", "Lezárva", changedAt);
      setSelected(updated);
      promoteCustomerWork(updated);
      setAllowWorkResourceEdit(false);
      setMessage("Munka teljesen lezárva ✅ A naptárban sötétzöld lezárt munkaként megmarad.");
      returnToLastMenu();
    } catch (error: any) {
      if (stockRollback) {
        try {
          await restoreStockDeduction(stockRollback);
        } catch (restoreError: any) {
          setMessage(`Mentési hiba: ${error.message}. A készlet visszaállítása sem sikerült: ${restoreError.message}`);
          return;
        }
      }
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }

  async function cancelAppointment() {
    const changedAt = new Date().toISOString();
    const currentAppointmentType = normalizeAppointmentType(selected.appointmentType);

    if (currentAppointmentType === "maintenance") {
      const installationReport = savedReportFor({ ...selected, activeWorkReportId: undefined, appointmentType: "installation" }, "installation");
      const restoredStatus = restoredInstallationStatusAfterMaintenance(selected);
      const restored: Customer = {
        ...selected,
        date: installationReport?.workDate || undefined,
        time: installationReport?.workTime || undefined,
        appointmentType: "installation",
        activeAppointmentId: undefined,
        activeWorkReportId: undefined,
        status: restoredStatus,
        isFresh: restoredStatus !== "Lezárva",
        updatedAt: changedAt,
      };

      try {
        await logDocument(selected, maintenanceCancellationDocumentType(selected, changedAt), maintenanceCancellationTitle(selected), "Lemondva", changedAt);
        await cancelAppointmentWithJobMirror(selected, changedAt);
        const persisted = await persistCustomerToDb(restored);
        const savedRestored: Customer = {
          ...restored,
          activeAppointmentId: persisted?.appointmentId || restored.activeAppointmentId,
          activeQuoteId: persisted?.quoteId || restored.activeQuoteId,
        };
        setSelected(savedRestored);
        setScheduleAppointmentType("installation");
        setScheduleDate(savedRestored.date || todayIso());
        setScheduleTime(firstAppointmentTime(savedRestored.time || "08:00"));
        setAllowWorkResourceEdit(false);
        setCustomers(prev => prev.map(c => c.id === savedRestored.id ? savedRestored : c));
        setMessage("Karbantartási időpont lemondva ✅ A klímaszerelés és a korábbi dokumentumok megmaradtak.");
        replaceView("work");
      } catch (error: any) {
        setMessage(`Mentési hiba: ${error.message}`);
      }
      return;
    }

    const updated: Customer = {
      ...selected,
      date: undefined,
      time: undefined,
      appointmentType: selected.appointmentType,
      status: "Lemondva",
      isFresh: false,
      updatedAt: changedAt,
    };

    try {
      await persistCustomerToDb(updated);
      const cancelledUpdated: Customer = { ...updated, activeAppointmentId: undefined };
      setSelected(cancelledUpdated);
      promoteCustomerWork(cancelledUpdated);
      setMessage("Időpont törölve / lemondva ✅ A foglalás felszabadult.");
      returnToLastMenu();
    } catch (error: any) {
      setMessage(`Mentési hiba: ${error.message}`);
    }
  }
  async function restoreArchivedCustomer(customer: Customer) {
    const changedAt = new Date().toISOString();
    const restored: Customer = {
      ...customer,
      status: customer.date ? "Időpont foglalva" : "Visszahívandó",
      isFresh: true,
      updatedAt: changedAt,
    };

    try {
      await persistCustomerToDb(restored);
      setCustomers((prev) => prev.map((item) => item.id === restored.id ? restored : item));
      setSelected(restored);
      setMessage(`${restored.name || "Ügyfél"} visszaállítva ✅`);
      navigateToView(restored.date ? "work" : "lead");
    } catch (error: any) {
      setMessage(`Visszaállítási hiba: ${error.message}`);
    }
  }

  function startMaintenanceForCustomer(customer: Customer) {
    const changedAt = new Date().toISOString();
    const installationItems = cleanQuoteItems(customerInstallationWorks(customer).flatMap((work) => work.quoteItems || []));
    const maintenanceCustomer: Customer = {
      ...customer,
      date: undefined,
      time: undefined,
      appointmentType: "maintenance",
      activeAppointmentId: undefined,
      activeQuoteId: undefined,
      activeWorkReportId: undefined,
      status: "Időpont foglalva",
      stockDeducted: false,
      isFresh: true,
      updatedAt: changedAt,
    };

    setSelected(maintenanceCustomer);
    setQuoteItems(installationItems.length ? installationItems : customer.quoteItems || EMPTY_QUOTE_ITEMS);
    setScheduleDate(todayIso());
    setScheduleTime("08:00");
    setScheduleAppointmentType("maintenance");
    setSendAppointmentNotice(true);
    setAllowWorkResourceEdit(false);
    setMessage("Karbantartási időpont választható ✅");
    navigateToView("schedule");
  }

  function addExtraMaterial() { setMaterials(prev=>[...prev, { name:"Egyéb anyag", qty:"1", unit:"db", isExtra:true }]); }
  function updateMaterial(i:number, key:"name"|"qty"|"unit", value:string) {
    setMaterials(prev=>prev.map((m,idx)=>idx===i ? {...m, [key]:value} : m));
  }


  function reservedForProduct(productId: string, excludeWorkId?: string) {
    return allWorkCustomers
      .filter((customer) => !shouldExcludeReservedWork(customer, excludeWorkId) && Boolean(customer.date) && isInstallationAppointment(customer.appointmentType) && customer.status !== "Lezárva" && customer.status !== "Lemondva" && !customer.stockDeducted)
      .reduce((sum, customer) => {
        const items = customer.quoteItems ?? [];
        return sum + items
          .filter((item) => item.productId === productId)
          .reduce((itemSum, item) => itemSum + itemQuantity(item), 0);
      }, 0);
  }

  function stockOf(productId: string) {
    return inventory.find((item) => item.productId === productId)?.stock ?? 0;
  }

  function freeStock(productId: string) {
    return stockOf(productId) - reservedForProduct(productId);
  }

  function shouldExcludeReservedWork(customer: Customer, excludeWorkId?: string) {
    if (!excludeWorkId) return false;
    if (customer.activeAppointmentId) return customer.activeAppointmentId === excludeWorkId;
    return customer.id === excludeWorkId;
  }

  async function addStock(productId: string, amount: number) {
    if (!Number.isFinite(amount) || amount === 0) return;
    const nextStock = Math.max(0, stockOf(productId) + amount);
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

  function materialReserved(materialName: string, excludeWorkId?: string) {
    const activeJobs = allWorkCustomers.filter((customer: any) => !shouldExcludeReservedWork(customer, excludeWorkId) && Boolean(customer.date) && isInstallationAppointment(customer.appointmentType) && customer.status !== "Lezárva" && customer.status !== "Lemondva" && !customer.stockDeducted);

    return Math.round(activeJobs.reduce((sum: number, customer: any) => {
      const items = customer.quoteItems ?? [];
      const climateCount = Math.max(1, items.reduce((s: number, item: any) => s + itemQuantity(item), 0));

      // Ha az aktuálisan megnyitott munkán módosítod az anyagmennyiséget,
      // akkor a raktár lefoglalás és a készlethiány figyelmeztetés már ezt vegye figyelembe.
      if (customer.id === selected.id) {
        return sum + usedMaterialAmountForStock(materialName);
      }

      return sum + (baseMaterialAmountPerClimate(materialName) * climateCount);
    }, 0) * 10) / 10;
  }

  async function addMaterialStock(materialName: string, amount: number) {
    if (!Number.isFinite(amount) || amount === 0) return;
    const current = materialInventory.find((item: any) => item.name === materialName);
    if (!current) return;
    const nextItem = { ...current, stock: Math.max(0, Math.round((Number(current.stock || 0) + amount) * 10) / 10) };
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

  if (dataLoading && !initialDataReady) {
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
        onBack={() => goBack()}
        onOpenTask={openTask}
        onOpenCustomer={openCustomer}
        onOpenWarehouse={() => navigateToView("warehouse")}
      />
    );
  }

  if (view === "archive") {
    return (
      <ArchivePanel
        filteredArchivedCustomers={filteredArchivedCustomers}
        visibleArchivedCustomers={visibleArchivedCustomers}
        currentPage={archivePagination.currentPage}
        pageCount={archivePagination.pageCount}
        pageSize={LIST_PAGE_SIZE}
        hasCustomerFilter={hasCustomerFilter}
        searchPanel={renderCustomerSearchPanel("Archív kereső")}
        onBack={() => goBack()}
        onPageChange={setArchivePage}
        onOpenCustomer={openCustomer}
        onRestoreCustomer={restoreArchivedCustomer}
        onScheduleMaintenance={startMaintenanceForCustomer}
      />
    );
  }

  if (view === "warehouse") {
    return (
      <WarehousePanel
        onBack={() => goBack()}
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


  function quotePayload(customer: Customer = selected, items: QuoteItem[] = quoteItems, issuedAt = quoteIssuedAt || new Date().toISOString()) {
    const quoteTotal = total(items);
    const quoteCount = qty(items);
    const installerAmount = quoteInstallTotal(items);
    const materialAmount = Math.max(0, quoteTotal - installerAmount);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        city: customer.city,
        postalCode: customer.postalCode,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        need: customer.need,
        date: customer.date,
        time: customer.time,
        appointmentType: normalizeAppointmentType(customer.appointmentType),
      },
      pricingMode: customer.quotePricingMode || "bundle",
      quoteIssuedAt: issuedAt,
      items: items.map((item) => ({
        name: itemName(item),
        quantity: itemQuantity(item),
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
    setMessage("Ajánlat email küldése folyamatban...");

    try {
      const issuedAt = view === "quotePreview" && quoteIssuedAt ? quoteIssuedAt : new Date().toISOString();
      setQuoteIssuedAt(issuedAt);

      const response = await fetch("/api/send-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quotePayload(selected, quoteItems, issuedAt)),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result?.error || "Nem sikerült elküldeni az ajánlat emailt.");
      }

      const quoteSentAt = new Date().toISOString();
      const updated: Customer = {
        ...selected,
        status: "Ajánlat elküldve",
        quoteItems,
        quotePricingMode: selected.quotePricingMode || "bundle",
        quoteSentAt,
        updatedAt: quoteSentAt,
      };

      await persistCustomerToDb(updated);
      await logDocument(updated, "quote_email", "Ajánlat email", "Elküldve", quoteSentAt);
      setSelected(updated);
      setCustomers((prev) => prev.map((customer) => customer.id === updated.id ? updated : customer));
      clearCustomerDraft(updated.id);
      setDraftNotice(readCustomerDraft());
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

      const appointmentEmailSentAt = new Date().toISOString();
      if (normalizeAppointmentType(customer.appointmentType) !== "maintenance") {
        await logDocument(customer, appointmentEmailDocumentType(customer.appointmentType), appointmentDocumentTitle(customer.appointmentType), "Elküldve", appointmentEmailSentAt);
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

  async function sendQuickAppointmentEmail() {
    if (!quickAppointmentEmailPrompt) return;
    const sent = await sendAppointmentEmailFor(quickAppointmentEmailPrompt);
    if (sent) setQuickAppointmentEmailPrompt(null);
  }

  function skipQuickAppointmentEmail() {
    setQuickAppointmentEmailPrompt(null);
    setMessage("Időpont mentve email küldése nélkül ✅");
  }


  async function sendThankYouEmailFor(customer: Customer = selected) {
    const targetCustomer = {
      ...customer,
      quoteItems: customer.quoteItems?.length ? customer.quoteItems : quoteItems,
      appointmentType: "installation" as AppointmentType,
    };

    if (!targetCustomer.email?.trim()) {
      setMessage("A köszönő email elküldéséhez előbb add meg az ügyfél email címét.");
      return false;
    }

    const installationDone = targetCustomer.status === "Szerelés kész – admin folyamatban" || targetCustomer.status === "Lezárva" || Boolean(targetCustomer.stockDeducted) || Boolean(savedReportFor(targetCustomer, "installation")?.id);
    if (!installationDone) {
      setMessage("A köszönő emailt a telepítés után érdemes elküldeni.");
      return false;
    }

    setThankYouEmailBusy(true);
    setMessage("Köszönő email küldése folyamatban...");

    try {
      const response = await fetch("/api/send-thank-you", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quotePayload(targetCustomer, targetCustomer.quoteItems || quoteItems)),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result?.error || "Nem sikerült elküldeni a köszönő emailt.");
      }

      const sentAt = new Date().toISOString();
      await logDocument(targetCustomer, "thank_you_email", "Köszönő email", "Elküldve", sentAt);
      setMessage("Köszönő email elküldve ✅");
      return true;
    } catch (error: any) {
      setMessage(`Köszönő email küldési hiba: ${error.message}`);
      return false;
    } finally {
      setThankYouEmailBusy(false);
    }
  }


  function workReportPayload(report: WorkReport = workReport, customer: Customer = selected) {
    const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
    const declarationItems = items.filter((_, index) => purchaseDeclarationItemKeys.includes(String(index)));
    const seller = sellerSnapshot(sellerCompanies, selectedSellerId);
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        city: customer.city,
        postalCode: customer.postalCode,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        need: customer.need,
        date: customer.date,
        time: customer.time,
        appointmentType: normalizeAppointmentType(customer.appointmentType),
      },
      pricingMode: customer.quotePricingMode || "bundle",
      items: items.map((item) => ({
        name: itemName(item),
        quantity: itemQuantity(item),
        unitPrice: itemUnitPrice(item),
        totalPrice: itemTotal(item),
      })),
      purchaseDeclaration: {
        seller,
        items: (declarationItems.length ? declarationItems : items).map((item) => ({
          name: itemName(item),
          quantity: itemQuantity(item),
          unitPrice: itemUnitPrice(item),
          totalPrice: itemTotal(item),
        })),
      },
      report: {
        workDescription: report.workDescription,
        notes: report.notes,
        signatureDataUrl: report.signatureDataUrl,
        signerName: report.signerName || customer.name,
        signedAt: report.signedAt,
        workDate: report.workDate || customer.date,
        workTime: report.workTime || customer.time,
      },
    };
  }

  function workReportsForCustomer(customer: Customer, type?: AppointmentType) {
    if (!customer.id) return [];
    return sortWorkReportsByDateDesc(
      Object.values(workReportsByCustomer).filter((report) => (
        report.customerId === customer.id && (!type || normalizeAppointmentType(report.appointmentType) === type)
      ))
    );
  }

  function reportStatusText(report?: WorkReport) {
    if (!report) return "Nincs kész";
    const signatureState = workReportSignatureState(report);
    if (signatureState === "sent_signed") return "Aláírva, elküldve";
    if (signatureState === "signed") return "Aláírva, elkészült";
    if (signatureState === "sent_unsigned") return "Elküldve, aláírásra vár";
    if (report.id) return "Mentve, aláírásra vár";
    return "Nincs kész";
  }

  function formatReportDateLabel(report: WorkReport | Pick<Customer, "date" | "time" | "appointmentType">) {
    const date = (report as WorkReport).workDate || (report as Pick<Customer, "date" | "time" | "appointmentType">).date;
    const time = (report as WorkReport).workTime || (report as Pick<Customer, "date" | "time" | "appointmentType">).time;
    if (!date) return "nincs dátum";
    return `${date.replaceAll("-", ".")} · ${firstAppointmentTime(time || "08:00")}`;
  }

  function maintenanceCancellationTitle(customer: Customer) {
    return `Karbantartási időpont lemondva · ${formatReportDateLabel(customer)}`;
  }

  function maintenanceRowSortValue(row: PageDocumentRow) {
    const date = row.reportDate || "0000-00-00";
    const time = firstAppointmentTime(row.reportTime || "00:00") || "00:00";
    return `${date}T${time}`;
  }

  function maintenanceCancellationRowsFor(customer: Customer): PageDocumentRow[] {
    return docsFor(customer)
      .filter((doc) => doc.type.startsWith("maintenance_cancelled"))
      .map((doc) => {
        const label = (doc.title || "").replace(/^Karbantartási időpont lemondva\s*·\s*/, "") || formatQuoteSentAt(doc.sentAt || doc.createdAt);
        const dateMatch = label.match(/(\d{4})[.\- ](\d{2})[.\- ](\d{2})/);
        const timeMatch = label.match(/(\d{1,2}:\d{2})/);
        const reportDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : doc.sentAt?.slice(0, 10) || doc.createdAt?.slice(0, 10);
        return {
          title: "Karbantartási időpont lemondva",
          status: "Lemondva",
          action: "MaintenanceCancelled",
          appointmentType: "maintenance" as AppointmentType,
          reportDate,
          reportTime: timeMatch?.[1],
          reportDateLabel: label,
        };
      });
  }

  function restoredInstallationStatusAfterMaintenance(customer: Customer) {
    if (customer.status === "Lezárva") return "Lezárva";
    const installationReport = savedReportFor({ ...customer, activeWorkReportId: undefined, appointmentType: "installation" }, "installation");
    if (installationReport?.id || customer.stockDeducted) return "Lezárva";
    return "Visszahívandó";
  }

  function errorMentionsWorkReportType(error: any) {
    const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
    return text.includes("appointment_type") || text.includes("work_reports_customer_appointment_type_uidx");
  }

  function errorMentionsWorkReportHistoryLink(error: any) {
    const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
    return text.includes("appointment_id") || text.includes("legacy_source_key");
  }

  function checklistCompletedAtFromRow(row: any): WorkChecklistCompletedAt {
    const raw = row?.completed_at;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    ) as WorkChecklistCompletedAt;
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
      completedAt: checklistCompletedAtFromRow(row),
    };
  }

  function effectiveChecklistFor(
    customer: Customer = selected,
    reportsMap: Record<string, WorkReport> = workReportsByCustomer,
    docsMap: Record<string, DocumentRecord[]> = documentsByCustomer,
    checklistsMap: Record<string, WorkChecklistState> = workChecklistsByCustomer
  ): WorkChecklistState {
    if (!customer.id) return { ...workChecklist, completedAt: { ...(workChecklist.completedAt || {}) } };

    const saved = checklistsMap[workScopeKey(customer)] || (!customer.activeAppointmentId ? checklistsMap[customer.id] : undefined) || EMPTY_WORK_CHECKLIST;
    const report = customer.activeAppointmentId
      ? Object.values(reportsMap).find((item) => (
          item.customerId === customer.id
          && item.appointmentId === customer.activeAppointmentId
          && normalizeAppointmentType(item.appointmentType) === "installation"
        ))
      : reportsMap[customer.id] || reportsMap[workReportMapKey(customer.id, "installation")] || Object.values(reportsMap).find((item) => item.customerId === customer.id && normalizeAppointmentType(item.appointmentType) === "installation");
    const docs = documentsForCustomerScope(customer, docsMap[customer.id] || []);
    const workDoc = docs.find((doc) => doc.type === "work_report");
    const purchaseDoc = docs.find((doc) => doc.type === "purchase_declaration");

    const workAndDeclarationReady = hasValidWorkReportSignature(report);
    const documentsSent = Boolean(
      saved.docsSent || report?.emailSentAt || statusMeansSent(workDoc?.status) || statusMeansSent(purchaseDoc?.status)
    );

    const workDoneAt = workAndDeclarationReady ? report?.signedAt : undefined;
    const docsSentAt = report?.emailSentAt || workDoc?.sentAt || workDoc?.updatedAt || workDoc?.createdAt || purchaseDoc?.sentAt || purchaseDoc?.updatedAt || purchaseDoc?.createdAt;
    const completedAt: WorkChecklistCompletedAt = { ...(saved.completedAt || {}) };

    (["worksheet", "signature", "purchaseDeclaration"] as WorkChecklistItemKey[]).forEach((key) => {
      if (workAndDeclarationReady) completedAt[key] = completedAt[key] || workDoneAt;
      else delete completedAt[key];
    });
    if (documentsSent) completedAt.docsSent = completedAt.docsSent || docsSentAt;
    else delete completedAt.docsSent;

    (["nkvh", "alinInvoice", "amovaInvoice"] as WorkChecklistItemKey[]).forEach((key) => {
      if (!saved[key]) delete completedAt[key];
    });

    return {
      ...EMPTY_WORK_CHECKLIST,
      ...saved,
      worksheet: workAndDeclarationReady,
      signature: workAndDeclarationReady,
      purchaseDeclaration: workAndDeclarationReady,
      docsSent: documentsSent,
      completedAt,
    };
  }

  function reportDateSortValue(report: WorkReport) {
    const date = report.workDate || report.signedAt?.slice(0, 10) || report.createdAt?.slice(0, 10) || "0000-00-00";
    const time = firstAppointmentTime(report.workTime || "00:00") || "00:00";
    return `${date}T${time}`;
  }

  function compareWorkReportsDesc(a: WorkReport, b: WorkReport) {
    return reportDateSortValue(b).localeCompare(reportDateSortValue(a));
  }

  function maintenanceReportsFor(customer: Customer = selected) {
    if (!customer.id) return [];
    const cached = maintenanceReportsByCustomer[customer.id] || [];
    return [...cached].sort(compareWorkReportsDesc);
  }

  function formatMaintenanceReportDate(report: WorkReport) {
    const dateValue = report.workDate || report.signedAt?.slice(0, 10) || report.createdAt?.slice(0, 10);
    const timeValue = firstAppointmentTime(report.workTime || "");
    let dateText = dateValue || "dátum nélkül";
    if (dateValue) {
      const date = new Date(`${dateValue}T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        dateText = date.toLocaleDateString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit" });
      }
    }
    return [dateText, timeValue].filter(Boolean).join(" · ");
  }

  function maintenanceReportStatus(report: WorkReport) {
    const signatureState = workReportSignatureState(report);
    if (signatureState === "sent_signed") return "Aláírva, elküldve";
    if (signatureState === "signed") return "Aláírva";
    if (signatureState === "sent_unsigned") return "Elküldve, aláírásra vár";
    if (report.id) return "Mentve";
    return "Nincs kész";
  }

  function currentMaintenanceReportFor(customer: Customer) {
    if (normalizeAppointmentType(customer.appointmentType) !== "maintenance") return undefined;
    if (customer.activeAppointmentId) {
      const exact = maintenanceReportsFor(customer).find((report) => report.appointmentId === customer.activeAppointmentId);
      if (exact) return exact;
    }
    const currentDate = customer.date || scheduleDate;
    const currentTime = firstAppointmentTime(customer.time || scheduleTime || "");
    return maintenanceReportsFor(customer).find((report) => {
      const reportDate = report.workDate || report.signedAt?.slice(0, 10) || report.createdAt?.slice(0, 10);
      const reportTime = firstAppointmentTime(report.workTime || "");
      return Boolean(reportDate && currentDate && reportDate === currentDate && (!currentTime || !reportTime || reportTime === currentTime));
    });
  }

  function savedReportFor(customer: Customer = selected, type: AppointmentType = normalizeAppointmentType(customer.appointmentType)) {
    if (!customer.id) return undefined;
    const normalizedType = normalizeAppointmentType(type);

    if (normalizedType === "maintenance") {
      const reports = maintenanceReportsFor(customer);
      if (customer.activeWorkReportId) {
        const exact = reports.find((report) => report.id === customer.activeWorkReportId);
        if (exact) return exact;
      }
      if (workReport.customerId === customer.id && normalizeAppointmentType(workReport.appointmentType) === "maintenance") {
        if (!customer.activeWorkReportId || workReport.id === customer.activeWorkReportId || sameReportAppointment(workReport, customer)) return workReport;
      }
      return currentMaintenanceReportFor(customer);
    }

    if (customer.activeAppointmentId) {
      const exact = Object.values(workReportsByCustomer).find((report) => (
        report.customerId === customer.id
        && report.appointmentId === customer.activeAppointmentId
        && normalizeAppointmentType(report.appointmentType) === normalizedType
      ));
      if (exact) return exact;

      if (
        workReport.customerId === customer.id
        && workReport.appointmentId === customer.activeAppointmentId
        && normalizeAppointmentType(workReport.appointmentType) === normalizedType
      ) return workReport;

      const dateMatchedLegacyReport = Object.values(workReportsByCustomer).find((report) => (
        report.customerId === customer.id
        && !report.appointmentId
        && normalizeAppointmentType(report.appointmentType) === normalizedType
        && sameReportAppointment(report, customer)
      ));
      return dateMatchedLegacyReport;
    }

    if (
      workReport.customerId === customer.id
      && normalizeAppointmentType(workReport.appointmentType) === normalizedType
      && (!customer.activeAppointmentId || !workReport.appointmentId || workReport.appointmentId === customer.activeAppointmentId)
    ) return workReport;
    const key = workReportMapKey(customer.id, normalizedType);
    return workReportsByCustomer[key] || Object.values(workReportsByCustomer).find((report) => report.customerId === customer.id && normalizeAppointmentType(report.appointmentType) === normalizedType);
  }

  function docsFor(customer: Customer) {
    return customer.id ? documentsForCustomerScope(customer, documentsByCustomer[customer.id] || []) : [];
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
    return doc?.sentAt || doc?.updatedAt || doc?.createdAt || customer.quoteSentAt;
  }

  function customerHasSentQuote(customer: Customer) {
    return normalizeStatus(customer.status) === "Ajánlat elküldve";
  }

  function customerStatusLabel(customer: Customer) {
    const status = customer.status || "nincs státusz";
    if (status === "Időpont foglalva" && customer.date) return `${status} · ${appointmentSummaryLabel(customer)}`;
    if (status !== "Ajánlat elküldve") return status;
    const sentAt = quoteSentAtFor(customer);
    return sentAt ? `${status} · ${formatQuoteSentAt(sentAt)}` : status;
  }

  async function logDocument(customer: Customer, type: string, title: string, status = "Elküldve", eventAt?: string) {
    if (!customer.id || !user) return;

    const timestamp = eventAt || new Date().toISOString();
    const shouldStoreTimestamp = Boolean(eventAt) || status.toLowerCase().includes("elküld");
    const payload = {
      customer_id: customer.id,
      appointment_id: customer.activeAppointmentId || null,
      document_type: type,
      title,
      status,
      sent_at: shouldStoreTimestamp ? timestamp : null,
      created_by: user.id,
    };

    const { data, error } = await supabase
      .from("documents")
      .upsert(payload, { onConflict: customer.activeAppointmentId ? "customer_id,document_type,appointment_id" : "customer_id,document_type" })
      .select("*")
      .single();
    if (error && customer.activeAppointmentId) {
      const { appointment_id, ...legacyPayload } = payload;
      const retry = await supabase
        .from("documents")
        .upsert(legacyPayload, { onConflict: "customer_id,document_type" })
        .select("*")
        .single();
      if (retry.error) return undefined;
      const saved = documentFromRow(retry.data);
      setDocumentsByCustomer((prev) => {
        const current = prev[customer.id] || [];
        const withoutCurrent = current.filter((doc) => doc.type !== saved.type);
        return { ...prev, [customer.id]: [saved, ...withoutCurrent] };
      });
      return saved;
    }
    if (error) return undefined;

    const saved = documentFromRow(data);
    setDocumentsByCustomer((prev) => {
      const current = prev[customer.id] || [];
      const withoutCurrent = current.filter((doc) => doc.type !== saved.type || doc.appointmentId !== saved.appointmentId);
      return { ...prev, [customer.id]: [saved, ...withoutCurrent] };
    });
    return saved;
  }

  function hasCustomerSignature(customer: Customer, type: AppointmentType = normalizeAppointmentType(customer.appointmentType)) {
    const report = type === "maintenance" ? currentMaintenanceReportFor(customer) : savedReportFor(customer, type);
    return hasValidWorkReportSignature(report);
  }

  function workReportDocumentStatus(customer: Customer, type: AppointmentType = normalizeAppointmentType(customer.appointmentType)) {
    const report = savedReportFor(customer, type);
    const signatureState = workReportSignatureState(report);
    if (signatureState === "sent_signed") return "Aláírva, elküldve";
    if (signatureState === "signed") return "Aláírva, elkészült";
    if (signatureState === "sent_unsigned") return "Elküldve, aláírásra vár";
    if (report?.id) return "Mentve, aláírásra vár";
    return "Nincs kész";
  }

  function purchaseDeclarationStatus(customer: Customer, type: AppointmentType = "installation") {
    const report = savedReportFor(customer, type);
    const signatureState = workReportSignatureState(report);
    if (signatureState === "sent_signed") return "Elkészült, elküldve";
    if (signatureState === "signed") return "Elkészült";
    if (signatureState === "sent_unsigned") return "Elküldve, aláírásra vár";
    if (report?.id) return "Aláírásra vár";
    return "Aláírásra vár";
  }

  function workAndDeclarationStatus(customer: Customer, type: AppointmentType = "installation") {
    const report = savedReportFor(customer, type);
    const signatureState = workReportSignatureState(report);
    if (signatureState === "sent_signed") return "Elkészült, elküldve";
    if (signatureState === "signed") return "Elkészült";
    if (signatureState === "sent_unsigned") return "Elküldve, aláírásra vár";
    if (report?.id) return "Mentve, aláírásra vár";
    return "Nincs kész";
  }

  function timestampForDocument(customer: Customer, type: string) {
    const doc = docFor(customer, type);
    return doc?.sentAt || doc?.updatedAt || doc?.createdAt || undefined;
  }

  function timestampForReport(report?: WorkReport) {
    return hasValidWorkReportSignature(report) ? report?.signedAt || report?.updatedAt || report?.createdAt : undefined;
  }

  function workActionDatesFor(customer: Customer): WorkActionDates {
    const type = normalizeAppointmentType(customer.appointmentType);
    const report = savedReportFor(customer, type);
    const installationDoneAt = timestampForDocument(customer, "installation_done") || (
      type === "installation" && (customer.status === "Szerelés kész – admin folyamatban" || customer.status === "Lezárva")
        ? customer.updatedAt
        : undefined
    );

    return {
      appointmentEmail: timestampForDocument(customer, appointmentEmailDocumentType(type)),
      workReport: timestampForReport(report),
      workDone: installationDoneAt,
      surveyDone: timestampForDocument(customer, "survey_done"),
      maintenanceDone: timestampForDocument(customer, "maintenance_done"),
      fullClose: timestampForDocument(customer, "work_closed") || (type === "installation" && customer.status === "Lezárva" ? customer.updatedAt : undefined),
    };
  }

  function documentRowsFor(customer: Customer): PageDocumentRow[] {
    const currentAppointmentType = normalizeAppointmentType(customer.appointmentType);
    const quoteDoc = docFor(customer, "quote_email");
    const quoteSentAt = quoteSentAtFor(customer);
    const quoteBaseStatus = quoteDoc?.status || (customer.status === "Ajánlat elküldve" ? "Elküldve" : "Nincs elküldve");
    const quoteDisplayStatus = quoteBaseStatus.includes("Elküld") && quoteSentAt ? `${quoteBaseStatus} · ${formatQuoteSentAt(quoteSentAt)}` : quoteBaseStatus;

    const installationDone = customer.status === "Szerelés kész – admin folyamatban" || customer.status === "Lezárva" || Boolean(customer.stockDeducted) || Boolean(savedReportFor(customer, "installation")?.id);

    const rows: PageDocumentRow[] = [
      { title: "Ajánlat email", status: quoteDisplayStatus, action: "Ajánlat", appointmentType: "installation" as AppointmentType },
      {
        title: "Szerelési időpont-visszaigazolás",
        status: docStatus(customer, appointmentEmailDocumentType("installation"), currentAppointmentType === "installation" && customer.date ? "Időpont rögzítve" : "Nincs időpont"),
        action: "Időpont",
        appointmentType: "installation" as AppointmentType,
      },
      { title: "Munkalap és vásárlási nyilatkozat", status: workAndDeclarationStatus(customer, "installation"), action: "MunkalapNyilatkozat", appointmentType: "installation" as AppointmentType },
    ];

    purchaseDeclarationsFor(customer).forEach((declaration) => {
      rows.push({
        title: `Vásárlási nyilatkozat – ${declaration.sellerName}`,
        status: declaration.signedAt ? "Aláírva" : "Aláírásra vár",
        action: "Nyilatkozat",
        appointmentType: "installation" as AppointmentType,
        reportId: declaration.workReportId,
        purchaseDeclarationId: declaration.id,
      });
    });

    if (installationDone) {
      rows.push({
        title: "Köszönő email",
        status: docStatus(customer, "thank_you_email", "Nem küldve"),
        action: "KoszonoEmail",
        appointmentType: "installation" as AppointmentType,
      });
    }

    const billingConfig = billingUiConfig();
    rows.push(
      { title: `${billingConfig.laborTitle} számla`, status: effectiveChecklistFor(customer).alinInvoice ? "Kész" : "Számlázz.hu később", action: "Számla", appointmentType: "installation" as AppointmentType },
      { title: `${billingConfig.deviceTitle} számla`, status: effectiveChecklistFor(customer).amovaInvoice ? "Kész" : "Számlázz.hu később", action: "Számla", appointmentType: "installation" as AppointmentType },
    );

    return rows;
  }

  function maintenanceDocumentRowsFor(customer: Customer, includeBundle = false): PageDocumentRow[] {
    const existingReports = maintenanceReportsFor(customer);
    const reportRows: PageDocumentRow[] = existingReports.map((report) => ({
      title: `Karbantartási munkalap · ${formatMaintenanceReportDate(report)}`,
      status: maintenanceReportStatus(report),
      action: "MaintenanceReport",
      appointmentType: "maintenance",
      reportId: report.id,
      reportDate: report.workDate,
      reportTime: report.workTime,
      reportDateLabel: formatMaintenanceReportDate(report),
    }));

    const currentType = normalizeAppointmentType(customer.appointmentType);
    const hasCurrentMaintenanceDate = currentType === "maintenance" && Boolean(customer.date);
    const currentAlreadySaved = hasCurrentMaintenanceDate ? existingReports.some((report) => sameReportAppointment(report, customer)) : false;
    const currentRows: PageDocumentRow[] = [];
    if (hasCurrentMaintenanceDate && !currentAlreadySaved) {
      currentRows.push({
        title: `Karbantartási munkalap · ${formatReportDateLabel(customer)}`,
        status: "Munkalap hiányzik",
        action: "MaintenanceReport",
        appointmentType: "maintenance",
        reportDate: customer.date,
        reportTime: customer.time,
        reportDateLabel: formatReportDateLabel(customer),
      });
    }

    const rows = [...currentRows, ...reportRows, ...maintenanceCancellationRowsFor(customer)]
      .sort((a, b) => maintenanceRowSortValue(b).localeCompare(maintenanceRowSortValue(a)));
    const savedRows = reportRows.filter((row) => Boolean(row.reportId));
    if (includeBundle && savedRows.length) {
      return [
        {
          title: `Összes karbantartási munkalap (${savedRows.length} db)`,
          status: "Dátum szerint",
          action: "MaintenanceBundle",
          appointmentType: "maintenance",
          reportDateLabel: savedRows.map((row) => row.reportDateLabel).filter(Boolean).join(" · "),
        },
        ...rows,
      ];
    }

    return rows;
  }




  async function loadWorkReportFor(customer: Customer, reportId?: string) {
    const activeReportId = reportId || customer.activeWorkReportId;
    const targetType = normalizeAppointmentType(customer.appointmentType);
    const emptyReport = {
      ...emptyWorkReport(customer),
      workDate: customer.date || scheduleDate,
      workTime: customer.time || scheduleTime || shownTime,
    };
    setWorkReport(emptyReport);
    if (!customer.id) return;

    if (activeReportId) {
      const cachedReport = maintenanceReportsFor(customer).find((report) => report.id === activeReportId);
      if (cachedReport) {
        setWorkReport({ ...cachedReport, signerName: cachedReport.signerName || customer.name || "" });
        return;
      }

      const { data, error } = await supabase
        .from("work_reports")
        .select("*")
        .eq("id", activeReportId)
        .maybeSingle();

      if (error) {
        setMessage(`Munkalap betöltési hiba: ${error.message}`);
        return;
      }
      if (data) {
        const loadedReport = workReportFromRow(data);
        setWorkReport({ ...loadedReport, signerName: loadedReport.signerName || customer.name || "" });
        if (normalizeAppointmentType(loadedReport.appointmentType) === "maintenance") {
          setMaintenanceReportsByCustomer((prev) => {
            const current = prev[customer.id] || [];
            const without = current.filter((report) => report.id !== loadedReport.id);
            return { ...prev, [customer.id]: [loadedReport, ...without].sort(compareWorkReportsDesc) };
          });
        }
      }
      return;
    }

    if (customer.activeAppointmentId) {
      const cachedAppointmentReport = [
        ...maintenanceReportsFor(customer),
        ...Object.values(workReportsByCustomer).filter((report) => report.customerId === customer.id),
      ].find((report) => report.appointmentId === customer.activeAppointmentId);
      if (cachedAppointmentReport) {
        setWorkReport({ ...cachedAppointmentReport, signerName: cachedAppointmentReport.signerName || customer.name || "" });
        return;
      }

      const { data, error } = await supabase
        .from("work_reports")
        .select("*")
        .eq("appointment_id", customer.activeAppointmentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        const loadedReport = { ...workReportFromRow(data), workDescription: data.work_description || defaultWorkDescription(targetType) };
        setWorkReport({ ...loadedReport, signerName: loadedReport.signerName || customer.name || "" });
        if (normalizeAppointmentType(loadedReport.appointmentType) === "maintenance") {
          setMaintenanceReportsByCustomer((prev) => {
            const current = prev[customer.id] || [];
            const without = current.filter((report) => report.id !== loadedReport.id);
            return { ...prev, [customer.id]: [loadedReport, ...without].sort(compareWorkReportsDesc) };
          });
        } else {
          setWorkReportsByCustomer((prev) => ({ ...prev, [workReportMapKey(customer.id, targetType)]: loadedReport }));
        }
        return;
      }
    }

    if (targetType === "maintenance") {
      const currentReport = currentMaintenanceReportFor(customer);
      if (currentReport) {
        setWorkReport({ ...currentReport, signerName: currentReport.signerName || customer.name || "" });
        return;
      }
      return;
    }

    const alreadyLoaded = savedReportFor(customer, targetType);
    if (alreadyLoaded) {
      setWorkReport({ ...alreadyLoaded, signerName: alreadyLoaded.signerName || customer.name || "" });
      return;
    }

    const query = supabase
      .from("work_reports")
      .select("*")
      .eq("customer_id", customer.id)
      .eq("appointment_type", targetType)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await query;

    if (error) {
      if (targetType === "installation" && errorMentionsWorkReportType(error)) {
        const fallback = await supabase
          .from("work_reports")
          .select("*")
          .eq("customer_id", customer.id)
          .maybeSingle();
        if (fallback.error) {
          setMessage("A munkalap tábla még nincs kész vagy nem tölthető be. Futtasd a munkalap SQL-t a Supabase-ben.");
          return;
        }
        if (fallback.data) {
          const loadedReport = { ...workReportFromRow({ ...fallback.data, appointment_type: "installation" }), workDescription: fallback.data.work_description || defaultWorkDescription("installation") };
          setWorkReport({ ...loadedReport, signerName: loadedReport.signerName || customer.name || "" });
          setWorkReportsByCustomer((prev) => ({ ...prev, [workReportMapKey(customer.id, "installation")]: loadedReport }));
        }
        return;
      }
      setMessage("A munkalap külön mentéséhez futtasd a SUPABASE_WORK_REPORT_TIPUS_OSZLOP.sql fájlt a Supabase-ben.");
      return;
    }

    if (data) {
      const loadedReport = { ...workReportFromRow(data), workDescription: data.work_description || defaultWorkDescription(targetType) };
      setWorkReport({ ...loadedReport, signerName: loadedReport.signerName || customer.name || "" });
      setWorkReportsByCustomer((prev) => ({ ...prev, [workReportMapKey(customer.id, targetType)]: loadedReport }));
    }
  }

  function openWorkReportFor(customer: Customer = selected, reportId?: string) {
    const activeReportId = reportId || customer.activeWorkReportId;
    const customerForReport = { ...customer, activeWorkReportId: activeReportId, quoteItems: customer.quoteItems?.length ? customer.quoteItems : quoteItems };
    setDocumentPreviewReportId(activeReportId);
    setSelected(customerForReport);
    setQuoteItems(customerForReport.quoteItems);
    void loadWorkReportFor(customerForReport, activeReportId);
    navigateToView("workReport");
  }

  function openWorkReport() {
    openWorkReportFor(selected);
  }

  function openDocumentPreview(customer: Customer, type: DocumentPreviewType, purchaseDeclarationId?: string, reportId?: string) {
    const activeReportId = reportId || customer.activeWorkReportId;
    const customerForPreview = { ...customer, activeWorkReportId: activeReportId, quoteItems: customer.quoteItems?.length ? customer.quoteItems : quoteItems };
    setSelected(customerForPreview);
    setQuoteItems(customerForPreview.quoteItems);
    setDocumentPreviewType(type);
    setDocumentPreviewReportId(activeReportId);
    setDocumentPreviewDeclarationId(purchaseDeclarationId);
    setDocumentBackView(view === "documents" ? "documents" : "work");
    if (type === "quote_document") {
      setQuoteIssuedAt(new Date().toISOString());
    }
    if (type === "work_report" || type === "purchase_declaration") {
      void loadWorkReportFor(customerForPreview, activeReportId);
    }
    navigateToView("documentPreview");
  }

  function updateWorkReportField(field: keyof WorkReport, value: string) {
    setWorkReport((prev) => ({ ...prev, [field]: value }));
  }

  function togglePurchaseDeclarationItem(key: string) {
    setPurchaseDeclarationItemKeys((prev) => {
      if (prev.includes(key)) return prev.filter((itemKey) => itemKey !== key);
      return [...prev, key];
    });
  }

  async function addSellerCompany() {
    const seller = {
      name: newSellerName.trim(),
      taxNumber: newSellerTaxNumber.trim(),
      representative: newSellerRepresentative.trim(),
    };
    if (!seller.name || !seller.taxNumber || !seller.representative) {
      setMessage("Az új eladó céghez cégnév, adószám és képviselő neve is szükséges.");
      return;
    }

    const result = await supabase.from("seller_companies").insert(sellerCompanyToRow(seller)).select("*").single();
    if (result.error) {
      setMessage(isMissingSellerTableError(result.error)
        ? "Az eladó cégek mentéséhez előbb futtasd az új Supabase migrációt."
        : `Eladó cég mentési hiba: ${result.error.message}`);
      return;
    }

    const savedSeller = sellerCompanyFromRow(result.data);
    setSellerCompanies((prev) => [...prev.filter((item) => item.id !== savedSeller.id), savedSeller].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, "hu")));
    setSelectedSellerId(savedSeller.id);
    setNewSellerName("");
    setNewSellerTaxNumber("");
    setNewSellerRepresentative("");
    setMessage("Eladó cég mentve.");
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

    if (sendEmail && !hasValidWorkReportSignature(workReport)) {
      setMessage("Küldés előtt szükséges az egyszerű ügyfél aláírás.");
      return;
    }

    const signedAt = hasValidWorkReportSignature(workReport) ? workReport.signedAt : null;
    const reportToSave: WorkReport = {
      ...workReport,
      appointmentId: workReport.appointmentId || selected.activeAppointmentId,
      workDate: workReport.workDate || selected.date || scheduleDate,
      workTime: workReport.workTime || selected.time || shownTime || scheduleTime,
      signerName: workReport.signerName || selected.name,
      signedAt: signedAt || undefined,
    };

    setWorkReportBusy(true);
    setMessage(sendEmail ? "Munkalap mentése és email küldése folyamatban..." : "Munkalap mentése folyamatban...");

    try {
      const currentAppointmentType = normalizeAppointmentType(selected.appointmentType);
      const basePayload = {
        customer_id: selected.id,
        appointment_id: selected.activeAppointmentId || null,
        appointment_type: currentAppointmentType,
        work_date: reportToSave.workDate || selected.date || scheduleDate || null,
        work_time: reportToSave.workTime || selected.time || shownTime || null,
        customer_name: selected.name || null,
        customer_email: selected.email || null,
        customer_phone: selected.phone || null,
        customer_address: fullCustomerAddress(selected) || null,
        climate_summary: climateSummary(quoteItems),
        work_description: reportToSave.workDescription || defaultWorkDescription(selected.appointmentType),
        notes: reportToSave.notes || null,
        signature_data_url: reportToSave.signatureDataUrl || null,
        signer_name: reportToSave.signerName || selected.name || null,
        signed_at: signedAt,
        created_by: user?.id || null,
      };
      const { appointment_id, ...payloadWithoutHistoryLink } = basePayload;

      const currentReportId = workReport.id || reportToSave.id || selected.activeWorkReportId;
      let data: any = null;
      let error: any = null;

      if (currentAppointmentType === "maintenance") {
        const result = currentReportId
          ? await supabase.from("work_reports").update(basePayload).eq("id", currentReportId).select("*").single()
          : await supabase.from("work_reports").insert(basePayload).select("*").single();
        data = result.data;
        error = result.error;
      } else {
        const existingReport = savedReportFor(selected, currentAppointmentType);
        const existingReportId = currentReportId || existingReport?.id;
        const result = existingReportId
          ? await supabase.from("work_reports").update(basePayload).eq("id", existingReportId).select("*").single()
          : await supabase.from("work_reports").insert(basePayload).select("*").single();
        data = result.data;
        error = result.error;
      }

      if (error && errorMentionsWorkReportHistoryLink(error)) {
        const existingReport = currentAppointmentType === "maintenance" ? undefined : savedReportFor(selected, currentAppointmentType);
        const retryReportId = currentReportId || existingReport?.id;
        const retryResult = retryReportId
          ? await supabase.from("work_reports").update(payloadWithoutHistoryLink).eq("id", retryReportId).select("*").single()
          : await supabase.from("work_reports").insert(payloadWithoutHistoryLink).select("*").single();
        data = retryResult.data;
        error = retryResult.error;
      }

      if (error && currentAppointmentType === "installation" && errorMentionsWorkReportType(error)) {
        const { appointment_type, ...fallbackPayload } = payloadWithoutHistoryLink;
        const fallbackExistingReport = savedReportFor(selected, currentAppointmentType);
        const fallbackReportId = currentReportId || fallbackExistingReport?.id;
        const fallbackResult = fallbackReportId
          ? await supabase
              .from("work_reports")
              .update(fallbackPayload)
              .eq("id", fallbackReportId)
              .select("*")
              .single()
          : await supabase
              .from("work_reports")
              .insert(fallbackPayload)
              .select("*")
              .single();
        data = fallbackResult.data;
        error = fallbackResult.error;
      }

      if (error) {
        if (currentAppointmentType === "maintenance" && errorMentionsWorkReportType(error)) {
          throw new Error("A karbantartási munkalap külön mentéséhez futtasd a SUPABASE_WORK_REPORT_TIPUS_OSZLOP.sql fájlt a Supabase-ben.");
        }
        throw error;
      }

      if (data?.id && !data.legacy_source_key) {
        const legacySourceKey = `work_reports:${data.id}`;
        const legacyResult = await supabase
          .from("work_reports")
          .update({ legacy_source_key: legacySourceKey })
          .eq("id", data.id)
          .select("legacy_source_key")
          .maybeSingle();
        if (legacyResult.error && !errorMentionsWorkReportHistoryLink(legacyResult.error)) throw legacyResult.error;
        if (!legacyResult.error) data.legacy_source_key = legacyResult.data?.legacy_source_key || legacySourceKey;
      }

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

      const hasSignedReport = hasValidWorkReportSignature(reportToSave);
      const documentEventAt = emailSentAt || signedAt || new Date().toISOString();
      const isMaintenanceReport = currentAppointmentType === "maintenance";
      let savedPurchaseDeclaration: PurchaseDeclaration | null = null;
      if (!isMaintenanceReport && hasSignedReport) {
        const seller = sellerSnapshot(sellerCompanies, selectedSellerId);
        const selectedDeclarationItems = quoteItems.filter((_, index) => purchaseDeclarationItemKeys.includes(String(index)));
        const declarationItems = selectedDeclarationItems.length ? selectedDeclarationItems : quoteItems;
        const legacySourceKey = `purchase_declarations:${selected.id}:${data.id}:${seller.id}`;
        const declarationPayload = declarationToRow({
          customerId: selected.id,
          appointmentId: selected.activeAppointmentId,
          workReportId: data.id,
          seller,
          quoteItems: declarationItems,
          report: { ...reportToSave, signedAt: signedAt || reportToSave.signedAt },
          legacySourceKey,
        });
        const declarationSourceMatch = await supabase
          .from("purchase_declarations")
          .select("id")
          .eq("legacy_source_key", legacySourceKey)
          .maybeSingle();

        if (declarationSourceMatch.error) {
          if (isMissingSellerTableError(declarationSourceMatch.error)) {
            setMessage("A vásárlási nyilatkozat eladóválasztásához előbb futtasd az új Supabase migrációt.");
            return;
          }
          throw declarationSourceMatch.error;
        }

        const declarationResult = declarationSourceMatch.data?.id
          ? await supabase
              .from("purchase_declarations")
              .update(declarationPayload)
              .eq("id", declarationSourceMatch.data.id)
              .select("*")
              .single()
          : await supabase
              .from("purchase_declarations")
              .insert(declarationPayload)
              .select("*")
              .single();

        if (declarationResult.error) {
          if (isMissingSellerTableError(declarationResult.error)) {
            setMessage("A vásárlási nyilatkozat eladóválasztásához előbb futtasd az új Supabase migrációt.");
            return;
          }
          throw declarationResult.error;
        }
        savedPurchaseDeclaration = declarationFromRow(declarationResult.data);
      }
      if (!isMaintenanceReport) {
        await logDocument(
          selected,
          "work_report",
          workReportTitle(selected.appointmentType),
          sendEmail ? "Elküldve" : hasSignedReport ? "Aláírva, mentve" : "Mentve, aláírásra vár",
          documentEventAt
        );
      }
      if (!isMaintenanceReport && hasSignedReport) {
        await logDocument(selected, "purchase_declaration", `Vásárlási nyilatkozat${savedPurchaseDeclaration ? ` – ${savedPurchaseDeclaration.sellerName}` : ""}`, sendEmail ? "Elküldve" : "Elkészült", documentEventAt);
      }

      if (!isMaintenanceReport) {
        await updateChecklistForCustomer(selected, {
          worksheet: hasSignedReport,
          purchaseDeclaration: hasSignedReport,
          signature: hasSignedReport,
          docsSent: Boolean(sendEmail && hasSignedReport),
        });
      }

      const savedReportForState: WorkReport = {
        id: data.id,
        customerId: data.customer_id,
        appointmentId: data.appointment_id || reportToSave.appointmentId || selected.activeAppointmentId,
        legacySourceKey: data.legacy_source_key || reportToSave.legacySourceKey,
        appointmentType: currentAppointmentType,
        workDate: data.work_date || reportToSave.workDate,
        workTime: data.work_time || reportToSave.workTime,
        createdAt: data.created_at || reportToSave.createdAt,
        updatedAt: data.updated_at || reportToSave.updatedAt,
        workDescription: data.work_description || reportToSave.workDescription,
        notes: data.notes || "",
        signatureDataUrl: data.signature_data_url || reportToSave.signatureDataUrl,
        signerName: data.signer_name || reportToSave.signerName,
        signedAt: data.signed_at || reportToSave.signedAt,
        emailSentAt,
      };
      if (isMaintenanceReport) {
        setMaintenanceReportsByCustomer((prev) => {
          const current = prev[selected.id] || [];
          const without = current.filter((report) => report.id !== savedReportForState.id);
          return { ...prev, [selected.id]: [savedReportForState, ...without].sort(compareWorkReportsDesc) };
        });
      } else {
        setWorkReportsByCustomer((prev) => ({ ...prev, [workReportKeyFromReport(savedReportForState, selected.id)]: savedReportForState }));
      }
      if (savedPurchaseDeclaration) {
        setPurchaseDeclarationsByCustomer((prev) => {
          const current = prev[selected.id] || [];
          return { ...prev, [selected.id]: [savedPurchaseDeclaration, ...current.filter((item) => item.id !== savedPurchaseDeclaration?.id)] };
        });
      }
      setWorkReport(savedReportForState);
      if (isMaintenanceReport) {
        const updatedSelected = { ...selected, activeWorkReportId: savedReportForState.id };
        setSelected(updatedSelected);
        updateWorkHistory(updatedSelected);
      }
      setMessage(sendEmail ? `${workReportTitle(selected.appointmentType)} mentve és emailben elküldve ✅` : `${workReportTitle(selected.appointmentType)} mentve ✅`);
      replaceView("work");
    } catch (error: any) {
      setMessage(`Munkalap hiba: ${error.message}`);
    } finally {
      setWorkReportBusy(false);
      setWorkReportEmailBusy(false);
    }
  }


  function allWorkReportsForPreview(customer: Customer = selected) {
    const installationReport = savedReportFor({ ...customer, activeWorkReportId: undefined, appointmentType: "installation" }, "installation");
    const reports = [installationReport, ...maintenanceReportsFor(customer)].filter(Boolean) as WorkReport[];
    return reports.sort(compareWorkReportsDesc);
  }

  function documentReportFor(customer: Customer = selected) {
    const activeReportId = documentPreviewReportId || customer.activeWorkReportId;
    if (activeReportId) {
      const report = maintenanceReportsFor(customer).find((item) => item.id === activeReportId);
      if (report) return report;
    }
    return savedReportFor(customer) || emptyWorkReport(customer);
  }

  function purchaseDeclarationsFor(customer: Customer = selected, options: { includeAll?: boolean } = {}) {
    if (!customer.id) return [];
    const declarations = purchaseDeclarationsByCustomer[customer.id] || [];
    if (options.includeAll || !customer.activeAppointmentId) return declarations;
    return declarations.filter((item) => item.appointmentId === customer.activeAppointmentId);
  }

  function purchaseDeclarationForPreview(customer: Customer = selected) {
    const declarations = purchaseDeclarationsFor(customer);
    if (documentPreviewDeclarationId) {
      return declarations.find((item) => item.id === documentPreviewDeclarationId);
    }
    if (customer.activeAppointmentId) {
      return declarations.find((item) => item.appointmentId === customer.activeAppointmentId);
    }
    return declarations[0];
  }

  function purchaseDeclarationSellerForPreview(customer: Customer = selected) {
    const declaration = purchaseDeclarationForPreview(customer);
    if (declaration) {
      return {
        id: declaration.sellerCompanyId || declaration.id || DEFAULT_SELLER_COMPANY.id,
        name: declaration.sellerName,
        taxNumber: declaration.sellerTaxNumber,
        representative: declaration.sellerRepresentative,
      };
    }
    return sellerSnapshot(sellerCompanies, selectedSellerId);
  }

  function purchaseDeclarationItemsForPreview(customer: Customer = selected) {
    const declaration = purchaseDeclarationForPreview(customer);
    if (declaration?.quoteItems?.length) return declaration.quoteItems;
    const items = customer.quoteItems?.length ? customer.quoteItems : quoteItems;
    const selectedItems = items.filter((_, index) => purchaseDeclarationItemKeys.includes(String(index)));
    return selectedItems.length ? selectedItems : items;
  }

  function documentIsReady(customer: Customer, row: PageDocumentRow) {
    const rowType = row.appointmentType || normalizeAppointmentType(customer.appointmentType);
    const signed = hasCustomerSignature(customer, rowType);
    if (row.action === "MaintenanceBundle") return maintenanceReportsFor(customer).length > 0;
    if (row.action === "MaintenanceReport") return Boolean(row.reportId);
    if (row.action === "Munkalap") return signed;
    if (row.action === "Nyilatkozat") return signed;
    if (row.action === "MunkalapNyilatkozat") return signed;
    if (row.action === "Ajánlat") return row.status.includes("Elküld") || customer.status === "Ajánlat elküldve";
    if (row.action === "Időpont") return row.status.includes("Elküld") || row.status.includes("Rögzít");
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



  function renderQuickAppointmentEmailPrompt() {
    if (!quickAppointmentEmailPrompt) return null;

    const customer = quickAppointmentEmailPrompt;
    const items = cleanQuoteItems(customer.quoteItems || []);
    const canSend = Boolean(customer.email?.trim());
    const type = normalizeAppointmentType(customer.appointmentType);

    return (
      <div className="fixed inset-0 z-[85] overflow-y-auto bg-slate-950/80 p-4 backdrop-blur">
        <div className="mx-auto my-8 max-w-2xl rounded-[2rem] border border-white/10 bg-slate-900 p-5 shadow-2xl md:p-6">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Időpont mentve</p>
          <h2 className="mt-2 text-2xl font-black">Tájékoztató e-mail küldése?</h2>
          <p className="mt-2 text-sm font-bold text-slate-400">
            {customer.name || "Névtelen ügyfél"} · {appointmentTypeLabel(type)} · {appointmentSummaryLabel(customer)}
          </p>
          <div className="mt-4 rounded-2xl bg-white/5 p-4 text-sm font-bold text-slate-300">
            <p>{fullCustomerAddress(customer) || "Nincs cím megadva."}</p>
            {items.length ? <p className="mt-2">{climateSummary(items)}</p> : null}
            {items.length && type === "installation" ? <p className="mt-2 text-emerald-200">Ajánlati összeg: {ft(total(items))}</p> : null}
          </div>
          {!canSend ? (
            <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/20 p-4 text-sm font-black text-amber-100">
              Ehhez az ügyfélhez nincs email cím. Add meg az ügyfél adatlapján, vagy mentsd email küldése nélkül.
            </div>
          ) : null}
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button type="button" onClick={skipQuickAppointmentEmail} className="rounded-2xl bg-white/10 px-5 py-4 font-black text-slate-100">
              Mentés e-mail küldése nélkül
            </button>
            <button
              type="button"
              onClick={() => void sendQuickAppointmentEmail()}
              disabled={!canSend || appointmentEmailBusy}
              className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {appointmentEmailBusy ? "Email küldése..." : "Tájékoztató e-mail küldése"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderQuickAppointmentDialog() {
    if (!quickAppointment) return null;

    const appointmentType = quickAppointment.appointmentType ? normalizeAppointmentType(quickAppointment.appointmentType) : undefined;
    const isInstallation = appointmentType === "installation";
    const isSurvey = appointmentType === "survey";
    const isMaintenance = appointmentType === "maintenance";
    const isExistingMode = quickAppointment.customerMode === "existing";
    const selectedQuickCustomer = quickAppointmentSelectedCustomer(quickAppointment);
    const maintenanceInstallationWorks = selectedQuickCustomer ? customerInstallationWorks(selectedQuickCustomer) : [];
    const searchTerm = quickAppointment.search.trim().toLocaleLowerCase("hu-HU");
    const quickCustomerMatches = customers
      .filter((customer) => {
        if (!searchTerm) return true;
        return [
          customer.name,
          customer.phone,
          customer.email,
          customer.address,
          customer.city,
          customer.postalCode,
        ].join(" ").toLocaleLowerCase("hu-HU").includes(searchTerm);
      })
      .slice(0, 8);
    const linkedItems = quickAppointmentQuoteItems(quickAppointment, selectedQuickCustomer);
    const sortedProducts = sortProducts(products);

    return (
      <div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/80 p-4 backdrop-blur">
        <div className="mx-auto my-6 max-w-3xl rounded-[2rem] border border-white/10 bg-slate-900 p-5 shadow-2xl md:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Naptár gyors rögzítés</p>
              <h2 className="mt-2 text-2xl font-black">Mit szeretnél rögzíteni?</h2>
              <p className="mt-1 text-sm font-bold text-slate-400">{quickAppointment.date.replaceAll("-", ".")} · {quickAppointment.time || "08:00"}</p>
            </div>
            <button type="button" onClick={() => setQuickAppointment(null)} className="rounded-2xl bg-white/10 px-4 py-3 font-black text-cyan-100">Bezárás</button>
          </div>

          {message ? <div className="mb-4 rounded-2xl border border-amber-300/30 bg-amber-400/20 p-4 text-sm font-black text-amber-100">{message}</div> : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {([
              ["installation", "Szerelés"],
              ["survey", "Felmérés"],
              ["maintenance", "Karbantartás"],
            ] as [AppointmentType, string][]).map(([type, label]) => (
              <button
                key={type}
                type="button"
                onClick={() => chooseQuickAppointmentType(type)}
                className={`rounded-2xl px-4 py-4 text-left font-black transition ${appointmentType === type ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/10 text-slate-100 hover:border-cyan-300/40"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {appointmentType && !isMaintenance ? (
            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
              <button type="button" onClick={() => chooseQuickAppointmentCustomerMode("new")} className={`rounded-2xl px-4 py-4 text-left font-black ${quickAppointment.customerMode === "new" ? "bg-emerald-400 text-slate-950" : "border border-white/10 bg-white/10 text-slate-100"}`}>
                Új ügyfél
              </button>
              <button type="button" onClick={() => chooseQuickAppointmentCustomerMode("existing")} className={`rounded-2xl px-4 py-4 text-left font-black ${quickAppointment.customerMode === "existing" ? "bg-emerald-400 text-slate-950" : "border border-white/10 bg-white/10 text-slate-100"}`}>
                Meglévő ügyfél
              </button>
            </div>
          ) : null}

          {appointmentType && (isMaintenance || isExistingMode) ? (
            <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-4">
              <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Ügyfélkereső</label>
              <input className="input mt-2" value={quickAppointment.search} onChange={(event) => updateQuickAppointment({ search: event.target.value, selectedCustomerId: undefined })} placeholder="Név, telefonszám vagy cím..." />
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {quickCustomerMatches.map((customer) => (
                  <button key={customer.id} type="button" onClick={() => selectQuickAppointmentCustomer(customer)} className={`w-full rounded-2xl border p-3 text-left transition ${quickAppointment.selectedCustomerId === customer.id ? "border-emerald-300 bg-emerald-400/20" : "border-white/10 bg-slate-950/60 hover:border-cyan-300/40"}`}>
                    <p className="font-black">{customer.name || "Névtelen ügyfél"}</p>
                    <p className="mt-1 text-sm text-slate-400">{customer.phone || "nincs telefonszám"} · {fullCustomerAddress(customer) || customer.city || "nincs cím"}</p>
                    {customer.quoteItems?.length ? <p className="mt-1 text-xs font-bold text-cyan-200/80">{climateSummary(customer.quoteItems)}</p> : null}
                  </button>
                ))}
                {quickCustomerMatches.length === 0 ? <div className="rounded-2xl bg-white/10 p-4 text-sm font-black text-slate-300">Nincs találat.</div> : null}
              </div>
            </div>
          ) : null}

          {appointmentType && quickAppointment.customerMode === "new" ? (
            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
              <input className="input" value={quickAppointment.name} onChange={(event) => updateQuickAppointment({ name: event.target.value })} placeholder="Név" />
              <input className="input" value={quickAppointment.phone} onChange={(event) => updateQuickAppointment({ phone: event.target.value })} placeholder="Telefon" />
              <input className="input" value={quickAppointment.email} onChange={(event) => updateQuickAppointment({ email: event.target.value })} placeholder="Email" />
              <input className="input" inputMode="numeric" maxLength={4} value={quickAppointment.postalCode} onChange={(event) => updateQuickAppointmentPostalCode(event.target.value)} placeholder="Irányítószám" />
              <input className="input" value={quickAppointment.city} onChange={(event) => updateQuickAppointment({ city: event.target.value })} placeholder="Település" />
              <input className="input md:col-span-2" value={quickAppointment.address} onChange={(event) => updateQuickAppointment({ address: event.target.value })} placeholder="Cím" />
            </div>
          ) : null}

          {appointmentType && (quickAppointment.customerMode === "new" || selectedQuickCustomer) ? (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Időpont</span>
                  <input type="time" step={300} className="mt-2 w-full bg-transparent text-lg font-black outline-none" value={quickAppointment.time} onChange={(event) => updateQuickAppointment({ time: event.target.value })} onBlur={(event) => updateQuickAppointment({ time: normalizeAppointmentTimeInput(event.target.value) || event.target.value })} />
                </label>
                <label className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Megjegyzés</span>
                  <input className="mt-2 w-full bg-transparent text-lg font-black outline-none" value={quickAppointment.notes} onChange={(event) => updateQuickAppointment({ notes: event.target.value })} placeholder="belső megjegyzés" />
                </label>
              </div>

              {isInstallation ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="mb-3 text-sm font-black text-slate-300">Klíma és ár</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_100px_160px]">
                    <select className="input" value={quickAppointment.productId} onChange={(event) => updateQuickAppointmentProduct(event.target.value)}>
                      <option value="">Válassz klímát...</option>
                      {sortedProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                    <input className="input" type="number" min={1} value={quickAppointment.quantity} onChange={(event) => updateQuickAppointment({ quantity: event.target.value === "" ? "" : Math.max(1, Number(event.target.value) || 1) })} />
                    <input className="input" type="number" min={0} value={quickAppointment.price} onChange={(event) => updateQuickAppointment({ price: event.target.value === "" ? "" : Math.max(0, Number(event.target.value) || 0) })} placeholder="Ár" />
                  </div>
                </div>
              ) : null}

              {isMaintenance ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="mb-3 text-sm font-black text-slate-300">Kapcsolódó korábbi klímák / telepítés</p>
                  {maintenanceInstallationWorks.length ? (
                    <div className="mb-3 space-y-2">
                      {maintenanceInstallationWorks.map((work) => (
                        <label key={work.activeAppointmentId} className="flex cursor-pointer items-start gap-3 rounded-2xl bg-slate-950/60 p-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-5 w-5"
                            checked={Boolean(work.activeAppointmentId && quickAppointment.maintenanceInstallationIds.includes(work.activeAppointmentId))}
                            onChange={(event) => {
                              if (!work.activeAppointmentId) return;
                              const current = new Set(quickAppointment.maintenanceInstallationIds);
                              if (event.target.checked) current.add(work.activeAppointmentId);
                              else current.delete(work.activeAppointmentId);
                              updateQuickAppointment({ maintenanceInstallationIds: Array.from(current) });
                            }}
                          />
                          <span>
                            <span className="block font-black">{climateSummary(work.quoteItems) || "Korábbi telepítés"}</span>
                            <span className="mt-1 block text-sm text-slate-400">{work.date ? `${work.date.replaceAll("-", ".")} · ${work.time || ""}` : "dátum nélkül"}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {linkedItems.length ? (
                    <div className="space-y-2">
                      {linkedItems.map((item, index) => (
                        <div key={`${item.productId}-${index}`} className="rounded-2xl bg-slate-950/60 p-3">
                          <p className="font-black">{itemName(item)}</p>
                          <p className="text-sm text-slate-400">{Number(item.quantity) || 1} db</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-amber-400/15 p-4 text-sm font-bold text-amber-100">Ennél az ügyfélnél nincs korábbi klíma rögzítve, de a karbantartási időpont így is menthető.</div>
                  )}
                </div>
              ) : null}

              <div className="flex flex-col gap-3 md:flex-row md:justify-end">
                <button type="button" onClick={() => setQuickAppointment(null)} className="rounded-2xl bg-white/10 px-5 py-4 font-black text-slate-100">Mégse</button>
                <button type="button" onClick={() => void saveQuickAppointment()} className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950">Időpont mentése</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
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

  function renderWarehouseQuickView() {
    const warehouseRows = products
      .map((product: any) => {
        const stock = stockOf(product.id);
        const reserved = reservedForProduct(product.id);
        return { product, stock, reserved, free: stock - reserved };
      })
      .filter((row) => row.stock > 0 || row.reserved > 0);
    const visibleWarehouseRows = warehouseRows.slice(0, DASHBOARD_WAREHOUSE_LIMIT);
    const hiddenWarehouseCount = Math.max(0, warehouseRows.length - visibleWarehouseRows.length);

    return (
      <Card title="Raktár gyorsnézet">
        <div className="space-y-3">
          {visibleWarehouseRows.length === 0 ? <div className="rounded-2xl bg-slate-900/80 p-4 font-black text-slate-300">Nincs megjeleníthető készlet.</div> : null}
          {visibleWarehouseRows.map(({ product, stock, reserved, free }) => (
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
          ))}
        </div>
        {hiddenWarehouseCount > 0 ? (
          <button
            onClick={() => navigateToView("warehouse")}
            className="mt-4 w-full rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm font-black text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-300/20"
          >
            További {hiddenWarehouseCount} tétel a Raktár / klímák oldalon
          </button>
        ) : null}
      </Card>
    );
  }


  function renderDraftNoticePanel() {
    if (!draftNotice) return null;

    return (
      <Card title="Folyamatban lévő szerkesztés">
        <div className="space-y-3">
          <div className="rounded-2xl bg-slate-950/60 p-3">
            <p className="font-black text-slate-100">{draftNotice.customer.name || "Névtelen ügyfél"}</p>
            <p className="text-sm text-slate-400">{draftNotice.customer.phone || draftNotice.customer.email || [draftNotice.customer.postalCode, draftNotice.customer.city].filter(Boolean).join(" ") || "nincs adat"}</p>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <button onClick={continueCustomerDraft} className="rounded-2xl bg-cyan-300 px-4 py-3 font-black text-slate-950">Szerkesztés folytatása</button>
            <button onClick={discardCustomerDraft} className="rounded-2xl bg-white/10 px-4 py-3 font-black text-slate-200">Helyi piszkozat elvetése</button>
          </div>
        </div>
      </Card>
    );
  }

  function renderDashboardLeadsPanel() {
    return (
      <Card title="Új érdeklődők">
        <div className="mb-4 flex flex-col gap-2 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>{dashboardLeadCustomers.length} aktív érdeklődő</span>
          {dashboardLeadCustomers.length > LIST_PAGE_SIZE ? <span>Maximum {LIST_PAGE_SIZE} ügyfél oldalanként</span> : null}
        </div>
        <div className="space-y-3">
          {dashboardLeadCustomers.length === 0 ? <div className="rounded-2xl bg-white/10 p-4 font-black text-slate-300">Nincs ilyen érdeklődő.</div> : null}
          {visibleLeadCustomers.map((c)=>(
            <div key={c.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 transition hover:border-cyan-300/40">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <button type="button" onClick={()=>openCustomer(c,"lead")} className="min-w-0 flex-1 text-left">
                  <p className="text-lg font-black">{c.name}</p>
                  <p className="text-sm text-slate-400">{c.city || "nincs település"} · {c.email || c.phone || "nincs elérhetőség"}</p>
                  <p className="mt-1 text-xs text-cyan-200/80">{climateSummary(c.quoteItems)}</p>
                  {customerInquiryLabel(c) ? <p className="mt-1 text-xs font-bold text-emerald-200/80">{customerInquiryLabel(c)}</p> : null}
                </button>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <span className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold">{customerStatusLabel(c)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <PaginationControls currentPage={dashboardLeadPagination.currentPage} pageCount={dashboardLeadPagination.pageCount} totalCount={dashboardLeadCustomers.length} label="ügyfél" onPageChange={setLeadPage} />
      </Card>
    );
  }



  if (view==="documentPreview") {
    const report = documentReportFor(selected);
    const isAppointmentPreview = documentPreviewType === "appointment_confirmation";
    const isQuotePreview = documentPreviewType === "quote_document";
    const isAllWorkReportsPreview = documentPreviewType === "all_work_reports";
    const allPreviewReports = allWorkReportsForPreview(selected);
    return (
      <Shell>
        <style>{`@media print { @page { size: A4 portrait; margin: 0; } html, body { width: 210mm !important; min-height: 297mm !important; margin: 0 !important; background: #fff !important; } body * { visibility: hidden !important; } .print-document-area, .print-document-area * { visibility: visible !important; } .print-document-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 210mm !important; background: #fff !important; } .doc-print-page { box-sizing: border-box !important; width: 210mm !important; max-width: 210mm !important; min-height: 297mm !important; height: 297mm !important; margin: 0 !important; box-shadow: none !important; border: 0 !important; border-radius: 0 !important; overflow: hidden !important; page-break-after: always !important; break-after: page !important; } .work-report-doc { padding: 14mm !important; font-size: 11.5px !important; line-height: 1.2 !important; } .purchase-doc { padding: 12mm !important; font-size: 10px !important; line-height: 1.18 !important; } .doc-print-page * { box-sizing: border-box !important; } .doc-print-page:last-child { page-break-after: auto !important; break-after: auto !important; } }`}</style>
        <Back onClick={()=>goBack(documentBackView)}/>
        <div className="print:hidden">
          {message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}
          {documentBackView === "documents" || isAppointmentPreview || isQuotePreview || isAllWorkReportsPreview ? (
            <div className="mb-5"><button onClick={()=>window.print()} className="document-action-button w-full rounded-2xl bg-white/10 px-5 py-4 font-black text-white sm:w-auto">Nyomtatás / mentés PDF-be</button></div>
          ) : (
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button onClick={()=>openWorkReportFor(selected, documentPreviewReportId)} className="document-action-button rounded-2xl bg-emerald-400/20 px-5 py-4 font-black text-emerald-100">Munkalap szerkesztése / aláírás</button>
              <button onClick={()=>saveWorkReport(true)} className="document-action-button rounded-2xl bg-blue-400/20 px-5 py-4 font-black text-blue-100">Mentés és email küldése</button>
            </div>
          )}
        </div>
        <div className="print-document-area print:bg-white">
          {isAllWorkReportsPreview ? (
            <AllWorkReportsDocument customer={selected} reports={allPreviewReports} quoteItems={quoteItems}/>
          ) : documentPreviewType === "purchase_declaration" ? (
            <PurchaseDeclarationDocument customer={{ ...selected, quoteItems: purchaseDeclarationItemsForPreview(selected) }} report={report} quoteItems={purchaseDeclarationItemsForPreview(selected)} seller={purchaseDeclarationSellerForPreview(selected)}/>
          ) : isAppointmentPreview ? (
            <AppointmentConfirmationDocument customer={selected} quoteItems={quoteItems}/>
          ) : isQuotePreview ? (
            <QuoteDocument customer={selected} quoteItems={quoteItems} quoteIssuedAt={quoteIssuedAt}/>
          ) : (
            <WorkReportDocument customer={selected} report={report} quoteItems={quoteItems}/>
          )}
        </div>
      </Shell>
    );
  }


  if (view==="documents") {
    const documentCustomers = filteredCustomers;
    const documentPagination = documentCustomerPagination;
    const visibleDocumentCustomers = visibleDocumentCustomersForLoad;
    return (
      <Shell>
        <Back onClick={()=>goBack()}/>
        <Layout>
          <Main>
            <Card title="Dokumentumok ügyfelenként">
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto]">
                <input className="input" value={customerSearch} onChange={(event)=>setCustomerSearch(event.target.value)} placeholder="Keresés név, telefon, település, cím vagy klíma alapján..." />
                <select className="input" value={customerStatusFilter} onChange={(event)=>setCustomerStatusFilter(event.target.value)}>
                  <option value="all">Összes státusz</option>
                  {STATUS_OPTIONS.map((status)=><option key={status} value={status}>{status}</option>)}
                </select>
                <button type="button" onClick={() => void refreshVisibleDocumentData()} disabled={dataLoading} className="document-action-button rounded-2xl bg-white/10 px-5 py-4 font-black text-cyan-100 disabled:opacity-60">{dataLoading ? "Frissítés..." : "Frissítés"}</button>
              </div>
              {hasCustomerFilter ? <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-white/5 p-3 text-sm font-bold text-slate-300"><span>{documentCustomers.length} találat</span><button onClick={clearCustomerFilter} className="document-action-button rounded-xl bg-white/10 px-3 py-2 text-cyan-100">Szűrő törlése</button></div> : null}
              <div className="space-y-4">
                {documentCustomers.length === 0 ? <div className="rounded-2xl bg-white/10 p-4 font-black text-slate-300">Nincs találat.</div> : null}
                {visibleDocumentCustomers.map((customer)=><div key={customer.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4"><div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><p className="text-xl font-black">{customer.name || "Névtelen ügyfél"}</p><p className="mt-1 text-sm text-slate-400">{fullCustomerAddress(customer)}{customer.date ? ` · ${customer.date.replaceAll("-", ".")} ${customer.time || ""}` : ""}</p><p className="mt-1 text-xs font-bold text-cyan-200/80">{climateSummary(customer.quoteItems)}</p>{customerInquiryLabel(customer) ? <p className="mt-1 text-xs font-bold text-emerald-200/80">{customerInquiryLabel(customer)}</p> : null}</div><button onClick={()=>openCustomer(customer,"work")} className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">Ügyfél megnyitása</button></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2">{[...documentRowsFor(customer), ...maintenanceDocumentRowsFor(customer, true)].map((row)=><div key={`${row.title}-${row.reportId || row.reportDateLabel || row.reportDate || row.action}` } className="rounded-2xl bg-white/5 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{row.title}</p></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${documentStatusClass(row.status)}`}>{row.status}</span></div><DocumentLibraryActionButtons customer={customer} row={row} ready={documentIsReady(customer, row)} onPreview={openDocumentPreview}/></div>)}</div></div>)}
              </div>
              <PaginationControls currentPage={documentPagination.currentPage} pageCount={documentPagination.pageCount} totalCount={documentCustomers.length} label="ügyfél" onPageChange={setDocumentPage} />
            </Card>
          </Main>
          <Side><Gradient title="Dokumentum állapot" value={`${documentCustomers.length} ügyfél`}/>{renderCustomerSearchPanel("Gyors kereső")}</Side>
        </Layout>
      </Shell>
    );
  }

  if (view==="lead") return (
    <LeadPanel
      selected={selected}
      customers={customers}
      timelineItems={customerTimelineItems(selected)}
      onBack={()=>goBack()}
      onSaveCustomerOnly={saveCustomerOnly}
      onSaveCustomerAndQuote={()=>saveCustomer("quote")}
      onScheduleSurvey={saveCustomerAndScheduleSurvey}
      onDeleteCustomer={deleteCustomer}
      onRememberExternalCustomer={rememberExternalCustomer}
      onRecordCustomerPhoneCall={recordCustomerPhoneCall}
      onUpdateSelectedField={updateSelectedField}
      onUpdateCustomerStatus={updateCustomerStatus}
    />
  );

  if (view==="quote") return (
    <QuoteBuilderPanel
      selected={selected}
      quoteItems={quoteItems}
      products={products}
      totalAmount={t}
      installerAmount={installer}
      materialAmount={materialPrice}
      quoteEmailBusy={quoteEmailBusy}
      canEditWorkResources={canEditWorkResources}
      quotePricingMode={selected.quotePricingMode || "bundle"}
      onBack={()=>goBack()}
      onPreview={()=>{ setQuoteIssuedAt(new Date().toISOString()); navigateToView("quotePreview"); }}
      onSendQuoteEmail={sendQuoteEmail}
      onSchedule={startInstallationScheduleFromQuote}
      onQuotePricingModeChange={updateQuotePricingMode}
      onUpdateQuoteItem={updateQuoteItem}
      onUpdateQuoteProduct={updateQuoteProduct}
      onRemoveQuoteItem={removeQuoteItem}
      onSyncQuoteItemPrice={syncQuoteItemPrice}
      onAddQuoteItem={addQuoteItem}
      onAddManualQuoteItem={addManualQuoteItem}
    />
  );


  if (view==="quotePreview") {
    return (
      <QuotePreviewPanel
        selected={selected}
        quoteItems={quoteItems}
        totalAmount={t}
        installerAmount={installer}
        materialAmount={materialPrice}
        quoteEmailBusy={quoteEmailBusy}
        quoteIssuedAt={quoteIssuedAt}
        onBack={() => goBack("quote")}
        onPrint={() => window.print()}
        onSendQuote={sendQuoteEmail}
        onSchedule={startInstallationScheduleFromQuote}
        onQuotePricingModeChange={updateQuotePricingMode}
      />
    );
  }

  if (view==="schedule") {
    const free = availableAppointmentSlots({
      customers: allWorkCustomers,
      date: scheduleDate,
      selectedCustomerId: selected.id,
      selectedAppointmentId: selected.activeAppointmentId,
      appointmentType: normalizedScheduleAppointmentType,
      items: quoteItems,
    });
    const isExistingSchedule = Boolean(selected.date) && normalizeAppointmentType(selected.appointmentType) === normalizedScheduleAppointmentType;
    return (
      <SchedulePanel
        selected={selected}
        isExistingSchedule={isExistingSchedule}
        mode={mode}
        calDate={calDate}
        calendarCustomers={calendarCustomers}
        message={message}
        scheduleDate={scheduleDate}
        scheduleTime={scheduleTime}
        shownTime={shownTime}
        appointmentType={normalizedScheduleAppointmentType}
        isMultiDayJob={isMultiDayJob}
        freeSlots={free}
        quoteItems={quoteItems}
        products={products}
        totalQuantity={q}
        sendAppointmentNotice={sendAppointmentNotice}
        appointmentEmailBusy={appointmentEmailBusy}
        onBack={()=>goBack(isExistingSchedule ? "work" : "quote")}
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
      sellerCompanies={sellerCompanies}
      selectedSellerId={selectedSellerId}
      newSellerName={newSellerName}
      newSellerTaxNumber={newSellerTaxNumber}
      newSellerRepresentative={newSellerRepresentative}
      purchaseDeclarationItemKeys={purchaseDeclarationItemKeys}
      onBack={()=>goBack("work")}
      onSave={(sendEmail)=>saveWorkReport(sendEmail)}
      onUpdateWorkReportField={updateWorkReportField}
      onSignatureChange={(value)=>setWorkReport((prev)=>({ ...prev, signatureDataUrl: value, signedAt: value ? new Date().toISOString() : undefined }))}
      onSelectSeller={setSelectedSellerId}
      onNewSellerNameChange={setNewSellerName}
      onNewSellerTaxNumberChange={setNewSellerTaxNumber}
      onNewSellerRepresentativeChange={setNewSellerRepresentative}
      onAddSeller={addSellerCompany}
      onTogglePurchaseDeclarationItem={togglePurchaseDeclarationItem}
    />
  );

  if (view==="work") return (
    <Shell>
      <WorkPagePanel
        selected={selected}
        scheduleDate={scheduleDate}
        scheduleTime={scheduleTime}
        shownTime={shownTime}
        message={message}
        editCustomer={editCustomer}
        quoteItems={quoteItems}
        products={products}
        materials={materials}
        workResourceEditLocked={workResourceEditLocked}
        allowWorkResourceEdit={allowWorkResourceEdit}
        canEditWorkResources={canEditWorkResources}
        quoteEmailBusy={quoteEmailBusy}
        appointmentEmailBusy={appointmentEmailBusy}
        thankYouEmailBusy={thankYouEmailBusy}
        invoiceBusy={invoiceBusy}
        currentWorkChecklist={currentWorkChecklist}
        checklistDates={currentWorkChecklist.completedAt || {}}
        actionDates={workActionDatesFor(selected)}
        documentRows={documentRowsFor(selected)}
        maintenanceRows={maintenanceDocumentRowsFor(selected)}
        workHistory={workHistoryByCustomer[selected.id] || []}
        onBack={()=>goBack()}
        onCloseWork={closeWork}
        onRememberExternalCustomer={rememberExternalCustomer}
        onRecordCustomerPhoneCall={recordCustomerPhoneCall}
        onSaveCustomerData={saveCustomerData}
        onSetEditCustomer={setEditCustomer}
        onUpdateSelectedField={updateSelectedField}
        onSetScheduleDate={setScheduleDate}
        onSetScheduleTime={setScheduleTime}
        onSetScheduleAppointmentType={setScheduleAppointmentType}
        onSetView={navigateToView}
        onUpdateQuoteItem={updateQuoteItem}
        onUpdateQuoteProduct={updateQuoteProduct}
        onRemoveQuoteItem={removeQuoteItem}
        onSyncQuoteItemPrice={syncQuoteItemPrice}
        onAddQuoteItem={addQuoteItem}
        onSetAllowWorkResourceEdit={setAllowWorkResourceEdit}
        onSaveWorkChanges={saveWorkChanges}
        onAddExtraMaterial={addExtraMaterial}
        onUpdateMaterial={updateMaterial}
        onFinalMaterialQty={finalMaterialQty}
        onUpdateFinalMaterialQty={updateFinalMaterialQty}
        onMaterialDisplayUnit={materialDisplayUnit}
        onClimateCountForMaterials={climateCountForMaterials}
        onOpenDocumentPreview={openDocumentPreview}
        onOpenWorkReportFor={openWorkReportFor}
        onSendQuoteEmail={sendQuoteEmail}
        onSendAppointmentEmailFor={sendAppointmentEmailFor}
        onSendThankYouEmailFor={sendThankYouEmailFor}
        onOpenWorkReport={openWorkReport}
        onMarkInstallationDone={markInstallationDone}
        onCancelAppointment={cancelAppointment}
        onStartMaintenanceForCustomer={startMaintenanceForCustomer}
        onToggleChecklist={toggleChecklist}
        onCreateInvoice={createInvoice}
        onOpenWorkVersion={openWorkVersion}
      />
    </Shell>
  );

  return (
    <Shell>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-5xl font-black">Alin<span className="text-cyan-300">Flow</span></h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <ThemeToggle />
          <Btn onClick={startNewCustomer}>+ Új ügyfél</Btn>
          <Btn color="blue" onClick={() => navigateToView("documents")}>Dokumentumok</Btn>
          <Btn color="green" onClick={() => navigateToView("warehouse")}>Raktár / klímák</Btn>
          <Btn color="red" onClick={() => navigateToView("archive")}>Lezárt / lemondott ({archivedCustomers.length})</Btn>
          <button onClick={handleLogout} className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-cyan-100">Kilépés</button>
        </div>
      </header>

      {message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}
      {renderQuickAppointmentDialog()}
      {renderQuickAppointmentEmailPrompt()}

      <Stats products={products} customers={activeCustomers} sentQuoteCount={activeCustomers.filter(customerHasSentQuote).length} stockOf={stockOf} reservedForProduct={reservedForProduct} onSelect={openTask}/>

      <section className="space-y-6 xl:hidden">
        <Calendar mode={mode} date={calDate} customers={calendarCustomers} onMode={setMode} onStep={step} onOpen={c=>openCustomer(c,"work")} onCreate={openQuickAppointment}/>
        {renderCustomerSearchPanel()}
        {renderDraftNoticePanel()}
        {renderDashboardLeadsPanel()}
        {renderWarehouseQuickView()}
        {renderLeadImportPanel()}
      </section>

      <section className="hidden gap-6 xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(360px,430px)] xl:items-start 2xl:grid-cols-[minmax(0,2.25fr)_minmax(380px,460px)]">
        <div className="space-y-6">
          <Calendar mode={mode} date={calDate} customers={calendarCustomers} onMode={setMode} onStep={step} onOpen={c=>openCustomer(c,"work")} onCreate={openQuickAppointment}/>
          {renderDashboardLeadsPanel()}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-6">
          {renderCustomerSearchPanel()}
          {renderDraftNoticePanel()}
          {renderWarehouseQuickView()}
          {renderLeadImportPanel()}
        </aside>
      </section>
    </Shell>
  );
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
        <p className="mt-2 text-lg font-black">{c.phone || "nincs megadva"}</p>
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


