"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { buildCallbackMap, callbackClimateLabel } from "@/lib/alinflow/callback-map";
import { paginateItems } from "@/lib/alinflow/customers";
import { formatPostalCity } from "@/lib/alinflow/postal-codes";
import type { Customer } from "@/lib/alinflow/types";
import "leaflet/dist/leaflet.css";
import "./CallbackMapPanel.css";

type MapRuntime = {
  leaflet: typeof import("leaflet");
  map: LeafletMap;
  markers: LayerGroup;
  buttons: Map<string, HTMLButtonElement>;
};

type CallbackMapPanelProps = {
  customers: Customer[];
  onOpenCustomer: (customer: Customer) => void;
};

const UNLOCATED = "__unlocated__";
const secondaryButton = "rounded-xl bg-white/10 px-4 py-3 text-sm font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40";

export function CallbackMapPanel({ customers, onOpenCustomer }: CallbackMapPanelProps) {
  const searchId = useId();
  const cityId = useId();
  const listId = useId();
  const mapContainer = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [selectedTown, setSelectedTown] = useState("");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [runtime, setRuntime] = useState<MapRuntime | null>(null);
  const [mapError, setMapError] = useState("");
  const [tileError, setTileError] = useState(false);
  const data = useMemo(() => buildCallbackMap(customers, search), [customers, search]);
  const selectedGroup = data.groups.find((group) => group.id === selectedTown);
  const activeTown = selectedGroup ? selectedTown : selectedTown === UNLOCATED && data.unlocated.length ? UNLOCATED : "";
  const matchingCustomers = useMemo(() => {
    const ids = new Set([...data.groups.flatMap((group) => group.customers), ...data.unlocated].map((customer) => customer.id));
    return customers.filter((customer) => ids.has(customer.id));
  }, [customers, data]);
  const list = selectedGroup?.customers || (activeTown === UNLOCATED ? data.unlocated : matchingCustomers);
  const pagination = paginateItems(list, page);

  const selectTown = useCallback((id: string) => {
    setSelectedTown(id);
    setPage(1);
  }, []);

  useEffect(() => {
    if (selectedTown && !activeTown) selectTown("");
  }, [activeTown, selectedTown, selectTown]);

  useEffect(() => {
    const container = mapContainer.current;
    if (!container) return;
    let disposed = false;
    let map: LeafletMap | null = null;
    let observer: ResizeObserver | null = null;
    let resizeFrame = 0;
    setRuntime(null);
    setMapError("");
    setTileError(false);

    void import("leaflet").then((leaflet) => {
      if (disposed || mapContainer.current !== container) return;
      map = leaflet.map(container, {
        center: [47.2, 19.5], zoom: 7, minZoom: 5, maxZoom: 18,
        scrollWheelZoom: false, zoomControl: false,
      });
      leaflet.control.zoom({ zoomInTitle: "Nagyítás", zoomOutTitle: "Kicsinyítés" }).addTo(map);
      map.attributionControl.setPrefix(false);
      map.attributionControl.addAttribution('Település-koordináták: <a href="https://www.geonames.org/">GeoNames</a>');
      const tiles = leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      });
      tiles.on("tileerror", () => { if (!disposed) setTileError(true); });
      tiles.addTo(map);
      const markers = leaflet.layerGroup().addTo(map);
      const activeMap = map;
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            if (!disposed) activeMap.invalidateSize({ pan: false });
          });
        });
        observer.observe(container);
      }
      setRuntime({ leaflet, map, markers, buttons: new Map() });
    }).catch(() => {
      if (disposed) return;
      observer?.disconnect();
      map?.remove();
      map = null;
      setMapError("A térkép most nem tölthető be. Az ügyféllista továbbra is használható.");
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      cancelAnimationFrame(resizeFrame);
      map?.remove();
    };
  }, [attempt]);

  useEffect(() => {
    if (!runtime) return;
    const { leaflet, map, markers, buttons } = runtime;
    markers.clearLayers();
    buttons.clear();
    for (const group of data.groups) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "callback-map-marker-button";
      button.textContent = String(group.customers.length);
      button.setAttribute("aria-label", `${group.city}: ${group.customers.length} visszahívandó ügyfél. Lista szűrése.`);
      button.setAttribute("aria-controls", listId);
      button.onclick = (event) => {
        event.stopPropagation();
        selectTown(group.id);
      };
      button.onkeydown = (event) => event.stopPropagation();
      leaflet.DomEvent.disableClickPropagation(button);
      const icon = leaflet.divIcon({
        html: button, className: "callback-map-marker", iconSize: [44, 44], iconAnchor: [22, 22],
      });
      leaflet.marker([group.latitude, group.longitude], { icon, keyboard: false, title: group.city }).addTo(markers);
      buttons.set(group.id, button);
    }
    if (data.groups.length) {
      const bounds = leaflet.latLngBounds(data.groups.map((group) => [group.latitude, group.longitude]));
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 11, animate: false });
    } else {
      map.setView([47.2, 19.5], 7, { animate: false });
    }
    return () => {
      for (const button of buttons.values()) {
        button.onclick = null;
        button.onkeydown = null;
      }
      buttons.clear();
      markers.clearLayers();
    };
  }, [data.groups, listId, runtime, selectTown]);

  useEffect(() => {
    runtime?.buttons.forEach((button, id) => button.setAttribute("aria-pressed", String(id === activeTown)));
  }, [activeTown, data.groups, runtime]);

  return (
    <section className="min-w-0 space-y-4" aria-label="Visszahívandó ügyfelek térképe és listája">
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={searchId} className="mb-2 block text-sm font-bold text-slate-300">Ügyfél, település vagy klíma</label>
          <input id={searchId} type="search" className="input min-w-0" value={search} placeholder="Keresés..." onChange={(event) => {
            setSearch(event.target.value);
            selectTown("");
          }} />
        </div>
        <div className="min-w-0">
          <label htmlFor={cityId} className="mb-2 block text-sm font-bold text-slate-300">Település</label>
          <select id={cityId} className="input min-w-0" value={activeTown} onChange={(event) => selectTown(event.target.value)}>
            <option value="">Összes település ({data.total})</option>
            {data.groups.map((group) => <option key={group.id} value={group.id}>{group.city} ({group.customers.length})</option>)}
            {data.unlocated.length ? <option value={UNLOCATED}>Térképen nem jelölhető ({data.unlocated.length})</option> : null}
          </select>
        </div>
      </div>
      <p className="text-sm font-bold text-slate-400" role="status">
        {data.total} visszahívandó ügyfél · {data.groups.length} település a térképen · {data.unlocated.length} nem jelölhető
      </p>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <div className="relative isolate overflow-hidden rounded-3xl border border-white/10 bg-slate-900/80">
            <div ref={mapContainer} className="callback-map-canvas h-[360px] min-h-[320px] w-full sm:h-[460px] xl:h-[560px]" aria-label="Települések térképe; a számozott jelölőkkel szűrhető az ügyféllista" />
            {!runtime && !mapError ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/60 p-5 text-center font-bold text-slate-200" role="status">Térkép betöltése...</p> : null}
          </div>
          <p className="text-xs leading-relaxed text-slate-400">A számok a visszahívandó ügyfeleket jelzik. A jelölők településszintű, közelítő helyet mutatnak.</p>
          {mapError || tileError ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/15 p-3" role="status">
            <p className="min-w-0 flex-1 text-sm text-amber-100">{mapError || "A térképalap egy része nem tölthető be. A lista továbbra is használható."}</p>
            <button type="button" className={secondaryButton} onClick={() => setAttempt((value) => value + 1)}>Újrapróbálás</button>
          </div> : null}
          {data.total > 0 && !data.groups.length ? <p className="rounded-2xl bg-white/5 p-3 text-sm text-slate-300">A találatok települése nem jelölhető a térképen. Az ügyfelek a listából megnyithatók.</p> : null}
        </div>

        <div id={listId} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="min-w-0 break-words text-lg font-black">{selectedGroup?.city || (activeTown === UNLOCATED ? "Térképen nem jelölhető" : "Visszahívandó ügyfelek")}</h2>
            <span className="text-sm font-bold text-slate-400">{list.length} ügyfél</span>
          </div>
          {!list.length ? <p className="rounded-2xl bg-white/5 p-4 text-sm text-slate-300">{search.trim() ? "Nincs találat erre a keresésre." : "Nincs visszahívandó ügyfél."}</p> : null}
          {pagination.items.map((customer) => <button key={customer.id} type="button" onClick={() => onOpenCustomer(customer)} className="block w-full min-w-0 rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-left transition hover:border-cyan-300/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
            <span className="block break-words text-lg font-black">{customer.name || "Név nélkül"}</span>
            <span className="mt-1 block break-words text-sm text-slate-300">{formatPostalCity(customer.postalCode, customer.city) || "Település nincs megadva"}</span>
            <span className="mt-2 block break-words text-sm font-bold text-cyan-200">{callbackClimateLabel(customer)}</span>
            <span className="mt-3 block text-xs font-black text-cyan-100">Ügyfél megnyitása →</span>
          </button>)}
          {list.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3 text-sm text-slate-400">
            <span>{pagination.currentPage}. oldal / {pagination.pageCount}</span>
            {pagination.pageCount > 1 ? <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButton} disabled={pagination.currentPage <= 1} onClick={() => setPage(pagination.currentPage - 1)}>Előző</button>
              <button type="button" className={secondaryButton} disabled={pagination.currentPage >= pagination.pageCount} onClick={() => setPage(pagination.currentPage + 1)}>Következő</button>
            </div> : null}
          </div> : null}
        </div>
      </div>
    </section>
  );
}
