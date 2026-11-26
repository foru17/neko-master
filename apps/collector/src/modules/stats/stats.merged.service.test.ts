import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase, createTestBackend } from '../../__tests__/helpers.js';
import { MERGED_BACKEND_ID } from '@neko-master/shared';
import { createApp } from '../app/app.js';
import { ClickHouseReader } from '../clickhouse/clickhouse.reader.js';
import { StatsService } from './stats.service.js';
import { MergedAwareStatsService, MERGED_PAGE_SCAN_MAX_ROWS } from './stats.merged.service.js';
import { realtimeStore } from '../realtime/realtime.store.js';
import type { StatsDatabase } from '../db/db.js';

const ALL_TIME = { active: false };
const MERGED = MERGED_BACKEND_ID;

describe('MergedAwareStatsService', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendA: number;
  let backendB: number;
  let service: MergedAwareStatsService;

  beforeEach(() => {
    ({ db, cleanup } = createTestDatabase());
    backendA = createTestBackend(db, 'alpha', 'http://127.0.0.1:9091');
    backendB = createTestBackend(db, 'beta', 'http://127.0.0.1:9092');
    service = new MergedAwareStatsService(db, realtimeStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    realtimeStore.clearBackend(backendA);
    realtimeStore.clearBackend(backendB);
    cleanup();
  });

  function traffic(domain: string, ip: string, chains: string[], rule: string, upload: number, download: number) {
    return { domain, ip, chain: chains[0], chains, rule, rulePayload: domain, upload, download, sourceIP: '192.168.1.10', timestampMs: Date.now() };
  }

  // Both backends share shared.com; the rest is unique to one backend.
  function seed() {
    db.batchUpdateTrafficStats(backendA, [
      traffic('shared.com', '1.1.1.1', ['ProxyUS', 'Final'], 'DOMAIN-SUFFIX', 100, 1000),
      traffic('only-a.com', '2.2.2.2', ['DIRECT'], 'Match', 10, 300),
      traffic('tiny-a.com', '3.3.3.3', ['ProxyUS', 'Final'], 'DOMAIN-SUFFIX', 1, 50),
    ]);
    db.batchUpdateTrafficStats(backendB, [
      traffic('shared.com', '1.1.1.1', ['ProxyUS', 'Final'], 'DOMAIN-SUFFIX', 200, 2000),
      traffic('only-b.com', '4.4.4.4', ['DIRECT'], 'Match', 20, 500),
      traffic('big-b.com', '5.5.5.5', ['ProxyHK', 'Final'], 'DOMAIN-SUFFIX', 5, 9000),
    ]);
  }

  const sum = (rows: Array<{ totalUpload: number; totalDownload: number }>, field: 'totalUpload' | 'totalDownload') =>
    rows.reduce((total, row) => total + row[field], 0);

  describe('resolveBackendId', () => {
    it('reserves -1 for the merged view and leaves everything else alone', () => {
      expect(service.resolveBackendId(String(MERGED))).toBe(MERGED);
      expect(service.resolveBackendId(String(backendA))).toBe(backendA);
      expect(service.resolveBackendId('abc')).toBeNull();
      expect(service.resolveBackendId()).toBe(backendB);
    });
  });

  describe('getSummaryWithRouting', () => {
    it('sums the member totals and counts a shared domain or IP once', async () => {
      seed();
      const [alpha, beta] = await Promise.all([
        service.getSummaryWithRouting(backendA, ALL_TIME),
        service.getSummaryWithRouting(backendB, ALL_TIME),
      ]);

      const merged = await service.getSummaryWithRouting(MERGED, ALL_TIME);

      expect(merged.totalUpload).toBe(alpha.totalUpload + beta.totalUpload);
      expect(merged.totalDownload).toBe(alpha.totalDownload + beta.totalDownload);
      expect(merged.totalDomains).toBe(5);
      expect(alpha.totalDomains + beta.totalDomains).toBe(6);
      expect(merged.totalIPs).toBe(5);
      expect(merged.backend.id).toBe(MERGED);
    });

    it('combines the top lists across backends and sorts them by traffic', async () => {
      seed();
      const merged = await service.getSummaryWithRouting(MERGED, ALL_TIME);

      expect(merged.topDomains.map((row) => row.domain)).toEqual(['big-b.com', 'shared.com', 'only-b.com', 'only-a.com', 'tiny-a.com']);
      expect(merged.topDomains[1]).toMatchObject({ totalUpload: 300, totalDownload: 3000 });
      expect(merged.topIPs.map((row) => row.ip)).toEqual(['5.5.5.5', '1.1.1.1', '4.4.4.4', '2.2.2.2', '3.3.3.3']);
    });

    it('sums same-named devices and derives the proxy and rule counts from the merged lists', async () => {
      seed();
      const merged = await service.getSummaryWithRouting(MERGED, ALL_TIME);

      // Every row used 192.168.1.10, on both backends.
      expect(merged.topIPs.length).toBeGreaterThan(0);
      const devices = await service.getDeviceStatsWithRouting(MERGED, ALL_TIME, 50);
      expect(devices.map((device) => device.sourceIP)).toEqual(['192.168.1.10']);
      expect(devices[0].totalDownload).toBe(12850);
      expect(merged.totalProxies).toBe(merged.proxyStats.length);
      expect(merged.totalRules).toBe(merged.ruleStats.length);
      expect(sum(merged.proxyStats, 'totalDownload')).toBe(12850);
      expect(sum(merged.ruleStats, 'totalDownload')).toBe(12850);
    });

    it('returns zeros when no backend is collecting', async () => {
      seed();
      db.setBackendListening(backendA, false);
      db.setBackendListening(backendB, false);

      const merged = await service.getSummaryWithRouting(MERGED, ALL_TIME);

      expect(merged).toMatchObject({ totalUpload: 0, totalDownload: 0, totalConnections: 0, totalDomains: 0, totalIPs: 0, totalProxies: 0, totalRules: 0 });
      expect(merged.topDomains).toEqual([]);
      expect(merged.proxyStats).toEqual([]);
    });

    it('only includes backends that are collecting', async () => {
      seed();
      db.setBackendListening(backendB, false);

      const merged = await service.getSummaryWithRouting(MERGED, ALL_TIME);

      expect(merged.totalUpload).toBe(111);
      expect(merged.totalDownload).toBe(1350);
      expect(merged.totalDomains).toBe(3);
    });

    it('skips a member that disappears between listing and querying', async () => {
      seed();
      const listening = db.getListeningBackends();
      vi.spyOn(db, 'getListeningBackends').mockReturnValue([...listening, { ...listening[0], id: 99999 }]);

      const merged = await new MergedAwareStatsService(db, realtimeStore).getSummaryWithRouting(MERGED, ALL_TIME);

      expect(merged.totalUpload).toBe(336);
      expect(merged.totalDomains).toBe(5);
    });
  });

  describe('single-backend requests', () => {
    it('behave exactly like the base service', async () => {
      seed();
      const base = new StatsService(db, realtimeStore);

      await expect(service.getSummaryWithRouting(backendA, ALL_TIME)).resolves.toEqual(await base.getSummaryWithRouting(backendA, ALL_TIME));
      await expect(service.getProxyStatsWithRouting(backendB, ALL_TIME)).resolves.toEqual(await base.getProxyStatsWithRouting(backendB, ALL_TIME));
      await expect(service.getTrafficTrendAggregatedWithRouting(backendA, ALL_TIME, 30, 1)).resolves.toEqual(
        await base.getTrafficTrendAggregatedWithRouting(backendA, ALL_TIME, 30, 1),
      );
    });

    it('still reject an unknown backend', async () => {
      await expect(service.getSummaryWithRouting(99999, ALL_TIME)).rejects.toThrow('Backend not found');
    });
  });

  describe('paged tables', () => {
    it('orders rows across backends and slices the requested page', async () => {
      seed();

      const first = await service.getDomainStatsPaginatedWithRouting(MERGED, ALL_TIME, { offset: 0, limit: 2 });
      const second = await service.getDomainStatsPaginatedWithRouting(MERGED, ALL_TIME, { offset: 2, limit: 2 });
      const last = await service.getDomainStatsPaginatedWithRouting(MERGED, ALL_TIME, { offset: 4, limit: 2 });

      expect(first.total).toBe(5);
      expect(first.data.map((row) => row.domain)).toEqual(['big-b.com', 'shared.com']);
      expect(second.data.map((row) => row.domain)).toEqual(['only-b.com', 'only-a.com']);
      expect(last.data.map((row) => row.domain)).toEqual(['tiny-a.com']);
    });

    it('applies the requested sort and search', async () => {
      seed();

      const byUpload = await service.getDomainStatsPaginatedWithRouting(MERGED, ALL_TIME, { offset: 0, limit: 10, sortBy: 'totalUpload', sortOrder: 'desc' });
      expect(byUpload.data.map((row) => row.domain)).toEqual(['shared.com', 'only-b.com', 'only-a.com', 'big-b.com', 'tiny-a.com']);

      const searched = await service.getDomainStatsPaginatedWithRouting(MERGED, ALL_TIME, { offset: 0, limit: 10, search: 'only' });
      expect(searched.data.map((row) => row.domain)).toEqual(['only-b.com', 'only-a.com']);
      expect(searched.total).toBe(2);

      const ips = await service.getIPStatsPaginatedWithRouting(MERGED, ALL_TIME, { offset: 0, limit: 10 });
      expect(ips.total).toBe(5);
      expect(ips.data[0]).toMatchObject({ ip: '5.5.5.5', totalDownload: 9000 });
    });

    it('finds a row whose shares are small in every backend but add up', async () => {
      // split.com ranks below 12 filler rows on each backend, yet its combined
      // traffic beats every filler row.
      const filler = (prefix: string) =>
        Array.from({ length: 12 }, (_, i) => traffic(`${prefix}${i}.com`, `10.0.0.${i + 1}`, ['DIRECT'], 'Match', 1, 150));
      db.batchUpdateTrafficStats(backendA, [traffic('split.com', '9.9.9.9', ['DIRECT'], 'Match', 1, 100), ...filler('a')]);
      db.batchUpdateTrafficStats(backendB, [traffic('split.com', '9.9.9.9', ['DIRECT'], 'Match', 1, 100), ...filler('b')]);

      const page = await service.getDomainStatsPaginatedWithRouting(MERGED, ALL_TIME, { offset: 0, limit: 10 });
      const summary = await service.getSummaryWithRouting(MERGED, ALL_TIME);

      expect(page.data[0]).toMatchObject({ domain: 'split.com', totalDownload: 200 });
      expect(page.total).toBe(25);
      expect(summary.topDomains[0]).toMatchObject({ domain: 'split.com', totalDownload: 200 });
    });

    it('returns an empty page past the scan limit but still reports the total', async () => {
      seed();

      const page = await service.getDomainStatsPaginatedWithRouting(MERGED, ALL_TIME, { offset: MERGED_PAGE_SCAN_MAX_ROWS, limit: 10 });

      expect(page).toEqual({ data: [], total: 5 });
    });

    it('reads drill-downs wider than the limit so the combined top rows are complete', async () => {
      // 9.9.9.8 ranks below 12 other addresses of the domain on each backend,
      // yet its combined traffic beats every one of them.
      const detail = (ip: string, download: number) => traffic('split.net', ip, ['DIRECT'], 'Match', 1, download);
      const filler = (octet: number) =>
        Array.from({ length: 12 }, (_, i) => detail(`10.${octet}.0.${i + 1}`, 150));
      db.batchUpdateTrafficStats(backendA, [detail('9.9.9.8', 100), ...filler(1)]);
      db.batchUpdateTrafficStats(backendB, [detail('9.9.9.8', 100), ...filler(2)]);

      const rows = await service.getDomainIPDetailsWithRouting(MERGED, 'split.net', ALL_TIME, 10);

      expect(rows).toHaveLength(10);
      expect(rows[0]).toMatchObject({ ip: '9.9.9.8', totalDownload: 200 });
    });
  });

  describe('realtime deltas', () => {
    it('fold every member backend\'s unflushed traffic into the merged result', async () => {
      const nowMs = Date.now();
      const minuteKey = new Date(nowMs).toISOString().slice(0, 16) + ':00';
      realtimeStore.summaryByBackend.set(backendA, { upload: 10, download: 20, connections: 1, lastUpdated: nowMs });
      realtimeStore.summaryByBackend.set(backendB, { upload: 30, download: 40, connections: 2, lastUpdated: nowMs });
      realtimeStore.minuteByBackend.set(backendA, new Map([[minuteKey, { upload: 10, download: 20, lastUpdated: nowMs }]]));
      realtimeStore.minuteByBackend.set(backendB, new Map([[minuteKey, { upload: 30, download: 40, lastUpdated: nowMs }]]));
      realtimeStore.proxyByBackend.set(backendA, new Map([['DIRECT', { chain: 'DIRECT', totalUpload: 1, totalDownload: 2, totalConnections: 1, lastSeen: '' }]]));
      realtimeStore.proxyByBackend.set(backendB, new Map([['DIRECT', { chain: 'DIRECT', totalUpload: 3, totalDownload: 4, totalConnections: 1, lastSeen: '' }]]));
      realtimeStore.ruleByBackend.set(backendA, new Map([['PROXY', { rule: 'PROXY', finalProxy: 'HK', totalUpload: 1, totalDownload: 1, totalConnections: 1, lastSeen: '' }]]));
      realtimeStore.ruleByBackend.set(backendB, new Map([['PROXY', { rule: 'PROXY', finalProxy: '', totalUpload: 2, totalDownload: 2, totalConnections: 1, lastSeen: '' }]]));
      realtimeStore.countryByBackend.set(backendA, new Map([['US', { country: 'US', countryName: 'United States', continent: 'Americas', totalUpload: 5, totalDownload: 6, totalConnections: 1, lastSeen: '' }]]));
      realtimeStore.countryByBackend.set(backendB, new Map([['US', { country: 'US', countryName: 'United States', continent: 'Americas', totalUpload: 7, totalDownload: 8, totalConnections: 1, lastSeen: '' }]]));

      const merged = await service.getSummaryWithRouting(MERGED, ALL_TIME);

      expect(merged).toMatchObject({ totalUpload: 40, totalDownload: 60, totalConnections: 3, todayUpload: 40, todayDownload: 60 });
      expect(merged.proxyStats).toEqual([{ chain: 'DIRECT', totalUpload: 4, totalDownload: 6, totalConnections: 2, lastSeen: '' }]);
      expect(merged.ruleStats).toEqual([{ rule: 'PROXY', finalProxy: 'HK', totalUpload: 3, totalDownload: 3, totalConnections: 2, lastSeen: '' }]);
      expect(await service.getCountryStatsWithRouting(MERGED, ALL_TIME, 50)).toEqual([
        { country: 'US', countryName: 'United States', continent: 'Americas', totalUpload: 12, totalDownload: 14, totalConnections: 2, lastSeen: '' },
      ]);

      const range = { start: new Date(nowMs - 3_600_000).toISOString(), end: new Date(nowMs + 3_600_000).toISOString(), active: true };
      const trend = await service.getTrafficTrendAggregatedWithRouting(MERGED, range, 30, 1);
      expect(trend.find((point) => point.time === minuteKey)).toMatchObject({ upload: 40, download: 60 });
    });
  });

  describe('rule chain graph', () => {
    it('contains every member chain and keeps the leaf traffic of both backends', async () => {
      seed();
      const [alpha, beta] = await Promise.all([
        service.getAllRuleChainFlowsWithRouting(backendA, ALL_TIME),
        service.getAllRuleChainFlowsWithRouting(backendB, ALL_TIME),
      ]);
      const merged = await service.getAllRuleChainFlowsWithRouting(MERGED, ALL_TIME);

      const names = new Set(merged.nodes.map((node) => node.name));
      for (const flow of [alpha, beta]) {
        for (const node of flow.nodes) expect(names.has(node.name)).toBe(true);
      }
      for (const link of merged.links) {
        expect(merged.nodes[link.source]).toBeDefined();
        expect(merged.nodes[link.target]).toBeDefined();
      }

      const leafDownload = (flow: typeof merged) =>
        flow.nodes.filter((node) => node.nodeType === 'proxy').reduce((total, node) => total + node.totalDownload, 0);
      expect(leafDownload(merged)).toBe(leafDownload(alpha) + leafDownload(beta));
      expect(Object.keys(merged.rulePaths).length).toBeGreaterThanOrEqual(Math.max(Object.keys(alpha.rulePaths).length, Object.keys(beta.rulePaths).length));
    });
  });

  describe('distinct counts across backends', () => {
    it('route through ClickHouse and fall back to SQLite per kind', async () => {
      seed();
      const reader = ClickHouseReader.prototype;
      const range = { start: new Date(Date.now() - 3_600_000).toISOString(), end: new Date(Date.now() + 3_600_000).toISOString(), active: true };
      vi.spyOn(reader, 'shouldUseForRange').mockReturnValue(true);
      // No ClickHouse rows in this test: the per-backend data keeps coming from SQLite.
      vi.spyOn(reader, 'getDomainStatsPaginated').mockResolvedValue(null);
      vi.spyOn(reader, 'getIPStatsPaginated').mockResolvedValue(null);
      vi.spyOn(reader, 'getSummary').mockResolvedValue(null);
      vi.spyOn(reader, 'getTopDomainsLight').mockResolvedValue(null);
      vi.spyOn(reader, 'getTopIPsLight').mockResolvedValue(null);
      vi.spyOn(reader, 'getProxyStats').mockResolvedValue(null);
      vi.spyOn(reader, 'getRuleStats').mockResolvedValue(null);
      vi.spyOn(reader, 'getHourlyStats').mockResolvedValue(null);
      vi.spyOn(reader, 'getTrafficInRange').mockResolvedValue(null);
      const domainCount = vi.spyOn(reader, 'countDomainsAcrossBackends').mockResolvedValue(42);
      const ipCount = vi.spyOn(reader, 'countIPsAcrossBackends').mockResolvedValue(7);

      // A domains page only needs the domain count.
      const page = await service.getDomainStatsPaginatedWithRouting(MERGED, range, { offset: 0, limit: 10 });
      expect(page.total).toBe(42);
      expect(domainCount).toHaveBeenCalledTimes(1);
      expect(ipCount).not.toHaveBeenCalled();

      // The summary needs both; a missing ClickHouse domain count falls back to
      // SQLite while the IP count still comes from ClickHouse.
      domainCount.mockResolvedValue(null);
      const summary = await service.getSummaryWithRouting(MERGED, range);
      expect(summary.totalDomains).toBe(5);
      expect(summary.totalIPs).toBe(7);
    });

    it('refuse a SQLite fallback for merged counts under CH_STRICT_STATS=1', async () => {
      seed();
      const reader = ClickHouseReader.prototype;
      const previousStrict = process.env.CH_STRICT_STATS;
      process.env.CH_STRICT_STATS = '1';
      const range = { start: new Date(Date.now() - 3_600_000).toISOString(), end: new Date(Date.now() + 3_600_000).toISOString(), active: true };

      try {
        vi.spyOn(reader, 'shouldUse').mockReturnValue(true);
        vi.spyOn(reader, 'shouldUseForRange').mockReturnValue(true);
        // The per-backend pages come from ClickHouse; only the count is missing there.
        vi.spyOn(reader, 'getDomainStatsPaginated').mockResolvedValue({ data: [], total: 0 });
        vi.spyOn(reader, 'countDomainsAcrossBackends').mockResolvedValue(null);

        const strictService = new MergedAwareStatsService(db, realtimeStore);
        await expect(strictService.getDomainStatsPaginatedWithRouting(MERGED, range, { offset: 0, limit: 10 })).rejects.toThrow('route=merged.count.domains');
      } finally {
        if (previousStrict === undefined) delete process.env.CH_STRICT_STATS;
        else process.env.CH_STRICT_STATS = previousStrict;
      }
    });

    it('count a key seen on several backends once, with and without a time range', () => {
      seed();
      const [a, b] = [backendA, backendB];

      expect(db.countDomainsAcrossBackends([a, b])).toBe(5);
      expect(db.countDomainsAcrossBackends([a, b], { search: 'shared' })).toBe(1);
      expect(db.countDomainsAcrossBackends([a])).toBe(3);
      expect(db.countDomainsAcrossBackends([])).toBe(0);
      expect(db.countIPsAcrossBackends([a, b])).toBe(5);
      expect(db.countIPsAcrossBackends([a, b], { search: '1.1.1.1' })).toBe(1);
      expect(db.countIPsAcrossBackends([a, b], { search: 'shared' })).toBe(1);

      const covering = { start: new Date(Date.now() - 3_600_000).toISOString(), end: new Date(Date.now() + 3_600_000).toISOString() };
      expect(db.countDomainsAcrossBackends([a, b], covering)).toBe(5);
      expect(db.countIPsAcrossBackends([a, b], covering)).toBe(5);
      expect(db.countDomainsAcrossBackends([a, b], { ...covering, search: 'only-b' })).toBe(1);

      const past = { start: '2001-01-01T00:00:00.000Z', end: '2001-01-02T00:00:00.000Z' };
      expect(db.countDomainsAcrossBackends([a, b], past)).toBe(0);
    });

    it('cache merged counts per range and drop them when any member flushes', () => {
      seed();
      const range = { start: new Date(Date.now() - 3_600_000).toISOString(), end: new Date(Date.now() + 3_600_000).toISOString() };

      expect(db.countDomainsAcrossBackends([backendA, backendB], range)).toBe(5);

      // Rows written after the count are not visible until a flush clears the cache.
      db.batchUpdateTrafficStats(backendB, [traffic('late.com', '6.6.6.6', ['DIRECT'], 'Match', 1, 1)]);
      expect(db.countDomainsAcrossBackends([backendA, backendB], range)).toBe(5);

      // A flush of backend A must also stale the counts that include backend B.
      db.clearRangeQueryCache(backendA);
      expect(db.countDomainsAcrossBackends([backendA, backendB], range)).toBe(6);
      expect(db.countIPsAcrossBackends([backendA, backendB], range)).toBe(6);
    });
  });

  describe('HTTP routes', () => {
    it('serve the merged view for backendId=-1', async () => {
      seed();
      const app = await createApp({ port: 0, db, realtimeStore, logger: false, autoListen: false });

      try {
        const summary = await app.inject({ method: 'GET', url: `/api/stats/summary?backendId=${MERGED}` });
        expect(summary.statusCode).toBe(200);
        expect(summary.json()).toMatchObject({ totalUpload: 336, totalDownload: 12850, totalDomains: 5, totalIPs: 5 });

        const page = await app.inject({ method: 'GET', url: `/api/stats/domains?backendId=${MERGED}&limit=2` });
        expect(page.statusCode).toBe(200);
        expect(page.json()).toMatchObject({ total: 5 });
        expect((page.json().data as Array<{ domain: string }>).map((row) => row.domain)).toEqual(['big-b.com', 'shared.com']);

        // A normal backend is still answered on its own.
        const single = await app.inject({ method: 'GET', url: `/api/stats/summary?backendId=${backendA}` });
        expect(single.json()).toMatchObject({ totalUpload: 111, totalDomains: 3 });
      } finally {
        await app.close();
      }
    });
  });
});
