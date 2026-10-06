"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Customer } from "@/lib/alinflow/types";
import { paginateItems } from "@/lib/alinflow/customers";
import {
  formatMapDate,
  groupMaintenanceMapPoints,
  hasMaintenanceMapCoordinates,
  maintenanceMapStatusClass,
  maintenanceMapStatusColor,
  maintenanceMapStatusLabel,
  type MaintenanceMapPoint,
  type MaintenanceMapStatus,
} from "@/lib/alinflow/maintenance-map";
import { GoogleMapCanvas, type MapCanvasMarker } from "./GoogleMapCanvas";

type MaintenanceMapPanelProps = {
  points: MaintenanceMapPoint[];
  googleMapsApiKey: string;
  geocodingBusy: boolean;
  onOpenCustomer: (customer: Customer) => void;
  onGeocodeMissing: () => void;
  onToggleMaintenanceOptOut: (point: MaintenanceMapPoint, checked: boolean) => void;
};

const FILTERS: Array<{ value: MaintenanceMapStatus | "all"; label: string }> = [
  { value: "all", label: "Összes" },
  { value: "overdue", label: "Esedékes" },
  { value: "dueSoon", label: "Hamarosan" },
  { value: "ok", label: "Rendben" },
  { value: "optOut", label: "Nem kéri" },
  { value: "unknown", label: "Nincs adat" },
];

const secondaryButton = "rounded-xl bg-white/10 px-4 py-3 text-sm font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40";

function normalizeSearch(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function routeTarget(point: MaintenanceMapPoint) {
  return hasMaintenanceMapCoordinates(point) ? `${point.latitude},${point.longitude}` : point.address;
}

function installationDateLabel(point: MaintenanceMapPoint) {
  return `${formatMapDate(point.installationDate)}${point.installationTime ? ` · ${point.installationTime}` : ""}`;
}

export function MaintenanceMapPanel({
  points,
  googleMapsApiKey,
  geocodingBusy,
  onOpenCustomer,
  onGeocodeMissing,
  onToggleMaintenanceOptOut,
}: MaintenanceMapPanelProps) {
  const searchId = useId();
  const [statusFilter, setStatusFilter] = useState<MaintenanceMapStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [page, setPage] = useState(1);

  const filteredPoints = useMemo(() => {
    const normalizedSearch = normalizeSearch(search);
    return points.filter((point) => {
      if (statusFilter !== "all" && point.status !== statusFilter) return false;
      return !normalizedSearch || normalizeSearch([point.customerName, point.climateSummary, point.address, point.city].join(" ")).includes(normalizedSearch);
    });
  }, [points, search, statusFilter]);
  const groups = useMemo(() => groupMaintenanceMapPoints(filteredPoints), [filteredPoints]);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const list = selectedGroup?.points || filteredPoints;
  const pagination = paginateItems(list, page);
  const locatedCount = groups.reduce((sum, group) => sum + group.points.length, 0);
  const missingCoordinateCount = points.filter((point) => !hasMaintenanceMapCoordinates(point) && point.address).length;
  const counts = useMemo(() => points.reduce<Record<MaintenanceMapStatus | "all", number>>((result, point) => {
    result.all += 1;
    result[point.status] += 1;
    return result;
  }, { all: 0, overdue: 0, dueSoon: 0, ok: 0, optOut: 0, unknown: 0 }), [points]);
  const markers = useMemo<MapCanvasMarker[]>(() => groups.map((group) => ({
    id: group.id,
    latitude: group.latitude,
    longitude: group.longitude,
    label: String(group.points.length),
    title: `${group.points.length} telepítés · ${group.points[0].address || group.points[0].city || "Közös helyszín"}`,
    color: maintenanceMapStatusColor(group.status),
  })), [groups]);
  const current = useRef({ points, groups, onOpenCustomer });
  current.current = { points, groups, onOpenCustomer };

  const selectGroup = useCallback((id: string) => {
    setSelectedGroupId(id);
    setPage(1);
  }, []);

  useEffect(() => {
    if (selectedGroupId && !selectedGroup) selectGroup("");
  }, [selectedGroup, selectedGroupId, selectGroup]);

  const createPopupContent = useCallback((id: string) => {
    const content = document.createElement("div");
    content.className = "alinflow-map-popup";
    content.style.cssText = "font-family:Arial,sans-serif;max-width:280px;color:#0f172a;overflow-wrap:anywhere";
    const group = current.current.groups.find((item) => item.id === id);
    if (!group) {
      content.textContent = "Ez a helyszín már nem szerepel a szűrt listában.";
      return content;
    }
    const heading = document.createElement("p");
    heading.style.cssText = "font-size:16px;font-weight:900;margin:0 0 10px";
    heading.textContent = `${group.points.length} telepítés ezen a helyen`;
    content.appendChild(heading);
    const scroll = document.createElement("div");
    scroll.style.cssText = "padding-right:4px";
    group.points.slice(0, 10).forEach((point) => {
      const item = document.createElement("div");
      item.style.cssText = "padding:10px 0;border-top:1px solid #cbd5e1";
      const appendLine = (text: string, style: string) => {
        const line = document.createElement("p");
        line.textContent = text;
        line.style.cssText = `margin:0 0 5px;${style}`;
        item.appendChild(line);
      };
      appendLine(point.customerName, "font-size:14px;font-weight:900");
      appendLine(point.climateSummary, "font-size:13px;font-weight:800;color:#0f766e");
      appendLine(point.address || point.city || "Nincs cím megadva", "font-size:12px");
      appendLine(maintenanceMapStatusLabel(point.status), "font-size:12px;font-weight:800");
      appendLine(`Szerelés: ${installationDateLabel(point)}`, "font-size:12px;color:#475569");
      appendLine(`Utolsó karbantartás: ${formatMapDate(point.lastMaintenanceDate)}`, "font-size:12px;color:#475569");
      appendLine(`Következő esedékes: ${formatMapDate(point.nextMaintenanceDue)}`, "font-size:12px;color:#475569");
      appendLine(`Karbantartások száma: ${point.maintenanceCount}`, "font-size:12px;color:#475569");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Ügyfél megnyitása";
      button.style.cssText = "margin-top:5px;width:100%;border:0;border-radius:12px;background:#67e8f9;color:#0f172a;padding:12px;font-weight:900;cursor:pointer";
      button.onclick = () => {
        const latestPoint = current.current.points.find((item) => item.appointmentId === point.appointmentId);
        if (latestPoint) current.current.onOpenCustomer(latestPoint.customer);
      };
      item.appendChild(button);
      scroll.appendChild(item);
    });
    content.appendChild(scroll);
    if (group.points.length > 10) {
      const remaining = document.createElement("p");
      remaining.style.cssText = "font-size:12px;margin:10px 0 0;color:#475569";
      remaining.textContent = `A további ${group.points.length - 10} telepítés a helyszín listájában lapozható.`;
      content.appendChild(remaining);
    }
    return content;
  }, []);

  return (
    <section className="min-w-0 space-y-4" aria-label="Telepített klímák térképe és karbantartásai">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Karbantartási állapot szűrése">
          {FILTERS.map((filter) => <button
            key={filter.value}
            type="button"
            aria-pressed={statusFilter === filter.value}
            onClick={() => { setStatusFilter(filter.value); selectGroup(""); }}
            className={`rounded-2xl px-4 py-3 text-sm font-black transition ${statusFilter === filter.value ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-slate-900/80 text-cyan-100 hover:bg-white/10"}`}
          >{filter.label} ({counts[filter.value]})</button>)}
        </div>
        <button type="button" onClick={onGeocodeMissing} disabled={geocodingBusy || missingCoordinateCount === 0} className="rounded-2xl bg-amber-300 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
          {geocodingBusy ? "Koordináták keresése..." : `Hiányzó koordináták (${missingCoordinateCount})`}
        </button>
      </div>
      <div className="min-w-0">
        <label htmlFor={searchId} className="mb-2 block text-sm font-bold text-slate-300">Ügyfél, cím, település vagy klíma</label>
        <input id={searchId} type="search" className="input min-w-0" value={search} placeholder="Keresés..." onChange={(event) => { setSearch(event.target.value); selectGroup(""); }} />
      </div>
      <p className="text-sm font-bold text-slate-400" role="status">{filteredPoints.length} telepítés · {locatedCount} a térképen · {filteredPoints.length - locatedCount} nem jelölhető</p>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <GoogleMapCanvas apiKey={googleMapsApiKey} markers={markers} selectedMarkerId={selectedGroup?.id} onSelectMarker={selectGroup} createPopupContent={createPopupContent} maxFitZoom={16} ariaLabel="Telepített klímák helyszínei; a számozott jelölőkkel megnyithatók az ottani telepítések" />
          <p className="text-xs leading-relaxed text-slate-400">A számok az azonos helyre rögzített telepítéseket jelzik. A jelölő színe a helyszín legsürgősebb karbantartási állapotát mutatja.</p>
          {filteredPoints.length > 0 && !locatedCount ? <p className="rounded-2xl bg-white/5 p-3 text-sm text-slate-300">A találatokhoz még nincs térképen jelölhető koordináta. Az ügyfelek a listából megnyithatók.</p> : null}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="min-w-0 break-words text-lg font-black">{selectedGroup ? "Telepítések ezen a helyen" : "Telepített klímák"}</h2>
            <span className="text-sm font-bold text-slate-400">{list.length} telepítés</span>
          </div>
          {selectedGroup ? <button type="button" className={secondaryButton} onClick={() => selectGroup("")}>Összes helyszín</button> : null}
          {!list.length ? <p className="rounded-2xl bg-white/5 p-4 text-sm text-slate-300">Nincs találat erre a szűrésre.</p> : null}
          {pagination.items.map((point) => <article key={point.appointmentId} className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/80 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-lg font-black">{point.customerName}</h3>
                <p className="mt-1 break-words text-sm font-black text-cyan-200">{point.climateSummary}</p>
              </div>
              <span className={`max-w-full rounded-full border px-3 py-1 text-xs font-black ${maintenanceMapStatusClass(point.status)}`}>{maintenanceMapStatusLabel(point.status)}</span>
            </div>
            <div className="mt-3 space-y-1 break-words text-sm font-bold text-slate-300">
              <p>{point.address || point.city || "Nincs cím megadva"}</p>
              <p>Szerelés: {installationDateLabel(point)}</p>
              <p>Utolsó karbantartás: {formatMapDate(point.lastMaintenanceDate)}</p>
              <p>Következő esedékes: {formatMapDate(point.nextMaintenanceDue)}</p>
              <p>Karbantartások száma: {point.maintenanceCount}</p>
              {!hasMaintenanceMapCoordinates(point) ? <p className="font-black text-amber-100">Nincs használható koordináta{point.geocodeError ? `: ${point.geocodeError}` : "."}</p> : null}
            </div>
            <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm font-black text-slate-100">
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-zinc-400" checked={point.status === "optOut"} onChange={(event) => onToggleMaintenanceOptOut(point, event.target.checked)} />
              <span>Nem kéri a karbantartást</span>
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => onOpenCustomer(point.customer)} className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">Ügyfél</button>
              {routeTarget(point) ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(routeTarget(point))}`} target="_blank" rel="noreferrer" className="rounded-2xl bg-emerald-400 px-4 py-3 text-center text-sm font-black text-slate-950">Térkép</a> : <span className="rounded-2xl bg-slate-500/20 px-4 py-3 text-center text-sm font-black text-slate-400">Nincs cím</span>}
            </div>
          </article>)}
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
