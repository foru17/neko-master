/**
 * Timeseries Repository
 *
 * Handles time-based traffic queries: hourly stats, today traffic,
 * traffic in range, traffic trend and aggregated trend.
 */
import type Database from 'better-sqlite3';
import type { HourlyStats } from '@neko-master/shared';
import { BaseRepository } from './base.repository.js';

export class TimeseriesRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  getHourlyStats(backendId: number, hours = 24, start?: string, end?: string): HourlyStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      // hourly_stats is maintained in real-time — query it directly
      const startHour = this.toHourKey(new Date(start!));
      const endHour = this.toHourKey(new Date(end!));
      const stmt = this.db.prepare(`
        SELECT hour, upload, download, connections
        FROM hourly_stats
        WHERE backend_id = ? AND hour >= ? AND hour <= ?
        ORDER BY hour DESC
        LIMIT ?
      `);
      return stmt.all(backendId, startHour, endHour, hours) as HourlyStats[];
    }

    const stmt = this.db.prepare(`
      SELECT hour, upload, download, connections
      FROM hourly_stats
      WHERE backend_id = ?
      ORDER BY hour DESC
      LIMIT ?
    `);
    return stmt.all(backendId, hours) as HourlyStats[];
  }

  getTodayTraffic(backendId: number): { upload: number; download: number } {
    const today = new Date().toISOString().split('T')[0];
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(upload), 0) as upload, COALESCE(SUM(download), 0) as download
      FROM hourly_stats
      WHERE backend_id = ? AND hour >= ?
    `);
    return stmt.get(backendId, today) as { upload: number; download: number };
  }

  getTrafficInRange(backendId: number, start?: string, end?: string): { upload: number; download: number } {
    const range = this.parseMinuteRange(start, end);
    if (!range) {
      return this.getTodayTraffic(backendId);
    }

    const startDate = new Date(start!);
    const endDate = new Date(end!);
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

    if (endDate.getTime() - startDate.getTime() > SIX_HOURS_MS) {
      const stmt = this.db.prepare(`
        SELECT
          COALESCE(SUM(upload), 0) as upload,
          COALESCE(SUM(download), 0) as download
        FROM hourly_stats
        WHERE backend_id = ? AND hour >= ? AND hour <= ?
      `);
      return stmt.get(backendId, this.toHourKey(startDate), this.toHourKey(endDate)) as { upload: number; download: number };
    }

    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(upload), 0) as upload,
        COALESCE(SUM(download), 0) as download
      FROM minute_stats
      WHERE backend_id = ? AND minute >= ? AND minute <= ?
    `);
    return stmt.get(backendId, range.startMinute, range.endMinute) as { upload: number; download: number };
  }

  getTrafficTrend(
    backendId: number,
    minutes = 30,
    start?: string,
    end?: string,
  ): Array<{ time: string; upload: number; download: number }> {
    const range = this.parseMinuteRange(start, end);
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    const cutoffStr = cutoff.toISOString().slice(0, 16) + ':00';
    const startStr = range?.startMinute || cutoffStr;
    const endStr = range?.endMinute || this.toMinuteKey(new Date());

    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    if (new Date(endStr).getTime() - new Date(startStr).getTime() > SIX_HOURS_MS) {
      const stmt = this.db.prepare(`
        SELECT hour as time, upload, download
        FROM hourly_stats
        WHERE backend_id = ? AND hour >= ? AND hour <= ?
        ORDER BY hour ASC
      `);
      return stmt.all(
        backendId,
        this.toHourKey(new Date(startStr)),
        this.toHourKey(new Date(endStr)),
      ) as Array<{ time: string; upload: number; download: number }>;
    }

    const stmt = this.db.prepare(`
      SELECT minute as time, upload, download
      FROM minute_stats
      WHERE backend_id = ? AND minute >= ? AND minute <= ?
      ORDER BY minute ASC
    `);
    return stmt.all(backendId, startStr, endStr) as Array<{ time: string; upload: number; download: number }>;
  }

  getTrafficTrendAggregated(
    backendId: number,
    minutes = 30,
    bucketMinutes = 1,
    start?: string,
    end?: string,
    tzOffsetMinutes = 0,
  ): Array<{ time: string; upload: number; download: number }> {
    const range = this.parseMinuteRange(start, end);
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    const cutoffStr = cutoff.toISOString().slice(0, 16) + ':00';
    const startMinute = range?.startMinute || cutoffStr;
    const endMinute = range?.endMinute || this.toMinuteKey(new Date());

    // For bucketMinutes >= 60, use hourly_stats (60x fewer rows for 7-day queries)
    if (bucketMinutes >= 60) {
      const startHour = this.toHourKey(new Date(startMinute));
      const endHour = this.toHourKey(new Date(endMinute));

      if (bucketMinutes >= 1440) {
        if (tzOffsetMinutes !== 0) {
          // Shift to the caller's local day, truncate, then return its UTC start.
          const bucketExpr = `strftime('%Y-%m-%dT%H:%M:00', hour, @offset, 'start of day', @reverseOffset)`;
          const stmt = this.db.prepare(`
            SELECT
              ${bucketExpr} as time,
              SUM(upload) as upload,
              SUM(download) as download
            FROM hourly_stats
            WHERE backend_id = @backendId AND hour >= @startHour AND hour <= @endHour
            GROUP BY ${bucketExpr}
            ORDER BY time ASC
          `);
          return stmt.all({
            backendId,
            startHour,
            endHour,
            offset: `${tzOffsetMinutes} minutes`,
            reverseOffset: `${-tzOffsetMinutes} minutes`,
          }) as Array<{ time: string; upload: number; download: number }>;
        }

        // Daily bucket: group by date
        const stmt = this.db.prepare(`
          SELECT
            substr(hour, 1, 10) || 'T00:00:00' as time,
            SUM(upload) as upload,
            SUM(download) as download
          FROM hourly_stats
          WHERE backend_id = ? AND hour >= ? AND hour <= ?
          GROUP BY substr(hour, 1, 10)
          ORDER BY time ASC
        `);
        return stmt.all(backendId, startHour, endHour) as Array<{ time: string; upload: number; download: number }>;
      }

      if (bucketMinutes === 60) {
        // Hourly bucket: hourly_stats rows are already hourly
        const stmt = this.db.prepare(`
          SELECT hour as time, upload, download
          FROM hourly_stats
          WHERE backend_id = ? AND hour >= ? AND hour <= ?
          ORDER BY time ASC
        `);
        return stmt.all(backendId, startHour, endHour) as Array<{ time: string; upload: number; download: number }>;
      }

      // Other multiples of 60 (120, 180, etc.): bucket from hourly_stats
      const bucketSeconds = bucketMinutes * 60;
      const bucketExpr = `strftime('%Y-%m-%dT%H:%M:00', datetime((strftime('%s', datetime(hour)) / ${bucketSeconds}) * ${bucketSeconds}, 'unixepoch'))`;
      const stmt = this.db.prepare(`
        SELECT
          ${bucketExpr} as time,
          SUM(upload) as upload,
          SUM(download) as download
        FROM hourly_stats
        WHERE backend_id = ? AND hour >= ? AND hour <= ?
        GROUP BY ${bucketExpr}
        ORDER BY time ASC
      `);
      return stmt.all(backendId, startHour, endHour) as Array<{ time: string; upload: number; download: number }>;
    }

    // bucketMinutes < 60: use minute_stats
    if (bucketMinutes <= 1) {
      const stmt = this.db.prepare(`
        SELECT minute as time, upload, download
        FROM minute_stats
        WHERE backend_id = ? AND minute >= ? AND minute <= ?
        ORDER BY minute ASC
      `);
      return stmt.all(backendId, startMinute, endMinute) as Array<{ time: string; upload: number; download: number }>;
    }

    const bucketExpr = `strftime('%Y-%m-%dT%H:%M:00', datetime((strftime('%s', datetime(minute)) / ${bucketMinutes * 60}) * ${bucketMinutes * 60}, 'unixepoch'))`;
    const stmt = this.db.prepare(`
      SELECT
        ${bucketExpr} as time,
        SUM(upload) as upload,
        SUM(download) as download
      FROM minute_stats
      WHERE backend_id = ? AND minute >= ? AND minute <= ?
      GROUP BY ${bucketExpr}
      ORDER BY time ASC
    `);
    return stmt.all(backendId, startMinute, endMinute) as Array<{ time: string; upload: number; download: number }>;
  }
}
