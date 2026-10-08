import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClickHouseReader } from './clickhouse.reader.js';

describe('ClickHouseReader daily trend buckets', () => {
  const sampleHour = '2026-10-08T20:00:00Z';
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv('CH_ENABLED', '1');
    vi.stubEnv('CH_DATABASE', 'neko_master');
    vi.stubEnv('STATS_QUERY_SOURCE', 'clickhouse');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mockBucket(time: string): void {
    fetchMock.mockImplementation(async () => Response.json({
      data: [{ time, upload: '3', download: '4' }],
    }));
  }

  function expectedQuery(bucketExpression: string): string {
    return `
SELECT
  toString(${bucketExpression}) AS time,
  toUInt64(SUM(upload)) AS upload,
  toUInt64(SUM(download)) AS download
FROM neko_master.traffic_agg_buffer
WHERE backend_id = 1
  AND minute >= toDateTime('2026-10-08 20:00:00')
  AND minute <= toDateTime('2026-10-08 20:00:00')
GROUP BY time
ORDER BY time ASC
\nFORMAT JSON`;
  }

  it.each([
    [480, 28800, '2026-10-08 16:00:00'],
    [-300, -18000, '2026-10-08 05:00:00'],
    [330, 19800, '2026-10-08 18:30:00'],
    [-210, -12600, '2026-10-08 03:30:00'],
  ])('aligns the SQL daily bucket for offset %i and returns a UTC minute key', async (offset, seconds, time) => {
    mockBucket(time);
    const result = await new ClickHouseReader().getTrafficTrendAggregated(1, 1440, sampleHour, sampleHour, offset);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.body).toBe(expectedQuery(
      `toDateTime(toInt64(floor((toInt64(toUnixTimestamp(minute)) + (${seconds})) / 86400) * 86400 - (${seconds})), 'UTC')`,
    ));
    expect(result).toEqual([{ time: time.replace(' ', 'T'), upload: 3, download: 4 }]);
  });

  it.each([1, 60, 1440, 2880])('preserves the existing %i-minute SQL and output with a missing or zero offset', async (bucketMinutes) => {
    mockBucket('2026-10-08 00:00:00');
    const reader = new ClickHouseReader();
    const original = await reader.getTrafficTrendAggregated(1, bucketMinutes, sampleHour, sampleHour);
    const zeroOffset = await reader.getTrafficTrendAggregated(1, bucketMinutes, sampleHour, sampleHour, 0);
    const query = expectedQuery(bucketMinutes <= 1 ? 'minute' : `toStartOfInterval(minute, INTERVAL ${bucketMinutes} MINUTE)`);

    expect(fetchMock.mock.calls[0][1]?.body).toBe(query);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(query);
    expect(original).toEqual([{ time: '2026-10-08 00:00:00', upload: 3, download: 4 }]);
    expect(zeroOffset).toEqual(original);
  });

  it.each([1, 60, 1439])('ignores offsets for %i-minute buckets', async (bucketMinutes) => {
    mockBucket('2026-10-08 20:00:00');
    const reader = new ClickHouseReader();
    const original = await reader.getTrafficTrendAggregated(1, bucketMinutes, sampleHour, sampleHour);
    const shifted = await reader.getTrafficTrendAggregated(1, bucketMinutes, sampleHour, sampleHour, 330);

    expect(fetchMock.mock.calls[1][1]?.body).toBe(fetchMock.mock.calls[0][1]?.body);
    expect(shifted).toEqual(original);
  });

  it('uses a local day when the requested bucket is longer than a day', async () => {
    mockBucket('2026-10-08 16:00:00');
    const result = await new ClickHouseReader().getTrafficTrendAggregated(1, 2880, sampleHour, sampleHour, 480);

    expect(fetchMock.mock.calls[0][1]?.body).toBe(expectedQuery(
      "toDateTime(toInt64(floor((toInt64(toUnixTimestamp(minute)) + (28800)) / 86400) * 86400 - (28800)), 'UTC')",
    ));
    expect(result).toEqual([{ time: '2026-10-08T16:00:00', upload: 3, download: 4 }]);
  });
});
