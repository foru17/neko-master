import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeGeoIP } from '@neko-master/shared';
import { createTestDatabase, createTestBackend } from '../../__tests__/helpers.js';
import type { StatsDatabase } from '../../modules/db/db.js';

describe('Repository geoIP arrays', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;

  beforeEach(() => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);

    db.saveIPGeolocation('8.8.8.8', {
      country: 'US',
      country_name: 'United States',
      city: '',
      asn: 'AS15169',
      as_name: 'Google LLC',
      as_domain: 'google.com',
      continent: 'NA',
      continent_name: 'North America',
    });
    db.batchUpdateTrafficStats(backendId, [{
      domain: 'example.com',
      ip: '8.8.8.8',
      chain: 'ProxyA',
      chains: ['ProxyA', 'RuleA'],
      rule: 'Match',
      rulePayload: '',
      upload: 100,
      download: 200,
      sourceIP: '192.168.1.10',
      timestampMs: Date.parse('2026-07-23T10:30:00Z'),
    }]);
  });

  afterEach(() => {
    cleanup();
  });

  describe.each([
    { range: 'all-time', start: undefined, end: undefined },
    { range: 'time-range', start: '2026-07-23T10:00:00Z', end: '2026-07-23T11:00:00Z' },
  ])('$range queries', ({ start, end }) => {
    it.each([
      ['rule', () => db.repos.rule.getRuleIPs(backendId, 'RuleA', 10, start, end)],
      ['proxy', () => db.repos.proxy.getProxyIPs(backendId, 'ProxyA', 10, start, end)],
      ['device', () => db.repos.device.getDeviceIPs(backendId, '192.168.1.10', 10, start, end)],
    ] as const)('preserves an empty city in %s IP geo data', (_name, query) => {
      // Query repositories directly: the StatsDatabase facade normalizes arrays into objects.
      const rows = query();
      expect(rows).toHaveLength(1);
      expect(rows[0].ip).toBe('8.8.8.8');

      const { geoIP } = rows[0];
      expect(geoIP).toHaveLength(4);
      expect(geoIP).toEqual(['US', 'United States', '', 'Google LLC']);
      expect(normalizeGeoIP(geoIP)).toEqual({
        countryCode: 'US',
        countryName: 'United States',
        city: '',
        asOrganization: 'Google LLC',
      });
    });
  });
});
