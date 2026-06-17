"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type ThemeMode = "dark" | "light";

const THEME_STORAGE_KEY = "alinflow-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme: ThemeMode = saved === "light" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  function updateTheme(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  return (
    <button
      type="button"
      onClick={() => updateTheme(theme === "dark" ? "light" : "dark")}
      className="theme-toggle no-print rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-black text-cyan-100 shadow-xl backdrop-blur transition hover:bg-white/15"
      title={theme === "dark" ? "Világos mód bekapcsolása" : "Sötét mód bekapcsolása"}
    >
      {theme === "dark" ? "Világos" : "Sötét"}
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#08111F] p-4 text-white print:bg-white print:p-0 print:text-black md:p-8">
      <div className="mx-auto w-full max-w-[1500px] space-y-8 print:max-w-none print:space-y-0 2xl:max-w-[1680px]">{children}</div>
    </main>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">{children}</section>;
}

export function Main({ children }: { children: ReactNode }) {
  return <div className="space-y-6 xl:col-span-2">{children}</div>;
}

export function Side({ children }: { children: ReactNode }) {
  return <aside className="space-y-6">{children}</aside>;
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl">
      <h2 className="mb-5 text-2xl font-black">{title}</h2>
      {children}
    </section>
  );
}

export function Hero({ title, sub, action, onAction }: { title: string; sub: string; action: string; onAction?: () => void }) {
  return (
    <section className="rounded-[2.5rem] border border-cyan-300/20 bg-gradient-to-br from-slate-950 to-slate-900 p-6 shadow-2xl md:p-8">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-4xl font-black leading-tight md:text-5xl">{title}</h1>
          {sub ? <p className="mt-3 text-lg text-slate-400">{sub}</p> : null}
        </div>
        <Btn onClick={onAction}>{action}</Btn>
      </div>
    </section>
  );
}

export function Back({ onClick }: { onClick: () => void }) {
  return (
    <div className="sticky top-3 z-50 w-fit print:hidden">
      <button onClick={onClick} className="rounded-2xl border border-cyan-200/20 bg-slate-900/95 px-5 py-3 font-black text-cyan-100 shadow-2xl shadow-slate-950/40 backdrop-blur">
        ← Vissza
      </button>
    </div>
  );
}

export function StepButton({ children, color = "cyan", onClick, href }: { children: ReactNode; color?: "cyan" | "green" | "blue" | "amber" | "red"; onClick?: () => void; href?: string }) {
  const colorClass = {
    cyan: "from-cyan-300 to-sky-400 text-slate-950 shadow-cyan-500/20",
    green: "from-emerald-400 to-green-500 text-slate-950 shadow-emerald-500/20",
    blue: "from-blue-400 to-indigo-500 text-white shadow-blue-500/20",
    amber: "from-amber-300 to-orange-400 text-slate-950 shadow-amber-500/20",
    red: "from-red-500 to-rose-500 text-white shadow-red-500/20",
  }[color];

  const className = `group flex w-full items-center justify-between gap-3 rounded-3xl bg-gradient-to-br ${colorClass} px-5 py-4 text-left font-black shadow-xl transition hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99]`;
  const content = <><span>{children}</span><span className="rounded-full bg-black/10 px-3 py-1 text-sm transition group-hover:translate-x-1">→</span></>;

  if (href) return <a href={href} onClick={onClick} className={className}>{content}</a>;
  return <button onClick={onClick} className={className}>{content}</button>;
}

export function Btn({ children, onClick, color = "cyan" }: { children: ReactNode; onClick?: () => void; color?: "cyan" | "green" | "blue" }) {
  const c = color === "green" ? "bg-emerald-400" : color === "blue" ? "bg-blue-400" : "bg-cyan-300";
  return <button onClick={onClick} className={`${c} rounded-2xl px-5 py-4 font-black text-slate-950`}>{children}</button>;
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="mb-3 flex justify-between gap-4 rounded-2xl bg-slate-900/80 p-4"><span>{label}</span><b>{value}</b></div>;
}

export function Field({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-900/80 p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-1 text-lg font-black">{value}</p></div>;
}

export function Gradient({ title, value }: { title: string; value: string; tone?: string }) {
  return <section className="rounded-[2rem] bg-gradient-to-br from-cyan-300 to-blue-400 p-6 text-slate-950 shadow-2xl"><p className="text-sm font-black opacity-80">{title}</p><h3 className="mt-2 text-3xl font-black">{value}</h3></section>;
}
