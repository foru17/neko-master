/**
 * Rule Repository
 *
 * Handles rule statistics, rule-proxy mappings, rule chain flow visualization,
 * and per-rule domain/IP breakdowns.
 */
import type Database from 'better-sqlite3';
import type { DomainStats, IPStats, ProxyStats, RuleStats } from '@neko-master/shared';
import { BaseRepository } from './base.repository.js';

interface ProxyTrafficStats {
  chain: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
}

// Row cap for the all-rules chain-flow DAG (RULE_CHAIN_FLOW_MAX_ROWS to tune).
function getRuleChainFlowMaxRows(): number {
  const parsed = Number.parseInt(process.env.RULE_CHAIN_FLOW_MAX_ROWS || '2000', 10);
  return Math.max(100, Number.isFinite(parsed) && parsed > 0 ? parsed : 2000);
}

export class RuleRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  private encodeFlowLinkKey(sourceName: string, targetName: string): string {
    return JSON.stringify([sourceName, targetName]);
  }

  private decodeFlowLinkKey(key: string): [sourceName: string, targetName: string] | null {
    try {
      const parsed = JSON.parse(key) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[0] === 'string' &&
        typeof parsed[1] === 'string'
      ) {
        return [parsed[0], parsed[1]];
      }
    } catch {
      return null;
    }
    return null;
  }

  getRuleStats(backendId: number, start?: string, end?: string): RuleStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT rule, MAX(chain) as finalProxy,
               SUM(upload) as totalUpload, SUM(download) as totalDownload,
               SUM(connections) as totalConnections, MAX(${resolved.timeCol}) as lastSeen
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ?
        GROUP BY rule ORDER BY (SUM(upload) + SUM(download)) DESC
      `);
      return stmt.all(backendId, resolved.startKey, resolved.endKey) as RuleStats[];
    }

    const stmt = this.db.prepare(`
      SELECT rule, final_proxy as finalProxy, total_upload as totalUpload, total_download as totalDownload,
             total_connections as totalConnections, last_seen as lastSeen
      FROM rule_stats WHERE backend_id = ? ORDER BY (total_upload + total_download) DESC
    `);
    return stmt.all(backendId) as RuleStats[];
  }

  getRuleProxyMap(backendId: number): Array<{ rule: string; proxies: string[] }> {
    const stmt = this.db.prepare(`
      SELECT rule, proxy FROM rule_proxy_map WHERE backend_id = ? ORDER BY rule, proxy
    `);
    const rows = stmt.all(backendId) as Array<{ rule: string; proxy: string }>;

    const map = new Map<string, string[]>();
    for (const row of rows) {
      if (!map.has(row.rule)) map.set(row.rule, []);
      map.get(row.rule)!.push(row.proxy);
    }
    return Array.from(map.entries()).map(([rule, proxies]) => ({ rule, proxies }));
  }

  getRuleDomains(backendId: number, rule: string, limit = 50, start?: string, end?: string): DomainStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT domain, SUM(upload) as totalUpload, SUM(download) as totalDownload,
               SUM(connections) as totalConnections, MAX(${resolved.timeCol}) as lastSeen,
               GROUP_CONCAT(DISTINCT ip) as ips, GROUP_CONCAT(DISTINCT chain) as chains
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND rule = ? AND domain != ''
        GROUP BY domain ORDER BY (SUM(upload) + SUM(download)) DESC LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, rule, limit) as Array<{
        domain: string; totalUpload: number; totalDownload: number; totalConnections: number;
        lastSeen: string; ips: string | null; chains: string | null;
      }>;

      return rows.map(row => {
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return {
          domain: row.domain, totalUpload: row.totalUpload, totalDownload: row.totalDownload,
          totalConnections: row.totalConnections, lastSeen: row.lastSeen,
          ips: row.ips ? row.ips.split(',').filter(Boolean) : [],
          chains: this.expandShortChainsForRules(backendId, chains, [rule]), rules: [rule],
        };
      }) as DomainStats[];
    }

    const stmt = this.db.prepare(`
      SELECT rdt.domain, rdt.total_upload as totalUpload, rdt.total_download as totalDownload,
             rdt.total_connections as totalConnections, rdt.last_seen as lastSeen, ds.ips, ds.chains
      FROM rule_domain_traffic rdt
      LEFT JOIN domain_stats ds ON rdt.backend_id = ds.backend_id AND rdt.domain = ds.domain
      WHERE rdt.backend_id = ? AND rdt.rule = ?
      ORDER BY (rdt.total_upload + rdt.total_download) DESC LIMIT ?
    `);
    const rows = stmt.all(backendId, rule, limit) as Array<{
      domain: string; totalUpload: number; totalDownload: number; totalConnections: number;
      lastSeen: string; ips: string | null; chains: string | null;
    }>;

    return rows.map(row => ({
      domain: row.domain, totalUpload: row.totalUpload, totalDownload: row.totalDownload,
      totalConnections: row.totalConnections, lastSeen: row.lastSeen,
      ips: row.ips ? row.ips.split(',').filter(Boolean) : [],
      chains: this.expandShortChainsForRules(backendId, row.chains ? row.chains.split(',').filter(Boolean) : [], [rule]),
      rules: [rule],
    })) as DomainStats[];
  }

  getRuleIPs(backendId: number, rule: string, limit = 50, start?: string, end?: string): IPStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT m.ip, SUM(m.upload) as totalUpload, SUM(m.download) as totalDownload,
               SUM(m.connections) as totalConnections, MAX(m.${resolved.timeCol}) as lastSeen,
               GROUP_CONCAT(DISTINCT CASE WHEN m.domain != '' THEN m.domain END) as domains,
               GROUP_CONCAT(DISTINCT m.chain) as chains,
               COALESCE(i.asn, g.asn) as asn,
               CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                    WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIPData
        FROM ${resolved.table} m
        LEFT JOIN ip_stats i ON m.backend_id = i.backend_id AND m.ip = i.ip
        LEFT JOIN geoip_cache g ON m.ip = g.ip
        WHERE m.backend_id = ? AND m.${resolved.timeCol} >= ? AND m.${resolved.timeCol} <= ? AND m.rule = ? AND m.ip != ''
        GROUP BY m.ip ORDER BY (SUM(m.upload) + SUM(m.download)) DESC LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, rule, limit) as Array<{
        ip: string; totalUpload: number; totalDownload: number; totalConnections: number;
        lastSeen: string; domains: string | null; chains: string | null; asn: string | null; geoIPData: string | null;
      }>;

      return rows.map(row => {
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return {
          ip: row.ip, totalUpload: row.totalUpload, totalDownload: row.totalDownload,
          totalConnections: row.totalConnections, lastSeen: row.lastSeen,
          domains: row.domains ? row.domains.split(',').filter(Boolean) : [],
          chains: this.expandShortChainsForRules(backendId, chains, [rule]),
          asn: row.asn || undefined,
          geoIP: row.geoIPData ? JSON.parse(row.geoIPData).filter(Boolean) : undefined,
        };
      }) as IPStats[];
    }

    const stmt = this.db.prepare(`
      SELECT rit.ip, rit.total_upload as totalUpload, rit.total_download as totalDownload,
             rit.total_connections as totalConnections, rit.last_seen as lastSeen,
             i.domains, i.chains, COALESCE(i.asn, g.asn) as asn,
             CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                  ELSE NULL END as geoIPData
      FROM rule_ip_traffic rit
      LEFT JOIN ip_stats i ON rit.backend_id = i.backend_id AND rit.ip = i.ip
      LEFT JOIN geoip_cache g ON rit.ip = g.ip
      WHERE rit.backend_id = ? AND rit.rule = ?
      ORDER BY (rit.total_upload + rit.total_download) DESC LIMIT ?
    `);
    const rows = stmt.all(backendId, rule, limit) as Array<{
      ip: string; totalUpload: number; totalDownload: number; totalConnections: number;
      lastSeen: string; domains: string | null; chains: string | null; asn: string | null; geoIPData: string | null;
    }>;

    return rows.map(row => ({
      ip: row.ip, totalUpload: row.totalUpload, totalDownload: row.totalDownload,
      totalConnections: row.totalConnections, lastSeen: row.lastSeen,
      domains: row.domains ? row.domains.split(',').filter(Boolean) : [],
      chains: this.expandShortChainsForRules(backendId, row.chains ? row.chains.split(',').filter(Boolean) : [], [rule]),
      asn: row.asn || undefined,
      geoIP: row.geoIPData ? JSON.parse(row.geoIPData).filter(Boolean) : undefined,
    })) as IPStats[];
  }

  getRuleDomainProxyStats(backendId: number, rule: string, domain: string, start?: string, end?: string): ProxyTrafficStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT chain, SUM(upload) as totalUpload, SUM(download) as totalDownload, SUM(connections) as totalConnections
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND rule = ? AND domain = ?
        GROUP BY chain ORDER BY (SUM(upload) + SUM(download)) DESC
      `);
      return stmt.all(backendId, resolved.startKey, resolved.endKey, rule, domain) as ProxyTrafficStats[];
    }
    return [];
  }

  getRuleDomainIPDetails(backendId: number, rule: string, domain: string, start?: string, end?: string, limit = 100): IPStats[] {
    const range = this.parseMinuteRange(start, end);
    const resolved = range ? this.resolveFactTable(start!, end!) : null;
    const factTable = resolved?.table ?? 'minute_dim_stats';
    const timeCol = resolved?.timeCol ?? 'minute';
    const conditions = ["m.backend_id = ?", "m.rule = ?", "m.domain = ?", "m.ip != ''"];
    const params: Array<string | number> = [backendId, rule, domain];
    if (resolved) {
      conditions.push(`m.${timeCol} >= ?`, `m.${timeCol} <= ?`);
      params.push(resolved.startKey, resolved.endKey);
    }

    const stmt = this.db.prepare(`
      SELECT m.ip, GROUP_CONCAT(DISTINCT CASE WHEN m.domain != '' THEN m.domain END) as domains,
             SUM(m.upload) as totalUpload, SUM(m.download) as totalDownload,
             SUM(m.connections) as totalConnections, MAX(m.${timeCol}) as lastSeen,
             COALESCE(i.asn, g.asn) as asn,
             CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                  WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP,
             GROUP_CONCAT(DISTINCT m.chain) as chains
      FROM ${factTable} m
      LEFT JOIN ip_stats i ON m.backend_id = i.backend_id AND m.ip = i.ip
      LEFT JOIN geoip_cache g ON m.ip = g.ip
      WHERE ${conditions.join(" AND ")}
      GROUP BY m.ip ORDER BY (SUM(m.upload) + SUM(m.download)) DESC LIMIT ?
    `);

    const rows = stmt.all(...params, limit) as Array<{
      ip: string; domains: string; totalUpload: number; totalDownload: number;
      totalConnections: number; lastSeen: string; asn: string | null; geoIP: string | null; chains: string | null;
    }>;

    return rows.map(row => {
      const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
      return {
        ...row, domains: row.domains ? row.domains.split(',').filter(Boolean) : [],
        geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined,
        asn: row.asn || undefined,
        chains: this.expandShortChainsForRules(backendId, chains, [rule]),
      };
    }) as IPStats[];
  }

  getRuleIPProxyStats(backendId: number, rule: string, ip: string, start?: string, end?: string): ProxyTrafficStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT chain, SUM(upload) as totalUpload, SUM(download) as totalDownload, SUM(connections) as totalConnections
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND rule = ? AND ip = ?
        GROUP BY chain ORDER BY (SUM(upload) + SUM(download)) DESC
      `);
      return stmt.all(backendId, resolved.startKey, resolved.endKey, rule, ip) as ProxyTrafficStats[];
    }
    return [];
  }

  getRuleIPDomainDetails(backendId: number, rule: string, ip: string, start?: string, end?: string, limit = 100): DomainStats[] {
    const range = this.parseMinuteRange(start, end);
    const resolved = range ? this.resolveFactTable(start!, end!) : null;
    const factTable = resolved?.table ?? 'minute_dim_stats';
    const timeCol = resolved?.timeCol ?? 'minute';
    const conditions = ["backend_id = ?", "rule = ?", "ip = ?", "domain != ''"];
    const params: Array<string | number> = [backendId, rule, ip];
    if (resolved) {
      conditions.push(`${timeCol} >= ?`, `${timeCol} <= ?`);
      params.push(resolved.startKey, resolved.endKey);
    }

    const stmt = this.db.prepare(`
      SELECT domain, GROUP_CONCAT(DISTINCT ip) as ips,
             SUM(upload) as totalUpload, SUM(download) as totalDownload,
             SUM(connections) as totalConnections, MAX(${timeCol}) as lastSeen,
             GROUP_CONCAT(DISTINCT CASE WHEN rule != '' THEN rule END) as rules,
             GROUP_CONCAT(DISTINCT chain) as chains
      FROM ${factTable} WHERE ${conditions.join(" AND ")}
      GROUP BY domain ORDER BY (SUM(upload) + SUM(download)) DESC LIMIT ?
    `);

    const rows = stmt.all(...params, limit) as Array<{
      domain: string; ips: string | null; totalUpload: number; totalDownload: number;
      totalConnections: number; lastSeen: string; rules: string | null; chains: string | null;
    }>;

    return rows.map(row => {
      const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
      const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
      return {
        domain: row.domain, ips: row.ips ? row.ips.split(',').filter(Boolean) : [],
        totalUpload: row.totalUpload, totalDownload: row.totalDownload,
        totalConnections: row.totalConnections, lastSeen: row.lastSeen, rules,
        chains: this.expandShortChainsForRules(backendId, chains, rules),
      };
    }) as DomainStats[];
  }

  getRuleChainFlow(
    backendId: number, rule: string, start?: string, end?: string,
    realtimeRows?: Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>,
    proxyConfig?: Record<string, { now?: string }>,
  ): { nodes: Array<{ name: string; totalUpload: number; totalDownload: number; totalConnections: number }>; links: Array<{ source: number; target: number }> } {
    const range = this.parseMinuteRange(start, end);
    let rows: Array<{ chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>;

    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT chain, SUM(upload) as totalUpload, SUM(download) as totalDownload, SUM(connections) as totalConnections
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND rule = ? AND chain != ''
        GROUP BY chain
      `);
      rows = stmt.all(backendId, resolved.startKey, resolved.endKey, rule) as typeof rows;

      const baselineStmt = this.db.prepare(`
        SELECT rule, chain, total_upload as totalUpload, total_download as totalDownload, total_connections as totalConnections
        FROM rule_chain_traffic WHERE backend_id = ? AND rule = ?
      `);
      const baselineRows = baselineStmt.all(backendId, rule) as Array<{
        rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number;
      }>;
      const remapped = this.remapRangeRowsToFullChains(
        rows.map(r => ({ rule, chain: r.chain, totalUpload: r.totalUpload, totalDownload: r.totalDownload, totalConnections: r.totalConnections })),
        baselineRows,
      );
      rows = remapped.map(r => ({ chain: r.chain, totalUpload: r.totalUpload, totalDownload: r.totalDownload, totalConnections: r.totalConnections }));
    } else {
      const stmt = this.db.prepare(`
        SELECT chain, total_upload as totalUpload, total_download as totalDownload, total_connections as totalConnections
        FROM rule_chain_traffic WHERE backend_id = ? AND rule = ?
      `);
      rows = stmt.all(backendId, rule) as typeof rows;
    }

    if (realtimeRows) {
      const rowsByChain = new Map<string, (typeof rows)[number]>();
      for (const r of rows) rowsByChain.set(r.chain, r);
      for (const rt of realtimeRows) {
        if (rt.rule !== rule) continue;
        const existing = rowsByChain.get(rt.chain);
        if (existing) {
          existing.totalUpload += rt.totalUpload;
          existing.totalDownload += rt.totalDownload;
          existing.totalConnections += rt.totalConnections;
        } else {
          const added = {
            chain: rt.chain,
            totalUpload: rt.totalUpload,
            totalDownload: rt.totalDownload,
            totalConnections: rt.totalConnections,
          };
          rows.push(added);
          rowsByChain.set(rt.chain, added);
        }
      }
    }

    const nodeMap = new Map<string, { name: string; totalUpload: number; totalDownload: number; totalConnections: number }>();
    const linkSet = new Set<string>();

    for (const row of rows) {
      const flowPath = this.buildRuleFlowPathWithConfig(rule, row.chain, proxyConfig);
      if (flowPath.length < 2) continue;
      for (let i = 0; i < flowPath.length; i++) {
        const nodeName = flowPath[i];
        if (!nodeMap.has(nodeName)) {
          nodeMap.set(nodeName, { name: nodeName, totalUpload: 0, totalDownload: 0, totalConnections: 0 });
        }
        const node = nodeMap.get(nodeName)!;
        node.totalUpload += row.totalUpload;
        node.totalDownload += row.totalDownload;
        node.totalConnections += row.totalConnections;
      }
      for (let i = 0; i < flowPath.length - 1; i++) {
        linkSet.add(this.encodeFlowLinkKey(flowPath[i], flowPath[i + 1]));
      }
    }

    const nodes = Array.from(nodeMap.values());
    const nodeIndexMap = new Map(nodes.map((n, i) => [n.name, i]));
    const links = Array.from(linkSet)
      .map(linkKey => {
        const decoded = this.decodeFlowLinkKey(linkKey);
        if (!decoded) return null;
        const [sourceName, targetName] = decoded;
        const source = nodeIndexMap.get(sourceName);
        const target = nodeIndexMap.get(targetName);
        if (source === undefined || target === undefined) return null;
        return { source, target };
      })
      .filter((link): link is { source: number; target: number } => !!link);

    return { nodes, links };
  }

  getAllRuleChainFlows(
    backendId: number, start?: string, end?: string,
    realtimeRows?: Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>,
    proxyConfig?: Record<string, { now?: string }>,
  ): {
    nodes: Array<{ name: string; layer: number; nodeType: 'rule' | 'group' | 'proxy'; totalUpload: number; totalDownload: number; totalConnections: number; rules: string[] }>;
    links: Array<{ source: number; target: number; rules: string[] }>;
    rulePaths: Record<string, { nodeIndices: number[]; linkIndices: number[] }>;
    maxLayer: number;
  } {
    const range = this.parseMinuteRange(start, end);
    let rows: Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>;

    // Cap the DAG source rows: the graph is dominated by the top-traffic
    // rule/chain pairs, and unbounded scans here run on every WS push.
    const maxRows = getRuleChainFlowMaxRows();

    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT rule, chain, SUM(upload) as totalUpload, SUM(download) as totalDownload, SUM(connections) as totalConnections
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND rule != '' AND chain != ''
        GROUP BY rule, chain
        ORDER BY (SUM(upload) + SUM(download)) DESC
        LIMIT ?
      `);
      rows = stmt.all(backendId, resolved.startKey, resolved.endKey, maxRows) as typeof rows;

      const baselineStmt = this.db.prepare(`
        SELECT rule, chain, total_upload as totalUpload, total_download as totalDownload, total_connections as totalConnections
        FROM rule_chain_traffic WHERE backend_id = ?
      `);
      const baselineRows = baselineStmt.all(backendId) as typeof rows;
      rows = this.remapRangeRowsToFullChains(rows, baselineRows);
    } else {
      const stmt = this.db.prepare(`
        SELECT rule, chain, total_upload as totalUpload, total_download as totalDownload, total_connections as totalConnections
        FROM rule_chain_traffic WHERE backend_id = ?
        ORDER BY (total_upload + total_download) DESC
        LIMIT ?
      `);
      rows = stmt.all(backendId, maxRows) as typeof rows;
    }

    if (realtimeRows) {
      const rowsByKey = new Map<string, (typeof rows)[number]>();
      for (const r of rows) rowsByKey.set(`${r.rule}\u0000${r.chain}`, r);
      for (const rt of realtimeRows) {
        const key = `${rt.rule}\u0000${rt.chain}`;
        const existing = rowsByKey.get(key);
        if (existing) {
          existing.totalUpload += rt.totalUpload;
          existing.totalDownload += rt.totalDownload;
          existing.totalConnections += rt.totalConnections;
        } else {
          const added = {
            rule: rt.rule,
            chain: rt.chain,
            totalUpload: rt.totalUpload,
            totalDownload: rt.totalDownload,
            totalConnections: rt.totalConnections,
          };
          rows.push(added);
          rowsByKey.set(key, added);
        }
      }
    }

    const nodeMap = new Map<string, {
      totalUpload: number; totalDownload: number; totalConnections: number;
      rules: Set<string>; layer: number;
    }>();
    const linkMap = new Map<string, Set<string>>();
    const rulePathNodes = new Map<string, Set<string>>();
    const rulePathLinks = new Map<string, Set<string>>();
    const outgoingByNode = new Map<string, Set<string>>();
    const incomingByNode = new Map<string, Set<string>>();

    for (const row of rows) {
      const rule = row.rule;
      if (!rulePathNodes.has(rule)) {
        rulePathNodes.set(rule, new Set());
        rulePathLinks.set(rule, new Set());
      }

      const flowPath = this.buildRuleFlowPathWithConfig(rule, row.chain, proxyConfig);
      // Row processing debug logging removed
      if (flowPath.length < 2) continue;

      for (let i = 0; i < flowPath.length; i++) {
        const nodeName = flowPath[i];
        if (!nodeMap.has(nodeName)) {
          nodeMap.set(nodeName, { totalUpload: 0, totalDownload: 0, totalConnections: 0, rules: new Set(), layer: i });
        }
        const node = nodeMap.get(nodeName)!;
        node.totalUpload += row.totalUpload;
        node.totalDownload += row.totalDownload;
        node.totalConnections += row.totalConnections;
        node.rules.add(rule);
        node.layer = Math.max(node.layer, i);
        rulePathNodes.get(rule)!.add(nodeName);
      }

      for (let i = 0; i < flowPath.length - 1; i++) {
        const sourceName = flowPath[i];
        const targetName = flowPath[i + 1];
        const linkKey = this.encodeFlowLinkKey(sourceName, targetName);
        if (!linkMap.has(linkKey)) linkMap.set(linkKey, new Set());
        linkMap.get(linkKey)!.add(rule);
        rulePathLinks.get(rule)!.add(linkKey);

        if (!outgoingByNode.has(sourceName)) outgoingByNode.set(sourceName, new Set());
        outgoingByNode.get(sourceName)!.add(targetName);
        if (!incomingByNode.has(targetName)) incomingByNode.set(targetName, new Set());
        incomingByNode.get(targetName)!.add(sourceName);
      }
    }

    // Determine node types and fix layer assignments
    const nodeEntries = Array.from(nodeMap.entries());
    const nodeTypeMap = new Map<string, 'rule' | 'group' | 'proxy'>();
    let computedMaxLayer = 0;

    const isBuiltInPolicy = (name: string): boolean =>
      name === 'DIRECT' || name === 'REJECT' || name === 'REJECT-TINY';

    for (const [name, data] of nodeEntries) {
      const hasOutgoing = (outgoingByNode.get(name)?.size ?? 0) > 0;
      const hasIncoming = (incomingByNode.get(name)?.size ?? 0) > 0;

      if (!hasIncoming) {
        nodeTypeMap.set(name, 'rule');
        data.layer = 0;
      } else if (!hasOutgoing && !isBuiltInPolicy(name)) {
        nodeTypeMap.set(name, 'proxy');
      } else {
        nodeTypeMap.set(name, 'group');
      }
      computedMaxLayer = Math.max(computedMaxLayer, data.layer);
    }

    // Force all proxy nodes to the rightmost column
    for (const [name, data] of nodeEntries) {
      if (nodeTypeMap.get(name) === 'proxy') data.layer = computedMaxLayer;
    }

    // Stable ordering for ReactFlow
    const nodeTypeOrder = (type: 'rule' | 'group' | 'proxy'): number =>
      type === 'rule' ? 0 : type === 'group' ? 1 : 2;

    const sortedNodeEntries = [...nodeEntries].sort(([nameA, dataA], [nameB, dataB]) => {
      if (dataA.layer !== dataB.layer) return dataA.layer - dataB.layer;
      const typeDiff = nodeTypeOrder(nodeTypeMap.get(nameA)!) - nodeTypeOrder(nodeTypeMap.get(nameB)!);
      if (typeDiff !== 0) return typeDiff;
      return nameA.localeCompare(nameB);
    });

    const nodes = sortedNodeEntries.map(([name, data]) => ({
      name, layer: data.layer, nodeType: nodeTypeMap.get(name)!,
      totalUpload: data.totalUpload, totalDownload: data.totalDownload,
      totalConnections: data.totalConnections, rules: Array.from(data.rules),
    }));

    const nodeIndexMap = new Map(nodes.map((n, i) => [n.name, i]));

    const links = Array.from(linkMap.entries())
      .map(([key, rules]) => {
        const decoded = this.decodeFlowLinkKey(key);
        if (!decoded) return null;
        const [sourceName, targetName] = decoded;
        const source = nodeIndexMap.get(sourceName);
        const target = nodeIndexMap.get(targetName);
        if (source === undefined || target === undefined) return null;
        return {
          sourceName,
          targetName,
          source,
          target,
          rules: Array.from(rules),
        };
      })
      .filter((link): link is {
        sourceName: string;
        targetName: string;
        source: number;
        target: number;
        rules: string[];
      } => !!link)
      .sort((a, b) => {
        const sourceDiff = a.sourceName.localeCompare(b.sourceName);
        if (sourceDiff !== 0) return sourceDiff;
        return a.targetName.localeCompare(b.targetName);
      })
      .map(({ source, target, rules }) => ({ source, target, rules }));

    const rulePaths: Record<string, { nodeIndices: number[]; linkIndices: number[] }> = {};
    for (const [rule, nodeNames] of rulePathNodes) {
      const nodeIndices = Array.from(nodeNames).map(n => nodeIndexMap.get(n)!).filter(i => i !== undefined);
      const linkIndices: number[] = [];
      const linkKeys = rulePathLinks.get(rule)!;
      links.forEach((link, idx) => {
        const sourceName = nodes[link.source].name;
        const targetName = nodes[link.target].name;
        if (linkKeys.has(this.encodeFlowLinkKey(sourceName, targetName))) linkIndices.push(idx);
      });
      rulePaths[rule] = { nodeIndices, linkIndices };
    }

    const maxLayer = nodes.reduce((max, n) => Math.max(max, n.layer), 0);
    return { nodes, links, rulePaths, maxLayer };
  }
}
