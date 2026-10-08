import { describe, expect, it } from 'vitest';
import { RealtimeMerger } from './realtime.merger.js';
import { RealtimeStore } from './realtime.store.js';

const backendId = 1;
const nowMs = Date.parse('2026-07-23T15:00:00Z');

function createStore(): RealtimeStore {
  const store = new RealtimeStore();
  store.minuteByBackend.set(backendId, new Map([
    ['2026-07-23T03:37:00', { upload: 1, download: 2, lastUpdated: nowMs }],
    ['2026-07-23T14:37:00', { upload: 3, download: 4, lastUpdated: nowMs }],
  ]));
  return store;
}

describe('realtime trend bucketing', () => {
  it('groups RealtimeStore traffic from the same UTC day into one daily bucket', () => {
    const store = createStore();

    expect(store.mergeTrend(backendId, [], 24 * 60, 24 * 60, nowMs)).toEqual([
      { time: '2026-07-23T00:00:00', upload: 4, download: 6 },
    ]);
  });

  it('groups RealtimeMerger traffic from the same UTC day into one daily bucket', () => {
    const store = createStore();
    const merger = new RealtimeMerger(store);

    expect(merger.mergeTrend(backendId, [], 24 * 60, 24 * 60, nowMs)).toEqual([
      { time: '2026-07-23T00:00:00', upload: 4, download: 6 },
    ]);
  });
});

describe.each(['store', 'merger'] as const)('realtime %s local daily trend buckets', (mode) => {
  const sampleNowMs = Date.parse('2026-10-09T00:00:00Z');

  function createTrend(minuteKeys = ['2026-10-08T20:00:00']) {
    const store = new RealtimeStore();
    store.minuteByBackend.set(backendId, new Map(minuteKeys.map((minuteKey) => [
      minuteKey,
      { upload: 3, download: 4, lastUpdated: sampleNowMs },
    ])));
    return mode === 'store' ? store : new RealtimeMerger(store);
  }

  it.each([
    [480, '2026-10-08T16:00:00'],
    [-300, '2026-10-08T05:00:00'],
    [330, '2026-10-08T18:30:00'],
    [-210, '2026-10-08T03:30:00'],
  ])('aligns a daily bucket with offset %i to %s', (offset, time) => {
    expect(createTrend().mergeTrend(backendId, [], 1440, 1440, sampleNowMs, offset)).toEqual([
      { time, upload: 3, download: 4 },
    ]);
  });

  it('merges into existing local-day buckets and splits at local midnight', () => {
    const trend = createTrend(['2026-10-08T15:59:00', '2026-10-08T16:00:00', '2026-10-08T20:00:00']);
    const base = [
      { time: '2026-10-07T16:00:00', upload: 10, download: 20 },
      { time: '2026-10-08T16:00:00', upload: 30, download: 40 },
    ];

    expect(trend.mergeTrend(backendId, base, 1440, 1440, sampleNowMs, 480)).toEqual([
      { time: '2026-10-07T16:00:00', upload: 13, download: 24 },
      { time: '2026-10-08T16:00:00', upload: 36, download: 48 },
    ]);
  });

  it('keeps missing and zero offsets identical to the existing UTC daily output', () => {
    const trend = createTrend();
    const expected = [{ time: '2026-10-08T00:00:00', upload: 3, download: 4 }];

    expect(trend.mergeTrend(backendId, [], 1440, 1440, sampleNowMs)).toEqual(expected);
    expect(trend.mergeTrend(backendId, [], 1440, 1440, sampleNowMs, 0)).toEqual(expected);
  });

  it.each([1, 60, 1439])('ignores offsets for %i-minute buckets', (bucketMinutes) => {
    const trend = createTrend();
    const expected = trend.mergeTrend(backendId, [], 1440, bucketMinutes, sampleNowMs);

    expect(trend.mergeTrend(backendId, [], 1440, bucketMinutes, sampleNowMs, 330)).toEqual(expected);
  });

  it('uses a local day when the requested bucket is longer than a day', () => {
    expect(createTrend().mergeTrend(backendId, [], 2880, 2880, sampleNowMs, 480)).toEqual([
      { time: '2026-10-08T16:00:00', upload: 3, download: 4 },
    ]);
  });
});
