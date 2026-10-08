export function QuoteEmailStatus({ sentAt }: { sentAt?: string }) {
  const date = sentAt ? new Date(sentAt) : undefined;
  const confirmed = date && !Number.isNaN(date.getTime());
  return (
    <p className={`rounded-2xl px-4 py-3 text-sm font-bold leading-relaxed ${confirmed ? "bg-emerald-400/20 text-emerald-100" : "bg-white/5 text-slate-300"}`}>
      {confirmed ? <>Utolsó emailküldés: <time dateTime={sentAt}>{date.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></> : "Még nincs visszaigazolt emailküldés."}
    </p>
  );
}
