// Gateways report per-connection traffic as cumulative counters. When a
// collector first sees a connection that was already open before it started
// (collector restart, container upgrade, backend added at runtime), those
// counters include traffic accumulated before we were watching — often already
// recorded by the previous process. Counting them as fresh traffic produces a
// huge spike at restart (issue #50). Such connections only establish a
// baseline; later deltas are counted normally.
//
// This is a mitigation with known limits: it relies on the gateway reporting a
// start time and on gateway/collector clocks being roughly in sync. Bytes a
// preexisting connection moves between collector start and the first snapshot
// are not counted.

// Allow for clock skew between the gateway and the collector host.
export const PREEXISTING_GRACE_MS = 5_000;

/**
 * Normalize a gateway start timestamp to epoch milliseconds.
 * Accepts ISO strings (mihomo `start`) and epoch seconds or milliseconds
 * (Surge `startDate`). Returns null when missing or unparseable.
 */
export function parseConnectionStartMs(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    // Epoch seconds are < 1e12 until the year 33658.
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string" && value) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) || ms <= 0 ? null : ms;
  }
  return null;
}

/**
 * True when the connection started before the collector began watching.
 * Unknown start times return false, keeping the previous behavior (count the
 * first snapshot) for backends that omit the field.
 */
export function isPreexistingConnection(
  startValue: unknown,
  collectorStartedAtMs: number,
): boolean {
  const startMs = parseConnectionStartMs(startValue);
  if (startMs === null) return false;
  return startMs < collectorStartedAtMs - PREEXISTING_GRACE_MS;
}
