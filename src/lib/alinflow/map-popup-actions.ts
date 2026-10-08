import { telHref } from "./format";

export function createMapPopupList<T>(items: T[], renderItem: (item: T) => HTMLElement) {
  const list = document.createElement("div");
  const rows = document.createElement("div");
  list.appendChild(rows);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  let page = 0;

  const pager = document.createElement("div");
  pager.className = "alinflow-map-popup-pagination";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "alinflow-map-popup-action";
  previous.textContent = "Előző";
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  const next = document.createElement("button");
  next.type = "button";
  next.className = "alinflow-map-popup-action";
  next.textContent = "Következő";
  pager.append(previous, status, next);
  if (pageCount > 1) list.appendChild(pager);

  function render() {
    rows.replaceChildren(...items.slice(page * pageSize, (page + 1) * pageSize).map(renderItem));
    previous.disabled = page === 0;
    next.disabled = page === pageCount - 1;
    status.textContent = `${page + 1}. oldal / ${pageCount} · ${items.length} tétel`;
  }

  function changePage(offset: number) {
    page = Math.min(pageCount - 1, Math.max(0, page + offset));
    render();
    const popup = list.closest<HTMLElement>(".alinflow-map-popup");
    if (popup) popup.scrollTop = 0;
  }

  previous.onclick = () => changePage(-1);
  next.onclick = () => changePage(1);
  render();
  return list;
}

export function createMapPopupActions({ name, phone, destination, onOpenCustomer }: {
  name: string;
  phone: string;
  destination: string;
  onOpenCustomer: () => void;
}) {
  const actions = document.createElement("div");
  actions.className = "alinflow-map-popup-actions";
  const phoneUrl = telHref(phone || "");
  const addLink = (label: string, href: string, kind: string) => {
    const link = document.createElement("a");
    link.className = `alinflow-map-popup-action alinflow-map-popup-${kind}`;
    link.textContent = label;
    link.href = href;
    link.setAttribute("aria-label", `${label}: ${name}`);
    actions.appendChild(link);
    return link;
  };
  if (/\d/.test(phoneUrl)) {
    addLink("Hívás", phoneUrl, "call");
  } else {
    const missing = document.createElement("span");
    missing.className = "alinflow-map-popup-action alinflow-map-popup-unavailable";
    missing.textContent = "Nincs telefonszám";
    actions.appendChild(missing);
  }
  if (destination.trim()) {
    const route = addLink("Útvonal", `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination.trim())}`, "route");
    route.target = "_blank";
    route.rel = "noopener noreferrer";
  }
  const open = document.createElement("button");
  open.type = "button";
  open.className = "alinflow-map-popup-action alinflow-map-popup-open";
  open.textContent = "Ügyfél megnyitása";
  open.setAttribute("aria-label", `Ügyfél megnyitása: ${name}`);
  open.onclick = onOpenCustomer;
  actions.appendChild(open);
  return actions;
}
