import { shouldUseHourlyTables } from '../../shared/utils/fact-table-routing.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { normalizeGeoIP, type Connection, type DomainStats, type IPStats, type HourlyStats, type ProxyStats, type RuleStats, type ProxyTrafficStats, type DeviceStats } from '@neko-master/shared';
import { getAllSchemaStatements } from '../../database/schema.js';
import { getProxyNameAliases, saveProxyNameAliases, aliasChain } from '../../database/proxy-name-alias.js';
import type { ProxyNameAlias } from '@neko-master/shared';
import { cleanupMisattributedRuleNames } from '../../database/rule-name-cleanup.js';
import {
  AuthRepository,
  SurgeRepository,
  TimeseriesRepository,
  CountryRepository,
  DeviceRepository,
  ProxyRepository,
  RuleRepository,
  IPRepository,
  ConfigRepository,
  type GeoLookupConfig,
  type GeoLookupProvider,
  TrafficWriterRepository,
  DomainRepository,
  BackendRepository,
  HealthRepository,
} from '../../database/repositories/index.js';

export interface TrafficUpdate {
  domain: string;
  ip: string;
  chain: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  upload: number;
  download: number;
  connections?: number;
  sourceIP?: string;
  timestampMs?: number;
}

export interface BackendConfig {
  id: number;
  name: string;
  url: string;
  token: string;
  type: 'clash' | 'surge';
  enabled: boolean;
  is_active: boolean;
  listening: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentHeartbeat {
  backendId: number;
  agentId: string;
  hostname?: string;
  version?: string;
  gatewayType?: string;
  gatewayUrl?: string;
  remoteIP?: string;
  gatewayLatencyMs?: number | null;
  serverLatencyMs?: number | null;
  lastSeen: string;
}

function normalizeIPStatsGeoIP(items: IPStats[]): IPStats[] {
  return items.map((item) => {
    const normalizedGeoIP = normalizeGeoIP(item.geoIP as unknown);
    return {
      ...item,
      geoIP: normalizedGeoIP ?? undefined,
    };
  });
}

function normalizePaginatedIPStatsGeoIP(result: { data: IPStats[]; total: number }): { data: IPStats[]; total: number } {
  return {
    ...result,
    data: normalizeIPStatsGeoIP(result.data),
  };
}

export class StatsDatabase {
  getProxyNameAliases(backendId: number): ProxyNameAlias[] {
    return getProxyNameAliases(this.db, backendId);
  }

  updateProxyNameAliases(backendId: number, rules: unknown): ProxyNameAlias[] {
    const saved = saveProxyNameAliases(this.db, backendId, rules);
    this.clearRangeQueryCache(backendId);
    return saved;
  }

  normalizeProxyChain(backendId: number, chain: string): string {
    return aliasChain(this.db, backendId, chain);
  }

  private db: Database.Database;
  private dbPath: string;

  // Cached prepared statements for getSummary() — avoids re-compilation per call
  private _summaryStmts: ReturnType<StatsDatabase['prepareSummaryStmts']> | null = null;
  private rangeQueryCache = new Map<string, { value: unknown; expiresAt: number }>();

  public readonly repos: {
    auth: AuthRepository;
    surge: SurgeRepository;
    timeseries: TimeseriesRepository;
    country: CountryRepository;
    device: DeviceRepository;
    proxy: ProxyRepository;
    rule: RuleRepository;
    ip: IPRepository;
    config: ConfigRepository;
    trafficWriter: TrafficWriterRepository;
    domain: DomainRepository;
    backend: BackendRepository;
    health: HealthRepository;
  };

  constructor(dbPath = 'stats.db') {
    this.dbPath = path.resolve(dbPath);
    this.db = new Database(this.dbPath);
    this.init();

    this.repos = {
      auth: new AuthRepository(this.db),
      surge: new SurgeRepository(this.db),
      timeseries: new TimeseriesRepository(this.db),
      country: new CountryRepository(this.db),
      device: new DeviceRepository(this.db),
      proxy: new ProxyRepository(this.db),
      rule: new RuleRepository(this.db),
      ip: new IPRepository(this.db),
      config: new ConfigRepository(this.db, this.dbPath),
      trafficWriter: new TrafficWriterRepository(this.db),
      domain: new DomainRepository(this.db),
      backend: new BackendRepository(this.db),
      health: new HealthRepository(this.db),
    };
  }

  private init() {
    const sqliteCacheMb = Math.max(
      16,
      Number.parseInt(process.env.SQLITE_CACHE_MB || '64', 10) || 64,
    );
    const sqliteWalAutocheckpointPages = Math.max(
      100,
      Number.parseInt(process.env.SQLITE_WAL_AUTOCHECKPOINT_PAGES || '1000', 10) || 1000,
    );
    const sqliteBusyTimeoutMs = Math.max(
      1000,
      Number.parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || '5000', 10) || 5000,
    );

    // Enable WAL mode and performance PRAGMAs for reduced disk IO
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma(`wal_autocheckpoint = ${sqliteWalAutocheckpointPages}`);
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma(`cache_size = -${sqliteCacheMb * 1024}`);
    this.db.pragma(`busy_timeout = ${sqliteBusyTimeoutMs}`);

    console.info(
      `[DB] SQLite tuning: cache=${sqliteCacheMb}MB, wal_autocheckpoint=${sqliteWalAutocheckpointPages}, busy_timeout=${sqliteBusyTimeoutMs}ms`,
    );

    // Apply all schema statements from the single source of truth
    for (const stmt of getAllSchemaStatements()) {
      this.db.exec(stmt);
    }

    // Drop legacy (total_download + total_upload) expression indexes: the
    // planner never used them (queries filter by backend_id first) and they
    // amplified every write to the four hottest tables.
    for (const idx of ['idx_domain_stats_traffic', 'idx_ip_stats_traffic', 'idx_proxy_stats_traffic', 'idx_rule_stats_traffic']) {
      this.db.exec(`DROP INDEX IF EXISTS ${idx}`);
    }

    // Migration: Add type column if not exists (for older databases)
    try {
      this.db.exec(`ALTER TABLE backend_configs ADD COLUMN type TEXT DEFAULT 'clash'`);
      console.log('[DB] Migration: Added type column to backend_configs');
    } catch {
      // Column already exists, ignore
    }

    // Migrate existing data if needed (from single-backend schema)
    this.migrateIfNeeded();

    // One-time cleanup: remap v1.3.9-era rule-type keys back to policy groups
    try {
      cleanupMisattributedRuleNames(this.db);
    } catch (error) {
      console.error('[DB] Rule name cleanup failed:', error);
    }

    // Backfill hourly tables from minute data (one-time)
    this.backfillHourlyTables();
  }

  // Migrate from old single-backend schema to multi-backend schema
  private migrateIfNeeded() {
    // Check if we need to migrate by checking if there's data without backend_id
    const needsMigration = this.db.prepare(`
      SELECT 1 FROM sqlite_master 
      WHERE type='table' AND name='domain_stats'
    `).get() as { '1': number } | undefined;

    if (!needsMigration) return;

    // Check if domain_stats table has backend_id column
    const tableInfo = this.db.prepare(`PRAGMA table_info(domain_stats)`).all() as { name: string }[];
    const hasBackendId = tableInfo.some(col => col.name === 'backend_id');

    if (!hasBackendId) {
      console.log('[DB] Migrating from single-backend to multi-backend schema...');
      this.performMigration();
    }

    // Check if backend_configs has listening column
    const backendInfo = this.db.prepare(`PRAGMA table_info(backend_configs)`).all() as { name: string }[];
    const hasListening = backendInfo.some(col => col.name === 'listening');

    if (!hasListening) {
      console.log('[DB] Adding listening column to backend_configs...');
      this.db.exec(`ALTER TABLE backend_configs ADD COLUMN listening BOOLEAN DEFAULT 1;`);
    }

    // Check if backend_configs has type column
    const hasType = backendInfo.some(col => col.name === 'type');

    if (!hasType) {
      console.log('[DB] Adding type column to backend_configs...');
      this.db.exec(`ALTER TABLE backend_configs ADD COLUMN type TEXT DEFAULT 'clash';`);
    }

    // Check if ip_stats has chains column (added for proxy display per IP)
    const ipStatsInfo = this.db.prepare(`PRAGMA table_info(ip_stats)`).all() as { name: string }[];
    const hasIPChains = ipStatsInfo.some(col => col.name === 'chains');

    if (!hasIPChains) {
      console.log('[DB] Adding chains column to ip_stats...');
      this.db.exec(`ALTER TABLE ip_stats ADD COLUMN chains TEXT;`);
    }

    // Check if ip_stats has rules column (added for per-rule IP traffic)
    const ipStatsInfo2 = this.db.prepare(`PRAGMA table_info(ip_stats)`).all() as { name: string }[];
    const hasIPRules = ipStatsInfo2.some(col => col.name === 'rules');

    if (!hasIPRules) {
      console.log('[DB] Adding rules column to ip_stats...');
      this.db.exec(`ALTER TABLE ip_stats ADD COLUMN rules TEXT;`);
    }

    // Check if domain_stats has rules column
    const domainStatsInfo = this.db.prepare(`PRAGMA table_info(domain_stats)`).all() as { name: string }[];
    const hasDomainRules = domainStatsInfo.some(col => col.name === 'rules');

    if (!hasDomainRules) {
      console.log('[DB] Adding rules column to domain_stats...');
      this.db.exec(`ALTER TABLE domain_stats ADD COLUMN rules TEXT;`);
    }

    // Check if domain_stats has chains column
    const hasDomainChains = domainStatsInfo.some(col => col.name === 'chains');

    if (!hasDomainChains) {
      console.log('[DB] Adding chains column to domain_stats...');
      this.db.exec(`ALTER TABLE domain_stats ADD COLUMN chains TEXT;`);
    }

    // Migration: Add gateway_latency_ms column to agent_heartbeats
    try {
      this.db.exec(`ALTER TABLE agent_heartbeats ADD COLUMN gateway_latency_ms INTEGER`);
      console.log('[DB] Migration: Added gateway_latency_ms column to agent_heartbeats');
    } catch {
      // Column already exists
    }

    // Migration: Add server_latency_ms column to agent_heartbeats
    try {
      this.db.exec(`ALTER TABLE agent_heartbeats ADD COLUMN server_latency_ms INTEGER`);
      console.log('[DB] Migration: Added server_latency_ms column to agent_heartbeats');
    } catch {
      // Column already exists
    }

    // Migration: Add server_latency_ms column to backend_health_logs
    try {
      this.db.exec(`ALTER TABLE backend_health_logs ADD COLUMN server_latency_ms INTEGER`);
      console.log('[DB] Migration: Added server_latency_ms column to backend_health_logs');
    } catch {
      // Column already exists
    }

    // Migrate connection_logs data to new aggregation tables (one-time backfill)
    this.migrateConnectionLogsToAggregation();
  }

  // Backfill minute_stats, domain_proxy_stats, ip_proxy_stats from connection_logs
  private migrateConnectionLogsToAggregation() {
    // Check if minute_stats is empty and connection_logs has data
    const minuteCount = (this.db.prepare(`SELECT COUNT(*) as c FROM minute_stats`).get() as { c: number }).c;
    const logCount = (this.db.prepare(`SELECT COUNT(*) as c FROM connection_logs`).get() as { c: number }).c;

    if (minuteCount > 0 || logCount === 0) return;

    console.log(`[DB] Migrating ${logCount} connection_logs rows to aggregation tables...`);

    try {
      this.db.exec(`BEGIN TRANSACTION`);

      // Backfill minute_stats
      this.db.exec(`
        INSERT INTO minute_stats (backend_id, minute, upload, download, connections)
        SELECT backend_id,
               strftime('%Y-%m-%dT%H:%M:00', timestamp) as minute,
               SUM(upload), SUM(download), COUNT(*)
        FROM connection_logs
        GROUP BY backend_id, strftime('%Y-%m-%dT%H:%M:00', timestamp)
      `);

      // Backfill domain_proxy_stats
      this.db.exec(`
        INSERT INTO domain_proxy_stats (backend_id, domain, chain, total_upload, total_download, total_connections, last_seen)
        SELECT backend_id, domain, chain,
               SUM(upload), SUM(download), COUNT(*), MAX(timestamp)
        FROM connection_logs
        WHERE domain IS NOT NULL AND domain != 'unknown'
        GROUP BY backend_id, domain, chain
      `);

      // Backfill ip_proxy_stats
      this.db.exec(`
        INSERT INTO ip_proxy_stats (backend_id, ip, chain, total_upload, total_download, total_connections, last_seen, domains)
        SELECT backend_id, ip, chain,
               SUM(upload), SUM(download), COUNT(*), MAX(timestamp),
               GROUP_CONCAT(DISTINCT CASE WHEN domain IS NOT NULL AND domain != 'unknown' THEN domain END)
        FROM connection_logs
        GROUP BY backend_id, ip, chain
      `);

      this.db.exec(`COMMIT`);
      console.log('[DB] Migration to aggregation tables completed successfully');
    } catch (error) {
      this.db.exec(`ROLLBACK`);
      console.error('[DB] Migration to aggregation tables failed:', error);
    }
  }

  /**
   * One-time backfill: populate hourly_dim_stats and hourly_country_stats
   * from existing minute_dim_stats and minute_country_stats data.
   */
  private backfillHourlyTables() {
    const hourlyDimCount = (this.db.prepare(`SELECT COUNT(*) as c FROM hourly_dim_stats`).get() as { c: number }).c;
    const minuteDimCount = (this.db.prepare(`SELECT COUNT(*) as c FROM minute_dim_stats`).get() as { c: number }).c;

    if (hourlyDimCount > 0 || minuteDimCount === 0) return;

    console.log(`[DB] Backfilling hourly tables from ${minuteDimCount} minute_dim_stats rows...`);

    try {
      this.db.exec(`BEGIN TRANSACTION`);

      // Backfill hourly_dim_stats from minute_dim_stats
      this.db.exec(`
        INSERT INTO hourly_dim_stats (backend_id, hour, domain, ip, source_ip, chain, rule, upload, download, connections)
        SELECT backend_id,
               SUBSTR(minute, 1, 13) || ':00:00' as hour,
               domain, ip, source_ip, chain, rule,
               SUM(upload), SUM(download), SUM(connections)
        FROM minute_dim_stats
        GROUP BY backend_id, SUBSTR(minute, 1, 13), domain, ip, source_ip, chain, rule
      `);

      // Backfill hourly_country_stats from minute_country_stats
      const minuteCountryCount = (this.db.prepare(`SELECT COUNT(*) as c FROM minute_country_stats`).get() as { c: number }).c;
      if (minuteCountryCount > 0) {
        this.db.exec(`
          INSERT INTO hourly_country_stats (backend_id, hour, country, country_name, continent, upload, download, connections)
          SELECT backend_id,
                 SUBSTR(minute, 1, 13) || ':00:00' as hour,
                 country, MAX(country_name), MAX(continent),
                 SUM(upload), SUM(download), SUM(connections)
          FROM minute_country_stats
          GROUP BY backend_id, SUBSTR(minute, 1, 13), country
        `);
      }

      this.db.exec(`COMMIT`);
      const hourlyRows = (this.db.prepare(`SELECT COUNT(*) as c FROM hourly_dim_stats`).get() as { c: number }).c;
      console.log(`[DB] Backfill complete: ${hourlyRows} hourly_dim_stats rows created`);
    } catch (error) {
      this.db.exec(`ROLLBACK`);
      console.error('[DB] Hourly backfill failed:', error);
    }
  }

  private performMigration() {
    // Create temporary tables with new schema and migrate data
    // This is a complex migration - we'll create a default backend and associate all data with it

    this.db.exec(`BEGIN TRANSACTION;`);

    try {
      // Create a default backend if none exists
      const existingBackend = this.db.prepare(`SELECT id FROM backend_configs LIMIT 1`).get() as { id: number } | undefined;
      let defaultBackendId: number;

      if (!existingBackend) {
        const result = this.db.prepare(`
          INSERT INTO backend_configs (name, url, token, enabled, is_active, listening)
          VALUES ('Default', 'http://192.168.1.1:9090', '', 1, 1, 1)
        `).run();
        defaultBackendId = Number(result.lastInsertRowid);
      } else {
        defaultBackendId = existingBackend.id;
      }

      // Migrate domain_stats - recreate table with new schema
      this.db.exec(`
        CREATE TABLE domain_stats_new (
          backend_id INTEGER NOT NULL,
          domain TEXT NOT NULL,
          ips TEXT,
          total_upload INTEGER DEFAULT 0,
          total_download INTEGER DEFAULT 0,
          total_connections INTEGER DEFAULT 0,
          last_seen DATETIME,
          rules TEXT,
          chains TEXT,
          PRIMARY KEY (backend_id, domain),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO domain_stats_new 
        SELECT ${defaultBackendId} as backend_id, domain, ips, total_upload, total_download, 
               total_connections, last_seen, rules, chains 
        FROM domain_stats;
      `);
      this.db.exec(`DROP TABLE domain_stats;`);
      this.db.exec(`ALTER TABLE domain_stats_new RENAME TO domain_stats;`);

      // Migrate ip_stats
      this.db.exec(`
        CREATE TABLE ip_stats_new (
          backend_id INTEGER NOT NULL,
          ip TEXT NOT NULL,
          domains TEXT,
          total_upload INTEGER DEFAULT 0,
          total_download INTEGER DEFAULT 0,
          total_connections INTEGER DEFAULT 0,
          last_seen DATETIME,
          asn TEXT,
          geoip TEXT,
          chains TEXT,
          rules TEXT,
          PRIMARY KEY (backend_id, ip),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO ip_stats_new 
        SELECT ${defaultBackendId} as backend_id, ip, domains, total_upload, total_download, 
               total_connections, last_seen, asn, geoip, NULL 
        FROM ip_stats;
      `);
      this.db.exec(`DROP TABLE ip_stats;`);
      this.db.exec(`ALTER TABLE ip_stats_new RENAME TO ip_stats;`);

      // Migrate proxy_stats
      this.db.exec(`
        CREATE TABLE proxy_stats_new (
          backend_id INTEGER NOT NULL,
          chain TEXT NOT NULL,
          total_upload INTEGER DEFAULT 0,
          total_download INTEGER DEFAULT 0,
          total_connections INTEGER DEFAULT 0,
          last_seen DATETIME,
          PRIMARY KEY (backend_id, chain),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO proxy_stats_new 
        SELECT ${defaultBackendId} as backend_id, chain, total_upload, total_download, 
               total_connections, last_seen 
        FROM proxy_stats;
      `);
      this.db.exec(`DROP TABLE proxy_stats;`);
      this.db.exec(`ALTER TABLE proxy_stats_new RENAME TO proxy_stats;`);

      // Migrate rule_stats
      this.db.exec(`
        CREATE TABLE rule_stats_new (
          backend_id INTEGER NOT NULL,
          rule TEXT NOT NULL,
          final_proxy TEXT,
          total_upload INTEGER DEFAULT 0,
          total_download INTEGER DEFAULT 0,
          total_connections INTEGER DEFAULT 0,
          last_seen DATETIME,
          PRIMARY KEY (backend_id, rule),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO rule_stats_new 
        SELECT ${defaultBackendId} as backend_id, rule, final_proxy, total_upload, total_download, 
               total_connections, last_seen 
        FROM rule_stats;
      `);
      this.db.exec(`DROP TABLE rule_stats;`);
      this.db.exec(`ALTER TABLE rule_stats_new RENAME TO rule_stats;`);

      // Migrate rule_proxy_map
      this.db.exec(`
        CREATE TABLE rule_proxy_map_new (
          backend_id INTEGER NOT NULL,
          rule TEXT,
          proxy TEXT,
          PRIMARY KEY (backend_id, rule, proxy),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO rule_proxy_map_new 
        SELECT ${defaultBackendId} as backend_id, rule, proxy 
        FROM rule_proxy_map;
      `);
      this.db.exec(`DROP TABLE rule_proxy_map;`);
      this.db.exec(`ALTER TABLE rule_proxy_map_new RENAME TO rule_proxy_map;`);

      // Migrate country_stats
      this.db.exec(`
        CREATE TABLE country_stats_new (
          backend_id INTEGER NOT NULL,
          country TEXT NOT NULL,
          country_name TEXT,
          continent TEXT,
          total_upload INTEGER DEFAULT 0,
          total_download INTEGER DEFAULT 0,
          total_connections INTEGER DEFAULT 0,
          last_seen DATETIME,
          PRIMARY KEY (backend_id, country),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO country_stats_new 
        SELECT ${defaultBackendId} as backend_id, country, country_name, continent, total_upload, 
               total_download, total_connections, last_seen 
        FROM country_stats;
      `);
      this.db.exec(`DROP TABLE country_stats;`);
      this.db.exec(`ALTER TABLE country_stats_new RENAME TO country_stats;`);

      // Migrate hourly_stats
      this.db.exec(`
        CREATE TABLE hourly_stats_new (
          backend_id INTEGER NOT NULL,
          hour TEXT NOT NULL,
          upload INTEGER DEFAULT 0,
          download INTEGER DEFAULT 0,
          connections INTEGER DEFAULT 0,
          PRIMARY KEY (backend_id, hour),
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO hourly_stats_new 
        SELECT ${defaultBackendId} as backend_id, hour, upload, download, connections 
        FROM hourly_stats;
      `);
      this.db.exec(`DROP TABLE hourly_stats;`);
      this.db.exec(`ALTER TABLE hourly_stats_new RENAME TO hourly_stats;`);

      // Migrate connection_logs
      this.db.exec(`
        CREATE TABLE connection_logs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          backend_id INTEGER NOT NULL,
          domain TEXT,
          ip TEXT,
          chain TEXT,
          upload INTEGER DEFAULT 0,
          download INTEGER DEFAULT 0,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (backend_id) REFERENCES backend_configs(id) ON DELETE CASCADE
        );
      `);
      this.db.exec(`
        INSERT INTO connection_logs_new (id, backend_id, domain, ip, chain, upload, download, timestamp)
        SELECT id, ${defaultBackendId} as backend_id, domain, ip, chain, upload, download, timestamp 
        FROM connection_logs;
      `);
      this.db.exec(`DROP TABLE connection_logs;`);
      this.db.exec(`ALTER TABLE connection_logs_new RENAME TO connection_logs;`);

      this.db.exec(`COMMIT;`);
      console.log('[DB] Migration completed successfully');
    } catch (error) {
      this.db.exec(`ROLLBACK;`);
      console.error('[DB] Migration failed:', error);
      throw error;
    }
  }

  // ==================== Traffic Writer ====================
  updateTrafficStats(backendId: number, update: TrafficUpdate) { this.repos.trafficWriter.updateTrafficStats(backendId, update); }
  batchUpdateTrafficStats(backendId: number, updates: TrafficUpdate[], reduceWrites = false) { this.repos.trafficWriter.batchUpdateTrafficStats(backendId, updates, reduceWrites); }

  // ==================== Domain ====================
  getDomainByName(backendId: number, domain: string) { return this.repos.domain.getDomainByName(backendId, domain); }
  getDomainStats(backendId: number, limit = 100, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'domainStats',
      [backendId, limit, start || '', end || ''],
      start,
      end,
      () => this.repos.domain.getDomainStats(backendId, limit, start, end),
    );
  }
  getTopDomains(backendId: number, limit = 10, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'topDomains',
      [backendId, limit, start || '', end || ''],
      start,
      end,
      () => this.repos.domain.getTopDomains(backendId, limit, start, end),
    );
  }
  getTopDomainsLight(backendId: number, limit = 10, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'topDomainsLight',
      [backendId, limit, start || '', end || ''],
      start,
      end,
      () => this.repos.domain.getTopDomainsLight(backendId, limit, start, end),
    );
  }
  getDomainStatsPaginated(
    backendId: number,
    opts: { offset?: number; limit?: number; sortBy?: string; sortOrder?: string; search?: string; start?: string; end?: string } = {},
  ) {
    return this.withRangeQueryCache(
      'domainStatsPaginated',
      [backendId, opts.offset || 0, opts.limit || 50, opts.sortBy || '', opts.sortOrder || '', opts.search || '', opts.start || '', opts.end || ''],
      opts.start,
      opts.end,
      () => this.repos.domain.getDomainStatsPaginated(backendId, opts),
    );
  }
  getDomainIPDetails(backendId: number, domain: string, start?: string, end?: string, limit?: number, sourceIP?: string, sourceChain?: string) {
    return normalizeIPStatsGeoIP(
      this.repos.ip.getDomainIPDetails(backendId, domain, start, end, limit, sourceIP, sourceChain),
    );
  }
  getDomainProxyStats(backendId: number, domain: string, start?: string, end?: string, sourceIP?: string, sourceChain?: string) { return this.repos.domain.getDomainProxyStats(backendId, domain, start, end, sourceIP, sourceChain); }

  // ==================== IP ====================
  getIPStats(backendId: number, limit = 100, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'ipStats',
      [backendId, limit, start || '', end || ''],
      start,
      end,
      () => normalizeIPStatsGeoIP(this.repos.ip.getIPStats(backendId, limit, start, end)),
    );
  }
  getIPStatsByIPs(backendId: number, ips: string[]) {
    return normalizeIPStatsGeoIP(this.repos.ip.getIPStatsByIPs(backendId, ips));
  }
  getIPStatsPaginated(
    backendId: number,
    opts: { offset?: number; limit?: number; sortBy?: string; sortOrder?: string; search?: string; start?: string; end?: string } = {},
  ) {
    return this.withRangeQueryCache(
      'ipStatsPaginated',
      [backendId, opts.offset || 0, opts.limit || 50, opts.sortBy || '', opts.sortOrder || '', opts.search || '', opts.start || '', opts.end || ''],
      opts.start,
      opts.end,
      () => normalizePaginatedIPStatsGeoIP(this.repos.ip.getIPStatsPaginated(backendId, opts)),
    );
  }
  getIPDomainDetails(backendId: number, ip: string, start?: string, end?: string, limit?: number, sourceIP?: string, sourceChain?: string) { return this.repos.ip.getIPDomainDetails(backendId, ip, start, end, limit, sourceIP, sourceChain); }
  getIPProxyStats(backendId: number, ip: string, start?: string, end?: string, sourceIP?: string, sourceChain?: string) { return this.repos.ip.getIPProxyStats(backendId, ip, start, end, sourceIP, sourceChain); }
  getTopIPs(backendId: number, limit = 10, start?: string, end?: string) { return this.getIPStats(backendId, limit, start, end); }
  getTopIPsLight(backendId: number, limit = 10, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'topIPsLight',
      [backendId, limit, start || '', end || ''],
      start,
      end,
      () => normalizeIPStatsGeoIP(this.repos.ip.getTopIPsLight(backendId, limit, start, end)),
    );
  }
  updateASNInfo(ip: string, asn: string, org: string) { this.repos.ip.updateASNInfo(ip, asn, org); }
  getASNInfo(ips: string[]) { return this.repos.ip.getASNInfo(ips); }
  getASNInfoForIP(ip: string) { return this.repos.ip.getASNInfoForIP(ip); }
  getIPGeolocation(ip: string): any {
    return this.repos.ip.getIPGeolocation(ip);
  }

  getIPGeolocations(ips: string[]): Record<string, any> {
    return this.repos.ip.getIPGeolocations(ips);
  }
  saveIPGeolocation(ip: string, geo: { country: string; country_name: string; city: string; asn: string; as_name: string; as_domain: string; continent: string; continent_name: string }) { this.repos.ip.saveIPGeolocation(ip, geo); }

  // ==================== Timeseries ====================
  getHourlyStats(backendId: number, hours = 24, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'hourlyStats',
      [backendId, hours, start || '', end || ''],
      start,
      end,
      () => this.repos.timeseries.getHourlyStats(backendId, hours, start, end),
    );
  }
  getTodayTraffic(backendId: number) { return this.repos.timeseries.getTodayTraffic(backendId); }
  getTrafficInRange(backendId: number, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'trafficInRange',
      [backendId, start || '', end || ''],
      start,
      end,
      () => this.repos.timeseries.getTrafficInRange(backendId, start, end),
    );
  }
  getTrafficTrend(backendId: number, minutes?: number, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'trafficTrend',
      [backendId, minutes || 30, start || '', end || ''],
      start,
      end,
      () => this.repos.timeseries.getTrafficTrend(backendId, minutes, start, end),
    );
  }
  getTrafficTrendAggregated(backendId: number, minutes?: number, bucketMinutes?: number, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'trafficTrendAggregated',
      [backendId, minutes || 30, bucketMinutes || 1, start || '', end || ''],
      start,
      end,
      () => this.repos.timeseries.getTrafficTrendAggregated(backendId, minutes, bucketMinutes, start, end),
    );
  }

  // ==================== Country ====================
  getCountryStats(backendId: number, limit?: number, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'countryStats',
      [backendId, limit || 50, start || '', end || ''],
      start,
      end,
      () => this.repos.country.getCountryStats(backendId, limit, start, end),
    );
  }
  updateCountryStats(backendId: number, country: string, countryName: string, continent: string, upload: number, download: number, timestampMs?: number, connections?: number) { this.repos.country.updateCountryStats(backendId, country, countryName, continent, upload, download, timestampMs, connections); }
  batchUpdateCountryStats(backendId: number, results: Array<{ country: string; countryName: string; continent: string; upload: number; download: number; connections?: number; timestampMs?: number }>) { this.repos.country.batchUpdateCountryStats(backendId, results); }

  // ==================== Device ====================
  getDevices(backendId: number, limit?: number, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'deviceStats',
      [backendId, limit || 50, start || '', end || ''],
      start,
      end,
      () => this.repos.device.getDevices(backendId, limit, start, end),
    );
  }
  getDeviceDomains(backendId: number, sourceIP: string, limit?: number, start?: string, end?: string) { return this.repos.device.getDeviceDomains(backendId, sourceIP, limit, start, end); }
  getDeviceIPs(backendId: number, sourceIP: string, limit?: number, start?: string, end?: string) {
    return normalizeIPStatsGeoIP(this.repos.device.getDeviceIPs(backendId, sourceIP, limit, start, end));
  }

  // ==================== Proxy ====================
  getProxyStats(backendId: number, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'proxyStats',
      [backendId, start || '', end || ''],
      start,
      end,
      () => this.repos.proxy.getProxyStats(backendId, start, end),
    );
  }
  getProxyDomains(backendId: number, chain: string, limit?: number, start?: string, end?: string) { return this.repos.proxy.getProxyDomains(backendId, chain, limit, start, end); }
  getProxyIPs(backendId: number, chain: string, limit?: number, start?: string, end?: string) {
    return normalizeIPStatsGeoIP(this.repos.proxy.getProxyIPs(backendId, chain, limit, start, end));
  }

  // ==================== Rule ====================
  getRuleStats(backendId: number, start?: string, end?: string) {
    return this.withRangeQueryCache(
      'ruleStats',
      [backendId, start || '', end || ''],
      start,
      end,
      () => this.repos.rule.getRuleStats(backendId, start, end),
    );
  }
  getRuleProxyMap(backendId: number) { return this.repos.rule.getRuleProxyMap(backendId); }
  getRuleDomains(backendId: number, rule: string, limit?: number, start?: string, end?: string) { return this.repos.rule.getRuleDomains(backendId, rule, limit, start, end); }
  getRuleIPs(backendId: number, rule: string, limit?: number, start?: string, end?: string) {
    return normalizeIPStatsGeoIP(this.repos.rule.getRuleIPs(backendId, rule, limit, start, end));
  }
  getRuleDomainProxyStats(backendId: number, rule: string, domain: string, start?: string, end?: string) { return this.repos.rule.getRuleDomainProxyStats(backendId, rule, domain, start, end); }
  getRuleDomainIPDetails(backendId: number, rule: string, domain: string, start?: string, end?: string, limit?: number) {
    return normalizeIPStatsGeoIP(this.repos.rule.getRuleDomainIPDetails(backendId, rule, domain, start, end, limit));
  }
  getRuleIPProxyStats(backendId: number, rule: string, ip: string, start?: string, end?: string) { return this.repos.rule.getRuleIPProxyStats(backendId, rule, ip, start, end); }
  getRuleIPDomainDetails(backendId: number, rule: string, ip: string, start?: string, end?: string, limit?: number) { return this.repos.rule.getRuleIPDomainDetails(backendId, rule, ip, start, end, limit); }
  getRuleChainFlow(backendId: number, rule: string, start?: string, end?: string, realtimeRows?: Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>, proxyConfig?: Record<string, { now?: string }>) { return this.repos.rule.getRuleChainFlow(backendId, rule, start, end, realtimeRows, proxyConfig); }
  getAllRuleChainFlows(backendId: number, start?: string, end?: string, realtimeRows?: Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>, proxyConfig?: Record<string, { now?: string }>) { return this.repos.rule.getAllRuleChainFlows(backendId, start, end, realtimeRows, proxyConfig); }

  // ==================== Private helpers (kept for getSummary) ====================
  private toMinuteKey(date: Date): string {
    return `${date.toISOString().slice(0, 16)}:00`;
  }

  private parseMinuteRange(
    start?: string,
    end?: string,
  ): { startMinute: string; endMinute: string } | null {
    if (!start || !end) return null;
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) return null;
    return { startMinute: this.toMinuteKey(startDate), endMinute: this.toMinuteKey(endDate) };
  }

  private toHourKey(date: Date): string {
    return `${date.toISOString().slice(0, 13)}:00:00`;
  }

  private resolveFactTableRange(
    start?: string,
    end?: string,
  ): { table: 'hourly_dim_stats' | 'minute_dim_stats'; startKey: string; endKey: string } {
    if (!start || !end) {
      return { table: 'minute_dim_stats', startKey: '', endKey: '' };
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return { table: 'minute_dim_stats', startKey: this.toMinuteKey(startDate), endKey: this.toMinuteKey(endDate) };
    }
    if (shouldUseHourlyTables(startDate.getTime(), endDate.getTime())) {
      return { table: 'hourly_dim_stats', startKey: this.toHourKey(startDate), endKey: this.toHourKey(endDate) };
    }
    return { table: 'minute_dim_stats', startKey: this.toMinuteKey(startDate), endKey: this.toMinuteKey(endDate) };
  }

  private getRangeCacheTTL(end?: string): number {
    const realtimeTTL = Math.max(
      1_000,
      parseInt(process.env.DB_RANGE_QUERY_CACHE_TTL_MS || '8000', 10) || 8000,
    );
    const historicalTTL = Math.max(
      realtimeTTL,
      parseInt(process.env.DB_HISTORICAL_QUERY_CACHE_TTL_MS || '300000', 10) || 300000,
    );
    if (!end) return realtimeTTL;

    const endMs = new Date(end).getTime();
    if (Number.isNaN(endMs)) return realtimeTTL;

    const toleranceMs = Math.max(
      10_000,
      parseInt(process.env.REALTIME_RANGE_END_TOLERANCE_MS || '120000', 10) || 120000,
    );
    return endMs >= Date.now() - toleranceMs ? realtimeTTL : historicalTTL;
  }

  private pruneRangeQueryCache(): void {
    const maxEntries = Math.max(
      128,
      parseInt(process.env.DB_RANGE_QUERY_CACHE_MAX_ENTRIES || '1024', 10) || 1024,
    );
    const now = Date.now();

    for (const [key, entry] of this.rangeQueryCache) {
      if (entry.expiresAt <= now) {
        this.rangeQueryCache.delete(key);
      }
    }

    while (this.rangeQueryCache.size > maxEntries) {
      const oldestKey = this.rangeQueryCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.rangeQueryCache.delete(oldestKey);
    }
  }

  private withRangeQueryCache<T>(
    prefix: string,
    parts: Array<string | number>,
    start: string | undefined,
    end: string | undefined,
    compute: () => T,
  ): T {
    if (process.env.DB_RANGE_QUERY_CACHE_DISABLED === '1') {
      return compute();
    }

    if (!this.parseMinuteRange(start, end)) {
      return compute();
    }

    const key = `${prefix}:${parts.join('|')}`;
    const now = Date.now();
    const cached = this.rangeQueryCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }

    const value = compute();
    const ttl = this.getRangeCacheTTL(end);
    this.rangeQueryCache.set(key, {
      value,
      expiresAt: now + ttl,
    });
    this.pruneRangeQueryCache();
    return value;
  }

  clearRangeQueryCache(backendId?: number): void {
    if (backendId === undefined) {
      this.rangeQueryCache.clear();
      return;
    }

    const backendMarker = `:${backendId}|`;
    for (const key of this.rangeQueryCache.keys()) {
      if (key.includes(backendMarker)) {
        this.rangeQueryCache.delete(key);
      }
    }
  }

  private prepareSummaryStmts() {
    return {
      rangeCombined: this.db.prepare(`
        SELECT
          COALESCE(SUM(connections), 0) as connections,
          COALESCE(SUM(upload), 0) as upload,
          COALESCE(SUM(download), 0) as download,
          COUNT(DISTINCT CASE WHEN domain != '' THEN domain END) as uniqueDomains,
          COUNT(DISTINCT CASE WHEN ip != '' THEN ip END) as uniqueIPs
        FROM minute_dim_stats
        WHERE backend_id = ? AND minute >= ? AND minute <= ?
      `),
      rangeCombinedHourly: this.db.prepare(`
        SELECT
          COALESCE(SUM(connections), 0) as connections,
          COALESCE(SUM(upload), 0) as upload,
          COALESCE(SUM(download), 0) as download,
          COUNT(DISTINCT CASE WHEN domain != '' THEN domain END) as uniqueDomains,
          COUNT(DISTINCT CASE WHEN ip != '' THEN ip END) as uniqueIPs
        FROM hourly_dim_stats
        WHERE backend_id = ? AND hour >= ? AND hour <= ?
      `),
      allTraffic: this.db.prepare(`SELECT COALESCE(SUM(total_connections), 0) as connections, COALESCE(SUM(total_upload), 0) as upload, COALESCE(SUM(total_download), 0) as download FROM ip_stats WHERE backend_id = ?`),
      allDomains: this.db.prepare(`SELECT COUNT(DISTINCT domain) as count FROM domain_stats WHERE backend_id = ?`),
      allIPs: this.db.prepare(`SELECT COUNT(DISTINCT ip) as count FROM ip_stats WHERE backend_id = ?`),
    };
  }

  private get summaryStmts() {
    if (!this._summaryStmts) {
      this._summaryStmts = this.prepareSummaryStmts();
    }
    return this._summaryStmts;
  }

  // ==================== Summary (kept in db.ts - cross-table aggregation) ====================
  getSummary(
    backendId: number,
    start?: string,
    end?: string,
  ): { totalConnections: number; totalUpload: number; totalDownload: number; uniqueDomains: number; uniqueIPs: number } {
    return this.withRangeQueryCache(
      'summary',
      [backendId, start || '', end || ''],
      start,
      end,
      () => {
        const range = this.parseMinuteRange(start, end);
        const s = this.summaryStmts;
        if (range) {
          const resolved = this.resolveFactTableRange(start, end);
          const stmt = resolved.table === 'hourly_dim_stats' ? s.rangeCombinedHourly : s.rangeCombined;
          const { connections, upload, download, uniqueDomains, uniqueIPs } = stmt.get(
            backendId, resolved.startKey, resolved.endKey,
          ) as { connections: number; upload: number; download: number; uniqueDomains: number; uniqueIPs: number };
          return { totalConnections: connections, totalUpload: upload, totalDownload: download, uniqueDomains, uniqueIPs };
        }
        const { connections, upload, download } = s.allTraffic.get(backendId) as { connections: number; upload: number; download: number };
        const uniqueDomains = (s.allDomains.get(backendId) as { count: number }).count;
        const uniqueIPs = (s.allIPs.get(backendId) as { count: number }).count;
        return { totalConnections: connections, totalUpload: upload, totalDownload: download, uniqueDomains, uniqueIPs };
      },
    );
  }

  /**
   * @deprecated connection_logs is no longer written to (replaced by aggregation tables).
   * Kept for API backward compatibility — always returns [].
   */
  getRecentConnections(backendId: number, _limit = 100): Connection[] {
    return [];
  }

  // ==================== Delegated to repositories ====================

  // Config
  cleanupOldData(backendId: number | null, days: number) { return this.repos.config.cleanupOldData(backendId, days); }
  cleanupASNCache(days: number) { return this.repos.config.cleanupASNCache(days); }
  getDatabaseSize() { return this.repos.config.getDatabaseSize(); }
  getConnectionLogsCount(backendId: number) { return this.repos.config.getConnectionLogsCount(backendId); }
  getTotalConnectionLogsCount() { return this.repos.config.getTotalConnectionLogsCount(); }
  getRetentionConfig() { return this.repos.config.getRetentionConfig(); }
  updateRetentionConfig(updates: { connectionLogsDays?: number; hourlyStatsDays?: number; autoCleanup?: boolean }) { return this.repos.config.updateRetentionConfig(updates); }
  getGeoLookupConfig(): GeoLookupConfig { return this.repos.config.getGeoLookupConfig(); }
  updateGeoLookupConfig(updates: { provider?: GeoLookupProvider; onlineApiUrl?: string }): GeoLookupConfig {
    return this.repos.config.updateGeoLookupConfig(updates);
  }
  vacuum() { this.repos.config.vacuum(); }
  deleteOldMinuteStats(cutoff: string) { return this.repos.config.deleteOldMinuteStats(cutoff); }
  deleteOldConnectionLogs(cutoff: string) { return this.repos.config.deleteOldConnectionLogs(cutoff); }
  deleteOldHourlyStats(cutoff: string) { return this.repos.config.deleteOldHourlyStats(cutoff); }
  getCleanupStats() { return this.repos.config.getCleanupStats(); }

  // Backend
  createBackend(backend: { name: string; url: string; token?: string; type?: 'clash' | 'surge' }) { return this.repos.backend.createBackend(backend); }
  getAllBackends() { return this.repos.backend.getAllBackends(); }
  getBackend(id: number) { return this.repos.backend.getBackend(id); }
  getActiveBackend() { return this.repos.backend.getActiveBackend(); }
  getListeningBackends() { return this.repos.backend.getListeningBackends(); }
  updateBackend(id: number, updates: Partial<Omit<BackendConfig, 'id' | 'created_at'>>) { this.repos.backend.updateBackend(id, updates); }
  setActiveBackend(id: number) { this.repos.backend.setActiveBackend(id); }
  setBackendListening(id: number, listening: boolean) { this.repos.backend.setBackendListening(id, listening); }
  deleteBackend(id: number) {
    this.repos.backend.deleteBackend(id);
    this.clearRangeQueryCache(id);
  }
  deleteBackendData(id: number) {
    this.repos.backend.deleteBackendData(id);
    this.clearRangeQueryCache(id);
  }
  getGlobalSummary() { return this.repos.backend.getGlobalSummary(); }

  upsertAgentHeartbeat(input: {
    backendId: number;
    agentId: string;
    hostname?: string;
    version?: string;
    gatewayType?: string;
    gatewayUrl?: string;
    remoteIP?: string;
    gatewayLatencyMs?: number;
    serverLatencyMs?: number;
    lastSeen?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO agent_heartbeats (
        backend_id, agent_id, hostname, version, gateway_type, gateway_url, remote_ip, gateway_latency_ms, server_latency_ms, last_seen, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(backend_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        hostname = COALESCE(excluded.hostname, agent_heartbeats.hostname),
        version = COALESCE(excluded.version, agent_heartbeats.version),
        gateway_type = COALESCE(excluded.gateway_type, agent_heartbeats.gateway_type),
        gateway_url = COALESCE(excluded.gateway_url, agent_heartbeats.gateway_url),
        remote_ip = COALESCE(excluded.remote_ip, agent_heartbeats.remote_ip),
        gateway_latency_ms = COALESCE(excluded.gateway_latency_ms, agent_heartbeats.gateway_latency_ms),
        server_latency_ms = COALESCE(excluded.server_latency_ms, agent_heartbeats.server_latency_ms),
        last_seen = excluded.last_seen,
        updated_at = CURRENT_TIMESTAMP
    `);

    const lastSeen = input.lastSeen || new Date().toISOString();
    stmt.run(
      input.backendId,
      input.agentId,
      input.hostname || null,
      input.version || null,
      input.gatewayType || null,
      input.gatewayUrl || null,
      input.remoteIP || null,
      input.gatewayLatencyMs ?? null,
      input.serverLatencyMs ?? null,
      lastSeen,
    );
  }

  getAgentHeartbeat(backendId: number): AgentHeartbeat | undefined {
    const stmt = this.db.prepare(`
      SELECT
        backend_id as backendId,
        agent_id as agentId,
        hostname,
        version,
        gateway_type as gatewayType,
        gateway_url as gatewayUrl,
        remote_ip as remoteIP,
        gateway_latency_ms as gatewayLatencyMs,
        server_latency_ms as serverLatencyMs,
        last_seen as lastSeen
      FROM agent_heartbeats
      WHERE backend_id = ?
      LIMIT 1
    `);
    return stmt.get(backendId) as AgentHeartbeat | undefined;
  }

  clearAgentHeartbeat(backendId: number): void {
    const stmt = this.db.prepare('DELETE FROM agent_heartbeats WHERE backend_id = ?');
    stmt.run(backendId);
  }

  // Auth
  getAuthConfig() { return this.repos.auth.getAuthConfig(); }
  updateAuthConfig(updates: { enabled?: boolean; tokenHash?: string | null }) { this.repos.auth.updateAuthConfig(updates); }
  getOrCreateCookieSecret() { return this.repos.auth.getOrCreateCookieSecret(() => randomBytes(32).toString('hex')); }

  // Surge
  getSurgePolicyCache(backendId: number) { return this.repos.surge.getSurgePolicyCache(backendId); }
  updateSurgePolicyCache(backendId: number, policies: Array<{ policyGroup: string; selectedPolicy: string | null; policyType?: string; allPolicies?: string[] }>) { this.repos.surge.updateSurgePolicyCache(backendId, policies); }
  getSurgePolicyCacheLastUpdate(backendId: number) { return this.repos.surge.getSurgePolicyCacheLastUpdate(backendId); }
  clearSurgePolicyCache(backendId: number) { this.repos.surge.clearSurgePolicyCache(backendId); }

  // ==================== Agent Config Snapshot (persist across restarts) ====================
  saveAgentSnapshot(
    backendId: number,
    config: { rules: unknown[]; proxies: Record<string, unknown>; providers: Record<string, unknown>; timestamp: number; hash: string },
    policyState?: { proxies: Record<string, unknown>; providers: Record<string, unknown>; timestamp: number },
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO agent_snapshots (backend_id, config_json, policy_state_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(backend_id) DO UPDATE SET
        config_json = excluded.config_json,
        policy_state_json = excluded.policy_state_json,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(backendId, JSON.stringify(config), policyState ? JSON.stringify(policyState) : null);
  }

  loadAgentSnapshot(backendId: number): { config: unknown; policyState?: unknown } | undefined {
    const stmt = this.db.prepare(`
      SELECT config_json, policy_state_json
      FROM agent_snapshots
      WHERE backend_id = ?
      LIMIT 1
    `);
    const row = stmt.get(backendId) as { config_json: string; policy_state_json: string | null } | undefined;
    if (!row) return undefined;
    try {
      return {
        config: JSON.parse(row.config_json),
        policyState: row.policy_state_json ? JSON.parse(row.policy_state_json) : undefined,
      };
    } catch {
      return undefined;
    }
  }

  loadAllAgentSnapshots(): Array<{ backendId: number; config: unknown; policyState?: unknown }> {
    const stmt = this.db.prepare(`
      SELECT backend_id, config_json, policy_state_json
      FROM agent_snapshots
    `);
    const rows = stmt.all() as Array<{ backend_id: number; config_json: string; policy_state_json: string | null }>;
    const results: Array<{ backendId: number; config: unknown; policyState?: unknown }> = [];
    for (const row of rows) {
      try {
        results.push({
          backendId: row.backend_id,
          config: JSON.parse(row.config_json),
          policyState: row.policy_state_json ? JSON.parse(row.policy_state_json) : undefined,
        });
      } catch {
        // Skip invalid JSON rows
      }
    }
    return results;
  }

  deleteAgentSnapshot(backendId: number): void {
    const stmt = this.db.prepare('DELETE FROM agent_snapshots WHERE backend_id = ?');
    stmt.run(backendId);
  }

  close() {
    this.db.close();
  }
}

export type { GeoLookupConfig, GeoLookupProvider };

export default StatsDatabase;
