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
export type DocumentPreviewType = "work_report" | "purchase_declaration" | "appointment_confirmation" | "quote_document";
export type QuotePricingMode = "bundle" | "alternatives";

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
  quotePricingMode?: QuotePricingMode;
  isFresh?: boolean;
  stockDeducted?: boolean;
};

export type WorkReport = {
  id?: string;
  customerId?: string;
  workDescription: string;
  notes: string;
  signatureDataUrl: string;
  signerName: string;
  signedAt?: string;
  emailSentAt?: string;
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
  view: View;
  editCustomer: boolean;
  allowWorkResourceEdit: boolean;
  at: number;
};
