// One daily reconciliation, drained in bounded batches by the idle-gated cron.
// 03:00 UTC is 04:00 in Hungary in winter and 05:00 in summer.
export function nextGoogleContactsSyncAt(now = Date.now()): string {
  const next = new Date(now);
  next.setUTCHours(3, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
