const MAX_EDGE = 1920;
const MAX_CELLS = 256;
const MAX_REGIONS = 10;
type Point = readonly [number, number];
type Quad = readonly [Point, Point, Point, Point];
type Cell = { quad: Quad; area: number };
type CellPair = { label: Quad; value: Quad };
export type DeviceLabelRegion = { image: Blob; labelImage: Blob; alternativeImages?: Blob[] };
type Raster = { data: Uint8ClampedArray; width: number; height: number };

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("A felismerés megszakadt.");
}

async function yieldScan(signal?: AbortSignal) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkCancellation(signal);
}

function distance(a: Point, b: Point) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** The white interior of a ruled table remains connected around its printed text. */
async function findCells(gray: Uint8Array, width: number, height: number, threshold: number, signal?: AbortSignal): Promise<Cell[]> {
  const seen = new Uint8Array(gray.length);
  const queue = new Int32Array(gray.length);
  const cells: Cell[] = [];
  let operations = 0;
  for (let seed = 0; seed < gray.length; seed += 1) {
    if (++operations % 65_536 === 0) await yieldScan(signal);
    if (seen[seed] || gray[seed] < threshold) continue;
    let cursor = 0;
    let count = 1;
    queue[0] = seed;
    seen[seed] = 1;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let minSum = Infinity, maxSum = -Infinity, minDifference = Infinity, maxDifference = -Infinity;
    let topLeft: Point = [0, 0], topRight: Point = [0, 0], bottomRight: Point = [0, 0], bottomLeft: Point = [0, 0];
    while (cursor < count) {
      if (++operations % 65_536 === 0) await yieldScan(signal);
      const index = queue[cursor++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const sum = x + y, difference = x - y;
      if (sum < minSum) { minSum = sum; topLeft = [x, y]; }
      if (sum > maxSum) { maxSum = sum; bottomRight = [x, y]; }
      if (difference > maxDifference) { maxDifference = difference; topRight = [x, y]; }
      if (difference < minDifference) { minDifference = difference; bottomLeft = [x, y]; }
      // Each pixel enters this reusable queue at most once per brightness pass.
      if (y > 0 && !seen[index - width] && gray[index - width] >= threshold) { seen[index - width] = 1; queue[count++] = index - width; }
      if (y + 1 < height && !seen[index + width] && gray[index + width] >= threshold) { seen[index + width] = 1; queue[count++] = index + width; }
      if (x > 0 && !seen[index - 1] && gray[index - 1] >= threshold) { seen[index - 1] = 1; queue[count++] = index - 1; }
      if (x + 1 < width && !seen[index + 1] && gray[index + 1] >= threshold) { seen[index + 1] = 1; queue[count++] = index + 1; }
    }
    const cellWidth = maxX - minX + 1, cellHeight = maxY - minY + 1;
    if (minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1 ||
      count < 300 || cellWidth < 40 || cellWidth > width * 0.75 || cellHeight < 12 ||
      cellHeight > Math.min(height * 0.3, cellWidth * 0.8) || count / (cellWidth * cellHeight) < 0.2) continue;
    if (cells.length < MAX_CELLS) cells.push({ quad: [topLeft, topRight, bottomRight, bottomLeft], area: count });
  }
  return cells;
}

function pairCells(cells: Cell[]): CellPair[] {
  const pairs: CellPair[] = [];
  for (const label of cells) for (const value of cells) {
    if (label === value) continue;
    const [lt, rt, rb, lb] = label.quad;
    const [vt, vr, vb, vl] = value.quad;
    const labelHeight = distance(lt, lb), valueHeight = distance(vt, vl);
    const labelWidth = rt[0] - lt[0], valueWidth = vr[0] - vt[0];
    if (labelHeight < 12 || valueHeight < 12 || labelHeight > 100 || valueHeight > 100 ||
      labelHeight / valueHeight < 0.7 || labelHeight / valueHeight > 1.4 || labelWidth < 40 ||
      valueWidth / valueHeight < 2 || valueWidth / valueHeight > 16 ||
      distance(rt, vt) > Math.min(labelHeight, valueHeight) * 0.4 ||
      distance(rb, vl) > Math.min(labelHeight, valueHeight) * 0.4) continue;
    const labelSlope = (rt[1] - lt[1]) / labelWidth, valueSlope = (vr[1] - vt[1]) / valueWidth;
    if (Math.abs(labelSlope) > 0.75 || Math.abs(valueSlope) > 0.75 || Math.abs(labelSlope - valueSlope) > 0.12) continue;
    pairs.push({ label: label.quad, value: value.quad });
  }
  return pairs;
}

async function decodeImage(blob: Blob, signal?: AbortSignal) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      if (bitmap.width && bitmap.height) return { source: bitmap as CanvasImageSource, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      bitmap.close();
    } catch {
      // The Image fallback also supports browsers with partial ImageBitmap support.
    }
  }
  checkCancellation(signal);
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const release = () => { image.onload = null; image.onerror = null; image.src = ""; URL.revokeObjectURL(url); };
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new Error("A felismerés megszakadt."));
      signal?.addEventListener("abort", abort, { once: true });
      image.onload = () => finish();
      image.onerror = () => finish(new Error("Az adattábla-fotót nem sikerült megnyitni."));
      if (signal?.aborted) { abort(); return; }
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("A fotó mérete nem olvasható.");
    return { source: image as CanvasImageSource, width: image.naturalWidth, height: image.naturalHeight, release };
  } catch (error) { release(); throw error; }
}

function rectifyCell(rgba: Uint8ClampedArray, width: number, height: number, quad: Quad, contentHeight = 100): Raster {
    const output = { data: new Uint8ClampedArray(1240 * (contentHeight + 40) * 4).fill(255), width: 1240, height: contentHeight + 40 };
    const [tl, tr, br, bl] = quad;
    for (let y = 0; y < contentHeight; y += 1) {
      // Move inside the detected white cell so thin table rules do not touch glyphs.
      const v = 0.08 + 0.84 * y / (contentHeight - 1);
      for (let x = 0; x < 1200; x += 1) {
        const u = x / 1199;
        const sx = (1 - v) * ((1 - u) * tl[0] + u * tr[0]) + v * ((1 - u) * bl[0] + u * br[0]);
        const sy = (1 - v) * ((1 - u) * tl[1] + u * tr[1]) + v * ((1 - u) * bl[1] + u * br[1]);
        const x0 = Math.max(0, Math.min(width - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(height - 1, Math.floor(sy)));
        const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
        const dx = sx - x0, dy = sy - y0;
        const outputIndex = ((y + 20) * output.width + x + 20) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          output.data[outputIndex + channel] =
            (1 - dy) * ((1 - dx) * rgba[(y0 * width + x0) * 4 + channel] + dx * rgba[(y0 * width + x1) * 4 + channel]) +
            dy * ((1 - dx) * rgba[(y1 * width + x0) * 4 + channel] + dx * rgba[(y1 * width + x1) * 4 + channel]);
        }
      }
    }
    return output;
}

/** Separate only long, low strokes in the middle of tall glyphs; never rewrite characters. */
function separatedDashVariants(input: Raster): Raster[] {
  const { width, height } = input;
  const binary = new Uint8ClampedArray(width * height);
  for (let index = 0; index < binary.length; index += 1) {
    const offset = index * 4;
    const luminance = 0.2126 * input.data[offset] + 0.7152 * input.data[offset + 1] + 0.0722 * input.data[offset + 2];
    binary[index] = luminance < 112 ? 0 : 255;
  }
  const spans: { min: number; max: number; span: number }[] = [];
  for (let x = 0; x < width; x += 1) {
    let min = height, max = -1;
    for (let y = 20; y < height - 20; y += 1) if (binary[y * width + x] === 0) { min = Math.min(min, y); max = Math.max(max, y); }
    spans.push({ min, max, span: max - min + 1 });
  }
  const tall = spans.filter((span) => span.span > height * 0.35).map((span) => span.span).sort((a, b) => a - b);
  if (!tall.length) return [];
  const glyphHeight = tall[Math.floor(tall.length / 2)];
  const runs: [number, number][] = [];
  let start: number | null = null;
  for (let x = 0; x <= width; x += 1) {
    const span = spans[x];
    const shortStroke = span && span.span > 0 && span.span < glyphHeight * 0.32 && span.min > height * 0.22 && span.max < height * 0.78;
    if (shortStroke) { if (start === null) start = x; }
    else if (start !== null) {
      const runWidth = x - 1 - start;
      if (runWidth >= glyphHeight * 0.15 && runWidth < glyphHeight * 0.7) runs.push([start, x - 1]);
      start = null;
    }
  }
  if (!runs.length) return [];
  return [2, 4].map((gap) => {
    const output: Raster = { data: new Uint8ClampedArray(input.data.length).fill(255), width, height };
    for (let index = 0; index < binary.length; index += 1) output.data[index * 4] = output.data[index * 4 + 1] = output.data[index * 4 + 2] = binary[index];
    for (const [first, last] of runs) for (const boundary of [first, last]) {
      for (let x = Math.max(0, boundary - gap); x <= Math.min(width - 1, boundary + gap); x += 1) for (let y = 0; y < height; y += 1) {
        const index = (y * width + x) * 4;
        output.data[index] = output.data[index + 1] = output.data[index + 2] = 255;
      }
    }
    return output;
  });
}

async function encodeRaster(input: Raster, signal?: AbortSignal, resizedHeight?: number): Promise<Blob> {
  checkCancellation(signal);
  const canvas = document.createElement("canvas");
  canvas.width = input.width; canvas.height = input.height;
  let resized: HTMLCanvasElement | undefined;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Az adattábla előkészítése ebben a böngészőben nem érhető el.");
    const output = context.createImageData(input.width, input.height);
    output.data.set(input.data);
    context.putImageData(output, 0, 0);
    if (resizedHeight) {
      resized = document.createElement("canvas"); resized.width = input.width; resized.height = resizedHeight;
      const resizedContext = resized.getContext("2d");
      if (!resizedContext) throw new Error("Az adattábla előkészítése ebben a böngészőben nem érhető el.");
      resizedContext.imageSmoothingEnabled = true; resizedContext.imageSmoothingQuality = "high";
      resizedContext.drawImage(canvas, 0, 0, resized.width, resized.height);
    }
    const encodedCanvas = resized || canvas;
    const blob = await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const finish = (value: Blob | null, error?: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else if (value) resolve(value);
        else reject(new Error("Az adattábla kivágása nem sikerült."));
      };
      const abort = () => finish(null, new Error("A felismerés megszakadt."));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try { encodedCanvas.toBlob((value) => finish(value), "image/png"); }
      catch { finish(null); }
    });
    checkCancellation(signal);
    return blob;
  } finally {
    canvas.width = 0; canvas.height = 0;
    if (resized) { resized.width = 0; resized.height = 0; }
  }
}

/** Local bounded fallback for small, slanted model values inside printed table cells. */
export async function prepareDeviceLabelRegions(blob: Blob, signal?: AbortSignal): Promise<DeviceLabelRegion[]> {
  checkCancellation(signal);
  if (!blob.type.startsWith("image/") || !blob.size || blob.size > 500_000) throw new Error("Egy mentett adattábla-fotót válassz.");
  const decoded = await decodeImage(blob, signal);
  let canvas: HTMLCanvasElement | undefined;
  try {
    checkCancellation(signal);
    const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale)), height = Math.max(1, Math.round(decoded.height * scale));
    canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Az adattábla előkészítése ebben a böngészőben nem érhető el.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    for (let index = 0; index < gray.length; index += 1) gray[index] = (rgba[index * 4] + 2 * rgba[index * 4 + 1] + rgba[index * 4 + 2]) / 4;
    const pairs: CellPair[] = [];
    for (const threshold of [90, 130]) {
      const detected = pairCells(await findCells(gray, width, height, threshold, signal));
      for (const pair of detected) {
        if (!pairs.some((existing) => distance(existing.value[0], pair.value[0]) < 5 && distance(existing.value[2], pair.value[2]) < 5)) pairs.push(pair);
      }
    }
    pairs.sort((a, b) => a.label[0][1] - b.label[0][1] || a.label[0][0] - b.label[0][0]);
    const regions: DeviceLabelRegion[] = [];
    for (const pair of pairs.slice(0, MAX_REGIONS)) {
      await yieldScan(signal);
      const image = await encodeRaster(rectifyCell(rgba, width, height, pair.value), signal);
      const labelImage = await encodeRaster(rectifyCell(rgba, width, height, pair.label), signal);
      const alternativeImages: Blob[] = [];
      for (const variant of separatedDashVariants(rectifyCell(rgba, width, height, pair.value, 160))) {
        alternativeImages.push(await encodeRaster(variant, signal, 100));
      }
      regions.push({ image, labelImage, ...(alternativeImages.length ? { alternativeImages } : {}) });
    }
    return regions;
  } finally {
    decoded.release();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
