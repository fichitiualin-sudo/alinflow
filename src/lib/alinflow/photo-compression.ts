export const WORK_PHOTO_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const WORK_PHOTO_MAX_OUTPUT_BYTES = 500_000;
export const WORK_PHOTO_MAX_EDGE = 1920;

export type CompressedWorkPhoto = {
  blob: Blob;
  width: number;
  height: number;
};

type DecodedPhoto = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

const PHOTO_EXTENSION = /\.(jpe?g|png|webp|heic|heif|avif|bmp|tiff?)$/i;
const DECODE_ERROR = "Ez a kép nem olvasható ebben a böngészőben. Válassz JPEG-, PNG- vagy WebP-képet; HEIC-kép esetén mentsd vagy exportáld JPEG-ként.";

export function validateWorkPhoto(file: File): void {
  if (!file.size) {
    throw new Error("A kiválasztott képfájl üres. Válassz másik képet.");
  }
  if (file.size > WORK_PHOTO_MAX_INPUT_BYTES) {
    throw new Error("A kiválasztott kép túl nagy. Legfeljebb 25 MB-os képet válassz.");
  }

  const mimeType = file.type.toLowerCase();
  if (mimeType === "image/svg+xml" || mimeType === "image/gif" || /\.(svgz?|gif)$/i.test(file.name)) {
    throw new Error("SVG- és GIF-fájl helyett JPEG-, PNG- vagy WebP-fotót válassz.");
  }
  if (!mimeType.startsWith("image/") && !PHOTO_EXTENSION.test(file.name)) {
    throw new Error("A kiválasztott fájl nem képfájl. JPEG-, PNG- vagy WebP-fotót válassz.");
  }
}

async function decodeWorkPhoto(file: File): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      // Some browsers support a camera format through Image but not ImageBitmap.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  const release = () => {
    image.onload = null;
    image.onerror = null;
    image.src = "";
    URL.revokeObjectURL(objectUrl);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(DECODE_ERROR));
      image.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(DECODE_ERROR);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release,
    };
  } catch {
    release();
    throw new Error(DECODE_ERROR);
  }
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const encodingError = () => new Error("A képet nem sikerült JPEG-fotóvá tömöríteni. Próbálj másik képet vagy böngészőt.");
    try {
      canvas.toBlob((blob) => {
        if (!blob || !blob.size || blob.type !== "image/jpeg") {
          reject(encodingError());
          return;
        }
        resolve(blob);
      }, "image/jpeg", quality);
    } catch {
      reject(encodingError());
    }
  });
}

/** Compress one image locally; callers should process multiple files sequentially. */
export async function compressWorkPhoto(file: File): Promise<CompressedWorkPhoto> {
  validateWorkPhoto(file);
  if (typeof document === "undefined") {
    throw new Error("A fotók tömörítése csak böngészőben érhető el.");
  }

  const decoded = await decodeWorkPhoto(file);
  const canvas = document.createElement("canvas");
  try {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Ez a böngésző nem tudja feldolgozni a képet. Próbálj másik böngészőt.");
    }

    const initialScale = Math.min(1, WORK_PHOTO_MAX_EDGE / Math.max(decoded.width, decoded.height));
    let width = Math.max(1, Math.round(decoded.width * initialScale));
    let height = Math.max(1, Math.round(decoded.height * initialScale));

    while (true) {
      canvas.width = width;
      canvas.height = height;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      // A fresh canvas removes source metadata (including GPS). Transparency becomes white.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      try {
        context.drawImage(decoded.source, 0, 0, width, height);
      } catch {
        throw new Error("A képet nem sikerült átméretezni. Válassz másik képet.");
      }

      let smallestBlob: Blob | undefined;
      for (const quality of [0.86, 0.76, 0.66, 0.56]) {
        const blob = await encodeJpeg(canvas, quality);
        if (blob.size <= WORK_PHOTO_MAX_OUTPUT_BYTES) return { blob, width, height };
        smallestBlob = blob;
      }

      if (width === 1 && height === 1) {
        throw new Error("A képet nem sikerült 500 kB alá tömöríteni. Válassz másik képet.");
      }
      // Keep reducing dimensions until the hard limit is met; never return the original.
      const scale = Math.min(0.8, Math.sqrt(WORK_PHOTO_MAX_OUTPUT_BYTES / smallestBlob!.size) * 0.9);
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
    }
  } finally {
    decoded.release();
    canvas.width = 0;
    canvas.height = 0;
  }
}
