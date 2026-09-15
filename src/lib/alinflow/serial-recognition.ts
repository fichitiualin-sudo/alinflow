import { deviceLabelCandidates } from "./device-label";

class SerialRecognitionError extends Error {}

export function serialRecognitionErrorMessage(error: unknown): string {
  return error instanceof SerialRecognitionError ? error.message
    : "A felismerő nem indult el vagy megszakadt. Ellenőrizd az internetkapcsolatot, majd próbáld újra.";
}

/** Prefer explicitly labelled serials; never confuse a model or an electrical rating with S/N. */
export function serialCandidates(text: string): string[] {
  const lines = text.normalize("NFKC").replace(/\r/g, "").split("\n");
  const result = new Set<string>();
  const label = /(?:\bS\s*[\/.\\]\s*N\b|\bSN\b|\bSERIAL\s*(?:NO\.?|NUMBER|#)?|\bGY[ÁA]RI\s*SZ[ÁA]M|\bSOROZATSZ[ÁA]M)\s*(?:\(\s*SERIAL\s*(?:NUMBER|NO\.?)?\s*\))?\s*[:：#=-]?\s*/gi;
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(label)) {
      let rest = lines[index].slice(match.index! + match[0].length).trim();
      // Sparse OCR separates adjacent text boxes with empty lines.
      for (let next = index + 1; !rest && next <= index + 3 && next < lines.length; next++) rest = lines[next].trim();
      const value = rest.match(/^[A-Z0-9][A-Z0-9._/-]{3,79}(?=\s|$|[,;])/i)?.[0];
      if (value && /\d/.test(value) && !/^\d+(?:[.,-]\d+)?(?:KW|W|V|HZ|A)$/i.test(value)) result.add(value);
    }
  }
  return [...result];
}

function validatePhoto(blob: Blob, signal?: AbortSignal) {
  if (!blob.type.startsWith("image/") || !blob.size || blob.size > 500_000) throw new SerialRecognitionError("A beolvasáshoz egy mentett adattábla-fotót válassz.");
  if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
}

async function readBarcode(blob: Blob, signal?: AbortSignal): Promise<string[]> {
  try {
    const { recognizeSerialBarcode } = await import("./serial-barcode");
    const candidates = await recognizeSerialBarcode(blob, signal);
    if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
    return candidates;
  } catch {
    if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
    // A browser without image-processing support can still try the OCR fallback.
    return [];
  }
}

async function readText(blob: Blob, onProgress: (progress: number) => void, signal?: AbortSignal, enhance = false, side?: "indoor" | "outdoor"): Promise<string> {
  if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
  let worker: import("tesseract.js").Worker | undefined;
  const processing = new AbortController();
  let finished = false;
  let reportFullImageProgress = true;
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const abort = () => { rejectCancellation(new SerialRecognitionError("A felismerés megszakadt.")); processing.abort(); };
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    rejectCancellation(new SerialRecognitionError("A felismerés túl sokáig tartott. Ellenőrizd az internetkapcsolatot, majd próbáld újra."));
    processing.abort();
  }, 90_000);
  try {
    const { createWorker, PSM } = await Promise.race([import("tesseract.js"), cancellation]);
    const image = enhance ? await Promise.race([
      import("./device-label-image").then(({ prepareDeviceLabelImage }) => prepareDeviceLabelImage(blob, processing.signal)), cancellation,
    ]) : blob;
    // Recognition stays in a browser worker; only the OCR runtime/model files are downloaded.
    const starting = createWorker("eng", 1, { logger: (message) => {
      if (!finished && reportFullImageProgress && (!enhance || message.status === "recognizing text")) onProgress(Math.round((message.progress || 0) * (side ? 70 : 100)));
    } });
    // An initialization completing after navigation/timeout must not leave a live worker behind.
    void starting.then((created) => {
      if (finished) void created.terminate().catch(() => {});
      else worker = created;
    }, () => {});
    worker = await Promise.race([starting, cancellation]);
    await Promise.race([worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }), cancellation]);
    // Tesseract terminate() does not settle pending jobs; race cancellation explicitly.
    const { data } = await Promise.race([worker.recognize(image), cancellation]);
    const text = data.text.slice(0, 5000);
    if (!side || deviceLabelCandidates(text, side).models.length) return text;

    // A table grid and perspective can hide the model from page-layout OCR.
    // Read actual adjacent image cells, requiring a matching unit/model caption.
    reportFullImageProgress = false;
    try {
      const regions = await Promise.race([
        import("./device-label-regions").then(({ prepareDeviceLabelRegions }) => prepareDeviceLabelRegions(blob, processing.signal)), cancellation,
      ]);
      await Promise.race([worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE }), cancellation]);
      for (const [index, region] of regions.slice(0, 10).entries()) {
        if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
        onProgress(70 + Math.round(index / Math.max(1, regions.length) * 25));
        const codeResult = await Promise.race([worker.recognize(region.image), cancellation]);
        // In an isolated code cell, spaces between OCR glyphs are layout noise.
        const code = codeResult.data.text.replace(/\s+/g, "").toUpperCase();
        if (!region.alternativeImages?.length && deviceLabelCandidates(`MODEL: ${code}`, side).models.length !== 1) continue;
        const labelResult = await Promise.race([worker.recognize(region.labelImage), cancellation]);
        const caption = labelResult.data.text.trim();
        const votes = new Map<string, number>();
        const addReading = (reading: string) => {
          const value = reading.replace(/\s+/g, "").toUpperCase();
          const models = deviceLabelCandidates(`${caption}\n${value}`, side).models;
          if (models.length === 1) votes.set(models[0], (votes.get(models[0]) || 0) + 1);
        };
        addReading(code);
        // Thin dashes can join adjacent glyphs in small photos. Independent gap
        // variants must agree; never substitute guessed I/1, O/0 or model codes.
        // Preserve a clearly readable original cell; aggressive separation is
        // only useful when the unmodified glyphs have low OCR confidence.
        const alternatives = votes.size && codeResult.data.confidence >= 70 ? [] : region.alternativeImages?.slice(0, 2) || [];
        for (const alternative of alternatives) {
          const result = await Promise.race([worker.recognize(alternative), cancellation]);
          addReading(result.data.text);
        }
        if (!votes.size) continue;
        const maximum = Math.max(...votes.values());
        const selected = [...votes].filter(([, count]) => count === maximum).map(([value]) => value);
        // Tied readings remain separate choices instead of silently filling one.
        const rows = selected.map((value) => `${caption}\n${value}`).join("\n");
        // Reset any opposite-side heading from the full photo before the
        // independently verified cell; retain every already read label/serial.
        return `${text}\n${side.toUpperCase()}\n${rows.slice(0, 1000)}`;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      // Failed/unsupported region processing keeps the already read text and S/N.
    }
    return text;
  } finally {
    finished = true;
    processing.abort();
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    await worker?.terminate().catch(() => {});
  }
}

export async function recognizeSerialNumber(blob: Blob, onProgress: (progress: number) => void, signal?: AbortSignal) {
  validatePhoto(blob, signal);
  onProgress(0);
  const candidates = await readBarcode(blob, signal);
  if (candidates.length) { onProgress(100); return { candidates, text: candidates.join("\n"), source: "barcode" as const }; }
  const text = await readText(blob, onProgress, signal);
  return { candidates: serialCandidates(text), text, source: "text" as const };
}

export interface DeviceLabelRecognition {
  candidates: string[];
  manufacturers: string[];
  models: string[];
  text: string;
  source: "barcode" | "text";
  warning?: string;
}

/** Read all three label fields locally; keep a valid barcode even if text OCR fails. */
export async function recognizeDeviceLabel(blob: Blob, side: "indoor" | "outdoor", onProgress: (progress: number) => void, signal?: AbortSignal): Promise<DeviceLabelRecognition> {
  validatePhoto(blob, signal);
  onProgress(0);
  const candidates = await readBarcode(blob, signal);
  if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
  onProgress(15);
  let text: string;
  try {
    text = await readText(blob, (value) => onProgress(15 + Math.round(value * 0.8)), signal, true, side);
  } catch (error) {
    if (signal?.aborted || !candidates.length) throw error;
    onProgress(100);
    return { candidates, manufacturers: [], models: [], text: "", source: "barcode",
      warning: "A vonalkódot beolvastam, de a szövegfelismerés nem sikerült. A gyártót és a típust írd be kézzel, vagy próbáld újra." };
  }
  if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
  const labels = deviceLabelCandidates(text, side);
  onProgress(100);
  return { ...labels, candidates: candidates.length ? candidates : serialCandidates(text), text,
    source: candidates.length ? "barcode" : "text" };
}
