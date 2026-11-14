import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { validateProxyNameAliases } from "@neko-master/shared";
import type { StatsDatabase, GeoLookupConfig, GeoLookupProvider } from "../db/db.js";
import type { RealtimeStore } from "../realtime/realtime.store.js";
import { loadClickHouseConfig, runClickHouseQuery, runClickHouseTextQuery } from "../clickhouse/clickhouse.config.js";

declare module "fastify" {
  interface FastifyInstance {
    db: StatsDatabase;
    realtimeStore: RealtimeStore;
    clearAgentRuntimeState?: (backendId?: number) => void;
    notifyBackendDataCleared?: (backendId: number) => void;
    notifyStatsSettingsChanged?: (backendId: number) => void;
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function toGeoLookupResponse(config: GeoLookupConfig) {
  const configuredProvider = config.provider;
  const effectiveProvider =
    configuredProvider === "local" && config.localMmdbReady === false
      ? "online"
      : configuredProvider;

  return {
    ...config,
    configuredProvider,
    effectiveProvider,
  };
}

function parseNonNegativeIntText(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;

  try {
    const bigintValue = BigInt(value);
    if (bigintValue > BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number.MAX_SAFE_INTEGER;
    }
    return Number(bigintValue);
  } catch {
    return null;
  }
}

type ClickHouseStorageStats = {
  trafficRows: number;
  trafficSize: number;
  countrySize: number;
};

function formatUtcMinuteCutoff(days: number): string {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return `${cutoff.slice(0, 16).replace("T", " ")}:00`;
}

async function cleanupClickHouseData(
  fastify: FastifyInstance,
  days: number,
  backendId?: number,
): Promise<void> {
  const chConfig = loadClickHouseConfig();
  if (!chConfig.enabled) return;

  const database = chConfig.database.replace(/'/g, "''");
  const baseTables = ["traffic_minute", "traffic_agg", "traffic_detail", "country_minute"] as const;
  const bufferDefs = [
    { name: "traffic_agg_buffer", base: "traffic_agg" },
    { name: "traffic_detail_buffer", base: "traffic_detail" },
    { name: "country_buffer", base: "country_minute" },
  ];

  if (days === 0 && backendId === undefined) {
    // Full wipe: DROP buffers → TRUNCATE base → recreate buffers
    for (const buf of bufferDefs) {
      try { await runClickHouseQuery(chConfig, `DROP TABLE IF EXISTS ${database}.${buf.name}`); } catch { /* ignore */ }
    }
    for (const table of baseTables) {
      await runClickHouseQuery(chConfig, `TRUNCATE TABLE ${database}.${table}`);
    }
    for (const buf of bufferDefs) {
      try {
        await runClickHouseQuery(
          chConfig,
          `CREATE TABLE IF NOT EXISTS ${database}.${buf.name} AS ${database}.${buf.base}
ENGINE = Buffer('${database}', '${buf.base}', 4, 10, 60, 100, 10000, 10000, 1000000)`,
        );
      } catch { /* ignore */ }
    }
    return;
  }

  // Partial cleanup: delete matching rows from base tables only.
  // Avoid dropping global buffer tables here, which can affect active writers
  // from other backends.
  const conditions: string[] = [];
  if (backendId !== undefined) {
    conditions.push(`backend_id = ${backendId}`);
  }
  if (days > 0) {
    const cutoff = formatUtcMinuteCutoff(days).replace(/'/g, "''");
    conditions.push(`minute < toDateTime('${cutoff}')`);
  }

  if (conditions.length === 0) {
    return;
  }

  const whereClause = conditions.join(" AND ");
  for (const table of baseTables) {
    await runClickHouseQuery(
      chConfig,
      `ALTER TABLE ${database}.${table} DELETE WHERE ${whereClause} SETTINGS mutations_sync = 2`,
    );
  }
}

async function resolveClickHouseStorageStats(
  fastify: FastifyInstance,
): Promise<ClickHouseStorageStats | null> {
  const chConfig = loadClickHouseConfig();
  if (!chConfig.enabled) {
    return null;
  }

  try {
    const database = chConfig.database.replace(/'/g, "''");
    const [rowsText, trafficBytesText, countryBytesText] = await Promise.all([
      runClickHouseTextQuery(
        chConfig,
        `SELECT toUInt64(COALESCE(sum(rows), 0)) FROM system.parts WHERE active = 1 AND database = '${database}' AND table = 'traffic_minute'`,
      ),
      runClickHouseTextQuery(
        chConfig,
        `SELECT toUInt64(COALESCE(sum(bytes_on_disk), 0)) FROM system.parts WHERE active = 1 AND database = '${database}' AND table = 'traffic_minute'`,
      ),
      runClickHouseTextQuery(
        chConfig,
        `SELECT toUInt64(COALESCE(sum(bytes_on_disk), 0)) FROM system.parts WHERE active = 1 AND database = '${database}' AND table = 'country_minute'`,
      ),
    ]);

    return {
      trafficRows: parseNonNegativeIntText(rowsText) ?? 0,
      trafficSize: parseNonNegativeIntText(trafficBytesText) ?? 0,
      countrySize: parseNonNegativeIntText(countryBytesText) ?? 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fastify.log.warn(`[Config] Failed to load ClickHouse storage stats: ${message}`);
    return null;
  }
}

const configController: FastifyPluginAsync = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get<{ Querystring: { backendId?: string } }>("/proxy-name-aliases", async (request, reply) => {
    const backendId = Number(request.query.backendId);
    if (!Number.isSafeInteger(backendId) || backendId <= 0) {
      return reply.status(400).send({ error: "A valid backendId is required" });
    }
    if (!fastify.db.getBackend(backendId)) return reply.status(404).send({ error: "Backend not found" });
    return { rules: fastify.db.getProxyNameAliases(backendId) };
  });

  fastify.put<{ Body: { backendId?: number; rules?: unknown } }>("/proxy-name-aliases", async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) return reply.status(403).send({ error: "Forbidden" });
    const { backendId, rules } = request.body ?? {};
    if (typeof backendId !== "number" || !Number.isSafeInteger(backendId) || backendId <= 0) {
      return reply.status(400).send({ error: "A valid backendId is required" });
    }
    if (!fastify.db.getBackend(backendId)) return reply.status(404).send({ error: "Backend not found" });
    let validated;
    try {
      validated = validateProxyNameAliases(rules);
    } catch (error: unknown) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "Invalid proxy name rules" });
    }
    const saved = fastify.db.updateProxyNameAliases(backendId, validated);
    fastify.notifyStatsSettingsChanged?.(backendId);
    return { rules: saved };
  });

  // Compatibility routes: DB management
  fastify.get("/stats", async () => {
    const sqliteSize = fastify.db.getDatabaseSize();
    const sqliteCount = fastify.db.getTotalConnectionLogsCount();
    const chStats = await resolveClickHouseStorageStats(fastify);
    const clickhouseSize = chStats ? chStats.trafficSize + chStats.countrySize : 0;

    return {
      size: sqliteSize + clickhouseSize,
      sqliteSize,
      clickhouseSize,
      totalConnectionsCount: chStats ? chStats.trafficRows : sqliteCount,
    };
  });

  fastify.post("/cleanup", async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const body = request.body as { days?: number; backendId?: number };
    const days = body?.days;
    const backendId = typeof body?.backendId === "number" ? body.backendId : undefined;

    if (typeof days !== "number" || days < 0) {
      return reply.status(400).send({ error: "Valid days parameter required" });
    }

    try {
      await cleanupClickHouseData(fastify, days, backendId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fastify.log.error(`[Config] ClickHouse cleanup failed: ${message}`);
      return reply.status(500).send({ error: `ClickHouse cleanup failed: ${message}` });
    }

    const result = fastify.db.cleanupOldData(backendId ?? null, days);
    fastify.db.clearRangeQueryCache(backendId);

    if (days === 0) {
      if (backendId !== undefined) {
        fastify.realtimeStore.clearBackend(backendId);
        fastify.clearAgentRuntimeState?.(backendId);
        fastify.notifyBackendDataCleared?.(backendId);
      } else {
        const backends = fastify.db.getAllBackends();
        for (const backend of backends) {
          fastify.realtimeStore.clearBackend(backend.id);
          fastify.clearAgentRuntimeState?.(backend.id);
          fastify.notifyBackendDataCleared?.(backend.id);
        }
        fastify.clearAgentRuntimeState?.();
      }

      return {
        message: `Cleaned all data: ${result.deletedConnections} connections, ${result.deletedDomains} domains, ${result.deletedProxies} proxies`,
        deleted: result.deletedConnections,
        domains: result.deletedDomains,
        ips: result.deletedIPs,
        proxies: result.deletedProxies,
        rules: result.deletedRules,
      };
    }

    return {
      message: `Cleaned ${result.deletedConnections} old connection logs`,
      deleted: result.deletedConnections,
    };
  });

  fastify.post("/vacuum", async (_request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    fastify.db.vacuum();
    return { message: "Database vacuumed successfully" };
  });

  fastify.get("/retention", async () => {
    return fastify.db.getRetentionConfig();
  });

  fastify.put("/retention", async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const body = request.body as {
      connectionLogsDays?: number;
      hourlyStatsDays?: number;
      autoCleanup?: boolean;
    };

    if (
      body.connectionLogsDays !== undefined &&
      (body.connectionLogsDays < 1 || body.connectionLogsDays > 90)
    ) {
      return reply.status(400).send({ error: "connectionLogsDays must be between 1 and 90" });
    }

    if (
      body.hourlyStatsDays !== undefined &&
      (body.hourlyStatsDays < 7 || body.hourlyStatsDays > 365)
    ) {
      return reply.status(400).send({ error: "hourlyStatsDays must be between 7 and 365" });
    }

    const config = fastify.db.updateRetentionConfig({
      connectionLogsDays: body.connectionLogsDays,
      hourlyStatsDays: body.hourlyStatsDays,
      autoCleanup: body.autoCleanup,
    });

    return { message: "Retention configuration updated", config };
  });

  fastify.get("/geoip", async () => {
    return toGeoLookupResponse(fastify.db.getGeoLookupConfig());
  });

  fastify.put("/geoip", async (request, reply) => {
    if (fastify.authService.isShowcaseMode()) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const body = request.body as {
      provider?: GeoLookupProvider;
      onlineApiUrl?: string;
    };

    if (body.provider !== undefined && body.provider !== "online" && body.provider !== "local") {
      return reply.status(400).send({ error: "provider must be 'online' or 'local'" });
    }

    if (body.onlineApiUrl !== undefined) {
      const trimmed = body.onlineApiUrl.trim();
      if (!trimmed || !isValidHttpUrl(trimmed)) {
        return reply.status(400).send({ error: "onlineApiUrl must be a valid http/https URL" });
      }
      body.onlineApiUrl = trimmed;
    }

    if (body.provider === "local") {
      const current = fastify.db.getGeoLookupConfig();
      if (!current.localMmdbReady) {
        return reply.status(400).send({
          error: "Local MMDB is not ready. Missing required files.",
          missingMmdbFiles: current.missingMmdbFiles || [],
        });
      }
    }

    const config = fastify.db.updateGeoLookupConfig({
      provider: body.provider,
      onlineApiUrl: body.onlineApiUrl,
    });

    return {
      message: "GeoIP configuration updated",
      config: toGeoLookupResponse(config),
    };
  });
};

export default configController;
