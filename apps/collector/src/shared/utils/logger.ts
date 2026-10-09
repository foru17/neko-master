/* eslint-disable no-console -- This module intentionally replaces console methods to control verbosity. */

const levels = ['error', 'warn', 'info', 'debug'];
const methods = [
  ['debug', 3],
  ['log', 2],
  ['info', 2],
  ['warn', 1],
] as const;
const originalMethods = methods.map(([method, severity]) => ({
  method,
  severity,
  original: console[method],
}));
const noop = (): void => {};

export function applyLogLevel(level = process.env.LOG_LEVEL): void {
  // Restore methods so repeated calls can increase verbosity and always warn.
  for (const { method, original } of originalMethods) {
    console[method] = original;
  }

  // An empty value (e.g. `LOG_LEVEL=` in .env) means unset.
  const normalized = (level ?? '').trim().toLowerCase() || 'info';
  let threshold = levels.indexOf(normalized);
  if (threshold === -1) {
    console.warn(`[Logger] Unknown LOG_LEVEL=${level}, falling back to info`);
    threshold = levels.indexOf('info');
  }

  for (const { method, severity } of originalMethods) {
    if (severity > threshold) console[method] = noop;
  }
}
