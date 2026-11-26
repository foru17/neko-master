/**
 * Pure helpers that combine per-backend stats into one merged view.
 *
 * Every function takes results that were already computed per backend
 * (persisted data with that backend's realtime deltas folded in) and combines
 * rows that share a key by summing their counters. Nothing here reads the
 * database, so all of it is covered by plain unit tests.
 */

import type {
  CountryStats,
  DeviceStats,
  DomainStats,
  HourlyStats,
  IPStats,
  ProxyStats,
  ProxyTrafficStats,
  RuleChainFlowAll,
  RuleStats,
  TrafficTrendPoint,
} from '@neko-master/shared';

interface TrafficCounters {
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
}

type MaybeLastSeen = { lastSeen?: string };

/**
 * Floor for the string unions (ips / rules / chains / domains) on a merged
 * row. A union is never cut below the longest list one backend already
 * carried, so merging only bounds growth and never drops single-source data.
 */
export const MERGED_UNION_FLOOR = 50;

/** Deduplicated union of several string lists, in first-seen order. */
export function unionStrings(
  values: ReadonlyArray<ReadonlyArray<string>>,
  floor = MERGED_UNION_FLOOR,
): string[] {
  let longest = 0;
  for (const list of values) {
    if (list.length > longest) longest = list.length;
  }
  const limit = Math.max(floor, longest);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of values) {
    for (const value of list) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Combines rows that share a key across `lists`: counters are summed, a
 * `lastSeen` string keeps the latest value and first-seen order is preserved.
 * `mergeRest` folds the remaining per-type fields into the combined row.
 */
export function mergeTrafficRows<T extends TrafficCounters>(
  lists: ReadonlyArray<ReadonlyArray<T>>,
  keyOf: (row: T) => string,
  mergeRest: (base: T, other: T) => void = () => undefined,
): T[] {
  const merged = new Map<string, T>();
  for (const list of lists) {
    for (const row of list) {
      const existing = merged.get(keyOf(row));
      if (!existing) {
        merged.set(keyOf(row), { ...row });
        continue;
      }
      existing.totalUpload += row.totalUpload;
      existing.totalDownload += row.totalDownload;
      existing.totalConnections += row.totalConnections;

      const base = existing as T & MaybeLastSeen;
      const other = row as T & MaybeLastSeen;
      if (other.lastSeen && (!base.lastSeen || other.lastSeen > base.lastSeen)) {
        base.lastSeen = other.lastSeen;
      }
      mergeRest(existing, row);
    }
  }
  return Array.from(merged.values());
}

/** Sorts by total traffic, descending, with the key as a stable tie-break. */
export function sortByTrafficDesc<T extends TrafficCounters>(rows: T[], keyOf: (row: T) => string): T[] {
  return rows.sort((a, b) => {
    const diff = b.totalDownload + b.totalUpload - (a.totalDownload + a.totalUpload);
    if (diff !== 0) return diff;
    const keyA = keyOf(a);
    const keyB = keyOf(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
}

export function mergeDomainRows(lists: ReadonlyArray<ReadonlyArray<DomainStats>>): DomainStats[] {
  const rows = mergeTrafficRows(lists, (row) => row.domain, (base, other) => {
    base.ips = unionStrings([base.ips, other.ips]);
    base.rules = unionStrings([base.rules, other.rules]);
    base.chains = unionStrings([base.chains, other.chains]);
  });
  return sortByTrafficDesc(rows, (row) => row.domain);
}

export function mergeIPRows(lists: ReadonlyArray<ReadonlyArray<IPStats>>): IPStats[] {
  const rows = mergeTrafficRows(lists, (row) => row.ip, (base, other) => {
    base.domains = unionStrings([base.domains, other.domains]);
    if (other.chains?.length) base.chains = unionStrings([base.chains ?? [], other.chains]);
    if (!base.asn && other.asn) base.asn = other.asn;
    if (!base.geoIP && other.geoIP) base.geoIP = other.geoIP;
  });
  return sortByTrafficDesc(rows, (row) => row.ip);
}

export function mergeProxyRows(lists: ReadonlyArray<ReadonlyArray<ProxyStats>>): ProxyStats[] {
  return sortByTrafficDesc(
    mergeTrafficRows(lists, (row) => row.chain),
    (row) => row.chain,
  );
}

export function mergeDeviceRows(lists: ReadonlyArray<ReadonlyArray<DeviceStats>>): DeviceStats[] {
  return sortByTrafficDesc(
    mergeTrafficRows(lists, (row) => row.sourceIP),
    (row) => row.sourceIP,
  );
}

export function mergeRuleRows(lists: ReadonlyArray<ReadonlyArray<RuleStats>>): RuleStats[] {
  // The per-backend merge keeps the last non-empty finalProxy; same here.
  const rows = mergeTrafficRows(lists, (row) => row.rule, (base, other) => {
    if (other.finalProxy) base.finalProxy = other.finalProxy;
  });
  return sortByTrafficDesc(rows, (row) => row.rule);
}

export function mergeCountryRows(lists: ReadonlyArray<ReadonlyArray<CountryStats>>): CountryStats[] {
  const rows = mergeTrafficRows(lists, (row) => row.country, (base, other) => {
    if (!base.countryName && other.countryName) base.countryName = other.countryName;
    if (!base.continent && other.continent) base.continent = other.continent;
  });
  return sortByTrafficDesc(rows, (row) => row.country);
}

export function mergeProxyTrafficRows(lists: ReadonlyArray<ReadonlyArray<ProxyTrafficStats>>): ProxyTrafficStats[] {
  return sortByTrafficDesc(
    mergeTrafficRows(lists, (row) => row.chain),
    (row) => row.chain,
  );
}

/** Merges `{ rule, proxies }` mappings by rule name. */
export function mergeRuleProxyMaps(
  lists: ReadonlyArray<ReadonlyArray<{ rule: string; proxies: string[] }>>,
): Array<{ rule: string; proxies: string[] }> {
  const merged = new Map<string, { rule: string; proxies: string[] }>();
  for (const list of lists) {
    for (const row of list) {
      const existing = merged.get(row.rule);
      if (existing) {
        existing.proxies = unionStrings([existing.proxies, row.proxies]);
      } else {
        merged.set(row.rule, { rule: row.rule, proxies: [...row.proxies] });
      }
    }
  }
  return Array.from(merged.values());
}

export function mergeHourlyStats(lists: ReadonlyArray<ReadonlyArray<HourlyStats>>): HourlyStats[] {
  const merged = new Map<string, HourlyStats>();
  for (const list of lists) {
    for (const row of list) {
      const existing = merged.get(row.hour);
      if (existing) {
        existing.upload += row.upload;
        existing.download += row.download;
        existing.connections += row.connections;
      } else {
        merged.set(row.hour, { ...row });
      }
    }
  }
  // Sources come back newest first (ORDER BY hour DESC); keep that order.
  return Array.from(merged.values()).sort((a, b) => (a.hour < b.hour ? 1 : a.hour > b.hour ? -1 : 0));
}

export function mergeTrendPoints(lists: ReadonlyArray<ReadonlyArray<TrafficTrendPoint>>): TrafficTrendPoint[] {
  const merged = new Map<string, TrafficTrendPoint>();
  for (const list of lists) {
    for (const row of list) {
      const existing = merged.get(row.time);
      if (existing) {
        existing.upload += row.upload;
        existing.download += row.download;
      } else {
        merged.set(row.time, { ...row });
      }
    }
  }
  // Trend series are ascending by time.
  return Array.from(merged.values()).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

// ==================== Paged tables ====================

export interface PageSortOptions {
  sortBy?: string;
  sortOrder?: string;
}

type PageRow = TrafficCounters & MaybeLastSeen & { domain?: string; ip?: string };

function pageSortValue(row: PageRow, sortBy: string | undefined): string | number {
  switch (sortBy) {
    case 'domain':
      return row.domain ?? '';
    case 'ip':
      return row.ip ?? '';
    case 'totalUpload':
      return row.totalUpload;
    case 'totalTraffic':
      return row.totalUpload + row.totalDownload;
    case 'totalConnections':
      return row.totalConnections;
    case 'lastSeen':
      return row.lastSeen ?? '';
    case 'totalDownload':
    default:
      return row.totalDownload;
  }
}

/**
 * Orders merged page rows like the SQL of the per-backend queries (default:
 * totalDownload, descending) and breaks ties by key, so a page stays stable
 * while realtime deltas move rows around.
 *
 * The merged page is only as correct as this order: a member is scanned from
 * the top of its own SQL ordering, so a row that sorts lower here than in SQL
 * could fall outside the scanned range. Keep the keys and directions in step
 * with sortColumnMap in the repositories. The one known difference is text
 * collation (SQLite compares UTF-8 bytes, JavaScript UTF-16 code units), which
 * only matters for characters outside the Basic Multilingual Plane.
 */
export function comparePageRows<T extends PageRow>(
  a: T,
  b: T,
  keyOf: (row: T) => string,
  options: PageSortOptions,
): number {
  const direction = options.sortOrder === 'asc' ? 1 : -1;
  const valueA = pageSortValue(a, options.sortBy);
  const valueB = pageSortValue(b, options.sortBy);
  if (valueA < valueB) return -direction;
  if (valueA > valueB) return direction;
  const keyA = keyOf(a);
  const keyB = keyOf(b);
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

// ==================== Rule chain graphs ====================

type ChainFlowNode = RuleChainFlowAll['nodes'][number];

/** Single-rule chain flow: `{ nodes, links }` without layers or rule paths. */
export interface RuleChainFlow {
  nodes: Array<{ name: string; totalUpload: number; totalDownload: number; totalConnections: number }>;
  links: Array<{ source: number; target: number }>;
}

// Mirrors the builder in RuleRepository.getAllRuleChainFlows.
const BUILT_IN_POLICIES = new Set(['DIRECT', 'REJECT', 'REJECT-TINY']);
const NODE_TYPE_ORDER: Record<ChainFlowNode['nodeType'], number> = { rule: 0, group: 1, proxy: 2 };

function flowLinkKey(source: string, target: string): string {
  return `${source}\u0000${target}`;
}

/**
 * Combines several rule chain graphs. Nodes are matched by name and their
 * traffic summed; links are matched by node names, so every index is rebuilt
 * for the merged graph. Node types follow the same rules as the per-backend
 * builder, applied to the merged links.
 */
export function mergeRuleChainFlowAll(
  flows: ReadonlyArray<RuleChainFlowAll | null | undefined>,
): RuleChainFlowAll {
  const nodes = new Map<string, Omit<ChainFlowNode, 'rules'> & { rules: Set<string> }>();
  const links = new Map<string, { source: string; target: string; rules: Set<string> }>();
  const rulePathNodes = new Map<string, Set<string>>();
  const rulePathLinks = new Map<string, Set<string>>();

  for (const flow of flows) {
    if (!flow) continue;
    const nodeName = (index: number): string | undefined => flow.nodes[index]?.name;

    for (const node of flow.nodes) {
      const existing = nodes.get(node.name);
      if (existing) {
        existing.totalUpload += node.totalUpload;
        existing.totalDownload += node.totalDownload;
        existing.totalConnections += node.totalConnections;
        // A node sits at its deepest position across all paths; same across backends.
        existing.layer = Math.max(existing.layer, node.layer);
        for (const rule of node.rules) existing.rules.add(rule);
      } else {
        nodes.set(node.name, { ...node, rules: new Set(node.rules) });
      }
    }

    for (const link of flow.links) {
      const source = nodeName(link.source);
      const target = nodeName(link.target);
      if (source === undefined || target === undefined) continue;
      const key = flowLinkKey(source, target);
      let mergedLink = links.get(key);
      if (!mergedLink) {
        mergedLink = { source, target, rules: new Set<string>() };
        links.set(key, mergedLink);
      }
      for (const rule of link.rules) mergedLink.rules.add(rule);
    }

    for (const [rule, path] of Object.entries(flow.rulePaths)) {
      let pathNodes = rulePathNodes.get(rule);
      if (!pathNodes) {
        pathNodes = new Set<string>();
        rulePathNodes.set(rule, pathNodes);
      }
      for (const index of path.nodeIndices) {
        const name = nodeName(index);
        if (name !== undefined) pathNodes.add(name);
      }

      let pathLinks = rulePathLinks.get(rule);
      if (!pathLinks) {
        pathLinks = new Set<string>();
        rulePathLinks.set(rule, pathLinks);
      }
      for (const index of path.linkIndices) {
        const link = flow.links[index];
        if (!link) continue;
        const source = nodeName(link.source);
        const target = nodeName(link.target);
        if (source !== undefined && target !== undefined) pathLinks.add(flowLinkKey(source, target));
      }
    }
  }

  // Same classification as the per-backend builder, on the merged links.
  const hasOutgoing = new Set<string>();
  const hasIncoming = new Set<string>();
  for (const link of links.values()) {
    hasOutgoing.add(link.source);
    hasIncoming.add(link.target);
  }
  const nodeTypes = new Map<string, ChainFlowNode['nodeType']>();
  let maxLayer = 0;
  for (const [name, node] of nodes) {
    if (!hasIncoming.has(name)) {
      nodeTypes.set(name, 'rule');
      node.layer = 0;
    } else if (!hasOutgoing.has(name) && !BUILT_IN_POLICIES.has(name)) {
      nodeTypes.set(name, 'proxy');
    } else {
      nodeTypes.set(name, 'group');
    }
    maxLayer = Math.max(maxLayer, node.layer);
  }
  // Proxy nodes always sit in the rightmost column.
  for (const [name, node] of nodes) {
    if (nodeTypes.get(name) === 'proxy') node.layer = maxLayer;
  }

  // Stable ordering for ReactFlow: layer, then node type, then name.
  const sortedNodes = Array.from(nodes.entries()).sort(([nameA, a], [nameB, b]) => {
    if (a.layer !== b.layer) return a.layer - b.layer;
    const typeDiff = NODE_TYPE_ORDER[nodeTypes.get(nameA)!] - NODE_TYPE_ORDER[nodeTypes.get(nameB)!];
    if (typeDiff !== 0) return typeDiff;
    return nameA.localeCompare(nameB);
  });

  const indexByName = new Map<string, number>();
  const mergedNodes = sortedNodes.map(([name, node]) => {
    indexByName.set(name, indexByName.size);
    return {
      name,
      layer: node.layer,
      nodeType: nodeTypes.get(name)!,
      totalUpload: node.totalUpload,
      totalDownload: node.totalDownload,
      totalConnections: node.totalConnections,
      rules: Array.from(node.rules),
    };
  });

  const orderedLinks = Array.from(links.values()).sort((a, b) => {
    const bySource = a.source.localeCompare(b.source);
    return bySource !== 0 ? bySource : a.target.localeCompare(b.target);
  });
  const linkKeys = orderedLinks.map((link) => flowLinkKey(link.source, link.target));
  const mergedLinks = orderedLinks.map((link) => ({
    source: indexByName.get(link.source)!,
    target: indexByName.get(link.target)!,
    rules: Array.from(link.rules),
  }));

  const rulePaths: RuleChainFlowAll['rulePaths'] = {};
  for (const [rule, pathNodes] of rulePathNodes) {
    const nodeIndices = Array.from(pathNodes)
      .map((name) => indexByName.get(name))
      .filter((index): index is number => index !== undefined);
    const linkIndices: number[] = [];
    const pathLinks = rulePathLinks.get(rule) ?? new Set<string>();
    linkKeys.forEach((key, index) => {
      if (pathLinks.has(key)) linkIndices.push(index);
    });
    rulePaths[rule] = { nodeIndices, linkIndices };
  }

  return {
    nodes: mergedNodes,
    links: mergedLinks,
    rulePaths,
    maxLayer: mergedNodes.reduce((max, node) => Math.max(max, node.layer), 0),
  };
}

/** Combines single-rule chain flows; indices are rebuilt for the merged graph. */
export function mergeRuleChainFlow(
  flows: ReadonlyArray<RuleChainFlow | null | undefined>,
): RuleChainFlow {
  const nodes = new Map<string, RuleChainFlow['nodes'][number]>();
  const linkKeys = new Set<string>();
  for (const flow of flows) {
    if (!flow) continue;
    for (const node of flow.nodes) {
      const existing = nodes.get(node.name);
      if (existing) {
        existing.totalUpload += node.totalUpload;
        existing.totalDownload += node.totalDownload;
        existing.totalConnections += node.totalConnections;
      } else {
        nodes.set(node.name, { ...node });
      }
    }
    for (const link of flow.links) {
      const source = flow.nodes[link.source]?.name;
      const target = flow.nodes[link.target]?.name;
      if (source !== undefined && target !== undefined) linkKeys.add(flowLinkKey(source, target));
    }
  }

  const indexByName = new Map<string, number>();
  for (const name of nodes.keys()) {
    indexByName.set(name, indexByName.size);
  }
  return {
    nodes: Array.from(nodes.values()),
    links: Array.from(linkKeys).map((key) => {
      const [source, target] = key.split('\u0000');
      return { source: indexByName.get(source)!, target: indexByName.get(target)! };
    }),
  };
}
