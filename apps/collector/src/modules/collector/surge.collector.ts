import { isIPv4, isIPv6 } from "net";
import type { StatsDatabase } from "../db/db.js";
import { GeoIPService } from "../geo/geo.service.js";
import { TrafficWriteError } from "../clickhouse/clickhouse.writer.js";
import { realtimeStore } from "../realtime/realtime.store.js";
import type { SurgeRequest, SurgeRequestsData } from "@neko-master/shared";
import { calculateBackoffDelay } from "../../shared/utils/backoff.js";
import { BatchBuffer } from "./batch-buffer.js";
import { isPreexistingConnection } from "./connection-baseline.js";
import { describeGatewayError, gatewayFetch } from "../../shared/utils/gateway-fetch.js";

// Debug configuration
const DEBUG_SURGE = process.env.DEBUG_SURGE === "true";
const STALE_CONNECTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL = 2 * 60 * 1000; // 2 minutes

export interface SurgeCollectorOptions {
  url: string;
  token?: string;
  pollInterval?: number;
  onData?: (data: SurgeRequestsData) => void;
  onError?: (error: Error) => void;
}

export class SurgeCollector {
  private url: string;
  private token?: string;
  private pollInterval: number;
  private onData?: (data: SurgeRequestsData) => void;
  private onError?: (error: Error) => void;
  private pollTimer: NodeJS.Timeout | null = null;
  private isClosing = false;
  private backendId: number;
  private consecutiveErrors = 0;
  private readonly MAX_RETRY_ATTEMPTS = 5;
  private readonly MAX_RETRY_DELAY = 60000; // 1 minute
  private readonly BASE_RETRY_DELAY = 2000; // 2 seconds

  constructor(backendId: number, options: SurgeCollectorOptions) {
    this.backendId = backendId;
    this.url = options.url;
    this.token = options.token;
    this.pollInterval = options.pollInterval || 2000;
    this.onData = options.onData;
    this.onError = options.onError;
  }

  start() {
    if (this.isClosing) return;

    console.log(
      `[SurgeCollector:${this.backendId}] Starting polling ${this.url}...`
    );

    this.poll();
  }

  private async poll() {
    if (this.isClosing) return;

    try {
      const data = await this.fetchWithRetry();
      if (data) {
        this.onData?.(data);
        // Reset error counter on success
        if (this.consecutiveErrors > 0) {
          console.log(`[SurgeCollector:${this.backendId}] Recovered after ${this.consecutiveErrors} errors`);
          this.consecutiveErrors = 0;
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.consecutiveErrors++;
      console.error(
        `[SurgeCollector:${this.backendId}] Poll error (${this.consecutiveErrors}/${this.MAX_RETRY_ATTEMPTS}):`,
        describeGatewayError(error)
      );
      this.onError?.(error);
    }

    if (!this.isClosing) {
      // Calculate next poll delay with backoff if errors occurred
      const delay = this.consecutiveErrors > 0
        ? calculateBackoffDelay(
            this.consecutiveErrors - 1,
            this.BASE_RETRY_DELAY,
            this.MAX_RETRY_DELAY
          )
        : this.pollInterval;
      
      this.pollTimer = setTimeout(() => this.poll(), delay);
    }
  }

  private async fetchWithRetry(): Promise<SurgeRequestsData | null> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.fetchRequests();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        
        // Don't retry on 4xx errors (client errors)
        if (lastError.message.includes('HTTP 4')) {
          throw lastError;
        }

        // Last attempt failed
        if (attempt === this.MAX_RETRY_ATTEMPTS - 1) {
          break;
        }

        // Wait before retry
        const delay = calculateBackoffDelay(attempt, this.BASE_RETRY_DELAY, this.MAX_RETRY_DELAY);
        console.log(`[SurgeCollector:${this.backendId}] Retrying in ${delay}ms (attempt ${attempt + 2}/${this.MAX_RETRY_ATTEMPTS})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async fetchRequests(): Promise<SurgeRequestsData | null> {
    const url = this.url.endsWith("/v1/requests/recent")
      ? this.url
      : `${this.url}/v1/requests/recent`;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.token) {
      headers["x-key"] = this.token;
    }

    const response = await gatewayFetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json() as Promise<SurgeRequestsData>;
  }

  stop() {
    this.isClosing = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log(`[SurgeCollector:${this.backendId}] Stopped`);
  }
}

// Track request state with their accumulated traffic
interface TrackedRequest {
  id: string;
  domain: string;
  ip: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  lastUpload: number;
  lastDownload: number;
  totalUpload: number;
  totalDownload: number;
  sourceIP?: string;
  firstSeen: number;
  lastSeen: number;
  completed: boolean;
  disconnected: boolean;
  lastStatus?: string;
  counted: boolean;
  // Track if initial values have been processed
  initialProcessed: boolean;
}

// Recently completed request IDs to prevent double counting
// Surge may return completed requests in subsequent /v1/requests/recent calls
interface CompletedRequestInfo {
  id: string;
  finalUpload: number;
  finalDownload: number;
  completedAt: number;
}

/**
 * Extract policy decision path from Surge notes
 * Format: "Policy decision path: rule -> group1 -> group2 -> finalProxy"
 * Returns array: [finalProxy, ..., group2, group1, rule] (reversed for Clash format)
 */
function extractPolicyPathFromNotes(notes?: string[]): string[] {
  if (!notes || notes.length === 0) return [];
  
  for (const note of notes) {
    const match = note.match(/\[Rule\] Policy decision path: (.+)/);
    if (match) {
      const path = match[1].split(" -> ").map(s => s.trim()).filter(Boolean);
      if (path.length >= 2) {
        // Reverse to match Clash format: [finalProxy, ..., group2, group1, rule]
        return path.reverse();
      }
    }
  }
  return [];
}

/**
 * Convert Surge request to chains array
 * Surge: policyName is the final proxy
 * From notes: "rule -> group1 -> group2 -> finalProxy"
 * Clash format: chains[0] = first proxy, chains[last] = rule name
 */
function convertSurgeChains(
  policyName: string,
  originalPolicyName: string,
  notes?: string[]
): string[] {
  // Try to extract full path from notes
  const pathFromNotes = extractPolicyPathFromNotes(notes);
  if (pathFromNotes.length >= 2) {
    return pathFromNotes;
  }
  
  // Fallback: use policyName and originalPolicyName
  const chains: string[] = [];
  if (policyName) {
    chains.push(policyName);
  }
  if (originalPolicyName && originalPolicyName !== policyName) {
    chains.push(originalPolicyName);
  }
  if (chains.length === 0) {
    chains.push("DIRECT");
  }
  return chains;
}

export function createSurgeCollector(
  db: StatsDatabase,
  url: string,
  token?: string,
  geoService?: GeoIPService,
  onTrafficUpdate?: () => void,
  backendId?: number
) {
  const id = backendId || 0;
  const activeRequests = new Map<string, TrackedRequest>();
  const batchBuffer = new BatchBuffer();
  const startedAt = Date.now();

  // Track recently completed requests to prevent double counting
  // Key: request ID, Value: completion timestamp
  const recentlyCompleted = new Map<string, CompletedRequestInfo>();
  const COMPLETED_REQUEST_TTL = 5 * 60 * 1000; // Keep for 5 minutes
  
  let lastBroadcastTime = 0;
  const broadcastThrottleMs = 500;
  let flushInterval: NodeJS.Timeout | null = null;
  let cleanupInterval: NodeJS.Timeout | null = null;
  const FLUSH_INTERVAL_MS = parseInt(process.env.FLUSH_INTERVAL_MS || "30000");
  const FLUSH_MAX_BUFFER_SIZE = parseInt(
    process.env.FLUSH_MAX_BUFFER_SIZE || "5000"
  );
  let isFlushing = false;
  let lastPruneTime = 0;
  const PRUNE_INTERVAL_MS = 60_000;
  let newConnectionsCount = 0;
  let completedConnectionsCount = 0;

  // Clean up stale connections that haven't been updated for a while
  const cleanupStaleConnections = () => {
    const now = Date.now();
    let cleaned = 0;
    for (const [reqId, req] of activeRequests) {
      if (now - req.lastSeen > STALE_CONNECTION_TIMEOUT) {
        activeRequests.delete(reqId);
        cleaned++;
      }
    }
    
    // Also clean up old completed request records
    let completedCleaned = 0;
    for (const [reqId, info] of recentlyCompleted) {
      if (now - info.completedAt > COMPLETED_REQUEST_TTL) {
        recentlyCompleted.delete(reqId);
        completedCleaned++;
      }
    }
    
    if ((cleaned > 0 || completedCleaned > 0) && DEBUG_SURGE) {
      console.log(`[SurgeCollector:${id}] Cleaned up ${cleaned} stale connections, ${completedCleaned} completed records`);
    }
  };

  const flushBatch = async () => {
    if (isFlushing || !batchBuffer.hasPending()) {
      return;
    }

    isFlushing = true;
    try {
      const stats = batchBuffer.flush(db, geoService, id, "SurgeCollector");

      let trafficDetailOk = true;
      let trafficAggOk = true;
      if (stats.pendingTrafficWrite) {
        try {
          const outcome = await stats.pendingTrafficWrite;
          trafficDetailOk = outcome.detailOk;
          trafficAggOk = outcome.aggOk;
        } catch (err) {
          if (err instanceof TrafficWriteError) {
            trafficDetailOk = err.detailOk;
            trafficAggOk = err.aggOk;
          } else {
            trafficDetailOk = false;
            trafficAggOk = false;
          }
          console.warn(
            `[SurgeCollector:${id}] ClickHouse traffic write failed detail_ok=${trafficDetailOk} agg_ok=${trafficAggOk}`,
            err,
          );
        }
      }

      // Durable fallback: SQLite writes were skipped because ClickHouse was
      // considered healthy, but the ClickHouse write failed. Persist the
      // snapshot to SQLite so the data is not silently lost.
      if (
        stats.hasTrafficUpdates &&
        stats.trafficOk &&
        stats.sqliteSkipped &&
        (!trafficDetailOk || !trafficAggOk)
      ) {
        try {
          db.batchUpdateTrafficStats(id, stats.updates, false);
          trafficDetailOk = true;
          trafficAggOk = true;
          console.warn(
            `[SurgeCollector:${id}] ClickHouse traffic write failed; persisted ${stats.updates.length} updates to SQLite as fallback`,
          );
        } catch (fallbackErr) {
          console.error(
            `[SurgeCollector:${id}] SQLite fallback for traffic also failed; retaining realtime store`,
            fallbackErr,
          );
        }
      }

      if (stats.hasTrafficUpdates && stats.trafficOk) {
        if (trafficDetailOk && trafficAggOk) {
          realtimeStore.clearTraffic(id);
        } else if (trafficDetailOk && !trafficAggOk) {
          realtimeStore.clearTrafficDimensions(id);
        } else if (!trafficDetailOk && trafficAggOk) {
          realtimeStore.clearTrafficSummary(id);
        }
      }

      let countryWriteOk = true;
      if (stats.pendingCountryWrite) {
        try {
          await stats.pendingCountryWrite;
        } catch (err) {
          countryWriteOk = false;
          console.warn(
            `[SurgeCollector:${id}] ClickHouse country write failed, keeping realtime country store`,
            err,
          );
        }
      }

      if (
        stats.hasCountryUpdates &&
        stats.countryOk &&
        stats.sqliteSkipped &&
        !countryWriteOk
      ) {
        try {
          db.batchUpdateCountryStats(id, stats.countryUpdates);
          countryWriteOk = true;
          console.warn(
            `[SurgeCollector:${id}] ClickHouse country write failed; persisted to SQLite as fallback`,
          );
        } catch (fallbackErr) {
          console.error(
            `[SurgeCollector:${id}] SQLite fallback for country also failed; retaining realtime store`,
            fallbackErr,
          );
        }
      }

      if (stats.hasCountryUpdates && stats.countryOk && countryWriteOk) {
        realtimeStore.clearCountries(id);
      }

      if (batchBuffer.shouldLog() && (stats.domains > 0 || stats.rules > 0)) {
        console.log(
          `[SurgeCollector:${id}] Active: ${activeRequests.size}, New: ${newConnectionsCount}, Completed: ${completedConnectionsCount}, Domains: ${stats.domains}, Rules: ${stats.rules}`
        );
        // Reset counters
        newConnectionsCount = 0;
        completedConnectionsCount = 0;
      }
    } finally {
      isFlushing = false;
    }

    // Periodic memory bounds check on realtime store
    const pruneNow = Date.now();
    if (pruneNow - lastPruneTime > PRUNE_INTERVAL_MS) {
      lastPruneTime = pruneNow;
      realtimeStore.pruneIfNeeded(id);
    }
  };

  flushInterval = setInterval(() => {
    flushBatch();
  }, FLUSH_INTERVAL_MS);

  // Start cleanup interval for stale connections
  cleanupInterval = setInterval(() => {
    cleanupStaleConnections();
  }, CLEANUP_INTERVAL);

  const collector = new SurgeCollector(id, {
    url,
    token,
    onData: (data) => {
      if (!data) {
        console.warn(`[SurgeCollector:${id}] Received null/undefined data`);
        return;
      }

      if (!data.requests) {
        return;
      }

      if (!Array.isArray(data.requests)) {
        console.warn(
          `[SurgeCollector:${id}] Invalid requests format: ${typeof data.requests}`
        );
        return;
      }

      const now = Date.now();
      const currentIds = new Set(
        data.requests.map((r) => r?.id).filter(Boolean)
      );
      let hasNewTraffic = false;
      let baselinedRequests = 0;
      const geoBatchByIp = new Map<
        string,
        { upload: number; download: number; connections: number }
      >();

      // Track connections that are completing in this poll
      const completingRequests = new Set<string>();

      for (const req of data.requests) {
        if (!req || typeof req !== "object") {
          continue;
        }

        if (!req.id) {
          continue;
        }

        const remoteHost = req.remoteHost || "";
        // remoteAddress format: "1.2.3.4 (Proxy)" or "1.2.3.4"
        // 
        // IMPORTANT: Surge's DNS resolution happens at the proxy server, not locally.
        // When using a proxy:
        // - remoteHost = target domain
        // - remoteAddress = proxy node's IP (NOT the target's resolved IP)
        // 
        // Surge does NOT provide the real landing IP in its API, because:
        // 1. Surge sends the domain to the proxy server
        // 2. Proxy server performs DNS resolution
        // 3. Surge only knows the proxy node's IP
        //
        // Therefore, for proxy traffic, we can only show the proxy node IP, not the real landing IP.
        const remoteAddress = req.remoteAddress
          ? req.remoteAddress.split(" ")[0].trim()
          : "";
        const hostWithoutPort = extractHost(remoteHost);
        const domain = isDomain(remoteHost) ? hostWithoutPort : "";
        // Use remoteHost if it's an IP (direct connection), otherwise use remoteAddress (proxy node IP)
        const ip = isIP(remoteHost)
          ? hostWithoutPort
          : isIP(remoteAddress)
            ? remoteAddress
            : "";
        const sourceIP = req.localAddress || "";

        // For Surge:
        // - policyName = final proxy (e.g., "🇺🇸 US-SJC-IEPL")
        // - originalPolicyName = usually same as policyName
        // - req.rule = rule type (e.g., "FINAL", "RULE-SET")
        // - notes contains full path: "rule -> group1 -> group2 -> finalProxy"
        //
        // We extract the full policy path from notes to get:
        // chains = [finalProxy, ..., group2, group1, rule]
        // rule = first element of path (the actual rule name like "🐟 漏网之鱼")
        const chains = convertSurgeChains(
          req.policyName,
          req.originalPolicyName,
          req.notes
        );

        // rule = last element of chains (the rule name like "🐟 漏网之鱼")
        // rulePayload = req.rule for reference (like "FINAL")
        const rule = chains.length > 0 ? chains[chains.length - 1] : (req.originalPolicyName || 'Match');
        const rulePayload = req.rule || '';

        const isCompleted = req.completed === true;
        const isDisconnected = req.disconnected === true;
        const isFailed = req.failed === true;

        // Check if this request was recently completed (prevent double counting)
        const completedInfo = recentlyCompleted.get(req.id);
        if (completedInfo) {
          // This request was already processed and completed
          // Only process if it has new traffic (shouldn't happen for completed requests)
          const currentUpload = req.outBytes || 0;
          const currentDownload = req.inBytes || 0;
          
          if (currentUpload <= completedInfo.finalUpload && currentDownload <= completedInfo.finalDownload) {
            // No new traffic, skip this request entirely
            if (DEBUG_SURGE) {
              console.log(`[SurgeCollector:${id}] Skipping completed request: ${req.id}`);
            }
            continue;
          }
          // If somehow there's new traffic, remove from completed and re-process
          recentlyCompleted.delete(req.id);
        }

        const existing = activeRequests.get(req.id);
        const currentUpload = req.outBytes || 0;
        const currentDownload = req.inBytes || 0;

        if (!existing) {
          // New connection - record initial state AND initial traffic
          // IMPORTANT: We now record initial traffic immediately to prevent data loss
          // for short-lived connections that disappear before the next poll.
          // The recentlyCompleted map prevents double counting if the same request reappears.
          // Requests that started before this collector (including completed
          // ones still listed in /v1/requests/recent) only set a baseline:
          // their cumulative bytes predate us (issue #50).
          const preexisting = isPreexistingConnection(req.startDate, startedAt);
          const hasInitialTraffic =
            !preexisting && (currentUpload > 0 || currentDownload > 0);
          if (preexisting) baselinedRequests++;
          activeRequests.set(req.id, {
            id: req.id,
            domain,
            ip,
            chains,
            rule,
            rulePayload,
            lastUpload: currentUpload,
            lastDownload: currentDownload,
            totalUpload: currentUpload,   // Record initial traffic
            totalDownload: currentDownload,
            sourceIP,
            firstSeen: now,
            lastSeen: now,
            completed: isCompleted,
            disconnected: isDisconnected,
            lastStatus: req.status,
            counted: hasInitialTraffic || preexisting,
            initialProcessed: true,  // Mark as processed
          });

          newConnectionsCount++;

          if (DEBUG_SURGE) {
            console.log(`[SurgeCollector:${id}] New connection: ${req.id}, domain: ${domain || 'N/A'}, ip: ${ip || 'N/A'}, initial: ↑${currentUpload} ↓${currentDownload}`);
          }

          // Record initial traffic if non-zero
          if (hasInitialTraffic) {
            const connections = 1;
            batchBuffer.add(id, {
              domain,
              ip,
              chain: chains[0] || "DIRECT",
              chains,
              rule: rule || "Match",
              rulePayload: rulePayload || "",
              upload: currentUpload,
              download: currentDownload,
              connections,
              sourceIP,
              timestampMs: req.time || now,
            });
            realtimeStore.recordTraffic(
              id,
              {
                domain,
                ip,
                sourceIP,
                chains,
                rule: rule || "Match",
                rulePayload: rulePayload || "",
                upload: currentUpload,
                download: currentDownload,
              },
              connections,
              now
            );

            // Queue GeoIP lookup for initial traffic
            if (geoService && ip) {
              const existingGeo = geoBatchByIp.get(ip) || {
                upload: 0,
                download: 0,
                connections: 0,
              };
              existingGeo.upload += currentUpload;
              existingGeo.download += currentDownload;
              existingGeo.connections += connections;
              geoBatchByIp.set(ip, existingGeo);
            }

            hasNewTraffic = true;
          }
        } else {
          // Existing connection - calculate delta
          let uploadDelta: number;
          let downloadDelta: number;

          // Detect counter reset (connection restart/reuse)
          if (currentUpload < existing.lastUpload || currentDownload < existing.lastDownload) {
            // Counter was reset - treat current value as new traffic
            uploadDelta = currentUpload;
            downloadDelta = currentDownload;
            existing.counted = false;
            if (DEBUG_SURGE) {
              console.log(`[SurgeCollector:${id}] Counter reset detected: ${req.id}`);
            }
          } else {
            // Normal delta calculation
            uploadDelta = currentUpload - existing.lastUpload;
            downloadDelta = currentDownload - existing.lastDownload;
          }

          // Update tracking state
          existing.lastUpload = currentUpload;
          existing.lastDownload = currentDownload;
          existing.lastSeen = now;
          existing.lastStatus = req.status;
          existing.initialProcessed = true;

          // Check if connection is completing
          const wasCompleted = existing.completed;
          if ((isCompleted || isDisconnected || isFailed) && !existing.completed) {
            existing.completed = true;
            completingRequests.add(req.id);
            completedConnectionsCount++;

            if (DEBUG_SURGE) {
              console.log(`[SurgeCollector:${id}] Connection completing: ${req.id}, total: ↑${existing.totalUpload + uploadDelta} ↓${existing.totalDownload + downloadDelta}`);
            }
          }

          // Only record if there's actual new traffic
          if (uploadDelta > 0 || downloadDelta > 0) {
            const connections = existing.counted ? 0 : 1;
            if (connections > 0) {
              existing.counted = true;
            }
            existing.totalUpload += uploadDelta;
            existing.totalDownload += downloadDelta;

            batchBuffer.add(id, {
              domain: existing.domain,
              ip: existing.ip,
              chain: existing.chains[0] || "DIRECT",
              chains: existing.chains,
              rule: existing.rule || "Match",
              rulePayload: existing.rulePayload || "",
              upload: uploadDelta,
              download: downloadDelta,
              connections,
              sourceIP: existing.sourceIP,
              timestampMs: req.time || now,
            });
            realtimeStore.recordTraffic(
              id,
              {
                domain: existing.domain,
                ip: existing.ip,
                sourceIP: existing.sourceIP,
                chains: existing.chains,
                rule: existing.rule || "Match",
                rulePayload: existing.rulePayload || "",
                upload: uploadDelta,
                download: downloadDelta,
              },
              connections,
              now
            );

            if (geoService && existing.ip) {
              const existingGeo = geoBatchByIp.get(existing.ip) || {
                upload: 0,
                download: 0,
                connections: 0,
              };
              existingGeo.upload += uploadDelta;
              existingGeo.download += downloadDelta;
              existingGeo.connections += connections;
              geoBatchByIp.set(existing.ip, existingGeo);
            }

            hasNewTraffic = true;
          }

          // If connection just completed, record it to prevent double counting
          if (existing.completed && !wasCompleted) {
            recentlyCompleted.set(req.id, {
              id: req.id,
              finalUpload: existing.totalUpload,
              finalDownload: existing.totalDownload,
              completedAt: now,
            });
          }
        }
      }

      if (baselinedRequests > 0) {
        console.info(
          `[SurgeCollector:${id}] Baselined ${baselinedRequests} request(s) started before collector start; prior cumulative traffic not counted`,
        );
      }

      // Clean up completed/disappeared connections
      for (const [reqId, trackedReq] of activeRequests) {
        if (!currentIds.has(reqId)) {
          // Connection disappeared from Surge's recent list
          if (DEBUG_SURGE) {
            console.log(`[SurgeCollector:${id}] Connection disappeared: ${reqId}, lasted ${Date.now() - trackedReq.firstSeen}ms, total: ↑${trackedReq.totalUpload} ↓${trackedReq.totalDownload}`);
          }
          
          // Record completed connection to prevent double counting if it reappears
          if (!recentlyCompleted.has(reqId)) {
            recentlyCompleted.set(reqId, {
              id: reqId,
              finalUpload: trackedReq.totalUpload,
              finalDownload: trackedReq.totalDownload,
              completedAt: now,
            });
          }
          
          activeRequests.delete(reqId);
        }
      }

      if (geoService && geoBatchByIp.size > 0) {
        for (const [ip, traffic] of geoBatchByIp) {
          geoService
            .getGeoLocation(ip)
            .then((geo) => {
              if (geo) {
                batchBuffer.addGeoResult({
                  ip,
                  geo,
                  upload: traffic.upload,
                  download: traffic.download,
                  connections: traffic.connections,
                  timestampMs: now,
                });
                realtimeStore.recordCountryTraffic(
                  id,
                  geo,
                  traffic.upload,
                  traffic.download,
                  traffic.connections,
                  now
                );
              }
            })
            .catch(() => {
              // Silently fail for GeoIP errors
            });
        }
      }

      if (batchBuffer.size() >= FLUSH_MAX_BUFFER_SIZE) {
        flushBatch();
      }

      if (
        hasNewTraffic &&
        onTrafficUpdate &&
        now - lastBroadcastTime > broadcastThrottleMs
      ) {
        lastBroadcastTime = now;
        onTrafficUpdate();
      }
    },
    onError: (err) => {
      console.error(`[SurgeCollector:${id}] Error:`, err);
    },
  });

  const originalStop = collector.stop.bind(collector);
  const waitForFlushThenStop = async () => {
    while (isFlushing) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await flushBatch();
  };
  collector.stop = () => {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    void waitForFlushThenStop().finally(() => {
      originalStop();
    });
  };

  // Add debug stats method
  (collector as any).getDebugStats = () => {
    const now = Date.now();
    const connections = Array.from(activeRequests.values()).map(r => ({
      id: r.id,
      domain: r.domain,
      ip: r.ip,
      duration: now - r.firstSeen,
      lastActivity: now - r.lastSeen,
      totalUpload: r.totalUpload,
      totalDownload: r.totalDownload,
      completed: r.completed,
      status: r.lastStatus,
    }));

    return {
      activeConnections: activeRequests.size,
      newConnectionsThisPoll: newConnectionsCount,
      completedConnectionsThisPoll: completedConnectionsCount,
      bufferSize: batchBuffer.size(),
      connections: DEBUG_SURGE ? connections : undefined,
    };
  };

  const collectorWithReset = collector as SurgeCollector & {
    clearRuntimeState?: () => void;
  };
  collectorWithReset.clearRuntimeState = () => {
    // Keep active request baselines to avoid replaying historical cumulative
    // counters after a DB/log wipe. Only clear pending in-memory deltas.
    batchBuffer.clear();
  };

  return collectorWithReset;
}

/**
 * Extract host without port from a host:port string
 */
function extractHost(hostWithPort: string): string {
  if (!hostWithPort) return "";
  // Handle IPv6 addresses like [2001:db8::1]:443
  if (hostWithPort.startsWith("[")) {
    const closingBracket = hostWithPort.indexOf("]");
    if (closingBracket !== -1) {
      return hostWithPort.slice(1, closingBracket);
    }
  }
  // Handle IPv4:port or domain:port
  const lastColon = hostWithPort.lastIndexOf(":");
  if (lastColon !== -1) {
    // Check if it's an IPv6 without brackets (multiple colons)
    // IPv6 has multiple colons, while IPv4:port or domain:port has only one
    const colonCount = hostWithPort.split(":").length - 1;
    if (colonCount > 1) {
      // Multiple colons, likely IPv6 without port
      return hostWithPort;
    }
    return hostWithPort.slice(0, lastColon);
  }
  return hostWithPort;
}

function isDomain(host: string): boolean {
  if (!host) return false;
  // Remove port if present
  const hostWithoutPort = extractHost(host);
  if (isIP(hostWithoutPort)) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
    hostWithoutPort
  );
}

function isIP(host: string): boolean {
  if (!host) return false;
  // Remove port if present
  const hostWithoutPort = extractHost(host);
  return isIPv4(hostWithoutPort) || isIPv6(hostWithoutPort);
}
