import type {
  CountryStats,
  DeviceStats,
  DomainStats,
  IPStats,
  ProxyStats,
  RuleStats,
  StatsSummary,
  TrafficTrendPoint,
} from '@neko-master/shared';
import type { StatsDatabase } from '../db/db.js';
import { buildRuleName } from '../../shared/utils/rule-name.js';

type SummaryDelta = {
  upload: number;
  download: number;
  connections: number;
  lastUpdated: number;
};

type MinuteBucket = {
  upload: number;
  download: number;
  lastUpdated: number;
};

type ProxyDelta = {
  chain: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
};

type DeviceDelta = {
  sourceIP: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
};

type RuleDelta = {
  rule: string;
  finalProxy: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
};

type CountryDelta = {
  country: string;
  countryName: string;
  continent: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
};

type DomainDelta = {
  domain: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
  ips: Set<string>;
  rules: Set<string>;
  chains: Set<string>;
};

type IPDelta = {
  ip: string;
  totalUpload: number;
  totalDownload: number;
  totalConnections: number;
  lastSeen: string;
  domains: Set<string>;
  chains: Set<string>;
  rules: Set<string>;
};

function matchesChainPrefix(fullChain: string, chain: string): boolean {
  return fullChain === chain || fullChain.startsWith(`${chain} > `);
}

export type TrafficMeta = {
  domain: string;
  ip: string;
  sourceIP?: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  upload: number;
  download: number;
};

type DomainPageOptions = {
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
};

type IPPageOptions = {
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
};

function toMinuteKey(tsMs: number): string {
  const iso = new Date(tsMs).toISOString();
  return `${iso.slice(0, 16)}:00`;
}

function bucketMinuteKey(minuteKey: string, bucketMinutes: number, tzOffsetMinutes = 0): string {
  if (bucketMinutes <= 1) return minuteKey;
  const timestampMs = Date.parse(`${minuteKey}Z`);
  if (!Number.isFinite(timestampMs)) return minuteKey;
  if (bucketMinutes >= 1440 && tzOffsetMinutes !== 0) {
    const dayMs = 1440 * 60 * 1000;
    const offsetMs = tzOffsetMinutes * 60 * 1000;
    return toMinuteKey(Math.floor((timestampMs + offsetMs) / dayMs) * dayMs - offsetMs);
  }
  const bucketMs = Math.floor(bucketMinutes) * 60 * 1000;
  return toMinuteKey(Math.floor(timestampMs / bucketMs) * bucketMs);
}

function normalizeSortOrder(order?: string): 'asc' | 'desc' {
  return order?.toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function compareString(a: string, b: string, order: 'asc' | 'desc'): number {
  const delta = a.localeCompare(b);
  return order === 'asc' ? delta : -delta;
}

function compareNumber(a: number, b: number, order: 'asc' | 'desc'): number {
  const delta = a - b;
  return order === 'asc' ? delta : -delta;
}

function compareTimestamp(a: string, b: string, order: 'asc' | 'desc'): number {
  const aMs = Date.parse(a || '');
  const bMs = Date.parse(b || '');
  const safeA = Number.isFinite(aMs) ? aMs : 0;
  const safeB = Number.isFinite(bMs) ? bMs : 0;
  return compareNumber(safeA, safeB, order);
}

function matchesDomainSearch(domain: string, search: string): boolean {
  if (!search) return true;
  return domain.toLowerCase().includes(search);
}

function matchesIPSearch(ip: string, domains: Iterable<string>, search: string): boolean {
  if (!search) return true;
  if (ip.toLowerCase().includes(search)) return true;
  for (const domain of domains) {
    if (domain.toLowerCase().includes(search)) return true;
  }
  return false;
}

function sortDomains(data: DomainStats[], sortBy: string, sortOrder: 'asc' | 'desc'): DomainStats[] {
  return data.sort((a, b) => {
    switch (sortBy) {
      case 'domain':
        return compareString(a.domain, b.domain, sortOrder);
      case 'totalTraffic':
        return compareNumber(
          a.totalDownload + a.totalUpload,
          b.totalDownload + b.totalUpload,
          sortOrder,
        );
      case 'totalUpload':
        return compareNumber(a.totalUpload, b.totalUpload, sortOrder);
      case 'totalConnections':
        return compareNumber(a.totalConnections, b.totalConnections, sortOrder);
      case 'lastSeen':
        return compareTimestamp(a.lastSeen, b.lastSeen, sortOrder);
      case 'totalDownload':
      default:
        return compareNumber(a.totalDownload, b.totalDownload, sortOrder);
    }
  });
}

function sortIPs(data: IPStats[], sortBy: string, sortOrder: 'asc' | 'desc'): IPStats[] {
  return data.sort((a, b) => {
    switch (sortBy) {
      case 'ip':
        return compareString(a.ip, b.ip, sortOrder);
      case 'totalTraffic':
        return compareNumber(
          a.totalDownload + a.totalUpload,
          b.totalDownload + b.totalUpload,
          sortOrder,
        );
      case 'totalUpload':
        return compareNumber(a.totalUpload, b.totalUpload, sortOrder);
      case 'totalConnections':
        return compareNumber(a.totalConnections, b.totalConnections, sortOrder);
      case 'lastSeen':
        return compareTimestamp(a.lastSeen, b.lastSeen, sortOrder);
      case 'totalDownload':
      default:
        return compareNumber(a.totalDownload, b.totalDownload, sortOrder);
    }
  });
}

export type AgentGatewayConfig = {
  rules: Array<{ type: string; payload: string; proxy: string; raw?: string }>;
  proxies: Record<string, { name: string; type: string; now?: string }>;
  providers: Record<string, { proxies: Array<{ name: string; type: string; now?: string }> }>;
  timestamp: number;
  hash: string;
};

// Policy state is synced more frequently (30s) than full config (2min)
export type AgentPolicyState = {
  proxies: Record<string, { name: string; type: string; now?: string }>;
  providers: Record<string, { proxies: Array<{ name: string; type: string; now?: string }> }>;
  timestamp: number;
};

export class RealtimeStore {
  private agentConfigByBackend = new Map<number, AgentGatewayConfig>();
  private agentPolicyStateByBackend = new Map<number, AgentPolicyState>();
  public summaryByBackend = new Map<number, SummaryDelta>();
  public minuteByBackend = new Map<number, Map<string, MinuteBucket>>();
  public domainByBackend = new Map<number, Map<string, DomainDelta>>();
  public ipByBackend = new Map<number, Map<string, IPDelta>>();
  public proxyByBackend = new Map<number, Map<string, ProxyDelta>>();
  public deviceByBackend = new Map<number, Map<string, DeviceDelta>>();
  public deviceDomainByBackend = new Map<number, Map<string, Map<string, DomainDelta>>>();
  public deviceIPByBackend = new Map<number, Map<string, Map<string, IPDelta>>>();
  public ruleByBackend = new Map<number, Map<string, RuleDelta>>();
  public ruleChainByBackend = new Map<number, Map<string, { rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number; lastSeen: string }>>();
  public countryByBackend = new Map<number, Map<string, CountryDelta>>();
  private maxMinutes: number;

  // Memory bounds: max entries per map before eviction of smallest-traffic entries
  private static readonly MAX_DOMAIN_ENTRIES = 50_000;
  private static readonly MAX_IP_ENTRIES = 50_000;
  private static readonly MAX_RULE_CHAIN_ENTRIES = 50_000;
  private static readonly MAX_DEVICE_DETAIL_ENTRIES = 10_000;
  private static readonly MAX_DEVICE_SOURCES = 10_000;

  private db: StatsDatabase | null = null;

  constructor(maxMinutes = parseInt(process.env.REALTIME_MAX_MINUTES || '180', 10)) {
    this.maxMinutes = Number.isFinite(maxMinutes) ? Math.max(30, maxMinutes) : 180;
  }

  // Set database reference for persistence (call once during initialization)
  setDatabase(db: StatsDatabase): void {
    this.db = db;
    // Load existing snapshots from database
    this.loadAgentSnapshotsFromDB();
  }

  // Load all agent snapshots from database into memory
  private loadAgentSnapshotsFromDB(): void {
    if (!this.db) return;
    try {
      const snapshots = this.db.loadAllAgentSnapshots();
      for (const snap of snapshots) {
        if (snap.config) {
          this.agentConfigByBackend.set(snap.backendId, snap.config as AgentGatewayConfig);
        }
        if (snap.policyState) {
          this.agentPolicyStateByBackend.set(snap.backendId, snap.policyState as AgentPolicyState);
        }
      }
      if (snapshots.length > 0) {
        console.info(`[RealtimeStore] Loaded ${snapshots.length} agent snapshot(s) from database`);
      }
    } catch (err) {
      console.warn('[RealtimeStore] Failed to load agent snapshots:', err);
    }
  }

  setAgentConfig(backendId: number, config: AgentGatewayConfig): void {
    this.agentConfigByBackend.set(backendId, config);
    // Persist to database if available
    if (this.db) {
      try {
        const policyState = this.agentPolicyStateByBackend.get(backendId);
        this.db.saveAgentSnapshot(backendId, config, policyState);
      } catch (err) {
        console.warn('[RealtimeStore] Failed to save agent config snapshot:', err);
      }
    }
  }

  getAgentConfig(backendId: number): AgentGatewayConfig | undefined {
    return this.agentConfigByBackend.get(backendId);
  }

  setAgentPolicyState(backendId: number, state: AgentPolicyState): void {
    this.agentPolicyStateByBackend.set(backendId, state);
    // Persist to database if available
    if (this.db) {
      try {
        const config = this.agentConfigByBackend.get(backendId);
        if (config) {
          this.db.saveAgentSnapshot(backendId, config, state);
        }
      } catch (err) {
        console.warn('[RealtimeStore] Failed to save agent policy state snapshot:', err);
      }
    }
  }

  getAgentPolicyState(backendId: number): AgentPolicyState | undefined {
    return this.agentPolicyStateByBackend.get(backendId);
  }

  // Get merged agent config with latest policy state
  getAgentConfigWithPolicyState(backendId: number): AgentGatewayConfig | undefined {
    const config = this.agentConfigByBackend.get(backendId);
    const policyState = this.agentPolicyStateByBackend.get(backendId);
    
    if (!config) return undefined;
    if (!policyState) return config;
    
    // Merge policy state into config (policy state is more recent)
    return {
      ...config,
      proxies: policyState.proxies,
      providers: policyState.providers,
    };
  }

  recordTraffic(
    backendId: number,
    meta: TrafficMeta,
    connections = 1,
    timestamp = Date.now()
  ): void {
    if (meta.upload <= 0 && meta.download <= 0) return;

    const summary = this.summaryByBackend.get(backendId) || {
      upload: 0,
      download: 0,
      connections: 0,
      lastUpdated: 0,
    };
    summary.upload += meta.upload;
    summary.download += meta.download;
    summary.connections += connections;
    summary.lastUpdated = timestamp;
    this.summaryByBackend.set(backendId, summary);

    const minuteKey = toMinuteKey(timestamp);
    let minuteMap = this.minuteByBackend.get(backendId);
    if (!minuteMap) {
      minuteMap = new Map();
      this.minuteByBackend.set(backendId, minuteMap);
    }
    const bucket = minuteMap.get(minuteKey) || { upload: 0, download: 0, lastUpdated: 0 };
    bucket.upload += meta.upload;
    bucket.download += meta.download;
    bucket.lastUpdated = timestamp;
    minuteMap.set(minuteKey, bucket);

    this.pruneOldBuckets(minuteMap, timestamp);

    const ruleName = buildRuleName(meta);
    const fullChain = meta.chains.join(' > ');
    const lastSeen = new Date(timestamp).toISOString();

    if (meta.domain) {
      let domainMap = this.domainByBackend.get(backendId);
      if (!domainMap) {
        domainMap = new Map();
        this.domainByBackend.set(backendId, domainMap);
      }

      const domainDelta = domainMap.get(meta.domain) || {
        domain: meta.domain,
        totalUpload: 0,
        totalDownload: 0,
        totalConnections: 0,
        lastSeen,
        ips: new Set<string>(),
        rules: new Set<string>(),
        chains: new Set<string>(),
      };

      domainDelta.totalUpload += meta.upload;
      domainDelta.totalDownload += meta.download;
      domainDelta.totalConnections += connections;
      domainDelta.lastSeen = lastSeen;
      if (meta.ip) domainDelta.ips.add(meta.ip);
      if (ruleName) domainDelta.rules.add(ruleName);
      if (fullChain) domainDelta.chains.add(fullChain);
      domainMap.set(meta.domain, domainDelta);
    }

    if (meta.ip) {
      let ipMap = this.ipByBackend.get(backendId);
      if (!ipMap) {
        ipMap = new Map();
        this.ipByBackend.set(backendId, ipMap);
      }

      const ipDelta = ipMap.get(meta.ip) || {
        ip: meta.ip,
        totalUpload: 0,
        totalDownload: 0,
        totalConnections: 0,
        lastSeen,
        domains: new Set<string>(),
        chains: new Set<string>(),
        rules: new Set<string>(),
      };

      ipDelta.totalUpload += meta.upload;
      ipDelta.totalDownload += meta.download;
      ipDelta.totalConnections += connections;
      ipDelta.lastSeen = lastSeen;
      const ipDomain = meta.domain || 'unknown';
      if (ipDomain) ipDelta.domains.add(ipDomain);
      if (fullChain) ipDelta.chains.add(fullChain);
      if (ruleName) ipDelta.rules.add(ruleName);
      ipMap.set(meta.ip, ipDelta);
    }

    const proxyChain = meta.chains[0] || 'DIRECT';
    let proxyMap = this.proxyByBackend.get(backendId);
    if (!proxyMap) {
      proxyMap = new Map();
      this.proxyByBackend.set(backendId, proxyMap);
    }

    const proxyDelta = proxyMap.get(proxyChain) || {
      chain: proxyChain,
      totalUpload: 0,
      totalDownload: 0,
      totalConnections: 0,
      lastSeen,
    };

    proxyDelta.totalUpload += meta.upload;
    proxyDelta.totalDownload += meta.download;
    proxyDelta.totalConnections += connections;
    proxyDelta.lastSeen = lastSeen;
    proxyMap.set(proxyChain, proxyDelta);

    const sourceIP = (meta.sourceIP || '').trim();
    if (sourceIP) {
      let deviceMap = this.deviceByBackend.get(backendId);
      if (!deviceMap) {
        deviceMap = new Map();
        this.deviceByBackend.set(backendId, deviceMap);
      }

      const deviceDelta = deviceMap.get(sourceIP) || {
        sourceIP,
        totalUpload: 0,
        totalDownload: 0,
        totalConnections: 0,
        lastSeen,
      };
      deviceDelta.totalUpload += meta.upload;
      deviceDelta.totalDownload += meta.download;
      deviceDelta.totalConnections += connections;
      deviceDelta.lastSeen = lastSeen;
      deviceMap.set(sourceIP, deviceDelta);

      if (meta.domain) {
        let sourceDomainMap = this.deviceDomainByBackend.get(backendId);
        if (!sourceDomainMap) {
          sourceDomainMap = new Map();
          this.deviceDomainByBackend.set(backendId, sourceDomainMap);
        }
        let domainMap = sourceDomainMap.get(sourceIP);
        if (!domainMap) {
          domainMap = new Map();
          sourceDomainMap.set(sourceIP, domainMap);
        }

        const domainDelta = domainMap.get(meta.domain) || {
          domain: meta.domain,
          totalUpload: 0,
          totalDownload: 0,
          totalConnections: 0,
          lastSeen,
          ips: new Set<string>(),
          rules: new Set<string>(),
          chains: new Set<string>(),
        };
        domainDelta.totalUpload += meta.upload;
        domainDelta.totalDownload += meta.download;
        domainDelta.totalConnections += connections;
        domainDelta.lastSeen = lastSeen;
        if (meta.ip) domainDelta.ips.add(meta.ip);
        if (ruleName) domainDelta.rules.add(ruleName);
        if (fullChain) domainDelta.chains.add(fullChain);
        domainMap.set(meta.domain, domainDelta);
      }

      if (meta.ip) {
        let sourceIPMap = this.deviceIPByBackend.get(backendId);
        if (!sourceIPMap) {
          sourceIPMap = new Map();
          this.deviceIPByBackend.set(backendId, sourceIPMap);
        }
        let ipMap = sourceIPMap.get(sourceIP);
        if (!ipMap) {
          ipMap = new Map();
          sourceIPMap.set(sourceIP, ipMap);
        }

        const ipDelta = ipMap.get(meta.ip) || {
          ip: meta.ip,
          totalUpload: 0,
          totalDownload: 0,
          totalConnections: 0,
          lastSeen,
          domains: new Set<string>(),
          chains: new Set<string>(),
          rules: new Set<string>(),
        };
        ipDelta.totalUpload += meta.upload;
        ipDelta.totalDownload += meta.download;
        ipDelta.totalConnections += connections;
        ipDelta.lastSeen = lastSeen;
        if (meta.domain) ipDelta.domains.add(meta.domain);
        if (fullChain) ipDelta.chains.add(fullChain);
        if (ruleName) ipDelta.rules.add(ruleName);
        ipMap.set(meta.ip, ipDelta);
      }
    }

    let ruleMap = this.ruleByBackend.get(backendId);
    if (!ruleMap) {
      ruleMap = new Map();
      this.ruleByBackend.set(backendId, ruleMap);
    }

    const finalProxy = proxyChain || 'DIRECT';
    const ruleDelta = ruleMap.get(ruleName) || {
      rule: ruleName,
      finalProxy,
      totalUpload: 0,
      totalDownload: 0,
      totalConnections: 0,
      lastSeen,
    };
    ruleDelta.finalProxy = finalProxy;
    ruleDelta.totalUpload += meta.upload;
    ruleDelta.totalDownload += meta.download;
    ruleDelta.totalConnections += connections;
    ruleDelta.lastSeen = lastSeen;
    ruleMap.set(ruleName, ruleDelta);

    if (ruleName && fullChain) {
      let ruleChainMap = this.ruleChainByBackend.get(backendId);
      if (!ruleChainMap) {
        ruleChainMap = new Map();
        this.ruleChainByBackend.set(backendId, ruleChainMap);
      }
      
      const rcKey = `${ruleName}::${fullChain}`;
      const rcDelta = ruleChainMap.get(rcKey) || {
        rule: ruleName,
        chain: fullChain,
        totalUpload: 0,
        totalDownload: 0,
        totalConnections: 0,
        lastSeen,
      };
      rcDelta.totalUpload += meta.upload;
      rcDelta.totalDownload += meta.download;
      rcDelta.totalConnections += connections;
      rcDelta.lastSeen = lastSeen;
      ruleChainMap.set(rcKey, rcDelta);
    }
  }

  recordCountryTraffic(
    backendId: number,
    geo: { country: string; country_name: string; continent: string },
    upload: number,
    download: number,
    connections = 1,
    timestamp = Date.now(),
  ): void {
    if (upload <= 0 && download <= 0) return;

    const lastSeen = new Date(timestamp).toISOString();
    let countryMap = this.countryByBackend.get(backendId);
    if (!countryMap) {
      countryMap = new Map();
      this.countryByBackend.set(backendId, countryMap);
    }

    const key = geo.country || 'Unknown';
    const countryDelta = countryMap.get(key) || {
      country: key,
      countryName: geo.country_name || geo.country || 'Unknown',
      continent: geo.continent || 'Unknown',
      totalUpload: 0,
      totalDownload: 0,
      totalConnections: 0,
      lastSeen,
    };

    countryDelta.totalUpload += upload;
    countryDelta.totalDownload += download;
    countryDelta.totalConnections += connections;
    countryDelta.lastSeen = lastSeen;
    countryMap.set(key, countryDelta);
  }

  // Rows are live store objects — consumers (rule chain flow merges) treat
  // them as read-only, so skip cloning the whole map per WS broadcast.
  getRuleChainRows(backendId: number): Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }> {
    const ruleChainMap = this.ruleChainByBackend.get(backendId);
    if (!ruleChainMap) return [];
    return Array.from(ruleChainMap.values());
  }

  getSummaryDelta(backendId: number): SummaryDelta {
    return this.summaryByBackend.get(backendId) || {
      upload: 0,
      download: 0,
      connections: 0,
      lastUpdated: 0,
    };
  }

  getTodayDelta(backendId: number, nowMs = Date.now()): { upload: number; download: number } {
    const minuteMap = this.minuteByBackend.get(backendId);
    if (!minuteMap || minuteMap.size === 0) return { upload: 0, download: 0 };

    const todayPrefix = new Date(nowMs).toISOString().slice(0, 10);
    let upload = 0;
    let download = 0;

    for (const [minuteKey, bucket] of minuteMap) {
      if (minuteKey.startsWith(todayPrefix)) {
        upload += bucket.upload;
        download += bucket.download;
      }
    }

    return { upload, download };
  }

  applySummaryDelta<T extends { totalUpload: number; totalDownload: number; totalConnections: number }>(
    backendId: number,
    base: T,
  ): T {
    const delta = this.getSummaryDelta(backendId);
    if (delta.upload === 0 && delta.download === 0 && delta.connections === 0) {
      return base;
    }

    return {
      ...base,
      totalUpload: base.totalUpload + delta.upload,
      totalDownload: base.totalDownload + delta.download,
      totalConnections: base.totalConnections + delta.connections,
    };
  }

  mergeTrend(
    backendId: number,
    basePoints: TrafficTrendPoint[],
    minutes: number,
    bucketMinutes = 1,
    nowMs = Date.now(),
    tzOffsetMinutes = 0,
  ): TrafficTrendPoint[] {
    const minuteMap = this.minuteByBackend.get(backendId);
    if (!minuteMap || minuteMap.size === 0) return basePoints;

    const cutoffKey = toMinuteKey(nowMs - minutes * 60 * 1000);
    const deltaMap = new Map<string, { upload: number; download: number }>();

    for (const [minuteKey, bucket] of minuteMap) {
      if (minuteKey < cutoffKey) continue;
      const bucketKey = bucketMinuteKey(minuteKey, bucketMinutes, tzOffsetMinutes);
      const existing = deltaMap.get(bucketKey);
      if (existing) {
        existing.upload += bucket.upload;
        existing.download += bucket.download;
      } else {
        deltaMap.set(bucketKey, { upload: bucket.upload, download: bucket.download });
      }
    }

    if (deltaMap.size === 0) return basePoints;

    const merged = new Map<string, { upload: number; download: number }>();
    for (const point of basePoints) {
      merged.set(point.time, { upload: point.upload, download: point.download });
    }

    for (const [time, delta] of deltaMap) {
      const existing = merged.get(time);
      if (existing) {
        existing.upload += delta.upload;
        existing.download += delta.download;
      } else {
        merged.set(time, { upload: delta.upload, download: delta.download });
      }
    }

    return Array.from(merged.entries())
      .map(([time, data]) => ({ time, upload: data.upload, download: data.download }))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  mergeTopDomains(backendId: number, base: DomainStats[], limit: number): DomainStats[] {
    const domainMap = this.domainByBackend.get(backendId);
    if (!domainMap || domainMap.size === 0) return base;

    const merged = new Map<string, DomainStats>();
    for (const item of base) {
      merged.set(item.domain, { ...item });
    }

    for (const [domain, delta] of domainMap) {
      const existing = merged.get(domain);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
        if (delta.ips.size > 0) {
          const ips = new Set(existing.ips || []);
          for (const ip of delta.ips) ips.add(ip);
          existing.ips = Array.from(ips);
        }
        if (delta.rules.size > 0) {
          const rules = new Set(existing.rules || []);
          for (const rule of delta.rules) rules.add(rule);
          existing.rules = Array.from(rules);
        }
        if (delta.chains.size > 0) {
          const chains = new Set(existing.chains || []);
          for (const chain of delta.chains) chains.add(chain);
          existing.chains = Array.from(chains);
        }
      } else {
        merged.set(domain, {
          domain,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
          ips: Array.from(delta.ips),
          rules: Array.from(delta.rules),
          chains: Array.from(delta.chains),
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload))
      .slice(0, limit);
  }

  mergeTopIPs(backendId: number, base: IPStats[], limit: number): IPStats[] {
    const ipMap = this.ipByBackend.get(backendId);
    if (!ipMap || ipMap.size === 0) return base;

    const merged = new Map<string, IPStats>();
    for (const item of base) {
      merged.set(item.ip, { ...item });
    }

    for (const [ip, delta] of ipMap) {
      const existing = merged.get(ip);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
        if (delta.domains.size > 0) {
          const domains = new Set(existing.domains || []);
          for (const domain of delta.domains) domains.add(domain);
          existing.domains = Array.from(domains);
        }
        if (delta.chains.size > 0) {
          const chains = new Set(existing.chains || []);
          for (const chain of delta.chains) chains.add(chain);
          existing.chains = Array.from(chains);
        }
      } else {
        merged.set(ip, {
          ip,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
          domains: Array.from(delta.domains),
          chains: Array.from(delta.chains),
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload))
      .slice(0, limit);
  }

  mergeDomainStatsPaginated(
    backendId: number,
    base: { data: DomainStats[]; total: number },
    opts: DomainPageOptions = {},
  ): { data: DomainStats[]; total: number } {
    const domainMap = this.domainByBackend.get(backendId);
    if (!domainMap || domainMap.size === 0) return base;

    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.max(1, (opts.limit ?? base.data.length) || 50);
    const sortBy = opts.sortBy || 'totalDownload';
    const sortOrder = normalizeSortOrder(opts.sortOrder);
    const search = (opts.search || '').trim().toLowerCase();

    const merged = new Map<string, DomainStats>();
    for (const item of base.data) {
      if (!matchesDomainSearch(item.domain, search)) continue;
      merged.set(item.domain, { ...item });
    }

    let addedCount = 0;
    for (const [domain, delta] of domainMap) {
      if (!matchesDomainSearch(domain, search)) continue;

      const existing = merged.get(domain);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
        const ips = new Set(existing.ips || []);
        for (const ip of delta.ips) ips.add(ip);
        existing.ips = Array.from(ips);
        const rules = new Set(existing.rules || []);
        for (const rule of delta.rules) rules.add(rule);
        existing.rules = Array.from(rules);
        const chains = new Set(existing.chains || []);
        for (const chain of delta.chains) chains.add(chain);
        existing.chains = Array.from(chains);
        continue;
      }

      // For non-first pages, avoid injecting unknown new rows that can shift boundaries.
      if (offset > 0) continue;
      merged.set(domain, {
        domain,
        totalUpload: delta.totalUpload,
        totalDownload: delta.totalDownload,
        totalConnections: delta.totalConnections,
        lastSeen: delta.lastSeen,
        ips: Array.from(delta.ips),
        rules: Array.from(delta.rules),
        chains: Array.from(delta.chains),
      });
      addedCount += 1;
    }

    const sorted = sortDomains(Array.from(merged.values()), sortBy, sortOrder);
    return {
      data: sorted.slice(0, limit),
      total: base.total + addedCount,
    };
  }

  mergeIPStatsPaginated(
    backendId: number,
    base: { data: IPStats[]; total: number },
    opts: IPPageOptions = {},
  ): { data: IPStats[]; total: number } {
    const ipMap = this.ipByBackend.get(backendId);
    if (!ipMap || ipMap.size === 0) return base;

    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.max(1, (opts.limit ?? base.data.length) || 50);
    const sortBy = opts.sortBy || 'totalDownload';
    const sortOrder = normalizeSortOrder(opts.sortOrder);
    const search = (opts.search || '').trim().toLowerCase();

    const merged = new Map<string, IPStats>();
    for (const item of base.data) {
      if (!matchesIPSearch(item.ip, item.domains || [], search)) continue;
      merged.set(item.ip, { ...item });
    }

    let addedCount = 0;
    for (const [ip, delta] of ipMap) {
      if (!matchesIPSearch(ip, delta.domains, search)) continue;

      const existing = merged.get(ip);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
        const domains = new Set(existing.domains || []);
        for (const domain of delta.domains) domains.add(domain);
        existing.domains = Array.from(domains);
        const chains = new Set(existing.chains || []);
        for (const chain of delta.chains) chains.add(chain);
        existing.chains = Array.from(chains);
        continue;
      }

      if (offset > 0) continue;
      merged.set(ip, {
        ip,
        totalUpload: delta.totalUpload,
        totalDownload: delta.totalDownload,
        totalConnections: delta.totalConnections,
        lastSeen: delta.lastSeen,
        domains: Array.from(delta.domains),
        chains: Array.from(delta.chains),
      });
      addedCount += 1;
    }

    const sorted = sortIPs(Array.from(merged.values()), sortBy, sortOrder);
    return {
      data: sorted.slice(0, limit),
      total: base.total + addedCount,
    };
  }

  mergeProxyDomains(
    backendId: number,
    chain: string,
    base: DomainStats[],
    limit = 5000,
  ): DomainStats[] {
    const domainMap = this.domainByBackend.get(backendId);
    if (!domainMap || domainMap.size === 0) return base;

    const merged = new Map<string, DomainStats>();
    for (const item of base) {
      merged.set(item.domain, { ...item });
    }

    for (const [domain, delta] of domainMap) {
      const matched = Array.from(delta.chains).some((full) => matchesChainPrefix(full, chain));
      if (!matched) continue;

      const existing = merged.get(domain);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
        const ips = new Set(existing.ips || []);
        for (const ip of delta.ips) ips.add(ip);
        existing.ips = Array.from(ips);
        const rules = new Set(existing.rules || []);
        for (const rule of delta.rules) rules.add(rule);
        existing.rules = Array.from(rules);
        const chains = new Set(existing.chains || []);
        for (const full of delta.chains) {
          if (matchesChainPrefix(full, chain)) chains.add(full);
        }
        existing.chains = Array.from(chains);
      } else {
        merged.set(domain, {
          domain,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
          ips: Array.from(delta.ips),
          rules: Array.from(delta.rules),
          chains: Array.from(delta.chains).filter((full) => matchesChainPrefix(full, chain)),
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload))
      .slice(0, limit);
  }

  mergeProxyIPs(
    backendId: number,
    chain: string,
    base: IPStats[],
    limit = 5000,
  ): IPStats[] {
    const ipMap = this.ipByBackend.get(backendId);
    if (!ipMap || ipMap.size === 0) return base;

    const merged = new Map<string, IPStats>();
    for (const item of base) {
      merged.set(item.ip, { ...item });
    }

    for (const [ip, delta] of ipMap) {
      const matched = Array.from(delta.chains).some((full) => matchesChainPrefix(full, chain));
      if (!matched) continue;

      const existing = merged.get(ip);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
        const domains = new Set(existing.domains || []);
        for (const domain of delta.domains) domains.add(domain);
        existing.domains = Array.from(domains);
        const chains = new Set(existing.chains || []);
        for (const full of delta.chains) {
          if (matchesChainPrefix(full, chain)) chains.add(full);
        }
        existing.chains = Array.from(chains);
      } else {
        merged.set(ip, {
          ip,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
          domains: Array.from(delta.domains),
          chains: Array.from(delta.chains).filter((full) => matchesChainPrefix(full, chain)),
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload))
      .slice(0, limit);
  }

  mergeProxyStats(backendId: number, base: ProxyStats[]): ProxyStats[] {
    const proxyMap = this.proxyByBackend.get(backendId);
    if (!proxyMap || proxyMap.size === 0) return base;

    const merged = new Map<string, ProxyStats>();
    for (const item of base) {
      merged.set(item.chain, { ...item });
    }

    for (const [chain, delta] of proxyMap) {
      const existing = merged.get(chain);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
      } else {
        merged.set(chain, {
          chain,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
        });
      }
    }

    return Array.from(merged.values()).sort(
      (a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload),
    );
  }

  mergeDeviceStats(backendId: number, base: DeviceStats[], limit = 50): DeviceStats[] {
    const deviceMap = this.deviceByBackend.get(backendId);
    if (!deviceMap || deviceMap.size === 0) {
      return base;
    }

    const merged = new Map<string, DeviceStats>();
    for (const item of base) {
      merged.set(item.sourceIP, { ...item });
    }

    for (const [sourceIP, delta] of deviceMap) {
      const existing = merged.get(sourceIP);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
      } else {
        merged.set(sourceIP, {
          sourceIP,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload))
      .slice(0, limit);
  }

  mergeDeviceDomains(
    backendId: number,
    sourceIP: string,
    base: DomainStats[],
    limit = 5000,
  ): DomainStats[] {
    const sourceDomainMap = this.deviceDomainByBackend.get(backendId);
    const domainMap = sourceDomainMap?.get(sourceIP);
    if (!domainMap || domainMap.size === 0) {
      return base;
    }

    const merged = new Map<string, DomainStats>();
    for (const item of base) {
      merged.set(item.domain, { ...item });
    }

    for (const [domain, delta] of domainMap) {
      const existing = merged.get(domain);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
        if (delta.ips.size > 0) {
          const ips = new Set(existing.ips || []);
          for (const ip of delta.ips) ips.add(ip);
          existing.ips = Array.from(ips);
        }
        if (delta.rules.size > 0) {
          const rules = new Set(existing.rules || []);
          for (const rule of delta.rules) rules.add(rule);
          existing.rules = Array.from(rules);
        }
        if (delta.chains.size > 0) {
          const chains = new Set(existing.chains || []);
          for (const chain of delta.chains) chains.add(chain);
          existing.chains = Array.from(chains);
        }
      } else {
        merged.set(domain, {
          domain,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
          ips: Array.from(delta.ips),
          rules: Array.from(delta.rules),
          chains: Array.from(delta.chains),
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload))
      .slice(0, limit);
  }

  mergeDeviceIPs(
    backendId: number,
    sourceIP: string,
    base: IPStats[],
    limit = 5000,
  ): IPStats[] {
    const sourceIPMap = this.deviceIPByBackend.get(backendId);
    const ipMap = sourceIPMap?.get(sourceIP);
    if (!ipMap || ipMap.size === 0) {
      return base;
    }

    const merged = new Map<string, IPStats>();
    for (const item of base) {
      merged.set(item.ip, { ...item });
    }

    for (const [ip, delta] of ipMap) {
      const existing = merged.get(ip);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
        if (delta.domains.size > 0) {
          const domains = new Set(existing.domains || []);
          for (const domain of delta.domains) domains.add(domain);
          existing.domains = Array.from(domains);
        }
        if (delta.chains.size > 0) {
          const chains = new Set(existing.chains || []);
          for (const chain of delta.chains) chains.add(chain);
          existing.chains = Array.from(chains);
        }
      } else {
        merged.set(ip, {
          ip,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
          domains: Array.from(delta.domains),
          chains: Array.from(delta.chains),
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload))
      .slice(0, limit);
  }

  mergeRuleStats(backendId: number, base: RuleStats[]): RuleStats[] {
    const ruleMap = this.ruleByBackend.get(backendId);
    if (!ruleMap || ruleMap.size === 0) return base;

    const merged = new Map<string, RuleStats>();
    for (const item of base) {
      merged.set(item.rule, { ...item });
    }

    for (const [rule, delta] of ruleMap) {
      const existing = merged.get(rule);
      if (existing) {
        existing.finalProxy = delta.finalProxy || existing.finalProxy;
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
      } else {
        merged.set(rule, {
          rule,
          finalProxy: delta.finalProxy,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
        });
      }
    }

    return Array.from(merged.values()).sort(
      (a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload),
    );
  }

  mergeRuleDomains(
    backendId: number,
    rule: string,
    base: DomainStats[],
    limit = 5000,
  ): DomainStats[] {
    const domainMap = this.domainByBackend.get(backendId);
    if (!domainMap || domainMap.size === 0) return base;

    const merged = new Map<string, DomainStats>();
    for (const item of base) {
      merged.set(item.domain, { ...item });
    }

    for (const [domain, delta] of domainMap) {
      if (!delta.rules.has(rule)) continue;

      const existing = merged.get(domain);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
        const ips = new Set(existing.ips || []);
        for (const ip of delta.ips) ips.add(ip);
        existing.ips = Array.from(ips);
        const rules = new Set(existing.rules || []);
        for (const r of delta.rules) rules.add(r);
        existing.rules = Array.from(rules);
        const chains = new Set(existing.chains || []);
        for (const full of delta.chains) chains.add(full);
        existing.chains = Array.from(chains);
      } else {
        merged.set(domain, {
          domain,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
          ips: Array.from(delta.ips),
          rules: Array.from(delta.rules),
          chains: Array.from(delta.chains),
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload))
      .slice(0, limit);
  }

  mergeRuleIPs(
    backendId: number,
    rule: string,
    base: IPStats[],
    limit = 5000,
  ): IPStats[] {
    const ipMap = this.ipByBackend.get(backendId);
    if (!ipMap || ipMap.size === 0) return base;

    const merged = new Map<string, IPStats>();
    for (const item of base) {
      merged.set(item.ip, { ...item });
    }

    for (const [ip, delta] of ipMap) {
      if (!delta.rules.has(rule)) continue;

      const existing = merged.get(ip);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (delta.lastSeen > existing.lastSeen) {
          existing.lastSeen = delta.lastSeen;
        }
        const domains = new Set(existing.domains || []);
        for (const domain of delta.domains) domains.add(domain);
        existing.domains = Array.from(domains);
        const chains = new Set(existing.chains || []);
        for (const full of delta.chains) chains.add(full);
        existing.chains = Array.from(chains);
      } else {
        merged.set(ip, {
          ip,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
          domains: Array.from(delta.domains),
          chains: Array.from(delta.chains),
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload))
      .slice(0, limit);
  }

  mergeCountryStats(backendId: number, base: CountryStats[]): CountryStats[] {
    const countryMap = this.countryByBackend.get(backendId);
    if (!countryMap || countryMap.size === 0) return base;

    const merged = new Map<string, CountryStats>();
    for (const item of base) {
      merged.set(item.country, { ...item });
    }

    for (const [country, delta] of countryMap) {
      const existing = merged.get(country);
      if (existing) {
        existing.totalUpload += delta.totalUpload;
        existing.totalDownload += delta.totalDownload;
        existing.totalConnections += delta.totalConnections;
        if (!existing.countryName && delta.countryName) {
          existing.countryName = delta.countryName;
        }
        if (!existing.continent && delta.continent) {
          existing.continent = delta.continent;
        }
        if (delta.lastSeen && (!existing.lastSeen || delta.lastSeen > existing.lastSeen)) {
          existing.lastSeen = delta.lastSeen;
        }
      } else {
        merged.set(country, {
          country,
          countryName: delta.countryName,
          continent: delta.continent,
          totalUpload: delta.totalUpload,
          totalDownload: delta.totalDownload,
          totalConnections: delta.totalConnections,
          lastSeen: delta.lastSeen,
        });
      }
    }

    return Array.from(merged.values()).sort(
      (a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload),
    );
  }

  clearTrafficSummary(backendId: number): void {
    this.summaryByBackend.delete(backendId);
    this.minuteByBackend.delete(backendId);
  }

  clearTrafficDimensions(backendId: number): void {
    this.domainByBackend.delete(backendId);
    this.ipByBackend.delete(backendId);
    this.proxyByBackend.delete(backendId);
    this.deviceByBackend.delete(backendId);
    this.deviceDomainByBackend.delete(backendId);
    this.deviceIPByBackend.delete(backendId);
    this.ruleByBackend.delete(backendId);
    this.ruleChainByBackend.delete(backendId);
  }

  clearTraffic(backendId: number): void {
    this.clearTrafficSummary(backendId);
    this.clearTrafficDimensions(backendId);
  }

  clearCountries(backendId: number): void {
    this.countryByBackend.delete(backendId);
  }

  clearBackend(backendId: number): void {
    this.clearTraffic(backendId);
    this.clearCountries(backendId);
  }

  private pruneOldBuckets(minuteMap: Map<string, MinuteBucket>, nowMs: number): void {
    const cutoffKey = toMinuteKey(nowMs - this.maxMinutes * 60 * 1000);
    for (const key of minuteMap.keys()) {
      if (key < cutoffKey) {
        minuteMap.delete(key);
      }
    }
  }

  /**
   * Evict lowest-traffic entries when a map exceeds its size cap.
   * Removes the bottom ~25% by total traffic to avoid frequent evictions.
   */
  private evictIfNeeded<T extends { totalUpload: number; totalDownload: number }>(
    map: Map<string, T>,
    maxEntries: number,
  ): void {
    if (map.size <= maxEntries) return;

    const entries = Array.from(map.entries());
    entries.sort((a, b) =>
      (a[1].totalUpload + a[1].totalDownload) - (b[1].totalUpload + b[1].totalDownload)
    );

    // Remove bottom 25%
    const removeCount = Math.ceil(entries.length * 0.25);
    for (let i = 0; i < removeCount; i++) {
      map.delete(entries[i][0]);
    }
  }

  /**
   * Run periodic memory bounds check on all realtime maps.
   * Called after recordTraffic accumulates data.
   */
  pruneIfNeeded(backendId: number): void {
    const domainMap = this.domainByBackend.get(backendId);
    if (domainMap) this.evictIfNeeded(domainMap, RealtimeStore.MAX_DOMAIN_ENTRIES);

    const ipMap = this.ipByBackend.get(backendId);
    if (ipMap) this.evictIfNeeded(ipMap, RealtimeStore.MAX_IP_ENTRIES);

    const ruleChainMap = this.ruleChainByBackend.get(backendId);
    if (ruleChainMap) {
      this.evictIfNeeded(ruleChainMap, RealtimeStore.MAX_RULE_CHAIN_ENTRIES);
    }

    // Device detail maps (per source IP × domain/IP) can be deeply nested
    const deviceDomainMap = this.deviceDomainByBackend.get(backendId);
    if (deviceDomainMap) {
      this.evictOuterDeviceMapIfNeeded(deviceDomainMap);
      for (const [, subMap] of deviceDomainMap) {
        this.evictIfNeeded(subMap, RealtimeStore.MAX_DEVICE_DETAIL_ENTRIES);
      }
    }

    const deviceIPMap = this.deviceIPByBackend.get(backendId);
    if (deviceIPMap) {
      this.evictOuterDeviceMapIfNeeded(deviceIPMap);
      for (const [, subMap] of deviceIPMap) {
        this.evictIfNeeded(subMap, RealtimeStore.MAX_DEVICE_DETAIL_ENTRIES);
      }
    }
  }

  /**
   * Bound the number of tracked source IPs in a device detail map. Without
   * this, the outer map grows by one nested map per source IP indefinitely.
   * Evicts the bottom ~25% of source IPs by aggregate traffic.
   */
  private evictOuterDeviceMapIfNeeded<T extends { totalUpload: number; totalDownload: number }>(
    outer: Map<string, Map<string, T>>,
  ): void {
    if (outer.size <= RealtimeStore.MAX_DEVICE_SOURCES) return;

    const totals = Array.from(outer.entries()).map(([sourceIP, subMap]) => {
      let traffic = 0;
      for (const entry of subMap.values()) {
        traffic += entry.totalUpload + entry.totalDownload;
      }
      return { sourceIP, traffic };
    });
    totals.sort((a, b) => a.traffic - b.traffic);

    const removeCount = Math.ceil(totals.length * 0.25);
    for (let i = 0; i < removeCount; i++) {
      outer.delete(totals[i].sourceIP);
    }
  }
}

export const realtimeStore = new RealtimeStore();
