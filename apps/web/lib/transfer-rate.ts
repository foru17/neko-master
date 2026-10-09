"use client";

import { useEffect, useRef, useState } from "react";

// Live transfer rate derived from successive cumulative totals (issue #93).
// Summary pushes arrive every few seconds, so the rate is averaged over a
// short sliding window instead of a single noisy delta.

export interface TotalsSample {
  at: number;
  download: number;
  upload: number;
}

export interface TransferRate {
  download: number;
  upload: number;
}

export const RATE_WINDOW_MS = 15_000;
// Pushes arrive every ~3s with some jitter; a longer span keeps it small.
const MIN_SPAN_MS = 5_000;
const MAX_SAMPLE_AGE_MS = 30_000;

/**
 * Append a sample and drop the window when totals go backwards (range or
 * backend switched underneath us) or when the previous sample is stale.
 */
export function pushSample(samples: TotalsSample[], next: TotalsSample): TotalsSample[] {
  const last = samples[samples.length - 1];
  if (
    last &&
    (next.download < last.download ||
      next.upload < last.upload ||
      next.at - last.at > MAX_SAMPLE_AGE_MS ||
      next.at < last.at)
  ) {
    return [next];
  }
  if (last && next.download === last.download && next.upload === last.upload && next.at === last.at) {
    return samples;
  }
  const kept = samples.filter((sample) => next.at - sample.at <= RATE_WINDOW_MS);
  return [...kept, next];
}

/** Bytes per second over the window, or null when there is not enough data. */
export function computeRate(samples: TotalsSample[], now: number): TransferRate | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (now - last.at > MAX_SAMPLE_AGE_MS) return null;
  const spanMs = last.at - first.at;
  if (spanMs < MIN_SPAN_MS) return null;
  return {
    download: Math.max(0, ((last.download - first.download) * 1000) / spanMs),
    upload: Math.max(0, ((last.upload - first.upload) * 1000) / spanMs),
  };
}

export interface RateTrackerState {
  samples: TotalsSample[];
  windowKey: string;
  sourceKey: string;
  enabled: boolean;
  /** Last totals held back after a switch; ignored until they change. */
  pending: Pick<TotalsSample, "download" | "upload"> | null;
  /** How many more distinct totals to hold back before sampling. */
  holds: number;
}

export interface RateTrackerInput {
  at: number;
  download: number | undefined;
  upload: number | undefined;
  windowKey: string;
  sourceKey: string;
  enabled: boolean;
}

export const initialRateTrackerState: RateTrackerState = {
  samples: [],
  windowKey: "",
  sourceKey: "",
  enabled: false,
  pending: null,
  holds: 0,
};

/**
 * Advance the tracker with the latest totals.
 *
 * After a switch (or the first mount) two kinds of totals are unusable as a
 * baseline and are held back:
 * - totals carried over from the old window or backend, which queries keep
 *   showing while the new one loads;
 * - the first fresh totals, which may come from the HTTP summary (persisted
 *   data only) while later pushes also include the realtime buffer.
 * Either would turn the next jump into a huge spurious rate.
 *
 * `clear` tells the caller to drop the displayed reading (backend switched or
 * tracking disabled); `rate` is a fresh reading when one is available.
 */
export function stepRateTracker(
  state: RateTrackerState,
  input: RateTrackerInput,
): { state: RateTrackerState; rate: TransferRate | null; clear: boolean } {
  const { at, download, upload, windowKey, sourceKey, enabled } = input;
  const sourceChanged = state.sourceKey !== sourceKey;
  const switched =
    sourceChanged || state.windowKey !== windowKey || (enabled && !state.enabled);
  const clear = sourceChanged || !enabled;
  const hasTotals = download !== undefined && upload !== undefined;

  let samples = state.samples;
  let pending = state.pending;
  let holds = state.holds;
  if (switched || !enabled) {
    samples = [];
    pending = hasTotals ? { download, upload } : null;
    // Besides the carried-over totals (pending), skip the first fresh value.
    holds = 1;
  }

  const base = { windowKey, sourceKey, enabled };
  if (!enabled || !hasTotals) {
    return { state: { ...base, samples, pending, holds }, rate: null, clear };
  }
  if (pending && pending.download === download && pending.upload === upload) {
    return { state: { ...base, samples, pending, holds }, rate: null, clear };
  }
  if (holds > 0) {
    return {
      state: { ...base, samples, pending: { download, upload }, holds: holds - 1 },
      rate: null,
      clear,
    };
  }
  samples = pushSample(samples, { at, download, upload });
  return {
    state: { ...base, samples, pending: null, holds: 0 },
    rate: computeRate(samples, at),
    clear,
  };
}

/**
 * Track the live rate of cumulative totals.
 * - `windowKey` changes when the queried window moves (rolling presets shift
 *   every minute): samples restart, but the last reading stays on screen
 *   until a new one is available or it goes stale.
 * - `sourceKey` changes when the totals belong to something else (backend
 *   switched): samples and the displayed reading are both cleared.
 */
export function useTransferRate(
  download: number | undefined,
  upload: number | undefined,
  { windowKey, sourceKey, enabled }: { windowKey: string; sourceKey: string; enabled: boolean },
): TransferRate | null {
  const trackerRef = useRef<RateTrackerState>(initialRateTrackerState);
  const lastReadingAtRef = useRef(0);
  const [rate, setRate] = useState<TransferRate | null>(null);

  useEffect(() => {
    const now = Date.now();
    const step = stepRateTracker(trackerRef.current, {
      at: now,
      download,
      upload,
      windowKey,
      sourceKey,
      enabled,
    });
    trackerRef.current = step.state;
    if (step.clear) setRate(null);
    if (step.rate) {
      lastReadingAtRef.current = now;
      setRate(step.rate);
    }
  }, [download, upload, windowKey, sourceKey, enabled]);

  // Expire the reading when pushes stop arriving.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (Date.now() - lastReadingAtRef.current > MAX_SAMPLE_AGE_MS) {
        setRate((current) => (current ? null : current));
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [enabled]);

  return rate;
}
