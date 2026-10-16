import { createHash, randomUUID } from "node:crypto";
import { contactsAccessToken, contactsAdmin, GoogleContactsAuthError } from "./google-contacts-auth";
import { ApiError } from "./server-auth";
import { buildContactCreate, contactMatchesManagedSnapshot, findContactCandidates, googleContactMarkers, mergeContactUpdate,
  contactSourceValues, normalizeContactEmail, normalizeContactPhone, type ContactSource, type GoogleContact, type ManagedContactSnapshot } from "./google-contacts-model";
import { groupGoogleContactSources, loadGoogleContactSources, type GoogleContactGroup } from "./google-contacts-source";

type Admin = ReturnType<typeof contactsAdmin>;
export type ContactsConnection = { workspace_id: string; google_subject: string; google_email: string; status: string;
  refresh_token_encrypted: string; lease_token?: string; lease_expires_at?: string };
type Link = { customer_id: string; resource_name: string | null; state: "pending" | "creating" | "uncertain" | "synced" | "review";
  approved_source_hash: string; synced_source_hash: string | null; managed_snapshot: ManagedContactSnapshot | null; mutation_snapshot?: ManagedContactSnapshot | null; mutation_source_hash?: string | null; mutation_payload?: { body: GoogleContact; updatePersonFields: string } | null; last_error: string | null; next_sync_at: string };
type Proof = { memberCustomerIds?: string[]; customerId: string; sourceHash: string; options: (string | null)[]; remoteHashes: Record<string, string> };
type Approval = { customerId: string; resourceName: string | null; sourceHash: string };
export type ContactPreviewItem = ContactSource & { groupable?: boolean; members?: Pick<ContactSource, "customerId" | "name" | "phone" | "email" | "address">[]; state: "new" | "match" | "ambiguous" | "linked" | "review"; resourceName: string | null;
  candidates: { resourceName: string; name: string; phones: string[]; emails: string[]; evidence: ("phone" | "email")[] }[]; lastError?: string };
const FIELDS = "metadata,names,phoneNumbers,emailAddresses,addresses,biographies,userDefined";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE = /^people\/[a-zA-Z0-9_-]+$/;
class ContactsSyncError extends Error { constructor(public kind: "remote" | "superseded" | "database" | "review", public status?: number) { super(kind); } }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const markerFor = (workspaceId: string, customerId: string) => `${workspaceId}:${customerId}`;
const refreshPreview = () => new ApiError("Az adatok változtak vagy az előnézet lejárt. Frissítsd az ellenőrző listát.", 409);

async function googleRequest(token: string, path: string, deadline: number, method = "GET", body?: unknown) {
  const remaining = deadline - Date.now();
  if (remaining < 1000) throw new ContactsSyncError("remote");
  const response = await fetch(`https://people.googleapis.com/v1/${path}`, { method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(Math.min(10000, remaining)) });
  // Never expose or persist a provider error body containing personal data.
  const data = response.ok ? await response.json() : null;
  return { ok: response.ok, status: response.status, data };
}
function queryFields() { return new URLSearchParams({ personFields: FIELDS, sources: "READ_SOURCE_TYPE_CONTACT" }); }
export async function listGoogleContacts(token: string, deadline = Date.now() + 40000): Promise<GoogleContact[]> {
  const contacts: GoogleContact[] = [], seenPages = new Set<string>(), seenContacts = new Set<string>();
  let pageToken = "";
  for (let page = 0; page < 100; page += 1) {
    const params = queryFields(); params.set("pageSize", "1000");
    if (pageToken) params.set("pageToken", pageToken);
    const response = await googleRequest(token, `people/me/connections?${params}`, deadline);
    if (!response.ok) throw new ContactsSyncError("remote", response.status);
    if (!response.data || response.data.connections != null && !Array.isArray(response.data.connections)) throw new ContactsSyncError("remote");
    for (const contact of response.data.connections || []) {
      if (!RESOURCE.test(contact.resourceName || "") || seenContacts.has(contact.resourceName)) throw new ContactsSyncError("remote");
      if ((contact.phoneNumbers?.length || 0) >= 100 || (contact.emailAddresses?.length || 0) >= 100) throw new ApiError("Egy Google-névjegy nagyon sok elérhetőséget tartalmaz. A teljes egyezés ellenőrzése külön egyeztetést igényel.", 409);
      seenContacts.add(contact.resourceName); contacts.push(contact);
    }
    pageToken = response.data.nextPageToken || "";
    if (!pageToken) {
      if (typeof response.data.totalItems === "number" && response.data.totalItems > contacts.length) throw new ContactsSyncError("remote");
      return contacts;
    }
    if (typeof pageToken !== "string" || seenPages.has(pageToken)) throw new ContactsSyncError("remote");
    seenPages.add(pageToken);
  }
  // A partial phone book must never be mistaken for a complete duplicate check.
  throw new ContactsSyncError("remote");
}
async function connectionFor(admin: Admin, workspaceId: string) {
  const result = await admin.from("google_contacts_connections").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (result.error) throw new ContactsSyncError("database");
  if (!result.data || result.data.status !== "active") throw new ApiError("Előbb csatlakoztasd a Google Névjegyeket.", 409);
  return result.data as ContactsConnection;
}
async function loadLinks(admin: Admin, workspaceId: string): Promise<Link[]> {
  const rows: Link[] = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await admin.from("google_contacts_links").select("*").eq("workspace_id", workspaceId).order("customer_id").range(page * 1000, page * 1000 + 999);
    if (result.error || !result.data) throw new ContactsSyncError("database");
    rows.push(...result.data as Link[]);
    if (result.data.length < 1000) return rows;
  }
  throw new ContactsSyncError("database");
}
async function loadGroups(admin: Admin, workspaceId: string): Promise<GoogleContactGroup[]> {
  const groups = new Map<string, string[]>();
  for (let page = 0; page < 100; page += 1) {
    const result = await admin.from("google_contacts_link_members").select("customer_id,anchor_customer_id")
      .eq("workspace_id", workspaceId).order("customer_id").range(page * 1000, page * 1000 + 999);
    if (result.error || !Array.isArray(result.data)) throw new ContactsSyncError("database");
    for (const row of result.data) groups.set(row.anchor_customer_id, [...groups.get(row.anchor_customer_id) || [], row.customer_id]);
    if (result.data.length < 1000) return [...groups].map(([anchorCustomerId, memberCustomerIds]) => ({ anchorCustomerId, memberCustomerIds }));
  }
  throw new ContactsSyncError("database");
}
export async function countGoogleContactsRepresentedCustomers(workspaceId: string, linkedCount: number) {
  const groups = await loadGroups(contactsAdmin(), workspaceId);
  return linkedCount + groups.reduce((total, group) => total + Math.max(0, group.memberCustomerIds.length - 1), 0);
}
function localCollision(source: ContactSource, sources: ContactSource[]) {
  const values = contactSourceValues(source), phones = new Set(values.phones.map(normalizeContactPhone).filter(Boolean)),
    emails = new Set(values.emails.map(normalizeContactEmail).filter(Boolean));
  return sources.some(other => {
    if ((source.memberCustomerIds || [source.customerId]).includes(other.customerId)) return false;
    const otherValues = contactSourceValues(other);
    return otherValues.phones.some(value => phones.has(normalizeContactPhone(value))) || otherValues.emails.some(value => emails.has(normalizeContactEmail(value)));
  });
}
function parseProposedGroups(requested: unknown): GoogleContactGroup[] {
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 10) throw new ApiError("Legfeljebb tíz közös névjegyet állíts össze.");
  const seen = new Set<string>();
  return requested.map(group => {
    if (!group || typeof group.anchorCustomerId !== "string" || !UUID.test(group.anchorCustomerId) || !Array.isArray(group.memberCustomerIds)
      || group.memberCustomerIds.length < 2 || group.memberCustomerIds.length > 10 || !group.memberCustomerIds.includes(group.anchorCustomerId)
      || group.memberCustomerIds.some((id: unknown) => typeof id !== "string" || !UUID.test(id) || seen.has(id))
      || new Set(group.memberCustomerIds).size !== group.memberCustomerIds.length) throw new ApiError("Válassz 2–10 különböző ügyfelet és közülük egy fő nevet. A csoportok nem fedhetik egymást.");
    group.memberCustomerIds.forEach((id: string) => seen.add(id));
    return { anchorCustomerId: group.anchorCustomerId, memberCustomerIds: [...group.memberCustomerIds].sort() };
  });
}
function assertNewGroups(groups: GoogleContactGroup[], raw: ContactSource[], links: Link[], existing: GoogleContactGroup[]) {
  const reserved = new Set(existing.flatMap(group => group.memberCustomerIds));
  if (groups.some(group => group.memberCustomerIds.some(id => reserved.has(id) || links.some(link => link.customer_id === id)
    || !raw.some(source => source.customerId === id)))) throw new ApiError("Csak még nem összekapcsolt, saját telepítéssel rendelkező ügyfelek választhatók közös névjegyhez.", 409);
}
function decorateItems(items: ContactPreviewItem[], raw: ContactSource[]) {
  return items.map(item => ({ ...item, ...(item.memberCustomerIds ? { members: item.memberCustomerIds.flatMap(id => {
    const source = raw.find(source => source.customerId === id);
    return source ? [{ customerId: id, name: source.name, phone: source.phone, email: source.email, address: source.address }] : [];
  }) } : {}) }));
}
async function storePreview(admin: Admin, connection: ContactsConnection, userId: string, items: ContactPreviewItem[], proofs: Proof[]) {
  const previewId = randomUUID(), expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  const removed = await admin.from("google_contacts_previews").delete().eq("workspace_id", connection.workspace_id).eq("user_id", userId);
  if (removed.error) throw new ContactsSyncError("database");
  const saved = await admin.from("google_contacts_previews").insert({ id: previewId, workspace_id: connection.workspace_id, user_id: userId,
    google_subject: connection.google_subject, proofs, expires_at: expiresAt });
  if (saved.error) throw new ContactsSyncError("database");
  return { previewId, expiresAt, googleEmail: connection.google_email, items };
}
export function buildContactPreview(workspaceId: string, sources: ContactSource[], contacts: GoogleContact[], links: Link[], collisionSources = sources) {
  const proofs: Proof[] = [];
  const items: ContactPreviewItem[] = sources.map(source => {
    const link = links.find(item => item.customer_id === source.customerId);
    const found = findContactCandidates(source, contacts);
    const marker = markerFor(workspaceId, source.customerId);
    const candidates = found.candidates.map(candidate => ({ resourceName: candidate.contact.resourceName!,
      name: String(candidate.contact.names?.[0]?.displayName || candidate.contact.names?.[0]?.unstructuredName || "Névtelen névjegy"),
      phones: (candidate.contact.phoneNumbers || []).map(item => String(item.value || "")).filter(Boolean),
      emails: (candidate.contact.emailAddresses || []).map(item => String(item.value || "")).filter(Boolean), evidence: candidate.evidence }));
    const base: ContactPreviewItem = { ...source, groupable: !link && !source.memberCustomerIds, state: "new", resourceName: link?.resource_name || null, candidates };
    const retryable = link?.state === "review" && !link.managed_snapshot && !link.synced_source_hash && !link.mutation_snapshot;
    if (link && !retryable) return { ...base, state: link.state === "review" || link.state === "uncertain" || link.state === "creating" ? "review" : "linked",
      ...(link.last_error ? { lastError: link.last_error } : {}) };
    const marked = contacts.filter(contact => googleContactMarkers(contact).includes(marker));
    const unavailable = found.candidates.some(candidate => googleContactMarkers(candidate.contact).some(value => value !== marker) ||
      links.some(item => item.customer_id !== source.customerId && item.resource_name === candidate.contact.resourceName));
    if (localCollision(source, collisionSources) || marked.length > 0 || unavailable) return { ...base, state: "review",
      lastError: marked.length ? "Ehhez az ügyfélhez már tartozik AlinFlow-jelölés. Az összerendelést ellenőrizni kell." :
        "Az elérhetőség több ügyfélhez vagy már összekapcsolt névjegyhez tartozik. Ellenőrizd az adatokat." };
    if (!contactSourceValues(source).phones.some(normalizeContactPhone) && !contactSourceValues(source).emails.some(normalizeContactEmail)) return { ...base, state: "review", lastError: "Az ügyfélhez telefonszám vagy e-mail-cím szükséges." };
    base.state = candidates.length > 1 || found.conflict ? "ambiguous" : candidates.length === 1 ? "match" : "new";
    base.resourceName = candidates.length === 1 ? candidates[0].resourceName : null;
    proofs.push({ customerId: source.customerId, sourceHash: source.sourceHash, ...(source.memberCustomerIds ? { memberCustomerIds: source.memberCustomerIds } : {}),
      options: candidates.length ? candidates.map(item => item.resourceName) : [null],
      remoteHashes: Object.fromEntries(found.candidates.map(item => [item.contact.resourceName!, hash(item.contact)])) });
    return base;
  });
  return { items, proofs };
}
export async function previewGoogleContacts(workspaceId: string, userId: string) {
  const admin = contactsAdmin(), connection = await connectionFor(admin, workspaceId), token = await contactsAccessToken(connection);
  const [raw, contacts, links, groups] = await Promise.all([loadGoogleContactSources(admin, workspaceId), listGoogleContacts(token), loadLinks(admin, workspaceId), loadGroups(admin, workspaceId)]);
  const projected = groupGoogleContactSources(raw, groups);
  const { items, proofs } = buildContactPreview(workspaceId, projected.sources, contacts, links, raw);
  for (const [customerId, lastError] of projected.errors) {
    const original = raw.find(source => source.customerId === customerId);
    items.push({ customerId, name: original?.name || "Közös névjegy", phone: "", email: "", address: "", notes: "", sourceHash: "",
      memberCustomerIds: groups.find(group => group.anchorCustomerId === customerId)!.memberCustomerIds,
      groupable: false, state: "review", resourceName: links.find(link => link.customer_id === customerId)?.resource_name || null, candidates: [], lastError });
  }
  return storePreview(admin, connection, userId, decorateItems(items, raw), proofs);
}
export async function previewGoogleContactGroups(workspaceId: string, userId: string, requested: unknown) {
  const proposed = parseProposedGroups(requested), admin = contactsAdmin(), connection = await connectionFor(admin, workspaceId), token = await contactsAccessToken(connection);
  const [raw, contacts, links, existing] = await Promise.all([loadGoogleContactSources(admin, workspaceId), listGoogleContacts(token), loadLinks(admin, workspaceId), loadGroups(admin, workspaceId)]);
  assertNewGroups(proposed, raw, links, existing);
  const projected = groupGoogleContactSources(raw, [...existing, ...proposed]);
  for (const group of proposed) if (projected.errors.has(group.anchorCustomerId)) throw new ApiError(projected.errors.get(group.anchorCustomerId)!, 409);
  const { items, proofs } = buildContactPreview(workspaceId, projected.sources, contacts, links, raw), anchors = new Set(proposed.map(group => group.anchorCustomerId));
  return storePreview(admin, connection, userId, decorateItems(items.filter(item => anchors.has(item.customerId)), raw), proofs.filter(proof => anchors.has(proof.customerId)));
}
export async function approveGoogleContacts(workspaceId: string, userId: string, previewId: unknown, requested: unknown) {
  if (typeof previewId !== "string" || !UUID.test(previewId) || !Array.isArray(requested) || !requested.length || requested.length > 10) throw new ApiError("Legfeljebb tíz ellenőrzött névjegyet jelölj ki.");
  const selections: Approval[] = requested.map(item => {
    if (!item || typeof item.customerId !== "string" || !UUID.test(item.customerId) || typeof item.sourceHash !== "string" || !/^[0-9a-f]{64}$/.test(item.sourceHash)
      || item.resourceName !== null && (typeof item.resourceName !== "string" || !RESOURCE.test(item.resourceName))) throw new ApiError("Hibás névjegykiválasztás.");
    return { customerId: item.customerId, resourceName: item.resourceName, sourceHash: item.sourceHash };
  });
  if (new Set(selections.map(item => item.customerId)).size !== selections.length) throw new ApiError("Egy ügyfél csak egyszer választható ki.");
  const admin = contactsAdmin(), connection = await connectionFor(admin, workspaceId);
  const preview = await admin.from("google_contacts_previews").select("*").eq("id", previewId).eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (preview.error) throw new ContactsSyncError("database");
  if (!preview.data || Date.parse(preview.data.expires_at) <= Date.now() || preview.data.google_subject !== connection.google_subject) throw refreshPreview();
  const token = await contactsAccessToken(connection);
  const [raw, contacts, links, existing] = await Promise.all([loadGoogleContactSources(admin, workspaceId), listGoogleContacts(token), loadLinks(admin, workspaceId), loadGroups(admin, workspaceId)]);
  const old = preview.data.proofs as Proof[];
  const proposed = old.filter(proof => proof.memberCustomerIds && selections.some(selection => selection.customerId === proof.customerId)
    && !existing.some(group => group.anchorCustomerId === proof.customerId))
    .map(proof => ({ anchorCustomerId: proof.customerId, memberCustomerIds: proof.memberCustomerIds! }));
  if (proposed.length) { parseProposedGroups(proposed); assertNewGroups(proposed, raw, links, existing); }
  const projected = groupGoogleContactSources(raw, [...existing, ...proposed]);
  const fresh = buildContactPreview(workspaceId, projected.sources, contacts, links, raw).proofs;
  for (const selection of selections) {
    const before = old.find(item => item.customerId === selection.customerId), now = fresh.find(item => item.customerId === selection.customerId);
    if (!before || !now || before.sourceHash !== selection.sourceHash || now.sourceHash !== selection.sourceHash
      || JSON.stringify(before.memberCustomerIds || []) !== JSON.stringify(now.memberCustomerIds || [])
      || !before.options.includes(selection.resourceName) || !now.options.includes(selection.resourceName)
      || selection.resourceName && before.remoteHashes[selection.resourceName] !== now.remoteHashes[selection.resourceName]) throw refreshPreview();
  }
  const saved = await admin.rpc("approve_google_contacts_links", { p_workspace_id: workspaceId, p_user_id: userId, p_preview_id: previewId, p_items: selections });
  if (saved.error) throw refreshPreview();
  // The durable worker handles writes separately: a slow Google response cannot
  // turn a successful approval into a second, ambiguous approval request.
  return { approved: Number(saved.data || 0), processed: 0, synced: 0, failed: 0 };
}

async function ensureCurrentLease(admin: Admin, connection: ContactsConnection) {
  const [current, workspace] = await Promise.all([
    admin.from("google_contacts_connections").select("status,google_subject,refresh_token_encrypted,lease_token,lease_expires_at").eq("workspace_id", connection.workspace_id).maybeSingle(),
    admin.from("workspaces").select("id").eq("id", connection.workspace_id).eq("active", true).maybeSingle(),
  ]);
  if (current.error || workspace.error) throw new ContactsSyncError("database");
  if (!workspace.data || !current.data || current.data.status !== "active" || current.data.google_subject !== connection.google_subject
    || current.data.refresh_token_encrypted !== connection.refresh_token_encrypted || current.data.lease_token !== connection.lease_token
    || Date.parse(current.data.lease_expires_at) < Date.now() + 11000) throw new ContactsSyncError("superseded");
}
async function saveLink(admin: Admin, workspaceId: string, link: Link, patch: Record<string, unknown>) {
  const saved = await admin.from("google_contacts_links").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId).eq("customer_id", link.customer_id);
  if (saved.error) throw new ContactsSyncError("database");
  Object.assign(link, patch);
}
async function markReview(admin: Admin, workspaceId: string, link: Link, message: string) {
  await saveLink(admin, workspaceId, link, { state: "review", last_error: message });
}
function safeError(error: unknown) {
  if (error instanceof GoogleContactsAuthError || error instanceof ContactsSyncError && (error.status === 401 || error.status === 403)) return "Csatlakoztasd újra a Google Névjegyeket, és engedélyezd a névjegyek kezelését.";
  if (error instanceof ContactsSyncError && error.kind === "superseded") return "A kapcsolat megváltozott. A frissítés most szünetel.";
  return "A névjegyfrissítés késik. Az AlinFlow adatai megmaradtak; később újrapróbáljuk.";
}
export async function runGoogleContactsSync(workspaceId?: string): Promise<{ processed: number; synced: number; failed: number }> {
  const admin = contactsAdmin(), result = { processed: 0, synced: 0, failed: 0 }, deadline = Date.now() + 45000;
  const claim = await admin.rpc("claim_google_contacts_sync", { p_workspace_id: workspaceId || null });
  if (claim.error) throw new ContactsSyncError("database");
  const connection = (claim.data as ContactsConnection[] | null)?.[0];
  if (!connection) return result;
  try {
    const token = await contactsAccessToken(connection);
    const raw = await loadGoogleContactSources(admin, connection.workspace_id);
    // Read links before memberships: an approval committed between reads can add
    // an unused group, never expose a new anchor without its durable members.
    const loadedLinks = await loadLinks(admin, connection.workspace_id);
    const groups = await loadGroups(admin, connection.workspace_id), projected = groupGoogleContactSources(raw, groups), sources = projected.sources;
    const sourceHashes = new Map(sources.map(source => [source.customerId, source.sourceHash]));
    const priority = (link: Link) => link.state === "pending" ? 0 : link.synced_source_hash !== sourceHashes.get(link.customer_id) ? 1 : 2;
    const links = loadedLinks.filter(link => link.state !== "review" && Date.parse(link.next_sync_at) <= Date.now())
      .sort((a, b) => priority(a) - priority(b) || Date.parse(a.next_sync_at) - Date.parse(b.next_sync_at)).slice(0, 8);
    let allContacts: GoogleContact[] | null = null;
    for (const link of links) {
      if (Date.now() + 12000 > deadline) break;
      result.processed += 1;
      try {
        await ensureCurrentLease(admin, connection);
        const source = sources.find(item => item.customerId === link.customer_id), marker = markerFor(connection.workspace_id, link.customer_id);
        if (!source) { await markReview(admin, connection.workspace_id, link, projected.errors.get(link.customer_id) || "Az ügyfél már nem szerepel a saját telepítések között. A Google-névjegyet megtartottuk."); result.failed += 1; continue; }
        if (source.memberCustomerIds && localCollision(source, raw)) {
          await markReview(admin, connection.workspace_id, link, "A közös névjegy elérhetősége másik ügyfélhez is tartozik. Ellenőrzés szükséges."); result.failed += 1; continue;
        }
        if (!link.resource_name) {
          allContacts ||= await listGoogleContacts(token, deadline);
          const recovered = allContacts.filter(contact => googleContactMarkers(contact).includes(marker));
          if (recovered.length === 1 && (link.state === "creating" || link.state === "uncertain")) {
            await saveLink(admin, connection.workspace_id, link, { resource_name: recovered[0].resourceName, state: "synced", last_error: null });
          } else if (link.state === "creating" || link.state === "uncertain") {
            await saveLink(admin, connection.workspace_id, link, { state: "uncertain", next_sync_at: new Date(Date.now() + 30 * 60000).toISOString(),
              last_error: "A létrehozás eredménye még nem igazolható. Nem hozunk létre újabb névjegyet; ellenőrzés szükséges." });
            result.failed += 1; continue;
          } else {
            if (link.approved_source_hash !== source.sourceHash || recovered.length || localCollision(source, raw) || findContactCandidates(source, allContacts).candidates.length) {
              await markReview(admin, connection.workspace_id, link, "A jóváhagyás óta változtak az adatok vagy megjelent egy egyező névjegy. Új ellenőrzés szükséges."); result.failed += 1; continue;
            }
            const created = buildContactCreate(source, marker);
            // Commit the non-idempotent intent AND its exact managed snapshot
            // before POST. A crash or timeout can only reconcile this marker.
            await saveLink(admin, connection.workspace_id, link, { state: "creating", managed_snapshot: created.managed, synced_source_hash: source.sourceHash });
            await ensureCurrentLease(admin, connection);
            const response = await googleRequest(token, `people:createContact?${queryFields()}`, deadline, "POST", created.body);
            if (!response.ok || !RESOURCE.test(response.data?.resourceName || "")) throw new ContactsSyncError("remote", response.status);
            // Persist a successful remote identity even if the owner paused while
            // the POST was in flight. Losing it would allow later duplication.
            await saveLink(admin, connection.workspace_id, link, { resource_name: response.data.resourceName, state: "synced",
              last_synced_at: new Date().toISOString(), next_sync_at: new Date(Date.now() + 5 * 60000).toISOString(), last_error: null });
            allContacts.push(response.data); result.synced += 1; continue;
          }
        }
        if (link.state === "pending" && !link.mutation_snapshot && link.approved_source_hash !== source.sourceHash) {
          await markReview(admin, connection.workspace_id, link, "Az ügyfél adatai a jóváhagyás óta változtak. Új ellenőrzés szükséges."); result.failed += 1; continue;
        }
        if (!link.resource_name || !RESOURCE.test(link.resource_name)) throw new ContactsSyncError("review");
        let complete = false;
        for (let retry = 0; retry < 2; retry += 1) {
          const remote = await googleRequest(token, `${link.resource_name}?${queryFields()}`, deadline);
          if (remote.status === 404 || remote.status === 410) {
            await markReview(admin, connection.workspace_id, link, "A kapcsolt Google-névjegy már nem található. Automatikusan nem hozzuk létre újra."); break;
          }
          if (!remote.ok) throw new ContactsSyncError("remote", remote.status);
          if (link.mutation_snapshot && link.mutation_payload && contactMatchesManagedSnapshot(remote.data, link.mutation_snapshot, link.mutation_payload)) {
            await saveLink(admin, connection.workspace_id, link, { state: "synced", managed_snapshot: link.mutation_snapshot,
              synced_source_hash: link.mutation_source_hash, mutation_snapshot: null, mutation_source_hash: null, mutation_payload: null });
          }
          if (link.state === "pending" && link.approved_source_hash !== source.sourceHash) {
            await markReview(admin, connection.workspace_id, link, "Az ügyfél adatai a jóváhagyás óta változtak. Új ellenőrzés szükséges."); break;
          }
          if (!link.managed_snapshot && !findContactCandidates(source, [remote.data]).candidates.length) {
            await markReview(admin, connection.workspace_id, link, "A kiválasztott Google-névjegy elérhetősége megváltozott. Az első összekapcsolás előtt ellenőrizd újra."); break;
          }
          const merged = mergeContactUpdate(source, remote.data, link.managed_snapshot, marker);
          if (!merged.ok) { await markReview(admin, connection.workspace_id, link, merged.reason); break; }
          if (merged.updatePersonFields) {
            await saveLink(admin, connection.workspace_id, link, { mutation_snapshot: merged.managed, mutation_source_hash: source.sourceHash, mutation_payload: { body: merged.body, updatePersonFields: merged.updatePersonFields } });
            await ensureCurrentLease(admin, connection);
            const params = queryFields(); params.set("updatePersonFields", merged.updatePersonFields);
            const updated = await googleRequest(token, `${link.resource_name}:updateContact?${params}`, deadline, "PATCH", merged.body);
            if (!updated.ok && (updated.status === 400 || updated.status === 409 || updated.status === 412) && retry === 0) continue;
            if (!updated.ok) throw new ContactsSyncError("remote", updated.status);
          }
          await saveLink(admin, connection.workspace_id, link, { state: "synced", managed_snapshot: merged.managed, synced_source_hash: source.sourceHash, mutation_snapshot: null, mutation_source_hash: null, mutation_payload: null,
            last_synced_at: new Date().toISOString(), next_sync_at: new Date(Date.now() + 5 * 60000).toISOString(), last_error: null });
          result.synced += 1; complete = true; break;
        }
        if (!complete) result.failed += 1;
      } catch (error) {
        result.failed += 1;
        const uncertain = link.state === "creating" || link.state === "uncertain";
        await saveLink(admin, connection.workspace_id, link, { ...(uncertain ? { state: "uncertain" } : {}),
          last_error: uncertain ? "A létrehozás eredménye bizonytalan. Újabb példány helyett előbb ellenőrizzük a Google-névjegyeket." : safeError(error),
          next_sync_at: new Date(Date.now() + (uncertain ? 30 : 5) * 60000).toISOString() });
        if (error instanceof GoogleContactsAuthError || error instanceof ContactsSyncError && (error.status === 401 || error.status === 403)) throw error;
      }
    }
    const updated = await admin.from("google_contacts_connections").update({ last_synced_at: new Date().toISOString(), last_error: result.failed ? "Egyes névjegyek ellenőrzést igényelnek." : null })
      .eq("workspace_id", connection.workspace_id).eq("lease_token", connection.lease_token!);
    if (updated.error) throw new ContactsSyncError("database");
    return result;
  } catch (error) {
    const authError = error instanceof GoogleContactsAuthError || error instanceof ContactsSyncError && (error.status === 401 || error.status === 403);
    await admin.from("google_contacts_connections").update({ ...(authError ? { status: "reauth_required" } : {}), last_error: safeError(error) })
      .eq("workspace_id", connection.workspace_id).eq("refresh_token_encrypted", connection.refresh_token_encrypted).eq("status", "active");
    throw new ApiError(safeError(error), authError ? 409 : 503);
  } finally {
    await admin.rpc("release_google_contacts_sync", { p_workspace_id: connection.workspace_id, p_lease_token: connection.lease_token });
  }
}
