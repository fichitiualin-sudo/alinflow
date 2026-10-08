export type ActionFeedbackTone = "pending" | "success" | "error" | "warning" | "info";

/** Keeps older action messages readable while callers migrate to explicit tones. */
export function inferActionFeedbackTone(message: string): ActionFeedbackTone {
  const text = message.trim().toLocaleLowerCase("hu-HU");
  if (/mentve.{0,80}\bde\b|elküldtük.{0,80}\bde\b|elküldve.{0,80}\bde\b|ellenőrzést igényel|bizonytalan|részben|email nem ment ki|nem indult el/.test(text)) return "warning";
  if (/hiba|nem sikerült|nem tölthet|nem zárható|nem mentőd|nem került mentésre|foglalt|elutasít/.test(text)) return "error";
  if (/✅|✓/.test(text)) return "success";
  if (/folyamatban|készítése\.\.\.|keresése\.\.\.|mentése\.\.\.|küldése\.\.\.|betöltés/.test(text)) return "pending";
  if (/előbb|szükséges|hiányzik|válassz|válaszd|adj meg|add meg|nincs |még nem|csak .+után|csak .+küldhető|később|próbáld újra/.test(text)) return "warning";
  if (/✅|✓|mentve|mentés kész|elküldve|elküldtük|elkészült|lezárva|törölve|lemondva|módosítva|visszaállítva|hozzáadva|jelölve|kész:/.test(text)) return "success";
  return "info";
}
