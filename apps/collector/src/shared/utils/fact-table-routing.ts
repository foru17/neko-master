/**
 * Decides whether a time-range query reads the minute tables
 * (minute_stats / minute_dim_stats) or the hourly tables
 * (hourly_stats / hourly_dim_stats).
 *
 * Long ranges use the hourly tables for speed. Ranges that start before the
 * minute-table retention window also use them: those minute rows have been
 * deleted by the retention cleanup, while the hourly rows are kept longer.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MINUTE_RETENTION_DAYS = 7;

let minuteRetentionDays = DEFAULT_MINUTE_RETENTION_DAYS;

/** Called by the cleanup service whenever it resolves the effective retention. */
export function setMinuteRetentionDays(days: number): void {
  if (Number.isFinite(days) && days > 0) {
    minuteRetentionDays = days;
  }
}

export function getMinuteRetentionDays(): number {
  return minuteRetentionDays;
}

export function shouldUseHourlyTables(startMs: number, endMs: number, nowMs = Date.now()): boolean {
  if (endMs - startMs > SIX_HOURS_MS) return true;
  return startMs < nowMs - minuteRetentionDays * DAY_MS;
}
