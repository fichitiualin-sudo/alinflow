/** Prefer explicitly labelled serials; never confuse a model or an electrical rating with S/N. */
export function serialCandidates(text: string): string[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const result = new Set<string>();
  const label = /(?:\bS\s*[\/.\\]\s*N\b|\bS\s*N\s*[:：]|\bSERIAL\s*(?:NO\.?|NUMBER|#)?|\bGY[ÁA]RI\s*SZ[ÁA]M|\bSOROZATSZ[ÁA]M)\s*[:：#=-]?\s*/i;
  for (let index = 0; index < lines.length; index += 1) {
    const match = label.exec(lines[index]);
    if (!match) continue;
    const rest = lines[index].slice(match.index + match[0].length).trim() || lines[index + 1]?.trim() || "";
    const value = rest.match(/^[A-Z0-9][A-Z0-9._/-]{3,79}/i)?.[0];
    if (value && /\d/.test(value) && !/^\d+(?:[.,]\d+)?(?:KW|W|V|HZ|A)$/i.test(value)) result.add(value);
  }
  return [...result];
}

export async function recognizeSerialNumber(blob: Blob, onProgress: (progress: number) => void, signal?: AbortSignal) {
  if (!blob.type.startsWith("image/") || blob.size > 500_000) throw new Error("A sorozatszámhoz egy mentett adattábla-fotót válassz.");
  const { createWorker, PSM } = await import("tesseract.js");
  if (signal?.aborted) throw new Error("A felismerés megszakadt.");
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let finished = false;
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const abort = () => { rejectCancellation(new Error("A felismerés megszakadt.")); };
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => rejectCancellation(new Error("A felismerés túl sokáig tartott. Próbáld újra egy élesebb képpel.")), 90_000);
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
    return { candidates: serialCandidates(data.text), text: data.text.slice(0, 5000) };
  } finally {
    finished = true;
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    await worker?.terminate();
  }
}
