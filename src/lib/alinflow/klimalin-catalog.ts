import type { KlimalinCatalogProduct } from "./types";

const KLIMALIN_ORIGIN = "https://klimalin.hu";
export const KLIMALIN_CATALOG_URL = `${KLIMALIN_ORIGIN}/#klimak`;

type RawKlimalinProduct = {
  key?: unknown;
  title?: unknown;
  total?: unknown;
  install?: unknown;
  image?: unknown;
};

function extractProductsArray(html: string) {
  const markerIndex = html.search(/const\s+PRODUCTS\s*=/);
  if (markerIndex < 0) throw new Error("A KLIMAlin terméklista nem található az oldalon.");

  const start = html.indexOf("[", markerIndex);
  if (start < 0) throw new Error("A KLIMAlin terméklista kezdete nem található.");

  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }

  throw new Error("A KLIMAlin terméklista vége nem található.");
}

function stripTrailingCommas(value: string) {
  let result = "";
  let quote = "";
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      continue;
    }

    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(value[next] || "")) next += 1;
      if (value[next] === "]" || value[next] === "}") continue;
    }
    result += character;
  }

  return result;
}

function safeKlimalinImageUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw, KLIMALIN_ORIGIN);
    if (url.protocol !== "https:" || url.hostname !== "klimalin.hu") return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function normalizeRawProduct(product: RawKlimalinProduct): KlimalinCatalogProduct | null {
  const externalKey = String(product.key || "").trim();
  const name = String(product.title || "").trim();
  const price = Number(product.total);
  const installPrice = Number(product.install);
  if (!externalKey || !name || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(installPrice) || installPrice < 0 || installPrice > price) return null;

  return {
    externalKey,
    name,
    price,
    installPrice,
    productUrl: KLIMALIN_CATALOG_URL,
    imageUrl: safeKlimalinImageUrl(product.image),
  };
}

export function parseKlimalinCatalog(html: string) {
  const arrayLiteral = stripTrailingCommas(extractProductsArray(html));
  const parsed = JSON.parse(arrayLiteral) as RawKlimalinProduct[];
  if (!Array.isArray(parsed)) throw new Error("A KLIMAlin terméklista formátuma hibás.");

  const products = parsed.map(normalizeRawProduct).filter((product): product is KlimalinCatalogProduct => Boolean(product));
  if (!products.length) throw new Error("A KLIMAlin terméklistából egyetlen érvényes klíma sem olvasható ki.");
  if (new Set(products.map((product) => product.externalKey)).size !== products.length) {
    throw new Error("A KLIMAlin terméklistában ismétlődő termékazonosító található.");
  }
  return products;
}
