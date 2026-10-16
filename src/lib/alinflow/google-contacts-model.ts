export type ContactSource = {
  customerId: string; name: string; phone: string; email: string; address: string; notes: string; sourceHash: string;
  memberCustomerIds?: string[]; phones?: string[]; emails?: string[]; addresses?: string[];
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
export type ManagedContactSnapshotV1 = {
  version: 1; marker: string; name: WritableField | null; phone: WritableField | null;
  email: WritableField | null; address: WritableField | null; noteBlock: string;
  source: Pick<ContactSource, "name" | "phone" | "email" | "address">;
};
export type ManagedContactSnapshotV2 = {
  version: 2; marker: string; memberCustomerIds: string[]; name: WritableField | null;
  phones: WritableField[]; emails: WritableField[]; addresses: WritableField[]; noteBlock: string;
  source: { name: string; phones: string[]; emails: string[]; addresses: string[] };
};
export type ManagedContactSnapshot = ManagedContactSnapshotV1 | ManagedContactSnapshotV2;
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
function groupMemberIds(source: ContactSource): string[] | null {
  const ids = source.memberCustomerIds;
  if (ids === undefined) {
    if (source.phones !== undefined || source.emails !== undefined || source.addresses !== undefined) {
      throw new Error("A több ügyfélhez tartozó névjegy jóváhagyott tagsága hiányzik.");
    }
    return null;
  }
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 10 || new Set(ids).size !== ids.length
    || ids.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) || !ids.includes(source.customerId)) {
    throw new Error("A közös névjegy jóváhagyott ügyfélköre nem ellenőrizhető.");
  }
  return [...ids].sort();
}
/** The source loader supplies approved membership. This helper never infers a group. */
export function contactSourceValues(source: ContactSource): { phones: string[]; emails: string[]; addresses: string[] } {
  const members = groupMemberIds(source);
  if (!members) return { phones: source.phone.trim() ? [source.phone.trim()] : [],
    emails: source.email.trim() ? [source.email.trim()] : [], addresses: source.address.trim() ? [source.address.trim()] : [] };
  const result: { phones: string[]; emails: string[]; addresses: string[] } = { phones: [], emails: [], addresses: [] };
  for (const [key, scalar] of [["phones", "phone"], ["emails", "email"], ["addresses", "address"]] as const) {
    const values = source[key];
    if (!Array.isArray(values) || values.length > members.length || values.some((item) => typeof item !== "string")) {
      throw new Error("A közös névjegy elérhetőségei nem ellenőrizhetők teljesen.");
    }
    const seen = new Set<string>();
    for (const input of values) {
      const item = input.trim();
      if (!item) continue;
      const identity = key === "phones" ? normalizeContactPhone(item) : key === "emails" ? normalizeContactEmail(item) : item;
      if (!identity) throw new Error("A közös névjegy egyik elérhetősége javítást igényel.");
      if (!seen.has(identity)) { seen.add(identity); result[key].push(item); }
    }
    const scalarValue = source[scalar].trim();
    const scalarIdentity = key === "phones" ? normalizeContactPhone(scalarValue) : key === "emails" ? normalizeContactEmail(scalarValue) : scalarValue;
    if (scalarValue && (!scalarIdentity || !seen.has(scalarIdentity))) {
      throw new Error("A közös névjegy egyik ügyféladata hiányzik az összesített adatokból.");
    }
  }
  return result;
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
  const values = contactSourceValues(source);
  const phones = new Set(values.phones.map(normalizeContactPhone).filter(Boolean));
  const emails = new Set(values.emails.map(normalizeContactEmail).filter(Boolean));
  const candidates: Array<{ contact: GoogleContact; evidence: Array<"phone" | "email"> }> = [];
  const seen = new Set<string>();
  for (const contact of contacts) {
    if (!contact.resourceName || contact.metadata?.deleted || seen.has(contact.resourceName)) continue;
    const evidence: Array<"phone" | "email"> = [];
    if (phones.size && fields(contact, "phoneNumbers").some((field) => phones.has(normalizeContactPhone(field.value)))) evidence.push("phone");
    if (emails.size && fields(contact, "emailAddresses").some((field) => emails.has(normalizeContactEmail(field.value)))) evidence.push("email");
    if (evidence.length) { seen.add(contact.resourceName); candidates.push({ contact, evidence }); }
  }
  return { candidates, conflict: candidates.length > 1 };
}
function noteBlock(source: ContactSource) {
  if (!source.notes.trim() || source.notes.includes(NOTE_START) || source.notes.includes(NOTE_END) || source.notes.length > 40000) {
    throw new Error("A névjegyhez tartozó AlinFlow-adatok külön ellenőrzést igényelnek.");
  }
  return source.notes.trim();
}
function desiredFields(source: ContactSource) {
  return {
    name: source.name.trim() ? { unstructuredName: source.name.trim() } : null,
    phone: source.phone.trim() ? { value: source.phone.trim(), type: "other" } : null,
    email: source.email.trim() ? { value: source.email.trim(), type: "other" } : null,
    address: source.address.trim() ? { formattedValue: source.address.trim(), type: "other" } : null,
  } satisfies Record<string, WritableField | null>;
}
function sourceValues(source: ContactSource): ManagedContactSnapshotV1["source"] {
  return { name: source.name, phone: source.phone, email: source.email, address: source.address };
}
function validateMarker(marker: string) {
  if (!marker || marker.length > 200 || !/^[a-zA-Z0-9:_-]+$/.test(marker)) throw new Error("Érvénytelen névjegy-azonosító.");
}
export function buildContactCreate(source: ContactSource, marker: string): ContactMutation {
  validateMarker(marker);
  const members = groupMemberIds(source);
  if (members) return buildGroupedContactCreate(source, marker, members);
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
  const members = groupMemberIds(source);
  if (members) {
    if (previous?.version === 1) return { ok: false, reason: "A meglévő önálló névjegy nem alakítható át automatikusan közös névjeggyé." };
    return mergeGroupedContactUpdate(source, remote, previous, marker, members);
  }
  if (previous?.version === 2) return { ok: false, reason: "A közös névjegy ügyfélköre megváltozott; ellenőrzés szükséges." };
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
  const managed: ManagedContactSnapshotV1 = { version: 1, marker, name: null, phone: null, email: null, address: null, noteBlock: block, source: sourceValues(source) };
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
  // The saved text remains the ownership boundary even without visible labels.
  const nextPosition = nextNote.indexOf(block);
  if (nextNote.indexOf(block, nextPosition + 1) >= 0) {
    return { ok: false, reason: "A telepítési megjegyzés többször szerepelne a Google-névjegyben; ellenőrzés szükséges." };
  }
  if (nextNote !== oldNote) { body.biographies = [{ value: nextNote, contentType: "TEXT_PLAIN", ...(biographies[0]?.metadata ? { metadata: biographies[0].metadata } : {}) }]; masks.push("biographies"); }
  if (!markers.length) { body.userDefined = [...fields(remote, "userDefined"), { key: MARKER_KEY, value: marker }]; masks.push("userDefined"); }
  return { ok: true, body, updatePersonFields: masks.join(","), managed };
}

function groupScalarSource(source: ContactSource): ContactSource {
  // Reuse the established single-name, note, marker and ETag handling without touching arrays.
  return { customerId: source.customerId, name: source.name, phone: "", email: "", address: "", notes: source.notes, sourceHash: source.sourceHash };
}
function groupDesired(source: ContactSource) {
  const values = contactSourceValues(source);
  return { values, phones: values.phones.map((value) => ({ value, type: "other" } satisfies WritableField)),
    emails: values.emails.map((value) => ({ value, type: "other" } satisfies WritableField)),
    addresses: values.addresses.map((formattedValue) => ({ formattedValue, type: "other" } satisfies WritableField)) };
}
function buildGroupedContactCreate(source: ContactSource, marker: string, memberCustomerIds: string[]): ContactMutation {
  const desired = groupDesired(source), common = buildContactCreate(groupScalarSource(source), marker);
  return {
    body: { ...common.body, ...(desired.phones.length ? { phoneNumbers: desired.phones } : {}),
      ...(desired.emails.length ? { emailAddresses: desired.emails } : {}), ...(desired.addresses.length ? { addresses: desired.addresses } : {}) },
    managed: { version: 2, marker, memberCustomerIds, name: common.managed.name,
      phones: desired.phones, emails: desired.emails, addresses: desired.addresses, noteBlock: common.managed.noteBlock,
      source: { name: source.name, ...desired.values } },
  };
}
function validGroupSnapshot(snapshot: ManagedContactSnapshotV2): boolean {
  return snapshot.version === 2 && Array.isArray(snapshot.memberCustomerIds) && snapshot.memberCustomerIds.length >= 2 && snapshot.memberCustomerIds.length <= 10
    && new Set(snapshot.memberCustomerIds).size === snapshot.memberCustomerIds.length
    && snapshot.memberCustomerIds.every((id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id))
    && ["phones", "emails", "addresses"].every((key) => {
      const owned = snapshot[key as "phones" | "emails" | "addresses"], original = snapshot.source?.[key as "phones" | "emails" | "addresses"];
      return Array.isArray(owned) && owned.length <= 10 && owned.every((field) => field && typeof field === "object"
        && typeof (key === "addresses" ? field.formattedValue : field.value) === "string")
        && Array.isArray(original) && original.length <= 10 && original.every((value) => typeof value === "string");
    });
}
function groupFieldIdentity(key: "phones" | "emails" | "addresses", field: WritableField) {
  return key === "phones" ? normalizeContactPhone(field.value) : key === "emails" ? normalizeContactEmail(field.value) : (field.formattedValue || "").trim();
}
function groupSourceIdentities(key: "phones" | "emails" | "addresses", values: string[]) {
  return [...new Set(values.map((value) => groupFieldIdentity(key, key === "addresses" ? { formattedValue: value } : { value })))].sort();
}
function mergeGroupedContactUpdate(source: ContactSource, remote: GoogleContact, previous: ManagedContactSnapshotV2 | null,
  marker: string, members: string[]): ContactMergeResult {
  if (previous && (!validGroupSnapshot(previous) || !same([...previous.memberCustomerIds].sort(), members))) {
    return { ok: false, reason: "A közös névjegy jóváhagyott ügyfélköre megváltozott; ellenőrzés szükséges." };
  }
  const desired = groupDesired(source);
  const commonPrevious: ManagedContactSnapshotV1 | null = previous ? { version: 1, marker: previous.marker, name: previous.name,
    phone: null, email: null, address: null, noteBlock: previous.noteBlock,
    source: { name: previous.source.name, phone: "", email: "", address: "" } } : null;
  const common = mergeContactUpdate(groupScalarSource(source), remote, commonPrevious, marker);
  if (!common.ok) return common;
  const body = common.body, masks = common.updatePersonFields.split(",").filter(Boolean);
  const managed: ManagedContactSnapshotV2 = { version: 2, marker, memberCustomerIds: members, name: common.managed.name,
    phones: [], emails: [], addresses: [], noteBlock: common.managed.noteBlock, source: { name: source.name, ...desired.values } };
  for (const [key, remoteKey] of [["phones", "phoneNumbers"], ["emails", "emailAddresses"], ["addresses", "addresses"]] as const) {
    const current = fields(remote, remoteKey), next = current.map((field) => ({ ...field })), oldOwned = previous?.[key] || [];
    const oldIdentities = groupSourceIdentities(key, previous?.source[key] || []), newIdentities = groupSourceIdentities(key, desired.values[key]);
    const matches = oldOwned.map((old) => current.filter((field) => sameOwned(field, old)).length);
    if (matches.some((count) => count > 1) || oldOwned.some((old, index) => oldOwned.some((other, otherIndex) => index !== otherIndex && sameOwned(old, other)))) {
      return { ok: false, reason: "A közös névjegy kezelt elérhetősége nem azonosítható egyértelműen; ellenőrzés szükséges." };
    }
    if (matches.some((count) => count === 0) && !same(oldIdentities, newIdentities)) {
      return { ok: false, reason: "A Google-névjegy és az AlinFlow ugyanazt az adatot módosította; ellenőrzés szükséges." };
    }
    const removed: WritableField[] = [], added: WritableField[] = [];
    for (const old of oldOwned) {
      const index = next.findIndex((field) => sameOwned(field, old));
      if (index < 0) continue; // A manual edit or deletion remains personal and is not restored.
      if (newIdentities.includes(groupFieldIdentity(key, old))) managed[key].push({ ...next[index] });
      else removed.push(...next.splice(index, 1));
    }
    for (const wanted of desired[key]) {
      const identity = groupFieldIdentity(key, wanted);
      if (next.some((field) => groupFieldIdentity(key, field) === identity) || previous && oldIdentities.includes(identity)) continue;
      const field = { ...wanted } as WritableField;
      next.push(field); added.push(field); managed[key].push(field);
    }
    // Only a single replacement has an unambiguous preferred-field flag to carry over.
    if (removed.length === 1 && added.length === 1 && removed[0].metadata) added[0].metadata = { ...removed[0].metadata };
    if (!sameFields(current, next)) { body[remoteKey] = next; masks.push(remoteKey); }
  }
  return { ok: true, body, updatePersonFields: masks.join(","), managed };
}

/** Recovery proof for a PATCH whose response was lost. Always pass its saved body
 * and mask when recovering a mutation: a positive snapshot alone cannot prove a removal. */
export function contactMatchesManagedSnapshot(remote: GoogleContact, snapshot: ManagedContactSnapshot,
  mutation?: { body: GoogleContact; updatePersonFields: string }): boolean {
  if (remote.metadata?.deleted || !remote.resourceName || ![1, 2].includes(snapshot.version)
    || snapshot.version === 2 && !validGroupSnapshot(snapshot)) return false;
  const markers = googleContactMarkers(remote);
  if (markers.length !== 1 || markers[0] !== snapshot.marker) return false;
  const biographies = fields(remote, "biographies");
  if (biographies.length !== 1 || !snapshot.noteBlock) return false;
  const note = biographies[0].value || "", position = note.indexOf(snapshot.noteBlock);
  if (position < 0 || note.indexOf(snapshot.noteBlock, position + 1) >= 0) return false;
  if (snapshot.version === 1) {
    for (const [key, remoteKey] of [["name", "names"], ["phone", "phoneNumbers"], ["email", "emailAddresses"], ["address", "addresses"]] as const) {
      const owned = snapshot[key];
      if (owned && !fields(remote, remoteKey).some((field) => sameOwned(field, owned))) return false;
    }
  } else {
    if (snapshot.name && !fields(remote, "names").some((field) => sameOwned(field, snapshot.name!))) return false;
    for (const [key, remoteKey] of [["phones", "phoneNumbers"], ["emails", "emailAddresses"], ["addresses", "addresses"]] as const) {
      const unmatched = fields(remote, remoteKey);
      for (const owned of snapshot[key]) {
        const index = unmatched.findIndex((field) => sameOwned(field, owned));
        if (index < 0) return false;
        unmatched.splice(index, 1);
      }
    }
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
