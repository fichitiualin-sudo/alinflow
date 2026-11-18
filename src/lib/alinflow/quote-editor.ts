import type { Dispatch, SetStateAction } from "react";
import { DEFAULT_INSTALL_PRICE } from "./constants";
import { isKnownProductId, prod } from "./products";
import type { QuoteItem } from "./types";

export function quoteEditorActions(setItems: Dispatch<SetStateAction<QuoteItem[]>>) {
  function change(index: number, fn: (item: QuoteItem) => QuoteItem) {
    setItems(items => items.map((item, i) => i === index ? fn(item) : item));
  }
  return {
    addQuoteItem: () => setItems(items => [...items, { productId: "", quantity: 1 }]),
    addManualQuoteItem: () => setItems(items => [...items, { productId: "", customName: "", customPrice: 0, quantity: 1, isManual: true }]),
    removeQuoteItem: (index: number) => setItems(items => items.length === 1 ? items : items.filter((_, i) => i !== index)),
    updateQuoteItem: (index: number, key: keyof QuoteItem, value: string | number | boolean) => change(index, item => ({ ...item, [key]: value })),
    updateQuoteProduct: (index: number, productId: string) => change(index, item => {
      const product = isKnownProductId(productId) ? prod(productId) : undefined;
      return { ...item, productId, productName: product?.name, isManual: !product,
        customName: product ? undefined : item.customName,
        customPrice: product?.price ?? item.customPrice ?? 0,
        customInstallPrice: product?.installPrice ?? item.customInstallPrice ?? DEFAULT_INSTALL_PRICE };
    }),
    syncQuoteItemPrice: (index: number) => change(index, item => ({
      ...item, customPrice: prod(item.productId).price, customInstallPrice: prod(item.productId).installPrice,
    })),
  };
}
