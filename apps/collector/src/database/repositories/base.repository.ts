/**
 * Base Repository Class
 * 
 * Provides common database operations and utilities for all repositories.
 * All specific repositories should extend this class.
 */
import { shouldUseHourlyTables } from '../../shared/utils/fact-table-routing.js';
import type Database from 'better-sqlite3';
import type { ProxyStats } from '@neko-master/shared';

export abstract class BaseRepository {
  protected db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Convert a Date to minute key format (YYYY-MM-DDTHH:MM:00)
   */
  protected toMinuteKey(date: Date): string {
    return `${date.toISOString().slice(0, 16)}:00`;
  }

  /**
   * Parse a minute/hour key (YYYY-MM-DDTHH:MM:00, stored in UTC without a
   * zone suffix) as UTC. A bare `new Date(key)` would read it as local time
   * and shift every range by the process TZ offset.
   */
  protected minuteKeyToDate(key: string): Date {
    return new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(key) ? key : `${key}Z`);
  }

  /**
   * Convert a Date to hour key format (YYYY-MM-DDTHH:00:00)
   */
  protected toHourKey(date: Date): string {
    return `${date.toISOString().slice(0, 13)}:00:00`;
  }

  /**
   * Resolve which fact table to use based on the time range span.
   * For ranges > 6 hours, or ranges starting before the minute-table retention
   * window, uses hourly_dim_stats (which is written to in real-time).
   * The start boundary is rounded down to the hour, introducing up to ~59 min of extra
   * data — negligible for long ranges (< 0.3% for 12h+, < 1% for 6h+).
   */
  protected resolveFactTable(
    start: string,
    end: string,
  ): { table: 'hourly_dim_stats' | 'minute_dim_stats'; startKey: string; endKey: string; timeCol: 'hour' | 'minute' } {
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return { table: 'minute_dim_stats', startKey: this.toMinuteKey(startDate), endKey: this.toMinuteKey(endDate), timeCol: 'minute' };
    }

    if (shouldUseHourlyTables(startDate.getTime(), endDate.getTime())) {
      return {
        table: 'hourly_dim_stats',
        startKey: this.toHourKey(startDate),
        endKey: this.toHourKey(endDate),
        timeCol: 'hour',
      };
    }

    return {
      table: 'minute_dim_stats',
      startKey: this.toMinuteKey(startDate),
      endKey: this.toMinuteKey(endDate),
      timeCol: 'minute',
    };
  }

  /**
   * Split a time range into hourly + minute segments for precise long-range queries.
   * For ranges > 2 hours where end is in the current hour, returns two segments:
   *   1. hourly_dim_stats for all completed hours (bulk, ~60x fewer rows)
   *   2. minute_dim_stats for the current hour tail (~0-59 minutes)
   * No overlap, no gap, no data loss.
   */
  protected resolveFactTableSplit(
    start: string,
    end: string,
  ): Array<{ table: 'hourly_dim_stats' | 'minute_dim_stats'; startKey: string; endKey: string; timeCol: 'hour' | 'minute' }> {
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return [{ table: 'minute_dim_stats', startKey: this.toMinuteKey(startDate), endKey: this.toMinuteKey(endDate), timeCol: 'minute' }];
    }

    const rangeMs = endDate.getTime() - startDate.getTime();
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

    // Short ranges: always use minute table (precise, fast enough)
    if (rangeMs <= TWO_HOURS_MS) {
      return [{ table: 'minute_dim_stats', startKey: this.toMinuteKey(startDate), endKey: this.toMinuteKey(endDate), timeCol: 'minute' }];
    }

    const currentHourStart = new Date();
    currentHourStart.setMinutes(0, 0, 0);

    // Purely historical: hourly only
    if (endDate.getTime() < currentHourStart.getTime()) {
      return [{ table: 'hourly_dim_stats', startKey: this.toHourKey(startDate), endKey: this.toHourKey(endDate), timeCol: 'hour' }];
    }

    // Split: hourly for completed hours + minute for current hour tail
    const segments: Array<{ table: 'hourly_dim_stats' | 'minute_dim_stats'; startKey: string; endKey: string; timeCol: 'hour' | 'minute' }> = [];

    // Hourly segment: from start up to last completed hour
    if (startDate.getTime() < currentHourStart.getTime()) {
      const lastCompletedHour = new Date(currentHourStart.getTime() - 1);
      segments.push({
        table: 'hourly_dim_stats',
        startKey: this.toHourKey(startDate),
        endKey: this.toHourKey(lastCompletedHour),
        timeCol: 'hour',
      });
    }

    // Minute segment: from current hour start (or range start if later) to end
    const minuteSegStart = startDate.getTime() >= currentHourStart.getTime() ? startDate : currentHourStart;
    segments.push({
      table: 'minute_dim_stats',
      startKey: this.toMinuteKey(minuteSegStart),
      endKey: this.toMinuteKey(endDate),
      timeCol: 'minute',
    });

    return segments;
  }

  /**
   * Split version for country fact tables.
   */
  protected resolveCountryFactTableSplit(
    start: string,
    end: string,
  ): Array<{ table: 'hourly_country_stats' | 'minute_country_stats'; startKey: string; endKey: string; timeCol: 'hour' | 'minute' }> {
    const segments = this.resolveFactTableSplit(start, end);
    return segments.map(s => ({
      table: (s.table === 'hourly_dim_stats' ? 'hourly_country_stats' : 'minute_country_stats') as 'hourly_country_stats' | 'minute_country_stats',
      startKey: s.startKey,
      endKey: s.endKey,
      timeCol: s.timeCol,
    }));
  }

  /**
   * Resolve fact table for country queries.
   * Same logic as resolveFactTable but returns country table names.
   */
  protected resolveCountryFactTable(
    start: string,
    end: string,
  ): { table: 'hourly_country_stats' | 'minute_country_stats'; startKey: string; endKey: string; timeCol: 'hour' | 'minute' } {
    const resolved = this.resolveFactTable(start, end);
    return {
      table: resolved.table === 'hourly_dim_stats' ? 'hourly_country_stats' : 'minute_country_stats',
      startKey: resolved.startKey,
      endKey: resolved.endKey,
      timeCol: resolved.timeCol,
    };
  }

  /**
   * Parse minute range from start and end ISO strings
   */
  protected parseMinuteRange(
    start?: string,
    end?: string,
  ): { startMinute: string; endMinute: string } | null {
    if (!start || !end) {
      return null;
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      startDate > endDate
    ) {
      return null;
    }

    return {
      startMinute: this.toMinuteKey(startDate),
      endMinute: this.toMinuteKey(endDate),
    };
  }

  /**
   * Execute a transaction with automatic rollback on error
   */
  protected withTransaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  /**
   * Split chain string into parts
   */
  protected splitChainParts(chain: string): string[] {
    return chain
      .split(">")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  /**
   * Normalize flow label for comparison
   */
  protected normalizeFlowLabel(label: string): string {
    return label
      .normalize("NFKC")
      .replace(/^[^\p{L}\p{N}]+/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /**
   * Find rule index in chain parts
   */
  protected findRuleIndexInChain(chainParts: string[], rule: string): number {
    const exactIndex = chainParts.findIndex((part) => part === rule);
    if (exactIndex !== -1) {
      return exactIndex;
    }

    const normalizedRule = this.normalizeFlowLabel(rule);
    if (!normalizedRule) {
      return -1;
    }

    return chainParts.findIndex(
      (part) => this.normalizeFlowLabel(part) === normalizedRule,
    );
  }

  /**
   * Get the first hop from a chain
   */
  protected getChainFirstHop(chain: string): string {
    const parts = this.splitChainParts(chain);
    return parts[0] || chain;
  }

  /**
   * Build a normalized rule flow path in "rule -> ... -> proxy" order
   */
  protected buildRuleFlowPath(rule: string, chain: string): string[] {
    return this.buildRuleFlowPathWithConfig(rule, chain, undefined);
  }

  /**
   * Build a normalized rule flow path with proxy config enrichment.
   * For Agent mode, uses proxy config (with 'now' field) to complete short chains.
   */
  protected buildRuleFlowPathWithConfig(
    rule: string, 
    chain: string, 
    proxyConfig: Record<string, { now?: string }> | undefined,
  ): string[] {
    const chainParts = this.splitChainParts(chain);
    if (chainParts.length === 0) {
      return [];
    }

    // Debug logging removed to reduce noise in production

    // Enrich chain with proxy config if available and chain is short
    let enrichedParts = chainParts;
    if (proxyConfig && chainParts.length < 3) {
      enrichedParts = this.enrichChainWithProxyConfig(chainParts, proxyConfig);
      // Chain enrichment result logging removed
    }

    // Try to find rule in enriched chain
    const ruleIndex = this.findRuleIndexInChain(enrichedParts, rule);
    if (ruleIndex !== -1) {
      // Full chain stored as proxy > ... > rule, reverse to rule > ... > proxy.
      return enrichedParts.slice(0, ruleIndex + 1).reverse();
    }

    // If rule not in chain but we enriched it, build path: rule -> ... -> proxy
    // enrichedParts is already in order: [ruleGroup, middleGroup, finalProxy]
    if (enrichedParts.length > chainParts.length) {
      // Check if first element could be the rule target
      const normalizedRule = this.normalizeFlowLabel(rule);
      const normalizedFirst = this.normalizeFlowLabel(enrichedParts[0] || "");
      
      // If rule matches first element or rule is parent of first element
      if (normalizedRule === normalizedFirst) {
        return enrichedParts;
      }
      
      // Otherwise prepend rule: rule -> enrichedParts
      return [rule, ...enrichedParts];
    }

    // Fallback for mismatched labels or minute_dim rows:
    // normalize direction to rule/group -> ... -> proxy.
    const reversed = [...enrichedParts].reverse();
    const normalizedRule = this.normalizeFlowLabel(rule);
    const normalizedHead = this.normalizeFlowLabel(reversed[0] || "");
    if (normalizedRule && normalizedRule === normalizedHead) {
      return reversed;
    }

    return [rule, ...reversed];
  }

  /**
   * Enrich a short chain using proxy config to build complete policy path.
   * For Surge Agent mode: traces back from final proxy through policy groups using 'now' field.
   */
  private enrichChainWithProxyConfig(
    chainParts: string[], 
    proxyConfig: Record<string, { now?: string }>,
  ): string[] {
    if (chainParts.length === 0) {
      return chainParts;
    }

    // Debug logging removed to reduce noise in production

    // Build complete path by tracing backwards through proxy config
    const completePath = [...chainParts];
    const visited = new Set<string>(chainParts);
    
    // Start from the last element and trace back using 'now' references
    let current = chainParts[chainParts.length - 1];
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (current && iterations < maxIterations) {
      // Find which policy group points to current as its 'now' selection
      let foundParent = false;
      for (const [name, config] of Object.entries(proxyConfig)) {
        if (config.now === current && !visited.has(name)) {
          // Parent found in proxy config
          completePath.push(name);
          visited.add(name);
          current = name;
          foundParent = true;
          break;
        }
      }
      if (!foundParent) {
        break; // No parent found
      }
      iterations++;
    }

    // If we enriched the chain, reverse to get correct order (rule -> ... -> proxy)
    if (completePath.length > chainParts.length) {
      // The chain is stored as [finalProxy, ...], we need to reverse to get [..., rule]
      // But actually we want: rule -> group -> finalProxy
      // Proxy config gives us: group -> finalProxy (via now field)
      // So we reverse to get: finalProxy -> group
      // Then the caller will reverse again... let's return in correct order
      
      // Current completePath: [finalProxy, group1, group2] (where group2.now = group1, group1.now = finalProxy)
      // We want: [group2, group1, finalProxy] for proper flow path
      return completePath.reverse();
    }

    return chainParts; // No enrichment possible
  }

  /**
   * Get unique non-empty values from an array
   */
  protected uniqueNonEmpty(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
      const v = (raw || "").trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  /**
   * Aggregate proxy stats by first hop in chain
   */
  protected aggregateProxyStatsByFirstHop(rows: ProxyStats[]): ProxyStats[] {
    const merged = new Map<string, ProxyStats>();

    for (const row of rows) {
      const hop = this.getChainFirstHop(row.chain || "") || "DIRECT";
      const existing = merged.get(hop);
      if (existing) {
        existing.totalUpload += row.totalUpload;
        existing.totalDownload += row.totalDownload;
        existing.totalConnections += row.totalConnections;
        if (row.lastSeen > existing.lastSeen) {
          existing.lastSeen = row.lastSeen;
        }
      } else {
        merged.set(hop, {
          chain: hop,
          totalUpload: row.totalUpload,
          totalDownload: row.totalDownload,
          totalConnections: row.totalConnections,
          lastSeen: row.lastSeen,
        });
      }
    }

    return Array.from(merged.values()).sort(
      (a, b) => (b.totalDownload + b.totalUpload) - (a.totalDownload + a.totalUpload),
    );
  }

  /**
   * Remap range rows from minute_dim_stats to full chains using baseline data
   */
  protected remapRangeRowsToFullChains(
    rangeRows: Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>,
    baselineRows: Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }>,
  ): Array<{ rule: string; chain: string; totalUpload: number; totalDownload: number; totalConnections: number }> {
    if (rangeRows.length === 0) return [];
    if (baselineRows.length === 0) return rangeRows;

    const baselineByRuleHop = new Map<string, typeof baselineRows>();
    const baselineByNormalizedRuleHop = new Map<string, typeof baselineRows>();
    for (const row of baselineRows) {
      const hop = this.getChainFirstHop(row.chain);
      const key = `${row.rule}|||${hop}`;
      const list = baselineByRuleHop.get(key);
      if (list) { list.push(row); } else { baselineByRuleHop.set(key, [row]); }

      const normalizedRule = this.normalizeFlowLabel(row.rule);
      if (!normalizedRule) continue;
      const normalizedKey = `${normalizedRule}|||${hop}`;
      const normalizedList = baselineByNormalizedRuleHop.get(normalizedKey);
      if (normalizedList) { normalizedList.push(row); } else { baselineByNormalizedRuleHop.set(normalizedKey, [row]); }
    }

    const mapped: typeof rangeRows = [];
    for (const row of rangeRows) {
      const parts = this.splitChainParts(row.chain);
      const alreadyFull = parts.length > 1 && this.findRuleIndexInChain(parts, row.rule) !== -1;
      if (alreadyFull) { mapped.push(row); continue; }

      const hop = this.getChainFirstHop(row.chain);
      const normalizedRule = this.normalizeFlowLabel(row.rule);
      const candidates = baselineByRuleHop.get(`${row.rule}|||${hop}`) ||
        (normalizedRule ? baselineByNormalizedRuleHop.get(`${normalizedRule}|||${hop}`) : undefined);
      if (!candidates || candidates.length === 0) { mapped.push(row); continue; }

      if (candidates.length === 1) {
        mapped.push({ rule: row.rule, chain: candidates[0].chain, totalUpload: row.totalUpload, totalDownload: row.totalDownload, totalConnections: row.totalConnections });
        continue;
      }

      const weights = candidates.map(c => { const t = c.totalUpload + c.totalDownload; return t > 0 ? t : Math.max(1, c.totalConnections); });
      const uploadParts = this.allocateByWeights(row.totalUpload, weights);
      const downloadParts = this.allocateByWeights(row.totalDownload, weights);
      const connParts = this.allocateByWeights(row.totalConnections, weights);
      for (let i = 0; i < candidates.length; i++) {
        mapped.push({ rule: row.rule, chain: candidates[i].chain, totalUpload: uploadParts[i] || 0, totalDownload: downloadParts[i] || 0, totalConnections: connParts[i] || 0 });
      }
    }
    return mapped;
  }

  /**
   * Expand short chains for rules using rule_chain_traffic
   */
  protected expandShortChainsForRules(backendId: number, chains: string[], rules: string[]): string[] {
    const normalizedChains = this.uniqueNonEmpty(chains);
    if (normalizedChains.length === 0) return [];

    const shortChains = normalizedChains.filter((c) => !c.includes(">"));
    if (shortChains.length === 0) return normalizedChains;

    const normalizedRules = this.uniqueNonEmpty(rules);
    const whereParts: string[] = [];
    const params: Array<string | number> = [backendId];

    if (normalizedRules.length > 0) {
      const rulePlaceholders = normalizedRules.map(() => "?").join(", ");
      whereParts.push(`rule IN (${rulePlaceholders})`);
      params.push(...normalizedRules);
    }

    const chainMatchers: string[] = [];
    for (const chain of shortChains) {
      chainMatchers.push("(chain = ? OR chain LIKE ?)");
      params.push(chain, `${chain} > %`);
    }
    whereParts.push(`(${chainMatchers.join(" OR ")})`);

    const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";
    const stmt = this.db.prepare(`
      SELECT DISTINCT chain FROM rule_chain_traffic WHERE backend_id = ? ${whereClause} LIMIT 500
    `);

    const rows = stmt.all(...params) as Array<{ chain: string }>;
    const expanded = this.uniqueNonEmpty(rows.map((r) => r.chain));
    if (expanded.length === 0) return normalizedChains;

    const fullInputChains = normalizedChains.filter((c) => c.includes(">"));
    return this.uniqueNonEmpty([...expanded, ...fullInputChains]);
  }

  /**
   * Allocate a total value by weights
   */
  protected allocateByWeights(total: number, weights: number[]): number[] {
    if (weights.length === 0) return [];
    const sum = weights.reduce((acc, w) => acc + w, 0);
    if (sum <= 0) {
      const base = Math.floor(total / weights.length);
      const result = new Array(weights.length).fill(base);
      let remainder = total - base * weights.length;
      for (let i = 0; i < result.length && remainder > 0; i++, remainder--) {
        result[i] += 1;
      }
      return result;
    }

    const raw = weights.map(w => (total * w) / sum);
    const floored = raw.map(v => Math.floor(v));
    let remainder = total - floored.reduce((acc, v) => acc + v, 0);
    const order = raw
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
      floored[order[k].i] += 1;
    }
    return floored;
  }
}
