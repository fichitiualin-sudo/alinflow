export type ContactSource = {
  customerId: string; name: string; phone: string; email: string; address: string; notes: string; sourceHash: string;
};
type FieldMetadata = { source?: { type?: string; id?: string }; primary?: boolean; sourcePrimary?: boolean };
export type GoogleContactField = { metadata?: FieldMetadata; [key: string]: unknown };
export type GoogleContact = {
  resourceName?: string; etag?: string;
  metadata?: { deleted?: boolean; sources?: Array<{ type?: string; id?: string; etag?: string }> };
  names?: GoogleContactField[]; phoneNumbers?: GoogleContactField[]; emailAddresses?: GoogleContactField[];
  addresses?: GoogleContactField[]; biographies?: GoogleContactField[]; userDefined?: GoogleContactField[];
};
type WritableField = Record<string, unknown> & {
  metadata?: { sourcePrimary?: boolean }; value?: string; type?: string; key?: string;
  formattedValue?: string; contentType?: string;
};
export type ManagedContactSnapshot = {
  version: 1; marker: string; name: WritableField | null; phone: WritableField | null;
  email: WritableField | null; address: WritableField | null; noteBlock: string;
  source: Pick<ContactSource, "name" | "phone" | "email" | "address">;
};
export type ContactMutation = { body: GoogleContact; managed: ManagedContactSnapshot };
export type ContactMergeResult = (ContactMutation & { ok: true; updatePersonFields: string }) | { ok: false; reason: string };
const MARKER_KEY = "alinflow";
const NOTE_START = "--- AlinFlow ---";
const NOTE_END = "--- AlinFlow vége ---";
const WRITABLE_KEYS: Record<string, readonly string[]> = {
  names: ["givenName", "familyName", "middleName", "honorificPrefix", "honorificSuffix", "phoneticFullName", "phoneticFamilyName", "phoneticGivenName", "phoneticMiddleName", "phoneticHonorificPrefix", "phoneticHonorificSuffix", "unstructuredName"],
  phoneNumbers: ["value", "type"], emailAddresses: ["value", "type", "displayName"],
  addresses: ["formattedValue", "type", "poBox", "streetAddress", "extendedAddress", "city", "region", "postalCode", "country", "countryCode"],
  biographies: ["value", "contentType"], userDefined: ["key", "value"],
};

/** Hungarian local formats are expanded only when their length is unambiguous. */
export function normalizeContactPhone(value: unknown): string {
  const input = String(value ?? "").trim();
  if (!input || /[^\d+()\s.\-/]/u.test(input) || (input.match(/\+/g) || []).length > 1) return "";
  let number = input.replace(/[()\s.\-/]/g, "");
  if (number.startsWith("00")) number = `+${number.slice(2)}`;
  if (/^06\d{8,9}$/.test(number)) number = `+36${number.slice(2)}`;
  else if (/^36\d{8,9}$/.test(number)) number = `+${number}`;
  else if (/^(?:1\d{7}|[2-9]\d{8})$/.test(number)) number = `+36${number}`;
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : "";
}
export function normalizeContactEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
function isContactField(field: GoogleContactField) { return !field.metadata?.source?.type || field.metadata.source.type === "CONTACT"; }
function fields(contact: GoogleContact, field: keyof typeof WRITABLE_KEYS): WritableField[] {
  const values = contact[field as keyof GoogleContact];
  if (!Array.isArray(values)) return [];
  return (values as GoogleContactField[]).filter(isContactField).map((value) => ({
    ...Object.fromEntries(WRITABLE_KEYS[field].filter((key) => typeof value[key] === "string").map((key) => [key, value[key] as string])),
    // sourcePrimary is writable; primary, verified and source are output-only.
    ...(typeof value.metadata?.sourcePrimary === "boolean" ? { metadata: { sourcePrimary: value.metadata.sourcePrimary } } : {}),
  }));
}
function same(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return a === b;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).sort();
  return keys.length === Object.keys(right).length && keys.every((key) => same(left[key], right[key]));
}
function sameOwned(a: WritableField, b: WritableField) {
  const withoutMetadata = (field: WritableField) => Object.fromEntries(Object.entries(field).filter(([key]) => key !== "metadata"));
  return same(withoutMetadata(a), withoutMetadata(b));
}
function sameMutationField(actual: WritableField, expected: WritableField) {
  return sameOwned(actual, expected) && (typeof expected.metadata?.sourcePrimary !== "boolean"
    || actual.metadata?.sourcePrimary === expected.metadata.sourcePrimary);
}
function sameFields(a: WritableField[], b: WritableField[]) { return a.length === b.length && a.every((item, i) => same(item, b[i])); }
export function googleContactMarkers(contact: GoogleContact): string[] {
  return fields(contact, "userDefined").filter((field) => field.key === MARKER_KEY).map((field) => field.value || "");
}
export function findContactCandidates(source: ContactSource, contacts: GoogleContact[]) {
  const phone = normalizeContactPhone(source.phone), email = normalizeContactEmail(source.email);
  const candidates: Array<{ contact: GoogleContact; evidence: Array<"phone" | "email"> }> = [];
  const seen = new Set<string>();
  for (const contact of contacts) {
    if (!contact.resourceName || contact.metadata?.deleted || seen.has(contact.resourceName)) continue;
    const evidence: Array<"phone" | "email"> = [];
    if (phone && fields(contact, "phoneNumbers").some((field) => normalizeContactPhone(field.value) === phone)) evidence.push("phone");
    if (email && fields(contact, "emailAddresses").some((field) => normalizeContactEmail(field.value) === email)) evidence.push("email");
    if (evidence.length) { seen.add(contact.resourceName); candidates.push({ contact, evidence }); }
  }
  return { candidates, conflict: candidates.length > 1 };
}
function noteBlock(source: ContactSource) {
  if (source.notes.includes(NOTE_START) || source.notes.includes(NOTE_END) || source.notes.length > 40000) {
    throw new Error("A névjegyhez tartozó AlinFlow-adatok külön ellenőrzést igényelnek.");
  }
  return `${NOTE_START}\n${source.notes.trim()}\n${NOTE_END}`;
}
function desiredFields(source: ContactSource) {
  return {
    name: source.name.trim() ? { unstructuredName: source.name.trim() } : null,
    phone: source.phone.trim() ? { value: source.phone.trim(), type: "other" } : null,
    email: source.email.trim() ? { value: source.email.trim(), type: "other" } : null,
    address: source.address.trim() ? { formattedValue: source.address.trim(), type: "other" } : null,
  } satisfies Record<string, WritableField | null>;
}
function sourceValues(source: ContactSource): ManagedContactSnapshot["source"] {
  return { name: source.name, phone: source.phone, email: source.email, address: source.address };
}
function validateMarker(marker: string) {
  if (!marker || marker.length > 200 || !/^[a-zA-Z0-9:_-]+$/.test(marker)) throw new Error("Érvénytelen névjegy-azonosító.");
}
export function buildContactCreate(source: ContactSource, marker: string): ContactMutation {
  validateMarker(marker);
  const desired = desiredFields(source), block = noteBlock(source);
  if (!desired.name) throw new Error("A névjegy létrehozásához név szükséges.");
  return {
    body: {
      names: [desired.name], ...(desired.phone ? { phoneNumbers: [desired.phone] } : {}),
      ...(desired.email ? { emailAddresses: [desired.email] } : {}), ...(desired.address ? { addresses: [desired.address] } : {}),
      biographies: [{ value: block, contentType: "TEXT_PLAIN" }], userDefined: [{ key: MARKER_KEY, value: marker }],
    },
    managed: { version: 1, marker, ...desired, noteBlock: block, source: sourceValues(source) },
  };
}

/** Only fields added by AlinFlow are replaceable. Matched personal values stay personal. */
export function mergeContactUpdate(source: ContactSource, remote: GoogleContact, previous: ManagedContactSnapshot | null, marker: string): ContactMergeResult {
  validateMarker(marker);
  if (remote.metadata?.deleted || !remote.resourceName) return { ok: false, reason: "A kapcsolt Google-névjegy már nem érhető el." };
  const contactSources = remote.metadata?.sources?.filter((entry) => entry.type === "CONTACT") || [];
  if (contactSources.length !== 1 || !contactSources[0].etag) return { ok: false, reason: "A Google-névjegy verziója nem ellenőrizhető." };
  const markers = googleContactMarkers(remote);
  if (markers.some((value) => value !== marker) || markers.length > 1 || previous && (previous.version !== 1 || previous.marker !== marker)) {
    return { ok: false, reason: "A Google-névjegy másik ügyfélhez kapcsolódik; ellenőrzés szükséges." };
  }
  if (previous && markers.length !== 1) return { ok: false, reason: "A Google-névjegy AlinFlow-kapcsolata megváltozott; ellenőrzés szükséges." };
  const desired = desiredFields(source), block = noteBlock(source);
  const body: GoogleContact = { resourceName: remote.resourceName, metadata: { sources: contactSources.map((entry) => ({ type: "CONTACT", id: entry.id, etag: entry.etag })) } };
  const masks: string[] = [];
  const managed: ManagedContactSnapshot = { version: 1, marker, name: null, phone: null, email: null, address: null, noteBlock: block, source: sourceValues(source) };
  const equivalent = (key: "phone" | "email" | "address", a: WritableField, b: WritableField) => {
    if (key === "phone") return Boolean(normalizeContactPhone(a.value)) && normalizeContactPhone(a.value) === normalizeContactPhone(b.value);
    if (key === "email") return Boolean(normalizeContactEmail(a.value)) && normalizeContactEmail(a.value) === normalizeContactEmail(b.value);
    return (a.formattedValue || "").trim().toLocaleLowerCase("hu-HU") === (b.formattedValue || "").trim().toLocaleLowerCase("hu-HU");
  };
  const names = fields(remote, "names");
  // A manually edited name stays untouched. Full names are not split by guesswork.
  if (names.length === 0 && !previous && desired.name) { body.names = [desired.name]; masks.push("names"); managed.name = desired.name; }
  else if (previous?.name && names.length === 1 && sameOwned(names[0], previous.name)) {
    managed.name = desired.name || previous.name;
    if (desired.name && !sameOwned(names[0], desired.name)) { body.names = [{ ...desired.name, ...(names[0].metadata ? { metadata: names[0].metadata } : {}) }]; masks.push("names"); }
  }
  for (const [key, remoteKey] of [["phone", "phoneNumbers"], ["email", "emailAddresses"], ["address", "addresses"]] as const) {
    const current = fields(remote, remoteKey), next = current.map((field) => ({ ...field }));
    const old = previous?.[key], wanted = desired[key];
    const ownedIndex = old ? next.findIndex((field) => sameOwned(field, old)) : -1;
    if (old && ownedIndex >= 0) {
      const duplicateIndex = wanted ? next.findIndex((field, index) => index !== ownedIndex && equivalent(key, field, wanted)) : -1;
      if (wanted && duplicateIndex < 0) { next[ownedIndex] = { ...wanted, ...(next[ownedIndex].metadata ? { metadata: next[ownedIndex].metadata } : {}) }; managed[key] = wanted; }
      else next.splice(ownedIndex, 1);
    } else if (old) {
      // The user edited/deleted our former value. Keep that edit; do not restore it.
      if (previous.source[key] !== source[key]) return { ok: false, reason: "A Google-névjegy és az AlinFlow ugyanazt az adatot módosította; ellenőrzés szükséges." };
    } else if (wanted && !next.some((field) => equivalent(key, field, wanted)) && (!previous || previous.source[key] !== source[key])) {
      next.push(wanted); managed[key] = wanted;
    }
    if (!sameFields(current, next)) { body[remoteKey] = next; masks.push(remoteKey); }
  }
  const biographies = fields(remote, "biographies");
  if (biographies.length > 1 || biographies.some((item) => item.value && item.contentType && item.contentType !== "TEXT_PLAIN")) {
    return { ok: false, reason: "A meglévő Google-megjegyzés formátuma külön ellenőrzést igényel." };
  }
  const oldNote = biographies[0]?.value || "";
  let nextNote: string;
  if (previous) {
    const position = oldNote.indexOf(previous.noteBlock);
    if (position < 0 || oldNote.indexOf(previous.noteBlock, position + 1) >= 0) {
      return { ok: false, reason: "Az AlinFlow-megjegyzést a Google-névjegyben módosították; ellenőrzés szükséges." };
    }
    nextNote = oldNote.slice(0, position) + block + oldNote.slice(position + previous.noteBlock.length);
  } else if (oldNote.includes(NOTE_START) || oldNote.includes(NOTE_END)) {
    return { ok: false, reason: "A Google-névjegyben már van AlinFlow-megjegyzés; ellenőrzés szükséges." };
  } else nextNote = oldNote ? `${oldNote}\n\n${block}` : block;
  if (nextNote !== oldNote) { body.biographies = [{ value: nextNote, contentType: "TEXT_PLAIN", ...(biographies[0]?.metadata ? { metadata: biographies[0].metadata } : {}) }]; masks.push("biographies"); }
  if (!markers.length) { body.userDefined = [...fields(remote, "userDefined"), { key: MARKER_KEY, value: marker }]; masks.push("userDefined"); }
  return { ok: true, body, updatePersonFields: masks.join(","), managed };
}

/** Recovery proof for a PATCH whose response was lost. Always pass its saved body
 * and mask when recovering a mutation: a positive snapshot alone cannot prove a removal. */
export function contactMatchesManagedSnapshot(remote: GoogleContact, snapshot: ManagedContactSnapshot,
  mutation?: { body: GoogleContact; updatePersonFields: string }): boolean {
  if (remote.metadata?.deleted || !remote.resourceName || snapshot.version !== 1) return false;
  const markers = googleContactMarkers(remote);
  if (markers.length !== 1 || markers[0] !== snapshot.marker) return false;
  const biographies = fields(remote, "biographies");
  if (biographies.length !== 1 || !snapshot.noteBlock) return false;
  const note = biographies[0].value || "", position = note.indexOf(snapshot.noteBlock);
  if (position < 0 || note.indexOf(snapshot.noteBlock, position + 1) >= 0) return false;
  for (const [key, remoteKey] of [["name", "names"], ["phone", "phoneNumbers"], ["email", "emailAddresses"], ["address", "addresses"]] as const) {
    const owned = snapshot[key];
    if (owned && !fields(remote, remoteKey).some((field) => sameOwned(field, owned))) return false;
  }
  if (mutation) {
    const mask = mutation.updatePersonFields.split(",").filter(Boolean);
    if (!mask.length || mask.some((field) => !Object.hasOwn(WRITABLE_KEYS, field))) return false;
    for (const key of mask) {
      const current = fields(remote, key), expected = fields(mutation.body, key);
      if (current.length !== expected.length) return false;
      const unmatched = [...current];
      for (const field of expected) {
        const index = unmatched.findIndex((candidate) => sameMutationField(candidate, field));
        if (index < 0) return false;
        unmatched.splice(index, 1);
      }
    }
  }
  return true;
}
