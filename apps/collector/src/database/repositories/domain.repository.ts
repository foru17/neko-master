/**
 * Domain Repository
 * 
 * Handles all domain-related database operations including:
 * - Domain statistics queries
 * - Domain-IP relationship queries
 * - Domain pagination and search
 * - Domain proxy statistics
 */
import type Database from 'better-sqlite3';
import type { DomainStats, IPStats } from '@neko-master/shared';
import { BaseRepository } from './base.repository.js';

export class DomainRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  /**
   * Get a specific domain by name
   */
  getDomainByName(backendId: number, domain: string): DomainStats | null {
    const stmt = this.db.prepare(`
      SELECT domain, total_upload as totalUpload, total_download as totalDownload, 
             total_connections as totalConnections, last_seen as lastSeen, ips, rules, chains
      FROM domain_stats
      WHERE backend_id = ? AND domain = ?
    `);
    const row = stmt.get(backendId, domain) as {
      domain: string;
      totalUpload: number;
      totalDownload: number;
      totalConnections: number;
      lastSeen: string;
      ips: string;
      rules: string | null;
      chains: string | null;
    } | undefined;
    
    if (!row) return null;
    
    return {
      ...row,
      ips: row.ips ? row.ips.split(',') : [],
      rules: row.rules ? row.rules.split(',') : [],
      chains: row.chains ? row.chains.split(',') : [],
    } as DomainStats;
  }

  /**
   * Get all domain stats for a specific backend
   */
  getDomainStats(backendId: number, limit = 100, start?: string, end?: string): DomainStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT
          domain,
          SUM(upload) as totalUpload,
          SUM(download) as totalDownload,
          SUM(connections) as totalConnections,
          MAX(${resolved.timeCol}) as lastSeen,
          GROUP_CONCAT(DISTINCT ip) as ips,
          GROUP_CONCAT(DISTINCT rule) as rules,
          GROUP_CONCAT(DISTINCT chain) as chains
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND domain != ''
        GROUP BY domain
        ORDER BY (SUM(upload) + SUM(download)) DESC
        LIMIT ?
      `);
      const rows = stmt.all(
        backendId,
        resolved.startKey,
        resolved.endKey,
        limit,
      ) as Array<{
        domain: string;
        totalUpload: number;
        totalDownload: number;
        totalConnections: number;
        lastSeen: string;
        ips: string | null;
        rules: string | null;
        chains: string | null;
      }>;

      return rows.map(row => {
        const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return {
          ...row,
          ips: row.ips ? row.ips.split(',').filter(Boolean) : [],
          rules,
          chains: this.expandShortChainsForRules(backendId, chains, rules),
        };
      }) as DomainStats[];
    }

    const stmt = this.db.prepare(`
      SELECT domain, total_upload as totalUpload, total_download as totalDownload, 
             total_connections as totalConnections, last_seen as lastSeen, ips, rules, chains
      FROM domain_stats
      WHERE backend_id = ?
      ORDER BY (total_upload + total_download) DESC
      LIMIT ?
    `);
    const rows = stmt.all(backendId, limit) as Array<{
      domain: string;
      totalUpload: number;
      totalDownload: number;
      totalConnections: number;
      lastSeen: string;
      ips: string | null;
      rules: string | null;
      chains: string | null;
    }>;
    
    return rows.map(row => {
      const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
      const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
      return {
        ...row,
        ips: row.ips ? row.ips.split(',') : [],
        rules,
        chains: this.expandShortChainsForRules(backendId, chains, rules),
      };
    }) as DomainStats[];
  }

  /**
   * Get top domains for a specific backend
   */
  getTopDomains(backendId: number, limit = 10, start?: string, end?: string): DomainStats[] {
    return this.getDomainStats(backendId, limit, start, end);
  }

  /**
   * Get top domains (light version) - only name + traffic totals, no GROUP_CONCAT
   * Used by overview/summary endpoints where IPs/rules/chains are not needed
   */
  getTopDomainsLight(backendId: number, limit = 10, start?: string, end?: string): DomainStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const timeCol = resolved.table === 'hourly_dim_stats' ? 'hour' : 'minute';
      const stmt = this.db.prepare(`
        SELECT
          domain,
          SUM(upload) as totalUpload,
          SUM(download) as totalDownload,
          SUM(connections) as totalConnections,
          MAX(${timeCol}) as lastSeen
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${timeCol} >= ? AND ${timeCol} <= ? AND domain != ''
        GROUP BY domain
        ORDER BY (SUM(upload) + SUM(download)) DESC
        LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, limit) as Array<{
        domain: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string;
      }>;
      return rows.map(row => ({ ...row, ips: [], rules: [], chains: [] })) as DomainStats[];
    }

    const stmt = this.db.prepare(`
      SELECT domain, total_upload as totalUpload, total_download as totalDownload,
             total_connections as totalConnections, last_seen as lastSeen
      FROM domain_stats
      WHERE backend_id = ?
      ORDER BY (total_upload + total_download) DESC
      LIMIT ?
    `);
    const rows = stmt.all(backendId, limit) as Array<{
      domain: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string;
    }>;
    return rows.map(row => ({ ...row, ips: [], rules: [], chains: [] })) as DomainStats[];
  }

  /**
   * Get domain stats with server-side pagination, sorting and search
   */
  getDomainStatsPaginated(backendId: number, opts: {
    offset?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
    search?: string;
    start?: string;
    end?: string;
  } = {}): { data: DomainStats[]; total: number } {
    const offset = opts.offset ?? 0;
    const limit = Math.min(opts.limit ?? 50, 200);
    const sortOrder = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const search = opts.search?.trim() || '';
    const range = this.parseMinuteRange(opts.start, opts.end);

    const sortColumnMap: Record<string, string> = {
      domain: 'domain',
      totalDownload: 'total_download',
      totalUpload: 'total_upload',
      totalTraffic: '(total_upload + total_download)',
      totalConnections: 'total_connections',
      lastSeen: 'last_seen',
    };
    const sortColumn = sortColumnMap[opts.sortBy || 'totalDownload'] || 'total_download';

    if (range) {
      const resolved = this.resolveFactTable(opts.start!, opts.end!);
      const rangeSortColumnMap: Record<string, string> = {
        domain: 'domain',
        totalDownload: 'totalDownload',
        totalUpload: 'totalUpload',
        totalTraffic: '(totalUpload + totalDownload)',
        totalConnections: 'totalConnections',
        lastSeen: 'lastSeen',
      };
      const rangeSortColumn =
        rangeSortColumnMap[opts.sortBy || 'totalDownload'] || 'totalDownload';

      const whereSearch = search ? 'AND domain LIKE ?' : '';
      const baseParams: any[] = [backendId, resolved.startKey, resolved.endKey];
      const searchParams: any[] = search ? [`%${search}%`] : [];

      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as total
        FROM (
          SELECT domain
          FROM ${resolved.table}
          WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND domain != '' ${whereSearch}
          GROUP BY domain
        )
      `);
      const { total } = countStmt.get(
        ...baseParams,
        ...searchParams,
      ) as { total: number };

      const dataStmt = this.db.prepare(`
        SELECT
          domain,
          SUM(upload) as totalUpload,
          SUM(download) as totalDownload,
          SUM(connections) as totalConnections,
          MAX(${resolved.timeCol}) as lastSeen,
          GROUP_CONCAT(DISTINCT ip) as ips,
          GROUP_CONCAT(DISTINCT rule) as rules,
          GROUP_CONCAT(DISTINCT chain) as chains
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND domain != '' ${whereSearch}
        GROUP BY domain
        ORDER BY ${rangeSortColumn} ${sortOrder}
        LIMIT ? OFFSET ?
      `);
      const rows = dataStmt.all(
        ...baseParams,
        ...searchParams,
        limit,
        offset,
      ) as Array<{
        domain: string;
        totalUpload: number;
        totalDownload: number;
        totalConnections: number;
        lastSeen: string;
        ips: string | null;
        rules: string | null;
        chains: string | null;
      }>;

      const data = rows.map(row => {
        const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return {
          ...row,
          ips: row.ips ? row.ips.split(',').filter(Boolean) : [],
          rules,
          chains: this.expandShortChainsForRules(backendId, chains, rules),
        };
      }) as DomainStats[];

      return { data, total };
    }

    const whereClause = search
      ? 'WHERE backend_id = ? AND domain LIKE ?'
      : 'WHERE backend_id = ?';
    const params: any[] = search
      ? [backendId, `%${search}%`]
      : [backendId];

    const countStmt = this.db.prepare(
      `SELECT COUNT(*) as total FROM domain_stats ${whereClause}`
    );
    const { total } = countStmt.get(...params) as { total: number };

    const dataStmt = this.db.prepare(`
      SELECT domain, total_upload as totalUpload, total_download as totalDownload,
             total_connections as totalConnections, last_seen as lastSeen, ips, rules, chains
      FROM domain_stats
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `);
    const rows = dataStmt.all(...params, limit, offset) as Array<{
      domain: string;
      totalUpload: number;
      totalDownload: number;
      totalConnections: number;
      lastSeen: string;
      ips: string | null;
      rules: string | null;
      chains: string | null;
    }>;

    const data = rows.map(row => {
      const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
      const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
      return {
        ...row,
        ips: row.ips ? row.ips.split(',') : [],
        rules,
        chains: this.expandShortChainsForRules(backendId, chains, rules),
      };
    }) as DomainStats[];

    return { data, total };
  }

  /**
   * Get IP details for a specific domain
   */
  getDomainIPDetails(
    backendId: number,
    domain: string,
    start?: string,
    end?: string,
    limit = 100,
    sourceIP?: string,
    sourceChain?: string,
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
        SELECT
          m.ip,
          GROUP_CONCAT(DISTINCT CASE WHEN m.domain != '' THEN m.domain END) as domains,
          SUM(m.upload) as totalUpload,
          SUM(m.download) as totalDownload,
          SUM(m.connections) as totalConnections,
          MAX(m.${timeCol}) as lastSeen,
          COALESCE(i.asn, g.asn) as asn,
          CASE
            WHEN g.country IS NOT NULL THEN
              json_array(
                g.country,
                COALESCE(g.country_name, g.country),
                COALESCE(g.city, ''),
                COALESCE(g.as_name, '')
              )
            WHEN i.geoip IS NOT NULL THEN
              json(i.geoip)
            ELSE
              NULL
          END as geoIP,
          GROUP_CONCAT(DISTINCT m.chain) as chains,
          GROUP_CONCAT(DISTINCT m.rule) as rules
        FROM ${factTable} m
        LEFT JOIN ip_stats i ON m.backend_id = i.backend_id AND m.ip = i.ip
        LEFT JOIN geoip_cache g ON m.ip = g.ip
        WHERE ${conditions.join(" AND ")}
        GROUP BY m.ip
        ORDER BY (SUM(m.upload) + SUM(m.download)) DESC
        LIMIT ?
      `);
      const rows = stmt.all(...params, limit) as Array<{
        ip: string;
        domains: string;
        totalUpload: number;
        totalDownload: number;
        totalConnections: number;
        lastSeen: string;
        asn: string | null;
        geoIP: string | null;
        chains: string | null;
        rules: string | null;
      }>;

      return rows.map(row => {
        const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return {
          ...row,
          domains: row.domains ? row.domains.split(',').filter(Boolean) : [],
          geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined,
          asn: row.asn || undefined,
          chains: this.expandShortChainsForRules(backendId, chains, rules),
        };
      }) as IPStats[];
    }

    const domainData = this.getDomainByName(backendId, domain);
    if (!domainData || !domainData.ips || domainData.ips.length === 0) {
      return [];
    }
    return this.getIPStatsByIPs(backendId, domainData.ips.slice(0, limit));
  }

  /**
   * Get per-proxy traffic breakdown for a specific domain
   */
  getDomainProxyStats(
    backendId: number,
    domain: string,
    start?: string,
    end?: string,
    sourceIP?: string,
    sourceChain?: string,
  ): Array<{ chain: string; totalUpload: number; totalDownload: number; totalConnections: number }> {
    const range = this.parseMinuteRange(start, end);
    if (range || sourceIP || sourceChain) {
      const resolved = range ? this.resolveFactTable(start!, end!) : null;
      const factTable = resolved?.table ?? 'minute_dim_stats';
      const timeCol = resolved?.timeCol ?? 'minute';
      const conditions = ["backend_id = ?", "domain = ?"];
      const params: Array<string | number> = [backendId, domain];
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
        SELECT
          chain,
          SUM(upload) as totalUpload,
          SUM(download) as totalDownload,
          SUM(connections) as totalConnections
        FROM ${factTable}
        WHERE ${conditions.join(" AND ")}
        GROUP BY chain
        ORDER BY (SUM(upload) + SUM(download)) DESC
      `);
      return stmt.all(...params) as Array<{ chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>;
    }

    const stmt = this.db.prepare(`
      SELECT chain,
             total_upload as totalUpload,
             total_download as totalDownload,
             total_connections as totalConnections
      FROM domain_proxy_stats
      WHERE backend_id = ? AND domain = ?
      ORDER BY (total_upload + total_download) DESC
    `);
    return stmt.all(backendId, domain) as Array<{ chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>;
  }

  /**
   * Get domains for a specific proxy/node
   */
  getProxyDomains(
    backendId: number,
    chain: string,
    limit = 50,
    start?: string,
    end?: string,
  ): DomainStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT
          domain,
          SUM(upload) as totalUpload,
          SUM(download) as totalDownload,
          SUM(connections) as totalConnections,
          MAX(${resolved.timeCol}) as lastSeen,
          GROUP_CONCAT(DISTINCT ip) as ips
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND (chain = ? OR chain LIKE ?) AND domain != ''
        GROUP BY domain
        ORDER BY (SUM(upload) + SUM(download)) DESC
        LIMIT ?
      `);
      const rows = stmt.all(
        backendId,
        resolved.startKey,
        resolved.endKey,
        chain,
        `${chain} > %`,
        limit,
      ) as Array<{
        domain: string;
        totalUpload: number;
        totalDownload: number;
        totalConnections: number;
        lastSeen: string;
        ips: string | null;
      }>;

      return rows.map(row => ({
        ...row,
        ips: row.ips ? row.ips.split(',').filter(Boolean) : [],
        rules: [],
        chains: [chain],
      })) as DomainStats[];
    }

    const stmt = this.db.prepare(`
      SELECT
        dps.domain,
        dps.total_upload as totalUpload,
        dps.total_download as totalDownload,
        dps.total_connections as totalConnections,
        dps.last_seen as lastSeen,
        ds.ips
      FROM domain_proxy_stats dps
      LEFT JOIN domain_stats ds ON dps.backend_id = ds.backend_id AND dps.domain = ds.domain
      WHERE dps.backend_id = ? AND (dps.chain = ? OR dps.chain LIKE ?)
      ORDER BY (dps.total_upload + dps.total_download) DESC
      LIMIT ?
    `);
    const rows = stmt.all(backendId, chain, `${chain} > %`, limit) as Array<{
      domain: string;
      totalUpload: number;
      totalDownload: number;
      totalConnections: number;
      lastSeen: string;
      ips: string | null;
    }>;

    return rows.map(row => ({
      ...row,
      ips: row.ips ? row.ips.split(',').filter(Boolean) : [],
      rules: [],
      chains: [chain],
    })) as DomainStats[];
  }

  /**
   * Get domains for a specific rule
   */
  getRuleDomains(
    backendId: number,
    rule: string,
    limit = 50,
    start?: string,
    end?: string,
  ): DomainStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT
          domain,
          SUM(upload) as totalUpload,
          SUM(download) as totalDownload,
          SUM(connections) as totalConnections,
          MAX(${resolved.timeCol}) as lastSeen,
          GROUP_CONCAT(DISTINCT ip) as ips,
          GROUP_CONCAT(DISTINCT chain) as chains
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND rule = ? AND domain != ''
        GROUP BY domain
        ORDER BY (SUM(upload) + SUM(download)) DESC
        LIMIT ?
      `);
      const rows = stmt.all(
        backendId,
        resolved.startKey,
        resolved.endKey,
        rule,
        limit,
      ) as Array<{
        domain: string;
        totalUpload: number;
        totalDownload: number;
        totalConnections: number;
        lastSeen: string;
        ips: string | null;
        chains: string | null;
      }>;

      return rows.map(row => {
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return {
          domain: row.domain,
          totalUpload: row.totalUpload,
          totalDownload: row.totalDownload,
          totalConnections: row.totalConnections,
          lastSeen: row.lastSeen,
          ips: row.ips ? row.ips.split(',').filter(Boolean) : [],
          chains: this.expandShortChainsForRules(backendId, chains, [rule]),
          rules: [rule],
        };
      }) as DomainStats[];
    }

    // Query rule_domain_traffic for accurate all-time per-rule domain traffic
    const stmt = this.db.prepare(`
      SELECT
        rdt.domain,
        rdt.total_upload as totalUpload,
        rdt.total_download as totalDownload,
        rdt.total_connections as totalConnections,
        rdt.last_seen as lastSeen,
        ds.ips,
        ds.chains
      FROM rule_domain_traffic rdt
      LEFT JOIN domain_stats ds ON rdt.backend_id = ds.backend_id AND rdt.domain = ds.domain
      WHERE rdt.backend_id = ? AND rdt.rule = ?
      ORDER BY (rdt.total_upload + rdt.total_download) DESC
      LIMIT ?
    `);

    const rows = stmt.all(backendId, rule, limit) as Array<{
      domain: string;
      totalUpload: number;
      totalDownload: number;
      totalConnections: number;
      lastSeen: string;
      ips: string | null;
      chains: string | null;
    }>;

    return rows.map(row => ({
      domain: row.domain,
      totalUpload: row.totalUpload,
      totalDownload: row.totalDownload,
      totalConnections: row.totalConnections,
      lastSeen: row.lastSeen,
      ips: row.ips ? row.ips.split(',').filter(Boolean) : [],
      chains: this.expandShortChainsForRules(
        backendId,
        row.chains ? row.chains.split(',').filter(Boolean) : [],
        [rule],
      ),
      rules: [rule],
    })) as DomainStats[];
  }

  /**
   * Helper: Get IP stats by IPs (used for domain IP details)
   */
  private getIPStatsByIPs(backendId: number, ips: string[]): IPStats[] {
    const filteredIps = ips.filter(ip => ip && ip.trim() !== '');
    if (filteredIps.length === 0) return [];
    
    const placeholders = filteredIps.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT 
        i.ip, 
        i.domains, 
        i.total_upload as totalUpload, 
        i.total_download as totalDownload, 
        i.total_connections as totalConnections, 
        i.last_seen as lastSeen,
        COALESCE(i.asn, g.asn) as asn,
        CASE 
          WHEN g.country IS NOT NULL THEN 
            json_array(
              g.country,
              COALESCE(g.country_name, g.country),
              COALESCE(g.city, ''),
              COALESCE(g.as_name, '')
            )
          WHEN i.geoip IS NOT NULL THEN 
            json(i.geoip)
          ELSE 
            NULL
        END as geoIP,
        i.chains
      FROM ip_stats i
      LEFT JOIN geoip_cache g ON i.ip = g.ip
      WHERE i.backend_id = ? AND i.ip IN (${placeholders})
      ORDER BY (i.total_upload + i.total_download) DESC
    `);
    const rows = stmt.all(backendId, ...filteredIps) as Array<{
      ip: string;
      domains: string;
      totalUpload: number;
      totalDownload: number;
      totalConnections: number;
      lastSeen: string;
      asn: string | null;
      geoIP: string | null;
      chains: string | null;
    }>;
    
    return rows.map(row => ({
      ...row,
      domains: row.domains ? row.domains.split(',') : [],
      geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined,
      asn: row.asn || undefined,
      chains: row.chains ? row.chains.split(',') : [],
    })) as IPStats[];
  }

}
