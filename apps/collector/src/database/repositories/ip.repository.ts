/**
 * IP Repository
 *
 * Handles IP statistics, ASN/GeoIP lookups, paginated IP queries,
 * and IP-domain/IP-proxy breakdowns.
 */
import type Database from 'better-sqlite3';
import type { DomainStats, IPStats } from '@neko-master/shared';
import { BaseRepository } from './base.repository.js';

interface ProxyTrafficStats {
  chain: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
}

interface GeoIPInfo {
  country: string;
  country_name: string;
  city: string;
  asn: string;
  as_name: string;
  as_domain: string;
  continent: string;
  continent_name: string;
}

export class IPRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  getIPStats(backendId: number, limit = 100, start?: string, end?: string): IPStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT m.ip, GROUP_CONCAT(DISTINCT CASE WHEN m.domain != '' THEN m.domain END) as domains,
               SUM(m.upload) as totalUpload, SUM(m.download) as totalDownload,
               SUM(m.connections) as totalConnections, MAX(m.${resolved.timeCol}) as lastSeen,
               COALESCE(i.asn, g.asn) as asn,
               CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                    WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP,
               GROUP_CONCAT(DISTINCT m.chain) as chains, GROUP_CONCAT(DISTINCT m.rule) as rules
        FROM ${resolved.table} m
        LEFT JOIN ip_stats i ON m.backend_id = i.backend_id AND m.ip = i.ip
        LEFT JOIN geoip_cache g ON m.ip = g.ip
        WHERE m.backend_id = ? AND m.${resolved.timeCol} >= ? AND m.${resolved.timeCol} <= ? AND m.ip != ''
        GROUP BY m.ip ORDER BY (SUM(m.upload) + SUM(m.download)) DESC LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, limit) as Array<{
        ip: string; domains: string; totalUpload: number; totalDownload: number; totalConnections: number;
        lastSeen: string; asn: string | null; geoIP: string | null; chains: string | null; rules: string | null;
      }>;

      return rows.map(row => {
        const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return {
          ...row, domains: row.domains ? row.domains.split(',').filter(Boolean) : [],
          geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined,
          asn: row.asn || undefined,
          chains: this.expandShortChainsForRules(backendId, chains, rules),
        };
      }) as IPStats[];
    }

    const stmt = this.db.prepare(`
      SELECT i.ip, i.domains, i.total_upload as totalUpload, i.total_download as totalDownload,
             i.total_connections as totalConnections, i.last_seen as lastSeen,
             COALESCE(i.asn, g.asn) as asn,
             CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                  WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP,
             i.chains
      FROM ip_stats i LEFT JOIN geoip_cache g ON i.ip = g.ip
      WHERE i.backend_id = ? AND i.ip != ''
      ORDER BY (i.total_upload + i.total_download) DESC LIMIT ?
    `);
    const rows = stmt.all(backendId, limit) as Array<{
      ip: string; domains: string; totalUpload: number; totalDownload: number;
      totalConnections: number; lastSeen: string; asn: string | null; geoIP: string | null; chains: string | null;
    }>;

    return rows.map(row => ({
      ...row, domains: row.domains ? row.domains.split(',') : [],
      geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined,
      asn: row.asn || undefined, chains: row.chains ? row.chains.split(',') : [],
    })) as IPStats[];
  }

  /**
   * Get top IPs (light version) - only ip + traffic totals, no GROUP_CONCAT or JOINs
   * Used by overview/summary endpoints where domains/geo/chains are not needed
   */
  getTopIPsLight(backendId: number, limit = 10, start?: string, end?: string): IPStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const timeCol = resolved.table === 'hourly_dim_stats' ? 'hour' : 'minute';
      const stmt = this.db.prepare(`
        SELECT
          ip,
          SUM(upload) as totalUpload,
          SUM(download) as totalDownload,
          SUM(connections) as totalConnections,
          MAX(${timeCol}) as lastSeen
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${timeCol} >= ? AND ${timeCol} <= ? AND ip != ''
        GROUP BY ip
        ORDER BY (SUM(upload) + SUM(download)) DESC
        LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, limit) as Array<{
        ip: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string;
      }>;
      return rows.map(row => ({ ...row, domains: [], chains: [] })) as IPStats[];
    }

    const stmt = this.db.prepare(`
      SELECT ip, total_upload as totalUpload, total_download as totalDownload,
             total_connections as totalConnections, last_seen as lastSeen
      FROM ip_stats
      WHERE backend_id = ? AND ip != ''
      ORDER BY (total_upload + total_download) DESC
      LIMIT ?
    `);
    const rows = stmt.all(backendId, limit) as Array<{
      ip: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string;
    }>;
    return rows.map(row => ({ ...row, domains: [], chains: [] })) as IPStats[];
  }

  getIPStatsByIPs(backendId: number, ips: string[]): IPStats[] {
    const filteredIps = ips.filter(ip => ip && ip.trim() !== '');
    if (filteredIps.length === 0) return [];

    const placeholders = filteredIps.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT i.ip, i.domains, i.total_upload as totalUpload, i.total_download as totalDownload,
             i.total_connections as totalConnections, i.last_seen as lastSeen,
             COALESCE(i.asn, g.asn) as asn,
             CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                  WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP,
             i.chains
      FROM ip_stats i LEFT JOIN geoip_cache g ON i.ip = g.ip
      WHERE i.backend_id = ? AND i.ip IN (${placeholders})
      ORDER BY (i.total_upload + i.total_download) DESC
    `);
    const rows = stmt.all(backendId, ...filteredIps) as Array<{
      ip: string; domains: string; totalUpload: number; totalDownload: number;
      totalConnections: number; lastSeen: string; asn: string | null; geoIP: string | null; chains: string | null;
    }>;

    return rows.map(row => ({
      ...row, domains: row.domains ? row.domains.split(',') : [],
      geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined,
      asn: row.asn || undefined, chains: row.chains ? row.chains.split(',') : [],
    })) as IPStats[];
  }

  getIPStatsPaginated(backendId: number, opts: {
    offset?: number; limit?: number; sortBy?: string; sortOrder?: string;
    search?: string; start?: string; end?: string;
  } = {}): { data: IPStats[]; total: number } {
    const offset = opts.offset ?? 0;
    const limit = Math.min(opts.limit ?? 50, 200);
    const sortOrder = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const search = opts.search?.trim() || '';
    const range = this.parseMinuteRange(opts.start, opts.end);

    const sortColumnMap: Record<string, string> = {
      ip: 'i.ip', totalDownload: 'i.total_download', totalUpload: 'i.total_upload',
      totalTraffic: '(i.total_upload + i.total_download)',
      totalConnections: 'i.total_connections', lastSeen: 'i.last_seen',
    };
    const sortColumn = sortColumnMap[opts.sortBy || 'totalDownload'] || 'i.total_download';

    if (range) {
      const resolved = this.resolveFactTable(opts.start!, opts.end!);
      const rangeSortColumnMap: Record<string, string> = {
        ip: 'agg.ip', totalDownload: 'agg.totalDownload', totalUpload: 'agg.totalUpload',
        totalTraffic: '(agg.totalUpload + agg.totalDownload)',
        totalConnections: 'agg.totalConnections', lastSeen: 'agg.lastSeen',
      };
      const rangeSortColumn = rangeSortColumnMap[opts.sortBy || 'totalDownload'] || 'agg.totalDownload';

      const whereSearch = search ? "AND (ip LIKE ? OR domain LIKE ?)" : "";
      const baseParams: any[] = [backendId, resolved.startKey, resolved.endKey];
      const searchParams: any[] = search ? [`%${search}%`, `%${search}%`] : [];

      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as total FROM (
          SELECT ip FROM ${resolved.table}
          WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND ip != '' ${whereSearch}
          GROUP BY ip
        )
      `);
      const { total } = countStmt.get(...baseParams, ...searchParams) as { total: number };

      const dataStmt = this.db.prepare(`
        WITH agg AS (
          SELECT ip, GROUP_CONCAT(DISTINCT CASE WHEN domain != '' THEN domain END) as domains,
                 GROUP_CONCAT(DISTINCT rule) as rules,
                 SUM(upload) as totalUpload, SUM(download) as totalDownload,
                 SUM(connections) as totalConnections, MAX(${resolved.timeCol}) as lastSeen,
                 GROUP_CONCAT(DISTINCT chain) as chains
          FROM ${resolved.table}
          WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND ip != '' ${whereSearch}
          GROUP BY ip
        )
        SELECT agg.ip, agg.domains, agg.rules, agg.totalUpload, agg.totalDownload,
               agg.totalConnections, agg.lastSeen,
               COALESCE(i.asn, g.asn) as asn,
               CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                    WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP,
               agg.chains
        FROM agg
        LEFT JOIN ip_stats i ON i.backend_id = ? AND i.ip = agg.ip
        LEFT JOIN geoip_cache g ON g.ip = agg.ip
        ORDER BY ${rangeSortColumn} ${sortOrder} LIMIT ? OFFSET ?
      `);
      const rows = dataStmt.all(...baseParams, ...searchParams, backendId, limit, offset) as Array<{
        ip: string; domains: string; rules: string | null; totalUpload: number; totalDownload: number;
        totalConnections: number; lastSeen: string; asn: string | null; geoIP: string | null; chains: string | null;
      }>;

      const data = rows.map(row => {
        const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return {
          ip: row.ip, domains: row.domains ? row.domains.split(',').filter(Boolean) : [],
          totalUpload: row.totalUpload, totalDownload: row.totalDownload,
          totalConnections: row.totalConnections, lastSeen: row.lastSeen,
          geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined,
          asn: row.asn || undefined,
          chains: this.expandShortChainsForRules(backendId, chains, rules),
        };
      }) as IPStats[];

      return { data, total };
    }

    const whereClause = search
      ? "WHERE i.backend_id = ? AND i.ip != '' AND (i.ip LIKE ? OR i.domains LIKE ?)"
      : "WHERE i.backend_id = ? AND i.ip != ''";
    const params: any[] = search ? [backendId, `%${search}%`, `%${search}%`] : [backendId];

    const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM ip_stats i ${whereClause}`);
    const { total } = countStmt.get(...params) as { total: number };

    const dataStmt = this.db.prepare(`
      SELECT i.ip, i.domains, i.total_upload as totalUpload, i.total_download as totalDownload,
             i.total_connections as totalConnections, i.last_seen as lastSeen, i.rules,
             COALESCE(i.asn, g.asn) as asn,
             CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                  WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP,
             i.chains
      FROM ip_stats i LEFT JOIN geoip_cache g ON i.ip = g.ip
      ${whereClause} ORDER BY ${sortColumn} ${sortOrder} LIMIT ? OFFSET ?
    `);
    const rows = dataStmt.all(...params, limit, offset) as Array<{
      ip: string; domains: string; totalUpload: number; totalDownload: number;
      totalConnections: number; lastSeen: string; rules: string | null;
      asn: string | null; geoIP: string | null; chains: string | null;
    }>;

    const data = rows.map(row => {
      const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
      const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
      return {
        ip: row.ip, domains: row.domains ? row.domains.split(',') : [],
        totalUpload: row.totalUpload, totalDownload: row.totalDownload,
        totalConnections: row.totalConnections, lastSeen: row.lastSeen,
        geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined,
        asn: row.asn || undefined,
        chains: this.expandShortChainsForRules(backendId, chains, rules),
      };
    }) as IPStats[];

    return { data, total };
  }

  getDomainIPDetails(
    backendId: number, domain: string, start?: string, end?: string,
    limit = 100, sourceIP?: string, sourceChain?: string,
  ): IPStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range || sourceIP || sourceChain) {
      const resolved = range ? this.resolveFactTable(start!, end!) : null;
      const factTable = resolved?.table ?? 'minute_dim_stats';
      const timeCol = resolved?.timeCol ?? 'minute';
      const conditions = ["m.backend_id = ?", "m.domain = ?", "m.ip != ''"];
      const params: Array<string | number> = [backendId, domain];
      if (resolved) {
        conditions.push(`m.${timeCol} >= ?`, `m.${timeCol} <= ?`);
        params.push(resolved.startKey, resolved.endKey);
      }
      if (sourceIP) {
        conditions.push("m.source_ip = ?");
        params.push(sourceIP);
      }
      if (sourceChain) {
        conditions.push("(m.chain = ? OR m.chain LIKE ?)");
        params.push(sourceChain, `${sourceChain} > %`);
      }

      const stmt = this.db.prepare(`
        SELECT m.ip, GROUP_CONCAT(DISTINCT CASE WHEN m.domain != '' THEN m.domain END) as domains,
               SUM(m.upload) as totalUpload, SUM(m.download) as totalDownload,
               SUM(m.connections) as totalConnections, MAX(m.${timeCol}) as lastSeen,
               COALESCE(i.asn, g.asn) as asn,
               CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                    WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP,
               GROUP_CONCAT(DISTINCT m.chain) as chains, GROUP_CONCAT(DISTINCT m.rule) as rules
        FROM ${factTable} m
        LEFT JOIN ip_stats i ON m.backend_id = i.backend_id AND m.ip = i.ip
        LEFT JOIN geoip_cache g ON m.ip = g.ip
        WHERE ${conditions.join(" AND ")}
        GROUP BY m.ip ORDER BY (SUM(m.upload) + SUM(m.download)) DESC LIMIT ?
      `);
      const rows = stmt.all(...params, limit) as Array<{
        ip: string; domains: string; totalUpload: number; totalDownload: number;
        totalConnections: number; lastSeen: string; asn: string | null;
        geoIP: string | null; chains: string | null; rules: string | null;
      }>;

      return rows.map(row => {
        const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return {
          ...row, domains: row.domains ? row.domains.split(',').filter(Boolean) : [],
          geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined,
          asn: row.asn || undefined,
          chains: this.expandShortChainsForRules(backendId, chains, rules),
        };
      }) as IPStats[];
    }

    // Fallback: look up domain ips from domain_stats, then fetch IP details
    const domainRow = this.db.prepare(
      `SELECT ips FROM domain_stats WHERE backend_id = ? AND domain = ?`,
    ).get(backendId, domain) as { ips: string | null } | undefined;

    if (!domainRow || !domainRow.ips) return [];
    const ipList = domainRow.ips.split(',').filter(Boolean).slice(0, limit);
    if (ipList.length === 0) return [];

    return this.getIPStatsByIPs(backendId, ipList);
  }

  getIPDomainDetails(
    backendId: number, ip: string, start?: string, end?: string,
    limit = 100, sourceIP?: string, sourceChain?: string,
  ): DomainStats[] {
    const range = this.parseMinuteRange(start, end);
    const resolved = range ? this.resolveFactTable(start!, end!) : null;
    const factTable = resolved?.table ?? 'minute_dim_stats';
    const timeCol = resolved?.timeCol ?? 'minute';
    const conditions = ["backend_id = ?", "ip = ?", "domain != ''"];
    const params: Array<string | number> = [backendId, ip];
    if (resolved) {
      conditions.push(`${timeCol} >= ?`, `${timeCol} <= ?`);
      params.push(resolved.startKey, resolved.endKey);
    }
    if (sourceIP) {
      conditions.push("source_ip = ?");
      params.push(sourceIP);
    }
    if (sourceChain) {
      conditions.push("(chain = ? OR chain LIKE ?)");
      params.push(sourceChain, `${sourceChain} > %`);
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

  getIPProxyStats(
    backendId: number, ip: string, start?: string, end?: string,
    sourceIP?: string, sourceChain?: string,
  ): ProxyTrafficStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range || sourceIP || sourceChain) {
      const resolved = range ? this.resolveFactTable(start!, end!) : null;
      const factTable = resolved?.table ?? 'minute_dim_stats';
      const timeCol = resolved?.timeCol ?? 'minute';
      const conditions = ["backend_id = ?", "ip = ?"];
      const params: Array<string | number> = [backendId, ip];
      if (resolved) {
        conditions.push(`${timeCol} >= ?`, `${timeCol} <= ?`);
        params.push(resolved.startKey, resolved.endKey);
      }
      if (sourceIP) {
        conditions.push("source_ip = ?");
        params.push(sourceIP);
      }
      if (sourceChain) {
        conditions.push("(chain = ? OR chain LIKE ?)");
        params.push(sourceChain, `${sourceChain} > %`);
      }

      const stmt = this.db.prepare(`
        SELECT chain, SUM(upload) as totalUpload, SUM(download) as totalDownload, SUM(connections) as totalConnections
        FROM ${factTable} WHERE ${conditions.join(" AND ")}
        GROUP BY chain ORDER BY (SUM(upload) + SUM(download)) DESC
      `);
      return stmt.all(...params) as ProxyTrafficStats[];
    }

    const stmt = this.db.prepare(`
      SELECT chain, total_upload as totalUpload, total_download as totalDownload, total_connections as totalConnections
      FROM ip_proxy_stats WHERE backend_id = ? AND ip = ?
      ORDER BY (total_upload + total_download) DESC
    `);
    return stmt.all(backendId, ip) as ProxyTrafficStats[];
  }

  // ASN methods
  updateASNInfo(ip: string, asn: string, org: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO asn_cache (ip, asn, org, queried_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(ip) DO UPDATE SET asn = ?, org = ?, queried_at = CURRENT_TIMESTAMP
    `);
    stmt.run(ip, asn, org, asn, org);
  }

  getASNInfo(ips: string[]): Array<{ ip: string; asn: string; org: string }> {
    const stmt = this.db.prepare(`
      SELECT ip, asn, org FROM asn_cache WHERE ip IN (${ips.map(() => '?').join(',')})
    `);
    return stmt.all(...ips) as Array<{ ip: string; asn: string; org: string }>;
  }

  getASNInfoForIP(ip: string): { ip: string; asn: string; org: string } | undefined {
    const stmt = this.db.prepare(`SELECT ip, asn, org FROM asn_cache WHERE ip = ?`);
    return stmt.get(ip) as { ip: string; asn: string; org: string } | undefined;
  }

  // GeoIP methods
  getIPGeolocation(ip: string): GeoIPInfo | undefined {
    const stmt = this.db.prepare(`
      SELECT country, country_name, city, asn, as_name, as_domain, continent, continent_name
      FROM geoip_cache WHERE ip = ?
    `);
    return stmt.get(ip) as GeoIPInfo | undefined;
  }

  getIPGeolocations(ips: string[]): Record<string, GeoIPInfo> {
    const filteredIps = ips.filter(ip => ip && ip.trim() !== '');
    if (filteredIps.length === 0) return {};
    
    // Chunk into sets of 500 max to avoid SQLite parameter limits
    const CHUNK_SIZE = 500;
    const result: Record<string, GeoIPInfo> = {};
    
    for (let i = 0; i < filteredIps.length; i += CHUNK_SIZE) {
      const chunk = filteredIps.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const stmt = this.db.prepare(`
        SELECT ip, country, country_name, city, asn, as_name, as_domain, continent, continent_name
        FROM geoip_cache WHERE ip IN (${placeholders})
      `);
      const rows = stmt.all(...chunk) as Array<GeoIPInfo & { ip: string }>;
      for (const row of rows) {
        result[row.ip] = row;
      }
    }
    
    return result;
  }

  saveIPGeolocation(ip: string, geo: GeoIPInfo): void {
    const stmt = this.db.prepare(`
      INSERT INTO geoip_cache (ip, country, country_name, city, asn, as_name, as_domain, continent, continent_name, queried_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(ip) DO UPDATE SET
        country = ?, country_name = ?, city = ?, asn = ?, as_name = ?, as_domain = ?,
        continent = ?, continent_name = ?, queried_at = CURRENT_TIMESTAMP
    `);
    stmt.run(
      ip, geo.country, geo.country_name, geo.city, geo.asn, geo.as_name, geo.as_domain, geo.continent, geo.continent_name,
      geo.country, geo.country_name, geo.city, geo.asn, geo.as_name, geo.as_domain, geo.continent, geo.continent_name,
    );
  }
}
