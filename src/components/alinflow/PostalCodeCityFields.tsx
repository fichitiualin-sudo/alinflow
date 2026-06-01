"use client";

import type { ReactNode } from "react";
import {
  normalizePostalCodeInput,
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

export function PostalCodeCityFields({ postalCode = "", city = "", onChange }: PostalCodeCityFieldsProps) {
  const normalizedPostalCode = normalizePostalCodeInput(postalCode);

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
          autoComplete="off"
        />
      </FieldShell>

      <FieldShell label="Település">
        <input
          className="mt-2 w-full bg-transparent text-lg font-black outline-none"
          value={city || ""}
          onChange={(event) => handleCityChange(event.target.value)}
          placeholder="pl. Hévízgyörk"
          autoComplete="off"
        />
      </FieldShell>
    </>
  );
}
