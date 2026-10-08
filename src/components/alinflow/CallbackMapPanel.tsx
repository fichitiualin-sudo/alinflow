"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildCallbackMap, callbackClimateLabel } from "@/lib/alinflow/callback-map";
import { paginateItems } from "@/lib/alinflow/customers";
import { formatPostalCity } from "@/lib/alinflow/postal-codes";
import { displayAddress } from "@/lib/alinflow/format";
import { createMapPopupActions, createMapPopupList } from "@/lib/alinflow/map-popup-actions";
import type { Customer } from "@/lib/alinflow/types";
import { GoogleMapCanvas } from "./GoogleMapCanvas";

type CallbackMapPanelProps = {
  customers: Customer[];
  googleMapsApiKey: string;
  onOpenCustomer: (customer: Customer) => void;
};

const UNLOCATED = "__unlocated__";
const secondaryButton = "rounded-xl bg-white/10 px-4 py-3 text-sm font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40";

export function CallbackMapPanel({ customers, googleMapsApiKey, onOpenCustomer }: CallbackMapPanelProps) {
  const searchId = useId();
  const cityId = useId();
  const listId = useId();
  const [search, setSearch] = useState("");
  const [selectedTown, setSelectedTown] = useState("");
  const [page, setPage] = useState(1);
  const data = useMemo(() => buildCallbackMap(customers, search), [customers, search]);
  const selectedGroup = data.groups.find((group) => group.id === selectedTown);
  const activeTown = selectedGroup ? selectedTown : selectedTown === UNLOCATED && data.unlocated.length ? UNLOCATED : "";
  const matchingCustomers = useMemo(() => {
    const ids = new Set([...data.groups.flatMap((group) => group.customers), ...data.unlocated].map((customer) => customer.id));
    return customers.filter((customer) => ids.has(customer.id));
  }, [customers, data]);
  const list = selectedGroup?.customers || (activeTown === UNLOCATED ? data.unlocated : matchingCustomers);
  const pagination = paginateItems(list, page);
  const markers = useMemo(() => data.groups.map((group) => ({
    id: group.id, latitude: group.latitude, longitude: group.longitude,
    label: String(group.customers.length), title: `${group.city}: ${group.customers.length} visszahívandó ügyfél`,
    segments: [{ key: "callback", label: "Visszahívandó", color: "#0f766e", count: group.customers.length }],
  })), [data.groups]);
  const current = useRef({ data, onOpenCustomer });
  current.current = { data, onOpenCustomer };

  const createPopupContent = useCallback((id: string) => {
    const content = document.createElement("div");
    const group = current.current.data.groups.find((item) => item.id === id);
    if (!group) return content;
    const heading = document.createElement("p");
    heading.className = "alinflow-map-popup-heading";
    heading.textContent = group.city;
    content.appendChild(heading);
    content.appendChild(createMapPopupList(group.customers, (customer) => {
      const item = document.createElement("div");
      item.className = "alinflow-map-popup-customer";
      const appendLine = (text: string, className: string) => {
        const line = document.createElement("p");
        line.textContent = text;
        line.className = className;
        item.appendChild(line);
      };
      const address = (customer.workAddress || customer.address || "").trim();
      const destination = displayAddress({ ...customer, city: group.city, address });
      appendLine(customer.name || "Név nélkül", "alinflow-map-popup-name");
      appendLine(callbackClimateLabel(customer), "alinflow-map-popup-climate");
      appendLine(destination, "alinflow-map-popup-detail");
      if (!address) appendLine("Csak a település ismert.", "alinflow-map-popup-detail");
      item.appendChild(createMapPopupActions({
        name: customer.name || "Név nélkül", phone: customer.phone, destination,
        onOpenCustomer: () => {
          const latest = current.current.data.groups.find((entry) => entry.id === id)?.customers.find((entry) => entry.id === customer.id);
          if (latest) current.current.onOpenCustomer(latest);
        },
      }));
      return item;
    }));
    return content;
  }, []);

  const selectTown = useCallback((id: string) => {
    setSelectedTown(id);
    setPage(1);
  }, []);

  useEffect(() => {
    if (selectedTown && !activeTown) selectTown("");
  }, [activeTown, selectedTown, selectTown]);

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
          <GoogleMapCanvas apiKey={googleMapsApiKey} markers={markers} selectedMarkerId={activeTown}
            onSelectMarker={selectTown} createPopupContent={createPopupContent} maxFitZoom={11} itemLabel="visszahívandó ügyfél" ariaLabel="Visszahívandók településtérképe"
            attribution={<>Település-koordináták: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="underline">GeoNames</a></>} />
          <p className="text-xs leading-relaxed text-slate-400">Minden települést külön gombostű jelöl. A szám az ottani visszahívandó ügyfelek darabszáma, egy ügyfélnél pont látszik. Koppints a részletekhez. A helyek településszintűek, közelítőek.</p>
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
