/**
 * Stats Service - Business logic for statistics
 */

import type { StatsDatabase } from '../db/db.js';
import type { RealtimeStore } from '../realtime/realtime.store.js';
import type {
  SummaryResponse,
  GlobalSummary,
  PaginatedDomainStats,
  PaginatedIPStats,
  TrafficTrendPoint,
  TimeRange,
  CountryStats,
  DomainStats,
  IPStats,
  ProxyStats,
  RuleStats,
  HourlyStats,
  DeviceStats,
} from './stats.types.js';
import { ClickHouseReader } from '../clickhouse/clickhouse.reader.js';

interface PaginatedStatsOptions {
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
  start?: string;
  end?: string;
}

type RoutedSource = 'clickhouse' | 'sqlite';

export class StatsService {
  private clickHouseReader: ClickHouseReader;
  private readonly strictStats = process.env.CH_STRICT_STATS === '1';
  private routeMetricsIntervalMs = Math.max(
    1000,
    Number.parseInt(process.env.STATS_ROUTE_METRICS_LOG_INTERVAL_MS || '60000', 10) || 60000,
  );
  private routeMetricsWindowStartedAt = Date.now();
  private routeMetrics: Record<string, { clickhouse: number; sqlite: number }> = {};

  constructor(
    private db: StatsDatabase,
    private realtimeStore: RealtimeStore,
  ) {
    this.clickHouseReader = new ClickHouseReader();
  }

  private shouldUseClickHouse(timeRange: TimeRange): boolean {
    return (
      timeRange.active &&
      this.clickHouseReader.shouldUseForRange(timeRange.start, timeRange.end)
    );
  }

  private shouldUseClickHouseForOptionalRange(timeRange: TimeRange): boolean {
    if (!this.clickHouseReader.shouldUse()) {
      return false;
    }
    if (!timeRange.active) {
      return true;
    }
    return this.clickHouseReader.shouldUseForRange(timeRange.start, timeRange.end);
  }

  private buildRelativeRange(windowMinutes: number): { start: string; end: string } {
    const safeWindowMinutes = Math.max(1, Math.floor(windowMinutes));
    const end = new Date();
    const start = new Date(end.getTime() - safeWindowMinutes * 60_000);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  private resolveQueryRange(
    timeRange: TimeRange,
    fallbackWindowMinutes: number,
  ): { start: string; end: string } | null {
    if (timeRange.active) {
      if (!timeRange.start || !timeRange.end) {
        return null;
      }
      return {
        start: timeRange.start,
        end: timeRange.end,
      };
    }
    return this.buildRelativeRange(fallbackWindowMinutes);
  }

  private isStrictStatsEnabled(): boolean {
    return this.strictStats && this.clickHouseReader.shouldUse();
  }

  private failIfStrictFallback(route: string): void {
    if (!this.isStrictStatsEnabled()) {
      return;
    }
    throw new Error(
      `[StatsService] SQLite fallback is disabled by CH_STRICT_STATS=1 (route=${route})`,
    );
  }

  private recordRoute(route: string, source: RoutedSource): void {
    if (this.isStrictStatsEnabled() && source === 'sqlite') {
      throw new Error(
        `[StatsService] SQLite fallback is disabled by CH_STRICT_STATS=1 (route=${route})`,
      );
    }

    const existing = this.routeMetrics[route] || { clickhouse: 0, sqlite: 0 };
    existing[source] += 1;
    this.routeMetrics[route] = existing;
    this.maybeLogRouteMetrics();
  }

  private maybeLogRouteMetrics(): void {
    if (this.routeMetricsIntervalMs <= 0) return;
    const now = Date.now();
    const elapsedMs = now - this.routeMetricsWindowStartedAt;
    if (elapsedMs < this.routeMetricsIntervalMs) return;

    const entries = Object.entries(this.routeMetrics);
    if (entries.length > 0) {
      const parts = entries
        .map(([name, counts]) => {
          const total = counts.clickhouse + counts.sqlite;
          const chRate = total > 0 ? (counts.clickhouse / total) * 100 : 0;
          return `${name}=ch:${counts.clickhouse},sqlite:${counts.sqlite},ch_rate:${chRate.toFixed(1)}%`;
        })
        .join(' | ');
      console.info(
        `[StatsService] Route metrics: ${parts} window_sec=${(elapsedMs / 1000).toFixed(1)}`,
      );
    }

    this.routeMetricsWindowStartedAt = now;
    this.routeMetrics = {};
  }

  private populateGeoIPs(_backendId: number, ipStats: IPStats[]): IPStats[] {
    if (!ipStats || ipStats.length === 0) return ipStats;

    const ipsToLookup = Array.from(new Set(ipStats.map(s => s.ip).filter(Boolean)));
    if (ipsToLookup.length === 0) return ipStats;

    const cachedGeos = this.db.getIPGeolocations(ipsToLookup);

    const geoMap = new Map<string, IPStats['geoIP']>();
    const asnMap = new Map<string, string>();

    for (const ip of ipsToLookup) {
      const cached = cachedGeos[ip];
      if (!cached) continue;

      const countryCode = typeof cached.country === 'string' ? cached.country : '';
      const countryName =
        typeof cached.country_name === 'string' ? cached.country_name : countryCode;
      const city = typeof cached.city === 'string' ? cached.city : '';
      const asOrganization = typeof cached.as_name === 'string' ? cached.as_name : '';
      const asn = typeof cached.asn === 'string' ? cached.asn : '';

      if (countryCode || countryName || city || asOrganization) {
        geoMap.set(ip, {
          countryCode,
          countryName,
          city,
          asOrganization,
        });
      }
      if (asn) {
        asnMap.set(ip, asn);
      }
    }

    return ipStats.map((stat) => ({
      ...stat,
      geoIP: stat.ip ? (geoMap.get(stat.ip) || stat.geoIP) : stat.geoIP,
      asn: stat.ip ? (asnMap.get(stat.ip) || stat.asn) : stat.asn,
    }));
  }

  /**
   * Resolve backend ID from query param or active backend fallback
   */
  resolveBackendId(rawBackendId?: string): number | null {
    if (rawBackendId) {
      const id = Number.parseInt(rawBackendId, 10);
      return Number.isNaN(id) ? null : id;
    }
    return this.db.getActiveBackend()?.id ?? null;
  }

  /**
   * Parse limit parameter with fallback and max
   */
  parseLimit(raw: string | undefined, fallback: number, max: number): number {
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.min(parsed, max);
  }

  /**
   * Check if realtime data should be included
   */
  shouldIncludeRealtime(timeRange: TimeRange): boolean {
    if (!timeRange.active) {
      return true;
    }
    if (!timeRange.end) {
      return false;
    }

    const endMs = new Date(timeRange.end).getTime();
    if (Number.isNaN(endMs)) {
      return false;
    }

    // For "latest window" queries (end close to now), keep merging in-memory deltas
    // so dashboard updates stay near real-time between DB flushes.
    const toleranceMs = parseInt(
      process.env.REALTIME_RANGE_END_TOLERANCE_MS || '120000',
      10,
    );
    const windowMs = Number.isFinite(toleranceMs)
      ? Math.max(10_000, toleranceMs)
      : 120_000;
    return endMs >= Date.now() - windowMs;
  }

  /**
   * Get summary statistics for a specific backend
   */
  getSummary(backendId: number, timeRange: TimeRange): SummaryResponse {
    const includeRealtime = this.shouldIncludeRealtime(timeRange);
    
    const backend = this.db.getBackend(backendId);
    if (!backend) {
      throw new Error('Backend not found');
    }

    const summary = this.db.getSummary(backendId, timeRange.start, timeRange.end);
    const summaryWithRealtime = includeRealtime
      ? this.realtimeStore.applySummaryDelta(backendId, summary)
      : summary;

    const dbTopDomains = this.db.getTopDomainsLight(backendId, 10, timeRange.start, timeRange.end);
    const topDomains = includeRealtime
      ? this.realtimeStore.mergeTopDomains(backendId, dbTopDomains, 10)
      : dbTopDomains;

    const dbTopIPs = this.db.getTopIPsLight(backendId, 10, timeRange.start, timeRange.end);
    const topIPs = includeRealtime
      ? this.realtimeStore.mergeTopIPs(backendId, dbTopIPs, 10)
      : dbTopIPs;

    const dbProxyStats = this.db.getProxyStats(backendId, timeRange.start, timeRange.end);
    const proxyStats = includeRealtime
      ? this.realtimeStore.mergeProxyStats(backendId, dbProxyStats)
      : dbProxyStats;

    const dbRuleStats = this.db.getRuleStats(backendId, timeRange.start, timeRange.end);
    const ruleStats = includeRealtime
      ? this.realtimeStore.mergeRuleStats(backendId, dbRuleStats)
      : dbRuleStats;

    const hourlyStats = this.db.getHourlyStats(backendId, 24, timeRange.start, timeRange.end);
    const todayTraffic = this.db.getTrafficInRange(backendId, timeRange.start, timeRange.end);
    const todayDelta = includeRealtime
      ? this.realtimeStore.getTodayDelta(backendId)
      : { upload: 0, download: 0 };

    return {
      backend: {
        id: backend.id,
        name: backend.name,
        isActive: backend.is_active,
        listening: backend.listening,
      },
      totalConnections: summaryWithRealtime.totalConnections,
      totalUpload: summaryWithRealtime.totalUpload,
      totalDownload: summaryWithRealtime.totalDownload,
      totalDomains: summary.uniqueDomains,
      totalIPs: summary.uniqueIPs,
      totalRules: ruleStats.length,
      totalProxies: proxyStats.length,
      todayUpload: todayTraffic.upload + todayDelta.upload,
      todayDownload: todayTraffic.download + todayDelta.download,
      topDomains,
      topIPs,
      proxyStats,
      ruleStats,
      hourlyStats,
    };
  }

  async getSummaryWithRouting(
    backendId: number,
    timeRange: TimeRange,
  ): Promise<SummaryResponse> {
    const backend = this.db.getBackend(backendId);
    if (!backend) {
      throw new Error('Backend not found');
    }

    const includeRealtime = this.shouldIncludeRealtime(timeRange);
    const shouldUseCH =
      timeRange.active &&
      this.clickHouseReader.shouldUseForRange(timeRange.start, timeRange.end);

    if (!shouldUseCH || !timeRange.start || !timeRange.end) {
      this.failIfStrictFallback('summary');
      this.recordRoute('summary', 'sqlite');
      return this.getSummary(backendId, timeRange);
    }

    const [
      summaryCH,
      topDomainsCH,
      topIPsCH,
      proxyStatsCH,
      ruleStatsCH,
      hourlyStatsCH,
      trafficInRangeCH,
    ] =
      await Promise.all([
        this.clickHouseReader.getSummary(backendId, timeRange.start, timeRange.end),
        this.clickHouseReader.getTopDomainsLight(
          backendId,
          10,
          timeRange.start,
          timeRange.end,
        ),
        this.clickHouseReader.getTopIPsLight(
          backendId,
          10,
          timeRange.start,
          timeRange.end,
        ),
        this.clickHouseReader.getProxyStats(backendId, timeRange.start, timeRange.end),
        this.clickHouseReader.getRuleStats(backendId, timeRange.start, timeRange.end),
        this.clickHouseReader.getHourlyStats(
          backendId,
          24,
          timeRange.start,
          timeRange.end,
        ),
        this.clickHouseReader.getTrafficInRange(
          backendId,
          timeRange.start,
          timeRange.end,
        ),
      ]);

    const allCHReady =
      !!summaryCH &&
      !!topDomainsCH &&
      !!topIPsCH &&
      !!proxyStatsCH &&
      !!ruleStatsCH &&
      !!hourlyStatsCH &&
      !!trafficInRangeCH;
    if (!allCHReady) {
      const hasAnyCH =
        !!summaryCH ||
        !!topDomainsCH ||
        !!topIPsCH ||
        !!proxyStatsCH ||
        !!ruleStatsCH ||
        !!hourlyStatsCH ||
        !!trafficInRangeCH;
      if (hasAnyCH) {
        console.warn(
          '[StatsService] Partial ClickHouse summary data detected, falling back to SQLite for consistency',
        );
      }
      this.failIfStrictFallback('summary');
      this.recordRoute('summary', 'sqlite');
      return this.getSummary(backendId, timeRange);
    }

    const summary = summaryCH;
    const summaryWithRealtime = includeRealtime
      ? this.realtimeStore.applySummaryDelta(backendId, summary)
      : summary;

    const topDomains = includeRealtime
      ? this.realtimeStore.mergeTopDomains(backendId, topDomainsCH, 10)
      : topDomainsCH;

    const populatedTopIPsCH = this.populateGeoIPs(backendId, topIPsCH);
    const topIPs = includeRealtime
      ? this.realtimeStore.mergeTopIPs(backendId, populatedTopIPsCH, 10)
      : populatedTopIPsCH;

    const proxyStats = includeRealtime
      ? this.realtimeStore.mergeProxyStats(backendId, proxyStatsCH)
      : proxyStatsCH;

    const ruleStats = includeRealtime
      ? this.realtimeStore.mergeRuleStats(backendId, ruleStatsCH)
      : ruleStatsCH;

    const hourlyStats = hourlyStatsCH;
    const todayTraffic = trafficInRangeCH;
    const todayDelta = includeRealtime
      ? this.realtimeStore.getTodayDelta(backendId)
      : { upload: 0, download: 0 };
    this.recordRoute('summary', 'clickhouse');

    return {
      backend: {
        id: backend.id,
        name: backend.name,
        isActive: backend.is_active,
        listening: backend.listening,
      },
      totalConnections: summaryWithRealtime.totalConnections,
      totalUpload: summaryWithRealtime.totalUpload,
      totalDownload: summaryWithRealtime.totalDownload,
      totalDomains: summary.uniqueDomains,
      totalIPs: summary.uniqueIPs,
      totalRules: ruleStats.length,
      totalProxies: proxyStats.length,
      todayUpload: todayTraffic.upload + todayDelta.upload,
      todayDownload: todayTraffic.download + todayDelta.download,
      topDomains,
      topIPs,
      proxyStats,
      ruleStats,
      hourlyStats,
    };
  }

  /**
   * Get global summary across all backends
   */
  getGlobalSummary(): GlobalSummary {
    return this.db.getGlobalSummary();
  }

  async getGlobalSummaryWithRouting(): Promise<GlobalSummary> {
    if (this.clickHouseReader.shouldUse()) {
      const backendCount = this.db.getAllBackends().length;
      const ch = await this.clickHouseReader.getGlobalSummary(backendCount);
      if (ch) {
        this.recordRoute('global', 'clickhouse');
        return ch;
      }
    }

    this.failIfStrictFallback('global');
    this.recordRoute('global', 'sqlite');
    return this.db.getGlobalSummary();
  }

  /**
   * Get domain statistics for a specific backend (paginated)
   */
  getDomainStatsPaginated(backendId: number, timeRange: TimeRange, options: PaginatedStatsOptions): PaginatedDomainStats {
    const stats = this.db.getDomainStatsPaginated(backendId, {
      offset: options.offset,
      limit: options.limit,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
      search: options.search,
      start: timeRange.start,
      end: timeRange.end,
    });

    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeDomainStatsPaginated(backendId, stats, {
        offset: options.offset,
        limit: options.limit,
        sortBy: options.sortBy,
        sortOrder: options.sortOrder,
        search: options.search,
      });
    }
    return stats;
  }

  async getDomainStatsPaginatedWithRouting(
    backendId: number,
    timeRange: TimeRange,
    options: PaginatedStatsOptions,
  ): Promise<PaginatedDomainStats> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    const stats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getDomainStatsPaginated(
            backendId,
            timeRange.start,
            timeRange.end,
            options,
          )
        : null;

    const resolvedStats =
      stats ||
      this.db.getDomainStatsPaginated(backendId, {
        offset: options.offset,
        limit: options.limit,
        sortBy: options.sortBy,
        sortOrder: options.sortOrder,
        search: options.search,
        start: timeRange.start,
        end: timeRange.end,
      });
    this.recordRoute('domains', stats ? 'clickhouse' : 'sqlite');

    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeDomainStatsPaginated(backendId, resolvedStats, {
        offset: options.offset,
        limit: options.limit,
        sortBy: options.sortBy,
        sortOrder: options.sortOrder,
        search: options.search,
      });
    }
    return resolvedStats;
  }

  /**
   * Get IP statistics for a specific backend (paginated)
   */
  getIPStatsPaginated(backendId: number, timeRange: TimeRange, options: PaginatedStatsOptions): PaginatedIPStats {
    const stats = this.db.getIPStatsPaginated(backendId, {
      offset: options.offset,
      limit: options.limit,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
      search: options.search,
      start: timeRange.start,
      end: timeRange.end,
    });

    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeIPStatsPaginated(backendId, stats, {
        offset: options.offset,
        limit: options.limit,
        sortBy: options.sortBy,
        sortOrder: options.sortOrder,
        search: options.search,
      });
    }
    return stats;
  }

  async getIPStatsPaginatedWithRouting(
    backendId: number,
    timeRange: TimeRange,
    options: PaginatedStatsOptions,
  ): Promise<PaginatedIPStats> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    const stats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getIPStatsPaginated(
            backendId,
            timeRange.start,
            timeRange.end,
            options,
          )
        : null;

    if (stats) {
      stats.data = this.populateGeoIPs(backendId, stats.data);
    }

    const resolvedStats =
      stats ||
      this.db.getIPStatsPaginated(backendId, {
        offset: options.offset,
        limit: options.limit,
        sortBy: options.sortBy,
        sortOrder: options.sortOrder,
        search: options.search,
        start: timeRange.start,
        end: timeRange.end,
      });
    this.recordRoute('ips', stats ? 'clickhouse' : 'sqlite');

    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeIPStatsPaginated(backendId, resolvedStats, {
        offset: options.offset,
        limit: options.limit,
        sortBy: options.sortBy,
        sortOrder: options.sortOrder,
        search: options.search,
      });
    }
    return resolvedStats;
  }

  /**
   * Get per-proxy traffic breakdown for a specific domain
   */
  getDomainProxyStats(
    backendId: number,
    domain: string,
    timeRange: TimeRange,
    sourceIP?: string,
    sourceChain?: string,
  ): any[] {
    return this.db.getDomainProxyStats(backendId, domain, timeRange.start, timeRange.end, sourceIP, sourceChain);
  }

  async getDomainProxyStatsWithRouting(
    backendId: number,
    domain: string,
    timeRange: TimeRange,
    sourceIP?: string,
    sourceChain?: string,
  ): Promise<any[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    if (shouldUseCH && timeRange.start && timeRange.end) {
      const ch = await this.clickHouseReader.getGroupedProxyStats(
        backendId,
        timeRange.start,
        timeRange.end,
        { domain, sourceIP, sourceChain },
      );
      if (ch) {
        this.recordRoute('domains.proxy-stats', 'clickhouse');
        return ch;
      }
    }
    this.recordRoute('domains.proxy-stats', 'sqlite');
    return this.db.getDomainProxyStats(
      backendId,
      domain,
      timeRange.start,
      timeRange.end,
      sourceIP,
      sourceChain,
    );
  }

  /**
   * Get IP details for a specific domain
   */
  getDomainIPDetails(
    backendId: number,
    domain: string,
    timeRange: TimeRange,
    limit: number,
    sourceIP?: string,
    sourceChain?: string,
  ): IPStats[] {
    return this.db.getDomainIPDetails(backendId, domain, timeRange.start, timeRange.end, limit, sourceIP, sourceChain);
  }

  async getDomainIPDetailsWithRouting(
    backendId: number,
    domain: string,
    timeRange: TimeRange,
    limit: number,
    sourceIP?: string,
    sourceChain?: string,
  ): Promise<IPStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    if (shouldUseCH && timeRange.start && timeRange.end) {
      const ch = await this.clickHouseReader.getGroupedIPs(
        backendId,
        timeRange.start,
        timeRange.end,
        limit,
        { domain, sourceIP, sourceChain },
      );
      if (ch) {
        this.recordRoute('domains.ip-details', 'clickhouse');
        return this.populateGeoIPs(backendId, ch);
      }
    }
    this.recordRoute('domains.ip-details', 'sqlite');
    return this.db.getDomainIPDetails(
      backendId,
      domain,
      timeRange.start,
      timeRange.end,
      limit,
      sourceIP,
      sourceChain,
    );
  }

  /**
   * Get per-proxy traffic breakdown for a specific IP
   */
  getIPProxyStats(
    backendId: number,
    ip: string,
    timeRange: TimeRange,
    sourceIP?: string,
    sourceChain?: string,
  ): any[] {
    return this.db.getIPProxyStats(backendId, ip, timeRange.start, timeRange.end, sourceIP, sourceChain);
  }

  async getIPProxyStatsWithRouting(
    backendId: number,
    ip: string,
    timeRange: TimeRange,
    sourceIP?: string,
    sourceChain?: string,
  ): Promise<any[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    if (shouldUseCH && timeRange.start && timeRange.end) {
      const ch = await this.clickHouseReader.getGroupedProxyStats(
        backendId,
        timeRange.start,
        timeRange.end,
        { ip, sourceIP, sourceChain },
      );
      if (ch) {
        this.recordRoute('ips.proxy-stats', 'clickhouse');
        return ch;
      }
    }
    this.recordRoute('ips.proxy-stats', 'sqlite');
    return this.db.getIPProxyStats(
      backendId,
      ip,
      timeRange.start,
      timeRange.end,
      sourceIP,
      sourceChain,
    );
  }

  /**
   * Get domain details for a specific IP
   */
  getIPDomainDetails(
    backendId: number,
    ip: string,
    timeRange: TimeRange,
    limit: number,
    sourceIP?: string,
    sourceChain?: string,
  ): DomainStats[] {
    return this.db.getIPDomainDetails(backendId, ip, timeRange.start, timeRange.end, limit, sourceIP, sourceChain);
  }

  async getIPDomainDetailsWithRouting(
    backendId: number,
    ip: string,
    timeRange: TimeRange,
    limit: number,
    sourceIP?: string,
    sourceChain?: string,
  ): Promise<DomainStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    if (shouldUseCH && timeRange.start && timeRange.end) {
      const ch = await this.clickHouseReader.getGroupedDomains(
        backendId,
        timeRange.start,
        timeRange.end,
        limit,
        { ip, sourceIP, sourceChain },
      );
      if (ch) {
        this.recordRoute('ips.domain-details', 'clickhouse');
        return ch;
      }
    }
    this.recordRoute('ips.domain-details', 'sqlite');
    return this.db.getIPDomainDetails(
      backendId,
      ip,
      timeRange.start,
      timeRange.end,
      limit,
      sourceIP,
      sourceChain,
    );
  }

  /**
   * Get domains for a specific proxy/chain
   */
  getProxyDomains(backendId: number, chain: string, timeRange: TimeRange, limit: number): DomainStats[] {
    const stats = this.db.getProxyDomains(backendId, chain, limit, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeProxyDomains(backendId, chain, stats, limit);
    }
    return stats;
  }

  async getProxyDomainsWithRouting(
    backendId: number,
    chain: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<DomainStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    const stats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getGroupedDomains(
            backendId,
            timeRange.start,
            timeRange.end,
            limit,
            { chain },
          )
        : null;
    const resolvedStats =
      stats || this.db.getProxyDomains(backendId, chain, limit, timeRange.start, timeRange.end);
    this.recordRoute('proxies.domains', stats ? 'clickhouse' : 'sqlite');
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeProxyDomains(backendId, chain, resolvedStats, limit);
    }
    return resolvedStats;
  }

  /**
   * Get IPs for a specific proxy/chain
   */
  getProxyIPs(backendId: number, chain: string, timeRange: TimeRange, limit: number): IPStats[] {
    const stats = this.db.getProxyIPs(backendId, chain, limit, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeProxyIPs(backendId, chain, stats, limit);
    }
    return stats;
  }

  async getProxyIPsWithRouting(
    backendId: number,
    chain: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<IPStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    let stats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getGroupedIPs(
            backendId,
            timeRange.start,
            timeRange.end,
            limit,
            { chain },
          )
        : null;
    if (stats) {
      stats = this.populateGeoIPs(backendId, stats);
    }
    const resolvedStats =
      stats || this.db.getProxyIPs(backendId, chain, limit, timeRange.start, timeRange.end);
    this.recordRoute('proxies.ips', stats ? 'clickhouse' : 'sqlite');
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeProxyIPs(backendId, chain, resolvedStats, limit);
    }
    return resolvedStats;
  }

  /**
   * Get proxy/chain statistics for a specific backend
   */
  getProxyStats(backendId: number, timeRange: TimeRange): ProxyStats[] {
    const stats = this.db.getProxyStats(backendId, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeProxyStats(backendId, stats);
    }
    return stats;
  }

  async getProxyStatsWithRouting(
    backendId: number,
    timeRange: TimeRange,
  ): Promise<ProxyStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    const stats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getProxyStats(
            backendId,
            timeRange.start,
            timeRange.end,
          )
        : null;
    const resolvedStats =
      (stats as ProxyStats[] | null) ||
      this.db.getProxyStats(backendId, timeRange.start, timeRange.end);
    this.recordRoute('proxies', stats ? 'clickhouse' : 'sqlite');
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeProxyStats(backendId, resolvedStats);
    }
    return resolvedStats;
  }

  /**
   * Get rule statistics for a specific backend
   */
  getRuleStats(backendId: number, timeRange: TimeRange): RuleStats[] {
    const stats = this.db.getRuleStats(backendId, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeRuleStats(backendId, stats);
    }
    return stats;
  }

  async getRuleStatsWithRouting(
    backendId: number,
    timeRange: TimeRange,
  ): Promise<RuleStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    const stats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getRuleStats(
            backendId,
            timeRange.start,
            timeRange.end,
          )
        : null;
    const resolvedStats =
      (stats as RuleStats[] | null) ||
      this.db.getRuleStats(backendId, timeRange.start, timeRange.end);
    this.recordRoute('rules', stats ? 'clickhouse' : 'sqlite');
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeRuleStats(backendId, resolvedStats);
    }
    return resolvedStats;
  }

  /**
   * Get domains for a specific rule
   */
  getRuleDomains(backendId: number, rule: string, timeRange: TimeRange, limit: number): DomainStats[] {
    const stats = this.db.getRuleDomains(backendId, rule, limit, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeRuleDomains(backendId, rule, stats, limit);
    }
    return stats;
  }

  async getRuleDomainsWithRouting(
    backendId: number,
    rule: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<DomainStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    const stats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getGroupedDomains(
            backendId,
            timeRange.start,
            timeRange.end,
            limit,
            { rule },
          )
        : null;
    const resolvedStats =
      stats || this.db.getRuleDomains(backendId, rule, limit, timeRange.start, timeRange.end);
    this.recordRoute('rules.domains', stats ? 'clickhouse' : 'sqlite');
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeRuleDomains(backendId, rule, resolvedStats, limit);
    }
    return resolvedStats;
  }

  /**
   * Get IPs for a specific rule
   */
  getRuleIPs(backendId: number, rule: string, timeRange: TimeRange, limit: number): IPStats[] {
    const stats = this.db.getRuleIPs(backendId, rule, limit, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeRuleIPs(backendId, rule, stats, limit);
    }
    return stats;
  }

  async getRuleIPsWithRouting(
    backendId: number,
    rule: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<IPStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    const chStats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getGroupedIPs(
            backendId,
            timeRange.start,
            timeRange.end,
            limit,
            { rule },
          )
        : null;
    const stats = chStats ? this.populateGeoIPs(backendId, chStats) : null;
    const resolvedStats =
      stats || this.db.getRuleIPs(backendId, rule, limit, timeRange.start, timeRange.end);
    this.recordRoute('rules.ips', stats ? 'clickhouse' : 'sqlite');
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeRuleIPs(backendId, rule, resolvedStats, limit);
    }
    return resolvedStats;
  }

  /**
   * Get per-proxy traffic breakdown for a specific domain under a specific rule
   */
  getRuleDomainProxyStats(backendId: number, rule: string, domain: string, timeRange: TimeRange): any[] {
    return this.db.getRuleDomainProxyStats(backendId, rule, domain, timeRange.start, timeRange.end);
  }

  async getRuleDomainProxyStatsWithRouting(
    backendId: number,
    rule: string,
    domain: string,
    timeRange: TimeRange,
  ): Promise<any[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    if (shouldUseCH && timeRange.start && timeRange.end) {
      const ch = await this.clickHouseReader.getGroupedProxyStats(
        backendId,
        timeRange.start,
        timeRange.end,
        { rule, domain },
      );
      if (ch) {
        this.recordRoute('rules.domains.proxy-stats', 'clickhouse');
        return ch;
      }
    }
    this.recordRoute('rules.domains.proxy-stats', 'sqlite');
    return this.db.getRuleDomainProxyStats(backendId, rule, domain, timeRange.start, timeRange.end);
  }

  /**
   * Get IP details for a specific domain under a specific rule
   */
  getRuleDomainIPDetails(backendId: number, rule: string, domain: string, timeRange: TimeRange, limit: number): IPStats[] {
    return this.db.getRuleDomainIPDetails(backendId, rule, domain, timeRange.start, timeRange.end, limit);
  }

  async getRuleDomainIPDetailsWithRouting(
    backendId: number,
    rule: string,
    domain: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<IPStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    if (shouldUseCH && timeRange.start && timeRange.end) {
      const ch = await this.clickHouseReader.getGroupedIPs(
        backendId,
        timeRange.start,
        timeRange.end,
        limit,
        { rule, domain },
      );
      if (ch) {
        this.recordRoute('rules.domains.ip-details', 'clickhouse');
        return this.populateGeoIPs(backendId, ch);
      }
    }
    this.recordRoute('rules.domains.ip-details', 'sqlite');
    return this.db.getRuleDomainIPDetails(backendId, rule, domain, timeRange.start, timeRange.end, limit);
  }

  /**
   * Get per-proxy traffic breakdown for a specific IP under a specific rule
   */
  getRuleIPProxyStats(backendId: number, rule: string, ip: string, timeRange: TimeRange): any[] {
    return this.db.getRuleIPProxyStats(backendId, rule, ip, timeRange.start, timeRange.end);
  }

  async getRuleIPProxyStatsWithRouting(
    backendId: number,
    rule: string,
    ip: string,
    timeRange: TimeRange,
  ): Promise<any[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    if (shouldUseCH && timeRange.start && timeRange.end) {
      const ch = await this.clickHouseReader.getGroupedProxyStats(
        backendId,
        timeRange.start,
        timeRange.end,
        { rule, ip },
      );
      if (ch) {
        this.recordRoute('rules.ips.proxy-stats', 'clickhouse');
        return ch;
      }
    }
    this.recordRoute('rules.ips.proxy-stats', 'sqlite');
    return this.db.getRuleIPProxyStats(backendId, rule, ip, timeRange.start, timeRange.end);
  }

  /**
   * Get domain details for a specific IP under a specific rule
   */
  getRuleIPDomainDetails(backendId: number, rule: string, ip: string, timeRange: TimeRange, limit: number): DomainStats[] {
    return this.db.getRuleIPDomainDetails(backendId, rule, ip, timeRange.start, timeRange.end, limit);
  }

  async getRuleIPDomainDetailsWithRouting(
    backendId: number,
    rule: string,
    ip: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<DomainStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    if (shouldUseCH && timeRange.start && timeRange.end) {
      const ch = await this.clickHouseReader.getGroupedDomains(
        backendId,
        timeRange.start,
        timeRange.end,
        limit,
        { rule, ip },
      );
      if (ch) {
        this.recordRoute('rules.ips.domain-details', 'clickhouse');
        return ch;
      }
    }
    this.recordRoute('rules.ips.domain-details', 'sqlite');
    return this.db.getRuleIPDomainDetails(backendId, rule, ip, timeRange.start, timeRange.end, limit);
  }

  /**
   * Get rule chain flow for a specific rule
   */
  getRuleChainFlow(backendId: number, rule: string, timeRange: TimeRange): any {
    const realtimeRows = this.shouldIncludeRealtime(timeRange) ? this.realtimeStore.getRuleChainRows(backendId) : undefined;
    // Get proxy config for Agent mode to enrich short chains
    const agentConfig = this.realtimeStore.getAgentConfig(backendId);
    const proxyConfig = agentConfig?.proxies;
    // Rule chain flow request logging removed
    return this.db.getRuleChainFlow(backendId, rule, timeRange.start, timeRange.end, realtimeRows, proxyConfig);
  }

  async getRuleChainFlowWithRouting(
    backendId: number,
    rule: string,
    timeRange: TimeRange,
  ): Promise<any> {
    const shouldUseCH = this.shouldUseClickHouseForOptionalRange(timeRange);
    const realtimeRows = this.shouldIncludeRealtime(timeRange) ? this.realtimeStore.getRuleChainRows(backendId) : undefined;
    // Get proxy config for Agent mode to enrich short chains
    const agentConfig = this.realtimeStore.getAgentConfig(backendId);
    const proxyConfig = agentConfig?.proxies;
    
    if (shouldUseCH) {
      const ch = await this.clickHouseReader.getRuleChainFlow(
        backendId,
        rule,
        timeRange.start,
        timeRange.end,
        realtimeRows,
      );
      if (ch) {
        this.recordRoute('rules.chain-flow', 'clickhouse');
        return ch;
      }
    }

    this.failIfStrictFallback('rules.chain-flow');
    this.recordRoute('rules.chain-flow', 'sqlite');
    return this.db.getRuleChainFlow(backendId, rule, timeRange.start, timeRange.end, realtimeRows, proxyConfig);
  }

  /**
   * Get all rule chain flows merged into unified DAG
   */
  getAllRuleChainFlows(backendId: number, timeRange: TimeRange): any {
    const realtimeRows = this.shouldIncludeRealtime(timeRange) ? this.realtimeStore.getRuleChainRows(backendId) : undefined;
    // Get proxy config for Agent mode to enrich short chains
    const agentConfig = this.realtimeStore.getAgentConfig(backendId);
    const proxyConfig = agentConfig?.proxies;
    // All rule chain flows request logging removed
    return this.db.getAllRuleChainFlows(backendId, timeRange.start, timeRange.end, realtimeRows, proxyConfig);
  }

  async getAllRuleChainFlowsWithRouting(
    backendId: number,
    timeRange: TimeRange,
  ): Promise<any> {
    const shouldUseCH = this.shouldUseClickHouseForOptionalRange(timeRange);
    const realtimeRows = this.shouldIncludeRealtime(timeRange) ? this.realtimeStore.getRuleChainRows(backendId) : undefined;
    // Get proxy config for Agent mode to enrich short chains
    const agentConfig = this.realtimeStore.getAgentConfig(backendId);
    const proxyConfig = agentConfig?.proxies;
    
    if (shouldUseCH) {
      const ch = await this.clickHouseReader.getAllRuleChainFlows(
        backendId,
        timeRange.start,
        timeRange.end,
        realtimeRows,
      );
      if (ch) {
        this.recordRoute('rules.chain-flow-all', 'clickhouse');
        return ch;
      }
    }

    this.failIfStrictFallback('rules.chain-flow-all');
    this.recordRoute('rules.chain-flow-all', 'sqlite');
    return this.db.getAllRuleChainFlows(backendId, timeRange.start, timeRange.end, realtimeRows, proxyConfig);
  }

  /**
   * Get rule to proxy mapping for a specific backend
   */
  getRuleProxyMap(backendId: number): any {
    return this.db.getRuleProxyMap(backendId);
  }

  async getRuleProxyMapWithRouting(backendId: number): Promise<any> {
    if (this.clickHouseReader.shouldUse()) {
      const ch = await this.clickHouseReader.getRuleProxyMap(backendId);
      if (ch) {
        this.recordRoute('rule-proxy-map', 'clickhouse');
        return ch;
      }
    }

    this.failIfStrictFallback('rule-proxy-map');
    this.recordRoute('rule-proxy-map', 'sqlite');
    return this.db.getRuleProxyMap(backendId);
  }

  /**
   * Get country traffic statistics for a specific backend
   */
  getCountryStats(backendId: number, timeRange: TimeRange, limit: number): CountryStats[] {
    const stats = this.db.getCountryStats(backendId, limit, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeCountryStats(backendId, stats);
    }
    return stats;
  }

  async getCountryStatsWithRouting(
    backendId: number,
    timeRange: TimeRange,
    limit: number,
  ): Promise<CountryStats[]> {
    const queryRange = this.resolveQueryRange(timeRange, 24 * 60);
    const shouldUseCH =
      !!queryRange &&
      this.clickHouseReader.shouldUseForRange(queryRange.start, queryRange.end);

    if (shouldUseCH && queryRange) {
      const chStats = await this.clickHouseReader.getCountryStats(
        backendId,
        limit,
        queryRange.start,
        queryRange.end,
      );
      if (chStats) {
        this.recordRoute('countries', 'clickhouse');
        if (this.shouldIncludeRealtime(timeRange)) {
          return this.realtimeStore.mergeCountryStats(backendId, chStats);
        }
        return chStats;
      }
    }

    this.failIfStrictFallback('countries');
    this.recordRoute('countries', 'sqlite');
    const resolvedStats = this.db.getCountryStats(backendId, limit, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeCountryStats(backendId, resolvedStats);
    }
    return resolvedStats;
  }

  /**
   * Get device statistics for a specific backend
   */
  getDeviceStats(backendId: number, timeRange: TimeRange, limit: number): DeviceStats[] {
    const stats = this.db.getDevices(backendId, limit, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeDeviceStats(backendId, stats, limit);
    }
    return stats;
  }

  async getDeviceStatsWithRouting(
    backendId: number,
    timeRange: TimeRange,
    limit: number,
  ): Promise<DeviceStats[]> {
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    const stats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getDeviceStats(
            backendId,
            timeRange.start,
            timeRange.end,
            limit,
          )
        : null;
    const resolvedStats =
      (stats as DeviceStats[] | null) ||
      this.db.getDevices(backendId, limit, timeRange.start, timeRange.end);
    this.recordRoute('devices', stats ? 'clickhouse' : 'sqlite');
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeDeviceStats(backendId, resolvedStats, limit);
    }
    return resolvedStats;
  }

  /**
   * Get domains for a specific device
   */
  getDeviceDomains(backendId: number, sourceIP: string, timeRange: TimeRange, limit: number): DomainStats[] {
    if (!sourceIP) return [];
    const stats = this.db.getDeviceDomains(backendId, sourceIP, limit, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeDeviceDomains(backendId, sourceIP, stats, limit);
    }
    return stats;
  }

  async getDeviceDomainsWithRouting(
    backendId: number,
    sourceIP: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<DomainStats[]> {
    if (!sourceIP) return [];
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    const stats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getGroupedDomains(
            backendId,
            timeRange.start,
            timeRange.end,
            limit,
            { sourceIP },
          )
        : null;
    const resolvedStats =
      stats || this.db.getDeviceDomains(backendId, sourceIP, limit, timeRange.start, timeRange.end);
    this.recordRoute('devices.domains', stats ? 'clickhouse' : 'sqlite');
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeDeviceDomains(backendId, sourceIP, resolvedStats, limit);
    }
    return resolvedStats;
  }

  /**
   * Get IPs for a specific device
   */
  getDeviceIPs(backendId: number, sourceIP: string, timeRange: TimeRange, limit: number): IPStats[] {
    if (!sourceIP) return [];
    const stats = this.db.getDeviceIPs(backendId, sourceIP, limit, timeRange.start, timeRange.end);
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeDeviceIPs(backendId, sourceIP, stats, limit);
    }
    return stats;
  }

  async getDeviceIPsWithRouting(
    backendId: number,
    sourceIP: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<IPStats[]> {
    if (!sourceIP) return [];
    const shouldUseCH = this.shouldUseClickHouse(timeRange);
    const chStats =
      shouldUseCH && timeRange.start && timeRange.end
        ? await this.clickHouseReader.getGroupedIPs(
            backendId,
            timeRange.start,
            timeRange.end,
            limit,
            { sourceIP },
          )
        : null;
    const stats = chStats ? this.populateGeoIPs(backendId, chStats) : null;
    const resolvedStats =
      stats || this.db.getDeviceIPs(backendId, sourceIP, limit, timeRange.start, timeRange.end);
    this.recordRoute('devices.ips', stats ? 'clickhouse' : 'sqlite');
    if (this.shouldIncludeRealtime(timeRange)) {
      return this.realtimeStore.mergeDeviceIPs(backendId, sourceIP, resolvedStats, limit);
    }
    return resolvedStats;
  }

  /**
   * Get hourly statistics for a specific backend
   */
  getHourlyStats(backendId: number, timeRange: TimeRange, hours: number): HourlyStats[] {
    return this.db.getHourlyStats(backendId, hours, timeRange.start, timeRange.end);
  }

  async getHourlyStatsWithRouting(
    backendId: number,
    timeRange: TimeRange,
    hours: number,
  ): Promise<HourlyStats[]> {
    const queryRange = this.resolveQueryRange(timeRange, Math.max(1, hours) * 60);
    const shouldUseCH =
      !!queryRange &&
      this.clickHouseReader.shouldUseForRange(queryRange.start, queryRange.end);
    if (shouldUseCH && queryRange) {
      const chStats = await this.clickHouseReader.getHourlyStats(
        backendId,
        hours,
        queryRange.start,
        queryRange.end,
      );
      if (chStats) {
        this.recordRoute('hourly', 'clickhouse');
        return chStats;
      }
    }

    this.failIfStrictFallback('hourly');
    this.recordRoute('hourly', 'sqlite');
    return this.db.getHourlyStats(backendId, hours, timeRange.start, timeRange.end);
  }

  /**
   * Get traffic trend for a specific backend
   */
  getTrafficTrend(backendId: number, timeRange: TimeRange, minutes: number): TrafficTrendPoint[] {
    const base = this.db.getTrafficTrend(backendId, minutes, timeRange.start, timeRange.end);
    if (!this.shouldIncludeRealtime(timeRange)) {
      return base;
    }
    return this.realtimeStore.mergeTrend(backendId, base, minutes, 1);
  }

  async getTrafficTrendWithRouting(
    backendId: number,
    timeRange: TimeRange,
    minutes: number,
  ): Promise<TrafficTrendPoint[]> {
    const queryRange = this.resolveQueryRange(timeRange, Math.max(1, minutes));
    const shouldUseCH =
      !!queryRange &&
      this.clickHouseReader.shouldUseForRange(queryRange.start, queryRange.end);

    const chBase =
      shouldUseCH && queryRange
        ? await this.clickHouseReader.getTrafficTrend(
            backendId,
            queryRange.start,
            queryRange.end,
          )
        : null;
    const base =
      chBase ||
      this.db.getTrafficTrend(backendId, minutes, timeRange.start, timeRange.end);
    if (!chBase) {
      this.failIfStrictFallback('trend');
    }
    this.recordRoute('trend', chBase ? 'clickhouse' : 'sqlite');

    if (!this.shouldIncludeRealtime(timeRange)) {
      return base;
    }
    return this.realtimeStore.mergeTrend(backendId, base, minutes, 1);
  }

  /**
   * Get traffic trend aggregated by time buckets for chart display
   */
  private getTrafficTrendAggregatedBase(
    backendId: number,
    timeRange: TimeRange,
    minutes: number,
    bucketMinutes: number,
    tzOffsetMinutes: number,
  ): TrafficTrendPoint[] {
    if (bucketMinutes >= 1440 && tzOffsetMinutes !== 0) {
      // The legacy DB facade cache has no timezone dimension.
      return this.db.repos.timeseries.getTrafficTrendAggregated(
        backendId, minutes, bucketMinutes, timeRange.start, timeRange.end, tzOffsetMinutes,
      );
    }
    return this.db.getTrafficTrendAggregated(backendId, minutes, bucketMinutes, timeRange.start, timeRange.end);
  }

  getTrafficTrendAggregated(
    backendId: number,
    timeRange: TimeRange,
    minutes: number,
    bucketMinutes: number,
    tzOffsetMinutes = 0,
  ): TrafficTrendPoint[] {
    const base = this.getTrafficTrendAggregatedBase(backendId, timeRange, minutes, bucketMinutes, tzOffsetMinutes);
    if (!this.shouldIncludeRealtime(timeRange)) {
      return base;
    }
    return this.realtimeStore.mergeTrend(backendId, base, minutes, bucketMinutes, undefined, tzOffsetMinutes);
  }

  async getTrafficTrendAggregatedWithRouting(
    backendId: number,
    timeRange: TimeRange,
    minutes: number,
    bucketMinutes: number,
    tzOffsetMinutes = 0,
  ): Promise<TrafficTrendPoint[]> {
    const queryRange = this.resolveQueryRange(timeRange, Math.max(1, minutes));
    const shouldUseCH =
      !!queryRange &&
      this.clickHouseReader.shouldUseForRange(queryRange.start, queryRange.end);

    const chBase =
      shouldUseCH && queryRange
        ? await this.clickHouseReader.getTrafficTrendAggregated(
            backendId,
            bucketMinutes,
            queryRange.start,
            queryRange.end,
            tzOffsetMinutes,
          )
        : null;
    const base =
      chBase ||
      this.getTrafficTrendAggregatedBase(
        backendId,
        timeRange,
        minutes,
        bucketMinutes,
        tzOffsetMinutes,
      );
    if (!chBase) {
      this.failIfStrictFallback('trend.aggregated');
    }
    this.recordRoute('trend.aggregated', chBase ? 'clickhouse' : 'sqlite');

    if (!this.shouldIncludeRealtime(timeRange)) {
      return base;
    }
    return this.realtimeStore.mergeTrend(backendId, base, minutes, bucketMinutes, undefined, tzOffsetMinutes);
  }

  /**
   * Get recent connections for a specific backend
   */
  getRecentConnections(backendId: number, limit: number): any[] {
    return this.db.getRecentConnections(backendId, limit);
  }

  getRecentConnectionsWithRouting(backendId: number, limit: number): any[] {
    if (this.clickHouseReader.shouldUse()) {
      this.recordRoute('connections', 'clickhouse');
      return this.clickHouseReader.getRecentConnections(backendId, limit);
    }

    this.failIfStrictFallback('connections');
    this.recordRoute('connections', 'sqlite');
    return this.db.getRecentConnections(backendId, limit);
  }
}
