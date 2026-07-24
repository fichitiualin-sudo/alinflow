"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Customer } from "@/lib/alinflow/types";
import {
  formatMapDate,
  maintenanceMapStatusClass,
  maintenanceMapStatusColor,
  maintenanceMapStatusLabel,
  type MaintenanceMapPoint,
  type MaintenanceMapStatus,
} from "@/lib/alinflow/maintenance-map";

declare global {
  interface Window {
    google?: any;
    __alinflowGoogleMapsPromise?: Promise<void>;
  }
}

type MaintenanceMapPanelProps = {
  points: MaintenanceMapPoint[];
  googleMapsApiKey: string;
  geocodingBusy: boolean;
  onBack: () => void;
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function loadGoogleMaps(apiKey: string) {
  if (typeof window === "undefined") return Promise.reject(new Error("A térkép csak böngészőben tölthető be."));
  if (window.google?.maps) return Promise.resolve();
  if (window.__alinflowGoogleMapsPromise) return window.__alinflowGoogleMapsPromise;

  window.__alinflowGoogleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById("alinflow-google-maps-script") as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Nem sikerült betölteni a Google térképet.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "alinflow-google-maps-script";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Nem sikerült betölteni a Google térképet."));
    document.head.appendChild(script);
  });

  return window.__alinflowGoogleMapsPromise;
}

function hasCoordinates(point: MaintenanceMapPoint) {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
}

function markerIcon(googleMaps: any, status: MaintenanceMapStatus) {
  const color = maintenanceMapStatusColor(status);
  const svg = `
    <svg width="40" height="48" viewBox="0 0 40 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 46C20 46 36 28.6 36 17.8C36 8.5 28.8 1 20 1C11.2 1 4 8.5 4 17.8C4 28.6 20 46 20 46Z" fill="${color}" stroke="#0f172a" stroke-width="2"/>
      <circle cx="20" cy="18" r="7" fill="white"/>
    </svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new googleMaps.Size(34, 40),
    anchor: new googleMaps.Point(17, 40),
  };
}

function routeTarget(point: MaintenanceMapPoint) {
  if (hasCoordinates(point)) return `${point.latitude},${point.longitude}`;
  return point.address;
}

export function MaintenanceMapPanel({
  points,
  googleMapsApiKey,
  geocodingBusy,
  onBack,
  onOpenCustomer,
  onGeocodeMissing,
  onToggleMaintenanceOptOut,
}: MaintenanceMapPanelProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const onOpenCustomerRef = useRef(onOpenCustomer);
  const [statusFilter, setStatusFilter] = useState<MaintenanceMapStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    onOpenCustomerRef.current = onOpenCustomer;
  }, [onOpenCustomer]);

  const filteredPoints = useMemo(() => {
    const normalizedSearch = search.toLocaleLowerCase("hu-HU").trim();
    return points.filter((point) => {
      const statusOk = statusFilter === "all" || point.status === statusFilter;
      if (!statusOk) return false;
      if (!normalizedSearch) return true;
      return [point.customerName, point.climateSummary, point.address, point.city]
        .join(" ")
        .toLocaleLowerCase("hu-HU")
        .includes(normalizedSearch);
    });
  }, [points, search, statusFilter]);

  const locatedPoints = filteredPoints.filter(hasCoordinates);
  const locatedPointSignature = locatedPoints
    .map((point) => `${point.appointmentId}:${point.latitude}:${point.longitude}:${point.status}`)
    .join("|");
  const missingCoordinateCount = points.filter((point) => !hasCoordinates(point) && point.address).length;

  const counts = useMemo(() => {
    return points.reduce<Record<MaintenanceMapStatus | "all", number>>(
      (acc, point) => {
        acc.all += 1;
        acc[point.status] += 1;
        return acc;
      },
      { all: 0, ok: 0, dueSoon: 0, overdue: 0, optOut: 0, unknown: 0 }
    );
  }, [points]);

  useEffect(() => {
    if (!googleMapsApiKey || !mapContainerRef.current) return;
    let disposed = false;

    loadGoogleMaps(googleMapsApiKey)
      .then(() => {
        if (disposed || !mapContainerRef.current || !window.google?.maps) return;
        const googleMaps = window.google.maps;
        const center = { lat: 47.1625, lng: 19.5033 };

        if (!mapRef.current) {
          mapRef.current = new googleMaps.Map(mapContainerRef.current, {
            center,
            zoom: 7,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          });
        }

        markersRef.current.forEach((marker) => marker.setMap(null));
        markersRef.current = [];

        if (!locatedPoints.length) {
          mapRef.current.setCenter(center);
          mapRef.current.setZoom(7);
          return;
        }

        const bounds = new googleMaps.LatLngBounds();
        const infoWindow = new googleMaps.InfoWindow();

        locatedPoints.forEach((point) => {
          const position = { lat: Number(point.latitude), lng: Number(point.longitude) };
          bounds.extend(position);
          const marker = new googleMaps.Marker({
            position,
            map: mapRef.current,
            title: `${point.customerName} - ${point.climateSummary}`,
            icon: markerIcon(googleMaps, point.status),
          });

          marker.addListener("click", () => {
            const content = document.createElement("div");
            content.innerHTML = `
              <div style="font-family:Arial,sans-serif;max-width:260px;color:#0f172a">
                <div style="font-weight:900;font-size:16px;margin-bottom:4px">${escapeHtml(point.customerName)}</div>
                <div style="font-weight:800;margin-bottom:6px">${escapeHtml(point.climateSummary)}</div>
                <div style="font-size:13px;margin-bottom:6px">${escapeHtml(point.address)}</div>
                <div style="font-size:12px;color:#475569">Szerelés: ${escapeHtml(formatMapDate(point.installationDate))}</div>
                <div style="font-size:12px;color:#475569">Utolsó karbantartás: ${escapeHtml(formatMapDate(point.lastMaintenanceDate))}</div>
                <div style="font-size:12px;color:#475569">Következő esedékes: ${escapeHtml(formatMapDate(point.nextMaintenanceDue))}</div>
                <button type="button" data-open-customer style="margin-top:10px;width:100%;border:0;border-radius:12px;background:#67e8f9;color:#0f172a;padding:10px 12px;font-weight:900;cursor:pointer">
                  Ügyfél megnyitása
                </button>
              </div>
            `;
            content.querySelector<HTMLButtonElement>("[data-open-customer]")?.addEventListener("click", () => {
              onOpenCustomerRef.current(point.customer);
            });
            infoWindow.setContent(content);
            infoWindow.open({ anchor: marker, map: mapRef.current });
          });

          markersRef.current.push(marker);
        });

        mapRef.current.fitBounds(bounds, 64);
      })
      .catch((error: Error) => setMapError(error.message));

    return () => {
      disposed = true;
    };
  }, [googleMapsApiKey, locatedPointSignature]);

  return (
    <main className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="rounded-2xl border border-cyan-200/20 bg-slate-900/95 px-5 py-3 font-black text-cyan-100 shadow-2xl shadow-slate-950/40 backdrop-blur"
      >
        ← Vissza
      </button>

      <section className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-2xl md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-sm font-black text-cyan-200">Karbantartási térkép</p>
            <h1 className="mt-1 text-3xl font-black md:text-4xl">Telepített klímák térképen</h1>
            <p className="mt-2 max-w-3xl text-sm font-bold text-slate-400 md:text-base">
              Itt egyben látod a telepített klímákat, cím szerint. A színek azt mutatják, melyik készüléknél esedékes vagy közelgő a karbantartás.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm font-black sm:grid-cols-5">
            <div className="rounded-2xl bg-slate-900/80 p-3"><span className="text-slate-400">Összes</span><b className="mt-1 block text-xl">{counts.all}</b></div>
            <div className="rounded-2xl bg-red-500/20 p-3 text-red-100"><span>Esedékes</span><b className="mt-1 block text-xl">{counts.overdue}</b></div>
            <div className="rounded-2xl bg-amber-300/20 p-3 text-amber-100"><span>Hamarosan</span><b className="mt-1 block text-xl">{counts.dueSoon}</b></div>
            <div className="rounded-2xl bg-emerald-400/20 p-3 text-emerald-100"><span>Rendben</span><b className="mt-1 block text-xl">{counts.ok}</b></div>
            <div className="rounded-2xl bg-zinc-500/25 p-3 text-zinc-100"><span>Nem kéri</span><b className="mt-1 block text-xl">{counts.optOut}</b></div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.75fr)]">
        <div className="space-y-4 rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-2xl">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setStatusFilter(filter.value)}
                  className={`rounded-2xl px-4 py-3 text-sm font-black transition ${
                    statusFilter === filter.value
                      ? "bg-cyan-300 text-slate-950"
                      : "border border-white/10 bg-slate-900/80 text-cyan-100 hover:bg-white/10"
                  }`}
                >
                  {filter.label} ({counts[filter.value]})
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onGeocodeMissing}
                disabled={geocodingBusy || missingCoordinateCount === 0}
                className="rounded-2xl bg-amber-300 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {geocodingBusy ? "Koordináták keresése..." : `Hiányzó koordináták (${missingCoordinateCount})`}
              </button>
            </div>
          </div>

          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Keresés ügyfél, cím vagy klíma alapján..."
          />

          {googleMapsApiKey ? (
            <div ref={mapContainerRef} className="min-h-[520px] overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-900/80" />
          ) : (
            <div className="flex min-h-[320px] items-center justify-center rounded-[1.5rem] border border-amber-300/30 bg-amber-300/15 p-6 text-center font-bold text-amber-100">
              A térképhez add meg a Vercel környezeti változók között a NEXT_PUBLIC_GOOGLE_MAPS_API_KEY kulcsot.
            </div>
          )}
          {mapError ? <div className="rounded-2xl border border-red-300/30 bg-red-500/20 p-4 font-black text-red-100">{mapError}</div> : null}
          {googleMapsApiKey && !locatedPoints.length ? (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/15 p-4 font-bold text-amber-100">
              Még nincs térképre tehető koordináta a szűrt listában. Futtasd a koordinátakeresést, vagy szűrj másik állapotra.
            </div>
          ) : null}
        </div>

        <aside className="space-y-3 rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-2xl">
          <h2 className="text-2xl font-black">Klímák listája</h2>
          <p className="text-sm font-bold text-slate-400">{filteredPoints.length} találat, ebből {locatedPoints.length} térképen.</p>

          <div className="max-h-[690px] space-y-3 overflow-auto pr-1">
            {filteredPoints.map((point) => (
              <article key={point.appointmentId} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black">{point.customerName}</h3>
                    <p className="mt-1 text-sm font-black text-cyan-200">{point.climateSummary}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${maintenanceMapStatusClass(point.status)}`}>
                    {maintenanceMapStatusLabel(point.status)}
                  </span>
                </div>

                <div className="mt-3 space-y-1 text-sm font-bold text-slate-300">
                  <p>{point.address || "Nincs cím megadva"}</p>
                  <p>Szerelés: {formatMapDate(point.installationDate)}</p>
                  <p>Utolsó karbantartás: {formatMapDate(point.lastMaintenanceDate)}</p>
                  <p>Következő esedékes: {formatMapDate(point.nextMaintenanceDue)}</p>
                  <p>Karbantartások száma: {point.maintenanceCount}</p>
                  {!hasCoordinates(point) ? (
                    <p className="font-black text-amber-100">
                      Nincs még koordináta{point.geocodeError ? `: ${point.geocodeError}` : "."}
                    </p>
                  ) : null}
                </div>

                <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm font-black text-slate-100">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-zinc-400"
                    checked={point.status === "optOut"}
                    onChange={(event) => onToggleMaintenanceOptOut(point, event.target.checked)}
                  />
                  <span>Nem kéri a karbantartást</span>
                </label>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenCustomer(point.customer)}
                    className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950"
                  >
                    Ügyfél
                  </button>
                  {point.address ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(routeTarget(point))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-2xl bg-emerald-400 px-4 py-3 text-center text-sm font-black text-slate-950"
                    >
                      Térkép
                    </a>
                  ) : (
                    <span className="rounded-2xl bg-slate-500/20 px-4 py-3 text-center text-sm font-black text-slate-400">Nincs cím</span>
                  )}
                </div>
              </article>
            ))}

            {!filteredPoints.length ? (
              <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-5 text-center font-black text-slate-300">
                Nincs találat erre a szűrésre.
              </div>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
