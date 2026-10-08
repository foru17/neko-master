
import {
  DomainStats,
  IPStats,
  ProxyStats,
  CountryStats,
  DeviceStats,
  RuleStats,
  TrafficTrendPoint,
} from '@neko-master/shared';
import { RealtimeStore } from './realtime.store.js';
import { MinuteBucket, SummaryDelta } from './realtime.types.js';

// --- Helper Functions ---

function matchesChainPrefix(fullChain: string, chain: string): boolean {
  return fullChain === chain || fullChain.startsWith(`${chain} > `);
}

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

export type DomainPageOptions = {
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
};

export type IPPageOptions = {
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
};

// --- RealtimeMerger Class ---

export class RealtimeMerger {
  constructor(private store: RealtimeStore) {}

  applySummaryDelta<T extends { totalUpload: number; totalDownload: number; totalConnections: number }>(
    backendId: number,
    base: T,
  ): T {
    const delta = this.store.getSummaryDelta(backendId);
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
    const minuteMap = this.store.minuteByBackend.get(backendId);
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
    const domainMap = this.store.domainByBackend.get(backendId);
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
    const ipMap = this.store.ipByBackend.get(backendId);
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
    const domainMap = this.store.domainByBackend.get(backendId);
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
    const ipMap = this.store.ipByBackend.get(backendId);
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
    const domainMap = this.store.domainByBackend.get(backendId);
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
    const ipMap = this.store.ipByBackend.get(backendId);
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
    const proxyMap = this.store.proxyByBackend.get(backendId);
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
    const deviceMap = this.store.deviceByBackend.get(backendId);
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
    const sourceDomainMap = this.store.deviceDomainByBackend.get(backendId);
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
    const sourceIPMap = this.store.deviceIPByBackend.get(backendId);
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
    const ruleMap = this.store.ruleByBackend.get(backendId);
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
    const domainMap = this.store.domainByBackend.get(backendId);
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
    const ipMap = this.store.ipByBackend.get(backendId);
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
    const countryMap = this.store.countryByBackend.get(backendId);
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
}
