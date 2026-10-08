import { markerPinIcon, summarizeMapMarkers, type MapCanvasMarker } from "./map-marker-style";

type Callbacks = {
  onSelectMarker?: (id: string) => void;
  createPopupContent?: (id: string) => HTMLElement;
  compactPopup?: boolean;
  itemLabel?: string;
};
type Entry = { source: MapCanvasMarker; marker: any; signature: string };

export function createMapMarkerLayer({ maps, map, info, getCallbacks }: {
  maps: any; map: any; info: any; getCallbacks: () => Callbacks;
}) {
  const entries = new Map<string, Entry>();
  let selectedId = "";
  let compact = false;
  let disposed = false;
  let fitListener: any;
  let lastMaxFitZoom: number | undefined;

  const icon = (source: MapCanvasMarker) => markerPinIcon(maps, summarizeMapMarkers([source]), source.id === selectedId, compact);

  function fit(sources: MapCanvasMarker[], zoomLimit: number) {
    if (fitListener) maps.event.removeListener(fitListener);
    if (!sources.length) {
      map.setCenter({ lat: 47.2, lng: 19.5 });
      map.setZoom(7);
      return;
    }
    const bounds = new maps.LatLngBounds();
    sources.forEach((source) => bounds.extend({ lat: source.latitude, lng: source.longitude }));
    // Listen before fitBounds: even a synchronous/no-animation fit is capped.
    fitListener = maps.event.addListenerOnce(map, "idle", () => {
      fitListener = undefined;
      if (disposed) return;
      const target = Math.min(zoomLimit, Math.max(map.getZoom(), 5));
      if (target !== map.getZoom()) map.setZoom(target);
    });
    map.fitBounds(bounds, 56);
  }

  function openSingle(id: string) {
    const entry = entries.get(id);
    if (!entry || disposed) return;
    getCallbacks().onSelectMarker?.(id);
    const summary = summarizeMapMarkers([entry.source]);
    const content = document.createElement("div");
    const compactPopup = getCallbacks().compactPopup;
    content.className = `alinflow-map-popup${compactPopup ? " alinflow-map-popup-compact" : ""}`;
    // Google's otherwise empty close-button row takes valuable space on mobile.
    info.setOptions({ headerDisabled: Boolean(compactPopup) });
    if (compactPopup) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "alinflow-map-popup-close";
      close.setAttribute("aria-label", "Térképes ablak bezárása");
      close.textContent = "×";
      close.addEventListener("click", () => info.close());
      content.appendChild(close);
    }
    const heading = document.createElement("p");
    heading.className = "alinflow-map-popup-heading";
    heading.textContent = `${summary.count} ${getCallbacks().itemLabel || "bejegyzés"}`;
    if (!compactPopup) content.appendChild(heading);
    const breakdown = document.createElement("ul");
    breakdown.className = "alinflow-map-breakdown";
    for (const segment of summary.segments) {
      const row = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "alinflow-map-status-dot";
      dot.style.backgroundColor = segment.color;
      dot.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = `${segment.label}: ${segment.count}`;
      row.append(dot, label);
      breakdown.appendChild(row);
    }
    if (!compactPopup) content.appendChild(breakdown);
    const details = getCallbacks().createPopupContent?.(id);
    if (details) content.appendChild(details);
    else {
      const title = document.createElement("p");
      title.textContent = entry.source.title;
      content.appendChild(title);
    }
    info.setContent(content);
    info.setPosition(entry.marker.getPosition());
    info.open({ map });
  }

  function update(markers: MapCanvasMarker[], nextSelectedId = "", maxFitZoom = 15, nextCompact = false) {
    if (disposed) return;
    const sizeChanged = compact !== nextCompact;
    compact = nextCompact;
    const previousSelectedId = selectedId;
    selectedId = nextSelectedId;
    const valid = new Map(markers.filter((source) => Number.isFinite(source.latitude)
      && Number.isFinite(source.longitude) && Math.abs(source.latitude) <= 90 && Math.abs(source.longitude) <= 180)
      .map((source) => [source.id, source]));
    let geometryChanged = false;
    let contentChanged = false;
    const changedIds = new Set<string>();
    if (previousSelectedId !== selectedId) {
      changedIds.add(previousSelectedId);
      changedIds.add(selectedId);
      if (!selectedId) info.close();
    }
    for (const [id, entry] of entries) {
      if (!valid.has(id)) {
        maps.event.clearInstanceListeners(entry.marker);
        entry.marker.setMap(null);
        entries.delete(id);
        geometryChanged = true;
      }
    }
    for (const [id, source] of valid) {
      const signature = JSON.stringify([source.label, source.title, source.color, source.segments]);
      let entry = entries.get(id);
      if (!entry) {
        // Every location is attached individually. Google's optimized bitmap
        // layer moves/culls the pins itself; no per-frame React or regrouping.
        const marker = new maps.Marker({ map, position: { lat: source.latitude, lng: source.longitude },
          title: source.title, icon: icon(source), optimized: true, zIndex: id === selectedId ? 1001 : 1 });
        entry = { source, marker, signature };
        entries.set(id, entry);
        marker.addListener("click", () => openSingle(id));
        geometryChanged = true;
      } else {
        if (source.latitude !== entry.source.latitude || source.longitude !== entry.source.longitude) {
          entry.marker.setPosition({ lat: source.latitude, lng: source.longitude });
          geometryChanged = true;
        }
        if (entry.signature !== signature) { contentChanged = true; changedIds.add(id); }
        entry.source = source;
        entry.signature = signature;
        if (sizeChanged || changedIds.has(id)) {
          entry.marker.setIcon(icon(source));
          entry.marker.setTitle(source.title);
          entry.marker.setZIndex(id === selectedId ? 1001 : 1);
        }
      }
    }
    if (geometryChanged || contentChanged) info.close();
    if (geometryChanged || lastMaxFitZoom !== maxFitZoom) fit([...valid.values()], maxFitZoom);
    lastMaxFitZoom = maxFitZoom;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (fitListener) maps.event.removeListener(fitListener);
    for (const { marker } of entries.values()) {
      maps.event.clearInstanceListeners(marker);
      marker.setMap(null);
    }
    entries.clear();
    info.close();
  }

  return { update, dispose };
}
