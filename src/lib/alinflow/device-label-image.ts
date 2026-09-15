const MAX_OCR_IMAGE_EDGE = 3840;

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("A felismerés megszakadt.");
}

function encodeForRecognition(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (blob: Blob | null, error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(blob);
    };
    const abort = () => finish(null, new Error("A felismerés megszakadt."));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.95); }
    catch { finish(null); }
  });
}

/** Temporary local OCR input; never replaces the stored work photo. */
export async function prepareDeviceLabelImage(blob: Blob, signal?: AbortSignal): Promise<Blob> {
  checkCancellation(signal);
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return blob;
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    checkCancellation(signal);
    if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width < 1 || bitmap.height < 1) return blob;
    const scale = Math.min(2, MAX_OCR_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return blob;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const enlarged = await encodeForRecognition(canvas, signal);
    checkCancellation(signal);
    return enlarged?.size && enlarged.type === "image/jpeg" ? enlarged : blob;
  } catch {
    checkCancellation(signal);
    // Unsupported decoding or canvas encoding must not prevent OCR of the original.
    return blob;
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
