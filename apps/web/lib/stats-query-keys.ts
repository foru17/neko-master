import type { TimeRange } from "@/lib/api";

type PaginatedQueryParams = {
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
};

function normalizeRange(range?: TimeRange) {
  return {
    start: range?.start ?? "",
    end: range?.end ?? "",
  };
}

export function getSummaryQueryKey(backendId?: number, range?: TimeRange) {
  return [
    "stats",
    "summary",
    {
      backendId: backendId ?? null,
      ...normalizeRange(range),
    },
  ] as const;
}

export function getCountriesQueryKey(backendId?: number, limit = 50, range?: TimeRange) {
  return [
    "stats",
    "countries",
    {
      backendId: backendId ?? null,
      limit,
      ...normalizeRange(range),
    },
  ] as const;
}

export function getDevicesQueryKey(backendId?: number, limit = 50, range?: TimeRange) {
  return [
    "stats",
    "devices",
    {
      backendId: backendId ?? null,
      limit,
      ...normalizeRange(range),
    },
  ] as const;
}

export function getProxiesQueryKey(backendId?: number, limit = 50, range?: TimeRange) {
  return [
    "stats",
    "proxies",
    {
      backendId: backendId ?? null,
      limit,
      ...normalizeRange(range),
    },
  ] as const;
}

export function getRulesQueryKey(backendId?: number, limit = 50, range?: TimeRange) {
  return [
    "stats",
    "rules",
    {
      backendId: backendId ?? null,
      limit,
      ...normalizeRange(range),
    },
  ] as const;
}

export function getTrafficTrendQueryKey(
  backendId?: number,
  minutes = 30,
  bucketMinutes = 1,
  range?: TimeRange,
  tzOffsetMinutes?: number,
) {
  return [
    "stats",
    "traffic-trend",
    {
      backendId: backendId ?? null,
      minutes,
      bucketMinutes,
      tzOffsetMinutes: bucketMinutes >= 1440 ? (tzOffsetMinutes ?? 0) : 0,
      ...normalizeRange(range),
    },
  ] as const;
}

type DetailScope = {
  sourceIP?: string;
  sourceChain?: string;
  rule?: string;
};

export function getDomainProxyStatsQueryKey(
  domain: string | null,
  backendId?: number,
  range?: TimeRange,
  scope?: DetailScope,
) {
  return [
    "stats",
    "domain-proxy-stats",
    {
      domain: domain ?? "",
      backendId: backendId ?? null,
      sourceIP: scope?.sourceIP ?? "",
      sourceChain: scope?.sourceChain ?? "",
      rule: scope?.rule ?? "",
      ...normalizeRange(range),
    },
  ] as const;
}

export function getDomainIPDetailsQueryKey(
  domain: string | null,
  backendId?: number,
  range?: TimeRange,
  scope?: DetailScope,
) {
  return [
    "stats",
    "domain-ip-details",
    {
      domain: domain ?? "",
      backendId: backendId ?? null,
      sourceIP: scope?.sourceIP ?? "",
      sourceChain: scope?.sourceChain ?? "",
      rule: scope?.rule ?? "",
      ...normalizeRange(range),
    },
  ] as const;
}

export function getIPProxyStatsQueryKey(
  ip: string | null,
  backendId?: number,
  range?: TimeRange,
  scope?: DetailScope,
) {
  return [
    "stats",
    "ip-proxy-stats",
    {
      ip: ip ?? "",
      backendId: backendId ?? null,
      sourceIP: scope?.sourceIP ?? "",
      sourceChain: scope?.sourceChain ?? "",
      rule: scope?.rule ?? "",
      ...normalizeRange(range),
    },
  ] as const;
}

export function getIPDomainDetailsQueryKey(
  ip: string | null,
  backendId?: number,
  range?: TimeRange,
  scope?: DetailScope,
) {
  return [
    "stats",
    "ip-domain-details",
    {
      ip: ip ?? "",
      backendId: backendId ?? null,
      sourceIP: scope?.sourceIP ?? "",
      sourceChain: scope?.sourceChain ?? "",
      rule: scope?.rule ?? "",
      ...normalizeRange(range),
    },
  ] as const;
}

export function getDomainsQueryKey(
  backendId?: number,
  params?: PaginatedQueryParams,
  range?: TimeRange,
) {
  return [
    "stats",
    "domains",
    {
      backendId: backendId ?? null,
      offset: params?.offset ?? 0,
      limit: params?.limit ?? 10,
      sortBy: params?.sortBy ?? "totalDownload",
      sortOrder: params?.sortOrder ?? "desc",
      search: params?.search ?? "",
      ...normalizeRange(range),
    },
  ] as const;
}

export function getIPsQueryKey(
  backendId?: number,
  params?: PaginatedQueryParams,
  range?: TimeRange,
) {
  return [
    "stats",
    "ips",
    {
      backendId: backendId ?? null,
      offset: params?.offset ?? 0,
      limit: params?.limit ?? 10,
      sortBy: params?.sortBy ?? "totalDownload",
      sortOrder: params?.sortOrder ?? "desc",
      search: params?.search ?? "",
      ...normalizeRange(range),
    },
  ] as const;
}

export function getProxyDomainsQueryKey(
  chain: string | null,
  backendId?: number,
  range?: TimeRange,
) {
  return [
    "stats",
    "proxy-domains",
    {
      chain: chain ?? "",
      backendId: backendId ?? null,
      ...normalizeRange(range),
    },
  ] as const;
}

export function getProxyIPsQueryKey(
  chain: string | null,
  backendId?: number,
  range?: TimeRange,
) {
  return [
    "stats",
    "proxy-ips",
    {
      chain: chain ?? "",
      backendId: backendId ?? null,
      ...normalizeRange(range),
    },
  ] as const;
}

export function getDeviceDomainsQueryKey(
  sourceIP: string | null,
  backendId?: number,
  range?: TimeRange,
) {
  return [
    "stats",
    "device-domains",
    {
      sourceIP: sourceIP ?? "",
      backendId: backendId ?? null,
      ...normalizeRange(range),
    },
  ] as const;
}

export function getDeviceIPsQueryKey(
  sourceIP: string | null,
  backendId?: number,
  range?: TimeRange,
) {
  return [
    "stats",
    "device-ips",
    {
      sourceIP: sourceIP ?? "",
      backendId: backendId ?? null,
      ...normalizeRange(range),
    },
  ] as const;
}

export function getRuleDomainsQueryKey(
  rule: string | null,
  backendId?: number,
  range?: TimeRange,
) {
  return [
    "stats",
    "rule-domains",
    {
      rule: rule ?? "",
      backendId: backendId ?? null,
      ...normalizeRange(range),
    },
  ] as const;
}

export function getRuleIPsQueryKey(
  rule: string | null,
  backendId?: number,
  range?: TimeRange,
) {
  return [
    "stats",
    "rule-ips",
    {
      rule: rule ?? "",
      backendId: backendId ?? null,
      ...normalizeRange(range),
    },
  ] as const;
}
