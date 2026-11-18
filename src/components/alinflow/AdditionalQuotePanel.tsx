"use client";

import { useRef, useState } from "react";
import { QuoteBuilderPanel } from "./QuoteBuilderPanel";
import { QuotePreviewPanel } from "./QuotePreviewPanel";
import { cleanQuoteItems, isQuoteItemFilled, quoteInstallTotal, total } from "@/lib/alinflow/products";
import { quoteEditorActions } from "@/lib/alinflow/quote-editor";
import { manualQuoteAttemptIdentity, finishManualQuoteAttempt } from "@/lib/alinflow/manual-quote-attempt";
import type { ClimateProduct, Customer, QuoteItem, QuotePricingMode } from "@/lib/alinflow/types";
import type { WorkspaceSettings } from "@/lib/alinflow/workspace-settings";

type Props = {
  customer: Customer;
  sessionScope: string;
  products: ClimateProduct[];
  settings: WorkspaceSettings;
  onBack: () => void;
  onSend: (items: QuoteItem[], mode: QuotePricingMode, issuedAt: string, id: string) => Promise<void>;
  onSent: () => void;
};

export function AdditionalQuotePanel({ customer, sessionScope, products, settings, onBack, onSend, onSent }: Props) {
  const [items, setItems] = useState<QuoteItem[]>([{ productId: "", quantity: 1 }]);
  const [mode, setMode] = useState<QuotePricingMode>("bundle");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issuedAt, setIssuedAt] = useState(() => new Date().toISOString());
  const sending = useRef(false);
  const attempt = useRef<{ signature: string; scope: string; id: string; issuedAt: string } | null>(null);
  const editor = quoteEditorActions(setItems);
  const customerForQuote = { ...customer, quotePricingMode: mode };
  function validItems() {
    if (items.length && items.every(isQuoteItemFilled)) return true;
    setError("Válassz klímát vagy add meg az egyedi tétel nevét minden sorban.");
    return false;
  }
  async function send() {
    if (sending.current || !validItems()) return;
    const lines = cleanQuoteItems(items);
    const signature = JSON.stringify([customer.email, mode, lines]);
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      if (attempt.current?.signature !== signature) {
        // Persist only an opaque retry token, never the address or line items.
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        const scope = JSON.stringify(["additional", sessionScope, customer.id, hash]);
        attempt.current = { signature, scope, ...manualQuoteAttemptIdentity(scope, issuedAt) };
        setIssuedAt(attempt.current.issuedAt);
      }
      await onSend(lines, mode, attempt.current.issuedAt, attempt.current.id);
      finishManualQuoteAttempt(attempt.current.scope);
      onSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Az ajánlat küldése nem sikerült.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const common = { selected: customerForQuote, quoteItems: items, totalAmount: total(items),
    quoteEmailBusy: busy, onQuotePricingModeChange: setMode };
  return <>
    {error && <p role="alert" className="mx-auto max-w-3xl rounded-2xl bg-amber-100 p-4 font-bold text-amber-950">{error}</p>}
    {preview ? <QuotePreviewPanel {...common} workspaceSettings={settings} quoteIssuedAt={issuedAt}
      onBack={() => setPreview(false)} onPrint={() => window.print()} onSendQuote={send} />
      : <QuoteBuilderPanel {...common} products={products} canEditWorkResources quotePricingMode={mode}
        title={`Új árajánlat · ${customer.name}`}
        installerAmount={quoteInstallTotal(items)} materialAmount={Math.max(0, total(items) - quoteInstallTotal(items))}
        onBack={onBack} onPreview={() => { if (validItems()) { setError(""); setPreview(true); } }}
        onSendQuoteEmail={send} onUpdateQuoteItem={editor.updateQuoteItem} onUpdateQuoteProduct={editor.updateQuoteProduct}
        onRemoveQuoteItem={editor.removeQuoteItem} onSyncQuoteItemPrice={editor.syncQuoteItemPrice}
        onAddQuoteItem={editor.addQuoteItem} onAddManualQuoteItem={editor.addManualQuoteItem} />}
  </>;
}
