export type View =
  | "dashboard"
  | "lead"
  | "quote"
  | "quotePreview"
  | "schedule"
  | "work"
  | "workReport"
  | "warehouse"
  | "tasks"
  | "archive"
  | "documents"
  | "settings"
  | "maintenanceMap"
  | "documentPreview";

export type CalendarMode = "week" | "month";
export type DocumentPreviewType = "work_report" | "purchase_declaration" | "appointment_confirmation" | "quote_document" | "all_work_reports";
export type QuotePricingMode = "bundle" | "alternatives";
export type AppointmentType = "installation" | "survey" | "maintenance";
export type CustomerTimelineTone = "emerald" | "cyan" | "violet" | "blue" | "amber" | "slate";

export type Workspace = {
  id: string;
  name: string;
  slug?: string;
};

export type CustomerTimelineItem = {
  label: string;
  value?: string;
  hint?: string;
  tone?: CustomerTimelineTone;
  muted?: boolean;
};

export type CustomerTimelineState = {
  inquiredAt?: string;
  calledAt?: string;
  quoteSentAt?: string;
  appointmentBookedAt?: string;
  appointmentUpdatedAt?: string;
  surveyBookedAt?: string;
  maintenanceBookedAt?: string;
  updatedAt?: string;
};

export type QuoteItem = {
  productId: string;
  quantity: number | "";
  customPrice?: number | "";
  customInstallPrice?: number | "";
  customName?: string;
  isManual?: boolean;
};

export type SellerCompany = {
  id: string;
  name: string;
  taxNumber: string;
  representative: string;
  isDefault?: boolean;
  active?: boolean;
};

export type ClimateProduct = {
  id: string;
  name: string;
  price: number;
  installPrice: number;
  priceText?: string;
  active?: boolean;
};

export type InventoryItem = {
  productId: string;
  stock: number;
};

export type MaintenanceInstallationSummary = {
  appointmentId: string;
  date?: string;
  time?: string;
  address?: string;
  quoteItems: QuoteItem[];
};

export type Customer = {
  id: string;
  name: string;
  city: string;
  postalCode?: string;
  phone: string;
  email: string;
  address: string;
  workAddress?: string;
  source: string;
  status: string;
  need: string;
  notes?: string;
  date?: string;
  time?: string;
  appointmentType?: AppointmentType;
  activeAppointmentId?: string;
  activeQuoteId?: string;
  activeWorkReportId?: string;
  createdAt?: string;
  updatedAt?: string;
  lastCalledAt?: string;
  quoteSentAt?: string;
  appointmentBookedAt?: string;
  appointmentUpdatedAt?: string;
  timeline?: CustomerTimelineState;
  quoteItems: QuoteItem[];
  productId?: string;
  quotePricingMode?: QuotePricingMode;
  isFresh?: boolean;
  stockDeducted?: boolean;
  maintenanceInstallationIds?: string[];
  maintenanceInstallations?: MaintenanceInstallationSummary[];
  maintenanceOptOut?: boolean;
  maintenanceOptOutAt?: string;
  mapLatitude?: number;
  mapLongitude?: number;
  mapGeocodedAt?: string;
  mapGeocodeStatus?: "pending" | "ok" | "failed" | "manual";
  mapGeocodeError?: string;
};


export type WorkReport = {
  id?: string;
  customerId?: string;
  appointmentId?: string;
  legacySourceKey?: string;
  appointmentType?: AppointmentType;
  workDate?: string;
  workTime?: string;
  workDescription: string;
  notes: string;
  signatureDataUrl: string;
  signerName: string;
  signedAt?: string;
  emailSentAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PurchaseDeclaration = {
  id?: string;
  customerId: string;
  appointmentId?: string;
  workReportId?: string;
  sellerCompanyId?: string;
  sellerName: string;
  sellerTaxNumber: string;
  sellerRepresentative: string;
  quoteItems: QuoteItem[];
  signatureDataUrl?: string;
  signerName?: string;
  signedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type DocumentRecord = {
  id?: string;
  customerId: string;
  appointmentId?: string;
  type: string;
  title: string;
  status: string;
  sentAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type LeadImportCandidate = {
  id: string;
  rowNumber: number;
  name: string;
  phone: string;
  email: string;
  city?: string;
  postalCode?: string;
  inquiredAt?: string;
  duplicate: boolean;
  duplicateReason?: string;
  invalid?: boolean;
  invalidReason?: string;
  mergedRows?: number;
};

export type WorkChecklistItemKey =
  | "worksheet"
  | "signature"
  | "purchaseDeclaration"
  | "alinInvoice"
  | "amovaInvoice"
  | "nkvh"
  | "docsSent";

export type WorkChecklistCompletedAt = Partial<Record<WorkChecklistItemKey, string>>;

export type WorkChecklistState = Record<WorkChecklistItemKey, boolean> & {
  completedAt?: WorkChecklistCompletedAt;
};

export type ReturnContext = {
  customerId: string;
  view: View;
  at: number;
};

export type CustomerDraft = {
  customer: Customer;
  quoteItems: QuoteItem[];
  scheduleDate: string;
  scheduleTime: string;
  scheduleAppointmentType?: AppointmentType;
  view: View;
  editCustomer: boolean;
  allowWorkResourceEdit: boolean;
  at: number;
};
