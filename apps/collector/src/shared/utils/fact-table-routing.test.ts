import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { getAllSchemaStatements } from '../../database/schema.js';
import { TimeseriesRepository } from '../../database/repositories/timeseries.repository.js';
import { setMinuteRetentionDays, shouldUseHourlyTables } from './fact-table-routing.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('fact table routing', () => {
  afterEach(() => setMinuteRetentionDays(7));

  it('uses minute tables for short recent ranges', () => {
    const now = Date.now();
    expect(shouldUseHourlyTables(now - 4 * HOUR_MS, now, now)).toBe(false);
  });

  it('uses hourly tables for ranges longer than six hours', () => {
    const now = Date.now();
    expect(shouldUseHourlyTables(now - 7 * HOUR_MS, now, now)).toBe(true);
  });

  it('uses hourly tables for short ranges older than the minute retention', () => {
    const now = Date.now();
    const start = now - 8 * DAY_MS;
    expect(shouldUseHourlyTables(start, start + 4 * HOUR_MS, now)).toBe(true);

    setMinuteRetentionDays(30);
    expect(shouldUseHourlyTables(start, start + 4 * HOUR_MS, now)).toBe(false);
  });

  it('ignores invalid retention values', () => {
    setMinuteRetentionDays(0);
    setMinuteRetentionDays(Number.NaN);
    const now = Date.now();
    const start = now - 8 * DAY_MS;
    expect(shouldUseHourlyTables(start, start + HOUR_MS, now)).toBe(true);
  });
});

describe('aggregated trend bucket size', () => {
  it('keeps small buckets from minute_stats for a recent 24h range', () => {
    const db = new Database(':memory:');
    for (const stmt of getAllSchemaStatements()) db.exec(stmt);
    db.prepare(`INSERT INTO backend_configs (name, url, token, enabled, is_active, listening)
      VALUES ('test', 'http://127.0.0.1:9090', '', 1, 1, 1)`).run();
    const minute = new Date(Date.now() - 2 * HOUR_MS).toISOString().slice(0, 16) + ':00';
    db.prepare(`INSERT INTO minute_stats (backend_id, minute, upload, download, connections)
      VALUES (1, ?, 5, 50, 1)`).run(minute);
    // hourly_stats deliberately empty: a 24h range with 10-minute buckets must
    // still be served from minute_stats.
    const repo = new TimeseriesRepository(db);
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 24 * HOUR_MS).toISOString();
    const rows = repo.getTrafficTrendAggregated(1, 1440, 10, start, end);
    expect(rows.reduce((sum, r) => sum + r.download, 0)).toBe(50);
  });
});

describe('old short ranges after minute retention cleanup', () => {
  it('returns traffic from hourly_stats instead of zero', () => {
    const db = new Database(':memory:');
    for (const stmt of getAllSchemaStatements()) db.exec(stmt);
    db.prepare(`INSERT INTO backend_configs (name, url, token, enabled, is_active, listening)
      VALUES ('test', 'http://127.0.0.1:9090', '', 1, 1, 1)`).run();

    // Ten days ago, 14:00 UTC. Minute rows for this hour are already gone.
    const day = new Date(Date.now() - 10 * DAY_MS).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO hourly_stats (backend_id, hour, upload, download, connections)
      VALUES (1, ?, 100, 900, 3)`).run(`${day}T14:00:00`);

    const repo = new TimeseriesRepository(db);
    const start = `${day}T14:00:00.000Z`;
    const end = `${day}T18:00:00.000Z`;

    expect(repo.getTrafficInRange(1, start, end)).toEqual({ upload: 100, download: 900 });
    expect(repo.getTrafficTrend(1, 240, start, end)).toEqual([
      { time: `${day}T14:00:00`, upload: 100, download: 900 },
    ]);
    expect(repo.getTrafficTrendAggregated(1, 240, 5, start, end)).toEqual([
      { time: `${day}T14:00:00`, upload: 100, download: 900 },
    ]);
  });
});
