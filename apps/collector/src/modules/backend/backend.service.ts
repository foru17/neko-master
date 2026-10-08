/**
 * Backend Service - Business logic for backend management
 * Includes automatic health checking for upstream gateways
 */

import type { StatsDatabase } from '../db/db.js';
import type { RealtimeStore } from '../realtime/realtime.store.js';
import { randomBytes } from 'node:crypto';
import type {
  BackendConfig,
  CreateBackendInput,
  UpdateBackendInput,
  BackendResponse,
  BackendHealthInfo,
  BackendHealthHistory,
  TestConnectionInput,
  TestConnectionResult,
  CreateBackendResult,
  RotateAgentTokenResult,
} from './backend.types.js';
import { isAgentBackendUrl } from '@neko-master/shared';
import { loadClickHouseConfig, runClickHouseQuery } from '../clickhouse/clickhouse.config.js';
import type { ClickHouseConfig } from '../clickhouse/clickhouse.config.js';

import type { AuthService } from '../auth/auth.service.js';
import { describeGatewayError, gatewayFetch, gatewayWsTlsOptions } from '../../shared/utils/gateway-fetch.js';

/**
 * Mask URL for showcase mode - hides host, port, credentials
 * Handles various URL formats including IPv6 addresses
 */
function maskUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Only keep protocol, mask everything else
    return `${urlObj.protocol}//******`;
  } catch {
    // If URL parsing fails, use regex fallback
    // This regex handles: protocol://[anything-until-slash-or-end]
    return url.replace(/:(\/\/)[^/]+/, '://******');
  }
}

function generateAgentBackendToken(): string {
  return `ag_${randomBytes(24).toString('base64url')}`;
}

export class BackendService {
  private healthStatus = new Map<number, BackendHealthInfo>();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL_MS = Math.max(
    5_000,
    Number.parseInt(process.env.BACKEND_HEALTH_CHECK_INTERVAL_MS || '30000', 10) || 30_000,
  );

  constructor(
    private db: StatsDatabase,
    private realtimeStore: RealtimeStore,
    private authService: AuthService,
    private onBackendDataCleared?: (backendId: number) => void,
  ) {}

  /**
   * Start automatic health checks for all listening backends
   */
  startHealthChecks(): void {
    if (this.healthCheckInterval) return;
    
    console.log('[BackendService] Starting automatic health checks');
    
    // Run initial check
    this.runHealthChecks();
    
    // Schedule periodic checks
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Stop automatic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[BackendService] Stopped automatic health checks');
    }
  }

  /**
   * Get health status for a specific backend
   */
  getHealthStatus(backendId: number): BackendHealthInfo | undefined {
    return this.healthStatus.get(backendId);
  }

  /**
   * Truncate a timestamp to the current UTC minute string "YYYY-MM-DDTHH:MM"
   */
  private toMinuteKey(ts: number): string {
    return new Date(ts).toISOString().slice(0, 16);
  }

  /**
   * Run health checks for all listening backends and persist results.
   */
  private async runHealthChecks(): Promise<void> {
    const backends = this.db.getListeningBackends();
    const now = Date.now();
    const minute = this.toMinuteKey(now);

    for (const backend of backends) {
      try {
        if (isAgentBackendUrl(backend.url)) {
          const health = this.buildAgentHealthStatus(backend.id, now);

          const prevHealth = this.healthStatus.get(backend.id);
          if (prevHealth?.status !== health.status) {
            console.log(`[BackendService] Health check for ${backend.name}: ${health.status}${health.message ? ` - ${health.message}` : ''}`);
          }
          this.healthStatus.set(backend.id, health);
          this.db.repos.health.writeHealthLog(
            backend.id,
            minute,
            health.status,
            health.latency,
            health.serverLatency,
            health.message,
          );
          continue;
        }

        const startTime = Date.now();
        const result = await this.testConnection({
          url: backend.url,
          token: backend.token,
          type: backend.type,
        });
        const latency = Date.now() - startTime;

        const health: BackendHealthInfo = {
          status: result.success ? 'healthy' : 'unhealthy',
          lastChecked: Date.now(),
          message: result.message,
          latency: result.success ? latency : undefined,
        };

        // Only log when status changes or on failure
        const prevHealth = this.healthStatus.get(backend.id);
        if (!result.success || prevHealth?.status !== health.status) {
          console.log(`[BackendService] Health check for ${backend.name}: ${health.status}${result.message ? ` - ${result.message}` : ''}`);
        }

        this.healthStatus.set(backend.id, health);
        this.db.repos.health.writeHealthLog(
          backend.id,
          minute,
          health.status,
          result.success ? latency : undefined,
          undefined,
          result.message,
        );
      } catch (error) {
        const health: BackendHealthInfo = {
          status: 'unhealthy',
          lastChecked: Date.now(),
          message: error instanceof Error ? error.message : 'Health check failed',
        };
        this.healthStatus.set(backend.id, health);
        this.db.repos.health.writeHealthLog(backend.id, minute, 'unhealthy', undefined, undefined, health.message);
        console.warn(`[BackendService] Health check error for ${backend.name}:`, error);
      }
    }
  }

  /**
   * Get health history for all backends (or a single one) over the given UTC ISO range.
   * Returns data grouped by backend and enriched with backend names.
   */
  getHealthHistory(fromISO: string, toISO: string, backendId?: number): BackendHealthHistory[] {
    const rows = backendId !== undefined
      ? this.db.repos.health.getHealthHistory(backendId, fromISO, toISO)
      : this.db.repos.health.getHealthHistoryAll(fromISO, toISO);

    const backendMap = new Map(this.getAllBackends().map((b) => [b.id, b.name]));
    const grouped = new Map<number, BackendHealthHistory>();

    for (const row of rows) {
      if (!grouped.has(row.backend_id)) {
        grouped.set(row.backend_id, {
          backendId: row.backend_id,
          backendName: backendMap.get(row.backend_id) ?? `Backend ${row.backend_id}`,
          points: [],
        });
      }
      grouped.get(row.backend_id)!.points.push({
        time: row.minute,
        status: row.status,
        latency_ms: row.latency_ms,
        server_latency_ms: row.server_latency_ms,
        message: row.message,
      });
    }

    return Array.from(grouped.values());
  }

  /**
   * Attach health status to backend response
   */
  private attachHealthStatus(backend: BackendResponse): BackendResponse {
    if (isAgentBackendUrl(backend.url)) {
      // Idle agents only refresh lastSeen via the periodic heartbeat, so the
      // list badge must use the heartbeat timeout (issue #58).
      const dynamicHealth = this.buildAgentHealthStatus(backend.id, Date.now());
      this.healthStatus.set(backend.id, dynamicHealth);
      return { ...backend, health: dynamicHealth };
    }

    const health = this.healthStatus.get(backend.id);
    if (health) {
      return { ...backend, health };
    }
    return backend;
  }

  /**
   * Get all backends (with token hidden and health status attached)
   */
  getAllBackends(): BackendResponse[] {
    const backends = this.db.getAllBackends();
    const isShowcase = this.authService.isShowcaseMode();

    return backends.map((backend) => 
      this.attachHealthStatus({
        ...backend,
        url: isShowcase ? maskUrl(backend.url) : backend.url,
        // Never expose the stored upstream/agent token in list/read responses.
        // The edit form treats an empty token as "unchanged" on submit, so
        // blanking it here does not break editing but stops leaking every
        // backend's plaintext secret to any authenticated dashboard load.
        token: '',
      })
    );
  }

  /**
   * Get active backend (with health status attached)
   */
  getActiveBackend(): BackendResponse | { error: string } {
    const backend = this.db.getActiveBackend();
    if (!backend) {
      return { error: 'No active backend configured' };
    }
    const isShowcase = this.authService.isShowcaseMode();

    return this.attachHealthStatus({
      ...backend,
      url: isShowcase ? maskUrl(backend.url) : backend.url,
      // See getAllBackends: never expose the stored token in read responses.
      token: '',
    });
  }

  /**
   * Get listening backends (with health status attached)
   */
  getListeningBackends(): BackendResponse[] {
    const backends = this.db.getListeningBackends();
    const isShowcase = this.authService.isShowcaseMode();

    return backends.map((backend) => 
      this.attachHealthStatus({
        ...backend,
        url: isShowcase ? maskUrl(backend.url) : backend.url,
        // Never expose the stored upstream/agent token in list/read responses.
        // The edit form treats an empty token as "unchanged" on submit, so
        // blanking it here does not break editing but stops leaking every
        // backend's plaintext secret to any authenticated dashboard load.
        token: '',
      })
    );
  }

  /**
   * Get a single backend by ID
   */
  getBackend(id: number): BackendConfig | undefined {
    const backend = this.db.getBackend(id);
    if (!backend) return undefined;

    if (this.authService.isShowcaseMode()) {
      return {
        ...backend,
        url: maskUrl(backend.url),
      };
    }
    return backend;
  }

  /**
   * Validate a backend URL: agent:// for agent mode, otherwise http(s)/ws(s) only.
   * Rejects schemes like file:, javascript: or unparseable URLs outright.
   */
  private validateBackendUrl(url: string): void {
    if (isAgentBackendUrl(url)) {
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid backend URL');
    }
    const allowed = ['http:', 'https:', 'ws:', 'wss:'];
    if (!allowed.includes(parsed.protocol)) {
      throw new Error(`Unsupported backend URL scheme '${parsed.protocol}'. Allowed: http, https, ws, wss, agent`);
    }
  }

  /**
   * Create a new backend
   */
  createBackend(input: CreateBackendInput): CreateBackendResult {
    const { name, url, token, type = 'clash' } = input;
    this.validateBackendUrl(url);
    const isAgentMode = isAgentBackendUrl(url);
    const normalizedToken = (token || '').trim();
    const finalToken = isAgentMode
      ? (normalizedToken || generateAgentBackendToken())
      : normalizedToken;
    
    // Check if this is the first backend
    const existingBackends = this.db.getAllBackends();
    const isFirstBackend = existingBackends.length === 0;
    
    const id = this.db.createBackend({ name, url, token: finalToken, type });
    
    // If this is the first backend, automatically set it as active
    if (isFirstBackend) {
      this.db.setActiveBackend(id);
      console.log(`[API] First backend created, automatically set as active: ${name} (ID: ${id})`);
    }
    
    return {
      id,
      isActive: isFirstBackend,
      message: 'Backend created successfully',
      agentToken: isAgentMode ? finalToken : undefined,
    };
  }

  /**
   * Update a backend
   */
  updateBackend(id: number, input: UpdateBackendInput): { message: string } {
    const existing = this.db.getBackend(id);
    if (!existing) {
      throw new Error('Backend not found');
    }

    const prevAgentMode = isAgentBackendUrl(existing.url);
    const nextUrl = typeof input.url === 'string' ? input.url : existing.url;
    if (typeof input.url === 'string') {
      this.validateBackendUrl(input.url);
    }
    const nextAgentMode = isAgentBackendUrl(nextUrl);

    this.db.updateBackend(id, input);

    if (prevAgentMode && !nextAgentMode) {
      this.db.clearAgentHeartbeat(id);
      this.healthStatus.delete(id);
    }

    if (!prevAgentMode && nextAgentMode) {
      this.healthStatus.set(id, {
        status: 'unknown',
        lastChecked: Date.now(),
        message: 'Waiting for first agent heartbeat',
      });
    }

    return { message: 'Backend updated successfully' };
  }

  /**
   * Delete a backend
   */
  async deleteBackend(id: number): Promise<{ message: string }> {
    await this.clearClickHouseBackendData(id);
    this.db.deleteBackend(id);
    this.realtimeStore.clearBackend(id);
    this.onBackendDataCleared?.(id);
    return { message: 'Backend deleted successfully' };
  }

  rotateAgentToken(id: number): RotateAgentTokenResult {
    const backend = this.db.getBackend(id);
    if (!backend) {
      throw new Error('Backend not found');
    }
    if (!isAgentBackendUrl(backend.url)) {
      throw new Error('Token rotation is only supported for agent mode backends');
    }

    const nextToken = generateAgentBackendToken();
    this.db.updateBackend(id, { token: nextToken });
    this.db.clearAgentHeartbeat(id);

    this.healthStatus.set(id, {
      status: 'unknown',
      lastChecked: Date.now(),
      message: 'Agent token rotated. Waiting for new heartbeat',
    });

    return {
      message: 'Agent token rotated successfully',
      agentToken: nextToken,
    };
  }

  /**
   * Set active backend
   */
  setActiveBackend(id: number): { message: string } {
    this.db.setActiveBackend(id);
    return { message: 'Backend activated successfully' };
  }

  /**
   * Set listening state for a backend
   */
  setBackendListening(id: number, listening: boolean): { message: string } {
    this.db.setBackendListening(id, listening);
    return { message: `Backend ${listening ? 'started' : 'stopped'} listening` };
  }

  /**
   * Clear all data for a specific backend
   */
  async clearBackendData(id: number): Promise<{ message: string }> {
    await this.clearClickHouseBackendData(id);
    this.db.deleteBackendData(id);
    this.db.repos.health.deleteByBackend(id);
    // Also clear realtime cache
    this.realtimeStore.clearBackend(id);
    this.onBackendDataCleared?.(id);
    return { message: 'Backend data cleared successfully' };
  }

  private getClickHouseBaseTables(): readonly string[] {
    return ['traffic_minute', 'traffic_agg', 'traffic_detail', 'country_minute'] as const;
  }

  private async deleteClickHouseBackendRows(
    config: ClickHouseConfig,
    backendId: number,
  ): Promise<void> {
    for (const table of this.getClickHouseBaseTables()) {
      await runClickHouseQuery(
        config,
        `ALTER TABLE ${config.database}.${table} DELETE WHERE backend_id = ${backendId} SETTINGS mutations_sync = 2`,
      );
    }
  }

  private scheduleClickHouseBackendDeleteRetry(
    config: ClickHouseConfig,
    backendId: number,
  ): void {
    // Buffer tables flush asynchronously (max_time defaults to 60s).
    // Run one delayed cleanup pass to remove late-flushed rows for this backend.
    const delayMs = Math.max(
      30_000,
      Number.parseInt(process.env.CH_BACKEND_CLEAR_RETRY_DELAY_MS || '70000', 10) || 70_000,
    );
    const timer = setTimeout(() => {
      void this.deleteClickHouseBackendRows(config, backendId)
        .then(() => {
          console.info(
            `[BackendService] Completed delayed ClickHouse cleanup for backend ${backendId}`,
          );
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[BackendService] Delayed ClickHouse cleanup failed for backend ${backendId}: ${message}`,
          );
        });
    }, delayMs);
    timer.unref?.();
  }

  private async clearClickHouseBackendData(backendId: number): Promise<void> {
    const config = loadClickHouseConfig();
    console.info(`[BackendService] clearClickHouseBackendData called for backend ${backendId}, CH_ENABLED=${config.enabled}, host=${config.host}:${config.port}`);
    if (!config.enabled) {
      console.info('[BackendService] ClickHouse not enabled, skipping clear');
      return;
    }

    try {
      // Do not drop global buffer tables here: that can lose writes for other backends.
      await this.deleteClickHouseBackendRows(config, backendId);
      this.scheduleClickHouseBackendDeleteRetry(config, backendId);
      console.info(`[BackendService] Cleared ClickHouse stats for backend ${backendId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (config.required || process.env.CH_STRICT_STATS === '1') {
        throw new Error(
          `[BackendService] Failed to clear ClickHouse stats for backend ${backendId}: ${message}`,
          { cause: error },
        );
      }
      console.warn(
        `[BackendService] Failed to clear ClickHouse stats for backend ${backendId}: ${message}`,
      );
    }
  }

  /**
   * Test connection to a backend (uses stored token)
   */
  async testExistingBackendConnection(id: number): Promise<TestConnectionResult> {
    const backend = this.db.getBackend(id);
    if (!backend) {
      throw new Error('Backend not found');
    }

    if (isAgentBackendUrl(backend.url)) {
      const health = this.buildAgentHealthStatus(id, Date.now(), this.getAgentManualTestTimeoutMs());
      this.healthStatus.set(id, health);

      return {
        success: health.status === 'healthy',
        message: health.message || 'Agent status unavailable',
      };
    }

    return this.testConnection({
      url: backend.url,
      token: backend.token,
      type: backend.type,
    });
  }

  /**
   * Test connection to a backend
   */
  async testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
    const { url, token, type = 'clash' } = input;

    if (isAgentBackendUrl(url)) {
      return { success: true, message: 'Agent mode backend configured (use backend test by id for realtime online status)' };
    }
    
    if (type === 'surge') {
      return this.testSurgeConnection(url, token);
    }
    
    return this.testClashConnection(url, token);
  }

  private getAgentHeartbeatTimeoutMs(): number {
    return Math.max(
      15_000,
      Number.parseInt(process.env.AGENT_HEARTBEAT_TIMEOUT_MS || '90000', 10) || 90_000,
    );
  }

  private getAgentManualTestTimeoutMs(): number {
    // An idle agent only sends a heartbeat every 30s, so a shorter window
    // reports healthy agents as offline (issue #58). Default to the heartbeat
    // timeout unless explicitly overridden.
    const override = Number.parseInt(process.env.AGENT_MANUAL_TEST_TIMEOUT_MS || '', 10);
    return Number.isFinite(override) && override > 0
      ? Math.max(3_000, override)
      : this.getAgentHeartbeatTimeoutMs();
  }

  private buildAgentHealthStatus(
    backendId: number,
    now = Date.now(),
    timeoutMsOverride?: number,
  ): BackendHealthInfo {
    const heartbeat = this.db.getAgentHeartbeat(backendId);
    const timeoutMs = timeoutMsOverride ?? this.getAgentHeartbeatTimeoutMs();

    if (!heartbeat) {
      return {
        status: 'unknown',
        lastChecked: now,
        message: 'Waiting for first agent heartbeat',
      };
    }

    const lastSeenMs = new Date(heartbeat.lastSeen).getTime();
    const ageMs = Number.isFinite(lastSeenMs) ? Math.max(0, now - lastSeenMs) : Number.POSITIVE_INFINITY;
    const ageText = Number.isFinite(ageMs) ? `${Math.round(ageMs / 1000)}s ago` : 'unknown';
    const timeoutText = `${Math.round(timeoutMs / 1000)}s`;
    const isOnline = Number.isFinite(ageMs) && ageMs <= timeoutMs;
    const gatewayLatency = typeof heartbeat.gatewayLatencyMs === 'number' && Number.isFinite(heartbeat.gatewayLatencyMs)
      ? heartbeat.gatewayLatencyMs
      : undefined;
    const serverLatency = typeof heartbeat.serverLatencyMs === 'number' && Number.isFinite(heartbeat.serverLatencyMs)
      ? heartbeat.serverLatencyMs
      : undefined;

    return {
      status: isOnline ? 'healthy' : 'unhealthy',
      lastChecked: now,
      latency: isOnline ? gatewayLatency : undefined,
      serverLatency: isOnline ? serverLatency : undefined,
      message: isOnline
        ? `Agent ${heartbeat.agentId} online (last seen ${ageText})`
        : `Agent offline (last seen ${ageText}, timeout ${timeoutText})`,
    };
  }

  /**
   * Test Clash WebSocket connection
   */
  private async testClashConnection(url: string, token?: string): Promise<TestConnectionResult> {
    try {
      const wsUrl = url.replace('http://', 'ws://').replace('https://', 'wss://');
      const fullUrl = wsUrl.includes('/connections') ? wsUrl : `${wsUrl}/connections`;
      
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const WebSocket = (await import('ws')).default;
      
      return new Promise((resolve) => {
        const ws = new WebSocket(fullUrl, { headers, timeout: 5000, ...gatewayWsTlsOptions() });
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          ws.terminate();
          resolve({ success: false, message: 'Connection timeout' });
        }, 5000);

        const finish = (result: TestConnectionResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        };

        ws.on('open', () => {
          ws.close();
          finish({ success: true, message: 'Connection successful' });
        });

        ws.on('error', (error: unknown) => {
          finish({ success: false, message: describeGatewayError(error) });
        });

        ws.on('close', (code: number) => {
          if (code !== 1000 && code !== 1005) {
            finish({ success: false, message: `Connection closed with code ${code}` });
          }
        });
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      return { success: false, message };
    }
  }

  /**
   * Test Surge HTTP REST API connection
   * Uses /v1/environment endpoint for lightweight health check
   */
  private async testSurgeConnection(url: string, token?: string): Promise<TestConnectionResult> {
    try {
      const baseUrl = url.replace(/\/$/, '');
      // Use /v1/environment for health check (lightweight, always available)
      const testUrl = `${baseUrl}/v1/environment`;
      
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      
      if (token) {
        headers['x-key'] = token;
      }
      
      const response = await gatewayFetch(testUrl, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { success: false, message: 'Authentication failed - check your API key' };
        }
        return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
      }

      const data = await response.json() as Record<string, unknown>;
      if (data && typeof data === 'object' && data.deviceName) {
        return { success: true, message: `Connected to Surge (${String(data.deviceName)})` };
      }
      
      return { success: false, message: 'Invalid response format from Surge API' };
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, message: 'Connection timeout - check if Surge HTTP API is enabled' };
        }
        return { success: false, message: describeGatewayError(error) };
      }
      return { success: false, message: 'Connection failed' };
    }
  }
}
