import type { Customer, LeadImportCandidate } from "./types";

function normalizeTextForSearch(value?: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function normalizeEmailForCompare(value?: string) {
  return String(value || "").trim().toLowerCase();
}

export function normalizePhoneForStorage(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("0036")) return `06${digits.slice(4)}`;
  if (digits.startsWith("36")) return `06${digits.slice(2)}`;
  if (digits.startsWith("06")) return digits;
  if (digits.startsWith("0")) return digits;

  return `06${digits}`;
}

export function normalizePhoneForCompare(value?: string) {
  return normalizePhoneForStorage(value).replace(/\D/g, "");
}

function normalizeCsvHeader(value?: string) {
  return normalizeTextForSearch(value).replace(/[^a-z0-9]/g, "");
}

export function parseCsvText(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      continue;
    }

    cell += ch;
  }

  row.push(cell.trim());
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function findCsvIndex(headers: string[], variants: string[]) {
  const normalizedHeaders = headers.map(normalizeCsvHeader);
  const normalizedVariants = variants.map(normalizeCsvHeader);
  return normalizedHeaders.findIndex((header) => normalizedVariants.includes(header));
}

export function buildLeadImportPreview(text: string, existingCustomers: Customer[]): LeadImportCandidate[] {
  const rows = parseCsvText(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return [];

  const headers = rows[0];
  const nameIndex = findCsvIndex(headers, ["Név", "Nev", "Name", "Full name", "Teljes név"]);
  const emailIndex = findCsvIndex(headers, ["E-mail-cím", "Email", "E-mail", "Email cím", "E-mail cím"]);
  const phoneIndex = findCsvIndex(headers, ["Telefon", "Phone", "Telefonszám", "Phone number", "Mobile"]);

  const existingPhones = new Set(existingCustomers.map((customer) => normalizePhoneForCompare(customer.phone)).filter(Boolean));
  const existingEmails = new Set(existingCustomers.map((customer) => normalizeEmailForCompare(customer.email)).filter(Boolean));
  const keptByKey = new Map<string, LeadImportCandidate>();
  const keptRows: LeadImportCandidate[] = [];
  const skippedRows: LeadImportCandidate[] = [];

  rows.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    const name = nameIndex >= 0 ? String(cells[nameIndex] || "").trim() : "";
    const email = emailIndex >= 0 ? normalizeEmailForCompare(cells[emailIndex]) : "";
    const phone = phoneIndex >= 0 ? normalizePhoneForStorage(cells[phoneIndex]) : "";
    const phoneKey = normalizePhoneForCompare(phone);
    const emailKey = normalizeEmailForCompare(email);

    let invalid = false;
    let invalidReason = "";

    if (!name && !phone && !email) {
      invalid = true;
      invalidReason = "üres sor";
    } else if (!name) {
      invalid = true;
      invalidReason = "hiányzó név";
    } else if (!phone && !email) {
      invalid = true;
      invalidReason = "hiányzó telefonszám és email";
    }

    if (invalid) {
      skippedRows.push({
        id: `${rowNumber}-${phoneKey || emailKey || name || "invalid"}`,
        rowNumber,
        name,
        phone,
        email,
        duplicate: false,
        invalid: true,
        invalidReason,
      });
      return;
    }

    if (phoneKey && existingPhones.has(phoneKey)) {
      skippedRows.push({
        id: `${rowNumber}-${phoneKey}`,
        rowNumber,
        name,
        phone,
        email,
        duplicate: true,
        duplicateReason: "már létező telefonszám",
      });
      return;
    }

    if (emailKey && existingEmails.has(emailKey)) {
      skippedRows.push({
        id: `${rowNumber}-${emailKey}`,
        rowNumber,
        name,
        phone,
        email,
        duplicate: true,
        duplicateReason: "már létező email",
      });
      return;
    }

    const keys = [phoneKey ? `p:${phoneKey}` : "", emailKey ? `e:${emailKey}` : ""].filter(Boolean);
    const existingKey = keys.find((key) => keptByKey.has(key));

    if (existingKey) {
      const kept = keptByKey.get(existingKey)!;
      kept.name = kept.name || name;
      kept.phone = kept.phone || phone;
      kept.email = kept.email || email;
      kept.mergedRows = (kept.mergedRows || 1) + 1;
      keys.forEach((key) => keptByKey.set(key, kept));
      return;
    }

    const candidate: LeadImportCandidate = {
      id: `${rowNumber}-${phoneKey || emailKey || name}`,
      rowNumber,
      name,
      phone,
      email,
      duplicate: false,
      mergedRows: 1,
    };
    keys.forEach((key) => keptByKey.set(key, candidate));
    keptRows.push(candidate);
  });

  return [...keptRows, ...skippedRows].filter((candidate) => candidate.name || candidate.phone || candidate.email || candidate.invalid);
}
