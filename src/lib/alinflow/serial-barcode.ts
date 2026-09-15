const MAX_IMAGE_EDGE = 1920;
const MAX_CANDIDATES = 5;

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("A felismerés megszakadt.");
}

type DecodedBarcodeImage = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decodeImage(blob: Blob): Promise<DecodedBarcodeImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      }
      bitmap.close();
    } catch {
      // Some browsers can decode a saved JPEG through Image but not ImageBitmap.
    }
  }
  const url = URL.createObjectURL(blob);
  const source = new Image();
  const release = () => {
    source.onload = null;
    source.onerror = null;
    source.src = "";
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      source.onload = () => resolve();
      source.onerror = () => reject(new Error("A fotót nem sikerült megnyitni a vonalkód felismeréséhez."));
      source.src = url;
    });
    if (!source.naturalWidth || !source.naturalHeight) throw new Error("A fotó mérete nem olvasható.");
    return { source, width: source.naturalWidth, height: source.naturalHeight, release };
  } catch (error) {
    release();
    throw error;
  }
}

/** Local Code 128 suggestions only: the caller must ask the user to verify the S/N. */
export async function recognizeSerialBarcode(blob: Blob, signal?: AbortSignal): Promise<string[]> {
  checkCancellation(signal);
  if (!blob.type.startsWith("image/") || !blob.size || blob.size > 500_000) {
    throw new Error("A vonalkód felismeréséhez egy mentett adattábla-fotót válassz.");
  }
  const { BinaryBitmap, BitArray, ChecksumException, Code128Reader, FormatException, HybridBinarizer, NotFoundException, RGBLuminanceSource } = await import("@zxing/library");
  checkCancellation(signal);
  const decoded = await decodeImage(blob);
  let canvas: HTMLCanvasElement | undefined;
  try {
    checkCancellation(signal);
    canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("A vonalkód felismerése ebben a böngészőben nem érhető el.");
    const reader = new Code128Reader();
    const candidates = new Set<string>();
    const originalScale = Math.min(1, MAX_IMAGE_EDGE / Math.max(decoded.width, decoded.height));

    for (const enlargement of [1, 2]) {
      checkCancellation(signal);
      canvas.width = Math.max(1, Math.round(decoded.width * originalScale * enlargement));
      canvas.height = Math.max(1, Math.round(decoded.height * originalScale * enlargement));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const luminance = new Uint8ClampedArray(canvas.width * canvas.height);
      for (let pixel = 0; pixel < luminance.length; pixel += 1) {
        const index = pixel * 4;
        luminance[pixel] = (rgba[index] + 2 * rgba[index + 1] + rgba[index + 2]) / 4;
      }
      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, canvas.width, canvas.height)));
      let row = new BitArray(canvas.width);
      // The default scanner skips rows on tall images and missed the narrow readable
      // band of a real installation photo. Scan every second row, in both directions.
      for (let y = 0; y < canvas.height; y += 2) {
        if (y % 64 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          checkCancellation(signal);
        }
        // Metal and shadows around a small label can distort the full-row histogram.
        // Try a few fixed brightness levels as well, without assuming label position.
        for (const threshold of [null, 96, 128, 160, 192]) {
          if (threshold === null) {
            try { row = bitmap.getBlackRow(y, row); }
            catch (error) {
              if (error instanceof NotFoundException) continue;
              throw error;
            }
          } else {
            row.clear();
            const offset = y * canvas.width;
            for (let x = 0; x < canvas.width; x += 1) if (luminance[offset + x] < threshold) row.set(x);
          }
          let found = false;
          for (const reverse of [false, true]) {
            if (reverse) row.reverse();
            try {
              const value = reader.decodeRow(y, row).getText().trim();
              // EAN shopping codes and QR Wi-Fi settings are deliberately not decoded.
              if (/^[A-Z0-9][A-Z0-9._/-]{3,79}$/i.test(value) && /\d/.test(value)) { candidates.add(value); found = true; }
            } catch (error) {
              if (!(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) throw error;
            }
            if (candidates.size >= MAX_CANDIDATES) return [...candidates];
          }
          if (found) break;
        }
      }
      if (candidates.size) return [...candidates];
    }
    return [];
  } finally {
    decoded.release();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
