import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { normalizeAppointmentType } from "./appointments";
import { compressWorkPhoto, WORK_PHOTO_MAX_EDGE, WORK_PHOTO_MAX_OUTPUT_BYTES } from "./photo-compression";
import type { Customer, WorkPhoto, WorkPhotoContext } from "./types";

export const WORK_PHOTO_PAGE_SIZE = 10;
const BUCKET = "work-photos";
const URL_LIFETIME_SECONDS = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PreparedWorkPhoto = {
  readonly photo: WorkPhoto;
  readonly blob: Blob;
  readonly createdBy: string;
};

function hasWorkPhotoScope(context: Pick<WorkPhotoContext, "workspaceId" | "customerId" | "appointmentId">): boolean {
  return Boolean(context && UUID.test(context.workspaceId) && UUID.test(context.customerId) && UUID.test(context.appointmentId));
}

function isWorkDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function storagePathFor(context: WorkPhotoContext, id: string): string {
  return `${context.workspaceId}/${context.customerId}/${context.appointmentId}/${id}.jpg`;
}

export function workPhotoContext(customer: Customer, workspaceId: string | null | undefined): WorkPhotoContext | null {
  if (!workspaceId || !UUID.test(workspaceId) || !UUID.test(customer.id)
    || !customer.activeAppointmentId || !UUID.test(customer.activeAppointmentId) || !isWorkDate(customer.date || "")) return null;
  return {
    workspaceId,
    customerId: customer.id,
    appointmentId: customer.activeAppointmentId,
    appointmentType: normalizeAppointmentType(customer.appointmentType),
    workDate: customer.date!,
    workTime: customer.time || "",
  };
}

export function workPhotoErrorMessage(error: unknown, fallback = "A képet nem sikerült menteni. Próbáld újra."): string {
  const source = error as { message?: string; code?: string; statusCode?: string } | null;
  const message = source?.message || "";
  if (/work_photos|bucket not found|schema cache|relation .* does not exist/i.test(message)) {
    return "A képfeltöltés tárhelye még nincs beállítva. A többi funkció továbbra is használható.";
  }
  if (/quota|storage limit|exceeded|maximum.*size/i.test(message)) return "A képtárhely megtelt vagy elérte a korlátját. A kép nem lett elmentve.";
  if (/jwt|not authenticated|session|login/i.test(message)) return "A képfeltöltéshez jelentkezz be újra.";
  if (/fetch|network|timeout/i.test(message)) return "Megszakadt a kapcsolat. Az Újrapróbálás gombbal folytathatod.";
  if (/permission|row-level security|policy/i.test(message)) return "Nincs hozzáférés a képtárhelyhez. Ellenőrizni kell a tárhely beállítását.";
  // Our validation and recovery messages are already written for the user.
  if (error instanceof Error && !source?.code && !source?.statusCode) return message || fallback;
  return fallback;
}

function photoFromRow(row: Record<string, unknown>): WorkPhoto {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    customerId: String(row.customer_id),
    appointmentId: String(row.appointment_id),
    appointmentType: normalizeAppointmentType(String(row.appointment_type)),
    workDate: String(row.work_date),
    workTime: String(row.work_time || ""),
    storagePath: String(row.storage_path),
    sizeBytes: Number(row.size_bytes),
    width: Number(row.width),
    height: Number(row.height),
    createdAt: String(row.created_at),
  };
}

function photoRow(prepared: PreparedWorkPhoto) {
  const photo = prepared.photo;
  return {
    id: photo.id,
    workspace_id: photo.workspaceId,
    customer_id: photo.customerId,
    appointment_id: photo.appointmentId,
    appointment_type: photo.appointmentType,
    work_date: photo.workDate,
    work_time: photo.workTime,
    storage_path: photo.storagePath,
    size_bytes: photo.sizeBytes,
    width: photo.width,
    height: photo.height,
    created_by: prepared.createdBy,
  };
}

/** A store can also be constructed with an isolated client for integration checks. */
export function createWorkPhotoStore(client: SupabaseClient, compress = compressWorkPhoto) {
  const storage = client.storage.from(BUCKET);

  async function currentUserId() {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || !UUID.test(data.user.id)) throw new Error("A képfeltöltéshez jelentkezz be újra.");
    return data.user.id;
  }

  async function prepareWorkPhoto(file: File, context: WorkPhotoContext): Promise<PreparedWorkPhoto> {
    // Snapshot before awaiting compression: changing the selected work must not move a photo.
    const snapshot = { ...context };
    if (!hasWorkPhotoScope(snapshot) || !isWorkDate(snapshot.workDate)) throw new Error("Előbb mentsd el az időpontot a munkához.");
    const createdBy = await currentUserId();
    const compressed = await compress(file);
    const id = crypto.randomUUID();
    return {
      photo: {
        ...snapshot, id, storagePath: storagePathFor(snapshot, id),
        sizeBytes: compressed.blob.size, width: compressed.width, height: compressed.height,
        createdAt: new Date().toISOString(),
      },
      blob: compressed.blob,
      createdBy,
    };
  }

  async function findSaved(prepared: PreparedWorkPhoto) {
    const photo = prepared.photo;
    const { data, error } = await client.from("work_photos").select("*").eq("id", photo.id)
      .eq("workspace_id", photo.workspaceId).eq("customer_id", photo.customerId).eq("appointment_id", photo.appointmentId).maybeSingle();
    if (error) throw error;
    if (data) {
      const expected = photoRow(prepared);
      for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
        if (data[key] !== expected[key]) throw new Error("A kép azonosítója már más feltöltéshez tartozik. Válaszd ki újra a képet.");
      }
    }
    return Boolean(data);
  }

  async function matchesUploadedBlob(prepared: PreparedWorkPhoto) {
    const { data, error } = await storage.download(prepared.photo.storagePath);
    if (error || !data || data.size !== prepared.blob.size) return false;
    const [remote, local] = await Promise.all([data.arrayBuffer(), prepared.blob.arrayBuffer()]);
    const remoteBytes = new Uint8Array(remote);
    return new Uint8Array(local).every((byte, i) => byte === remoteBytes[i]);
  }

  async function uploadWorkPhoto(prepared: PreparedWorkPhoto): Promise<void> {
    const photo = prepared.photo;
    if (!hasWorkPhotoScope(photo) || !UUID.test(photo.id) || !UUID.test(prepared.createdBy) || !isWorkDate(photo.workDate)
      || prepared.blob.type !== "image/jpeg" || prepared.blob.size < 1 || prepared.blob.size > WORK_PHOTO_MAX_OUTPUT_BYTES
      || photo.sizeBytes !== prepared.blob.size || !Number.isInteger(photo.width) || !Number.isInteger(photo.height)
      || photo.width < 1 || photo.height < 1
      || photo.width > WORK_PHOTO_MAX_EDGE || photo.height > WORK_PHOTO_MAX_EDGE
      || photo.storagePath !== storagePathFor(photo, photo.id)) {
      throw new Error("A kép tömörítése nem megfelelő. Válaszd ki újra a képet.");
    }
    if (await currentUserId() !== prepared.createdBy) throw new Error("A bejelentkezés megváltozott. Válaszd ki újra a képet.");
    // Reuse the same UUID on retry, including when a previous successful response was lost.
    if (await findSaved(prepared)) return;

    const { error: uploadError } = await storage.upload(photo.storagePath, prepared.blob, {
      contentType: "image/jpeg", cacheControl: "3600", upsert: false,
    });
    // A timeout or a duplicate response can mean the first upload already succeeded.
    if (uploadError && !await matchesUploadedBlob(prepared)) throw uploadError;

    const { error: insertError } = await client.from("work_photos").insert(photoRow(prepared));
    if (!insertError) return;
    try {
      if (await findSaved(prepared)) return;
    } catch {
      // The database may have committed. Never delete a possibly referenced file.
      throw new Error("A kép mentését nem sikerült ellenőrizni. Az Újrapróbálás gombbal biztonságosan folytathatod.");
    }
    // Only a definite server rejection allows compensation; an interrupted request may still commit.
    if (insertError.code && !/^(08|PGRST000)/.test(insertError.code)) {
      const { error: cleanupError } = await storage.remove([photo.storagePath]);
      if (cleanupError) throw new Error("A kép feltöltődött, de a munkához rendelése nem sikerült. Az Újrapróbálás gombbal fejezd be a mentést.");
    }
    throw insertError;
  }

  async function listWorkPhotos(context: WorkPhotoContext, page: number): Promise<{ photos: WorkPhoto[]; hasMore: boolean }> {
    if (!hasWorkPhotoScope(context)) return { photos: [], hasMore: false };
    const offset = (Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0) * WORK_PHOTO_PAGE_SIZE;
    const { data, error } = await client.from("work_photos").select("*")
      .eq("workspace_id", context.workspaceId).eq("customer_id", context.customerId).eq("appointment_id", context.appointmentId)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + WORK_PHOTO_PAGE_SIZE);
    if (error) throw error;
    const rows = data || [];
    const photos = rows.slice(0, WORK_PHOTO_PAGE_SIZE).map(photoFromRow);
    if (photos.length) {
      const { data: urls, error: urlError } = await storage.createSignedUrls(photos.map((photo) => photo.storagePath), URL_LIFETIME_SECONDS);
      const urlsByPath = new Map((urls || []).map((item) => [item.path, item]));
      for (const photo of photos) {
        const url = urlsByPath.get(photo.storagePath);
        photo.url = url?.signedUrl || undefined;
        if (urlError || url?.error || !photo.url) photo.urlError = "A kép előnézete nem tölthető be. Próbáld újra megnyitni.";
      }
    }
    return { photos, hasMore: rows.length > WORK_PHOTO_PAGE_SIZE };
  }

  async function refreshWorkPhotoUrl(photo: WorkPhoto): Promise<string> {
    if (!hasWorkPhotoScope(photo) || !UUID.test(photo.id) || photo.storagePath !== storagePathFor(photo, photo.id)) {
      throw new Error("A kép munkához rendelése nem megfelelő. Nyisd meg újra a munkát.");
    }
    const { data, error } = await storage.createSignedUrl(photo.storagePath, URL_LIFETIME_SECONDS);
    if (error || !data?.signedUrl) throw error || new Error("A kép nem tölthető be. Próbáld újra.");
    return data.signedUrl;
  }

  async function deleteWorkPhoto(photo: WorkPhoto, context: WorkPhotoContext): Promise<void> {
    const snapshot = { ...photo };
    const scope = { ...context };
    if (!hasWorkPhotoScope(scope) || !hasWorkPhotoScope(snapshot) || !UUID.test(snapshot.id)
      || snapshot.workspaceId !== scope.workspaceId || snapshot.customerId !== scope.customerId
      || snapshot.appointmentId !== scope.appointmentId || snapshot.storagePath !== storagePathFor(scope, snapshot.id)) {
      throw new Error("A kép nem ehhez a munkához tartozik. Nyisd meg újra a munkát.");
    }
    await currentUserId();
    const { data, error } = await client.from("work_photos").select("id")
      .eq("id", snapshot.id).eq("workspace_id", scope.workspaceId).eq("customer_id", scope.customerId)
      .eq("appointment_id", scope.appointmentId).eq("storage_path", snapshot.storagePath).maybeSingle();
    if (error) throw error;
    if (data) {
      // Keep metadata until Storage confirms removal, so interrupted deletions remain retryable.
      const { error: removeError } = await storage.remove([snapshot.storagePath]);
      if (removeError) throw removeError;
    }
    // The server checks membership and physical object absence, including on repeated requests.
    const { error: finishError } = await client.rpc("finish_work_photo_delete", {
      p_photo_id: snapshot.id, p_workspace_id: scope.workspaceId,
      p_customer_id: scope.customerId, p_appointment_id: scope.appointmentId,
    });
    if (finishError) throw finishError;
  }

  return { prepareWorkPhoto, uploadWorkPhoto, listWorkPhotos, refreshWorkPhotoUrl, deleteWorkPhoto };
}

export const { prepareWorkPhoto, uploadWorkPhoto, listWorkPhotos, refreshWorkPhotoUrl, deleteWorkPhoto } = createWorkPhotoStore(supabase);
