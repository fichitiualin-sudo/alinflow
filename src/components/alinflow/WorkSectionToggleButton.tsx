import { WorkSectionIcon, type WorkSectionIconName } from "@/components/alinflow/WorkSectionIcon";

export function WorkSectionToggleButton({
  label,
  icon,
  open,
  onClick,
  color = "cyan",
}: {
  label: string;
  icon: WorkSectionIconName;
  open: boolean;
  onClick: () => void;
  color?: "cyan" | "orange";
}) {
  const colorClass = color === "orange"
    ? "from-orange-300 to-orange-500 shadow-orange-500/20"
    : "from-cyan-300 to-sky-400 shadow-cyan-500/20";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`group flex min-h-[72px] w-full items-center justify-between gap-3 rounded-3xl bg-gradient-to-br ${colorClass} px-5 py-4 text-left font-black text-slate-950 shadow-xl transition hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99]`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/5">
          <WorkSectionIcon name={icon} />
        </span>
        <span className="min-w-0 leading-tight">{label}</span>
      </span>
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/10 text-lg font-black text-slate-950 transition group-hover:translate-x-1">
        {open ? "-" : "+"}
      </span>
    </button>
  );
}
