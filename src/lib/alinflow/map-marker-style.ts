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

export function markerPinIcon(maps: any, summary: MapMarkerSummary, selected: boolean) {
  const [width, height] = summary.count >= 100 ? [30, 38] : summary.count > 1 ? [24, 32] : [20, 28];
  const key = JSON.stringify([width, height, selected, summary.count,
    summary.segments.map((segment) => [segment.key, safeColor(segment.color), segment.count])]);
  let url = iconUrls.get(key);
  if (url) {
    iconUrls.delete(key);
    iconUrls.set(key, url);
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("A térképes jelölő nem rajzolható ki.");
    context.scale(2, 2);
    const center = width / 2;
    const headRadius = center - 2.5;
    const segments = summary.segments.length ? summary.segments : [{ key: "empty", label: "", color: "#94a3b8", count: 1 }];
    const pinPath = () => {
      context.beginPath();
      context.moveTo(center, height - 1);
      context.bezierCurveTo(center - 3, height - 7, 1.5, center + 6, 1.5, center);
      context.arc(center, center, center - 1.5, Math.PI, 0);
      context.bezierCurveTo(width - 1.5, center + 6, center + 3, height - 7, center, height - 1);
      context.closePath();
    };
    pinPath();
    context.fillStyle = safeColor(segments[0].color);
    context.fill();
    context.lineJoin = "round";
    context.lineWidth = 2;
    context.strokeStyle = "#ffffff";
    context.stroke();
    const angles = segmentAngles(segments);
    let start = -Math.PI / 2;
    segments.forEach((segment, index) => {
      context.beginPath();
      context.moveTo(center, center);
      context.arc(center, center, headRadius, start, start + angles[index]);
      context.closePath();
      context.fillStyle = safeColor(segment.color);
      context.fill();
      start += angles[index];
    });
    const innerRadius = summary.count > 1 ? center - 4.5 : 2.5;
    context.beginPath();
    context.arc(center, center, innerRadius, 0, 2 * Math.PI);
    context.fillStyle = "#ffffff";
    context.fill();
    if (summary.count > 1) {
      const label = String(summary.count);
      let fontSize = 11;
      const textWidth = innerRadius * 2 - 1;
      context.font = `900 ${fontSize}px Arial, sans-serif`;
      while (fontSize > 6 && context.measureText(label).width > textWidth) {
        fontSize--;
        context.font = `900 ${fontSize}px Arial, sans-serif`;
      }
      context.fillStyle = "#0f172a";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, center, center + 0.5, textWidth);
    }
    pinPath();
    context.lineWidth = selected ? 2 : 1;
    context.strokeStyle = selected ? "#0f172a" : "#334155";
    context.stroke();
    url = canvas.toDataURL("image/png");
    if (iconUrls.size >= ICON_CACHE_LIMIT) iconUrls.delete(iconUrls.keys().next().value!);
    iconUrls.set(key, url);
  }
  return {
    url,
    size: new maps.Size(width, height),
    scaledSize: new maps.Size(width, height),
    anchor: new maps.Point(width / 2, height),
  };
}
