"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { inferActionFeedbackTone, type ActionFeedbackTone } from "@/lib/alinflow/action-feedback";

type Feedback = { message: string; tone: ActionFeedbackTone; revision: number };
type ActionFeedbackContextValue = {
  message: string;
  setMessage: (message: string, tone?: ActionFeedbackTone) => void;
};

const ActionFeedbackContext = createContext<ActionFeedbackContextValue | null>(null);
const toneStyles: Record<ActionFeedbackTone, string> = {
  pending: "border-cyan-300/60 bg-slate-900 text-cyan-100",
  success: "border-emerald-300/60 bg-emerald-950 text-emerald-100",
  error: "border-red-300/60 bg-red-950 text-red-100",
  warning: "border-amber-300/60 bg-amber-950 text-amber-100",
  info: "border-sky-300/60 bg-slate-900 text-sky-100",
};
const toneLabels: Record<ActionFeedbackTone, string> = {
  pending: "Folyamatban", success: "Sikeres művelet", error: "Hiba", warning: "Figyelem", info: "Tájékoztatás",
};

export function ActionFeedbackProvider({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<Feedback>({ message: "", tone: "info", revision: 0 });
  const setMessage = useCallback((message: string, tone?: ActionFeedbackTone) => {
    setFeedback((previous) => ({ message, tone: tone || inferActionFeedbackTone(message), revision: previous.revision + 1 }));
  }, []);
  const context = useMemo(() => ({ message: feedback.message, setMessage }), [feedback.message, setMessage]);

  return (
    <ActionFeedbackContext.Provider value={context}>
      {children}
      {feedback.message ? (
        <div className="pointer-events-none fixed inset-x-3 top-3 z-[120] mx-auto max-w-2xl print:hidden sm:inset-x-6 sm:top-5">
          <div className={`pointer-events-auto flex max-h-[45dvh] items-start gap-3 overflow-y-auto rounded-2xl border px-4 py-3 shadow-2xl shadow-black/40 ${toneStyles[feedback.tone]}`}>
            <div key={feedback.revision} role={feedback.tone === "error" ? "alert" : "status"} aria-atomic="true" className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide opacity-80">
                {feedback.tone === "pending" ? <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" /> : null}
                {toneLabels[feedback.tone]}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm font-bold leading-relaxed [overflow-wrap:anywhere] sm:text-base">{feedback.message}</p>
            </div>
            <button type="button" onClick={() => setMessage("")} aria-label="Értesítés bezárása" className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">×</button>
          </div>
        </div>
      ) : null}
    </ActionFeedbackContext.Provider>
  );
}

export function useActionFeedback() {
  const context = useContext(ActionFeedbackContext);
  if (!context) throw new Error("useActionFeedback requires ActionFeedbackProvider");
  return context;
}
