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

export async function recognizeSerialNumber(blob: Blob, onProgress: (progress: number) => void, signal?: AbortSignal) {
  if (!blob.type.startsWith("image/") || !blob.size || blob.size > 500_000) throw new SerialRecognitionError("A sorozatszámhoz egy mentett adattábla-fotót válassz.");
  if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
  onProgress(0);
  // Read the checksummed barcode before OCR can mistake narrow printed characters.
  // Both decoders work locally; the image is never sent to a recognition service.
  try {
    const { recognizeSerialBarcode } = await import("./serial-barcode");
    const candidates = await recognizeSerialBarcode(blob, signal);
    if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
    if (candidates.length) { onProgress(100); return { candidates, text: candidates.join("\n"), source: "barcode" as const }; }
  } catch {
    if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
    // A browser without image-processing support can still try the OCR fallback.
  }
  const { createWorker, PSM } = await import("tesseract.js");
  if (signal?.aborted) throw new SerialRecognitionError("A felismerés megszakadt.");
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let finished = false;
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const abort = () => { rejectCancellation(new SerialRecognitionError("A felismerés megszakadt.")); };
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => rejectCancellation(new SerialRecognitionError("A felismerés túl sokáig tartott. Ellenőrizd az internetkapcsolatot, majd próbáld újra.")), 90_000);
  try {
    // Recognition stays in a browser worker; only the OCR runtime/model files are downloaded.
    const starting = createWorker("eng", 1, { logger: (message) => {
      if (!finished) onProgress(Math.round((message.progress || 0) * 100));
    } });
    // An initialization completing after navigation/timeout must not leave a live worker behind.
    void starting.then((created) => {
      if (finished) void created.terminate().catch(() => {});
      else worker = created;
    }, () => {});
    worker = await Promise.race([starting, cancellation]);
    await Promise.race([worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }), cancellation]);
    // Tesseract terminate() does not settle pending jobs; race cancellation explicitly.
    const { data } = await Promise.race([worker.recognize(blob), cancellation]);
    return { candidates: serialCandidates(data.text), text: data.text.slice(0, 5000), source: "text" as const };
  } finally {
    finished = true;
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    await worker?.terminate().catch(() => {});
  }
}
