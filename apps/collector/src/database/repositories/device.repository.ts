/**
 * Device Repository
 *
 * Handles device (source IP) statistics and their domain/IP breakdowns.
 */
import type Database from 'better-sqlite3';
import type { DomainStats, IPStats, DeviceStats } from '@neko-master/shared';
import { BaseRepository } from './base.repository.js';

export class DeviceRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  getDevices(backendId: number, limit = 50, start?: string, end?: string): DeviceStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT source_ip as sourceIP, SUM(upload) as totalUpload, SUM(download) as totalDownload,
               SUM(connections) as totalConnections, MAX(${resolved.timeCol}) as lastSeen
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND source_ip != ''
        GROUP BY source_ip
        ORDER BY (SUM(upload) + SUM(download)) DESC
        LIMIT ?
      `);
      return stmt.all(backendId, resolved.startKey, resolved.endKey, limit) as DeviceStats[];
    }

    const stmt = this.db.prepare(`
      SELECT source_ip as sourceIP, total_upload as totalUpload, total_download as totalDownload,
             total_connections as totalConnections, last_seen as lastSeen
      FROM device_stats WHERE backend_id = ?
      ORDER BY (total_upload + total_download) DESC
      LIMIT ?
    `);
    return stmt.all(backendId, limit) as DeviceStats[];
  }

  getDeviceDomains(backendId: number, sourceIP: string, limit = 5000, start?: string, end?: string): DomainStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT domain, SUM(upload) as totalUpload, SUM(download) as totalDownload,
               SUM(connections) as totalConnections, MAX(${resolved.timeCol}) as lastSeen,
               GROUP_CONCAT(DISTINCT ip) as ips, GROUP_CONCAT(DISTINCT rule) as rules, GROUP_CONCAT(DISTINCT chain) as chains
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ? AND source_ip = ? AND domain != ''
        GROUP BY domain ORDER BY (SUM(upload) + SUM(download)) DESC LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, sourceIP, limit) as Array<{
        domain: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string;
        ips: string | null; rules: string | null; chains: string | null;
      }>;
      return rows.map(row => {
        const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return { ...row, ips: row.ips ? row.ips.split(',').filter(Boolean) : [], rules, chains: this.expandShortChainsForRules(backendId, chains, rules) };
      }) as DomainStats[];
    }

    const stmt = this.db.prepare(`
      SELECT d.domain, d.total_upload as totalUpload, d.total_download as totalDownload,
             d.total_connections as totalConnections, d.last_seen as lastSeen, g.ips
      FROM device_domain_stats d
      LEFT JOIN domain_stats g ON d.domain = g.domain AND d.backend_id = g.backend_id
      WHERE d.backend_id = ? AND d.source_ip = ?
      ORDER BY (d.total_upload + d.total_download) DESC LIMIT ?
    `);
    const result = stmt.all(backendId, sourceIP, limit) as any[];
    return result.map(r => ({ ...r, ips: r.ips ? r.ips.split(',') : [], rules: [], chains: [] }));
  }

  getDeviceIPs(backendId: number, sourceIP: string, limit = 5000, start?: string, end?: string): IPStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveFactTable(start!, end!);
      const stmt = this.db.prepare(`
        SELECT m.ip, SUM(m.upload) as totalUpload, SUM(m.download) as totalDownload,
               SUM(m.connections) as totalConnections, MAX(m.${resolved.timeCol}) as lastSeen,
               GROUP_CONCAT(DISTINCT CASE WHEN m.domain != '' THEN m.domain END) as domains,
               COALESCE(i.asn, g.asn) as asn,
               CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                    WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP,
               GROUP_CONCAT(DISTINCT m.chain) as chains, GROUP_CONCAT(DISTINCT m.rule) as rules
        FROM ${resolved.table} m
        LEFT JOIN ip_stats i ON m.backend_id = i.backend_id AND m.ip = i.ip
        LEFT JOIN geoip_cache g ON m.ip = g.ip
        WHERE m.backend_id = ? AND m.${resolved.timeCol} >= ? AND m.${resolved.timeCol} <= ? AND m.source_ip = ? AND m.ip != ''
        GROUP BY m.ip ORDER BY (SUM(m.upload) + SUM(m.download)) DESC LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, sourceIP, limit) as Array<{
        ip: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string;
        domains: string | null; asn: string | null; geoIP: string | null; chains: string | null; rules: string | null;
      }>;
      return rows.map(row => {
        const rules = row.rules ? row.rules.split(',').filter(Boolean) : [];
        const chains = row.chains ? row.chains.split(',').filter(Boolean) : [];
        return {
          ...row, domains: row.domains ? row.domains.split(',').filter(Boolean) : [],
          geoIP: row.geoIP ? JSON.parse(row.geoIP) : undefined, asn: row.asn || undefined,
          chains: this.expandShortChainsForRules(backendId, chains, rules),
        };
      }) as IPStats[];
    }

    const stmt = this.db.prepare(`
      SELECT d.ip, d.total_upload as totalUpload, d.total_download as totalDownload,
             d.total_connections as totalConnections, d.last_seen as lastSeen, i.domains,
             COALESCE(i.asn, g.asn) as asn,
             CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
                  WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP
      FROM device_ip_stats d
      LEFT JOIN ip_stats i ON d.ip = i.ip AND d.backend_id = i.backend_id
      LEFT JOIN geoip_cache g ON d.ip = g.ip
      WHERE d.backend_id = ? AND d.source_ip = ?
      ORDER BY (d.total_upload + d.total_download) DESC LIMIT ?
    `);
    const result = stmt.all(backendId, sourceIP, limit) as any[];
    return result.map(r => ({
      ...r, domains: r.domains ? r.domains.split(',') : [],
      geoIP: r.geoIP ? JSON.parse(r.geoIP) : undefined, asn: r.asn || undefined,
    }));
  }
}
