import type {
  StatsSummary,
  DomainStats,
  IPStats,
  ProxyStats,
  RuleStats,
  CountryStats,
  TrafficTrendPoint,
  ProxyTrafficStats,
  DeviceStats,
} from "@neko-master/shared";
import { getAuthHeaders } from "./auth-queries";

type RuntimeConfig = {
  API_URL?: string;
};

function getRuntimeConfig(): RuntimeConfig | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as any).__RUNTIME_CONFIG__ as RuntimeConfig | undefined;
}

function normalizeApiBase(url: string): string {
  if (!url) return "/api";
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function resolveApiBase(): string {
  const runtime = getRuntimeConfig();
  if (runtime?.API_URL) {
    return normalizeApiBase(runtime.API_URL);
  }
  const envUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL;
  if (envUrl) {
    return normalizeApiBase(envUrl);
  }
  return "/api";
}

import { ApiError } from "./api-error";

const API_BASE = resolveApiBase();
const DETAIL_FETCH_LIMIT = 5000;
const inflightGetRequests = new Map<string, Promise<unknown>>();

function isApiStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}



async function fetchJson<T>(
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  if (method === "GET") {
    const inflight = inflightGetRequests.get(url);
    if (inflight) {
      return inflight as Promise<T>;
    }
  }

  const options: RequestInit = {
    method,
    headers: {
      ...getAuthHeaders(),
    },
  };

  // Only set Content-Type when there's a body
  if (body && method !== 'GET') {
    options.headers = {
      ...options.headers,
      'Content-Type': 'application/json',
    };
    options.body = JSON.stringify(body);
  }

  const requestPromise = (async () => {
    const res = await fetch(url, options);
    if (!res.ok) {
      // If 401, dispatch an event to notify auth system
      if (res.status === 401) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("api:unauthorized"));
        }
      }
      throw new ApiError(`API Error ${res.status}: ${url}`, res.status, { url });
    }
    return await res.json() as T;
  })();

  if (method === "GET") {
    inflightGetRequests.set(url, requestPromise as Promise<unknown>);
  }

  try {
    return await requestPromise;
  } finally {
    if (method === "GET") {
      inflightGetRequests.delete(url);
    }
  }
}

export interface TimeRange {
  start: string;
  end: string;
}

export interface BackendHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastChecked: number;
  message?: string;
  latency?: number;
  serverLatency?: number;
}

export interface BackendHealthPoint {
  time: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  latency_ms: number | null;
  server_latency_ms: number | null;
  message: string | null;
}

export interface BackendHealthHistory {
  backendId: number;
  backendName: string;
  points: BackendHealthPoint[];
}

export interface Backend {
  id: number;
  name: string;
  url: string;
  token: string;
  type?: 'clash' | 'surge';
  enabled: boolean;
  is_active: boolean;
  listening: boolean;
  hasToken?: boolean;
  health?: BackendHealth;
  created_at: string;
  updated_at: string;
}

export interface GatewayProviderProxy {
  alive: boolean;
  name: string;
  type: string;
  now?: string;
  all?: string[];
  history?: Array<{ time: string; delay: number }>;
}

export interface GatewayProvider {
  name: string;
  type: string;
  vehicleType: string;
  proxies: GatewayProviderProxy[];
}

export interface GatewayProxiesResponse {
  proxies: Record<string, GatewayProviderProxy>;
}

export interface GatewayProvidersResponse {
  providers: Record<string, GatewayProvider>;
}

export interface GatewayRule {
  type: string;
  payload: string;
  proxy: string;
  size?: number;
  raw?: string;
}

export interface GatewayRulesResponse {
  rules: GatewayRule[];
  // Surge specific fields
  _source?: 'surge' | 'clash' | 'agent-cache';
  _availablePolicies?: string[];
}

export type GeoLookupProvider = "online" | "local";

export interface GeoLookupConfig {
  provider: GeoLookupProvider;
  configuredProvider: GeoLookupProvider;
  effectiveProvider: GeoLookupProvider;
  mmdbDir: string;
  onlineApiUrl: string;
  localMmdbReady: boolean;
  missingMmdbFiles: string[];
}

const DEFAULT_DB_STATS = {
  size: 0,
  sqliteSize: 0,
  clickhouseSize: 0,
  totalConnectionsCount: 0,
} as const;

const DEFAULT_RETENTION_CONFIG = {
  connectionLogsDays: 7,
  hourlyStatsDays: 30,
  autoCleanup: true,
} as const;

const DEFAULT_GEO_LOOKUP_CONFIG: GeoLookupConfig = {
  provider: "online",
  configuredProvider: "online",
  effectiveProvider: "online",
  mmdbDir: "geoip",
  onlineApiUrl: "https://api.ipinfo.es/ipinfo",
  localMmdbReady: false,
  missingMmdbFiles: [],
};

function buildUrl(base: string, params: Record<string, string | number | undefined>): string {
  // Use simple URL construction for client-side relative URLs
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `${base}?${query}` : base;
}

export const api = {
  // Stats APIs with optional backendId parameter
  getSummary: (backendId?: number, range?: TimeRange) => 
    fetchJson<StatsSummary & { backend: { id: number; name: string; isActive: boolean; listening: boolean } }>(
      buildUrl(`${API_BASE}/stats/summary`, {
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),
  
  getDomains: (backendId?: number, opts?: {
    offset?: number; limit?: number;
    sortBy?: string; sortOrder?: string; search?: string;
    start?: string; end?: string;
  }) =>
    fetchJson<{ data: DomainStats[]; total: number }>(
      buildUrl(`${API_BASE}/stats/domains`, { backendId, ...opts })
    ),

  getIPs: (backendId?: number, opts?: {
    offset?: number; limit?: number;
    sortBy?: string; sortOrder?: string; search?: string;
    start?: string; end?: string;
  }) =>
    fetchJson<{ data: IPStats[]; total: number }>(
      buildUrl(`${API_BASE}/stats/ips`, { backendId, ...opts })
    ),
    
  getProxies: (backendId?: number, limit = 50, range?: TimeRange) =>
    fetchJson<ProxyStats[]>(buildUrl(`${API_BASE}/stats/proxies`, {
      backendId,
      limit,
      start: range?.start,
      end: range?.end,
    })),
    
  getRules: (backendId?: number, limit = 50, range?: TimeRange) =>
    fetchJson<RuleStats[]>(buildUrl(`${API_BASE}/stats/rules`, {
      backendId,
      limit,
      start: range?.start,
      end: range?.end,
    })),
    
  getCountries: (backendId?: number, limit = 50, range?: TimeRange) =>
    fetchJson<CountryStats[]>(buildUrl(`${API_BASE}/stats/countries`, {
      backendId,
      limit,
      start: range?.start,
      end: range?.end,
    })),
    
  getTrafficTrendAggregated: (backendId?: number, minutes = 30, bucketMinutes = 1, range?: TimeRange, tzOffsetMinutes?: number) =>
    fetchJson<TrafficTrendPoint[]>(
      buildUrl(`${API_BASE}/stats/trend/aggregated`, {
        backendId,
        minutes,
        bucketMinutes,
        tzOffsetMinutes: bucketMinutes >= 1440 ? tzOffsetMinutes : undefined,
        start: range?.start,
        end: range?.end,
      })
    ),
    
  getDomainProxyStats: (
    domain: string,
    backendId?: number,
    range?: TimeRange,
    sourceIP?: string,
    sourceChain?: string,
  ) =>
    fetchJson<ProxyTrafficStats[]>(
      buildUrl(`${API_BASE}/stats/domains/proxy-stats`, {
        domain,
        backendId,
        start: range?.start,
        end: range?.end,
        sourceIP,
        sourceChain,
      })
    ),

  getDomainIPDetails: (
    domain: string,
    backendId?: number,
    range?: TimeRange,
    sourceIP?: string,
    sourceChain?: string,
  ) =>
    fetchJson<IPStats[]>(
      buildUrl(`${API_BASE}/stats/domains/ip-details`, {
        domain,
        backendId,
        start: range?.start,
        end: range?.end,
        sourceIP,
        sourceChain,
      })
    ),

  getIPProxyStats: (
    ip: string,
    backendId?: number,
    range?: TimeRange,
    sourceIP?: string,
    sourceChain?: string,
  ) =>
    fetchJson<ProxyTrafficStats[]>(
      buildUrl(`${API_BASE}/stats/ips/proxy-stats`, {
        ip,
        backendId,
        start: range?.start,
        end: range?.end,
        sourceIP,
        sourceChain,
      })
    ),

  getIPDomainDetails: (
    ip: string,
    backendId?: number,
    range?: TimeRange,
    sourceIP?: string,
    limit = DETAIL_FETCH_LIMIT,
    sourceChain?: string,
  ) =>
    fetchJson<DomainStats[]>(
      buildUrl(`${API_BASE}/stats/ips/domain-details`, {
        ip,
        limit,
        backendId,
        start: range?.start,
        end: range?.end,
        sourceIP,
        sourceChain,
      })
    ),

  getProxyDomains: (chain: string, backendId?: number, range?: TimeRange, limit = DETAIL_FETCH_LIMIT) =>
    fetchJson<DomainStats[]>(
      buildUrl(`${API_BASE}/stats/proxies/domains`, {
        chain,
        limit,
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  getProxyIPs: (chain: string, backendId?: number, range?: TimeRange, limit = DETAIL_FETCH_LIMIT) =>
    fetchJson<IPStats[]>(
      buildUrl(`${API_BASE}/stats/proxies/ips`, {
        chain,
        limit,
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  // Device stats APIs
  getDevices: (backendId?: number, limit = 50, range?: TimeRange) =>
    fetchJson<DeviceStats[]>(
      buildUrl(`${API_BASE}/stats/devices`, { backendId, limit, start: range?.start, end: range?.end })
    ),

  getDeviceDomains: (sourceIP: string, backendId?: number, range?: TimeRange, limit = DETAIL_FETCH_LIMIT) =>
    fetchJson<DomainStats[]>(
      buildUrl(`${API_BASE}/stats/devices/domains`, {
        sourceIP,
        limit,
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  getDeviceIPs: (sourceIP: string, backendId?: number, range?: TimeRange, limit = DETAIL_FETCH_LIMIT) =>
    fetchJson<IPStats[]>(
      buildUrl(`${API_BASE}/stats/devices/ips`, {
        sourceIP,
        limit,
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  getRuleDomains: (rule: string, backendId?: number, range?: TimeRange, limit = DETAIL_FETCH_LIMIT) =>
    fetchJson<DomainStats[]>(
      buildUrl(`${API_BASE}/stats/rules/domains`, {
        rule,
        limit,
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  getRuleIPs: (rule: string, backendId?: number, range?: TimeRange, limit = DETAIL_FETCH_LIMIT) =>
    fetchJson<IPStats[]>(
      buildUrl(`${API_BASE}/stats/rules/ips`, {
        rule,
        limit,
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  getRuleDomainProxyStats: (
    rule: string,
    domain: string,
    backendId?: number,
    range?: TimeRange,
  ) =>
    fetchJson<ProxyTrafficStats[]>(
      buildUrl(`${API_BASE}/stats/rules/domains/proxy-stats`, {
        rule,
        domain,
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  getRuleDomainIPDetails: (
    rule: string,
    domain: string,
    backendId?: number,
    range?: TimeRange,
    limit = DETAIL_FETCH_LIMIT,
  ) =>
    fetchJson<IPStats[]>(
      buildUrl(`${API_BASE}/stats/rules/domains/ip-details`, {
        rule,
        domain,
        limit,
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  getRuleIPProxyStats: (
    rule: string,
    ip: string,
    backendId?: number,
    range?: TimeRange,
  ) =>
    fetchJson<ProxyTrafficStats[]>(
      buildUrl(`${API_BASE}/stats/rules/ips/proxy-stats`, {
        rule,
        ip,
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  getRuleIPDomainDetails: (
    rule: string,
    ip: string,
    backendId?: number,
    range?: TimeRange,
    limit = DETAIL_FETCH_LIMIT,
  ) =>
    fetchJson<DomainStats[]>(
      buildUrl(`${API_BASE}/stats/rules/ips/domain-details`, {
        rule,
        ip,
        limit,
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  getAllRuleChainFlows: (backendId?: number, range?: TimeRange) =>
    fetchJson<{
      nodes: Array<{ name: string; layer: number; nodeType: 'rule' | 'group' | 'proxy'; totalUpload: number; totalDownload: number; totalConnections: number; rules: string[] }>;
      links: Array<{ source: number; target: number; rules: string[] }>;
      rulePaths: Record<string, { nodeIndices: number[]; linkIndices: number[] }>;
      maxLayer: number;
    }>(
      buildUrl(`${API_BASE}/stats/rules/chain-flow-all`, {
        backendId,
        start: range?.start,
        end: range?.end,
      })
    ),

  getGatewayProviders: (backendId?: number) =>
    fetchJson<GatewayProvidersResponse>(buildUrl(`${API_BASE}/gateway/providers/proxies`, { backendId })),

  getGatewayRules: (backendId?: number) =>
    fetchJson<GatewayRulesResponse>(buildUrl(`${API_BASE}/gateway/rules`, { backendId })),

  getGatewayProxies: (backendId?: number) =>
    fetchJson<GatewayProxiesResponse>(buildUrl(`${API_BASE}/gateway/proxies`, { backendId })),
    
  // Backend management
  getBackends: () =>
    fetchJson<Backend[]>(`${API_BASE}/backends`),
    
  createBackend: (backend: { name: string; url: string; token?: string; type?: 'clash' | 'surge' }) =>
    fetchJson<{ id: number; isActive?: boolean; message: string; agentToken?: string }>(`${API_BASE}/backends`, 'POST', backend),
    
  updateBackend: (id: number, backend: { name?: string; url?: string; token?: string; type?: 'clash' | 'surge'; enabled?: boolean; listening?: boolean }) =>
    fetchJson<{ message: string }>(`${API_BASE}/backends/${id}`, 'PUT', backend),
    
  deleteBackend: (id: number) =>
    fetchJson<{ message: string }>(`${API_BASE}/backends/${id}`, 'DELETE'),
    
  setActiveBackend: (id: number) =>
    fetchJson<{ message: string }>(`${API_BASE}/backends/${id}/activate`, 'POST', {}),

  setBackendListening: (id: number, listening: boolean) =>
    fetchJson<{ message: string }>(`${API_BASE}/backends/${id}/listening`, 'POST', { listening }),

  clearBackendData: (id: number) =>
    fetchJson<{ message: string }>(`${API_BASE}/backends/${id}/clear-data`, 'POST'),
    
  testBackend: (url: string, token?: string, type?: 'clash' | 'surge') =>
    fetchJson<{ success: boolean; message: string }>(`${API_BASE}/backends/test`, 'POST', { url, token, type }),

  testBackendById: (id: number) =>
    fetchJson<{ success: boolean; message: string }>(`${API_BASE}/backends/${id}/test`, 'POST'),

  rotateAgentToken: (id: number) =>
    fetchJson<{ message: string; agentToken: string }>(`${API_BASE}/backends/${id}/rotate-agent-token`, 'POST'),

  getBackendHealthHistory: (opts?: { from?: string; to?: string; backendId?: number }) =>
    fetchJson<BackendHealthHistory[]>(
      buildUrl(`${API_BASE}/backends/health/history`, {
        from: opts?.from,
        to: opts?.to,
        backendId: opts?.backendId,
      })
    ),
    
  // Database management
  getDbStats: async () => {
    try {
      return await fetchJson<{
        size: number;
        sqliteSize: number;
        clickhouseSize: number;
        totalConnectionsCount: number;
      }>(`${API_BASE}/db/stats`);
    } catch (error) {
      if (isApiStatus(error, 404)) {
        return { ...DEFAULT_DB_STATS };
      }
      throw error;
    }
  },
    
  clearLogs: (days: number, backendId?: number) =>
    fetchJson<{ message: string; deleted: number }>(`${API_BASE}/db/cleanup`, 'POST', { days, backendId }),

  getRetentionConfig: async () => {
    try {
      return await fetchJson<{ connectionLogsDays: number; hourlyStatsDays: number; autoCleanup: boolean }>(
        `${API_BASE}/db/retention`
      );
    } catch (error) {
      if (isApiStatus(error, 404)) {
        return { ...DEFAULT_RETENTION_CONFIG };
      }
      throw error;
    }
  },

  updateRetentionConfig: (config: { connectionLogsDays: number; hourlyStatsDays: number; autoCleanup?: boolean }) =>
    fetchJson<{ message: string }>(`${API_BASE}/db/retention`, 'PUT', config),

  getGeoLookupConfig: async () => {
    try {
      return await fetchJson<GeoLookupConfig>(`${API_BASE}/db/geoip`);
    } catch (error) {
      if (isApiStatus(error, 404)) {
        return { ...DEFAULT_GEO_LOOKUP_CONFIG };
      }
      throw error;
    }
  },

  updateGeoLookupConfig: (
    config: { provider?: GeoLookupProvider; onlineApiUrl?: string },
  ) =>
    fetchJson<{ message: string; config: GeoLookupConfig }>(`${API_BASE}/db/geoip`, 'PUT', config),

  // Auth management
  getAuthState: () =>
    fetchJson<{ enabled: boolean; hasToken: boolean }>(`${API_BASE}/auth/state`),

  enableAuth: (token: string) =>
    fetchJson<{ success: boolean; message: string }>(`${API_BASE}/auth/enable`, 'POST', { token }),

  disableAuth: (token?: string) =>
    fetchJson<{ success: boolean; message: string }>(`${API_BASE}/auth/disable`, 'POST', token ? { token } : undefined),

  verifyAuth: (token: string) =>
    fetchJson<{ valid: boolean; message?: string }>(`${API_BASE}/auth/verify`, 'POST', { token }),

  updateToken: (currentToken: string, newToken: string) =>
    fetchJson<{ success: boolean; message: string }>(`${API_BASE}/auth/token`, 'PUT', { currentToken, newToken }),
};

// Helper functions for time range
export function getPresetTimeRange(
  preset: "1m" | "5m" | "15m" | "30m" | "1h" | "7d" | "30d" | "24h" | "today",
): TimeRange {
  const now = new Date();
  const end = new Date(now);
  end.setMilliseconds(0);
  end.setSeconds(0); // Truncate to minute to align with backend health log interval
  
  // Helper to get start of today in local time
  const getStartOfToday = () => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  
  let start: Date;
  
  switch (preset) {
    case "1m":
      start = new Date(end);
      start.setMinutes(start.getMinutes() - 1);
      break;
    case "5m":
      start = new Date(end);
      start.setMinutes(start.getMinutes() - 5);
      break;
    case "15m":
      start = new Date(end);
      start.setMinutes(start.getMinutes() - 15);
      break;
    case "30m":
      start = new Date(end);
      start.setMinutes(start.getMinutes() - 30);
      break;
    case "1h":
      start = new Date(end);
      start.setHours(start.getHours() - 1);
      break;
    case '7d':
      start = new Date(end);
      start.setDate(start.getDate() - 7);
      break;
    case '30d':
      start = new Date(end);
      start.setDate(start.getDate() - 30);
      break;
    case '24h':
      start = new Date(end);
      start.setHours(start.getHours() - 24);
      break;
    case 'today':
      start = getStartOfToday();
      break;
    default:
      start = new Date(end);
      start.setHours(start.getHours() - 24);
  }
  
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function formatDateTimeForInput(date: Date): string {
  return date.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
}

export function formatDateTimeDisplay(isoString: string, locale?: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
