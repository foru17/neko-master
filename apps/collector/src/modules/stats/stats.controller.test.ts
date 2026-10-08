import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestBackend, createTestDatabase } from '../../__tests__/helpers.js';
import { createApp } from '../app/app.js';
import type { StatsDatabase } from '../db/db.js';
import { realtimeStore } from '../realtime/realtime.store.js';

describe('StatsController', () => {
  let app: FastifyInstance;
  let backendId: number;
  let cleanup: () => void;
  let db: StatsDatabase;

  beforeEach(async () => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
    app = await createApp({
      port: 0,
      db,
      realtimeStore,
      logger: false,
      autoListen: false,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    realtimeStore.clearBackend(backendId);
    cleanup();
  });

  it.each([
    [undefined, 0],
    ['0', 0],
    ['480', 480],
    ['-330', -330],
    ['480.9', 480],
    ['-330.9', -330],
    ['840', 840],
    ['-840', -840],
    ['9999', 840],
    ['-9999', -840],
    ['', 0],
    ['invalid', 0],
    ['480invalid', 0],
    ['NaN', 0],
    ['Infinity', 0],
    ['-Infinity', 0],
  ])('parses daily trend tzOffsetMinutes=%s as %i', async (rawOffset, expectedOffset) => {
    const getTrend = vi.spyOn(app.statsService, 'getTrafficTrendAggregatedWithRouting')
      .mockResolvedValue([]);
    const query = new URLSearchParams({
      backendId: String(backendId),
      minutes: '1440',
      bucketMinutes: '1440',
    });
    if (rawOffset !== undefined) query.set('tzOffsetMinutes', rawOffset);

    const response = await app.inject({
      method: 'GET',
      url: `/api/stats/trend/aggregated?${query}`,
    });

    expect(response.statusCode).toBe(200);
    expect(getTrend).toHaveBeenCalledWith(backendId, { active: false }, 1440, 1440, expectedOffset);
  });

  it('returns local daily buckets without sharing cached results across offsets', async () => {
    db.batchUpdateTrafficStats(backendId, [{
      domain: 'example.com',
      ip: '203.0.113.1',
      chain: 'DIRECT',
      chains: ['DIRECT'],
      rule: 'Match',
      rulePayload: '',
      upload: 3,
      download: 4,
      timestampMs: Date.parse('2026-10-08T20:00:00Z'),
    }]);
    const query = new URLSearchParams({
      backendId: String(backendId),
      start: '2026-10-08T00:00:00Z',
      end: '2026-10-09T12:00:00Z',
      minutes: '1440',
      bucketMinutes: '1440',
    });
    for (const [offset, expectedTime] of [
      [undefined, '2026-10-08T00:00:00'],
      ['480', '2026-10-08T16:00:00'],
      ['-480', '2026-10-08T08:00:00'],
      ['0', '2026-10-08T00:00:00'],
    ] as const) {
      if (offset === undefined) query.delete('tzOffsetMinutes');
      else query.set('tzOffsetMinutes', offset);
      const response = await app.inject({ method: 'GET', url: `/api/stats/trend/aggregated?${query}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([{ time: expectedTime, upload: 3, download: 4 }]);
    }
  });

  it('accepts a daily bucket for aggregated traffic trends', async () => {
    const baseUpdate = {
      domain: 'example.com',
      ip: '203.0.113.1',
      chain: 'DIRECT',
      chains: ['DIRECT'],
      rule: 'Match',
      rulePayload: '',
    };
    db.batchUpdateTrafficStats(backendId, [
      {
        ...baseUpdate,
        upload: 1,
        download: 2,
        timestampMs: Date.parse('2026-07-23T03:37:00Z'),
      },
      {
        ...baseUpdate,
        upload: 3,
        download: 4,
        timestampMs: Date.parse('2026-07-23T14:37:00Z'),
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: `/api/stats/trend/aggregated?backendId=${backendId}&start=2026-07-23T00%3A00%3A00Z&end=2026-07-23T23%3A59%3A59Z&minutes=1440&bucketMinutes=1440`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { time: '2026-07-23T00:00:00', upload: 4, download: 6 },
    ]);
  });
});
