import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProxyNameAlias } from '@neko-master/shared';
import { ClickHouseReader } from './clickhouse.reader.js';

describe('ClickHouse proxy name alias query routing', () => {
  const rules: ProxyNameAlias[] = [{ match: 'prefix', value: "🇺🇸 O'Hare - ", alias: "US_'%\\node" }];
  const fetchMock = vi.fn<typeof fetch>();
  const queries: string[] = [];
  const range = ['2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z'] as const;
  beforeEach(() => {
    vi.stubEnv('CH_ENABLED', '1');
    vi.stubEnv('STATS_QUERY_SOURCE', 'clickhouse');
    vi.stubGlobal('fetch', fetchMock);
    queries.length = 0;
    fetchMock.mockImplementation(async (_url, options) => {
      queries.push(String(options?.body));
      return Response.json({ data: [] });
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset(); });

  it('normalizes the source before grouping, filtering and LIMIT in rankings and details', async () => {
    const reader = new ClickHouseReader(id => id === 1 ? rules : []);
    await reader.getProxyStats(1, ...range);
    await reader.getGroupedDomains(1, ...range, 1, { chain: "US_'%\\node" });
    await reader.getGroupedIPs(1, ...range, 1, { chain: "US_'%\\node" });
    await reader.getGroupedProxyStats(1, ...range, { domain: 'example.com', sourceChain: "US_'%\\node" });
    for (const query of queries) {
      expect(query).toContain('SELECT * REPLACE');
      expect(query).toContain("startsWith(arrayElement(splitByString(' > ', chain), 1), '🇺🇸 O''Hare - ')");
      expect(query).toContain('WHERE backend_id = 1)');
    }
    expect(queries[1]).toContain("startsWith(chain, 'US_''%\\\\node > ')");
    expect(queries[1]).toContain('LIMIT 1');
    await reader.getProxyStats(2, ...range);
    expect(queries.at(-1)).not.toContain('SELECT * REPLACE');
  });

  it('reads changes immediately and keeps raw rule topology for gateway policy matching', async () => {
    let config = rules;
    const reader = new ClickHouseReader(() => config);
    await reader.getProxyStats(1, ...range);
    config = [];
    await reader.getProxyStats(1, ...range);
    expect(queries[0]).toContain('SELECT * REPLACE');
    expect(queries[1]).not.toContain('SELECT * REPLACE');
    config = rules;
    await reader.getRuleChainFlow(1, 'Policy', ...range);
    expect(queries.at(-1)).not.toContain('SELECT * REPLACE');
  });
});
