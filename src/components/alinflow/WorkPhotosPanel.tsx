"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from "react";
import { Card } from "@/components/alinflow/LayoutPrimitives";
import { appointmentTypeLabel } from "@/lib/alinflow/appointments";
import { supabase } from "@/lib/supabase";
import type { Customer, WorkPhoto, WorkPhotoContext } from "@/lib/alinflow/types";
import {
  WORK_PHOTO_PAGE_SIZE,
  deleteWorkPhoto,
  listWorkPhotos,
  prepareWorkPhoto,
  refreshWorkPhotoUrl,
  uploadWorkPhoto,
  workPhotoContext,
  workPhotoErrorMessage,
  type PreparedWorkPhoto,
} from "@/lib/alinflow/work-photos";

type UploadEntry = {
  id: number;
  name: string;
  context: WorkPhotoContext;
  file?: File;
  prepared?: PreparedWorkPhoto;
  status: "pending" | "compressing" | "uploading" | "done" | "error";
  error?: string;
};

type UploadSnapshot = { queue: UploadEntry[]; busy: boolean; deletingPhotoId: string | null; savedVersion: number };
const EMPTY_UPLOAD_SNAPSHOT: UploadSnapshot = { queue: [], busy: false, deletingPhotoId: null, savedVersion: 0 };
const emptyUploadSnapshot = () => EMPTY_UPLOAD_SNAPSHOT;
const noSubscription = () => () => {};
const noUser = () => null;

/** Session memory survives work-page navigation; no files are written to browser storage. */
export function createWorkPhotoQueueManager(operations = { prepareWorkPhoto, uploadWorkPhoto }) {
  let userId: string | null = null;
  const userListeners = new Set<() => void>();
  const sessions = new Map<string, ReturnType<typeof createSession>>();

  function createSession(ownerId: string) {
    let snapshot = EMPTY_UPLOAD_SNAPSHOT;
    let nextId = 0;
    let revoked = false;
    let running = Promise.resolve();
    const listeners = new Set<() => void>();
    const publish = (next: UploadSnapshot) => {
      snapshot = next;
      listeners.forEach((listener) => listener());
    };
    const update = (id: number, changes: Partial<UploadEntry>) => {
      if (!revoked) publish({ ...snapshot, queue: snapshot.queue.map((entry) => entry.id === id ? { ...entry, ...changes } : entry) });
    };

    function process(ids: number[]): Promise<void> {
      if (revoked || snapshot.busy || snapshot.deletingPhotoId || !ids.length) return running;
      publish({ ...snapshot, busy: true });
      running = (async () => {
        try {
          for (const id of ids) {
            if (revoked) break;
            let entry = snapshot.queue.find((item) => item.id === id);
            if (!entry || entry.status === "done") continue;
            let prepared = entry.prepared;
            try {
              if (!prepared) {
                update(id, { status: "compressing", error: undefined });
                if (!entry.file) throw new Error("Válaszd ki újra a képet.");
                prepared = await operations.prepareWorkPhoto(entry.file, entry.context);
                if (revoked) break;
              }
              if (prepared.createdBy !== ownerId) throw new Error("A bejelentkezés megváltozott. Válaszd ki újra a képet.");
              update(id, { prepared, file: undefined, status: "uploading", error: undefined });
              entry = undefined;
              await operations.uploadWorkPhoto(prepared);
              if (revoked) break;
              update(id, { status: "done", prepared: undefined, file: undefined });
              publish({ ...snapshot, savedVersion: snapshot.savedVersion + 1 });
            } catch (error) {
              if (revoked) break;
              update(id, {
                status: "error", prepared, ...(prepared ? { file: undefined } : {}),
                error: workPhotoErrorMessage(error, "Nem sikerült feltölteni a képet. Próbáld újra."),
              });
            }
          }
        } finally {
          if (!revoked) publish({ ...snapshot, busy: false });
        }
      })();
      return running;
    }

    return {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      addFiles(files: File[], context: WorkPhotoContext): Promise<void> {
        if (revoked) throw new Error("A képfeltöltéshez jelentkezz be újra.");
        if (snapshot.busy) throw new Error("Várd meg a folyamatban lévő képek mentését.");
        if (snapshot.deletingPhotoId) throw new Error("Várd meg a kép törlését.");
        const failed = snapshot.queue.filter((entry) => entry.status === "error");
        if (files.length + failed.length > WORK_PHOTO_PAGE_SIZE) {
          throw new Error(`Egyszerre legfeljebb ${WORK_PHOTO_PAGE_SIZE} kép tölthető fel. Válassz kevesebb képet, vagy távolítsd el a sikertelen tételeket a listából.`);
        }
        const entries: UploadEntry[] = files.map((file) => ({ id: ++nextId, name: file.name, file, context: { ...context }, status: "pending" }));
        publish({ ...snapshot, queue: [...failed, ...entries] });
        return process(entries.map((entry) => entry.id));
      },
      retryFailed: () => process(snapshot.queue.filter((entry) => entry.status === "error").map((entry) => entry.id)),
      removeFailed(id: number) {
        if (!revoked && !snapshot.busy && !snapshot.deletingPhotoId) publish({ ...snapshot, queue: snapshot.queue.filter((entry) => entry.id !== id || entry.status !== "error") });
      },
      beginDelete(photoId: string) {
        if (revoked || snapshot.busy || snapshot.deletingPhotoId || !photoId) return false;
        publish({ ...snapshot, deletingPhotoId: photoId });
        return true;
      },
      finishDelete(photoId: string, succeeded: boolean) {
        if (revoked || snapshot.deletingPhotoId !== photoId) return;
        publish({
          ...snapshot,
          deletingPhotoId: null,
          queue: succeeded ? snapshot.queue.filter((entry) => entry.prepared?.photo.id !== photoId) : snapshot.queue,
          savedVersion: snapshot.savedVersion + (succeeded ? 1 : 0),
        });
      },
      revoke() {
        revoked = true;
        publish(EMPTY_UPLOAD_SNAPSHOT);
      },
    };
  }

  return {
    getUserId: () => userId,
    subscribeUser: (listener: () => void) => { userListeners.add(listener); return () => { userListeners.delete(listener); }; },
    setUser(nextUserId: string | null) {
      if (nextUserId === userId) return;
      userId = nextUserId;
      sessions.forEach((session) => session.revoke());
      sessions.clear();
      userListeners.forEach((listener) => listener());
    },
    getSession(context: WorkPhotoContext) {
      if (!userId) return null;
      const key = `${userId}:${context.workspaceId}:${context.customerId}:${context.appointmentId}:${context.deviceId || "work"}:${context.deviceSide || ""}`;
      let session = sessions.get(key);
      if (!session) { session = createSession(userId); sessions.set(key, session); }
      return session;
    },
    hasUnfinishedUploads: () => [...sessions.values()].some((session) => {
      const snapshot = session.getSnapshot();
      return Boolean(snapshot.deletingPhotoId) || snapshot.queue.some((entry) => entry.status !== "done");
    }),
  };
}

const uploadQueues = createWorkPhotoQueueManager();
let sessionGuardsStarted = false;

function startPhotoSessionGuards() {
  if (sessionGuardsStarted) return;
  sessionGuardsStarted = true;
  // Keep these guards active between work-page visits, including logout elsewhere in the app.
  supabase.auth.onAuthStateChange((_event, session) => uploadQueues.setUser(session?.user.id || null));
  window.addEventListener("beforeunload", (event) => {
    if (!uploadQueues.hasUnfinishedUploads()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

type PhotoPreview = {
  photo: WorkPhoto;
  url?: string;
  loading: boolean;
  error?: string;
};

const buttonClass = "rounded-2xl px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50";

function workLabel(context: WorkPhotoContext) {
  return `${appointmentTypeLabel(context.appointmentType)} · ${context.workDate.replaceAll("-", ".")}${context.workTime ? ` · ${context.workTime}` : ""}`;
}

export function WorkPhotosPanel({ customer, workspaceId, device, onRecognizeSerial, recognizing = false, children }: {
  customer: Customer; workspaceId?: string | null;
  device?: { id: string; side: "indoor" | "outdoor" };
  onRecognizeSerial?: (photo: WorkPhoto) => void; recognizing?: boolean;
  children?: ReactNode;
}) {
  const context = useMemo(() => {
    const base = workPhotoContext(customer, workspaceId);
    return base && device ? { ...base, deviceId: device.id, deviceSide: device.side } : base;
  }, [customer, workspaceId, device?.id, device?.side]);
  const [photos, setPhotos] = useState<WorkPhoto[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [galleryError, setGalleryError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [photoToDelete, setPhotoToDelete] = useState<WorkPhoto | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const uploadUserId = useSyncExternalStore(uploadQueues.subscribeUser, uploadQueues.getUserId, noUser);
  const uploadSession = useMemo(() => context && uploadUserId ? uploadQueues.getSession(context) : null, [context, uploadUserId]);
  const { queue, busy, deletingPhotoId, savedVersion } = useSyncExternalStore(uploadSession?.subscribe || noSubscription, uploadSession?.getSnapshot || emptyUploadSnapshot, emptyUploadSnapshot);
  const deleting = deletingPhotoId !== null;
  const [preview, setPreview] = useState<PhotoPreview | null>(null);
  const mounted = useRef(false);
  const galleryRequest = useRef(0);
  const previewRequest = useRef(0);
  const lastSavedVersion = useRef(0);
  const deletionRefreshPage = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const dialogTitleId = useId();

  useEffect(() => {
    startPhotoSessionGuards();
    mounted.current = true;
    return () => {
      mounted.current = false;
      galleryRequest.current += 1;
      previewRequest.current += 1;
    };
  }, []);

  const loadPhotos = useCallback(async (nextPage: number) => {
    const request = ++galleryRequest.current;
    setLoading(true);
    setGalleryError("");
    if (!uploadSession?.getSnapshot().deletingPhotoId) { setPhotoToDelete(null); setDeleteError(""); }
    try {
      let result = context
        ? await listWorkPhotos(context, nextPage)
        : { photos: [], hasMore: false };
      while (context && nextPage > 0 && !result.photos.length) {
        nextPage -= 1;
        result = await listWorkPhotos(context, nextPage);
      }
      if (!mounted.current || request !== galleryRequest.current) return;
      setPhotos(result.photos);
      setHasMore(result.hasMore);
      setPage(nextPage);
    } catch (error) {
      if (!mounted.current || request !== galleryRequest.current) return;
      setGalleryError(workPhotoErrorMessage(error, "A képek nem tölthetők be. Próbáld újra."));
    } finally {
      if (mounted.current && request === galleryRequest.current) setLoading(false);
    }
  }, [context, uploadSession]);

  useEffect(() => {
    void loadPhotos(0);
  }, [loadPhotos]);

  useEffect(() => {
    if (!busy && !deleting && savedVersion !== lastSavedVersion.current) {
      lastSavedVersion.current = savedVersion;
      // Gallery errors remain separate from the completed upload queue.
      const nextPage = deletionRefreshPage.current ?? 0;
      deletionRefreshPage.current = null;
      void loadPhotos(nextPage);
    }
  }, [busy, deleting, savedVersion, loadPhotos]);

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (!files.length || !uploadSession || !context) return;
    try {
      void uploadSession.addFiles(files, context);
      setSelectionError("");
    } catch (error) {
      setSelectionError(workPhotoErrorMessage(error));
    }
  }

  async function loadPreview(photo: WorkPhoto) {
    const request = ++previewRequest.current;
    setPreview({ photo, loading: true });
    try {
      const url = await refreshWorkPhotoUrl(photo);
      if (mounted.current && request === previewRequest.current) setPreview({ photo, url, loading: false });
    } catch (error) {
      if (mounted.current && request === previewRequest.current) {
        setPreview({ photo, loading: false, error: workPhotoErrorMessage(error, "A kép nem nyitható meg. Próbáld újra.") });
      }
    }
  }

  function openPhoto(photo: WorkPhoto, trigger: HTMLButtonElement) {
    previewTrigger.current = trigger;
    void loadPreview(photo);
    dialog.current?.showModal();
  }

  function closePreview() {
    previewRequest.current += 1;
    setPreview(null);
    if (previewTrigger.current?.isConnected) previewTrigger.current.focus();
  }

  async function confirmDelete() {
    if (!photoToDelete || !context || !uploadSession || !uploadSession.beginDelete(photoToDelete.id)) return;
    const photo = photoToDelete;
    let succeeded = false;
    setDeleteError("");
    galleryRequest.current += 1;
    try {
      await deleteWorkPhoto(photo, context);
      succeeded = true;
      if (!mounted.current) return;
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      setPhotoToDelete(null);
      deletionRefreshPage.current = page;
    } catch (error) {
      if (mounted.current) setDeleteError(workPhotoErrorMessage(error, "A képet nem sikerült törölni. Próbáld újra."));
    } finally {
      if (mounted.current) setLoading(false);
      uploadSession.finishDelete(photo.id, succeeded);
    }
  }

  const failedEntries = queue.filter((entry) => entry.status === "error");
  const completedCount = queue.filter((entry) => entry.status === "done").length;

  return (
    <Card title={device ? `${device.side === "indoor" ? "Beltéri" : "Kültéri"} adattábla-fotók` : "Munkafotók"}>
      {children}
      {context ? (
        <p className="mt-3 rounded-2xl bg-slate-950/60 p-3 text-sm font-bold text-cyan-100">Új képek ehhez a munkához: {workLabel(context)}</p>
      ) : (
        <p className="mt-3 text-sm font-bold text-amber-200">Képet elmentett munkához tölthetsz fel. Előbb válassz céget és rögzíts időpontot.</p>
      )}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button type="button" className={`${buttonClass} bg-cyan-300 text-slate-950`} disabled={busy || deleting || !uploadSession} onClick={() => fileInput.current?.click()}>Képek kiválasztása</button>
        <input ref={fileInput} type="file" accept="image/*,.heic,.heif" multiple hidden disabled={busy || deleting || !uploadSession} onChange={selectFiles} aria-label="Munkafotók kiválasztása" />
      </div>
      {selectionError ? <p role="alert" className="mt-3 text-sm text-amber-200">{selectionError}</p> : null}
      {deleting ? <p role="status" className="mt-3 text-sm text-slate-200">Kép törlése folyamatban…</p> : null}
      {queue.length ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
          <p role="status" className="text-sm font-bold text-slate-200">
            {busy ? "Feltöltés folyamatban. Várd meg a képek mentését." : `${completedCount} kép feltöltve.${failedEntries.length ? ` ${failedEntries.length} kép feltöltése sikertelen.` : ""}`}
          </p>
          <ul className="mt-3 space-y-2">
            {queue.map((entry) => (
              <li key={entry.id} className="rounded-xl bg-white/5 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-all font-bold text-slate-200">{entry.name}</span>
                  <span className={entry.status === "error" ? "text-amber-200" : entry.status === "done" ? "text-emerald-200" : "text-cyan-200"}>
                    {entry.status === "pending" ? "Várakozik" : entry.status === "compressing" ? "Tömörítés…" : entry.status === "uploading" ? "Feltöltés…" : entry.status === "done" ? "Feltöltve" : "Sikertelen"}
                  </span>
                </div>
                {entry.error ? <p className="mt-1 break-words text-amber-200">{entry.error}</p> : null}
                {entry.status === "error" ? (
                  <button type="button" disabled={busy || deleting} onClick={() => { uploadSession?.removeFailed(entry.id); setSelectionError(""); }} className="mt-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-slate-200 disabled:opacity-50">Eltávolítás a listából</button>
                ) : null}
              </li>
            ))}
          </ul>
          {failedEntries.length ? <button type="button" disabled={busy || deleting || !uploadSession} onClick={() => void uploadSession?.retryFailed()} className={`${buttonClass} mt-3 bg-amber-300/20 text-amber-100`}>Sikertelen képek újrapróbálása</button> : null}
        </div>
      ) : null}

      <div className="mt-6 border-t border-white/10 pt-4" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-black text-slate-100">Ehhez a munkához feltöltött képek</h3>
          <button type="button" disabled={loading || busy || deleting || !context} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold text-cyan-100 disabled:opacity-50" onClick={() => void loadPhotos(page)}>Frissítés</button>
        </div>
        {loading ? <p role="status" className="mt-4 text-sm text-slate-300">Képek betöltése…</p> : null}
        {galleryError ? (
          <div role="alert" className="mt-4 rounded-2xl bg-amber-300/10 p-4 text-sm text-amber-100">
            <p>{galleryError}</p>
            <button type="button" disabled={loading || busy || deleting} className={`${buttonClass} mt-3 bg-white/10`} onClick={() => void loadPhotos(page)}>Betöltés újrapróbálása</button>
          </div>
        ) : null}
        {!loading && !galleryError && !photos.length ? <p className="mt-4 rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">Még nincs feltöltött munkafotó.</p> : null}
        {photos.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {photos.map((photo) => (
              <div key={photo.id} className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
                <button type="button" disabled={deleting} onClick={(event) => openPhoto(photo, event.currentTarget)} aria-label={`Munkafotó megnyitása: ${workLabel(photo)}`} className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50">
                  {photo.url && !photo.urlError ? (
                    // Private, short-lived URLs are loaded directly without a shared image cache.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.url} alt={`Munkafotó – ${workLabel(photo)}`} loading="lazy" className="aspect-[4/3] w-full object-cover" onError={() => setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, urlError: "Az előnézet nem tölthető be." } : item))} />
                  ) : <span className="flex aspect-[4/3] items-center justify-center p-3 text-center text-xs text-amber-100">Az előnézet nem tölthető be. Koppints a megnyitáshoz.</span>}
                  <span className="block p-3">
                    <span className="block break-words text-sm font-black text-slate-100">{appointmentTypeLabel(photo.appointmentType)}</span>
                    <span className="mt-1 block break-words text-xs text-slate-300">{photo.workDate.replaceAll("-", ".")}{photo.workTime ? ` · ${photo.workTime}` : ""}</span>
                    <span className="mt-1 block text-xs text-slate-400">{Math.ceil(photo.sizeBytes / 1000)} kB</span>
                  </span>
                </button>
                <div className="border-t border-white/10 p-3">
                  {onRecognizeSerial ? <button type="button" disabled={loading || busy || deleting || recognizing} onClick={() => onRecognizeSerial(photo)} className={`${buttonClass} mb-2 w-full bg-cyan-300 text-slate-950`}>Adattábla beolvasása</button> : null}
                  {photoToDelete?.id === photo.id || deletingPhotoId === photo.id ? (
                    <div>
                      <p className="text-sm font-bold text-slate-100">Végleg törlöd ezt a képet?</p>
                      {deleteError ? <p role="alert" className="mt-2 break-words text-sm text-amber-200">{deleteError}</p> : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={deleting} onClick={() => { setPhotoToDelete(null); setDeleteError(""); }} className={`${buttonClass} bg-white/10 text-slate-100`}>Mégse</button>
                        <button type="button" disabled={deleting || busy || !uploadSession} onClick={() => void confirmDelete()} className={`${buttonClass} bg-red-600 text-white`}>
                          {deleting ? "Törlés…" : deleteError ? "Törlés újrapróbálása" : "Kép törlése"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" disabled={loading || busy || deleting || !uploadSession} onClick={() => { setPhotoToDelete(photo); setDeleteError(""); }} aria-label={`Munkafotó törlése: ${workLabel(photo)}`} className={`${buttonClass} w-full bg-red-600 text-white`}>Törlés</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {page > 0 || hasMore ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button type="button" disabled={page === 0 || loading || busy || deleting} onClick={() => void loadPhotos(page - 1)} className={`${buttonClass} bg-white/10 text-cyan-100`}>Előző</button>
            <span className="text-sm text-slate-300">{page + 1}. oldal</span>
            <button type="button" disabled={!hasMore || loading || busy || deleting} onClick={() => void loadPhotos(page + 1)} className={`${buttonClass} bg-white/10 text-cyan-100`}>Következő</button>
          </div>
        ) : null}
      </div>

      <dialog ref={dialog} aria-labelledby={dialogTitleId} onClose={closePreview} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-auto rounded-3xl border border-white/20 bg-slate-950 p-4 text-white shadow-2xl backdrop:bg-black/80">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 id={dialogTitleId} className="min-w-0 break-words text-base font-black">{preview ? workLabel(preview.photo) : "Munkafotó"}</h3>
          <button type="button" autoFocus onClick={() => dialog.current?.close()} className={`${buttonClass} shrink-0 bg-white/10 text-cyan-100`}>Bezárás</button>
        </div>
        {preview?.loading ? <p role="status" className="py-12 text-center text-slate-300">Kép betöltése…</p> : null}
        {preview?.error ? (
          <div role="alert" className="rounded-2xl bg-amber-300/10 p-4 text-sm text-amber-100">
            <p>{preview.error}</p>
            <button type="button" onClick={() => void loadPreview(preview.photo)} className={`${buttonClass} mt-3 bg-white/10`}>Megnyitás újrapróbálása</button>
          </div>
        ) : null}
        {preview?.url && !preview.error ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={`Munkafotó – ${workLabel(preview.photo)}`} className="mx-auto max-h-[70dvh] max-w-full object-contain" onError={() => setPreview((current) => current && current.url === preview.url ? { ...current, url: undefined, error: "A kép nem tölthető be. Próbáld újra." } : current)} />
        ) : null}
      </dialog>
    </Card>
  );
}
