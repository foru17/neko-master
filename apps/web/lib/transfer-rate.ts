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
const MIN_SPAN_MS = 2_000;
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
  const samplesRef = useRef<TotalsSample[]>([]);
  const windowKeyRef = useRef(windowKey);
  const sourceKeyRef = useRef(sourceKey);
  const lastReadingAtRef = useRef(0);
  const [rate, setRate] = useState<TransferRate | null>(null);

  useEffect(() => {
    if (sourceKeyRef.current !== sourceKey || !enabled) {
      sourceKeyRef.current = sourceKey;
      windowKeyRef.current = windowKey;
      samplesRef.current = [];
      setRate(null);
    } else if (windowKeyRef.current !== windowKey) {
      windowKeyRef.current = windowKey;
      samplesRef.current = [];
    }
    if (!enabled || download === undefined || upload === undefined) return;
    const now = Date.now();
    samplesRef.current = pushSample(samplesRef.current, { at: now, download, upload });
    const next = computeRate(samplesRef.current, now);
    if (next) {
      lastReadingAtRef.current = now;
      setRate(next);
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
