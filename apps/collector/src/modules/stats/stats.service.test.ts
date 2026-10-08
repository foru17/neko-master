import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase, createTestBackend } from '../../__tests__/helpers.js';
import { StatsService } from './stats.service.js';
import { realtimeStore } from '../realtime/realtime.store.js';
import type { StatsDatabase } from '../db/db.js';
import { ClickHouseReader } from '../clickhouse/clickhouse.reader.js';

describe('StatsService', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;
  let service: StatsService;

  beforeEach(() => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
    service = new StatsService(db, realtimeStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    realtimeStore.clearBackend(backendId);
    cleanup();
  });

  function seedTraffic() {
    db.batchUpdateTrafficStats(backendId, [
      {
        domain: 'google.com',
        ip: '142.250.80.46',
        chain: 'ProxyUS',
        chains: ['ProxyUS', 'GeoIP'],
        rule: 'DOMAIN-SUFFIX',
        rulePayload: 'google.com',
        upload: 500,
        download: 3000,
        sourceIP: '192.168.1.10',
        timestampMs: Date.now(),
      },
      {
        domain: 'github.com',
        ip: '140.82.121.3',
        chain: 'ProxyUS',
        chains: ['ProxyUS', 'GeoIP'],
        rule: 'DOMAIN-SUFFIX',
        rulePayload: 'github.com',
        upload: 200,
        download: 1500,
        sourceIP: '192.168.1.10',
        timestampMs: Date.now(),
      },
      {
        domain: 'baidu.com',
        ip: '39.156.66.10',
        chain: 'DIRECT',
        chains: ['DIRECT'],
        rule: 'Match',
        rulePayload: '',
        upload: 100,
        download: 800,
        sourceIP: '192.168.1.20',
        timestampMs: Date.now(),
      },
    ]);
  }

  describe('resolveBackendId', () => {
    it('should return active backend when no ID specified', () => {
      const id = service.resolveBackendId();
      expect(id).toBe(backendId);
    });

    it('should parse string backend ID', () => {
      const id = service.resolveBackendId(String(backendId));
      expect(id).toBe(backendId);
    });

    it('should return null for invalid ID', () => {
      expect(service.resolveBackendId('abc')).toBeNull();
    });
  });

  describe('getSummary', () => {
    it('should return correct totals', () => {
      seedTraffic();

      const result = service.getSummary(backendId, { active: false });
      expect(result.totalUpload).toBe(800);
      expect(result.totalDownload).toBe(5300);
      expect(result.totalDomains).toBe(3);
      expect(result.totalIPs).toBe(3);
      expect(result.backend.id).toBe(backendId);
    });

    it('should return empty summary for non-existent backend', () => {
      expect(() => service.getSummary(99999, { active: false })).toThrow('Backend not found');
    });
  });

  describe('getDomainStatsPaginated', () => {
    it('should return paginated results', () => {
      seedTraffic();

      const result = service.getDomainStatsPaginated(backendId, { active: false }, {
        offset: 0,
        limit: 2,
        sortBy: 'totalDownload',
        sortOrder: 'desc',
      });

      expect(result.data.length).toBeLessThanOrEqual(2);
      expect(result.total).toBe(3);
      // Should be sorted by download desc
      if (result.data.length >= 2) {
        expect(result.data[0].totalDownload).toBeGreaterThanOrEqual(result.data[1].totalDownload);
      }
    });

    it('should support search', () => {
      seedTraffic();

      const result = service.getDomainStatsPaginated(backendId, { active: false }, {
        offset: 0,
        limit: 10,
        search: 'google',
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0].domain).toBe('google.com');
    });
  });

  describe('getProxyStats', () => {
    it('should return proxy stats grouped by chain', () => {
      seedTraffic();

      const proxies = service.getProxyStats(backendId, { active: false });
      expect(proxies.length).toBeGreaterThanOrEqual(1);
      const proxyNames = proxies.map(p => p.chain);
      expect(proxyNames).toContain('DIRECT');
    });
  });

  describe('getDeviceStats', () => {
    it('should return device stats with source IPs', () => {
      seedTraffic();

      const devices = service.getDeviceStats(backendId, { active: false }, 10);
      expect(devices.length).toBe(2);
      const ips = devices.map(d => d.sourceIP).sort();
      expect(ips).toEqual(['192.168.1.10', '192.168.1.20']);
    });
  });

  describe('getAllRuleChainFlows', () => {
    it('should handle node names containing "|" in chain flow links', () => {
      db.batchUpdateTrafficStats(backendId, [
        {
          domain: 'video.example.com',
          ip: '203.0.113.10',
          chain: 'JP-Sakura|IEPL',
          chains: ['JP-Sakura|IEPL', 'Manual|Select', 'YouTube|Media'],
          rule: 'RULE-SET',
          rulePayload: 'YouTube',
          upload: 123,
          download: 456,
          sourceIP: '192.168.1.88',
          timestampMs: Date.now(),
        },
      ]);

      const result = service.getAllRuleChainFlows(backendId, { active: false });

      expect(result.nodes.some((node: { name: string }) => node.name === 'YouTube|Media')).toBe(true);
      expect(result.links.length).toBeGreaterThan(0);
      for (const link of result.links) {
        expect(result.nodes[link.source]).toBeDefined();
        expect(result.nodes[link.target]).toBeDefined();
      }
      expect(result.rulePaths['YouTube|Media']).toBeDefined();
      expect(result.rulePaths['YouTube|Media'].linkIndices.length).toBeGreaterThan(0);
    });
  });

  describe('shouldIncludeRealtime', () => {
    it('should return true when no time range is active', () => {
      expect(service.shouldIncludeRealtime({ active: false })).toBe(true);
    });

    it('should return true when end is close to now', () => {
      const now = new Date();
      expect(service.shouldIncludeRealtime({
        active: true,
        start: new Date(now.getTime() - 3600000).toISOString(),
        end: now.toISOString(),
      })).toBe(true);
    });

    it('should return false when end is far in the past', () => {
      expect(service.shouldIncludeRealtime({
        active: true,
        start: '2020-01-01T00:00:00Z',
        end: '2020-01-02T00:00:00Z',
      })).toBe(false);
    });
  });

  describe('daily trend timezone routing', () => {
    it.each(['sqlite', 'clickhouse', 'unrouted'] as const)(
      'merges persisted and realtime data in the same local day through %s',
      async (source) => {
        const nowMs = Date.parse('2026-10-09T12:00:00Z');
        vi.spyOn(Date, 'now').mockReturnValue(nowMs);
        vi.spyOn(ClickHouseReader.prototype, 'shouldUseForRange')
          .mockReturnValue(source === 'clickhouse');
        const chTrend = vi.spyOn(ClickHouseReader.prototype, 'getTrafficTrendAggregated')
          .mockResolvedValue([{ time: '2026-10-08T16:00:00', upload: 3, download: 4 }]);
        db.batchUpdateTrafficStats(backendId, [{
          domain: 'example.com',
          ip: '203.0.113.1',
          chain: 'DIRECT',
          chains: ['DIRECT'],
          rule: 'Match',
          rulePayload: '',
          upload: 3,
          download: 4,
          timestampMs: Date.parse('2026-10-08T19:00:00Z'),
        }]);
        realtimeStore.minuteByBackend.set(backendId, new Map([
          ['2026-10-08T20:00:00', { upload: 5, download: 6, lastUpdated: nowMs }],
        ]));
        const range = { active: true, start: '2026-10-08T00:00:00Z', end: '2026-10-09T12:00:00Z' };

        const result = source === 'unrouted'
          ? service.getTrafficTrendAggregated(backendId, range, 1440, 1440, 480)
          : await service.getTrafficTrendAggregatedWithRouting(backendId, range, 1440, 1440, 480);

        expect(result).toEqual([{ time: '2026-10-08T16:00:00', upload: 8, download: 10 }]);
        if (source === 'clickhouse') {
          expect(chTrend).toHaveBeenCalledWith(backendId, 1440, range.start, range.end, 480);
        } else {
          expect(chTrend).not.toHaveBeenCalled();
        }
      },
    );
  });

  describe('strict mode routing', () => {
    it('should use clickhouse for aggregated trend when range is inactive', async () => {
      const prevStrict = process.env.CH_STRICT_STATS;
      process.env.CH_STRICT_STATS = '1';

      try {
        const strictService = new StatsService(db, realtimeStore) as any;
        strictService.clickHouseReader = {
          shouldUse: () => true,
          shouldUseForRange: () => true,
          getTrafficTrendAggregated: async (
            _backendId: number,
            _bucketMinutes: number,
            start: string,
            end: string,
          ) => ([
            { time: start, upload: 1, download: 2 },
            { time: end, upload: 3, download: 4 },
          ]),
        };

        const result = await strictService.getTrafficTrendAggregatedWithRouting(
          backendId,
          { active: false },
          30,
          1,
        );

        expect(result.length).toBeGreaterThan(0);
      } finally {
        if (prevStrict === undefined) {
          delete process.env.CH_STRICT_STATS;
        } else {
          process.env.CH_STRICT_STATS = prevStrict;
        }
      }
    });
  });

  describe('summary routing consistency', () => {
    it('should fallback the whole summary response to sqlite when clickhouse results are partial', async () => {
      seedTraffic();

      const now = Date.now();
      const partialService = new StatsService(db, realtimeStore) as any;
      partialService.clickHouseReader = {
        shouldUseForRange: () => true,
        getSummary: async () => ({
          totalConnections: 999999,
          totalUpload: 999999,
          totalDownload: 999999,
          uniqueDomains: 999999,
          uniqueIPs: 999999,
        }),
        getTopDomainsLight: async () => null,
        getTopIPsLight: async () => [],
        getProxyStats: async () => [],
        getRuleStats: async () => [],
        getHourlyStats: async () => [],
        getTrafficInRange: async () => ({ upload: 999999, download: 999999 }),
      };

      const result = await partialService.getSummaryWithRouting(backendId, {
        active: true,
        start: new Date(now - 60_000).toISOString(),
        end: new Date(now + 60_000).toISOString(),
      });

      expect(result.totalUpload).toBe(800);
      expect(result.totalDownload).toBe(5300);
      expect(result.totalDomains).toBe(3);
      expect(result.totalIPs).toBe(3);
    });
  });

  describe('populateGeoIPs with ClickHouse routing', () => {
    it('should correctly populate geoIP data when routing results through ClickHouse', async () => {
      // Seed geoip cache in SQLite
      db.saveIPGeolocation('142.250.80.46', {
        country: 'US',
        country_name: 'United States',
        city: 'Mountain View',
        asn: 'AS15169',
        as_name: 'Google LLC',
        as_domain: 'google.com',
        continent: 'NA',
        continent_name: 'North America',
      });

      const now = Date.now();
      const chService = new StatsService(db, realtimeStore) as any;
      chService.clickHouseReader = {
        shouldUse: () => true,
        shouldUseForRange: () => true,
        getGroupedIPs: async () => ([
          {
            ip: '142.250.80.46',
            domains: ['google.com'],
            totalUpload: 500,
            totalDownload: 3000,
            totalConnections: 1,
            lastSeen: new Date(now).toISOString(),
            chains: ['ProxyUS'],
            // ClickHouse does not return geoIP or asn
          }
        ]),
      };

      const result = await chService.getRuleIPsWithRouting(
        backendId,
        'DOMAIN-SUFFIX',
        { active: true, start: new Date(now - 60000).toISOString(), end: new Date(now + 60000).toISOString() },
        10
      );

      expect(result.length).toBe(1);
      expect(result[0].ip).toBe('142.250.80.46');
      expect(result[0].geoIP).toBeDefined();
      expect(result[0].geoIP.countryCode).toBe('US');
      expect(result[0].geoIP.countryName).toBe('United States');
      expect(result[0].asn).toBe('AS15169');
    });
  });
});
