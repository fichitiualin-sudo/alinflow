"use client";

import type { ReactNode } from "react";
import type { PostalSettlement } from "@/lib/alinflow/postal-codes";
import {
  cityMatches,
  exactCitySettlements,
  exactPostalCodeSettlements,
  normalizePostalCodeInput,
  postalCodeMatches,
  settlementLabel,
  uniqueSettlementByCity,
  uniqueSettlementByPostalCode,
} from "@/lib/alinflow/postal-codes";

type PostalCodeCityFieldsProps = {
  postalCode?: string;
  city?: string;
  onChange: (field: "postalCode" | "city", value: string) => void;
};

function FieldShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="relative rounded-2xl bg-slate-900/80 p-4">
      <span className="text-sm text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function SuggestionList({ items, onSelect }: { items: PostalSettlement[]; onSelect: (item: PostalSettlement) => void }) {
  if (!items.length) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/90">
      {items.map((item) => (
        <button
          key={`${item.postalCode}-${item.city}`}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(item)}
          className="block w-full px-3 py-2 text-left text-sm font-bold text-slate-100 transition hover:bg-cyan-300 hover:text-slate-950"
        >
          {settlementLabel(item)}
        </button>
      ))}
    </div>
  );
}

function helpTextForPostalCode(value?: string) {
  const matches = exactPostalCodeSettlements(value);
  if (matches.length > 1) return "Több település is tartozik ehhez az irányítószámhoz.";
  return "";
}

function helpTextForCity(value?: string) {
  const matches = exactCitySettlements(value);
  if (matches.length > 1) return "Ehhez a településhez több irányítószám is tartozhat.";
  return "";
}

export function PostalCodeCityFields({ postalCode = "", city = "", onChange }: PostalCodeCityFieldsProps) {
  const normalizedPostalCode = normalizePostalCodeInput(postalCode);
  const postalSuggestions = postalCodeMatches(normalizedPostalCode, 7);
  const citySuggestions = cityMatches(city, 7);
  const postalHelp = helpTextForPostalCode(normalizedPostalCode);
  const cityHelp = helpTextForCity(city);

  function selectSettlement(item: PostalSettlement) {
    onChange("postalCode", item.postalCode);
    onChange("city", item.city);
  }

  function handlePostalCodeChange(value: string) {
    const nextPostalCode = normalizePostalCodeInput(value);
    onChange("postalCode", nextPostalCode);

    const exact = uniqueSettlementByPostalCode(nextPostalCode);
    if (exact) onChange("city", exact.city);
  }

  function handleCityChange(value: string) {
    onChange("city", value);

    const exact = uniqueSettlementByCity(value);
    if (exact) onChange("postalCode", exact.postalCode);
  }

  return (
    <>
      <FieldShell label="Irányítószám">
        <input
          className="mt-2 w-full bg-transparent text-lg font-black outline-none"
          inputMode="numeric"
          maxLength={4}
          value={normalizedPostalCode}
          onChange={(event) => handlePostalCodeChange(event.target.value)}
          placeholder="pl. 2192"
        />
        {postalHelp ? <p className="mt-2 text-xs font-bold text-amber-200">{postalHelp}</p> : null}
        <SuggestionList items={postalSuggestions} onSelect={selectSettlement} />
      </FieldShell>

      <FieldShell label="Település">
        <input
          className="mt-2 w-full bg-transparent text-lg font-black outline-none"
          value={city || ""}
          onChange={(event) => handleCityChange(event.target.value)}
          placeholder="pl. Hévízgyörk"
        />
        {cityHelp ? <p className="mt-2 text-xs font-bold text-amber-200">{cityHelp}</p> : null}
        <SuggestionList items={citySuggestions} onSelect={selectSettlement} />
      </FieldShell>
    </>
  );
}
