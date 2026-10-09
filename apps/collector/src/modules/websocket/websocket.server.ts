import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { StatsSummary, DomainStats, IPStats, ProxyStats, CountryStats, DeviceStats, RuleStats, HourlyStats } from '@neko-master/shared';
import type { StatsDatabase } from '../db/db.js';
import type { StatsService } from '../stats/stats.service.js';
import type { SummaryFieldKey, SummaryFieldMask } from './websocket.types.js';
import { AuthService } from '../auth/auth.service.js';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { readCookie } from '../../shared/utils/cookie-header.js';

export interface WebSocketMessage {
  type: 'stats' | 'ping' | 'pong' | 'subscribe';
  backendId?: number;
  start?: string;
  end?: string;
  minPushIntervalMs?: number;
  includeSummary?: boolean;
  summaryFields?: SummaryFieldKey[];
  includeTrend?: boolean;
  trendMinutes?: number;
  trendBucketMinutes?: number;
  includeDeviceDetails?: boolean;
  deviceSourceIP?: string;
  deviceDetailLimit?: number;
  includeProxyDetails?: boolean;
  proxyChain?: string;
  proxyDetailLimit?: number;
  includeRuleDetails?: boolean;
  ruleName?: string;
  ruleDetailLimit?: number;
  includeRuleChainFlow?: boolean;
  includeDomainsPage?: boolean;
  domainsPageOffset?: number;
  domainsPageLimit?: number;
  domainsPageSortBy?: string;
  domainsPageSortOrder?: string;
  domainsPageSearch?: string;
  includeIPsPage?: boolean;
  ipsPageOffset?: number;
  ipsPageLimit?: number;
  ipsPageSortBy?: string;
  ipsPageSortOrder?: string;
  ipsPageSearch?: string;
  data?: StatsSummary;
  timestamp: string;
}

type ClientRange = {
  start?: string;
  end?: string;
};

type ClientTrend = {
  minutes: number;
  bucketMinutes: number;
} | null;

type ClientDeviceDetail = {
  sourceIP: string;
  limit: number;
} | null;

type ClientProxyDetail = {
  chain: string;
  limit: number;
} | null;

type ClientRuleDetail = {
  rule: string;
  limit: number;
} | null;

type ClientDomainsPage = {
  offset: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
} | null;

type ClientIPsPage = {
  offset: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
} | null;

interface ClientInfo {
  ws: WebSocket;
  backendId: number | null; // null means use active backend
  range: ClientRange;
  minPushIntervalMs: number;
  includeSummary: boolean;
  summaryFields: SummaryFieldMask;
  lastSentAt: number;
  trend: ClientTrend;
  deviceDetail: ClientDeviceDetail;
  proxyDetail: ClientProxyDetail;
  ruleDetail: ClientRuleDetail;
  includeRuleChainFlow: boolean;
  domainsPage: ClientDomainsPage;
  ipsPage: ClientIPsPage;
}

const SUMMARY_FIELD_KEYS: SummaryFieldKey[] = [
  'totals',
  'topDomains',
  'topIPs',
  'proxyStats',
  'countryStats',
  'deviceStats',
  'ruleStats',
  'hourlyStats',
];

const SUMMARY_FIELD_KEY_SET = new Set<SummaryFieldKey>(SUMMARY_FIELD_KEYS);

const DEFAULT_SUMMARY_FIELDS: SummaryFieldMask = {
  totals: true,
  topDomains: true,
  topIPs: true,
  proxyStats: true,
  countryStats: true,
  deviceStats: true,
  ruleStats: true,
  hourlyStats: true,
};

const EMPTY_SUMMARY_FIELDS: SummaryFieldMask = {
  totals: false,
  topDomains: false,
  topIPs: false,
  proxyStats: false,
  countryStats: false,
  deviceStats: false,
  ruleStats: false,
  hourlyStats: false,
};

const ZERO_BASE_SUMMARY = {
  totalConnections: 0,
  totalUpload: 0,
  totalDownload: 0,
  uniqueDomains: 0,
  uniqueIPs: 0,
  totalProxies: 0,
  totalRules: 0,
};

export class StatsWebSocketServer {
  private wss: WSServer | null = null;
  private db: StatsDatabase;
  private statsService: StatsService;
  private authService: AuthService;
  private clients: Map<WebSocket, ClientInfo> = new Map();
  private port: number;
  private lastBroadcastTime = 0;
  private broadcastThrottleMs = 1000; // minimum interval between broadcasts
  // Cache for expensive full-summary queries: avoids re-querying all 8 base tables
  // when multiple broadcasts fire within a short window.
  private baseSummaryCache = new Map<string, {
    summary?: {
      totalConnections: number;
      totalUpload: number;
      totalDownload: number;
      uniqueDomains: number;
      uniqueIPs: number;
      totalProxies: number;
      totalRules: number;
    };
    topDomains?: DomainStats[];
    topIPs?: IPStats[];
    proxyStats?: ProxyStats[];
    countryStats?: CountryStats[];
    deviceStats?: DeviceStats[];
    ruleStats?: RuleStats[];
    hourlyStats?: HourlyStats[];
    ts: number;
  }>();
  private static BASE_SUMMARY_CACHE_TTL_MS = 2000;
  private static BASE_SUMMARY_CACHE_TTL_HISTORICAL_MS = 300000; // 5 minutes for historical ranges
  private wsMetricsLogIntervalMs = Math.max(
    1000,
    parseInt(process.env.WS_METRICS_LOG_INTERVAL_MS || '60000', 10) || 60000,
  );
  private wsMetricsWindowStartedAt = Date.now();
  private wsMetrics = {
    subscribeTotal: 0,
    subscribeChanged: 0,
    subscribeNoop: 0,
    getStatsCalls: 0,
    fullSummaryCalls: 0,
    baseCacheHit: 0,
    baseCacheMiss: 0,
    trendCalls: 0,
    detailCalls: 0,
    pagedCalls: 0,
    broadcastCalls: 0,
    broadcastSentClients: 0,
    backpressureSkips: 0,
  };

  // Skip pushing to clients whose outbound socket buffer is already backed
  // up — an unbounded buffer on a slow client grows the Node heap forever.
  private readonly maxBufferedBytes = Math.max(
    64 * 1024,
    Number.parseInt(process.env.WS_MAX_BUFFERED_BYTES || '', 10) || 4 * 1024 * 1024,
  );

  constructor(port: number, db: StatsDatabase, statsService: StatsService) {
    this.port = port;
    this.db = db;
    this.statsService = statsService;
    this.authService = new AuthService(db);
  }

  start() {
    this.wss = new WSServer({
      port: this.port,
      host: '0.0.0.0',
      perMessageDeflate: false,
    });

    this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      // Connection attempt logging removed to reduce noise

      // Verify authentication
      try {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        let token = url.searchParams.get('token');
        
        // Try getting token from cookie if not in URL
        if (!token) {
          token = readCookie(req.headers.cookie, 'neko-session');
        }
        
        // Check if auth is required and verify token
        if (this.authService.isAuthRequired()) {
          if (!token) {
            // Missing token rejected (logging removed)
            ws.close(4001, 'Authentication required');
            return;
          }

          const verifyResult = await this.authService.verifyToken(token);
          if (!verifyResult.valid) {
            // Invalid token rejected (logging removed)
            ws.close(4003, 'Invalid token');
            return;
          }
        }
      } catch (error) {
        console.error('[WebSocket] Error verifying auth:', error);
        ws.close(4000, 'Internal server error');
        return;
      }

      // Client connected (logging removed to reduce noise in production)

      const clientInfo: ClientInfo = {
        ws,
        backendId: null,
        range: {},
        minPushIntervalMs: 0,
        includeSummary: true,
        summaryFields: { ...DEFAULT_SUMMARY_FIELDS },
        lastSentAt: 0,
        trend: null,
        deviceDetail: null,
        proxyDetail: null,
        ruleDetail: null,
        includeRuleChainFlow: false,
        domainsPage: null,
        ipsPage: null,
      };
      this.clients.set(ws, clientInfo);

      // Push an initial snapshot immediately.
      this.sendStatsToClient(ws);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as WebSocketMessage;

          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            return;
          }

          if (msg.type === 'subscribe') {
            this.wsMetrics.subscribeTotal += 1;
            let changed = false;

            if (msg.backendId !== undefined) {
              const backend = this.db.getBackend(msg.backendId);
              if (backend) {
                if (clientInfo.backendId !== msg.backendId) {
                  clientInfo.backendId = msg.backendId;
                  changed = true;
                  // Client subscribed to backend (logging removed)
                }
              } else {
                console.warn(`[WebSocket] Client tried to subscribe to non-existent backend: ${msg.backendId}`);
              }
            }

            if (msg.start !== undefined || msg.end !== undefined) {
              const parsedRange = this.parseRange(msg.start, msg.end);
              if (parsedRange) {
                if (!this.isRangeEqual(clientInfo.range, parsedRange)) {
                  clientInfo.range = parsedRange;
                  changed = true;
                }
              }
            }

            if (msg.minPushIntervalMs !== undefined) {
              const nextMinPushIntervalMs = this.parseMinPushIntervalMs(
                msg.minPushIntervalMs,
                clientInfo.minPushIntervalMs,
              );
              if (nextMinPushIntervalMs !== clientInfo.minPushIntervalMs) {
                clientInfo.minPushIntervalMs = nextMinPushIntervalMs;
                changed = true;
              }
            }

            if (msg.includeSummary !== undefined) {
              const nextIncludeSummary = msg.includeSummary !== false;
              if (nextIncludeSummary !== clientInfo.includeSummary) {
                clientInfo.includeSummary = nextIncludeSummary;
                changed = true;
              }
            }

            if (msg.summaryFields !== undefined) {
              const parsedSummaryFields = this.parseSummaryFields(
                msg.summaryFields,
                clientInfo.summaryFields,
              );
              if (!this.isSummaryFieldsEqual(clientInfo.summaryFields, parsedSummaryFields)) {
                clientInfo.summaryFields = parsedSummaryFields;
                changed = true;
              }
            }

            if (
              msg.includeTrend !== undefined ||
              msg.trendMinutes !== undefined ||
              msg.trendBucketMinutes !== undefined
            ) {
              const parsedTrend = this.parseTrend(
                msg.includeTrend,
                msg.trendMinutes,
                msg.trendBucketMinutes,
                clientInfo.range,
              );
              if (parsedTrend !== undefined) {
                if (!this.isTrendEqual(clientInfo.trend, parsedTrend)) {
                  clientInfo.trend = parsedTrend;
                  changed = true;
                }
              }
            }
            if (
              msg.includeDeviceDetails !== undefined ||
              msg.deviceSourceIP !== undefined ||
              msg.deviceDetailLimit !== undefined
            ) {
              const parsedDeviceDetail = this.parseDeviceDetail(
                msg.includeDeviceDetails,
                msg.deviceSourceIP,
                msg.deviceDetailLimit,
              );
              if (parsedDeviceDetail !== undefined) {
                if (!this.isDeviceDetailEqual(clientInfo.deviceDetail, parsedDeviceDetail)) {
                  clientInfo.deviceDetail = parsedDeviceDetail;
                  changed = true;
                }
              }
            }
            if (
              msg.includeProxyDetails !== undefined ||
              msg.proxyChain !== undefined ||
              msg.proxyDetailLimit !== undefined
            ) {
              const parsedProxyDetail = this.parseProxyDetail(
                msg.includeProxyDetails,
                msg.proxyChain,
                msg.proxyDetailLimit,
              );
              if (parsedProxyDetail !== undefined) {
                if (!this.isProxyDetailEqual(clientInfo.proxyDetail, parsedProxyDetail)) {
                  clientInfo.proxyDetail = parsedProxyDetail;
                  changed = true;
                }
              }
            }
            if (
              msg.includeRuleDetails !== undefined ||
              msg.ruleName !== undefined ||
              msg.ruleDetailLimit !== undefined
            ) {
              const parsedRuleDetail = this.parseRuleDetail(
                msg.includeRuleDetails,
                msg.ruleName,
                msg.ruleDetailLimit,
              );
              if (parsedRuleDetail !== undefined) {
                if (!this.isRuleDetailEqual(clientInfo.ruleDetail, parsedRuleDetail)) {
                  clientInfo.ruleDetail = parsedRuleDetail;
                  changed = true;
                }
              }
            }
            if (msg.includeRuleChainFlow !== undefined) {
              const nextIncludeRuleChainFlow = !!msg.includeRuleChainFlow;
              if (nextIncludeRuleChainFlow !== clientInfo.includeRuleChainFlow) {
                clientInfo.includeRuleChainFlow = nextIncludeRuleChainFlow;
                changed = true;
              }
            }
            if (
              msg.includeDomainsPage !== undefined ||
              msg.domainsPageOffset !== undefined ||
              msg.domainsPageLimit !== undefined ||
              msg.domainsPageSortBy !== undefined ||
              msg.domainsPageSortOrder !== undefined ||
              msg.domainsPageSearch !== undefined
            ) {
              const parsedDomainsPage = this.parseDomainsPage(
                msg.includeDomainsPage,
                msg.domainsPageOffset,
                msg.domainsPageLimit,
                msg.domainsPageSortBy,
                msg.domainsPageSortOrder,
                msg.domainsPageSearch,
              );
              if (parsedDomainsPage !== undefined) {
                if (!this.isDomainsPageEqual(clientInfo.domainsPage, parsedDomainsPage)) {
                  clientInfo.domainsPage = parsedDomainsPage;
                  changed = true;
                }
              }
            }
            if (
              msg.includeIPsPage !== undefined ||
              msg.ipsPageOffset !== undefined ||
              msg.ipsPageLimit !== undefined ||
              msg.ipsPageSortBy !== undefined ||
              msg.ipsPageSortOrder !== undefined ||
              msg.ipsPageSearch !== undefined
            ) {
              const parsedIPsPage = this.parseIPsPage(
                msg.includeIPsPage,
                msg.ipsPageOffset,
                msg.ipsPageLimit,
                msg.ipsPageSortBy,
                msg.ipsPageSortOrder,
                msg.ipsPageSearch,
              );
              if (parsedIPsPage !== undefined) {
                if (!this.isIPsPageEqual(clientInfo.ipsPage, parsedIPsPage)) {
                  clientInfo.ipsPage = parsedIPsPage;
                  changed = true;
                }
              }
            }

            if (changed) {
              this.wsMetrics.subscribeChanged += 1;
              this.sendStatsToClient(ws);
            } else {
              this.wsMetrics.subscribeNoop += 1;
            }
            this.maybeLogWsMetrics();
          }
        } catch {
          // Ignore invalid frames.
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        // Client disconnected (logging removed to reduce noise)
      });

      ws.on('error', (err) => {
        console.error('[WebSocket] Client error:', err.message);
        this.clients.delete(ws);
      });
    });

    console.log(`[WebSocket] Server running at ws://0.0.0.0:${this.port}`);
  }

  private parseRange(start?: string, end?: string): ClientRange | null {
    if (start === undefined && end === undefined) {
      return {};
    }

    if (!start || !end) {
      return null;
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return null;
    }
    if (startDate > endDate) {
      return null;
    }

    return {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    };
  }

  private parseMinPushIntervalMs(
    value: number,
    fallback: number,
  ): number {
    if (!Number.isFinite(value)) return fallback;
    // Keep range conservative to avoid client misuse.
    return Math.max(0, Math.min(60_000, Math.floor(value)));
  }

  private parseSummaryFields(
    value: SummaryFieldKey[] | undefined,
    fallback: SummaryFieldMask,
  ): SummaryFieldMask {
    if (!Array.isArray(value)) {
      return fallback;
    }

    if (value.length === 0) {
      return { ...DEFAULT_SUMMARY_FIELDS };
    }

    const parsed: SummaryFieldMask = { ...EMPTY_SUMMARY_FIELDS };
    let hasKnownField = false;

    for (const candidate of value) {
      if (typeof candidate !== 'string') {
        continue;
      }

      const key = candidate.trim() as SummaryFieldKey;
      if (!SUMMARY_FIELD_KEY_SET.has(key)) {
        continue;
      }

      parsed[key] = true;
      hasKnownField = true;
    }

    return hasKnownField ? parsed : fallback;
  }

  private isSummaryFieldsEqual(
    a: SummaryFieldMask,
    b: SummaryFieldMask,
  ): boolean {
    for (const key of SUMMARY_FIELD_KEYS) {
      if (!!a[key] !== !!b[key]) {
        return false;
      }
    }

    return true;
  }

  private hasAnySummaryFields(fields: SummaryFieldMask): boolean {
    for (const key of SUMMARY_FIELD_KEYS) {
      if (fields[key]) {
        return true;
      }
    }

    return false;
  }

  private needsCoreSummary(fields: SummaryFieldMask): boolean {
    // Note: countryStats and deviceStats are intentionally omitted here
    // because they are fetched via independent DB queries/routes.
    return (
      fields.totals ||
      fields.topDomains ||
      fields.topIPs ||
      fields.proxyStats ||
      fields.ruleStats ||
      fields.hourlyStats
    );
  }

  private buildSummaryFieldsKey(fields: SummaryFieldMask): string {
    const enabledFields = SUMMARY_FIELD_KEYS.filter((field) => fields[field]);
    return enabledFields.length > 0 ? enabledFields.join(',') : 'none';
  }

  private buildSummaryFieldList(fields: SummaryFieldMask): SummaryFieldKey[] {
    return SUMMARY_FIELD_KEYS.filter((field) => fields[field]);
  }

  private isRangeEqual(a: ClientRange, b: ClientRange): boolean {
    return (a.start || '') === (b.start || '') && (a.end || '') === (b.end || '');
  }

  private isTrendEqual(a: ClientTrend, b: ClientTrend): boolean {
    if (a === null && b === null) return true;
    if (!a || !b) return false;
    return a.minutes === b.minutes && a.bucketMinutes === b.bucketMinutes;
  }

  private isDeviceDetailEqual(a: ClientDeviceDetail, b: ClientDeviceDetail): boolean {
    if (a === null && b === null) return true;
    if (!a || !b) return false;
    return a.sourceIP === b.sourceIP && a.limit === b.limit;
  }

  private isProxyDetailEqual(a: ClientProxyDetail, b: ClientProxyDetail): boolean {
    if (a === null && b === null) return true;
    if (!a || !b) return false;
    return a.chain === b.chain && a.limit === b.limit;
  }

  private isRuleDetailEqual(a: ClientRuleDetail, b: ClientRuleDetail): boolean {
    if (a === null && b === null) return true;
    if (!a || !b) return false;
    return a.rule === b.rule && a.limit === b.limit;
  }

  private isDomainsPageEqual(a: ClientDomainsPage, b: ClientDomainsPage): boolean {
    if (a === null && b === null) return true;
    if (!a || !b) return false;
    return (
      a.offset === b.offset &&
      a.limit === b.limit &&
      (a.sortBy || '') === (b.sortBy || '') &&
      (a.sortOrder || '') === (b.sortOrder || '') &&
      (a.search || '') === (b.search || '')
    );
  }

  private isIPsPageEqual(a: ClientIPsPage, b: ClientIPsPage): boolean {
    if (a === null && b === null) return true;
    if (!a || !b) return false;
    return (
      a.offset === b.offset &&
      a.limit === b.limit &&
      (a.sortBy || '') === (b.sortBy || '') &&
      (a.sortOrder || '') === (b.sortOrder || '') &&
      (a.search || '') === (b.search || '')
    );
  }

  private shouldIncludeRealtime(range: ClientRange): boolean {
    if (!range.start && !range.end) {
      return true;
    }
    if (!range.end) {
      return false;
    }

    const endMs = new Date(range.end).getTime();
    if (Number.isNaN(endMs)) {
      return false;
    }

    const toleranceMs = parseInt(process.env.REALTIME_RANGE_END_TOLERANCE_MS || '120000', 10);
    const windowMs = Number.isFinite(toleranceMs) ? Math.max(10_000, toleranceMs) : 120_000;
    return endMs >= Date.now() - windowMs;
  }

  private parsePositiveInt(value: number | undefined): number | null {
    if (value === undefined) return null;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  private parseNonNegativeInt(value: number | undefined): number | null {
    if (value === undefined) return null;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
  }

  private resolveMinutesFromRange(range: ClientRange): number | null {
    if (!range.start || !range.end) return null;
    const startMs = new Date(range.start).getTime();
    const endMs = new Date(range.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return null;
    }
    return Math.max(1, Math.ceil((endMs - startMs) / 60000));
  }

  private parseTrend(
    includeTrend: boolean | undefined,
    trendMinutes: number | undefined,
    trendBucketMinutes: number | undefined,
    range: ClientRange,
  ): ClientTrend | undefined {
    if (includeTrend === false) return null;
    if (
      includeTrend !== true &&
      trendMinutes === undefined &&
      trendBucketMinutes === undefined
    ) {
      return undefined;
    }

    const parsedMinutes = this.parsePositiveInt(trendMinutes);
    const parsedBucket = this.parsePositiveInt(trendBucketMinutes);
    if (trendMinutes !== undefined && parsedMinutes === null) return undefined;
    if (trendBucketMinutes !== undefined && parsedBucket === null) return undefined;

    const fallbackMinutes = this.resolveMinutesFromRange(range) ?? 30;
    const minutes = Math.min(parsedMinutes ?? fallbackMinutes, 30 * 24 * 60);
    const bucketMinutes = Math.min(parsedBucket ?? 1, 24 * 60);

    return {
      minutes,
      bucketMinutes,
    };
  }

  private parseDeviceDetail(
    includeDeviceDetails: boolean | undefined,
    deviceSourceIP: string | undefined,
    deviceDetailLimit: number | undefined,
  ): ClientDeviceDetail | undefined {
    if (includeDeviceDetails === false) return null;
    if (
      includeDeviceDetails !== true &&
      deviceSourceIP === undefined &&
      deviceDetailLimit === undefined
    ) {
      return undefined;
    }

    const sourceIP = (deviceSourceIP || '').trim();
    if (!sourceIP) return undefined;

    const parsedLimit = this.parsePositiveInt(deviceDetailLimit);
    if (deviceDetailLimit !== undefined && parsedLimit === null) {
      return undefined;
    }

    return {
      sourceIP,
      limit: Math.min(parsedLimit ?? 5000, 20000),
    };
  }

  private parseProxyDetail(
    includeProxyDetails: boolean | undefined,
    proxyChain: string | undefined,
    proxyDetailLimit: number | undefined,
  ): ClientProxyDetail | undefined {
    if (includeProxyDetails === false) return null;
    if (
      includeProxyDetails !== true &&
      proxyChain === undefined &&
      proxyDetailLimit === undefined
    ) {
      return undefined;
    }

    const chain = (proxyChain || '').trim();
    if (!chain) return undefined;

    const parsedLimit = this.parsePositiveInt(proxyDetailLimit);
    if (proxyDetailLimit !== undefined && parsedLimit === null) {
      return undefined;
    }

    return {
      chain,
      limit: Math.min(parsedLimit ?? 5000, 20000),
    };
  }

  private parseRuleDetail(
    includeRuleDetails: boolean | undefined,
    ruleName: string | undefined,
    ruleDetailLimit: number | undefined,
  ): ClientRuleDetail | undefined {
    if (includeRuleDetails === false) return null;
    if (
      includeRuleDetails !== true &&
      ruleName === undefined &&
      ruleDetailLimit === undefined
    ) {
      return undefined;
    }

    const rule = (ruleName || '').trim();
    if (!rule) return undefined;

    const parsedLimit = this.parsePositiveInt(ruleDetailLimit);
    if (ruleDetailLimit !== undefined && parsedLimit === null) {
      return undefined;
    }

    return {
      rule,
      limit: Math.min(parsedLimit ?? 5000, 20000),
    };
  }

  private normalizePageSortOrder(sortOrder?: string): 'asc' | 'desc' {
    return sortOrder?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  }

  private normalizeDomainSortBy(sortBy?: string): string {
    const value = (sortBy || '').trim();
    switch (value) {
      case 'domain':
      case 'totalUpload':
      case 'totalTraffic':
      case 'totalConnections':
      case 'lastSeen':
      case 'totalDownload':
        return value;
      default:
        return 'totalDownload';
    }
  }

  private normalizeIPSortBy(sortBy?: string): string {
    const value = (sortBy || '').trim();
    switch (value) {
      case 'ip':
      case 'totalUpload':
      case 'totalTraffic':
      case 'totalConnections':
      case 'lastSeen':
      case 'totalDownload':
        return value;
      default:
        return 'totalDownload';
    }
  }

  private parseDomainsPage(
    includeDomainsPage: boolean | undefined,
    offset: number | undefined,
    limit: number | undefined,
    sortBy: string | undefined,
    sortOrder: string | undefined,
    search: string | undefined,
  ): ClientDomainsPage | undefined {
    if (includeDomainsPage === false) return null;
    if (
      includeDomainsPage !== true &&
      offset === undefined &&
      limit === undefined &&
      sortBy === undefined &&
      sortOrder === undefined &&
      search === undefined
    ) {
      return undefined;
    }

    const parsedOffset = this.parseNonNegativeInt(offset);
    const parsedLimit = this.parsePositiveInt(limit);
    if (offset !== undefined && parsedOffset === null) return undefined;
    if (limit !== undefined && parsedLimit === null) return undefined;

    return {
      offset: parsedOffset ?? 0,
      limit: Math.min(parsedLimit ?? 50, 200),
      sortBy: this.normalizeDomainSortBy(sortBy),
      sortOrder: this.normalizePageSortOrder(sortOrder),
      search: (search || '').trim() || undefined,
    };
  }

  private parseIPsPage(
    includeIPsPage: boolean | undefined,
    offset: number | undefined,
    limit: number | undefined,
    sortBy: string | undefined,
    sortOrder: string | undefined,
    search: string | undefined,
  ): ClientIPsPage | undefined {
    if (includeIPsPage === false) return null;
    if (
      includeIPsPage !== true &&
      offset === undefined &&
      limit === undefined &&
      sortBy === undefined &&
      sortOrder === undefined &&
      search === undefined
    ) {
      return undefined;
    }

    const parsedOffset = this.parseNonNegativeInt(offset);
    const parsedLimit = this.parsePositiveInt(limit);
    if (offset !== undefined && parsedOffset === null) return undefined;
    if (limit !== undefined && parsedLimit === null) return undefined;

    return {
      offset: parsedOffset ?? 0,
      limit: Math.min(parsedLimit ?? 50, 200),
      sortBy: this.normalizeIPSortBy(sortBy),
      sortOrder: this.normalizePageSortOrder(sortOrder),
      search: (search || '').trim() || undefined,
    };
  }

  /** Drop cached persisted summaries of a backend (its realtime deltas were just persisted). */
  invalidateBackendCache(backendId: number): void {
    const prefix = `${backendId}|`;
    for (const key of this.baseSummaryCache.keys()) {
      if (key.startsWith(prefix)) this.baseSummaryCache.delete(key);
    }
  }

  private getBaseSummaryCacheTTL(range: ClientRange): number {
    if (!range.end) return StatsWebSocketServer.BASE_SUMMARY_CACHE_TTL_MS;
    const endMs = new Date(range.end).getTime();
    if (Number.isNaN(endMs)) return StatsWebSocketServer.BASE_SUMMARY_CACHE_TTL_MS;
    const toleranceMs = parseInt(process.env.REALTIME_RANGE_END_TOLERANCE_MS || '120000', 10);
    const windowMs = Number.isFinite(toleranceMs) ? Math.max(10_000, toleranceMs) : 120_000;
    return endMs >= Date.now() - windowMs
      ? StatsWebSocketServer.BASE_SUMMARY_CACHE_TTL_MS
      : StatsWebSocketServer.BASE_SUMMARY_CACHE_TTL_HISTORICAL_MS;
  }

  private resolveBackendId(rawBackendId: number | null): number | null {
    if (rawBackendId !== null) {
      return this.db.getBackend(rawBackendId) ? rawBackendId : null;
    }

    const activeBackend = this.db.getActiveBackend();
    return activeBackend?.id ?? null;
  }

  private async getStatsForBackend(
    backendId: number | null,
    range: ClientRange,
    trend: ClientTrend,
    deviceDetail: ClientDeviceDetail,
    proxyDetail: ClientProxyDetail,
    ruleDetail: ClientRuleDetail,
    includeRuleChainFlow: boolean,
    domainsPage: ClientDomainsPage,
    ipsPage: ClientIPsPage,
    wantsFullSummary = true,
    summaryFields: SummaryFieldMask = DEFAULT_SUMMARY_FIELDS,
  ): Promise<StatsSummary | null> {
    this.wsMetrics.getStatsCalls += 1;
    const resolvedBackendId = this.resolveBackendId(backendId);
    if (resolvedBackendId === null) {
      return null;
    }

    const includeSummaryData = wantsFullSummary && this.hasAnySummaryFields(summaryFields);
    const needsCoreSummary = includeSummaryData && this.needsCoreSummary(summaryFields);

    if (needsCoreSummary) {
      this.wsMetrics.fullSummaryCalls += 1;
    }
    if (trend) this.wsMetrics.trendCalls += 1;
    if (deviceDetail || proxyDetail || ruleDetail || includeRuleChainFlow) {
      this.wsMetrics.detailCalls += 1;
    }
    if (domainsPage || ipsPage) {
      this.wsMetrics.pagedCalls += 1;
    }

    const cacheTTL = this.getBaseSummaryCacheTTL(range);
    const baseCacheKey = `${resolvedBackendId}|${range.start || ''}|${range.end || ''}`;
    let baseCached = this.baseSummaryCache.get(baseCacheKey);
    const baseCacheValid = baseCached && Date.now() - baseCached.ts < cacheTTL;

    if (includeSummaryData) {
      if (baseCacheValid) {
        this.wsMetrics.baseCacheHit += 1;
      } else {
        this.wsMetrics.baseCacheMiss += 1;
      }
    }

    const now = new Date();
    // Default to the year 2000 for "all time" start, and 24 hours into the future for "all time" end
    // This allows ClickHouse to perform a full-range aggregation without failing over to SQLite
    const defaultStart = new Date('2000-01-01T00:00:00.000Z').toISOString();
    const defaultEnd = new Date(now.getTime() + 86400000).toISOString();
    const timeRange = { 
      start: range.start || defaultStart, 
      end: range.end || defaultEnd, 
      active: true 
    };

    if (includeSummaryData) {
      const fetchCore = needsCoreSummary && (!baseCacheValid || baseCached?.summary === undefined);
      const fetchCountry = summaryFields.countryStats && (!baseCacheValid || baseCached?.countryStats === undefined);
      const fetchDevice = summaryFields.deviceStats && (!baseCacheValid || baseCached?.deviceStats === undefined);

      if (fetchCore || fetchCountry || fetchDevice) {
        const [summaryRes, countryStatsRes, deviceStatsRes] = await Promise.all([
          fetchCore
            ? this.statsService.getSummaryWithRouting(resolvedBackendId, timeRange)
            : Promise.resolve(null),
          fetchCountry
            ? this.statsService.getCountryStatsWithRouting(resolvedBackendId, timeRange, 50)
            : Promise.resolve(undefined),
          fetchDevice
            ? this.statsService.getDeviceStatsWithRouting(resolvedBackendId, timeRange, 50)
            : Promise.resolve(undefined),
        ]);

        const nextCached: {
          summary?: {
            totalConnections: number;
            totalUpload: number;
            totalDownload: number;
            uniqueDomains: number;
            uniqueIPs: number;
            totalProxies: number;
            totalRules: number;
          };
          topDomains?: DomainStats[];
          topIPs?: IPStats[];
          proxyStats?: ProxyStats[];
          countryStats?: CountryStats[];
          deviceStats?: DeviceStats[];
          ruleStats?: RuleStats[];
          hourlyStats?: HourlyStats[];
          ts: number;
        } = (baseCacheValid && baseCached) ? { ...baseCached, ts: Date.now() } : { ts: Date.now() };

        if (fetchCore && summaryRes) {
          nextCached.summary = {
            totalConnections: summaryRes.totalConnections,
            totalUpload: summaryRes.totalUpload,
            totalDownload: summaryRes.totalDownload,
            uniqueDomains: summaryRes.totalDomains,
            uniqueIPs: summaryRes.totalIPs,
            totalProxies: summaryRes.totalProxies,
            totalRules: summaryRes.totalRules,
          };
          nextCached.topDomains = summaryRes.topDomains;
          nextCached.topIPs = summaryRes.topIPs;
          nextCached.proxyStats = summaryRes.proxyStats;
          nextCached.ruleStats = summaryRes.ruleStats || [];
          nextCached.hourlyStats = summaryRes.hourlyStats;
        }

        if (fetchCountry) {
          nextCached.countryStats = countryStatsRes;
        }

        if (fetchDevice) {
          nextCached.deviceStats = deviceStatsRes;
        }

        baseCached = nextCached;
        this.baseSummaryCache.set(baseCacheKey, nextCached);
        
        // Only run cache cleanup occasionally, e.g. when creating a new cache entry
        if (!baseCacheValid) {
          for (const [key, val] of this.baseSummaryCache) {
            if (Date.now() - val.ts > cacheTTL * 2) {
              this.baseSummaryCache.delete(key);
            }
          }
          // Hard size cap: many distinct subscription combos can outpace the
          // TTL sweep; drop the oldest entries beyond the cap.
          const MAX_BASE_SUMMARY_ENTRIES = 1000;
          if (this.baseSummaryCache.size > MAX_BASE_SUMMARY_ENTRIES) {
            const sorted = Array.from(this.baseSummaryCache.entries())
              .sort((a, b) => a[1].ts - b[1].ts);
            const excess = this.baseSummaryCache.size - MAX_BASE_SUMMARY_ENTRIES;
            for (let i = 0; i < excess; i++) {
              this.baseSummaryCache.delete(sorted[i][0]);
            }
          }
        }
      }
    }

    const summary = includeSummaryData && summaryFields.totals ? (baseCached?.summary || ZERO_BASE_SUMMARY) : ZERO_BASE_SUMMARY;
    const topDomains = includeSummaryData && summaryFields.topDomains ? (baseCached?.topDomains || []) : [];
    const topIPs = includeSummaryData && summaryFields.topIPs ? (baseCached?.topIPs || []) : [];
    const proxyStats = includeSummaryData && summaryFields.proxyStats ? (baseCached?.proxyStats || []) : [];
    const countryStats = includeSummaryData && summaryFields.countryStats ? baseCached?.countryStats : undefined;
    const deviceStats = includeSummaryData && summaryFields.deviceStats ? baseCached?.deviceStats : undefined;
    const ruleStats = includeSummaryData && summaryFields.ruleStats ? baseCached?.ruleStats : undefined;
    const hourlyStats = includeSummaryData && summaryFields.hourlyStats ? (baseCached?.hourlyStats || []) : [];

    const fetches: Promise<void>[] = [];
    
    let trendStats: any;
    if (trend) fetches.push(this.statsService.getTrafficTrendAggregatedWithRouting(resolvedBackendId, timeRange, trend.minutes, trend.bucketMinutes).then((r: any) => { trendStats = r; }));
    
    let deviceDomains: any;
    if (deviceDetail) fetches.push(this.statsService.getDeviceDomainsWithRouting(resolvedBackendId, deviceDetail.sourceIP, timeRange, deviceDetail.limit).then((r: any) => { deviceDomains = r; }));

    let deviceIPs: any;
    if (deviceDetail) fetches.push(this.statsService.getDeviceIPsWithRouting(resolvedBackendId, deviceDetail.sourceIP, timeRange, deviceDetail.limit).then((r: any) => { deviceIPs = r; }));

    let proxyDomains: any;
    if (proxyDetail) fetches.push(this.statsService.getProxyDomainsWithRouting(resolvedBackendId, proxyDetail.chain, timeRange, proxyDetail.limit).then((r: any) => { proxyDomains = r; }));

    let proxyIPs: any;
    if (proxyDetail) fetches.push(this.statsService.getProxyIPsWithRouting(resolvedBackendId, proxyDetail.chain, timeRange, proxyDetail.limit).then((r: any) => { proxyIPs = r; }));

    let ruleDomains: any;
    if (ruleDetail) fetches.push(this.statsService.getRuleDomainsWithRouting(resolvedBackendId, ruleDetail.rule, timeRange, ruleDetail.limit).then((r: any) => { ruleDomains = r; }));

    let ruleIPs: any;
    if (ruleDetail) fetches.push(this.statsService.getRuleIPsWithRouting(resolvedBackendId, ruleDetail.rule, timeRange, ruleDetail.limit).then((r: any) => { ruleIPs = r; }));

    let ruleChainFlowAll: any;
    if (includeRuleChainFlow) fetches.push(this.statsService.getAllRuleChainFlowsWithRouting(resolvedBackendId, timeRange).then((r: any) => { ruleChainFlowAll = r; }));

    let domainsPageData: any;
    if (domainsPage) fetches.push(this.statsService.getDomainStatsPaginatedWithRouting(resolvedBackendId, timeRange, { offset: domainsPage.offset, limit: domainsPage.limit, sortBy: domainsPage.sortBy, sortOrder: domainsPage.sortOrder, search: domainsPage.search }).then((r: any) => { domainsPageData = r; }));

    let ipsPageData: any;
    if (ipsPage) fetches.push(this.statsService.getIPStatsPaginatedWithRouting(resolvedBackendId, timeRange, { offset: ipsPage.offset, limit: ipsPage.limit, sortBy: ipsPage.sortBy, sortOrder: ipsPage.sortOrder, search: ipsPage.search }).then((r: any) => { ipsPageData = r; }));

    await Promise.all(fetches);

    // Trend data returned by statsService already includes realtime merge when applicable.
    const mergedTrendStats = trendStats;

    return {
      totalUpload: summary.totalUpload,
      totalDownload: summary.totalDownload,
      totalConnections: summary.totalConnections,
      totalDomains: summary.uniqueDomains,
      totalIPs: summary.uniqueIPs,
      totalProxies: summary.totalProxies,
      totalRules: summary.totalRules,
      topDomains,
      topIPs,
      proxyStats,
      countryStats,
      deviceStats,
      deviceDetailSourceIP: deviceDetail?.sourceIP,
      deviceDomains,
      deviceIPs,
      proxyDetailChain: proxyDetail?.chain,
      proxyDomains,
      proxyIPs,
      ruleDetailName: ruleDetail?.rule,
      ruleDomains,
      ruleIPs,
      ruleChainFlowAll,
      domainsPage: domainsPageData,
      domainsPageQuery: domainsPage ? { ...domainsPage } : undefined,
      ipsPage: ipsPageData,
      ipsPageQuery: ipsPage ? { ...ipsPage } : undefined,
      trendStats: mergedTrendStats,
      ruleStats,
      hourlyStats,
    };
  }

  private async sendStatsToClient(ws: WebSocket) {
    if (ws.readyState !== WebSocket.OPEN) return;

    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return;

    try {
      const stats = await this.getStatsForBackend(
        clientInfo.backendId,
        clientInfo.range,
        clientInfo.trend,
        clientInfo.deviceDetail,
        clientInfo.proxyDetail,
        clientInfo.ruleDetail,
        clientInfo.includeRuleChainFlow,
        clientInfo.domainsPage,
        clientInfo.ipsPage,
        clientInfo.includeSummary,
        clientInfo.summaryFields,
      );

      if (!stats) return;

      const message: WebSocketMessage = {
        type: 'stats',
        backendId: this.resolveBackendId(clientInfo.backendId) ?? clientInfo.backendId ?? undefined,
        summaryFields: clientInfo.includeSummary
          ? this.buildSummaryFieldList(clientInfo.summaryFields)
          : undefined,
        data: stats,
        timestamp: new Date().toISOString(),
      };
      // Pre-serialize to avoid repeated JSON.stringify if same payload is reused
      ws.send(JSON.stringify(message));
      clientInfo.lastSentAt = Date.now();
    } catch (err) {
      console.error('[WebSocket] Error sending stats:', err);
    }
  }

  // Broadcast stats snapshot to subscribed clients.
  broadcastStats(changedBackendId?: number, force = false) {
    void this.broadcastStatsInternal(changedBackendId, force);
  }

  private async broadcastStatsInternal(changedBackendId?: number, force = false): Promise<void> {
    const now = Date.now();

    if (!force && now - this.lastBroadcastTime < this.broadcastThrottleMs) {
      return;
    }
    this.lastBroadcastTime = now;

    if (this.clients.size === 0) return;

    this.wsMetrics.broadcastCalls += 1;

    let sentCount = 0;
    // Cache serialized JSON per unique query combo to avoid repeated stats fetch + JSON.stringify
    const jsonCache = new Map<string, Promise<string | null>>();
    const ts = new Date().toISOString();

    // Phase 1: start the stats fetch for every eligible client up front so
    // unique query combos resolve concurrently instead of serially awaiting
    // one combo per client.
    const pendingSends: Array<{ ws: WebSocket; clientInfo: ClientInfo; json: Promise<string | null> }> = [];

    for (const [ws, clientInfo] of this.clients) {
      try {
        if (ws.readyState !== WebSocket.OPEN) continue;

        if (!force && clientInfo.minPushIntervalMs > 0) {
          const elapsed = now - clientInfo.lastSentAt;
          if (elapsed < clientInfo.minPushIntervalMs) {
            continue;
          }
        }

        const resolvedBackendId = this.resolveBackendId(clientInfo.backendId);
        if (resolvedBackendId === null) continue;

        if (changedBackendId !== undefined && resolvedBackendId !== changedBackendId) {
          continue;
        }

        const trendKey = clientInfo.trend
          ? `${clientInfo.trend.minutes}|${clientInfo.trend.bucketMinutes}`
          : '';
        const includeSummaryKey = clientInfo.includeSummary ? '1' : '0';
        const summaryFieldsKey = clientInfo.includeSummary
          ? this.buildSummaryFieldsKey(clientInfo.summaryFields)
          : 'none';
        const deviceDetailKey = clientInfo.deviceDetail
          ? `${clientInfo.deviceDetail.sourceIP}|${clientInfo.deviceDetail.limit}`
          : '';
        const proxyDetailKey = clientInfo.proxyDetail
          ? `${clientInfo.proxyDetail.chain}|${clientInfo.proxyDetail.limit}`
          : '';
        const ruleDetailKey = clientInfo.ruleDetail
          ? `${clientInfo.ruleDetail.rule}|${clientInfo.ruleDetail.limit}`
          : '';
        const ruleChainFlowKey = clientInfo.includeRuleChainFlow ? '1' : '0';
        const domainsPageKey = clientInfo.domainsPage
          ? `${clientInfo.domainsPage.offset}|${clientInfo.domainsPage.limit}|${clientInfo.domainsPage.sortBy || ''}|${clientInfo.domainsPage.sortOrder || ''}|${clientInfo.domainsPage.search || ''}`
          : '';
        const ipsPageKey = clientInfo.ipsPage
          ? `${clientInfo.ipsPage.offset}|${clientInfo.ipsPage.limit}|${clientInfo.ipsPage.sortBy || ''}|${clientInfo.ipsPage.sortOrder || ''}|${clientInfo.ipsPage.search || ''}`
          : '';
        const cacheKey = `${resolvedBackendId}|${clientInfo.range.start || ''}|${clientInfo.range.end || ''}|${includeSummaryKey}|${summaryFieldsKey}|${trendKey}|${deviceDetailKey}|${proxyDetailKey}|${ruleDetailKey}|${ruleChainFlowKey}|${domainsPageKey}|${ipsPageKey}`;
        if (!jsonCache.has(cacheKey)) {
          jsonCache.set(
            cacheKey,
            this.getStatsForBackend(
              resolvedBackendId,
              clientInfo.range,
              clientInfo.trend,
              clientInfo.deviceDetail,
              clientInfo.proxyDetail,
              clientInfo.ruleDetail,
              clientInfo.includeRuleChainFlow,
              clientInfo.domainsPage,
              clientInfo.ipsPage,
              clientInfo.includeSummary,
              clientInfo.summaryFields,
            ).then((stats) => (
              stats
                ? JSON.stringify({
                  type: 'stats',
                  backendId: resolvedBackendId,
                  summaryFields: clientInfo.includeSummary
                    ? this.buildSummaryFieldList(clientInfo.summaryFields)
                    : undefined,
                  data: stats,
                  timestamp: ts,
                })
                : null
            )).catch((err) => {
              console.error('[WebSocket] Error building broadcast payload:', err);
              return null;
            }),
          );
        }

        pendingSends.push({ ws, clientInfo, json: jsonCache.get(cacheKey)! });
      } catch (err) {
        console.error('[WebSocket] Error preparing broadcast for client:', err);
      }
    }

    // Phase 2: await each payload (already resolving concurrently) and send.
    for (const { ws, clientInfo, json: jsonPromise } of pendingSends) {
      try {
        const json = await jsonPromise;
        if (!json) continue;
        if (ws.readyState !== WebSocket.OPEN) continue;

        if (ws.bufferedAmount > this.maxBufferedBytes) {
          // Client isn't draining; skip this round (lastSentAt untouched, so
          // it gets the next broadcast once the buffer clears).
          this.wsMetrics.backpressureSkips += 1;
          continue;
        }

        ws.send(json);
        clientInfo.lastSentAt = now;
        sentCount++;
      } catch (err) {
        console.error('[WebSocket] Error sending to client:', err);
        // Drop clients whose socket is no longer usable so they don't
        // accumulate and get re-broadcast forever if 'close' never fires.
        if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
          this.clients.delete(ws);
        }
      }
    }

    if (sentCount > 0) {
      this.wsMetrics.broadcastSentClients += sentCount;
      this.maybeLogWsMetrics();
      // Broadcast log removed to reduce noise in production
    }
  }

  private maybeLogWsMetrics(): void {
    if (this.wsMetricsLogIntervalMs <= 0) {
      return;
    }
    const now = Date.now();
    const elapsedMs = now - this.wsMetricsWindowStartedAt;
    if (elapsedMs < this.wsMetricsLogIntervalMs) {
      return;
    }

    const elapsedSec = Math.max(1, elapsedMs / 1000);
    const getStatsQps = this.wsMetrics.getStatsCalls / elapsedSec;
    const subscribeQps = this.wsMetrics.subscribeTotal / elapsedSec;
    const cacheTotal = this.wsMetrics.baseCacheHit + this.wsMetrics.baseCacheMiss;
    const cacheHitRate = cacheTotal > 0
      ? (this.wsMetrics.baseCacheHit / cacheTotal) * 100
      : 0;

    console.info(
      `[WebSocket Metrics] subscribe_total=${this.wsMetrics.subscribeTotal} subscribe_changed=${this.wsMetrics.subscribeChanged} subscribe_noop=${this.wsMetrics.subscribeNoop} subscribe_qps=${subscribeQps.toFixed(2)} get_stats_calls=${this.wsMetrics.getStatsCalls} get_stats_qps=${getStatsQps.toFixed(2)} full_summary_calls=${this.wsMetrics.fullSummaryCalls} base_cache_hit=${this.wsMetrics.baseCacheHit} base_cache_miss=${this.wsMetrics.baseCacheMiss} base_cache_hit_rate=${cacheHitRate.toFixed(1)}% trend_calls=${this.wsMetrics.trendCalls} detail_calls=${this.wsMetrics.detailCalls} paged_calls=${this.wsMetrics.pagedCalls} broadcast_calls=${this.wsMetrics.broadcastCalls} broadcast_sent_clients=${this.wsMetrics.broadcastSentClients} backpressure_skips=${this.wsMetrics.backpressureSkips} window_sec=${elapsedSec.toFixed(1)}`,
    );

    this.wsMetricsWindowStartedAt = now;
    this.wsMetrics = {
      subscribeTotal: 0,
      subscribeChanged: 0,
      subscribeNoop: 0,
      getStatsCalls: 0,
      fullSummaryCalls: 0,
      baseCacheHit: 0,
      baseCacheMiss: 0,
      trendCalls: 0,
      detailCalls: 0,
      pagedCalls: 0,
      broadcastCalls: 0,
      broadcastSentClients: 0,
      backpressureSkips: 0,
    };
  }

  getClientCount(): number {
    return this.clients.size;
  }

  clearBackendCache(backendId: number): void {
    const cachePrefix = `${backendId}|`;
    for (const key of this.baseSummaryCache.keys()) {
      if (key.startsWith(cachePrefix)) {
        this.baseSummaryCache.delete(key);
      }
    }
  }

  stop() {
    this.clients.forEach((info) => info.ws.close());
    this.clients.clear();
    this.wss?.close();
    console.log('[WebSocket] Server stopped');
  }
}
