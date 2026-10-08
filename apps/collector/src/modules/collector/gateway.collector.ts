import WebSocket from "ws";
import type { ConnectionsData } from "@neko-master/shared";
import { StatsDatabase } from "../db/db.js";
import { GeoIPService } from "../geo/geo.service.js";
import { TrafficWriteError } from "../clickhouse/clickhouse.writer.js";
import { realtimeStore } from "../realtime/realtime.store.js";
import { calculateBackoffDelay } from "../../shared/utils/backoff.js";
import { BatchBuffer } from "./batch-buffer.js";
import { isPreexistingConnection } from "./connection-baseline.js";
import { gatewayWsTlsOptions } from "../../shared/utils/gateway-fetch.js";

// Stale connection cleanup constants
const STALE_CONNECTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL = 2 * 60 * 1000; // 2 minutes

// Heartbeat watchdog: detect silently dropped TCP connections (gateway/router
// restart, NAT timeout) that never surface a WS "error"/"close" event. We ping
// the backend periodically and track when a frame last arrived; if the link
// stays silent past the timeout we force-terminate it so the existing
// reconnect logic kicks in. See issue #74.
const DEFAULT_HEARTBEAT_INTERVAL = 10_000; // ping + liveness check cadence (ms)
const DEFAULT_HEARTBEAT_TIMEOUT = 30_000; // terminate after this much silence (ms)

// Stash uses { current, max, total, last } counters instead of Clash's numbers.
// Normalize at the gateway boundary so batching and realtime deltas share the
// same cumulative byte counts.
function normalizeCounter(value: unknown): number {
  const total = value && typeof value === "object" && "total" in value
    ? value.total
    : value;
  return typeof total === "number" && Number.isFinite(total) && total >= 0
    ? total
    : 0;
}

function normalizeConnections(data: ConnectionsData): ConnectionsData {
  if (!Array.isArray(data?.connections)) return data;
  return {
    ...data,
    connections: data.connections.map((connection) => {
      if (!connection || typeof connection !== "object") return connection;
      return {
        ...connection,
        id: typeof connection.id === "number" ? String(connection.id) : connection.id,
        upload: normalizeCounter(connection.upload),
        download: normalizeCounter(connection.download),
      };
    }),
  };
}

export interface CollectorOptions {
  url: string;
  token?: string;
  reconnectInterval?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  onData?: (data: ConnectionsData) => void;
  onError?: (error: Error) => void;
}

export class GatewayCollector {
  private ws: WebSocket | null = null;
  private url: string;
  private token?: string;
  private reconnectInterval: number;
  private maxReconnectInterval: number;
  private reconnectAttempts = 0;
  private heartbeatInterval: number;
  private heartbeatTimeout: number;
  private onData?: (data: ConnectionsData) => void;
  private onError?: (error: Error) => void;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastActivity = 0;
  private isClosing = false;
  private backendId: number;

  constructor(backendId: number, options: CollectorOptions) {
    this.backendId = backendId;
    this.url = options.url;
    this.token = options.token;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.maxReconnectInterval = Math.max(
      this.reconnectInterval,
      parseInt(process.env.WS_MAX_RECONNECT_INTERVAL_MS || "60000", 10) || 60000,
    );
    this.heartbeatInterval =
      options.heartbeatInterval ??
      parseInt(
        process.env.WS_HEARTBEAT_INTERVAL_MS || `${DEFAULT_HEARTBEAT_INTERVAL}`,
      );
    this.heartbeatTimeout =
      options.heartbeatTimeout ??
      parseInt(
        process.env.WS_HEARTBEAT_TIMEOUT_MS || `${DEFAULT_HEARTBEAT_TIMEOUT}`,
      );
    this.onData = options.onData;
    this.onError = options.onError;
  }

  connect() {
    if (this.isClosing) return;

    console.log(`[Collector:${this.backendId}] Connecting to ${this.url}...`);

    const headers: Record<string, string> = {
      Origin: this.url
        .replace("ws://", "http://")
        .replace("wss://", "https://"),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    this.ws = new WebSocket(this.url, {
      headers,
      followRedirects: true,
      ...gatewayWsTlsOptions(),
    });

    this.ws.on("open", () => {
      console.log(`[Collector:${this.backendId}] WebSocket connected`);
      this.reconnectAttempts = 0;
      this.startHeartbeat();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      this.lastActivity = Date.now();
      try {
        const json = JSON.parse(data.toString()) as ConnectionsData;
        this.onData?.(normalizeConnections(json));
      } catch (err) {
        console.error(
          `[Collector:${this.backendId}] Failed to parse message:`,
          err,
        );
      }
    });

    this.ws.on("pong", () => {
      this.lastActivity = Date.now();
    });

    this.ws.on("error", (err) => {
      console.error(
        `[Collector:${this.backendId}] WebSocket error:`,
        err.message,
      );
      this.onError?.(err);
    });

    this.ws.on("close", (code, reason) => {
      this.stopHeartbeat();
      console.log(
        `[Collector:${this.backendId}] WebSocket closed: ${code} ${reason}`,
      );
      if (!this.isClosing) {
        this.scheduleReconnect();
      }
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastActivity = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws) return;

      const idle = Date.now() - this.lastActivity;
      if (idle > this.heartbeatTimeout) {
        console.warn(
          `[Collector:${this.backendId}] No data for ${idle}ms (timeout ` +
            `${this.heartbeatTimeout}ms); terminating dead connection`,
        );
        // terminate() forces an immediate close with no closing handshake and
        // emits "close", which runs scheduleReconnect().
        ws.terminate();
        return;
      }

      // Probe liveness; a live peer answers with a pong that refreshes
      // lastActivity. A half-dead socket stays silent and trips the timeout.
      try {
        ws.ping();
      } catch {
        // Socket already unusable; the timeout branch will reconnect it.
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    // Exponential backoff with jitter so a down/flapping backend is not
    // hammered every 5s in lockstep across collectors (thundering herd).
    const delay = calculateBackoffDelay(
      this.reconnectAttempts,
      this.reconnectInterval,
      this.maxReconnectInterval,
    );
    this.reconnectAttempts += 1;
    console.log(
      `[Collector:${this.backendId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect() {
    this.isClosing = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log(`[Collector:${this.backendId}] Disconnected`);
  }
}

// Track connection state with their accumulated traffic
interface TrackedConnection {
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
  counted: boolean;
  sourceIP?: string;
  lastSeen: number;
}

export function createCollector(
  db: StatsDatabase,
  url: string,
  token?: string,
  geoService?: GeoIPService,
  onTrafficUpdate?: () => void,
  backendId?: number, // Backend ID for data isolation
) {
  const id = backendId || 0;
  const activeConnections = new Map<string, TrackedConnection>();
  const startedAt = Date.now();
  const batchBuffer = new BatchBuffer();
  let lastBroadcastTime = 0;
  const broadcastThrottleMs = 500;
  let flushInterval: NodeJS.Timeout | null = null;
  let cleanupInterval: NodeJS.Timeout | null = null;
  const FLUSH_INTERVAL_MS = parseInt(process.env.FLUSH_INTERVAL_MS || "30000");
  const FLUSH_MAX_BUFFER_SIZE = parseInt(
    process.env.FLUSH_MAX_BUFFER_SIZE || "5000",
  );
  let isFlushing = false;
  let lastPruneTime = 0;
  const PRUNE_INTERVAL_MS = 60_000; // Check memory bounds every 60s

  // Clean up stale connections that haven't been updated for a while
  const cleanupStaleConnections = () => {
    const now = Date.now();
    let cleaned = 0;
    for (const [connId, conn] of activeConnections) {
      if (now - conn.lastSeen > STALE_CONNECTION_TIMEOUT) {
        activeConnections.delete(connId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[Collector:${id}] Cleaned up ${cleaned} stale connections`);
    }
  };

  const flushBatch = async () => {
    if (isFlushing || !batchBuffer.hasPending()) {
      return;
    }

    isFlushing = true;
    try {
      const stats = batchBuffer.flush(db, geoService, id, "Collector");

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
            `[Collector:${id}] ClickHouse traffic write failed detail_ok=${trafficDetailOk} agg_ok=${trafficAggOk}`,
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
            `[Collector:${id}] ClickHouse traffic write failed; persisted ${stats.updates.length} updates to SQLite as fallback`,
          );
        } catch (fallbackErr) {
          console.error(
            `[Collector:${id}] SQLite fallback for traffic also failed; retaining realtime store`,
            fallbackErr,
          );
        }
      }

      if (stats.hasTrafficUpdates && stats.trafficOk) {
        if (trafficDetailOk && trafficAggOk) {
          realtimeStore.clearTraffic(id);
        } else if (trafficDetailOk && !trafficAggOk) {
          // Detail committed, agg failed: clear detail-side realtime only.
          realtimeStore.clearTrafficDimensions(id);
        } else if (!trafficDetailOk && trafficAggOk) {
          // Agg committed, detail failed: clear summary-side realtime only.
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
            `[Collector:${id}] ClickHouse country write failed, keeping realtime country store`,
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
            `[Collector:${id}] ClickHouse country write failed; persisted to SQLite as fallback`,
          );
        } catch (fallbackErr) {
          console.error(
            `[Collector:${id}] SQLite fallback for country also failed; retaining realtime store`,
            fallbackErr,
          );
        }
      }

      if (stats.hasCountryUpdates && stats.countryOk && countryWriteOk) {
        realtimeStore.clearCountries(id);
      }

      if (batchBuffer.shouldLog() && (stats.domains > 0 || stats.rules > 0)) {
        console.log(
          `[Collector:${id}] Active: ${activeConnections.size}, Domains: ${stats.domains}, Rules: ${stats.rules}`,
        );
      }
    } finally {
      isFlushing = false;
    }

    // Periodic memory bounds check on realtime store
    const now = Date.now();
    if (now - lastPruneTime > PRUNE_INTERVAL_MS) {
      lastPruneTime = now;
      realtimeStore.pruneIfNeeded(id);
    }
  };

  // Start batch flush interval
  flushInterval = setInterval(() => {
    flushBatch();
  }, FLUSH_INTERVAL_MS);

  // Start cleanup interval for stale connections
  cleanupInterval = setInterval(() => {
    cleanupStaleConnections();
  }, CLEANUP_INTERVAL);

  const collector = new GatewayCollector(id, {
    url,
    token,
    onData: (data) => {
      // Validate data format - be more lenient
      if (!data) {
        console.warn(`[Collector:${id}] Received null/undefined data`);
        return;
      }

      // Some backends send empty messages or keepalive packets
      if (!data.connections) {
        // Silently ignore - this is normal for some backends
        return;
      }

      if (!Array.isArray(data.connections)) {
        console.warn(
          `[Collector:${id}] Invalid connections format: ${typeof data.connections}`,
        );
        return;
      }

      const now = Date.now();
      const currentIds = new Set(
        data.connections.map((c) => c?.id).filter(Boolean),
      );
      let hasNewTraffic = false;
      let counterResets = 0;
      let baselinedConnections = 0;
      const geoBatchByIp = new Map<
        string,
        { upload: number; download: number; connections: number }
      >();

      // Process all current connections
      for (const conn of data.connections) {
        // Skip invalid connection entries - be more lenient
        if (!conn || typeof conn !== "object") {
          continue;
        }

        // Some backends may not have all fields
        if (!conn.id) {
          continue;
        }

        // Ensure metadata exists with defaults
        const metadata = conn.metadata || {};
        const domain = metadata.host || metadata.sniffHost || "";
        const ip = metadata.destinationIP || "";
        const sourceIP = metadata.sourceIP || "";
        const chains = Array.isArray(conn.chains) ? conn.chains : ["DIRECT"];
        const rule = conn.rule || "Match";
        const rulePayload = conn.rulePayload || "";

        const existing = activeConnections.get(conn.id);

        if (!existing) {
          // New connection - track it and record initial traffic. Connections
          // opened before this collector started only set a baseline: their
          // cumulative counters predate us (issue #50).
          const preexisting = isPreexistingConnection(conn.start, startedAt);
          const hasInitialTraffic =
            !preexisting && (conn.upload > 0 || conn.download > 0);
          if (preexisting) baselinedConnections++;
          activeConnections.set(conn.id, {
            id: conn.id,
            domain,
            ip,
            chains,
            rule,
            rulePayload,
            lastUpload: conn.upload,
            lastDownload: conn.download,
            totalUpload: conn.upload,
            totalDownload: conn.download,
            // A preexisting connection that already moved bytes was counted by
            // whoever watched it before us; an idle one still counts once it
            // first moves traffic.
            counted:
              hasInitialTraffic ||
              (preexisting && (conn.upload > 0 || conn.download > 0)),
            sourceIP,
            lastSeen: now,
          });

          // Record initial traffic for new connection (add to batch buffer)
          if (hasInitialTraffic) {
            const connections = 1;
            batchBuffer.add(id, {
              domain,
              ip,
              chain: chains[0] || "DIRECT",
              chains,
              rule,
              rulePayload,
              upload: conn.upload,
              download: conn.download,
              connections,
              sourceIP,
              timestampMs: now,
            });
            realtimeStore.recordTraffic(
              id,
              {
                domain,
                ip,
                sourceIP,
                chains,
                rule,
                rulePayload,
                upload: conn.upload,
                download: conn.download,
              },
              connections,
              now
            );

            // Aggregate GeoIP lookup payload by destination IP per batch.
            if (geoService && ip) {
              const existingGeo = geoBatchByIp.get(ip) || {
                upload: 0,
                download: 0,
                connections: 0,
              };
              existingGeo.upload += conn.upload;
              existingGeo.download += conn.download;
              existingGeo.connections += connections;
              geoBatchByIp.set(ip, existingGeo);
            }

            hasNewTraffic = true;
          }
        } else {
          // Existing connection - calculate delta and add to batch
          let uploadDelta: number;
          let downloadDelta: number;
          if (
            conn.upload < existing.lastUpload ||
            conn.download < existing.lastDownload
          ) {
            // Counter reset (backend restart / connection id reuse) - treat
            // current value as new traffic instead of silently dropping it.
            uploadDelta = conn.upload;
            downloadDelta = conn.download;
            existing.counted = false;
            counterResets++;
          } else {
            uploadDelta = conn.upload - existing.lastUpload;
            downloadDelta = conn.download - existing.lastDownload;
          }

          // Refresh tracking state even when idle so open connections are not
          // evicted as stale and later re-counted from their cumulative totals.
          existing.lastUpload = conn.upload;
          existing.lastDownload = conn.download;
          existing.lastSeen = now;

          if (uploadDelta > 0 || downloadDelta > 0) {
            const connections = existing.counted ? 0 : 1;
            if (connections > 0) {
              existing.counted = true;
            }
            // Update accumulated traffic for this connection
            existing.totalUpload += uploadDelta;
            existing.totalDownload += downloadDelta;

            // Add delta to batch buffer
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
              timestampMs: now,
            });
            realtimeStore.recordTraffic(
              id,
              {
                domain: existing.domain,
                ip: existing.ip,
                sourceIP: existing.sourceIP,
                chains: existing.chains,
                rule: existing.rule || 'Match',
                rulePayload: existing.rulePayload || '',
                upload: uploadDelta,
                download: downloadDelta,
              },
              connections,
              now
            );

            // Aggregate GeoIP lookup payload by destination IP per batch.
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
        }
      }

      if (baselinedConnections > 0) {
        console.info(
          `[Collector:${id}] Baselined ${baselinedConnections} connection(s) opened before collector start; prior cumulative traffic not counted`,
        );
      }

      if (counterResets > 0) {
        console.info(
          `[Collector:${id}] Detected ${counterResets} traffic counter reset(s); counted current totals as new traffic`,
        );
      }

      // Find closed connections and remove them
      for (const [connId] of activeConnections) {
        if (!currentIds.has(connId)) {
          // Connection closed - any remaining traffic was already counted
          activeConnections.delete(connId);
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
                  now,
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

      // Broadcast to WebSocket clients if there's new traffic (with throttling)
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
      console.error(`[Collector:${id}] Error:`, err);
    },
  });

  // Override disconnect to clear intervals
  const originalDisconnect = collector.disconnect.bind(collector);
  const waitForFlushThenStop = async () => {
    while (isFlushing) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await flushBatch();
  };
  collector.disconnect = () => {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    // Tear down the socket synchronously FIRST: this sets isClosing=true,
    // clears the reconnect timer and closes the WebSocket immediately, so a
    // credential/URL change (stop + start with new config) can never leave the
    // old socket reconnecting with the stale token. Drain the buffer afterward.
    // See issue #65.
    originalDisconnect();
    void waitForFlushThenStop();
  };

  const collectorWithReset = collector as GatewayCollector & {
    clearRuntimeState?: () => void;
  };
  collectorWithReset.clearRuntimeState = () => {
    // Keep active connection baselines to avoid replaying historical cumulative
    // counters after a DB/log wipe. Only clear pending in-memory deltas.
    batchBuffer.clear();
  };

  return collectorWithReset;
}
