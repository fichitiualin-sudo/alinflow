import type { ReactNode } from "react";

const icons = {
  climate: <><rect x="3" y="4" width="18" height="10" rx="2" /><path d="M6 10h12M17 7h1M8 17v1a2 2 0 0 1-2 2m6-3v4m4-4v1a2 2 0 0 0 2 2" /></>,
  maintenance: <path d="M14.5 6.5 18 3a6 6 0 0 0-7.6 7.6L3.5 17.5a2.1 2.1 0 0 0 3 3l6.9-6.9A6 6 0 0 0 21 6l-3.5 3.5z" />,
  photos: <><path d="m8 6 1.5-3h5L16 6h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /><circle cx="12" cy="13" r="4" /></>,
  materials: <><path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5" /></>,
  documents: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h6" /></>,
  billing: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8M8 12h4M15 12h1" /></>,
  history: <><path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6M12 7v5l3 2" /></>,
  survey: <><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="m8 13 3 3 5-6" /></>,
  signature: <><path d="M4 21h16M5 17l1-4L16 3a2.1 2.1 0 0 1 3 3L9 16zM14 5l3 3" /></>,
  registry: <><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 11h.01M12 11h3M9 16h.01M12 16h3" /></>,
  complete: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  cancel: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18m-12 3 6 6m0-6-6 6" /></>,
  cash: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 12h.01M18 12h.01" /></>,
  transfer: <path d="M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4" />,
} satisfies Record<string, ReactNode>;

export type WorkSectionIconName = keyof typeof icons;

export function WorkSectionIcon({ name, className = "h-6 w-6" }: { name: WorkSectionIconName; className?: string }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>{icons[name]}</svg>;
}
