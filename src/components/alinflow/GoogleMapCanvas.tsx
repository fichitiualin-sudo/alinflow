"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadGoogleMaps, subscribeGoogleMapsAuthFailure } from "@/lib/alinflow/google-maps-loader";
import { createMapMarkerLayer } from "@/lib/alinflow/map-marker-layer";
import type { MapCanvasMarker } from "@/lib/alinflow/map-marker-style";
import "./GoogleMapCanvas.css";

export type { MapCanvasMarker } from "@/lib/alinflow/map-marker-style";

type GoogleMapCanvasProps = {
  apiKey: string;
  markers: MapCanvasMarker[];
  selectedMarkerId?: string;
  onSelectMarker?: (id: string) => void;
  createPopupContent?: (id: string) => HTMLElement;
  maxFitZoom?: number;
  attribution?: ReactNode;
  ariaLabel?: string;
  itemLabel?: string;
};

type MapRuntime = { maps: any; map: any; info: any; layer: ReturnType<typeof createMapMarkerLayer> };

export function GoogleMapCanvas({ apiKey, markers, selectedMarkerId, onSelectMarker, createPopupContent,
  maxFitZoom = 15, attribution, ariaLabel = "Ügyfelek térképe", itemLabel }: GoogleMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onSelectMarker, createPopupContent, itemLabel });
  callbacks.current = { onSelectMarker, createPopupContent, itemLabel };
  const [runtime, setRuntime] = useState<MapRuntime | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [compactMarkers, setCompactMarkers] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const updateSize = () => setCompactMarkers(media.matches);
    updateSize();
    media.addEventListener("change", updateSize);
    return () => media.removeEventListener("change", updateSize);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let failed = false;
    let current: MapRuntime | null = null;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    setRuntime(null);
    setError("");
    const showFailure = () => {
      if (disposed) return;
      failed = true;
      current?.layer.dispose();
      setRuntime(null);
      setError("A térkép most nem tölthető be. Az ügyféllista továbbra is használható.");
    };
    const unsubscribe = subscribeGoogleMapsAuthFailure(showFailure);
    void loadGoogleMaps(apiKey).then((maps) => {
      if (disposed || failed) return;
      const map = new maps.Map(container, {
        center: { lat: 47.2, lng: 19.5 }, zoom: 7, minZoom: 5, maxZoom: 19,
        mapTypeId: "roadmap", mapTypeControl: false, streetViewControl: false,
        fullscreenControl: false, zoomControl: false, cameraControl: false, rotateControl: false,
        clickableIcons: false, gestureHandling: "cooperative",
      });
      const info = new maps.InfoWindow({ maxWidth: 320 });
      current = { maps, map, info, layer: createMapMarkerLayer({ maps, map, info, getCallbacks: () => callbacks.current }) };
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            if (disposed) return;
            const center = map.getCenter();
            maps.event.trigger(map, "resize");
            if (center) map.setCenter(center);
          });
        });
        observer.observe(container);
      }
      if (!failed) setRuntime(current);
    }).catch(showFailure);
    return () => {
      disposed = true;
      unsubscribe();
      observer?.disconnect();
      cancelAnimationFrame(frame);
      current?.layer.dispose();
      if (current) current.maps.event.clearInstanceListeners(current.map);
      container.replaceChildren();
    };
  }, [apiKey, attempt]);

  useEffect(() => {
    runtime?.layer.update(markers, selectedMarkerId, maxFitZoom, compactMarkers);
  }, [runtime, markers, selectedMarkerId, maxFitZoom, compactMarkers]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setFullscreen(false); }
      if (event.key !== "Tab") return;
      const focusable = [...(fullscreenRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]') || [])]
        .filter((element) => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [fullscreen]);

  return <div className="min-w-0 space-y-3">
    <div ref={fullscreenRef} className={fullscreen ? "fixed inset-0 z-[100] bg-slate-950 p-3" : "relative"}
      role={fullscreen ? "dialog" : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? "Teljes képernyős térkép" : undefined}>
      <div className={`alinflow-map relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900/80 ${fullscreen ? "h-full" : "h-[360px] min-h-[320px] sm:h-[460px] xl:h-[560px]"}`}>
        <div ref={containerRef} className="h-full w-full" aria-label={ariaLabel} />
        {!runtime && !error ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/60 p-5 text-center font-bold text-slate-200" role="status">Térkép betöltése…</p> : null}
        {runtime ? <div className="absolute left-3 top-3 z-10 flex flex-col gap-1">
          <button type="button" className="alinflow-map-control text-2xl" aria-label="Nagyítás" onClick={() => runtime.map.setZoom(Math.min(19, runtime.map.getZoom() + 1))}>+</button>
          <button type="button" className="alinflow-map-control text-2xl" aria-label="Kicsinyítés" onClick={() => runtime.map.setZoom(Math.max(5, runtime.map.getZoom() - 1))}>−</button>
        </div> : null}
        <button ref={closeRef} type="button" className="alinflow-map-control absolute right-3 top-3 z-10 px-3 text-sm" aria-pressed={fullscreen} onClick={() => setFullscreen((value) => !value)}>{fullscreen ? "Bezárás" : "Teljes képernyő"}</button>
        {error ? <div className="absolute inset-x-3 bottom-10 z-10 rounded-2xl bg-slate-900 p-4 text-sm text-white shadow-xl" role="status">
          <p>{error}</p>
          <button type="button" className="mt-3 rounded-xl bg-cyan-300 px-4 py-3 font-black text-slate-950" onClick={() => setAttempt((value) => value + 1)}>Újrapróbálás</button>
        </div> : null}
      </div>
    </div>
    {attribution ? <div className="text-xs text-slate-400">{attribution}</div> : null}
  </div>;
}
