/**
 * Proxy Repository
 *
 * Handles proxy/chain statistics and their domain/IP breakdowns.
 */
import type Database from 'better-sqlite3';
import type { DomainStats, IPStats, ProxyStats } from '@neko-master/shared';
import { BaseRepository } from './base.repository.js';

export class ProxyRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  getProxyStats(backendId: number, start?: string, end?: string): ProxyStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT chain, SUM(upload) as totalUpload, SUM(download) as totalDownload,
               SUM(connections) as totalConnections, MAX(${resolved.timeCol}) as lastSeen
        FROM ${this.readStatsTable(resolved.table, backendId)} WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ?
        GROUP BY chain ORDER BY (SUM(upload) + SUM(download)) DESC
      `);
      return this.aggregateProxyStatsByFirstHop(stmt.all(backendId, resolved.startKey, resolved.endKey) as ProxyStats[]);
    }

    const stmt = this.db.prepare(`
      SELECT chain, total_upload as totalUpload, total_download as totalDownload,
             total_connections as totalConnections, last_seen as lastSeen
      FROM ${this.readStatsTable('proxy_stats', backendId)} WHERE backend_id = ? ORDER BY (total_upload + total_download) DESC
    `);
    return this.aggregateProxyStatsByFirstHop(stmt.all(backendId) as ProxyStats[]);
  }

  getProxyDomains(backendId: number, chain: string, limit = 50, start?: string, end?: string): DomainStats[] {
    chain = this.aliasChain(backendId, chain);
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT domain, SUM(upload) as totalUpload, SUM(download) as totalDownload,
               SUM(connections) as totalConnections, MAX(${resolved.timeCol}) as lastSeen, GROUP_CONCAT(DISTINCT ip) as ips
        FROM ${this.readStatsTable(resolved.table, backendId)}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND (chain = ? OR instr(chain, ?) = 1) AND domain != ''
        GROUP BY domain ORDER BY (SUM(upload) + SUM(download)) DESC LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, chain, `${chain} > `, limit) as Array<{
        domain: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string; ips: string | null;
      }>;
      return rows.map(row => ({ ...row, ips: row.ips ? row.ips.split(',').filter(Boolean) : [], rules: [], chains: [chain] })) as DomainStats[];
    }

    const stmt = this.db.prepare(`
      SELECT dps.domain, SUM(dps.total_upload) as totalUpload, SUM(dps.total_download) as totalDownload,
             SUM(dps.total_connections) as totalConnections, MAX(dps.last_seen) as lastSeen, MAX(ds.ips) as ips
      FROM ${this.readStatsTable('domain_proxy_stats', backendId)} dps
      LEFT JOIN domain_stats ds ON dps.backend_id = ds.backend_id AND dps.domain = ds.domain
      WHERE dps.backend_id = ? AND (dps.chain = ? OR instr(dps.chain, ?) = 1)
      GROUP BY dps.domain
      ORDER BY (SUM(dps.total_upload) + SUM(dps.total_download)) DESC LIMIT ?
    `);
    const rows = stmt.all(backendId, chain, `${chain} > `, limit) as Array<{
      domain: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string; ips: string | null;
    }>;
    return rows.map(row => ({ ...row, ips: row.ips ? row.ips.split(',').filter(Boolean) : [], rules: [], chains: [chain] })) as DomainStats[];
  }

  getProxyIPs(backendId: number, chain: string, limit = 50, start?: string, end?: string): IPStats[] {
    chain = this.aliasChain(backendId, chain);
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT m.ip, SUM(m.upload) as totalUpload, SUM(m.download) as totalDownload,
               SUM(m.connections) as totalConnections, MAX(m.${resolved.timeCol}) as lastSeen,
               GROUP_CONCAT(DISTINCT CASE WHEN m.domain != '' THEN m.domain END) as domains,
               COALESCE(i.asn, g.asn) as asn,
               CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                    WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP
        FROM ${this.readStatsTable(resolved.table, backendId)} m
        LEFT JOIN ip_stats i ON m.backend_id = i.backend_id AND m.ip = i.ip
        LEFT JOIN geoip_cache g ON m.ip = g.ip
        WHERE m.backend_id = ? AND m.${resolved.timeCol} >= ? AND m.${resolved.timeCol} <= ? AND (m.chain = ? OR instr(m.chain, ?) = 1) AND m.ip != ''
        GROUP BY m.ip ORDER BY (SUM(m.upload) + SUM(m.download)) DESC LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, chain, `${chain} > `, limit) as Array<{
        ip: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string;
        domains: string | null; asn: string | null; geoIP: string | null;
      }>;
      return rows.map(row => ({
        ...row, domains: row.domains ? [...new Set(row.domains.split(',').filter(Boolean))] : [], chains: [chain],
        asn: row.asn || undefined, geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined,
      })) as IPStats[];
    }

    const stmt = this.db.prepare(`
      SELECT ips.ip, SUM(ips.total_upload) as totalUpload, SUM(ips.total_download) as totalDownload,
             SUM(ips.total_connections) as totalConnections, MAX(ips.last_seen) as lastSeen, GROUP_CONCAT(DISTINCT ips.domains) as domains
      FROM ${this.readStatsTable('ip_proxy_stats', backendId)} ips
      WHERE ips.backend_id = ? AND (ips.chain = ? OR instr(ips.chain, ?) = 1) AND ips.ip != ''
      GROUP BY ips.ip
      ORDER BY (SUM(ips.total_upload) + SUM(ips.total_download)) DESC LIMIT ?
    `);
    const rows = stmt.all(backendId, chain, `${chain} > `, limit) as Array<{
      ip: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string; domains: string | null;
    }>;

    const ipList = rows.map(r => r.ip).filter(ip => ip && ip.trim() !== '');
    if (ipList.length === 0) return [];

    const placeholders = ipList.map(() => '?').join(',');
    const geoStmt = this.db.prepare(`
      SELECT ip, CASE WHEN country IS NOT NULL THEN json_array(country, COALESCE(country_name, country), COALESCE(city, ''), COALESCE(as_name, '')) ELSE NULL END as geoIP
      FROM geoip_cache WHERE ip IN (${placeholders})
    `);
    const geoRows = geoStmt.all(...ipList) as Array<{ ip: string; geoIP: string | null }>;
    const geoMap = new Map(geoRows.map(r => [r.ip, r.geoIP]));

    return rows.map(row => ({
      ...row, domains: row.domains ? [...new Set(row.domains.split(',').filter(Boolean))] : [], chains: [chain],
      geoIP: geoMap.get(row.ip) ? JSON.parse(geoMap.get(row.ip)!) : undefined,
    })) as IPStats[];
  }
}
