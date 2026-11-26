/**
 * StatsService that also answers for MERGED_BACKEND_ID.
 *
 * A normal backend id goes straight to the parent implementation, so
 * single-backend behaviour is untouched. For the merged id every member
 * backend (enabled and listening) is queried through the same parent methods,
 * which keeps the SQLite/ClickHouse routing and the realtime merge of each
 * member, and the per-backend results are combined by the pure helpers in
 * stats.merge.ts. Rows that share a name across backends are summed.
 */

import { isMergedBackendId, MERGED_BACKEND_ID } from '@neko-master/shared';
import type { RuleChainFlowAll } from '@neko-master/shared';
import type { StatsDatabase } from '../db/db.js';
import type { RealtimeStore } from '../realtime/realtime.store.js';
import { StatsService } from './stats.service.js';
import type {
  CountryStats,
  DeviceStats,
  DomainStats,
  HourlyStats,
  IPStats,
  PaginatedDomainStats,
  PaginatedIPStats,
  ProxyStats,
  RuleStats,
  SummaryResponse,
  TimeRange,
  TrafficTrendPoint,
} from './stats.types.js';
import {
  comparePageRows,
  mergeCountryRows,
  mergeDeviceRows,
  mergeDomainRows,
  mergeHourlyStats,
  mergeIPRows,
  mergeProxyRows,
  mergeProxyTrafficRows,
  mergeRuleChainFlow,
  mergeRuleChainFlowAll,
  mergeRuleProxyMaps,
  mergeRuleRows,
  mergeTrendPoints,
  type RuleChainFlow,
} from './stats.merge.js';

type PaginatedOptions = Parameters<StatsService['getDomainStatsPaginatedWithRouting']>[2];
type RuleProxyMap = Array<{ rule: string; proxies: string[] }>;
type DistinctKind = 'domains' | 'ips';

/** Rows read per backend for the summary top lists. */
const MERGED_TOP_SCAN_ROWS = 200;
/** Chunk size of a merged page scan: the per-request page cap. */
const MERGED_PAGE_CHUNK_ROWS = 200;
/** Deepest row a merged page can reach within a single backend. */
export const MERGED_PAGE_SCAN_MAX_ROWS = 2000;
/**
 * Rows read per backend for short lists (countries, devices, drill-downs).
 * A row can rank low in every backend and still make the combined top of the
 * list once its shares are summed, so members are always read wider than the
 * caller's limit.
 */
const MERGED_LIST_OVERFETCH_ROWS = 200;
/** How long the member list is reused before it is read again. */
const MERGED_MEMBER_CACHE_MS = 1000;
/** Size of the summary top lists, as in StatsService.getSummary. */
const SUMMARY_TOP_LIMIT = 10;

interface MemberResults<T> {
  /** The members that answered, in the same order as `results`. */
  ids: number[];
  results: T[];
}

/** Rows of the paged tables: traffic counters plus the keys the page comparator sorts by. */
type PageRowBase = { totalUpload: number; totalDownload: number; totalConnections: number; lastSeen?: string };

export class MergedAwareStatsService extends StatsService {
  constructor(
    db: StatsDatabase,
    realtimeStore: RealtimeStore,
  ) {
    super(db, realtimeStore);
    this.memberSource = db;
  }

  // The parent keeps its own `db` private; this is the same instance.
  private readonly memberSource: StatsDatabase;
  private memberCache: { fetchedAt: number; ids: number[] } | null = null;

  /** `backendId=-1` selects the merged view; everything else is resolved as before. */
  override resolveBackendId(rawBackendId?: string): number | null {
    if (rawBackendId === String(MERGED_BACKEND_ID)) return MERGED_BACKEND_ID;
    return super.resolveBackendId(rawBackendId);
  }

  /** Enabled and listening backends, read at most once per second. */
  private listMergedBackendIds(): number[] {
    const now = Date.now();
    if (this.memberCache && now - this.memberCache.fetchedAt < MERGED_MEMBER_CACHE_MS) {
      return this.memberCache.ids;
    }
    const ids = this.memberSource.getListeningBackends().map((backend) => backend.id);
    this.memberCache = { fetchedAt: now, ids };
    return ids;
  }

  /**
   * Runs `pick` for every member backend. Returns null when `backendId` is a
   * normal backend, so the caller falls through to the parent implementation.
   */
  private async fanOut<T>(
    backendId: number,
    pick: (memberId: number) => T | Promise<T>,
  ): Promise<MemberResults<Awaited<T>> | null> {
    if (!isMergedBackendId(backendId)) return null;
    const ids = this.listMergedBackendIds();
    const picked = await Promise.all(
      ids.map(async (id) => {
        try {
          return { id, value: await pick(id) };
        } catch (error) {
          // A member can be deleted between listing and querying; it drops out.
          if (!this.memberSource.getBackend(id)) return null;
          throw error;
        }
      }),
    );
    const answered = picked.filter(
      (entry): entry is { id: number; value: Awaited<T> } => entry !== null,
    );
    return {
      ids: answered.map((entry) => entry.id),
      results: answered.map((entry) => entry.value),
    };
  }

  /**
   * Distinct domain and/or IP counts across the members, routed like the paged
   * queries and falling back to SQLite per kind. A key seen on several
   * backends is counted once.
   */
  private async countMergedDistinct(
    backendIds: number[],
    timeRange: TimeRange,
    search: string | undefined,
    wanted: DistinctKind | 'both',
  ): Promise<Partial<Record<DistinctKind, number>>> {
    const kinds: DistinctKind[] = wanted === 'both' ? ['domains', 'ips'] : [wanted];
    const useCH = this.shouldUseClickHouse(timeRange) && !!timeRange.start && !!timeRange.end;
    const opts = { search, start: timeRange.start, end: timeRange.end };
    const counts: Partial<Record<DistinctKind, number>> = {};

    await Promise.all(
      kinds.map(async (kind) => {
        if (useCH && timeRange.start && timeRange.end) {
          const fromClickHouse = kind === 'domains'
            ? await this.clickHouseReader.countDomainsAcrossBackends(backendIds, timeRange.start, timeRange.end, search)
            : await this.clickHouseReader.countIPsAcrossBackends(backendIds, timeRange.start, timeRange.end, search);
          if (fromClickHouse !== null) {
            counts[kind] = fromClickHouse;
            return;
          }
        }
        // Same guard as the parent routes: no silent SQLite fallback under CH_STRICT_STATS=1.
        this.failIfStrictFallback(`merged.count.${kind}`);
        counts[kind] = kind === 'domains'
          ? this.memberSource.countDomainsAcrossBackends(backendIds, opts)
          : this.memberSource.countIPsAcrossBackends(backendIds, opts);
      }),
    );
    return counts;
  }

  /**
   * Rows of one member from the top of the list down to `depth`, read in
   * chunks because a single page is capped.
   */
  private async scanMemberRows<R>(
    depth: number,
    fetchPage: (offset: number, limit: number) => Promise<{ data: R[]; total: number }>,
  ): Promise<R[]> {
    const rows: R[] = [];
    let offset = 0;
    while (offset < depth) {
      const limit = Math.min(MERGED_PAGE_CHUNK_ROWS, depth - offset);
      const page = await fetchPage(offset, limit);
      rows.push(...page.data);
      // Advance by what actually came back, in case the page size is capped
      // below what was asked for; stop at an empty page or the end of the list.
      if (page.data.length === 0 || offset + page.data.length >= page.total) break;
      offset += page.data.length;
    }
    return rows;
  }

  /**
   * How deep to read in each member for a merged page. Reading at least
   * MERGED_PAGE_CHUNK_ROWS rows keeps the first pages exact for the same
   * reason as the list overfetch above.
   */
  private mergedPageDepth(options: PaginatedOptions): { offset: number; limit: number; depth: number } {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    const depth = Math.min(Math.max(offset + limit, MERGED_PAGE_CHUNK_ROWS), MERGED_PAGE_SCAN_MAX_ROWS);
    return { offset, limit, depth };
  }

  /**
   * Builds one page of a merged table. Returns null for a normal backend id.
   * `counted` picks the distinct total that belongs to this table.
   */
  private async mergedPage<R extends PageRowBase>(
    backendId: number,
    timeRange: TimeRange,
    options: PaginatedOptions,
    fetchPage: (memberId: number, scanOffset: number, scanLimit: number) => Promise<{ data: R[]; total: number }>,
    combine: (chunks: R[][]) => R[],
    keyOf: (row: R) => string,
    counted: DistinctKind,
  ): Promise<{ data: R[]; total: number } | null> {
    if (!isMergedBackendId(backendId)) return null;
    const { offset, limit, depth } = this.mergedPageDepth(options);
    const ids = this.listMergedBackendIds();

    // Past the scan limit nothing can be merged; the real total is still reported.
    if (offset >= MERGED_PAGE_SCAN_MAX_ROWS) {
      return { data: [], total: (await this.countMergedDistinct(ids, timeRange, options.search, counted))[counted] ?? 0 };
    }

    const [chunks, distinct] = await Promise.all([
      Promise.all(ids.map((id) => this.scanMemberRows(depth, (scanOffset, scanLimit) => fetchPage(id, scanOffset, scanLimit)))),
      this.countMergedDistinct(ids, timeRange, options.search, counted),
    ]);
    const rows = combine(chunks).sort((a, b) => comparePageRows(a, b, keyOf, options));
    return { data: rows.slice(offset, offset + limit), total: distinct[counted] ?? 0 };
  }

  /**
   * Merges a bounded list: countries, devices, or the rows under one domain,
   * proxy, rule or device. Returns null for a normal backend id.
   */
  private async mergedList<R>(
    backendId: number,
    limit: number,
    read: (memberId: number, fetchLimit: number) => Promise<R[]>,
    combine: (lists: R[][]) => R[],
  ): Promise<R[] | null> {
    const fetchLimit = Math.max(limit, MERGED_LIST_OVERFETCH_ROWS);
    const members = await this.fanOut(backendId, (id) => read(id, fetchLimit));
    if (!members) return null;
    return combine(members.results).slice(0, limit);
  }

  // ==================== Summary ====================

  override async getSummaryWithRouting(backendId: number, timeRange: TimeRange): Promise<SummaryResponse> {
    const members = await this.fanOut(backendId, (id) => super.getSummaryWithRouting(id, timeRange));
    if (!members) return super.getSummaryWithRouting(backendId, timeRange);

    const scanOptions = { offset: 0, limit: MERGED_TOP_SCAN_ROWS, sortBy: 'totalTraffic', sortOrder: 'desc' as const };
    const [topDomainPages, topIPPages, distinct] = await Promise.all([
      Promise.all(members.ids.map((id) => super.getDomainStatsPaginatedWithRouting(id, timeRange, scanOptions))),
      Promise.all(members.ids.map((id) => super.getIPStatsPaginatedWithRouting(id, timeRange, scanOptions))),
      this.countMergedDistinct(members.ids, timeRange, '', 'both'),
    ]);

    // The per-backend top lists are already cut to 10, which is not enough to
    // derive the combined top 10, so they come from a wider scan instead.
    const summaries = members.results;
    const sum = (pick: (summary: SummaryResponse) => number): number =>
      summaries.reduce((total, summary) => total + pick(summary), 0);
    const proxyStats = mergeProxyRows(summaries.map((summary) => summary.proxyStats));
    const ruleStats = mergeRuleRows(summaries.map((summary) => summary.ruleStats));

    return {
      backend: { id: MERGED_BACKEND_ID, name: 'All backends', isActive: true, listening: true },
      totalConnections: sum((summary) => summary.totalConnections),
      totalUpload: sum((summary) => summary.totalUpload),
      totalDownload: sum((summary) => summary.totalDownload),
      totalDomains: distinct.domains ?? 0,
      totalIPs: distinct.ips ?? 0,
      totalRules: ruleStats.length,
      totalProxies: proxyStats.length,
      todayUpload: sum((summary) => summary.todayUpload),
      todayDownload: sum((summary) => summary.todayDownload),
      topDomains: mergeDomainRows(topDomainPages.map((page) => page.data)).slice(0, SUMMARY_TOP_LIMIT),
      topIPs: mergeIPRows(topIPPages.map((page) => page.data)).slice(0, SUMMARY_TOP_LIMIT),
      proxyStats,
      ruleStats,
      hourlyStats: mergeHourlyStats(summaries.map((summary) => summary.hourlyStats)),
    };
  }

  // ==================== Paged tables ====================

  override async getDomainStatsPaginatedWithRouting(
    backendId: number,
    timeRange: TimeRange,
    options: PaginatedOptions,
  ): Promise<PaginatedDomainStats> {
    const page = await this.mergedPage(
      backendId,
      timeRange,
      options,
      (id, scanOffset, scanLimit) =>
        super.getDomainStatsPaginatedWithRouting(id, timeRange, { ...options, offset: scanOffset, limit: scanLimit }),
      (chunks) => mergeDomainRows(chunks),
      (row) => row.domain,
      'domains',
    );
    return page ?? super.getDomainStatsPaginatedWithRouting(backendId, timeRange, options);
  }

  override async getIPStatsPaginatedWithRouting(
    backendId: number,
    timeRange: TimeRange,
    options: PaginatedOptions,
  ): Promise<PaginatedIPStats> {
    const page = await this.mergedPage(
      backendId,
      timeRange,
      options,
      (id, scanOffset, scanLimit) =>
        super.getIPStatsPaginatedWithRouting(id, timeRange, { ...options, offset: scanOffset, limit: scanLimit }),
      (chunks) => mergeIPRows(chunks),
      (row) => row.ip,
      'ips',
    );
    return page ?? super.getIPStatsPaginatedWithRouting(backendId, timeRange, options);
  }

  // ==================== Drill-downs ====================

  override async getDomainProxyStatsWithRouting(
    backendId: number,
    domain: string,
    timeRange: TimeRange,
    sourceIP?: string,
    sourceChain?: string,
  ) {
    const members = await this.fanOut(backendId, (id) =>
      super.getDomainProxyStatsWithRouting(id, domain, timeRange, sourceIP, sourceChain),
    );
    if (!members) return super.getDomainProxyStatsWithRouting(backendId, domain, timeRange, sourceIP, sourceChain);
    return mergeProxyTrafficRows(members.results);
  }

  override async getIPProxyStatsWithRouting(
    backendId: number,
    ip: string,
    timeRange: TimeRange,
    sourceIP?: string,
    sourceChain?: string,
  ) {
    const members = await this.fanOut(backendId, (id) =>
      super.getIPProxyStatsWithRouting(id, ip, timeRange, sourceIP, sourceChain),
    );
    if (!members) return super.getIPProxyStatsWithRouting(backendId, ip, timeRange, sourceIP, sourceChain);
    return mergeProxyTrafficRows(members.results);
  }

  override async getDomainIPDetailsWithRouting(
    backendId: number,
    domain: string,
    timeRange: TimeRange,
    limit: number,
    sourceIP?: string,
    sourceChain?: string,
  ): Promise<IPStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getDomainIPDetailsWithRouting(id, domain, timeRange, fetchLimit, sourceIP, sourceChain),
      mergeIPRows,
    );
    return rows ?? super.getDomainIPDetailsWithRouting(backendId, domain, timeRange, limit, sourceIP, sourceChain);
  }

  override async getIPDomainDetailsWithRouting(
    backendId: number,
    ip: string,
    timeRange: TimeRange,
    limit: number,
    sourceIP?: string,
    sourceChain?: string,
  ): Promise<DomainStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getIPDomainDetailsWithRouting(id, ip, timeRange, fetchLimit, sourceIP, sourceChain),
      mergeDomainRows,
    );
    return rows ?? super.getIPDomainDetailsWithRouting(backendId, ip, timeRange, limit, sourceIP, sourceChain);
  }

  // ==================== Proxies ====================

  override async getProxyStatsWithRouting(backendId: number, timeRange: TimeRange): Promise<ProxyStats[]> {
    const members = await this.fanOut(backendId, (id) => super.getProxyStatsWithRouting(id, timeRange));
    if (!members) return super.getProxyStatsWithRouting(backendId, timeRange);
    return mergeProxyRows(members.results);
  }

  override async getProxyDomainsWithRouting(
    backendId: number,
    chain: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<DomainStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getProxyDomainsWithRouting(id, chain, timeRange, fetchLimit),
      mergeDomainRows,
    );
    return rows ?? super.getProxyDomainsWithRouting(backendId, chain, timeRange, limit);
  }

  override async getProxyIPsWithRouting(
    backendId: number,
    chain: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<IPStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getProxyIPsWithRouting(id, chain, timeRange, fetchLimit),
      mergeIPRows,
    );
    return rows ?? super.getProxyIPsWithRouting(backendId, chain, timeRange, limit);
  }

  // ==================== Rules ====================

  override async getRuleStatsWithRouting(backendId: number, timeRange: TimeRange): Promise<RuleStats[]> {
    const members = await this.fanOut(backendId, (id) => super.getRuleStatsWithRouting(id, timeRange));
    if (!members) return super.getRuleStatsWithRouting(backendId, timeRange);
    return mergeRuleRows(members.results);
  }

  override async getRuleDomainsWithRouting(
    backendId: number,
    rule: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<DomainStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getRuleDomainsWithRouting(id, rule, timeRange, fetchLimit),
      mergeDomainRows,
    );
    return rows ?? super.getRuleDomainsWithRouting(backendId, rule, timeRange, limit);
  }

  override async getRuleIPsWithRouting(
    backendId: number,
    rule: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<IPStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getRuleIPsWithRouting(id, rule, timeRange, fetchLimit),
      mergeIPRows,
    );
    return rows ?? super.getRuleIPsWithRouting(backendId, rule, timeRange, limit);
  }

  override async getRuleDomainProxyStatsWithRouting(backendId: number, rule: string, domain: string, timeRange: TimeRange) {
    const members = await this.fanOut(backendId, (id) =>
      super.getRuleDomainProxyStatsWithRouting(id, rule, domain, timeRange),
    );
    if (!members) return super.getRuleDomainProxyStatsWithRouting(backendId, rule, domain, timeRange);
    return mergeProxyTrafficRows(members.results);
  }

  override async getRuleDomainIPDetailsWithRouting(
    backendId: number,
    rule: string,
    domain: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<IPStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getRuleDomainIPDetailsWithRouting(id, rule, domain, timeRange, fetchLimit),
      mergeIPRows,
    );
    return rows ?? super.getRuleDomainIPDetailsWithRouting(backendId, rule, domain, timeRange, limit);
  }

  override async getRuleIPProxyStatsWithRouting(backendId: number, rule: string, ip: string, timeRange: TimeRange) {
    const members = await this.fanOut(backendId, (id) => super.getRuleIPProxyStatsWithRouting(id, rule, ip, timeRange));
    if (!members) return super.getRuleIPProxyStatsWithRouting(backendId, rule, ip, timeRange);
    return mergeProxyTrafficRows(members.results);
  }

  override async getRuleIPDomainDetailsWithRouting(
    backendId: number,
    rule: string,
    ip: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<DomainStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getRuleIPDomainDetailsWithRouting(id, rule, ip, timeRange, fetchLimit),
      mergeDomainRows,
    );
    return rows ?? super.getRuleIPDomainDetailsWithRouting(backendId, rule, ip, timeRange, limit);
  }

  override async getRuleChainFlowWithRouting(backendId: number, rule: string, timeRange: TimeRange): Promise<RuleChainFlow> {
    const members = await this.fanOut(backendId, (id) => super.getRuleChainFlowWithRouting(id, rule, timeRange));
    if (!members) return super.getRuleChainFlowWithRouting(backendId, rule, timeRange);
    return mergeRuleChainFlow(members.results);
  }

  override async getAllRuleChainFlowsWithRouting(backendId: number, timeRange: TimeRange): Promise<RuleChainFlowAll> {
    const members = await this.fanOut(backendId, (id) => super.getAllRuleChainFlowsWithRouting(id, timeRange));
    if (!members) return super.getAllRuleChainFlowsWithRouting(backendId, timeRange);
    return mergeRuleChainFlowAll(members.results);
  }

  override async getRuleProxyMapWithRouting(backendId: number): Promise<RuleProxyMap> {
    const members = await this.fanOut(backendId, (id) => super.getRuleProxyMapWithRouting(id));
    if (!members) return super.getRuleProxyMapWithRouting(backendId);
    return mergeRuleProxyMaps(members.results);
  }

  // ==================== Countries and devices ====================

  override async getCountryStatsWithRouting(backendId: number, timeRange: TimeRange, limit: number): Promise<CountryStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getCountryStatsWithRouting(id, timeRange, fetchLimit),
      mergeCountryRows,
    );
    return rows ?? super.getCountryStatsWithRouting(backendId, timeRange, limit);
  }

  override async getDeviceStatsWithRouting(backendId: number, timeRange: TimeRange, limit: number): Promise<DeviceStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getDeviceStatsWithRouting(id, timeRange, fetchLimit),
      mergeDeviceRows,
    );
    return rows ?? super.getDeviceStatsWithRouting(backendId, timeRange, limit);
  }

  override async getDeviceDomainsWithRouting(
    backendId: number,
    sourceIP: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<DomainStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getDeviceDomainsWithRouting(id, sourceIP, timeRange, fetchLimit),
      mergeDomainRows,
    );
    return rows ?? super.getDeviceDomainsWithRouting(backendId, sourceIP, timeRange, limit);
  }

  override async getDeviceIPsWithRouting(
    backendId: number,
    sourceIP: string,
    timeRange: TimeRange,
    limit: number,
  ): Promise<IPStats[]> {
    const rows = await this.mergedList(
      backendId,
      limit,
      (id, fetchLimit) => super.getDeviceIPsWithRouting(id, sourceIP, timeRange, fetchLimit),
      mergeIPRows,
    );
    return rows ?? super.getDeviceIPsWithRouting(backendId, sourceIP, timeRange, limit);
  }

  // ==================== Time series ====================

  override async getHourlyStatsWithRouting(backendId: number, timeRange: TimeRange, hours: number): Promise<HourlyStats[]> {
    const members = await this.fanOut(backendId, (id) => super.getHourlyStatsWithRouting(id, timeRange, hours));
    if (!members) return super.getHourlyStatsWithRouting(backendId, timeRange, hours);
    return mergeHourlyStats(members.results);
  }

  override async getTrafficTrendWithRouting(
    backendId: number,
    timeRange: TimeRange,
    minutes: number,
  ): Promise<TrafficTrendPoint[]> {
    const members = await this.fanOut(backendId, (id) => super.getTrafficTrendWithRouting(id, timeRange, minutes));
    if (!members) return super.getTrafficTrendWithRouting(backendId, timeRange, minutes);
    return mergeTrendPoints(members.results);
  }

  override async getTrafficTrendAggregatedWithRouting(
    backendId: number,
    timeRange: TimeRange,
    minutes: number,
    bucketMinutes: number,
    tzOffsetMinutes = 0,
  ): Promise<TrafficTrendPoint[]> {
    const members = await this.fanOut(backendId, (id) =>
      super.getTrafficTrendAggregatedWithRouting(id, timeRange, minutes, bucketMinutes, tzOffsetMinutes),
    );
    if (!members) return super.getTrafficTrendAggregatedWithRouting(backendId, timeRange, minutes, bucketMinutes, tzOffsetMinutes);
    return mergeTrendPoints(members.results);
  }

  // ==================== Connections ====================

  // Recent connections exist only under ClickHouse; the merged view reports
  // none of them. The dashboard does not request them.
  override getRecentConnectionsWithRouting(
    backendId: number,
    limit: number,
  ): ReturnType<StatsService['getRecentConnectionsWithRouting']> {
    if (isMergedBackendId(backendId)) return [];
    return super.getRecentConnectionsWithRouting(backendId, limit);
  }
}
