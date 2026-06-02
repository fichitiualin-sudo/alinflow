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
  | "documentPreview";

export type CalendarMode = "week" | "month";
export type DocumentPreviewType = "work_report" | "purchase_declaration" | "appointment_confirmation" | "quote_document" | "all_work_reports";
export type QuotePricingMode = "bundle" | "alternatives";
export type AppointmentType = "installation" | "survey" | "maintenance";
export type CustomerTimelineTone = "emerald" | "cyan" | "violet" | "blue" | "amber" | "slate";

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
  customName?: string;
  isManual?: boolean;
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

export type Customer = {
  id: string;
  name: string;
  city: string;
  postalCode?: string;
  phone: string;
  email: string;
  address: string;
  source: string;
  status: string;
  need: string;
  notes?: string;
  date?: string;
  time?: string;
  appointmentType?: AppointmentType;
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
};


export type WorkReport = {
  id?: string;
  customerId?: string;
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

export type DocumentRecord = {
  id?: string;
  customerId: string;
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

export type WorkChecklistState = {
  worksheet: boolean;
  signature: boolean;
  purchaseDeclaration: boolean;
  alinInvoice: boolean;
  amovaInvoice: boolean;
  nkvh: boolean;
  docsSent: boolean;
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
