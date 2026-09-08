/**
 * Main Fastify Application
 * 
 * This file registers all controllers and services for the API.
 */

import crypto from 'crypto';
import { createGunzip } from 'node:zlib';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import type { StatsDatabase } from '../db/db.js';
import type { RealtimeStore } from '../realtime/realtime.store.js';
import { buildGatewayHeaders, getGatewayBaseUrl, isAgentBackendUrl, parseSurgeRule } from '@neko-master/shared';
import type { TrafficUpdate } from '../db/db.js';
import { SurgePolicySyncService } from '../surge/surge-policy-sync.js';
import type { GeoIPService } from '../geo/geo.service.js';
import { BatchBuffer } from '../collector/batch-buffer.js';
import { TrafficWriteError } from '../clickhouse/clickhouse.writer.js';

// Import modules
import { BackendService, backendController } from '../backend/index.js';
import { StatsService, statsController } from '../stats/index.js';
import { AuthService, authController } from '../auth/index.js';
import { configController } from '../config/index.js';
import nodemgrController from '../nodemgr/index.js';

// Extend Fastify instance to include services
declare module 'fastify' {
  interface FastifyInstance {
    db: StatsDatabase;
    realtimeStore: RealtimeStore;
    backendService: BackendService;
    statsService: StatsService;
    clearAgentRuntimeState?: (backendId?: number) => void;
    notifyBackendDataCleared?: (backendId: number) => void;
  }
}

export interface AppOptions {
  port: number;
  db: StatsDatabase;
  realtimeStore: RealtimeStore;
  logger?: boolean;
  policySyncService?: SurgePolicySyncService;
  geoService?: GeoIPService;
  autoListen?: boolean;
  onTrafficIngested?: (backendId: number) => void;
  onBackendDataCleared?: (backendId: number) => void;
}

type AgentTrafficUpdatePayload = {
  domain?: string;
  ip?: string;
  chain?: string;
  chains?: string[];
  rule?: string;
  rulePayload?: string;
  upload?: number;
  download?: number;
  connections?: number;
  sourceIP?: string;
  timestampMs?: number;
};

type AgentConfigPayload = {
  backendId?: number | string;
  agentId?: string;
  config: {
    rules: Array<{ type: string; payload: string; proxy: string; raw?: string }>;
    proxies: Record<string, { name: string; type: string; now?: string }>;
    providers: Record<string, { proxies: Array<{ name: string; type: string; now?: string }> }>;
    timestamp: number;
    hash: string;
  };
};

type AgentHeartbeatPayload = {
  backendId?: number;
  agentId?: string;
  protocolVersion?: number;
  agentVersion?: string;
  hostname?: string;
  version?: string;
  gatewayType?: string;
  gatewayUrl?: string;
  gatewayLatencyMs?: number;
  serverLatencyMs?: number;
};

type AgentReportPayload = {
  backendId?: number;
  agentId?: string;
  protocolVersion?: number;
  agentVersion?: string;
  requestId?: string;
  updates?: AgentTrafficUpdatePayload[];
};

export async function createApp(options: AppOptions) {
  const {
    port,
    db,
    realtimeStore,
    logger = false,
    policySyncService,
    geoService,
    autoListen = true,
    onTrafficIngested,
    onBackendDataCleared,
  } = options;
  
  // Create Fastify instance
  // Increase body limit to 5MB for agent config sync (large Clash/Surge configs)
  const app = Fastify({ logger, bodyLimit: 5 * 1024 * 1024 });

  // Decompress gzip-encoded request bodies (used by the agent to reduce upload bandwidth)
  // content-length must be removed because it refers to the compressed size; after decompression
  // Fastify would compare the larger decompressed bytes against the original header and reject the request.
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.headers['content-encoding'] === 'gzip') {
      delete (request.headers as Record<string, unknown>)['content-length'];
      return payload.pipe(createGunzip());
    }
    return payload;
  });

  // In-memory dedup for agent report requestIds — prevents double-counting on POST retry.
  // Keyed by requestId, value is the time it was first seen (ms). TTL: 5 minutes.
  const seenRequestIds = new Map<string, number>();

  // Per-backend BatchBuffer for agent mode — mirrors direct mode's 30s batch window and
  // applies the same deferred flush behavior for sqlite/clickhouse writes.
  const agentBatchBuffers = new Map<number, BatchBuffer>();
  // Per-backend legacy fallback dedup set. Only used when an older agent payload
  // does not provide explicit `connections`.
  const agentCountedByBackend = new Map<number, Set<string>>();
  // Per-backend flush lock — mirrors direct mode's isFlushing to prevent a slow CH write
  // from letting the next timer tick start a second flush before clearTraffic completes.
  const agentIsFlushing = new Map<number, boolean>();
  const AGENT_FLUSH_INTERVAL_MS = Math.max(
    5_000,
    Number.parseInt(process.env.AGENT_FLUSH_INTERVAL_MS || '30000', 10) || 30_000,
  );

  const flushAgentBuffer = async (backendId: number, buffer: BatchBuffer) => {
    if (agentIsFlushing.get(backendId) || !buffer.hasPending()) return;

    agentIsFlushing.set(backendId, true);
    try {
      const stats = buffer.flush(db, geoService, backendId, 'Agent');

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
            `[Agent:${backendId}] ClickHouse traffic write failed detail_ok=${trafficDetailOk} agg_ok=${trafficAggOk}`,
            err,
          );
        }
      }

      // Durable fallback: SQLite writes were skipped because ClickHouse was
      // considered healthy, but the ClickHouse write failed. Persist the
      // snapshot to SQLite so the data is not silently lost (buffer is already
      // cleared by flush()). Mirrors gateway/surge collectors. See C1.
      if (
        stats.hasTrafficUpdates &&
        stats.trafficOk &&
        stats.sqliteSkipped &&
        (!trafficDetailOk || !trafficAggOk)
      ) {
        try {
          db.batchUpdateTrafficStats(backendId, stats.updates, false);
          trafficDetailOk = true;
          trafficAggOk = true;
          console.warn(
            `[Agent:${backendId}] ClickHouse traffic write failed; persisted ${stats.updates.length} updates to SQLite as fallback`,
          );
        } catch (fallbackErr) {
          console.error(
            `[Agent:${backendId}] SQLite fallback for traffic also failed; retaining realtime store`,
            fallbackErr,
          );
        }
      }

      if (stats.hasTrafficUpdates && stats.trafficOk) {
        if (trafficDetailOk && trafficAggOk) {
          realtimeStore.clearTraffic(backendId);
          agentCountedByBackend.delete(backendId);
        } else if (trafficDetailOk && !trafficAggOk) {
          realtimeStore.clearTrafficDimensions(backendId);
          agentCountedByBackend.delete(backendId);
        } else if (!trafficDetailOk && trafficAggOk) {
          realtimeStore.clearTrafficSummary(backendId);
          agentCountedByBackend.delete(backendId);
        }
      }

      let countryWriteOk = true;
      if (stats.pendingCountryWrite) {
        try {
          await stats.pendingCountryWrite;
        } catch (err) {
          countryWriteOk = false;
          console.warn(
            `[Agent:${backendId}] ClickHouse country write failed, keeping realtime country store`,
            err,
          );
        }
      }

      // Durable fallback for country stats: same rationale as traffic above. See C1.
      if (
        stats.hasCountryUpdates &&
        stats.countryOk &&
        stats.sqliteSkipped &&
        !countryWriteOk
      ) {
        try {
          db.batchUpdateCountryStats(backendId, stats.countryUpdates);
          countryWriteOk = true;
          console.warn(
            `[Agent:${backendId}] ClickHouse country write failed; persisted to SQLite as fallback`,
          );
        } catch (fallbackErr) {
          console.error(
            `[Agent:${backendId}] SQLite fallback for country also failed; retaining realtime store`,
            fallbackErr,
          );
        }
      }

      if (stats.hasCountryUpdates && stats.countryOk && countryWriteOk) {
        realtimeStore.clearCountries(backendId);
      }
    } finally {
      agentIsFlushing.set(backendId, false);
    }

    // Periodic memory bounds check on realtime store. Without this the
    // per-backend realtime maps grow unbounded while ClickHouse writes keep
    // failing (the buffer clears each flush but the realtime store is retained
    // for the UI), OOM-ing long-lived router/agent deployments. Mirrors the
    // gateway/surge collectors. See C2.
    realtimeStore.pruneIfNeeded(backendId);
  };

  const agentFlushIntervalId = setInterval(() => {
    for (const [backendId, buffer] of agentBatchBuffers) {
      flushAgentBuffer(backendId, buffer).catch((err) => {
        console.error(`[Agent:${backendId}] Periodic flush error:`, err);
      });
    }
  }, AGENT_FLUSH_INTERVAL_MS);
  const clearAgentRuntimeState = (backendId?: number) => {
    if (backendId !== undefined) {
      agentBatchBuffers.get(backendId)?.clear();
      agentBatchBuffers.delete(backendId);
      agentCountedByBackend.delete(backendId);
      agentIsFlushing.delete(backendId);
      return;
    }

    for (const buffer of agentBatchBuffers.values()) {
      buffer.clear();
    }
    agentBatchBuffers.clear();
    agentCountedByBackend.clear();
    agentIsFlushing.clear();
  };
  const REQUEST_ID_TTL_MS = 5 * 60 * 1000;
  let lastRequestIdPruneAt = 0;
  function isDuplicateRequestId(id: string): boolean {
    const now = Date.now();
    if (seenRequestIds.has(id)) {
      return true;
    }
    seenRequestIds.set(id, now);
    // Time-based prune: the previous size-modulo check could skip pruning for
    // long stretches under steady growth, letting the map balloon.
    if (now - lastRequestIdPruneAt > 60_000) {
      lastRequestIdPruneAt = now;
      const cutoff = now - REQUEST_ID_TTL_MS;
      for (const [k, ts] of seenRequestIds) {
        if (ts < cutoff) seenRequestIds.delete(k);
      }
    }
    return false;
  }

  // Register CORS — CORS_ORIGIN restricts allowed origins (comma-separated);
  // defaults to permissive for LAN deployments where the dashboard origin is not known.
  const corsOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Security: when CORS_ORIGIN is unset, deny cross-origin requests instead of
  // reflecting any Origin with credentials — that combination let any website
  // read a logged-in user's data cross-site. Same-origin deployments (the
  // dashboard and API served from one origin, the default Docker setup) are
  // unaffected because browsers do not apply CORS to same-origin requests.
  // To allow a separate dashboard origin, set CORS_ORIGIN explicitly.
  const hasExplicitOrigins = corsOrigins.length > 0;
  await app.register(cors, {
    origin: hasExplicitOrigins ? corsOrigins : false,
    credentials: hasExplicitOrigins,
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  // Register Cookie — fall back to a secret persisted in the database so sessions
  // survive restarts even when COOKIE_SECRET is not configured.
  const cookieSecret = process.env.COOKIE_SECRET || db.getOrCreateCookieSecret();
  await app.register(cookie, {
    secret: cookieSecret,
    parseOptions: {},
  });

  // Create services
  const authService = new AuthService(db);
  const backendService = new BackendService(
    db,
    realtimeStore,
    authService,
    onBackendDataCleared,
  );
  const statsService = new StatsService(db, realtimeStore);

  // Decorate Fastify instance with services
  app.decorate('backendService', backendService);
  app.decorate('statsService', statsService);
  app.decorate('authService', authService);
  app.decorate('db', db);
  app.decorate('realtimeStore', realtimeStore);
  app.decorate('clearAgentRuntimeState', clearAgentRuntimeState);
  app.decorate(
    'notifyBackendDataCleared',
    (backendId: number) => onBackendDataCleared?.(backendId),
  );

  const getBackendIdFromQuery = (query: Record<string, unknown>): number | null => {
    const backendId = typeof query.backendId === 'string' ? query.backendId : undefined;
    return statsService.resolveBackendId(backendId);
  };

  // ...

  // Helper to get headers for backend requests
  const getHeaders = (backend: { type: 'clash' | 'surge'; token: string }) => {
    return buildGatewayHeaders(backend);
  };

  const parseNonNegativeInt = (value: unknown): number | null => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
  };

  const loadRuleSetSizeByProvider = async (
    gatewayBaseUrl: string,
    headers: Record<string, string>,
  ): Promise<Map<string, number>> => {
    const map = new Map<string, number>();
    try {
      const res = await fetch(`${gatewayBaseUrl}/providers/rules`, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return map;
      }

      const payload = (await res.json()) as {
        providers?: Record<string, Record<string, unknown>>;
      };
      const providers = payload.providers || {};
      for (const [name, data] of Object.entries(providers)) {
        const ruleCount =
          parseNonNegativeInt(data.ruleCount) ??
          parseNonNegativeInt(data.rule_count) ??
          parseNonNegativeInt(data.size) ??
          parseNonNegativeInt(data.rules);
        if (ruleCount !== null) {
          map.set(name.toLowerCase(), ruleCount);
        }
      }
    } catch {
      // Best-effort enrichment only; ignore provider endpoint failures.
    }
    return map;
  };

  const timingSafeStringEqual = (a: string, b: string): boolean => {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  };

  const parseAgentToken = (request: { headers: Record<string, unknown> }): string => {
    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    const customHeader = request.headers['x-agent-token'];
    return typeof customHeader === 'string' ? customHeader.trim() : '';
  };

  const parseBackendId = (raw: unknown): number | null => {
    const parsed = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  };

  const parseAgentId = (raw: unknown): string | null => {
    const value = String(raw || '').trim().slice(0, 128);
    return value || null;
  };

  const getMinAgentProtocolVersion = (): number => {
    const v = Number.parseInt(process.env.MIN_AGENT_PROTOCOL_VERSION || '1', 10);
    return Number.isFinite(v) && v > 0 ? v : 1;
  };

  const getMinAgentVersion = (): string => {
    return String(process.env.MIN_AGENT_VERSION || '').trim();
  };

  const parseProtocolVersion = (raw: unknown): number | null => {
    if (raw === undefined || raw === null || raw === '') return null;
    const parsed = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  };

  const normalizeVersion = (raw: unknown): string => {
    return String(raw || '')
      .trim()
      .replace(/^agent-v/i, '')
      .replace(/^v/i, '');
  };

  const parseVersionParts = (raw: unknown): [number, number, number] | null => {
    const normalized = normalizeVersion(raw);
    if (!normalized) return null;

    const match = normalized.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) return null;

    return [
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10),
      Number.parseInt(match[3] || '0', 10),
    ];
  };

  const compareVersionParts = (a: [number, number, number], b: [number, number, number]): number => {
    for (let i = 0; i < 3; i++) {
      if (a[i] > b[i]) return 1;
      if (a[i] < b[i]) return -1;
    }
    return 0;
  };

  const isAgentCompatible = (
    body: AgentHeartbeatPayload | AgentReportPayload,
    reply: { status: (code: number) => { send: (payload: Record<string, unknown>) => unknown } },
  ): boolean => {
    const requiredProtocol = getMinAgentProtocolVersion();
    const incomingProtocol = parseProtocolVersion(body.protocolVersion) ?? 1;
    if (incomingProtocol < requiredProtocol) {
      reply.status(426).send({
        error: `Agent protocol version ${incomingProtocol} is too old. Minimum required is ${requiredProtocol}.`,
        code: 'AGENT_PROTOCOL_TOO_OLD',
        minProtocolVersion: requiredProtocol,
        receivedProtocolVersion: incomingProtocol,
      });
      return false;
    }

    const requiredVersion = getMinAgentVersion();
    if (!requiredVersion) {
      return true;
    }

    const incomingVersionRaw = body.agentVersion || (body as AgentHeartbeatPayload).version;
    const requiredParts = parseVersionParts(requiredVersion);
    const incomingParts = parseVersionParts(incomingVersionRaw);
    if (!requiredParts || !incomingParts) {
      reply.status(426).send({
        error: `Agent version is missing or invalid. Minimum required is ${requiredVersion}.`,
        code: 'AGENT_VERSION_REQUIRED',
        minAgentVersion: requiredVersion,
      });
      return false;
    }

    if (compareVersionParts(incomingParts, requiredParts) < 0) {
      reply.status(426).send({
        error: `Agent version ${normalizeVersion(incomingVersionRaw)} is too old. Minimum required is ${requiredVersion}.`,
        code: 'AGENT_VERSION_TOO_OLD',
        minAgentVersion: requiredVersion,
        receivedAgentVersion: normalizeVersion(incomingVersionRaw),
      });
      return false;
    }

    return true;
  };

  const sanitizeAgentTrafficUpdate = (raw: AgentTrafficUpdatePayload): TrafficUpdate | null => {
    if (!raw || typeof raw !== 'object') return null;

    const upload = Number.isFinite(raw.upload) ? Math.max(0, Math.floor(raw.upload || 0)) : 0;
    const download = Number.isFinite(raw.download) ? Math.max(0, Math.floor(raw.download || 0)) : 0;
    if (upload === 0 && download === 0) return null;

    const rawChains = Array.isArray(raw.chains) ? raw.chains : [];
    const chains = rawChains
      .map((chain) => String(chain || '').trim())
      .filter(Boolean)
      .slice(0, 12);

    const normalizedChains = chains.length > 0 ? chains : [String(raw.chain || 'DIRECT').trim() || 'DIRECT'];
    const timestampMs = Number.isFinite(raw.timestampMs)
      ? Math.max(0, Math.floor(raw.timestampMs || 0))
      : Date.now();
    const connections = Number.isFinite(raw.connections)
      ? Math.max(0, Math.floor(raw.connections || 0))
      : undefined;

    return {
      domain: String(raw.domain || '').trim().slice(0, 253),
      ip: String(raw.ip || '').trim().slice(0, 64),
      chain: normalizedChains[0] || 'DIRECT',
      chains: normalizedChains,
      rule: String(raw.rule || 'Match').trim().slice(0, 256) || 'Match',
      rulePayload: String(raw.rulePayload || '').trim().slice(0, 512),
      upload,
      download,
      connections,
      sourceIP: String(raw.sourceIP || '').trim().slice(0, 64),
      timestampMs,
    };
  };

  const isAgentBackendAuthorized = (
    backendId: number,
    request: { headers: Record<string, unknown> },
    reply: { status: (code: number) => { send: (payload: Record<string, unknown>) => unknown } },
  ): backendId is number => {
    const backend = db.getBackend(backendId);
    if (!backend) {
      reply.status(404).send({ error: 'Backend not found' });
      return false;
    }
    if (!isAgentBackendUrl(backend.url)) {
      reply.status(400).send({ error: 'Backend is not in agent mode (url must start with agent://)' });
      return false;
    }

    const expected = (backend.token || '').trim();
    if (!expected) {
      reply.status(403).send({ error: 'Agent backend token is not configured' });
      return false;
    }

    const provided = parseAgentToken(request);
    if (!provided || !timingSafeStringEqual(provided, expected)) {
      reply.status(401).send({ error: 'Invalid agent token' });
      return false;
    }
    return true;
  };

  const isAgentBindingAllowed = (
    backendId: number,
    agentId: string,
    reply: { status: (code: number) => { send: (payload: Record<string, unknown>) => unknown } },
  ): boolean => {
    const heartbeat = db.getAgentHeartbeat(backendId);
    if (!heartbeat) {
      return true;
    }
    if (heartbeat.agentId === agentId) {
      return true;
    }

    // Allow rebinding if the existing agent has been offline for a while
    // Agent heartbeat interval is 30s, so 10s timeout allows quick restart
    // while preventing accidental duplicate bindings
    const AGENT_BINDING_TIMEOUT_MS = 10000;
    const lastSeenMs = new Date(heartbeat.lastSeen).getTime();
    const ageMs = Number.isFinite(lastSeenMs) ? Math.max(0, Date.now() - lastSeenMs) : Number.POSITIVE_INFINITY;
    
    if (Number.isFinite(ageMs) && ageMs > AGENT_BINDING_TIMEOUT_MS) {
      console.info(`[Agent] Allowing rebinding for backend ${backendId}: previous agent '${heartbeat.agentId}' offline for ${Math.round(ageMs / 1000)}s`);
      return true;
    }

    reply.status(409).send({
      error: `Agent token is already bound to '${heartbeat.agentId}'. ` +
             `Wait ${Math.round((AGENT_BINDING_TIMEOUT_MS - ageMs) / 1000)}s for previous agent to timeout. ` +
             `If you need to run multiple agents on the same backend, use different --agent-id values.`,
      code: 'AGENT_TOKEN_ALREADY_BOUND',
      boundAgentId: heartbeat.agentId,
      remainingSeconds: Math.round((AGENT_BINDING_TIMEOUT_MS - ageMs) / 1000),
    });
    return false;
  };

  app.post('/api/agent/heartbeat', async (request, reply) => {
    const body = request.body as AgentHeartbeatPayload;
    const backendId = parseBackendId(body?.backendId);
    if (backendId === null) {
      return reply.status(400).send({ error: 'Invalid backendId' });
    }
    if (!isAgentBackendAuthorized(backendId, request, reply)) {
      return;
    }
    if (!isAgentCompatible(body, reply)) {
      return;
    }

    const agentId = parseAgentId(body.agentId);
    if (!agentId) {
      return reply.status(400).send({ error: 'Invalid agentId' });
    }
    if (!isAgentBindingAllowed(backendId, agentId, reply)) {
      return;
    }
    const hostname = String(body.hostname || '').trim().slice(0, 128) || undefined;
    const version = String(body.agentVersion || body.version || '').trim().slice(0, 64) || undefined;
    const gatewayType = String(body.gatewayType || '').trim().slice(0, 16) || undefined;
    const gatewayUrl = String(body.gatewayUrl || '').trim().slice(0, 512) || undefined;
    const remoteIP = request.ip || request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim();
    const gatewayLatencyMs = typeof body.gatewayLatencyMs === 'number'
      && Number.isFinite(body.gatewayLatencyMs)
      && body.gatewayLatencyMs >= 0
      ? Math.round(body.gatewayLatencyMs)
      : undefined;
    const serverLatencyMs = typeof body.serverLatencyMs === 'number'
      && Number.isFinite(body.serverLatencyMs)
      && body.serverLatencyMs >= 0
      ? Math.round(body.serverLatencyMs)
      : undefined;

    db.upsertAgentHeartbeat({
      backendId,
      agentId,
      hostname,
      version,
      gatewayType,
      gatewayUrl,
      remoteIP,
      gatewayLatencyMs,
      serverLatencyMs,
      lastSeen: new Date().toISOString(),
    });

    return { success: true, backendId, agentId, serverTime: new Date().toISOString() };
  });

  app.post('/api/agent/report', async (request, reply) => {
    const body = request.body as AgentReportPayload;
    const backendId = parseBackendId(body?.backendId);
    if (backendId === null) {
      return reply.status(400).send({ error: 'Invalid backendId' });
    }
    if (!isAgentBackendAuthorized(backendId, request, reply)) {
      return;
    }
    if (!isAgentCompatible(body, reply)) {
      return;
    }

    const agentId = parseAgentId(body.agentId);
    if (!agentId) {
      return reply.status(400).send({ error: 'Invalid agentId' });
    }
    if (!isAgentBindingAllowed(backendId, agentId, reply)) {
      return;
    }

    // Idempotency: if this requestId has already been processed, skip to avoid double-counting
    const requestId = typeof body?.requestId === 'string' ? body.requestId.slice(0, 64) : '';
    if (requestId && isDuplicateRequestId(requestId)) {
      return { success: true, backendId, accepted: 0, dropped: 0, duplicate: true };
    }

    const rawUpdates = Array.isArray(body?.updates) ? body.updates : [];
    if (rawUpdates.length === 0) {
      return { success: true, backendId, accepted: 0, dropped: 0 };
    }

    const maxBatchSize = Math.max(
      1,
      Number.parseInt(process.env.AGENT_INGEST_MAX_BATCH_SIZE || '5000', 10) || 5000,
    );
    const picked = rawUpdates.slice(0, maxBatchSize);
    const updates: TrafficUpdate[] = [];

    for (const update of picked) {
      const sanitized = sanitizeAgentTrafficUpdate(update);
      if (sanitized) updates.push(sanitized);
    }

    if (updates.length === 0) {
      return { success: true, backendId, accepted: 0, dropped: picked.length };
    }

    // Get or create the per-backend BatchBuffer for agent mode.
    // This mirrors the BatchBuffer used by direct mode (gateway.collector.ts): updates are
    // accumulated over ~30 seconds then flushed in one batch. The BatchBuffer deduplicates
    // by (domain, ip, chain, minute) key, so a long-lived connection is counted once per
    // minute instead of once per 2-second agent report — keeping connection counts
    // semantically consistent with direct mode.
    let agentBuffer = agentBatchBuffers.get(backendId);
    if (!agentBuffer) {
      agentBuffer = new BatchBuffer();
      agentBatchBuffers.set(backendId, agentBuffer);
    }

    const geoBatchByIp = new Map<
      string,
      {
        upload: number;
        download: number;
        connections: number;
        timestampMs: number;
      }
    >();

    // Compatibility fallback for older agents that do not send explicit `connections`.
    // For those payloads only, we deduplicate by a composite key within the current
    // flush window to avoid counting every 2s report as a new connection.
    let agentCounted = agentCountedByBackend.get(backendId);
    if (!agentCounted) {
      agentCounted = new Set<string>();
      agentCountedByBackend.set(backendId, agentCounted);
    }

    for (const update of updates) {
      let connections = Number.isFinite(update.connections)
        ? Math.max(0, Math.floor(update.connections || 0))
        : undefined;
      if (connections === undefined) {
        // Connection key matches BatchBuffer's deduplication dimensions (minus minuteKey):
        // domain, ip, full chain, rule, rulePayload, sourceIP.
        const connectionKey = `${update.domain}:${update.ip}:${update.chains.join(' > ')}:${update.rule}:${update.rulePayload}:${update.sourceIP || ''}`;
        connections = agentCounted.has(connectionKey) ? 0 : 1;
        agentCounted.add(connectionKey);
      }

      if (update.ip && update.ip !== '0.0.0.0' && update.ip !== '::') {
        const existing = geoBatchByIp.get(update.ip);
        if (existing) {
          existing.upload += update.upload;
          existing.download += update.download;
          existing.connections += connections;
          existing.timestampMs = Math.max(existing.timestampMs, update.timestampMs || 0);
        } else {
          geoBatchByIp.set(update.ip, {
            upload: update.upload,
            download: update.download,
            connections,
            timestampMs: update.timestampMs || Date.now(),
          });
        }
      }

      // Accumulate in BatchBuffer for deferred DB write (clears realtime after flush).
      agentBuffer.add(backendId, {
        domain: update.domain,
        ip: update.ip,
        chain: update.chains[0] || 'DIRECT',
        chains: update.chains,
        rule: update.rule,
        rulePayload: update.rulePayload,
        upload: update.upload,
        download: update.download,
        connections,
        sourceIP: update.sourceIP,
        timestampMs: update.timestampMs,
      });

      realtimeStore.recordTraffic(
        backendId,
        {
          domain: update.domain,
          ip: update.ip,
          sourceIP: update.sourceIP,
          chains: update.chains,
          rule: update.rule,
          rulePayload: update.rulePayload,
          upload: update.upload,
          download: update.download,
        },
        connections,
        update.timestampMs || Date.now(),
      );
    }

    // DB write and realtimeStore.clearTraffic are deferred to the periodic flush interval,
    // matching direct mode's batch semantics.

    if (geoBatchByIp.size > 0 && geoService) {
      const capturedBuffer = agentBuffer;
      // Process in background without blocking the agent response
      Promise.all(
        Array.from(geoBatchByIp.entries()).map(async ([ip, stats]) => {
          try {
            const geo = await geoService.getGeoLocation(ip);
            return { ip, stats, geo };
          } catch {
            return { ip, stats, geo: null };
          }
        }),
      )
        .then((results) => {
          for (const r of results) {
            if (r.geo === null) continue;
            realtimeStore.recordCountryTraffic(
              backendId,
              r.geo,
              r.stats.upload,
              r.stats.download,
              r.stats.connections,
              r.stats.timestampMs,
            );
            // Queue in buffer; DB write and clearCountries happen on next periodic flush.
            capturedBuffer.addGeoResult({
              ip: r.ip,
              geo: r.geo,
              upload: r.stats.upload,
              download: r.stats.download,
              connections: r.stats.connections,
              timestampMs: r.stats.timestampMs,
            });
          }
        })
        .catch((err) => {
          console.error(`[Agent:${backendId}] Background GeoIP batch processing failed:`, err);
        });
    }

    db.upsertAgentHeartbeat({
      backendId,
      agentId,
      lastSeen: new Date().toISOString(),
      remoteIP: request.ip || request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim(),
    });

    onTrafficIngested?.(backendId);

    return {
      success: true,
      backendId,
      accepted: updates.length,
      dropped: picked.length - updates.length,
    };
  });

  app.post('/api/agent/config', async (request, reply) => {
    const body = request.body as AgentConfigPayload;
    const backendId = parseBackendId(body?.backendId);
    // Agent config received (log removed to reduce noise)
    if (backendId === null) {
      return reply.status(400).send({ error: 'Invalid backendId' });
    }
    if (!isAgentBackendAuthorized(backendId, request, reply)) {
      // Backend not authorized (error returned to client)
      return;
    }
    const agentId = parseAgentId(body.agentId);
    if (!agentId) {
      return reply.status(400).send({ error: 'Invalid agentId' });
    }
    if (!isAgentBindingAllowed(backendId, agentId, reply)) {
      // Agent binding not allowed (error returned to client)
      return;
    }

    if (!body.config) {
      return reply.status(400).send({ error: 'Missing config payload' });
    }

    // Config stored successfully (log removed to reduce noise)
    realtimeStore.setAgentConfig(backendId, body.config);

    return { success: true, backendId, hash: body.config.hash };
  });

  // Agent policy state endpoint (synced more frequently than config)
  app.post('/api/agent/policy-state', async (request, reply) => {
    const body = request.body as { backendId: number; agentId: string; policyState: { proxies: Record<string, unknown>; providers: Record<string, unknown>; timestamp: number } };
    const backendId = parseBackendId(body?.backendId);
    // Agent policy state received (log removed to reduce noise)
    if (backendId === null) {
      return reply.status(400).send({ error: 'Invalid backendId' });
    }
    if (!isAgentBackendAuthorized(backendId, request, reply)) {
      // Backend not authorized (error returned to client)
      return;
    }

    if (!body.policyState) {
      return reply.status(400).send({ error: 'Missing policyState payload' });
    }

    // Policy state stored successfully (log removed to reduce noise)
    realtimeStore.setAgentPolicyState(backendId, body.policyState as import('../realtime/realtime.store.js').AgentPolicyState);

    return { success: true, backendId, timestamp: body.policyState.timestamp };
  });

  // Compatibility routes: Gateway APIs
  app.get('/api/gateway/proxies', async (request, reply) => {
    const backendId = getBackendIdFromQuery(request.query as Record<string, unknown>);
    // Gateway API /proxies called (log removed to reduce noise)
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const backend = db.getBackend(backendId);
    if (!backend) {
      return reply.status(404).send({ error: 'Backend not found' });
    }
    if (isAgentBackendUrl(backend.url)) {
      const cached = realtimeStore.getAgentConfigWithPolicyState(backendId);
      console.info(`[Gateway API /proxies] Agent mode, cached exists: ${!!cached}`);
      if (!cached) {
        return reply.status(503).send({ error: 'Agent config not yet synced' });
      }
      return { proxies: cached.proxies || {}, _source: 'agent-cache' };
    }

    const gatewayBaseUrl = getGatewayBaseUrl(backend.url);
    const isSurge = backend.type === 'surge';
    const headers = getHeaders(backend);

    try {
      if (isSurge) {
        // Surge: Get policies list and details
        const res = await fetch(`${gatewayBaseUrl}/v1/policies`, { headers });
        if (!res.ok) {
          return reply.status(res.status).send({ error: `Surge API error: ${res.status}` });
        }
        
        const data = await res.json() as { proxies: string[]; 'policy-groups': string[] };
        const proxies: Record<string, { name: string; type: string; now?: string }> = {};
        
        // Get current selection for each policy group
        const policyGroups = data['policy-groups'] || [];
        const groupDetails = await Promise.allSettled(
          policyGroups.map(async (groupName: string) => {
            try {
              const detailRes = await fetch(
                `${gatewayBaseUrl}/v1/policies/${encodeURIComponent(groupName)}`,
                { headers, signal: AbortSignal.timeout(5000) }
              );
              if (!detailRes.ok) return { groupName, now: null };
              const detail = await detailRes.json() as { policy?: string };
              return { groupName, now: detail.policy || null };
            } catch {
              return { groupName, now: null };
            }
          })
        );
        
        for (const result of groupDetails) {
          if (result.status === 'fulfilled') {
            const { groupName, now } = result.value;
            proxies[groupName] = { name: groupName, type: 'Selector', now: now || '' };
          }
        }
        
        // Add leaf proxies
        if (data.proxies) {
          for (const name of data.proxies) {
            proxies[name] = { name, type: 'Unknown' };
          }
        }
        
        return { proxies };
      } else {
        // Clash/OpenClash: Direct proxy to /proxies endpoint
        const res = await fetch(`${gatewayBaseUrl}/proxies`, { 
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
        if (!res.ok) {
          return reply.status(res.status).send({ error: `Gateway API error: ${res.status}` });
        }
        return res.json();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to reach Gateway API';
      return reply.status(502).send({ error: message });
    }
  });

  // Health check endpoint (not part of any module)
  app.get('/health', async () => ({ status: 'ok' }));

  // Compatibility routes: Gateway APIs
  app.get('/api/gateway/providers/proxies', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const backendId = getBackendIdFromQuery(query);
    const forceRefresh = query.refresh === 'true';
    
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const backend = db.getBackend(backendId);
    if (!backend) {
      return reply.status(404).send({ error: 'Backend not found' });
    }
    if (isAgentBackendUrl(backend.url)) {
      const cached = realtimeStore.getAgentConfigWithPolicyState(backendId);
      if (!cached) {
        return reply.status(503).send({ error: 'Agent config not yet synced' });
      }
      return { providers: cached.providers || {}, proxies: cached.proxies || {}, _source: 'agent-cache' };
    }

    const gatewayBaseUrl = getGatewayBaseUrl(backend.url);
    const isSurge = backend.type === 'surge';
    const headers = getHeaders(backend);

    try {
      if (isSurge) {
        // Build response from cache or fetch directly
        const providers: Record<string, { proxies: { name: string; type: string; now?: string }[] }> = {};
        const cacheStatus = policySyncService?.getCacheStatus(backendId);
        
        // Try to use cache first
        if (cacheStatus?.cached && !forceRefresh) {
          const cachedPolicies = db.getSurgePolicyCache(backendId);
          for (const policy of cachedPolicies) {
            if (policy.selectedPolicy) {
              providers[policy.policyGroup] = {
                proxies: [{ name: policy.policyGroup, type: policy.policyType, now: policy.selectedPolicy }]
              };
            }
          }
        }
        
        // If no cache or force refresh, fetch directly from Surge
        if (Object.keys(providers).length === 0 || forceRefresh) {
          try {
            const res = await fetch(`${gatewayBaseUrl}/v1/policies`, { 
              headers, 
              signal: AbortSignal.timeout(10000) 
            });
            
            if (!res.ok) {
              throw new Error(`Surge API error: ${res.status}`);
            }
            
            const data = await res.json() as { 
              proxies: string[]; 
              'policy-groups': string[];
            };
            
            const policyGroups = data['policy-groups'] || [];
            
            // Fetch details for each policy group
            // Surge uses /v1/policy_groups/select?group_name=xxx endpoint
            const groupDetails = await Promise.allSettled(
              policyGroups.map(async (groupName: string) => {
                try {
                  const detailRes = await fetch(
                    `${gatewayBaseUrl}/v1/policy_groups/select?group_name=${encodeURIComponent(groupName)}`,
                    { headers, signal: AbortSignal.timeout(5000) }
                  );
                  if (!detailRes.ok) return null;
                  const detail = await detailRes.json() as { policy?: string; type?: string };
                  return { 
                    name: groupName, 
                    now: detail.policy || '', 
                    type: detail.type || 'Select' 
                  };
                } catch {
                  return null;
                }
              })
            );
            
            // Build providers from fetched data
            let successCount = 0;
            for (const result of groupDetails) {
              if (result.status === 'fulfilled' && result.value && result.value.now) {
                providers[result.value.name] = {
                  proxies: [{ 
                    name: result.value.name, 
                    type: result.value.type, 
                    now: result.value.now 
                  }]
                };
                successCount++;
              }
            }
            
            // Add standalone proxies
            if (data.proxies?.length > 0) {
              providers['default'] = {
                proxies: data.proxies.map(name => ({ name, type: 'Unknown' }))
              };
            }
            
            // Also update cache in background
            if (policySyncService) {
              policySyncService.syncNow(backendId, gatewayBaseUrl, backend.token || undefined)
                .catch(err => console.error(`[Gateway] Background sync failed:`, err.message));
            }
            
          } catch (error) {
            console.error(`[Gateway] Failed to fetch from Surge:`, error);
            if (Object.keys(providers).length === 0) {
              return reply.status(502).send({ 
                error: 'Failed to fetch policies',
                message: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }
        }

        return {
          providers,
          _cache: cacheStatus ? {
            cached: cacheStatus.cached,
            lastUpdate: cacheStatus.lastUpdate,
            policyCount: cacheStatus.policyCount,
          } : undefined
        };
      } else {
        // Clash/OpenClash: direct proxy
        const res = await fetch(`${gatewayBaseUrl}/providers/proxies`, { 
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
        if (!res.ok) {
          return reply.status(res.status).send({ error: `Gateway API error: ${res.status}` });
        }
        return res.json();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to reach Gateway API';
      return reply.status(502).send({ error: message });
    }
  });

  // Manual refresh endpoint for Surge policies
  app.post('/api/gateway/providers/proxies/refresh', async (request, reply) => {
    const backendId = getBackendIdFromQuery(request.query as Record<string, unknown>);
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const backend = db.getBackend(backendId);
    if (!backend || backend.type !== 'surge') {
      return reply.status(400).send({ error: 'Only Surge backend supports this operation' });
    }
    if (isAgentBackendUrl(backend.url)) {
      return reply.status(400).send({ error: 'Agent mode backend does not support this operation' });
    }

    if (!policySyncService) {
      return reply.status(503).send({ error: 'Policy sync service not available' });
    }

    const gatewayBaseUrl = getGatewayBaseUrl(backend.url);
    const result = await policySyncService.syncNow(
      backendId,
      gatewayBaseUrl,
      backend.token || undefined
    );

    return {
      success: result.success,
      message: result.message,
      updated: result.updated,
    };
  });

  app.get('/api/gateway/rules', async (request, reply) => {
    const backendId = getBackendIdFromQuery(request.query as Record<string, unknown>);
    if (backendId === null) {
      return reply.status(404).send({ error: 'No backend specified or active' });
    }

    const backend = db.getBackend(backendId);
    if (!backend) {
      return reply.status(404).send({ error: 'Backend not found' });
    }
    if (isAgentBackendUrl(backend.url)) {
      const cached = realtimeStore.getAgentConfig(backendId);
      if (!cached) {
        return reply.status(503).send({ error: 'Agent config not yet synced' });
      }
      
      if (backend.type === 'surge') {
        const parsedRules = (cached.rules || [])
          .map(r => r.raw ? parseSurgeRule(r.raw) : null)
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .map(r => ({ type: r.type, payload: r.payload, proxy: r.policy, size: 0 }));
        // Agent mode Surge rules logging removed
        return { rules: parsedRules, _source: 'agent-cache' };
      }
      
      return { rules: cached.rules || [], _source: 'agent-cache' };
    }

    const gatewayBaseUrl = getGatewayBaseUrl(backend.url);
    const isSurge = backend.type === 'surge';
    const headers = getHeaders(backend);

    try {
      if (isSurge) {
        // Surge uses /v1/rules endpoint
        const res = await fetch(`${gatewayBaseUrl}/v1/rules`, { headers });
        if (!res.ok) {
          return reply.status(res.status).send({ error: `Surge API error: ${res.status}` });
        }
        
        const data = await res.json() as { rules: string[]; 'available-policies': string[] };
        
        // Parse Surge rules to standard format
        const parsedRules = data.rules
          .map(raw => {
            const parsed = parseSurgeRule(raw);
            return parsed ? { type: parsed.type, payload: parsed.payload, policy: parsed.policy, raw } : null;
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        return {
          rules: parsedRules.map(r => ({
            type: r.type,
            payload: r.payload,
            proxy: r.policy,
            size: 0,
          })),
          _source: 'surge' as const,
          _availablePolicies: data['available-policies'],
        };
      } else {
        // Clash/OpenClash uses /rules endpoint
        const res = await fetch(`${gatewayBaseUrl}/rules`, { 
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
        if (!res.ok) {
          return reply.status(res.status).send({ error: `Gateway API error: ${res.status}` });
        }
        const data = (await res.json()) as {
          rules?: Array<Record<string, unknown>>;
          [key: string]: unknown;
        };

        const rules = Array.isArray(data.rules) ? data.rules : [];
        if (rules.length === 0) {
          return data;
        }

        const providerSizeMap = await loadRuleSetSizeByProvider(gatewayBaseUrl, headers);
        if (providerSizeMap.size === 0) {
          return data;
        }

        const enrichedRules = rules.map((rule) => {
          const type = String(rule.type || '');
          const payload = String(rule.payload || '').toLowerCase();
          const size = parseNonNegativeInt(rule.size);
          if (type !== 'RuleSet' || size !== null || !payload) {
            return rule;
          }

          const enrichedSize = providerSizeMap.get(payload);
          if (enrichedSize === undefined) {
            return rule;
          }

          return {
            ...rule,
            size: enrichedSize,
          };
        });

        return {
          ...data,
          rules: enrichedRules,
        };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to reach Gateway API';
      return reply.status(502).send({ error: message });
    }
  });

  // Auth middleware - protects API routes
  app.addHook('onRequest', async (request, reply) => {
    // Skip auth for public routes
    const publicRoutes = [
      '/health',
      '/api/auth/state',
      '/api/auth/verify',
      '/api/auth/logout', // Add logout as public so we can clear cookies even if invalid
      '/api/agent/heartbeat',
      '/api/agent/report',
      '/api/agent/config',
      '/api/agent/policy-state',
    ];
    
    // Check if route is public
    if (publicRoutes.some(route => request.url.startsWith(route))) {
      return;
    }

    // Check if auth is required
    if (!authService.isAuthRequired()) {
      return;
    }

    // Try to get token from Cookie first
    const cookieToken = request.cookies['neko-session'];
    if (cookieToken) {
      const verifyResult = await authService.verifyToken(cookieToken);
      if (verifyResult.valid) {
        return;
      }
    }

    // Fallback: Get token from header (for backward compatibility / API clients)
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    const verifyResult = await authService.verifyToken(token);
    
    if (!verifyResult.valid) {
      return reply.status(401).send({ error: verifyResult.message || 'Invalid token' });
    }
  });

  // On server close: stop health checks, flush all pending agent buffers.
  app.addHook('onClose', async () => {
    backendService.stopHealthChecks();
    clearInterval(agentFlushIntervalId);
    for (const [backendId, buffer] of agentBatchBuffers) {
      try {
        await flushAgentBuffer(backendId, buffer);
      } catch (err) {
        console.error(`[Agent:${backendId}] Final flush error on close:`, err);
      }
    }
  });

  // Register controllers
  await app.register(backendController, { prefix: '/api/backends' });
  await app.register(statsController, { prefix: '/api/stats' });
  await app.register(authController, { prefix: '/api/auth' });
  await app.register(configController, { prefix: '/api/db' });
  await app.register(nodemgrController, { prefix: '/api/nt' });

  if (autoListen) {
    // Start server
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`[API] Server running at http://localhost:${port}`);

    // Start automatic health checks for upstream gateways
    backendService.startHealthChecks();
  }

  return app;
}

export class APIServer {
  private app: ReturnType<typeof Fastify> | null = null;
  private db: StatsDatabase;
  private realtimeStore: RealtimeStore;
  private port: number;
  private policySyncService?: SurgePolicySyncService;
  private geoService?: GeoIPService;
  private onTrafficIngested?: (backendId: number) => void;
  private onBackendDataCleared?: (backendId: number) => void;

  constructor(
    port: number, 
    db: StatsDatabase, 
    realtimeStore: RealtimeStore,
    policySyncService?: SurgePolicySyncService,
    geoService?: GeoIPService,
    onTrafficIngested?: (backendId: number) => void,
    onBackendDataCleared?: (backendId: number) => void,
  ) {
    this.port = port;
    this.db = db;
    this.realtimeStore = realtimeStore;
    this.policySyncService = policySyncService;
    this.geoService = geoService;
    this.onTrafficIngested = onTrafficIngested;
    this.onBackendDataCleared = onBackendDataCleared;
  }

  async start() {
    this.app = await createApp({
      port: this.port,
      db: this.db,
      realtimeStore: this.realtimeStore,
      policySyncService: this.policySyncService,
      geoService: this.geoService,
      onTrafficIngested: this.onTrafficIngested,
      onBackendDataCleared: this.onBackendDataCleared,
      logger: false,
    });
    return this.app;
  }

  async stop() {
    if (this.app) {
      // Awaiting close runs the onClose hook, which flushes pending agent buffers.
      await this.app.close();
      console.log('[API] Server stopped');
    }
  }
}

export default createApp;
