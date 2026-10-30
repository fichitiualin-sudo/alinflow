"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Customer } from "@/lib/alinflow/types";
import type { SharedMaintenanceInstallation } from "@/lib/alinflow/shared-maintenance";
import type { MaintenanceContactChoice } from "@/lib/alinflow/maintenance-contact-choice";
import { MaintenanceChoiceControls } from "./MaintenanceChoiceControls";
import { paginateItems } from "@/lib/alinflow/customers";
import {
  filterMaintenanceMapPoints,
  formatMapDate,
  groupMaintenanceMapPoints,
  hasMaintenanceMapCoordinates,
  maintenanceMapOriginLabel,
  maintenanceMapStatusClass,
  maintenanceMapStatusColor,
  maintenanceMapStatusLabel,
  normalizeMaintenanceMapVisibility,
  type MaintenanceMapPoint,
  type MaintenanceMapStatus,
  type MaintenanceMapVisibility,
} from "@/lib/alinflow/maintenance-map";
import { GoogleMapCanvas, type MapCanvasMarker } from "./GoogleMapCanvas";
import type { MapMarkerSegment } from "@/lib/alinflow/map-marker-style";
import { createMapPopupActions, createMapPopupList } from "@/lib/alinflow/map-popup-actions";
import { maintenanceGeocodeTarget } from "@/lib/alinflow/maintenance-geocoding";

type MaintenanceMapPanelProps = {
  points: MaintenanceMapPoint[];
  googleMapsApiKey: string;
  geocodingBusy: boolean;
  preferenceKey?: string;
  headerActions?: ReactNode;
  onOpenCustomer: (customer: Customer) => void;
  onOpenShared?: (item: SharedMaintenanceInstallation) => void;
  onGeocodeMissing: (points: MaintenanceMapPoint[]) => void;
  onToggleMaintenanceOptOut: (point: MaintenanceMapPoint, checked: boolean) => void;
  onChangeMaintenancePreference?: (point: MaintenanceMapPoint, choice: MaintenanceContactChoice) => void;
  maintenanceOptOutBusyIds?: string[];
  onEditMaintenanceOrigin?: (point: MaintenanceMapPoint) => void;
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
  preferenceKey,
  headerActions,
  onOpenCustomer,
  onOpenShared,
  onGeocodeMissing,
  onToggleMaintenanceOptOut,
  onChangeMaintenancePreference,
  maintenanceOptOutBusyIds = [],
  onEditMaintenanceOrigin,
}: MaintenanceMapPanelProps) {
  const searchId = useId();
  const [statusFilter, setStatusFilter] = useState<MaintenanceMapStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [page, setPage] = useState(1);
  const [savedVisibility, setSavedVisibility] = useState<{ key?: string; value: MaintenanceMapVisibility }>(() => ({
    key: preferenceKey, value: normalizeMaintenanceMapVisibility(undefined),
  }));
  const visibility = useMemo(() => savedVisibility.key === preferenceKey
    ? savedVisibility.value : normalizeMaintenanceMapVisibility(undefined), [preferenceKey, savedVisibility]);

  const visiblePoints = useMemo(() => filterMaintenanceMapPoints(points, { visibility, search }), [points, search, visibility]);
  const filteredPoints = useMemo(() => filterMaintenanceMapPoints(visiblePoints, {
    visibility: { own: true, external: true }, status: statusFilter,
  }), [visiblePoints, statusFilter]);
  const groups = useMemo(() => groupMaintenanceMapPoints(filteredPoints), [filteredPoints]);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const list = selectedGroup?.points || filteredPoints;
  const pagination = paginateItems(list, page);
  const locatedCount = groups.reduce((sum, group) => sum + group.points.length, 0);
  const missingCoordinateCount = filteredPoints.filter((point) => !hasMaintenanceMapCoordinates(point) && maintenanceGeocodeTarget(point)).length;
  const counts = useMemo(() => visiblePoints.reduce<Record<MaintenanceMapStatus | "all", number>>((result, point) => {
    result.all += 1;
    result[point.status] += 1;
    return result;
  }, { all: 0, overdue: 0, dueSoon: 0, ok: 0, optOut: 0, originalInstaller: 0, unknown: 0 }), [visiblePoints]);
  const markers = useMemo<MapCanvasMarker[]>(() => groups.map((group) => ({
    id: group.id,
    latitude: group.latitude,
    longitude: group.longitude,
    label: String(group.points.length),
    title: `${group.points.length} telepítés · ${group.points[0].address || group.points[0].city || "Közös helyszín"}`,
    color: maintenanceMapStatusColor(group.status),
    segments: FILTERS.filter((filter) => filter.value !== "all").flatMap((filter): MapMarkerSegment[] => {
      const status = filter.value as MaintenanceMapStatus;
      const count = group.points.filter((point) => point.status === status).length;
      return count ? [{ key: status, label: maintenanceMapStatusLabel(status), color: maintenanceMapStatusColor(status), count }] : [];
    }),
  })), [groups]);
  const current = useRef({ points, groups, onOpenCustomer, onOpenShared });
  current.current = { points, groups, onOpenCustomer, onOpenShared };

  const selectGroup = useCallback((id: string) => {
    setSelectedGroupId(id);
    setPage(1);
  }, []);

  useEffect(() => {
    let next = normalizeMaintenanceMapVisibility(undefined);
    if (preferenceKey) {
      try {
        next = normalizeMaintenanceMapVisibility(JSON.parse(window.localStorage.getItem(preferenceKey) || "null"));
      } catch {
        // The map remains usable when local preferences are unavailable or malformed.
      }
    }
    setSavedVisibility({ key: preferenceKey, value: next });
    selectGroup("");
  }, [preferenceKey, selectGroup]);

  function changeVisibility(origin: keyof MaintenanceMapVisibility, checked: boolean) {
    const next = { ...visibility, [origin]: checked };
    setSavedVisibility({ key: preferenceKey, value: next });
    selectGroup("");
    if (preferenceKey) {
      try {
        window.localStorage.setItem(preferenceKey, JSON.stringify(next));
      } catch {
        // Filtering still works without browser storage.
      }
    }
  }

  useEffect(() => {
    if (selectedGroupId && !selectedGroup) selectGroup("");
  }, [selectedGroup, selectedGroupId, selectGroup]);

  const createPopupContent = useCallback((id: string) => {
    const content = document.createElement("div");
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
    content.appendChild(createMapPopupList(group.points, (point) => {
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
      appendLine(maintenanceMapOriginLabel(point), "font-size:12px;font-weight:800;color:#475569");
      appendLine(point.address || point.city || "Nincs cím megadva", "font-size:12px");
      appendLine(maintenanceMapStatusLabel(point.status), "font-size:12px;font-weight:800");
      appendLine(`Szerelés: ${installationDateLabel(point)}`, "font-size:12px;color:#475569");
      appendLine(`Utolsó karbantartás: ${formatMapDate(point.lastMaintenanceDate)}`, "font-size:12px;color:#475569");
      appendLine(`Következő esedékes: ${formatMapDate(point.nextMaintenanceDue)}`, "font-size:12px;color:#475569");
      appendLine(`Karbantartások száma: ${point.maintenanceCount}`, "font-size:12px;color:#475569");
      item.appendChild(createMapPopupActions({
        name: point.customerName, phone: point.customer.phone, destination: routeTarget(point),
        onOpenCustomer: () => {
          const latestPoint = current.current.points.find((item) => item.appointmentId === point.appointmentId);
          if (latestPoint?.sharedMaintenance) current.current.onOpenShared?.(latestPoint.sharedMaintenance);
          else if (latestPoint) current.current.onOpenCustomer(latestPoint.customer);
        },
      }));
      return item;
    }));
    return content;
  }, []);

  return (
    <section className="min-w-0 space-y-4" aria-label="Telepített klímák térképe és karbantartásai">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Karbantartási állapot és telepítések szűrése">
          {FILTERS.map((filter) => <button
            key={filter.value}
            type="button"
            aria-pressed={statusFilter === filter.value}
            onClick={() => { setStatusFilter(filter.value); selectGroup(""); }}
            className={`rounded-2xl px-4 py-3 text-sm font-black transition ${statusFilter === filter.value ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-slate-900/80 text-cyan-100 hover:bg-white/10"}`}
          >{filter.value !== "all" ? <span aria-hidden="true" className="mr-2 inline-block h-3 w-3 rounded-full border border-white/60 align-middle" style={{ backgroundColor: maintenanceMapStatusColor(filter.value) }} /> : null}{filter.label} ({counts[filter.value]})</button>)}
          {([
            ["own", "Saját telepítés"],
            ["external", "Karbantartásra átvett"],
          ] as const).map(([origin, label]) => <label key={origin} className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cyan-300 ${visibility[origin] ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-slate-900/80 text-cyan-100 hover:bg-white/10"}`}>
            <input type="checkbox" className="h-4 w-4 shrink-0 accent-slate-950" checked={visibility[origin]} onChange={(event) => changeVisibility(origin, event.target.checked)} />
            <span className="min-w-0 break-words">{label}</span>
          </label>)}
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {headerActions}
          <button type="button" onClick={() => onGeocodeMissing(filteredPoints.filter(point => !point.sharedMaintenance))} disabled={geocodingBusy || missingCoordinateCount === 0} className="rounded-2xl bg-amber-300 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
            {geocodingBusy ? "Koordináták keresése..." : `Hiányzó koordináták (${missingCoordinateCount})`}
          </button>
        </div>
      </div>
      <div className="min-w-0">
        <label htmlFor={searchId} className="mb-2 block text-sm font-bold text-slate-300">Ügyfél, cím, település, klíma vagy átadó</label>
        <input id={searchId} type="search" className="input min-w-0" value={search} placeholder="Keresés..." onChange={(event) => { setSearch(event.target.value); selectGroup(""); }} />
      </div>
      <p className="text-sm font-bold text-slate-400" role="status">{filteredPoints.length} telepítés · {locatedCount} a térképen · {filteredPoints.length - locatedCount} nem jelölhető</p>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <GoogleMapCanvas apiKey={googleMapsApiKey} markers={markers} selectedMarkerId={selectedGroup?.id} onSelectMarker={selectGroup} createPopupContent={createPopupContent} maxFitZoom={16} itemLabel="telepítés" ariaLabel="Telepített klímák helyszínei; a számozott jelölőkkel megnyithatók az ottani telepítések" />
          <p className="text-xs leading-relaxed text-slate-400">Minden helyszínt külön gombostű jelöl, a szín a karbantartási állapotot mutatja. Azonos helyen több telepítésnél darabszám és minden állapotszín látszik. Koppints a részletekhez.</p>
          {filteredPoints.length > 0 && !locatedCount ? <p className="rounded-2xl bg-white/5 p-3 text-sm text-slate-300">A találatokhoz még nincs térképen jelölhető koordináta. Az ügyfelek a listából megnyithatók.</p> : null}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="min-w-0 break-words text-lg font-black">{selectedGroup ? "Telepítések ezen a helyen" : "Telepített klímák"}</h2>
            <span className="text-sm font-bold text-slate-400">{list.length} telepítés</span>
          </div>
          {selectedGroup ? <button type="button" className={secondaryButton} onClick={() => selectGroup("")}>Összes helyszín</button> : null}
          {!list.length ? <p className="rounded-2xl bg-white/5 p-4 text-sm text-slate-300">{!visibility.own && !visibility.external ? "Kapcsold be legalább az egyik klímacsoportot." : "Nincs találat erre a szűrésre."}</p> : null}
          {pagination.items.map((point) => <article key={point.appointmentId} className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/80 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-lg font-black">{point.customerName}</h3>
                <p className="mt-1 break-words text-sm font-black text-cyan-200">{point.climateSummary}</p>
              </div>
              <span className={`max-w-full rounded-full border px-3 py-1 text-xs font-black ${maintenanceMapStatusClass(point.status)}`}>{maintenanceMapStatusLabel(point.status)}</span>
            </div>
            <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className={`min-w-0 max-w-full break-words rounded-xl px-3 py-2 text-xs font-black ${point.maintenanceOrigin === "external" ? "bg-violet-400/15 text-violet-200" : "bg-white/5 text-slate-300"}`}>{maintenanceMapOriginLabel(point)}</span>
              {onEditMaintenanceOrigin && !point.sharedMaintenance ? <button type="button" onClick={() => onEditMaintenanceOrigin(point)} aria-label={`Besorolás módosítása: ${point.customerName}`} className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-cyan-100">Besorolás</button> : null}
            </div>
            <div className="mt-3 space-y-1 break-words text-sm font-bold text-slate-300">
              <p>{point.address || point.city || "Nincs cím megadva"}</p>
              <p>Szerelés: {installationDateLabel(point)}</p>
              <p>Utolsó karbantartás: {formatMapDate(point.lastMaintenanceDate)}</p>
              <p>Következő esedékes: {formatMapDate(point.nextMaintenanceDue)}</p>
              <p>Karbantartások száma: {point.maintenanceCount}</p>
              {point.maintenanceProviderName ? <p>Karbantartó: {point.maintenanceProviderName}</p> : null}
              {!hasMaintenanceMapCoordinates(point) ? <p className="font-black text-amber-100">Nincs használható koordináta{point.geocodeError ? `: ${point.geocodeError}` : "."}</p> : null}
            </div>
            {onChangeMaintenancePreference ? <MaintenanceChoiceControls
              choice={point.maintenanceContactPreference?.choice}
              legacyOptOut={Boolean(point.customer.maintenanceOptOut)}
              allowOriginalInstaller={Boolean(point.originalInstallerAvailable)}
              busy={maintenanceOptOutBusyIds.includes(point.appointmentId)}
              onChange={(choice) => onChangeMaintenancePreference(point, choice)}
            /> : <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm font-black text-slate-100">
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-zinc-400 disabled:cursor-wait disabled:opacity-50" checked={point.status === "optOut"} disabled={maintenanceOptOutBusyIds.includes(point.appointmentId)} onChange={(event) => onToggleMaintenanceOptOut(point, event.target.checked)} />
              <span>Nem kéri a karbantartást</span>
            </label>}
            {point.sharedMaintenance ? <p className="mt-3 text-sm text-violet-200">Egyeztetés {point.maintenanceSourceName} nevében</p> : null}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => point.sharedMaintenance ? onOpenShared?.(point.sharedMaintenance) : onOpenCustomer(point.customer)} className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">{point.sharedMaintenance ? "Egyeztetés" : "Ügyfél"}</button>
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
