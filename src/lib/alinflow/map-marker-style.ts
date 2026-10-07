export type MapMarkerSegment = {
  key: string;
  label: string;
  color: string;
  count: number;
};

export type MapCanvasMarker = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  title: string;
  color?: string;
  segments?: MapMarkerSegment[];
};

export type MapMarkerSummary = { count: number; segments: MapMarkerSegment[] };

const SEGMENT_ORDER = ["overdue", "dueSoon", "ok", "optOut", "unknown", "callback"];
const DEFAULT_COLOR = "#0f766e";
const ICON_CACHE_LIMIT = 128;
const iconUrls = new Map<string, string>();

function positiveCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function safeColor(value?: string) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value!.toLowerCase() : DEFAULT_COLOR;
}

export function summarizeMapMarkers(sources: readonly MapCanvasMarker[]): MapMarkerSummary {
  const byKey = new Map<string, MapMarkerSegment>();
  for (const source of sources) {
    const supplied = source.segments?.filter((segment) => segment.key && positiveCount(segment.count)) || [];
    const labelCount = /^\d+$/.test(source.label) ? Number(source.label) : NaN;
    const segments = supplied.length ? supplied : [{
      key: `unclassified:${safeColor(source.color)}`,
      label: "Helyszínek",
      color: safeColor(source.color),
      count: positiveCount(labelCount) ? labelCount : 1,
    }];
    for (const segment of segments) {
      const color = safeColor(segment.color);
      const previous = byKey.get(segment.key);
      if (!previous) {
        byKey.set(segment.key, { ...segment, color });
      } else {
        previous.count += segment.count;
        // Equal keys normally share metadata; this also keeps malformed input order-independent.
        if (color < previous.color) previous.color = color;
        if (segment.label < previous.label) previous.label = segment.label;
      }
    }
  }
  const rank = (key: string) => {
    const index = SEGMENT_ORDER.indexOf(key);
    return index < 0 ? SEGMENT_ORDER.length : index;
  };
  const segments = [...byKey.values()].sort((left, right) => rank(left.key) - rank(right.key)
    || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return { count: segments.reduce((sum, segment) => sum + segment.count, 0), segments };
}

function segmentAngles(segments: readonly MapMarkerSegment[]) {
  const fullCircle = 2 * Math.PI;
  const minimum = Math.min(Math.PI / 18, fullCircle / Math.max(1, segments.length));
  const angles = new Array<number>(segments.length).fill(0);
  let pending = segments.map((segment, index) => ({ count: segment.count, index }));
  let remaining = fullCircle;
  while (pending.length) {
    const total = pending.reduce((sum, segment) => sum + segment.count, 0);
    const small = pending.filter((segment) => remaining * segment.count / total < minimum);
    if (!small.length) {
      for (const segment of pending) angles[segment.index] = remaining * segment.count / total;
      break;
    }
    const fixed = new Set(small.map((segment) => segment.index));
    for (const segment of small) angles[segment.index] = minimum;
    remaining -= minimum * small.length;
    pending = pending.filter((segment) => !fixed.has(segment.index));
  }
  return angles;
}

export function markerDotIcon(maps: any, summary: MapMarkerSummary, selected: boolean, cluster = false) {
  // Dense single addresses need the same readable number area as a cluster.
  const size = summary.count >= 1000 ? 40 : cluster || summary.count >= 100 ? 36 : 28;
  const key = JSON.stringify([size, selected, summary.count,
    summary.segments.map((segment) => [segment.key, safeColor(segment.color), segment.count])]);
  let url = iconUrls.get(key);
  if (url) {
    iconUrls.delete(key);
    iconUrls.set(key, url);
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = size * 2;
    canvas.height = size * 2;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("A térképes jelölő nem rajzolható ki.");
    context.scale(2, 2);
    const center = size / 2;
    const ringWidth = size >= 36 ? 6 : 5;
    const radius = center - 2 - ringWidth / 2;
    context.beginPath();
    context.arc(center, center, center - 1, 0, 2 * Math.PI);
    context.fillStyle = "#ffffff";
    context.fill();
    if (selected) {
      context.lineWidth = 2;
      context.strokeStyle = "#0f172a";
      context.stroke();
    }
    const segments = summary.segments.length ? summary.segments : [{ key: "empty", label: "", color: "#94a3b8", count: 1 }];
    const angles = segmentAngles(segments);
    let start = -Math.PI / 2;
    context.lineWidth = ringWidth;
    segments.forEach((segment, index) => {
      context.beginPath();
      context.arc(center, center, radius, start, start + angles[index]);
      context.strokeStyle = safeColor(segment.color);
      context.stroke();
      start += angles[index];
    });
    const label = String(summary.count);
    let fontSize = size >= 36 ? 13 : 11;
    const textWidth = (radius - ringWidth / 2) * 2 - 1;
    context.font = `900 ${fontSize}px Arial, sans-serif`;
    while (fontSize > 6 && context.measureText(label).width > textWidth) {
      fontSize--;
      context.font = `900 ${fontSize}px Arial, sans-serif`;
    }
    context.fillStyle = "#0f172a";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, center, center + 0.5, textWidth);
    url = canvas.toDataURL("image/png");
    if (iconUrls.size >= ICON_CACHE_LIMIT) iconUrls.delete(iconUrls.keys().next().value!);
    iconUrls.set(key, url);
  }
  return {
    url,
    size: new maps.Size(size, size),
    scaledSize: new maps.Size(size, size),
    anchor: new maps.Point(size / 2, size / 2),
  };
}
