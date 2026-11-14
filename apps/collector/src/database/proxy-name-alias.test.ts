import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeProxyChain, normalizeProxyName, validateProxyNameAliases, type ProxyNameAlias } from '@neko-master/shared';
import { createTestDatabase, createTestBackend } from '../__tests__/helpers.js';
import { StatsDatabase, type TrafficUpdate } from '../modules/db/db.js';
import { RealtimeStore } from '../modules/realtime/realtime.store.js';

const oldName = '🇺🇸 Node 01 - 50GB📊-300D,12H⏳';
const newName = '🇺🇸 Node 01 - 25GB📊-299D,12H⏳';
const alias = 'US Node 01';
const rules: ProxyNameAlias[] = [{ match: 'prefix', value: '🇺🇸 Node 01 - ', alias }];
const timestamp = Date.parse('2026-10-10T10:15:00Z');
const range = ['2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z'] as const;

describe('proxy name rule validation', () => {
  it('uses exact matches, then the longest prefix, without changing policy groups', () => {
    const config: ProxyNameAlias[] = [
      { match: 'prefix', value: 'Node ', alias: 'Other nodes' },
      { match: 'prefix', value: 'Node 01 - ', alias: 'Node 01' },
      { match: 'exact', value: 'Node 01 - special', alias: 'Special node' },
    ];
    expect(normalizeProxyName('Node 01 - special', config)).toBe('Special node');
    expect(normalizeProxyName('Node 01 - 50GB', config)).toBe('Node 01');
    expect(normalizeProxyChain('Node 01 - 50GB > Node group > Policy', config)).toBe('Node 01 > Node group > Policy');
    expect(normalizeProxyChain('DIRECT > Policy', config)).toBe('DIRECT > Policy');
  });

  it.each([
    null,
    Array.from({ length: 51 }, () => rules[0]),
    [{ match: 'regex', value: 'Node', alias: 'US' }],
    [{ match: 'prefix', value: '', alias: 'US' }],
    [{ match: 'prefix', value: 'Node', alias: ' US' }],
    [{ match: 'prefix', value: 'Node', alias: 'Bad > Group' }],
    [{ match: 'prefix', value: 'Node', alias: 'Bad>Group' }],
    [{ match: 'prefix', value: 'DIR', alias: 'US' }],
    [{ match: 'exact', value: 'Node', alias: 'REJECT' }],
    [...rules, ...rules],
    [{ match: 'exact', value: 'A', alias: 'B' }, { match: 'exact', value: 'B', alias: 'C' }],
  ])('rejects unsafe or ambiguous configuration %#', value => {
    expect(() => validateProxyNameAliases(value)).toThrow();
  });
});

describe('backend-scoped proxy name grouping', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;
  let otherBackendId: number;
  const traffic = (name: string, download: number, domain = 'example.com'): TrafficUpdate => ({
    domain, ip: '1.1.1.1', chain: name, chains: [name, 'Policy'], rule: 'MATCH', rulePayload: '',
    upload: 1, download, connections: 1, sourceIP: '192.168.1.10', timestampMs: timestamp,
  });

  beforeEach(() => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
    otherBackendId = createTestBackend(db, 'other-backend');
    db.batchUpdateTrafficStats(backendId, [traffic(oldName, 20), traffic(newName, 40), traffic('Other', 100)]);
    db.batchUpdateTrafficStats(otherBackendId, [traffic(oldName, 99)]);
  });
  afterEach(() => cleanup());

  it('groups history and future writes, preserves raw records and can be reversed without data migration', () => {
    expect(db.getProxyStats(backendId)).toHaveLength(3);
    const totalBefore = db.getSummary(backendId);
    db.updateProxyNameAliases(backendId, rules);
    expect(db.getProxyStats(backendId).find(row => row.chain === alias)).toMatchObject({ totalDownload: 60, totalUpload: 2, totalConnections: 2 });
    expect(db.getProxyStats(otherBackendId)[0].chain).toBe(oldName);
    expect(db.getSummary(backendId)).toEqual(totalBefore);
    db.batchUpdateTrafficStats(backendId, [traffic('🇺🇸 Node 01 - 10GB', 10)]);
    expect(db.getProxyStats(backendId).find(row => row.chain === alias)?.totalDownload).toBe(70);
    db.updateProxyNameAliases(backendId, []);
    expect(db.getProxyStats(backendId).map(row => row.chain)).toEqual(expect.arrayContaining([oldName, newName, '🇺🇸 Node 01 - 10GB']));
  });

  it.each([[undefined], [range], [['2026-10-10T00:00:00Z', '2026-10-11T00:00:00Z'] as const]])('combines cumulative, minute and hourly details before limiting results: %j', window => {
    db.updateProxyNameAliases(backendId, rules);
    const [start, end] = window ?? [];
    expect(db.getProxyDomains(backendId, alias, 1, start, end)).toMatchObject([{ domain: 'example.com', totalDownload: 60, totalConnections: 2 }]);
    expect(db.getProxyIPs(backendId, alias, 1, start, end)).toMatchObject([{ ip: '1.1.1.1', totalDownload: 60, totalConnections: 2 }]);
    const breakdown = db.getDomainProxyStats(backendId, 'example.com', start, end);
    expect(breakdown.filter(row => row.chain.startsWith(alias))).toMatchObject([{ chain: `${alias} > Policy`, totalDownload: 60 }]);
    expect(db.getIPProxyStats(backendId, '1.1.1.1', start, end).filter(row => row.chain.startsWith(alias))).toMatchObject([{ totalDownload: 60 }]);
    expect(db.getProxyStats(backendId, start, end).find(row => row.chain === alias)?.totalDownload).toBe(60);
  });

  it('keeps source IP/chain scope and rule flow names consistent', () => {
    db.updateProxyNameAliases(backendId, rules);
    expect(db.getDomainProxyStats(backendId, 'example.com', ...range, '192.168.1.10', alias)).toMatchObject([{ totalDownload: 60 }]);
    expect(db.getDomainProxyStats(backendId, 'example.com', ...range, '192.168.1.11', alias)).toEqual([]);
    const flow = db.getRuleChainFlow(backendId, 'Policy', ...range);
    expect(flow.nodes.find(node => node.name === oldName)?.totalDownload).toBe(20);
    expect(flow.nodes.find(node => node.name === newName)?.totalDownload).toBe(40);
    expect(flow.nodes.find(node => node.name === 'Policy')?.totalDownload).toBe(160);
  });

  it('treats quotes, percent signs, underscores and Unicode in aliases as literals', () => {
    const name = "🇺🇸 O'Hare_%\\node";
    db.batchUpdateTrafficStats(backendId, [traffic(name, 7), traffic('Not a match', 88)]);
    db.updateProxyNameAliases(backendId, [{ match: 'exact', value: name, alias: "A_'%\\alias" }]);
    expect(db.getProxyDomains(backendId, "A_'%\\alias", 50)).toMatchObject([{ totalDownload: 7 }]);
  });

  it('merges only matching live traffic, allows live rule changes and clears all dimensions after flush', () => {
    const store = new RealtimeStore();
    store.setDatabase(db);
    store.recordTraffic(backendId, traffic(oldName, 7));
    store.recordTraffic(backendId, traffic(newName, 8));
    store.recordTraffic(backendId, traffic('Other', 1000));
    db.updateProxyNameAliases(backendId, rules);
    expect(store.mergeProxyStats(backendId, db.getProxyStats(backendId)).find(row => row.chain === alias)?.totalDownload).toBe(75);
    expect(store.mergeProxyDomains(backendId, alias, db.getProxyDomains(backendId, alias))).toMatchObject([{ totalDownload: 75 }]);
    expect(store.mergeProxyIPs(backendId, alias, db.getProxyIPs(backendId, alias))).toMatchObject([{ totalDownload: 75 }]);
    expect(store.getRuleChainRows(backendId).map(row => row.chain)).toEqual(expect.arrayContaining([`${oldName} > Policy`, `${newName} > Policy`]));
    db.updateProxyNameAliases(backendId, []);
    expect(store.mergeProxyStats(backendId, []).map(row => row.chain)).toEqual(expect.arrayContaining([oldName, newName]));
    store.clearTrafficDimensions(backendId);
    expect(store.mergeProxyStats(backendId, [])).toEqual([]);
    expect(store.mergeProxyDomains(backendId, alias, [])).toEqual([]);
  });

  it('persists rules without changing data and removes rules only when deleting the backend', () => {
    db.updateProxyNameAliases(backendId, rules);
    const loaded = db.getProxyNameAliases(backendId);
    loaded[0].alias = 'modified copy';
    expect(db.getProxyNameAliases(backendId)).toEqual(rules);
    db.deleteBackendData(backendId);
    expect(db.getProxyNameAliases(backendId)).toEqual(rules);
    db.deleteBackend(backendId);
    expect(db.getProxyNameAliases(backendId)).toEqual([]);
  });

  it('invalidates already cached historical results when rules are saved or removed', () => {
    expect(db.getProxyStats(backendId, ...range)).toHaveLength(3);
    db.updateProxyNameAliases(backendId, rules);
    expect(db.getProxyStats(backendId, ...range)).toHaveLength(2);
    db.updateProxyNameAliases(backendId, []);
    expect(db.getProxyStats(backendId, ...range)).toHaveLength(3);
  });

  it('reloads saved rules after reopening the database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-alias-restart-'));
    const file = path.join(dir, 'stats.db');
    let persistent = new StatsDatabase(file);
    try {
      const id = createTestBackend(persistent);
      persistent.batchUpdateTrafficStats(id, [traffic(oldName, 20), traffic(newName, 40)]);
      persistent.updateProxyNameAliases(id, rules);
      persistent.close();
      persistent = new StatsDatabase(file);
      expect(persistent.getProxyNameAliases(id)).toEqual(rules);
      expect(persistent.getProxyStats(id)).toMatchObject([{ chain: alias, totalDownload: 60 }]);
    } finally {
      persistent.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
