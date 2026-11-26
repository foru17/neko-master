import { describe, expect, it } from 'vitest';
import {
  comparePageRows,
  mergeCountryRows,
  mergeDeviceRows,
  mergeDomainRows,
  mergeHourlyStats,
  mergeIPRows,
  mergeProxyRows,
  mergeProxyTrafficRows,
  mergeRuleChainFlow,
  mergeRuleChainFlowAll,
  mergeRuleProxyMaps,
  mergeRuleRows,
  mergeTrendPoints,
  mergeTrafficRows,
  unionStrings,
} from './stats.merge.js';
import type { RuleChainFlowAll } from '@neko-master/shared';

function domain(name: string, upload: number, download: number, connections: number, lastSeen = '2026-01-01T00:00:00') {
  return { domain: name, ips: [], totalUpload: upload, totalDownload: download, totalConnections: connections, lastSeen, rules: [], chains: [] };
}

describe('unionStrings', () => {
  it('deduplicates and keeps first-seen order', () => {
    expect(unionStrings([['a', 'b'], ['b', 'c'], ['a', 'd']])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('caps the union at the floor', () => {
    const many = Array.from({ length: 80 }, (_, i) => `v${i}`);
    expect(unionStrings([many.slice(0, 40), many.slice(30)])).toHaveLength(50);
  });

  it('never cuts below the longest list a single backend already carried', () => {
    const many = Array.from({ length: 80 }, (_, i) => `v${i}`);
    expect(unionStrings([many])).toEqual(many);
  });

  it('skips empty values', () => {
    expect(unionStrings([['', 'a'], ['']])).toEqual(['a']);
  });
});

describe('mergeTrafficRows', () => {
  it('sums counters, keeps the latest lastSeen and preserves first-seen order', () => {
    const a = domain('a.com', 1, 2, 3, '2026-01-02T00:00:00');
    const b = domain('b.com', 10, 20, 30, '2026-01-01T00:00:00');

    const merged = mergeTrafficRows(
      [[a], [domain('a.com', 5, 6, 7, '2026-01-03T00:00:00'), b]],
      (row) => row.domain,
    );

    expect(merged.map((row) => row.domain)).toEqual(['a.com', 'b.com']);
    expect(merged[0]).toMatchObject({ totalUpload: 6, totalDownload: 8, totalConnections: 10, lastSeen: '2026-01-03T00:00:00' });
  });

  it('does not mutate its inputs', () => {
    const a = domain('a.com', 1, 2, 3);
    const copy = { ...a };
    mergeTrafficRows([[a], [domain('a.com', 5, 6, 7)]], (row) => row.domain);
    expect(a).toEqual(copy);
  });
});

describe('typed row merges', () => {
  it('merges domains by name, unions their lists and sorts by traffic', () => {
    const merged = mergeDomainRows([
      [
        { ...domain('low.com', 1, 1, 1), ips: ['1.1.1.1'], rules: ['R1'], chains: ['P'] },
        { ...domain('high.com', 50, 50, 5), ips: ['2.2.2.2'], rules: ['R1'], chains: ['P'] },
      ],
      [
        { ...domain('high.com', 10, 10, 2), ips: ['3.3.3.3', '2.2.2.2'], rules: ['R2'], chains: ['Q'] },
      ],
    ]);

    expect(merged.map((row) => row.domain)).toEqual(['high.com', 'low.com']);
    expect(merged[0]).toMatchObject({ totalUpload: 60, totalDownload: 60, totalConnections: 7 });
    expect(merged[0].ips).toEqual(['2.2.2.2', '3.3.3.3']);
    expect(merged[0].rules).toEqual(['R1', 'R2']);
    expect(merged[0].chains).toEqual(['P', 'Q']);
  });

  it('merges IPs by address and keeps the first non-empty asn and geoIP', () => {
    const base = { ip: '8.8.8.8', domains: ['a.com'], totalUpload: 1, totalDownload: 1, totalConnections: 1, lastSeen: '2026-01-01T00:00:00' };
    const merged = mergeIPRows([
      [base],
      [{ ...base, domains: ['b.com'], chains: ['P'], asn: 'AS15169', geoIP: { countryCode: 'US', countryName: 'United States', city: '', asOrganization: '' } }],
      [{ ...base, asn: 'AS-OTHER' }],
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ totalUpload: 3, asn: 'AS15169' });
    expect(merged[0].domains).toEqual(['a.com', 'b.com']);
    expect(merged[0].chains).toEqual(['P']);
    expect(merged[0].geoIP?.countryCode).toBe('US');
  });

  it('breaks equal-traffic ties by key so the order is deterministic', () => {
    const proxy = (chain: string) => ({ chain, totalUpload: 1, totalDownload: 1, totalConnections: 1, lastSeen: '2026-01-01T00:00:00' });
    expect(mergeProxyRows([[proxy('zz'), proxy('aa')], [proxy('mm')]]).map((row) => row.chain)).toEqual(['aa', 'mm', 'zz']);
    const device = (sourceIP: string) => ({ sourceIP, totalUpload: 1, totalDownload: 1, totalConnections: 1, lastSeen: '2026-01-01T00:00:00' });
    expect(mergeDeviceRows([[device('10.0.0.2')], [device('10.0.0.1')]]).map((row) => row.sourceIP)).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('keeps the last non-empty finalProxy for a rule, like the per-backend merge', () => {
    const rule = (finalProxy: string, download: number) => ({ rule: 'PROXY', finalProxy, totalUpload: 0, totalDownload: download, totalConnections: 1, lastSeen: '2026-01-01T00:00:00' });
    const merged = mergeRuleRows([[rule('', 1)], [rule('HK-01', 2), { ...rule('', 9), rule: 'DIRECT' }]]);
    expect(merged.find((row) => row.rule === 'DIRECT')?.finalProxy).toBe('');
    expect(merged.find((row) => row.rule === 'PROXY')).toMatchObject({ finalProxy: 'HK-01', totalDownload: 3 });
  });

  it('merges countries by code and keeps the first non-empty names', () => {
    const country = (countryName: string, continent: string, download: number) => ({ country: 'US', countryName, continent, totalUpload: 0, totalDownload: download, totalConnections: 1 });
    expect(mergeCountryRows([[country('', '', 1)], [country('United States', 'Americas', 2)]])).toEqual([
      { country: 'US', countryName: 'United States', continent: 'Americas', totalUpload: 0, totalDownload: 3, totalConnections: 2 },
    ]);
  });
});

describe('time series merges', () => {
  it('sums hourly buckets and keeps them newest first', () => {
    const hour = (h: string, upload: number) => ({ hour: h, upload, download: 0, connections: 1 });
    const merged = mergeHourlyStats([[hour('2026-01-01T01:00:00', 1), hour('2026-01-01T03:00:00', 2)], [hour('2026-01-01T02:00:00', 4), hour('2026-01-01T03:00:00', 8)]]);
    expect(merged.map((row) => [row.hour, row.upload])).toEqual([
      ['2026-01-01T03:00:00', 10],
      ['2026-01-01T02:00:00', 4],
      ['2026-01-01T01:00:00', 1],
    ]);
  });

  it('sums trend buckets and keeps them ascending by time', () => {
    const point = (time: string, download: number) => ({ time, upload: 0, download });
    const merged = mergeTrendPoints([[point('2026-01-01T00:02:00', 1), point('2026-01-01T00:01:00', 2)], [point('2026-01-01T00:02:00', 3)]]);
    expect(merged).toEqual([
      { time: '2026-01-01T00:01:00', upload: 0, download: 2 },
      { time: '2026-01-01T00:02:00', upload: 0, download: 4 },
    ]);
  });
});

describe('comparePageRows', () => {
  const row = (domain: string, totalDownload: number, totalUpload = 0, lastSeen = '') => ({ domain, totalDownload, totalUpload, totalConnections: 0, lastSeen });
  const keyOf = (r: { domain: string }) => r.domain;

  it('defaults to totalDownload descending', () => {
    const rows = [row('a', 1), row('c', 3), row('b', 2)].sort((x, y) => comparePageRows(x, y, keyOf, {}));
    expect(rows.map((r) => r.domain)).toEqual(['c', 'b', 'a']);
  });

  it('supports ascending and the other sort keys', () => {
    expect([row('a', 1, 9), row('b', 5, 0)].sort((x, y) => comparePageRows(x, y, keyOf, { sortBy: 'totalUpload', sortOrder: 'asc' })).map((r) => r.domain)).toEqual(['b', 'a']);
    // The direction applies to text keys as well.
    expect([row('b', 1), row('a', 1)].sort((x, y) => comparePageRows(x, y, keyOf, { sortBy: 'domain' })).map((r) => r.domain)).toEqual(['b', 'a']);
    expect([row('b', 1), row('a', 1)].sort((x, y) => comparePageRows(x, y, keyOf, { sortBy: 'domain', sortOrder: 'asc' })).map((r) => r.domain)).toEqual(['a', 'b']);
    expect([row('b', 1), row('a', 1)].sort((x, y) => comparePageRows(x, y, keyOf, { sortBy: 'totalTraffic' })).map((r) => r.domain)).toEqual(['a', 'b']);
    expect([row('a', 1, 0, '2026-01-02T00:00:00'), row('b', 1, 0, '2026-01-03T00:00:00')].sort((x, y) => comparePageRows(x, y, keyOf, { sortBy: 'lastSeen' })).map((r) => r.domain)).toEqual(['b', 'a']);
  });

  it('breaks ties by key in both directions so pages do not overlap', () => {
    const rows = [row('c', 1), row('a', 1), row('b', 1)];
    expect([...rows].sort((x, y) => comparePageRows(x, y, keyOf, {})).map((r) => r.domain)).toEqual(['a', 'b', 'c']);
    expect([...rows].sort((x, y) => comparePageRows(x, y, keyOf, { sortOrder: 'asc' })).map((r) => r.domain)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by the ip and totalConnections keys as well', () => {
    const entry = (ip: string, totalConnections: number) => ({ ip, totalDownload: 0, totalUpload: 0, totalConnections, lastSeen: '' });
    const byIp = (r: { ip: string }) => r.ip;
    expect([entry('b', 1), entry('a', 2)].sort((x, y) => comparePageRows(x, y, byIp, { sortBy: 'totalConnections' })).map((r) => r.ip)).toEqual(['a', 'b']);
    expect([entry('b', 1), entry('a', 2)].sort((x, y) => comparePageRows(x, y, byIp, { sortBy: 'ip', sortOrder: 'asc' })).map((r) => r.ip)).toEqual(['a', 'b']);
  });
});

describe('mergeProxyTrafficRows', () => {
  it('sums per-proxy traffic rows that share a chain and sorts by traffic', () => {
    const row = (chain: string, totalDownload: number) => ({ chain, totalUpload: 0, totalDownload, totalConnections: 1 });
    expect(mergeProxyTrafficRows([[row('DIRECT', 1), row('PROXY', 9)], [row('DIRECT', 2)]])).toEqual([
      { chain: 'PROXY', totalUpload: 0, totalDownload: 9, totalConnections: 1 },
      { chain: 'DIRECT', totalUpload: 0, totalDownload: 3, totalConnections: 2 },
    ]);
  });
});

describe('mergeRuleProxyMaps', () => {
  it('unions the proxies of the same rule', () => {
    expect(mergeRuleProxyMaps([[{ rule: 'R', proxies: ['A'] }], [{ rule: 'R', proxies: ['B', 'A'] }, { rule: 'S', proxies: [] }]])).toEqual([
      { rule: 'R', proxies: ['A', 'B'] },
      { rule: 'S', proxies: [] },
    ]);
  });
});

describe('mergeRuleChainFlowAll', () => {
  // Backend A: R1 -> PROXY -> HK-01, R2 -> DIRECT
  const flowA: RuleChainFlowAll = {
    nodes: [
      { name: 'R1', layer: 0, nodeType: 'rule', totalUpload: 1, totalDownload: 2, totalConnections: 3, rules: ['R1'] },
      { name: 'R2', layer: 0, nodeType: 'rule', totalUpload: 4, totalDownload: 5, totalConnections: 6, rules: ['R2'] },
      { name: 'DIRECT', layer: 1, nodeType: 'group', totalUpload: 4, totalDownload: 5, totalConnections: 6, rules: ['R2'] },
      { name: 'PROXY', layer: 1, nodeType: 'group', totalUpload: 1, totalDownload: 2, totalConnections: 3, rules: ['R1'] },
      { name: 'HK-01', layer: 2, nodeType: 'proxy', totalUpload: 1, totalDownload: 2, totalConnections: 3, rules: ['R1'] },
    ],
    links: [
      { source: 3, target: 4, rules: ['R1'] },
      { source: 0, target: 3, rules: ['R1'] },
      { source: 1, target: 2, rules: ['R2'] },
    ],
    rulePaths: { R1: { nodeIndices: [0, 3, 4], linkIndices: [0, 1] }, R2: { nodeIndices: [1, 2], linkIndices: [2] } },
    maxLayer: 2,
  };

  // Backend B: R1 -> PROXY -> JP-02, R3 -> INNER -> PROXY -> JP-02
  const flowB: RuleChainFlowAll = {
    nodes: [
      { name: 'R1', layer: 0, nodeType: 'rule', totalUpload: 10, totalDownload: 20, totalConnections: 30, rules: ['R1'] },
      { name: 'R3', layer: 0, nodeType: 'rule', totalUpload: 100, totalDownload: 200, totalConnections: 300, rules: ['R3'] },
      { name: 'INNER', layer: 1, nodeType: 'group', totalUpload: 100, totalDownload: 200, totalConnections: 300, rules: ['R3'] },
      { name: 'PROXY', layer: 2, nodeType: 'group', totalUpload: 110, totalDownload: 220, totalConnections: 330, rules: ['R1', 'R3'] },
      { name: 'JP-02', layer: 2, nodeType: 'proxy', totalUpload: 110, totalDownload: 220, totalConnections: 330, rules: ['R1', 'R3'] },
    ],
    links: [
      { source: 2, target: 3, rules: ['R3'] },
      { source: 3, target: 4, rules: ['R1', 'R3'] },
      { source: 0, target: 3, rules: ['R1'] },
      { source: 1, target: 2, rules: ['R3'] },
    ],
    rulePaths: {
      R1: { nodeIndices: [0, 3, 4], linkIndices: [1, 2] },
      R3: { nodeIndices: [1, 2, 3, 4], linkIndices: [0, 1, 3] },
    },
    maxLayer: 2,
  };

  it('sums shared nodes, rebuilds link indices and rule paths', () => {
    const merged = mergeRuleChainFlowAll([flowA, flowB]);

    expect(merged.nodes.map((node) => node.name)).toEqual(['R1', 'R2', 'R3', 'DIRECT', 'INNER', 'PROXY', 'HK-01', 'JP-02']);
    const byName = Object.fromEntries(merged.nodes.map((node) => [node.name, node]));
    expect(byName.R1).toMatchObject({ totalUpload: 11, totalDownload: 22, totalConnections: 33, layer: 0, nodeType: 'rule' });
    expect(byName.PROXY).toMatchObject({ totalUpload: 111, totalDownload: 222, layer: 2, nodeType: 'group', rules: ['R1', 'R3'] });
    expect(byName.DIRECT).toMatchObject({ layer: 1, nodeType: 'group' });
    // HK-01 only exists in backend A but is a sink, so it joins the rightmost column.
    expect(byName['HK-01']).toMatchObject({ layer: 2, nodeType: 'proxy' });
    expect(merged.maxLayer).toBe(2);

    // Every link points at the merged node indices.
    for (const link of merged.links) {
      expect(merged.nodes[link.source]).toBeDefined();
      expect(merged.nodes[link.target]).toBeDefined();
    }
    expect(merged.links).toEqual([
      { source: 4, target: 5, rules: ['R3'] },            // INNER -> PROXY
      { source: 5, target: 6, rules: ['R1'] },            // PROXY -> HK-01
      { source: 5, target: 7, rules: ['R1', 'R3'] },      // PROXY -> JP-02
      { source: 0, target: 5, rules: ['R1'] },            // R1 -> PROXY
      { source: 1, target: 3, rules: ['R2'] },            // R2 -> DIRECT
      { source: 2, target: 4, rules: ['R3'] },            // R3 -> INNER
    ]);

    expect(merged.rulePaths).toEqual({
      R1: { nodeIndices: [0, 5, 6, 7], linkIndices: [1, 2, 3] },
      R2: { nodeIndices: [1, 3], linkIndices: [4] },
      R3: { nodeIndices: [2, 4, 5, 7], linkIndices: [0, 2, 5] },
    });
  });

  it('returns an empty graph when there is nothing to merge', () => {
    expect(mergeRuleChainFlowAll([null, undefined])).toEqual({ nodes: [], links: [], rulePaths: {}, maxLayer: 0 });
  });

  it('returns a copy of a single graph', () => {
    const merged = mergeRuleChainFlowAll([flowA]);
    expect(merged).toEqual(flowA);
    expect(merged.nodes).not.toBe(flowA.nodes);
  });
});

describe('mergeRuleChainFlow', () => {
  it('merges single-rule flows by node name and rebuilds link indices', () => {
    const node = (name: string, download: number) => ({ name, totalUpload: 0, totalDownload: download, totalConnections: 1 });
    const merged = mergeRuleChainFlow([
      { nodes: [node('R', 1), node('P', 1), node('HK', 1)], links: [{ source: 0, target: 1 }, { source: 1, target: 2 }] },
      { nodes: [node('R', 2), node('P', 2), node('JP', 2)], links: [{ source: 0, target: 1 }, { source: 1, target: 2 }] },
      null,
    ]);

    expect(merged.nodes.map((n) => [n.name, n.totalDownload])).toEqual([['R', 3], ['P', 3], ['HK', 1], ['JP', 2]]);
    expect(merged.links).toEqual([
      { source: 0, target: 1 },
      { source: 1, target: 2 },
      { source: 1, target: 3 },
    ]);
  });
});
