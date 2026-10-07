import { MarkerClusterer, SuperClusterViewportAlgorithm, type Cluster } from "@googlemaps/markerclusterer";
import { markerDotIcon, summarizeMapMarkers, type MapCanvasMarker } from "./map-marker-style";

type Callbacks = {
  onSelectMarker?: (id: string) => void;
  createPopupContent?: (id: string) => HTMLElement;
  itemLabel?: string;
};
type Entry = { source: MapCanvasMarker; marker: any; signature: string };

// The viewport algorithm runs on Google's idle event, not on each drag frame.
// Keeping clustering at the map's maximum zoom also protects coincident points.
class ViewportMarkerClusterer extends MarkerClusterer {
  visibleClusters() { return this.clusters; }
  render() {
    if ((this as any).getMap()?.getBounds()) super.render();
  }
}

export function createMapMarkerLayer({ maps, map, info, getCallbacks }: {
  maps: any; map: any; info: any; getCallbacks: () => Callbacks;
}) {
  const entries = new Map<string, Entry>();
  const byMarker = new Map<any, Entry>();
  let selectedId = "";
  let disposed = false;
  let attached = false;
  let fitListener: any;
  let lastMaxFitZoom: number | undefined;

  const sourcesFor = (cluster: Cluster) => cluster.markers
    .map((marker) => byMarker.get(marker)?.source).filter((source): source is MapCanvasMarker => Boolean(source));
  const selected = (sources: MapCanvasMarker[]) => sources.some((source) => source.id === selectedId);
  const summaryTitle = (sources: MapCanvasMarker[]) => {
    const summary = summarizeMapMarkers(sources);
    return `${summary.count} ${getCallbacks().itemLabel || "bejegyzés"} · ${sources.length} helyszín · ${summary.segments.map((segment) => `${segment.label}: ${segment.count}`).join(" · ")}`;
  };
  const icon = (sources: MapCanvasMarker[], cluster = false) => markerDotIcon(maps, summarizeMapMarkers(sources), selected(sources), cluster);

  function fit(sources: MapCanvasMarker[], zoomLimit: number, zoomIn = false) {
    if (fitListener) maps.event.removeListener(fitListener);
    if (!sources.length) {
      map.setCenter({ lat: 47.2, lng: 19.5 });
      map.setZoom(7);
      return;
    }
    const beforeZoom = map.getZoom() || 7;
    const bounds = new maps.LatLngBounds();
    sources.forEach((source) => bounds.extend({ lat: source.latitude, lng: source.longitude }));
    // Listen before fitBounds: even a synchronous/no-animation fit is capped.
    fitListener = maps.event.addListenerOnce(map, "idle", () => {
      fitListener = undefined;
      if (disposed) return;
      const target = Math.min(zoomLimit, Math.max(map.getZoom(), zoomIn ? beforeZoom + 1 : 5));
      if (target !== map.getZoom()) map.setZoom(target);
    });
    map.fitBounds(bounds, 56);
  }

  function showPopup(sources: MapCanvasMarker[], position: any, singleId?: string) {
    if (disposed || !sources.length) return;
    const summary = summarizeMapMarkers(sources);
    const content = document.createElement("div");
    content.className = "alinflow-map-popup";
    const heading = document.createElement("p");
    heading.className = "alinflow-map-popup-heading";
    heading.textContent = `${summary.count} ${getCallbacks().itemLabel || "bejegyzés"}${sources.length > 1 ? ` · ${sources.length} helyszín` : ""}`;
    content.appendChild(heading);
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
    content.appendChild(breakdown);
    if (sources.length > 1 && map.getZoom() < 19) {
      const zoom = document.createElement("button");
      zoom.type = "button";
      zoom.className = "alinflow-map-popup-action";
      zoom.textContent = "Mutasd közelebbről";
      zoom.onclick = () => { info.close(); fit(sources, 19, true); };
      content.appendChild(zoom);
    }
    if (singleId) {
      const details = getCallbacks().createPopupContent?.(singleId);
      if (details) content.appendChild(details);
      else {
        const title = document.createElement("p");
        title.textContent = sources[0].title;
        content.appendChild(title);
      }
    } else {
      // A paged chooser remains available even for coincident coordinates and
      // at maximum zoom; no customer is hidden behind the top-most marker.
      const list = document.createElement("div");
      list.className = "alinflow-map-location-list";
      let page = 0;
      const renderPage = () => {
        list.replaceChildren();
        for (const source of sources.slice(page * 10, (page + 1) * 10)) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = source.title;
          button.onclick = () => openSingle(source.id);
          list.appendChild(button);
        }
        if (sources.length > 10) {
          const pagination = document.createElement("div");
          pagination.className = "alinflow-map-pagination";
          for (const [label, offset] of [["Előző", -1], ["Következő", 1]] as const) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.disabled = page + offset < 0 || (page + offset) * 10 >= sources.length;
            button.onclick = () => { page += offset; renderPage(); list.querySelector("button")?.focus(); };
            pagination.appendChild(button);
          }
          list.appendChild(pagination);
        }
      };
      renderPage();
      content.appendChild(list);
    }
    // Anchor to coordinates, not a disposable cluster marker. Auto-pan can
    // change the viewport's clusters without closing this popup underneath it.
    info.setContent(content);
    info.setPosition(position);
    info.open({ map });
  }

  function openSingle(id: string) {
    const entry = entries.get(id);
    if (!entry || disposed) return;
    getCallbacks().onSelectMarker?.(id);
    showPopup([entry.source], entry.marker.getPosition(), id);
  }

  const clusterer = new ViewportMarkerClusterer({
    algorithm: new SuperClusterViewportAlgorithm({ radius: 110, maxZoom: 20, viewportPadding: 100 }),
    renderer: { render(cluster) {
      const sources = sourcesFor(cluster);
      return new maps.Marker({ position: cluster.position, optimized: true,
        icon: icon(sources, true), title: summaryTitle(sources), zIndex: selected(sources) ? 1001 : 1000 });
    } },
    onClusterClick: (_event, cluster) => showPopup(sourcesFor(cluster), cluster.position),
  });

  function update(markers: MapCanvasMarker[], nextSelectedId = "", maxFitZoom = 15) {
    if (disposed) return;
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
      const next = valid.get(id);
      if (!next || next.latitude !== entry.source.latitude || next.longitude !== entry.source.longitude) {
        clusterer.removeMarker(entry.marker, true);
        maps.event.clearInstanceListeners(entry.marker);
        entry.marker.setMap(null);
        byMarker.delete(entry.marker);
        entries.delete(id);
        geometryChanged = true;
      }
    }
    for (const [id, source] of valid) {
      const signature = JSON.stringify([source.label, source.title, source.color, source.segments]);
      let entry = entries.get(id);
      if (!entry) {
        const marker = new maps.Marker({ position: { lat: source.latitude, lng: source.longitude },
          title: source.title, icon: icon([source]), optimized: true, zIndex: id === selectedId ? 1001 : 1 });
        entry = { source, marker, signature };
        entries.set(id, entry);
        byMarker.set(marker, entry);
        marker.addListener("click", () => openSingle(id));
        clusterer.addMarker(marker, true);
        geometryChanged = true;
      } else {
        if (entry.signature !== signature) { contentChanged = true; changedIds.add(id); }
        entry.source = source;
        entry.signature = signature;
        if (changedIds.has(id)) {
          entry.marker.setIcon(icon([source]));
          entry.marker.setTitle(source.title);
          entry.marker.setZIndex(id === selectedId ? 1001 : 1);
        }
      }
    }
    if (geometryChanged || contentChanged) info.close();
    if (geometryChanged || lastMaxFitZoom !== maxFitZoom) fit([...valid.values()], maxFitZoom);
    lastMaxFitZoom = maxFitZoom;
    if (!attached) { (clusterer as any).setMap(map); attached = true; }
    else if (geometryChanged) clusterer.render();
    if (changedIds.size) {
      for (const cluster of clusterer.visibleClusters()) {
        if (cluster.markers.length < 2 || !cluster.marker) continue;
        const sources = sourcesFor(cluster);
        if (!sources.some((source) => changedIds.has(source.id))) continue;
        const marker = cluster.marker as any;
        marker.setIcon(icon(sources, true));
        marker.setTitle(summaryTitle(sources));
        marker.setZIndex(selected(sources) ? 1001 : 1000);
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (fitListener) maps.event.removeListener(fitListener);
    (clusterer as any).setMap(null);
    clusterer.clearMarkers(true);
    for (const { marker } of entries.values()) {
      maps.event.clearInstanceListeners(marker);
      marker.setMap(null);
    }
    entries.clear();
    byMarker.clear();
    info.close();
  }

  return { update, dispose };
}
