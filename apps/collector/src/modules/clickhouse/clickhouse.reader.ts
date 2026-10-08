import type {
  DomainStats,
  HourlyStats,
  IPStats,
  ProxyStats,
  RuleStats,
} from '@neko-master/shared';
import { loadClickHouseConfig } from './clickhouse.config.js';

type StatsQuerySource = 'sqlite' | 'clickhouse' | 'auto';

type RuleChainTrafficRow = {
  rule: string;
  chain: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
};

type RuleChainFlow = {
  nodes: Array<{
    name: string;
    totalUpload: number;
    totalDownload: number;
    totalConnections: number;
  }>;
  links: Array<{ source: number; target: number }>;
};

type RuleChainFlowAll = {
  nodes: Array<{
    name: string;
    layer: number;
    nodeType: 'rule' | 'group' | 'proxy';
    totalUpload: number;
    totalDownload: number;
    totalConnections: number;
    rules: string[];
  }>;
  links: Array<{ source: number; target: number; rules: string[] }>;
  rulePaths: Record<string, { nodeIndices: number[]; linkIndices: number[] }>;
  maxLayer: number;
};

export type ClickHouseSummary = {
  totalConnections: number;
  totalUpload: number;
  totalDownload: number;
  uniqueDomains: number;
  uniqueIPs: number;
};

export class ClickHouseReader {
  private readonly config = loadClickHouseConfig();
  private readonly source = this.parseSource(process.env.STATS_QUERY_SOURCE);
  private readonly strictStats = process.env.CH_STRICT_STATS === '1';

  shouldUse(): boolean {
    if (!this.config.enabled) return false;
    return this.source !== 'sqlite';
  }

  shouldUseForRange(start?: string, end?: string): boolean {
    if (!this.shouldUse()) return false;
    if (!start || !end) return false;
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= endMs;
  }

  async getSummary(
    backendId: number,
    start: string,
    end: string,
  ): Promise<ClickHouseSummary | null> {
    // SUM from lightweight agg table; unique counts from detail table
    const [aggRows, detailRows] = await Promise.all([
      this.query<Record<string, unknown>>(`
SELECT
  toUInt64(COALESCE(SUM(connections), 0)) AS totalConnections,
  toUInt64(COALESCE(SUM(upload), 0)) AS totalUpload,
  toUInt64(COALESCE(SUM(download), 0)) AS totalDownload
FROM ${this.config.database}.traffic_agg_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
`),
      this.query<Record<string, unknown>>(`
SELECT
  toUInt64(uniqIf(domain, domain != '')) AS uniqueDomains,
  toUInt64(uniqIf(ip, ip != '')) AS uniqueIPs
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
`),
    ]);
    if (!aggRows || !detailRows) return null;
    const agg = aggRows[0] || {};
    const detail = detailRows[0] || {};
    const rows: ClickHouseSummary[] = [{
      totalConnections: Number(agg.totalConnections || 0),
      totalUpload: Number(agg.totalUpload || 0),
      totalDownload: Number(agg.totalDownload || 0),
      uniqueDomains: Number(detail.uniqueDomains || 0),
      uniqueIPs: Number(detail.uniqueIPs || 0),
    }];
    return rows?.[0] || null;
  }

  async getTopDomainsLight(
    backendId: number,
    limit: number,
    start: string,
    end: string,
  ): Promise<DomainStats[] | null> {
    const rows = await this.query<Record<string, unknown>>(`
SELECT
  domain,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections,
  toString(max(minute)) AS lastSeen
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
  AND domain != ''
GROUP BY domain
ORDER BY (SUM(upload) + SUM(download)) DESC
LIMIT ${Math.max(1, limit)}
`);
    if (!rows) return null;
    return (rows as Array<any>).map((row) => ({
      domain: String(row.domain || ''),
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
      lastSeen: String(row.lastSeen || ''),
      ips: [],
      rules: [],
      chains: [],
    }));
  }

  async getTopIPsLight(
    backendId: number,
    limit: number,
    start: string,
    end: string,
  ): Promise<IPStats[] | null> {
    const rows = await this.query<Record<string, unknown>>(`
SELECT
  ip,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections,
  toString(max(minute)) AS lastSeen
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
  AND ip != ''
GROUP BY ip
ORDER BY (SUM(upload) + SUM(download)) DESC
LIMIT ${Math.max(1, limit)}
`);
    if (!rows) return null;
    return (rows as Array<any>).map((row) => ({
      ip: String(row.ip || ''),
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
      lastSeen: String(row.lastSeen || ''),
      domains: [],
      chains: [],
    }));
  }

  async getHourlyStats(
    backendId: number,
    hours: number,
    start: string,
    end: string,
  ): Promise<HourlyStats[] | null> {
    const rows = await this.query<Record<string, unknown>>(`
SELECT
  toString(toStartOfHour(minute)) AS hour,
  toUInt64(SUM(upload)) AS upload,
  toUInt64(SUM(download)) AS download,
  toUInt64(SUM(connections)) AS connections
FROM ${this.config.database}.traffic_agg_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
GROUP BY hour
ORDER BY hour DESC
LIMIT ${Math.max(1, hours)}
`);
    if (!rows) return null;
    return (rows as Array<any>).map((row) => ({
      hour: String(row.hour || ''),
      upload: Number(row.upload || 0),
      download: Number(row.download || 0),
      connections: Number(row.connections || 0),
    }));
  }

  async getCountryStats(
    backendId: number,
    limit: number,
    start: string,
    end: string,
  ): Promise<
    Array<{
      country: string;
      countryName: string;
      continent: string;
      totalUpload: number;
      totalDownload: number;
      totalConnections: number;
    }> | null
  > {
    const rows = await this.query<Record<string, unknown>>(`
SELECT
  country,
  any(country_name) AS countryName,
  any(continent) AS continent,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections
FROM ${this.config.database}.country_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
GROUP BY country
ORDER BY (SUM(upload) + SUM(download)) DESC
LIMIT ${Math.max(1, limit)}
`);
    if (!rows) return null;
    return (rows as Array<any>).map((row) => ({
      country: String(row.country || 'UNKNOWN'),
      countryName: String(row.countryName || row.country || 'Unknown'),
      continent: String(row.continent || 'Unknown'),
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
    }));
  }

  async getTrafficInRange(
    backendId: number,
    start: string,
    end: string,
  ): Promise<{ upload: number; download: number } | null> {
    const rows = await this.query<Record<string, unknown>>(`
SELECT
  toUInt64(COALESCE(SUM(upload), 0)) AS upload,
  toUInt64(COALESCE(SUM(download), 0)) AS download
FROM ${this.config.database}.traffic_agg_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
`);
    if (!rows || rows.length === 0) return null;
    const first = rows[0] as Record<string, unknown>;
    return {
      upload: Number(first.upload || 0),
      download: Number(first.download || 0),
    };
  }

  async getTrafficTrend(
    backendId: number,
    start: string,
    end: string,
  ): Promise<Array<{ time: string; upload: number; download: number }> | null> {
    const rows = await this.query<Record<string, unknown>>(`
SELECT
  toString(minute) AS time,
  toUInt64(SUM(upload)) AS upload,
  toUInt64(SUM(download)) AS download
FROM ${this.config.database}.traffic_agg_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
GROUP BY minute
ORDER BY minute ASC
`);
    if (!rows) return null;
    return (rows as Array<any>).map((row) => ({
      time: String(row.time || ''),
      upload: Number(row.upload || 0),
      download: Number(row.download || 0),
    }));
  }

  async getTrafficTrendAggregated(
    backendId: number,
    bucketMinutes: number,
    start: string,
    end: string,
    tzOffsetMinutes = 0,
  ): Promise<Array<{ time: string; upload: number; download: number }> | null> {
    const safeBucket = Math.max(1, Math.floor(bucketMinutes));
    // Interpolated into SQL below, so never trust the caller to have clamped it.
    const safeOffset = Number.isFinite(tzOffsetMinutes)
      ? Math.max(-840, Math.min(840, Math.trunc(tzOffsetMinutes)))
      : 0;
    const useLocalDay = safeBucket >= 1440 && safeOffset !== 0;
    const offsetSeconds = safeOffset * 60;
    const bucketExpr = useLocalDay
      ? `toDateTime(toInt64(floor((toInt64(toUnixTimestamp(minute)) + (${offsetSeconds})) / 86400) * 86400 - (${offsetSeconds})), 'UTC')`
      : safeBucket <= 1
        ? 'minute'
        : `toStartOfInterval(minute, INTERVAL ${safeBucket} MINUTE)`;

    const rows = await this.query<Record<string, unknown>>(`
SELECT
  toString(${bucketExpr}) AS time,
  toUInt64(SUM(upload)) AS upload,
  toUInt64(SUM(download)) AS download
FROM ${this.config.database}.traffic_agg_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
GROUP BY time
ORDER BY time ASC
`);
    if (!rows) return null;
    return (rows as Array<any>).map((row) => ({
      time: useLocalDay ? String(row.time || '').replace(' ', 'T') : String(row.time || ''),
      upload: Number(row.upload || 0),
      download: Number(row.download || 0),
    }));
  }

  async getDomainStatsPaginated(
    backendId: number,
    start: string,
    end: string,
    opts: {
      offset?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: string;
      search?: string;
    },
  ): Promise<{ data: DomainStats[]; total: number } | null> {
    const offset = Math.max(0, opts.offset || 0);
    const limit = Math.max(1, Math.min(200, opts.limit || 50));
    const sortOrder = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const sortExprMap: Record<string, string> = {
      domain: 'domain',
      totalUpload: 'totalUpload',
      totalDownload: 'totalDownload',
      totalTraffic: '(totalUpload + totalDownload)',
      totalConnections: 'totalConnections',
      lastSeen: 'lastSeen',
    };
    const sortExpr = sortExprMap[opts.sortBy || 'totalDownload'] || 'totalDownload';
    const searchClause = opts.search
      ? ` AND positionCaseInsensitive(domain, '${this.esc(opts.search)}') > 0`
      : '';

    const totalRows = await this.query<Record<string, unknown>>(`
SELECT toUInt64(COUNT()) AS total
FROM (
  SELECT domain
  FROM ${this.config.database}.traffic_detail_buffer
  WHERE backend_id = ${backendId}
    AND minute >= toDateTime('${this.toDateTime(start)}')
    AND minute <= toDateTime('${this.toDateTime(end)}')
    AND domain != '' ${searchClause}
  GROUP BY domain
)
`);

    const rows = await this.query<Record<string, unknown>>(`
SELECT
  domain,
  arrayDistinct(groupArrayIf(ip, ip != '')) AS ips,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections,
  toString(max(minute)) AS lastSeen,
  arrayDistinct(groupArrayIf(rule, rule != '')) AS rules,
  arrayDistinct(groupArrayIf(chain, chain != '')) AS chains
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
  AND domain != '' ${searchClause}
GROUP BY domain
ORDER BY ${sortExpr} ${sortOrder}
LIMIT ${limit} OFFSET ${offset}
`);
    if (!rows || !totalRows) return null;

    const total = Number(totalRows[0]?.total || 0);
    const data = (rows as Array<any>).map((row) => ({
      domain: String(row.domain || ''),
      ips: Array.isArray(row.ips) ? row.ips.map(String) : [],
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
      lastSeen: String(row.lastSeen || ''),
      rules: Array.isArray(row.rules) ? row.rules.map(String) : [],
      chains: Array.isArray(row.chains) ? row.chains.map(String) : [],
    })) as DomainStats[];

    return { data, total };
  }

  async getIPStatsPaginated(
    backendId: number,
    start: string,
    end: string,
    opts: {
      offset?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: string;
      search?: string;
    },
  ): Promise<{ data: IPStats[]; total: number } | null> {
    const offset = Math.max(0, opts.offset || 0);
    const limit = Math.max(1, Math.min(200, opts.limit || 50));
    const sortOrder = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const sortExprMap: Record<string, string> = {
      ip: 'ip',
      totalUpload: 'totalUpload',
      totalDownload: 'totalDownload',
      totalTraffic: '(totalUpload + totalDownload)',
      totalConnections: 'totalConnections',
      lastSeen: 'lastSeen',
    };
    const sortExpr = sortExprMap[opts.sortBy || 'totalDownload'] || 'totalDownload';
    const searchClause = opts.search
      ? ` AND (positionCaseInsensitive(ip, '${this.esc(opts.search)}') > 0 OR positionCaseInsensitive(domain, '${this.esc(opts.search)}') > 0)`
      : '';

    const totalRows = await this.query<Record<string, unknown>>(`
SELECT toUInt64(COUNT()) AS total
FROM (
  SELECT ip
  FROM ${this.config.database}.traffic_detail_buffer
  WHERE backend_id = ${backendId}
    AND minute >= toDateTime('${this.toDateTime(start)}')
    AND minute <= toDateTime('${this.toDateTime(end)}')
    AND ip != '' ${searchClause}
  GROUP BY ip
)
`);

    const rows = await this.query<Record<string, unknown>>(`
SELECT
  ip,
  arrayDistinct(groupArrayIf(domain, domain != '')) AS domains,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections,
  toString(max(minute)) AS lastSeen,
  arrayDistinct(groupArrayIf(chain, chain != '')) AS chains
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
  AND ip != '' ${searchClause}
GROUP BY ip
ORDER BY ${sortExpr} ${sortOrder}
LIMIT ${limit} OFFSET ${offset}
`);
    if (!rows || !totalRows) return null;

    const total = Number(totalRows[0]?.total || 0);
    const data = (rows as Array<any>).map((row) => ({
      ip: String(row.ip || ''),
      domains: Array.isArray(row.domains) ? row.domains.map(String) : [],
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
      lastSeen: String(row.lastSeen || ''),
      chains: Array.isArray(row.chains) ? row.chains.map(String) : [],
    })) as IPStats[];

    return { data, total };
  }

  async getProxyStats(
    backendId: number,
    start: string,
    end: string,
  ): Promise<ProxyStats[] | null> {
    const rows = await this.query<Record<string, unknown>>(`
SELECT
  arrayElement(splitByString(' > ', chain), 1) AS proxy_name,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections,
  toString(max(minute)) AS lastSeen
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
GROUP BY proxy_name
ORDER BY (SUM(upload) + SUM(download)) DESC
`);
    if (!rows) return null;
    return rows.map((row) => ({
      chain: String(row.proxy_name || ''),
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
      lastSeen: String(row.lastSeen || ''),
    }));
  }

  async getRuleStats(
    backendId: number,
    start: string,
    end: string,
  ): Promise<RuleStats[] | null> {
    const rows = await this.query<Record<string, unknown>>(`
SELECT
  rule,
  arrayElement(splitByString(' > ', any(chain)), 1) AS finalProxy,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections,
  toString(max(minute)) AS lastSeen
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
  AND rule != ''
GROUP BY rule
ORDER BY (SUM(upload) + SUM(download)) DESC
`);
    if (!rows) return null;
    return rows.map((row) => ({
      rule: String(row.rule || ''),
      finalProxy: String(row.finalProxy || ''),
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
      lastSeen: String(row.lastSeen || ''),
    }));
  }

  async getGlobalSummary(backendCount: number): Promise<{
    totalConnections: number;
    totalUpload: number;
    totalDownload: number;
    uniqueDomains: number;
    uniqueIPs: number;
    backendCount: number;
  } | null> {
    const [aggRows, detailRows] = await Promise.all([
      this.query<Record<string, unknown>>(`
SELECT
  toUInt64(COALESCE(SUM(connections), 0)) AS totalConnections,
  toUInt64(COALESCE(SUM(upload), 0)) AS totalUpload,
  toUInt64(COALESCE(SUM(download), 0)) AS totalDownload
FROM ${this.config.database}.traffic_agg_buffer
WHERE minute >= now() - INTERVAL 90 DAY
`),
      this.query<Record<string, unknown>>(`
SELECT
  toUInt64(uniqIf(domain, domain != '')) AS uniqueDomains,
  toUInt64(uniqIf(ip, ip != '')) AS uniqueIPs
FROM ${this.config.database}.traffic_detail_buffer
WHERE minute >= now() - INTERVAL 90 DAY
`),
    ]);
    const rows = aggRows && detailRows ? [{
      totalConnections: (aggRows[0] as any)?.totalConnections || 0,
      totalUpload: (aggRows[0] as any)?.totalUpload || 0,
      totalDownload: (aggRows[0] as any)?.totalDownload || 0,
      uniqueDomains: (detailRows[0] as any)?.uniqueDomains || 0,
      uniqueIPs: (detailRows[0] as any)?.uniqueIPs || 0,
    }] : null;
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    return {
      totalConnections: Number(row.totalConnections || 0),
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      uniqueDomains: Number(row.uniqueDomains || 0),
      uniqueIPs: Number(row.uniqueIPs || 0),
      backendCount,
    };
  }

  async getRuleProxyMap(
    backendId: number,
    start?: string,
    end?: string,
  ): Promise<Array<{ rule: string; proxies: string[] }> | null> {
    const timeWhere = this.buildTimeWhere(start, end);
    const rows = await this.query<Record<string, unknown>>(`
SELECT
  rule,
  groupUniqArray(arrayElement(splitByString(' > ', chain), 1)) AS proxies
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND rule != ''
  AND chain != ''${timeWhere}
GROUP BY rule
ORDER BY rule ASC
`);
    if (!rows) return null;
    return rows.map((row) => ({
      rule: String(row.rule || ''),
      proxies: Array.isArray(row.proxies)
        ? row.proxies.map(String).filter(Boolean).sort((a, b) => a.localeCompare(b))
        : [],
    }));
  }

  async getRuleChainFlow(
    backendId: number,
    rule: string,
    start?: string,
    end?: string,
    realtimeRows?: Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>,
  ): Promise<RuleChainFlow | null> {
    const rawRows = await this.getRuleChainTrafficRows(backendId, start, end, rule);
    if (rawRows === null) return null;
    const rows = [...rawRows];

    if (realtimeRows) {
      for (const rt of realtimeRows) {
        if (rt.rule !== rule) continue;
        const index = rows.findIndex((r) => r.chain === rt.chain);
        if (index >= 0) {
          rows[index].totalUpload += rt.totalUpload;
          rows[index].totalDownload += rt.totalDownload;
          rows[index].totalConnections += rt.totalConnections;
        } else {
          rows.push({
            rule: rt.rule,
            chain: rt.chain,
            totalUpload: rt.totalUpload,
            totalDownload: rt.totalDownload,
            totalConnections: rt.totalConnections,
          });
        }
      }
    }

    if (rows.length === 0) {
      return { nodes: [], links: [] };
    }

    const nodeMap = new Map<
      string,
      {
        name: string;
        totalUpload: number;
        totalDownload: number;
        totalConnections: number;
      }
    >();
    const linkSet = new Set<string>();

    for (const row of rows) {
      const flowPath = this.buildRuleFlowPath(rule, row.chain);
      if (flowPath.length < 2) continue;

      for (let index = 0; index < flowPath.length; index += 1) {
        const nodeName = flowPath[index];
        if (!nodeMap.has(nodeName)) {
          nodeMap.set(nodeName, {
            name: nodeName,
            totalUpload: 0,
            totalDownload: 0,
            totalConnections: 0,
          });
        }
        const node = nodeMap.get(nodeName)!;
        node.totalUpload += row.totalUpload;
        node.totalDownload += row.totalDownload;
        node.totalConnections += row.totalConnections;
      }

      for (let index = 0; index < flowPath.length - 1; index += 1) {
        linkSet.add(this.encodeFlowLinkKey(flowPath[index], flowPath[index + 1]));
      }
    }

    const nodes = Array.from(nodeMap.values());
    const nodeIndexMap = new Map(nodes.map((node, index) => [node.name, index]));
    const links = Array.from(linkSet)
      .map((linkKey) => {
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

  async getAllRuleChainFlows(
    backendId: number,
    start?: string,
    end?: string,
    realtimeRows?: Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>,
  ): Promise<RuleChainFlowAll | null> {
    const rawRows = await this.getRuleChainTrafficRows(backendId, start, end);
    if (rawRows === null) return null;
    const rows = [...rawRows];

    if (realtimeRows) {
      for (const rt of realtimeRows) {
        const index = rows.findIndex((r) => r.rule === rt.rule && r.chain === rt.chain);
        if (index >= 0) {
          rows[index].totalUpload += rt.totalUpload;
          rows[index].totalDownload += rt.totalDownload;
          rows[index].totalConnections += rt.totalConnections;
        } else {
          rows.push({
            rule: rt.rule,
            chain: rt.chain,
            totalUpload: rt.totalUpload,
            totalDownload: rt.totalDownload,
            totalConnections: rt.totalConnections,
          });
        }
      }
    }

    if (rows.length === 0) {
      return { nodes: [], links: [], rulePaths: {}, maxLayer: 0 };
    }

    const nodeMap = new Map<
      string,
      {
        totalUpload: number;
        totalDownload: number;
        totalConnections: number;
        rules: Set<string>;
        layer: number;
      }
    >();
    const linkMap = new Map<string, Set<string>>();
    const rulePathNodes = new Map<string, Set<string>>();
    const rulePathLinks = new Map<string, Set<string>>();
    const outgoingByNode = new Map<string, Set<string>>();
    const incomingByNode = new Map<string, Set<string>>();

    for (const row of rows) {
      const ruleName = row.rule;
      if (!rulePathNodes.has(ruleName)) {
        rulePathNodes.set(ruleName, new Set());
        rulePathLinks.set(ruleName, new Set());
      }

      const flowPath = this.buildRuleFlowPath(ruleName, row.chain);
      if (flowPath.length < 2) continue;

      for (let index = 0; index < flowPath.length; index += 1) {
        const nodeName = flowPath[index];
        if (!nodeMap.has(nodeName)) {
          nodeMap.set(nodeName, {
            totalUpload: 0,
            totalDownload: 0,
            totalConnections: 0,
            rules: new Set(),
            layer: index,
          });
        }
        const node = nodeMap.get(nodeName)!;
        node.totalUpload += row.totalUpload;
        node.totalDownload += row.totalDownload;
        node.totalConnections += row.totalConnections;
        node.rules.add(ruleName);
        node.layer = Math.max(node.layer, index);
        rulePathNodes.get(ruleName)!.add(nodeName);
      }

      for (let index = 0; index < flowPath.length - 1; index += 1) {
        const sourceName = flowPath[index];
        const targetName = flowPath[index + 1];
        const linkKey = this.encodeFlowLinkKey(sourceName, targetName);
        if (!linkMap.has(linkKey)) {
          linkMap.set(linkKey, new Set());
        }
        linkMap.get(linkKey)!.add(ruleName);
        rulePathLinks.get(ruleName)!.add(linkKey);

        if (!outgoingByNode.has(sourceName)) {
          outgoingByNode.set(sourceName, new Set());
        }
        outgoingByNode.get(sourceName)!.add(targetName);

        if (!incomingByNode.has(targetName)) {
          incomingByNode.set(targetName, new Set());
        }
        incomingByNode.get(targetName)!.add(sourceName);
      }
    }

    const nodeEntries = Array.from(nodeMap.entries());
    const nodeTypeMap = new Map<string, 'rule' | 'group' | 'proxy'>();
    let computedMaxLayer = 0;

    const isBuiltInPolicy = (name: string): boolean =>
      name === 'DIRECT' || name === 'REJECT' || name === 'REJECT-TINY';

    for (const [name, nodeData] of nodeEntries) {
      const hasOutgoing = (outgoingByNode.get(name)?.size ?? 0) > 0;
      const hasIncoming = (incomingByNode.get(name)?.size ?? 0) > 0;

      if (!hasIncoming) {
        nodeTypeMap.set(name, 'rule');
        nodeData.layer = 0;
      } else if (!hasOutgoing && !isBuiltInPolicy(name)) {
        nodeTypeMap.set(name, 'proxy');
      } else {
        nodeTypeMap.set(name, 'group');
      }
      computedMaxLayer = Math.max(computedMaxLayer, nodeData.layer);
    }

    for (const [name, nodeData] of nodeEntries) {
      if (nodeTypeMap.get(name) === 'proxy') {
        nodeData.layer = computedMaxLayer;
      }
    }

    const nodeTypeOrder = (type: 'rule' | 'group' | 'proxy'): number =>
      type === 'rule' ? 0 : type === 'group' ? 1 : 2;

    const sortedNodeEntries = [...nodeEntries].sort(
      ([nameA, dataA], [nameB, dataB]) => {
        if (dataA.layer !== dataB.layer) {
          return dataA.layer - dataB.layer;
        }
        const typeDiff =
          nodeTypeOrder(nodeTypeMap.get(nameA)!) -
          nodeTypeOrder(nodeTypeMap.get(nameB)!);
        if (typeDiff !== 0) {
          return typeDiff;
        }
        return nameA.localeCompare(nameB);
      },
    );

    const nodes = sortedNodeEntries.map(([name, data]) => ({
      name,
      layer: data.layer,
      nodeType: nodeTypeMap.get(name)!,
      totalUpload: data.totalUpload,
      totalDownload: data.totalDownload,
      totalConnections: data.totalConnections,
      rules: Array.from(data.rules),
    }));

    const nodeIndexMap = new Map(nodes.map((node, index) => [node.name, index]));

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
      .filter(
        (link): link is {
          sourceName: string;
          targetName: string;
          source: number;
          target: number;
          rules: string[];
        } => !!link,
      )
      .sort((left, right) => {
        const sourceDiff = left.sourceName.localeCompare(right.sourceName);
        if (sourceDiff !== 0) return sourceDiff;
        return left.targetName.localeCompare(right.targetName);
      })
      .map(({ source, target, rules }) => ({ source, target, rules }));

    const rulePaths: Record<string, { nodeIndices: number[]; linkIndices: number[] }> =
      {};
    for (const [ruleName, nodeNames] of rulePathNodes) {
      const nodeIndices = Array.from(nodeNames)
        .map((name) => nodeIndexMap.get(name)!)
        .filter((index) => index !== undefined);
      const linkIndices: number[] = [];
      const linkKeys = rulePathLinks.get(ruleName)!;

      links.forEach((link, index) => {
        const sourceName = nodes[link.source].name;
        const targetName = nodes[link.target].name;
        if (linkKeys.has(this.encodeFlowLinkKey(sourceName, targetName))) {
          linkIndices.push(index);
        }
      });

      rulePaths[ruleName] = { nodeIndices, linkIndices };
    }

    const maxLayer = nodes.reduce(
      (max, node) => Math.max(max, node.layer),
      0,
    );

    return { nodes, links, rulePaths, maxLayer };
  }

  getRecentConnections(_backendId: number, _limit: number): [] {
    // connection_logs is deprecated; keep API compatibility.
    return [];
  }

  async getDeviceStats(backendId: number, start: string, end: string, limit: number): Promise<any[] | null> {
    const rows = await this.query<any>(`
SELECT
  source_ip AS sourceIP,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections,
  toString(max(minute)) AS lastSeen
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
  AND source_ip != ''
GROUP BY source_ip
ORDER BY (SUM(upload) + SUM(download)) DESC
LIMIT ${Math.max(1, limit)}
`);
    if (!rows) return null;
    return rows.map((row: any) => ({
      sourceIP: String(row.sourceIP || ''),
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
      lastSeen: String(row.lastSeen || ''),
    }));
  }

  async getGroupedDomains(
    backendId: number,
    start: string,
    end: string,
    limit: number,
    filters: {
      chain?: string;
      sourceChain?: string;
      rule?: string;
      sourceIP?: string;
      domain?: string;
      ip?: string;
    },
  ): Promise<DomainStats[] | null> {
    const clauses = this.buildFilters(filters);
    const rows = await this.query<any>(`
SELECT
  domain,
  arrayDistinct(groupArrayIf(ip, ip != '')) AS ips,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections,
  toString(max(minute)) AS lastSeen,
  arrayDistinct(groupArrayIf(rule, rule != '')) AS rules,
  arrayDistinct(groupArrayIf(chain, chain != '')) AS chains
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
  AND domain != '' ${clauses}
GROUP BY domain
ORDER BY (SUM(upload) + SUM(download)) DESC
LIMIT ${Math.max(1, limit)}
`);
    if (!rows) return null;
    return rows.map((row: any) => ({
      domain: String(row.domain || ''),
      ips: Array.isArray(row.ips) ? row.ips.map(String) : [],
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
      lastSeen: String(row.lastSeen || ''),
      rules: Array.isArray(row.rules) ? row.rules.map(String) : [],
      chains: Array.isArray(row.chains) ? row.chains.map(String) : [],
    }));
  }

  async getGroupedIPs(
    backendId: number,
    start: string,
    end: string,
    limit: number,
    filters: {
      chain?: string;
      sourceChain?: string;
      rule?: string;
      sourceIP?: string;
      domain?: string;
      ip?: string;
    },
  ): Promise<IPStats[] | null> {
    const clauses = this.buildFilters(filters);
    const rows = await this.query<any>(`
SELECT
  ip,
  arrayDistinct(groupArrayIf(domain, domain != '')) AS domains,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections,
  toString(max(minute)) AS lastSeen,
  arrayDistinct(groupArrayIf(chain, chain != '')) AS chains
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
  AND ip != '' ${clauses}
GROUP BY ip
ORDER BY (SUM(upload) + SUM(download)) DESC
LIMIT ${Math.max(1, limit)}
`);
    if (!rows) return null;
    return rows.map((row: any) => ({
      ip: String(row.ip || ''),
      domains: Array.isArray(row.domains) ? row.domains.map(String) : [],
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
      lastSeen: String(row.lastSeen || ''),
      chains: Array.isArray(row.chains) ? row.chains.map(String) : [],
    }));
  }

  async getGroupedProxyStats(
    backendId: number,
    start: string,
    end: string,
    filters: {
      chain?: string;
      sourceChain?: string;
      rule?: string;
      sourceIP?: string;
      domain?: string;
      ip?: string;
    },
  ): Promise<any[] | null> {
    const clauses = this.buildFilters(filters);
    const rows = await this.query<any>(`
SELECT
  chain,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND minute >= toDateTime('${this.toDateTime(start)}')
  AND minute <= toDateTime('${this.toDateTime(end)}')
  AND chain != '' ${clauses}
GROUP BY chain
ORDER BY (SUM(upload) + SUM(download)) DESC
`);
    if (!rows) return null;
    return rows.map((row: any) => ({
      chain: String(row.chain || ''),
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
    }));
  }

  private async getRuleChainTrafficRows(
    backendId: number,
    start?: string,
    end?: string,
    rule?: string,
  ): Promise<RuleChainTrafficRow[] | null> {
    const timeWhere = this.buildTimeWhere(start, end);
    const ruleWhere = rule ? ` AND rule = '${this.esc(rule)}'` : '';
    const rows = await this.query<Record<string, unknown>>(`
SELECT
  rule,
  chain,
  toUInt64(SUM(upload)) AS totalUpload,
  toUInt64(SUM(download)) AS totalDownload,
  toUInt64(SUM(connections)) AS totalConnections
FROM ${this.config.database}.traffic_detail_buffer
WHERE backend_id = ${backendId}
  AND rule != ''
  AND chain != ''${timeWhere}${ruleWhere}
GROUP BY rule, chain
ORDER BY rule, chain
`);
    if (!rows) return null;
    return rows.map((row) => ({
      rule: String(row.rule || ''),
      chain: String(row.chain || ''),
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
    }));
  }

  private buildTimeWhere(start?: string, end?: string): string {
    if (!start || !end) return '';
    return `\n  AND minute >= toDateTime('${this.toDateTime(start)}')\n  AND minute <= toDateTime('${this.toDateTime(end)}')`;
  }

  private encodeFlowLinkKey(sourceName: string, targetName: string): string {
    return JSON.stringify([sourceName, targetName]);
  }

  private decodeFlowLinkKey(
    key: string,
  ): [sourceName: string, targetName: string] | null {
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

  private splitChainParts(chain: string): string[] {
    return chain
      .split('>')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private normalizeFlowLabel(label: string): string {
    return label
      .normalize('NFKC')
      .replace(/^[^\p{L}\p{N}]+/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private findRuleIndexInChain(chainParts: string[], rule: string): number {
    const exactIndex = chainParts.findIndex((part) => part === rule);
    if (exactIndex !== -1) {
      return exactIndex;
    }

    const normalizedRule = this.normalizeFlowLabel(rule);
    if (!normalizedRule) {
      return -1;
    }

    return chainParts.findIndex(
      (part) => this.normalizeFlowLabel(part) === normalizedRule,
    );
  }

  private buildRuleFlowPath(rule: string, chain: string): string[] {
    const chainParts = this.splitChainParts(chain);
    if (chainParts.length === 0) {
      return [];
    }

    const ruleIndex = this.findRuleIndexInChain(chainParts, rule);
    if (ruleIndex !== -1) {
      return chainParts.slice(0, ruleIndex + 1).reverse();
    }

    const reversed = [...chainParts].reverse();
    const normalizedRule = this.normalizeFlowLabel(rule);
    const normalizedHead = this.normalizeFlowLabel(reversed[0] || '');
    if (normalizedRule && normalizedRule === normalizedHead) {
      return reversed;
    }
    return [rule, ...reversed];
  }

  private async query<T>(query: string): Promise<T[] | null> {
    if (!this.config.enabled) return null;
    const baseUrl = `${this.config.protocol}://${this.config.host}:${this.config.port}`;
    const authHeader =
      this.config.password.length > 0
        ? `Basic ${Buffer.from(`${this.config.user}:${this.config.password}`).toString('base64')}`
        : '';

    try {
      const response = await fetch(
        `${baseUrl}/?database=${encodeURIComponent(this.config.database)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          body: `${query}\nFORMAT JSON`,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`status=${response.status} body=${body.slice(0, 160)}`);
      }
      const json = (await response.json()) as { data?: T[] };
      return json.data || [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.source === 'clickhouse' || this.strictStats) {
        throw new Error(`[ClickHouse Reader] strict mode query failed: ${message}`, { cause: error });
      }
      console.warn(`[ClickHouse Reader] query failed, fallback to sqlite: ${message}`);
      return null;
    }
  }

  private toDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      // Return current time so the query scans an effectively empty window
      // instead of defaulting to epoch and pulling all historical data.
      console.warn(`[ClickHouse Reader] Invalid date value: ${JSON.stringify(value)}, clamping to now to prevent full table scan`);
      return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  private buildFilters(filters: Record<string, string | undefined>): string {
    const clauses: string[] = [];
    if (filters.chain) {
      const chain = this.esc(filters.chain);
      clauses.push(`(chain = '${chain}' OR startsWith(chain, '${chain} > '))`);
    }
    if (filters.sourceChain) {
      const chain = this.esc(filters.sourceChain);
      clauses.push(`(chain = '${chain}' OR startsWith(chain, '${chain} > '))`);
    }
    if (filters.rule) clauses.push(`rule = '${this.esc(filters.rule)}'`);
    if (filters.sourceIP) clauses.push(`source_ip = '${this.esc(filters.sourceIP)}'`);
    if (filters.domain) clauses.push(`domain = '${this.esc(filters.domain)}'`);
    if (filters.ip) clauses.push(`ip = '${this.esc(filters.ip)}'`);
    if (clauses.length === 0) return '';
    return ` AND ${clauses.join(' AND ')}`;
  }

  private esc(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
  }

  private parseSource(value: string | undefined): StatsQuerySource {
    const normalized = String(value || 'sqlite').trim().toLowerCase();
    if (normalized === 'clickhouse' || normalized === 'auto' || normalized === 'sqlite') {
      return normalized;
    }
    // Tolerate common typo to avoid accidental fallback loops.
    if (normalized === 'clickhous') {
      console.warn('[ClickHouse Reader] STATS_QUERY_SOURCE=clickhous is invalid, treating it as clickhouse');
      return 'clickhouse';
    }
    if (value && normalized !== 'sqlite') {
      console.warn(
        `[ClickHouse Reader] Invalid STATS_QUERY_SOURCE=${value}, fallback to sqlite`,
      );
    }
    return 'sqlite';
  }

}
