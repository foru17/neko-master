import { setMinuteRetentionDays } from '../../shared/utils/fact-table-routing.js';
import { StatsDatabase } from '../db/db.js';
import { RetentionConfig, DEFAULT_RETENTION } from './cleanup.types.js';

export interface CleanupOverrides {
  cleanupInterval?: number;
  connectionLogsDays?: number;
  hourlyStatsDays?: number;
  healthLogDays?: number;
  autoCleanup?: boolean;
}

/**
 * Automatic data cleanup service
 *
 * Implements tiered data retention:
 * - Minute-level stats: Short term (configurable, default 7 days)
 * - Hourly stats: Medium term (configurable, default 30 days)
 * - Backend health logs: Medium term (defaults to hourlyStatsDays, independently overridable)
 * - Daily/domain stats: Long term (permanent, continuously updated)
 */
export class CleanupService {
  private db: StatsDatabase;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private overrides: CleanupOverrides;

  constructor(db: StatsDatabase, overrides: CleanupOverrides = {}) {
    this.db = db;
    this.overrides = overrides;
  }

  /**
   * Get effective config by merging (in precedence order):
   * env/constructor overrides > DB config > defaults.
   */
  private getConfig(): RetentionConfig & { healthLogDays: number } {
    const dbConfig = this.db.getRetentionConfig();
    const merged: RetentionConfig = {
      ...DEFAULT_RETENTION,
      ...dbConfig,
      cleanupInterval: this.overrides.cleanupInterval ?? DEFAULT_RETENTION.cleanupInterval,
    };
    if (this.overrides.connectionLogsDays !== undefined) merged.connectionLogsDays = this.overrides.connectionLogsDays;
    if (this.overrides.hourlyStatsDays !== undefined) merged.hourlyStatsDays = this.overrides.hourlyStatsDays;
    if (this.overrides.autoCleanup !== undefined) merged.autoCleanup = this.overrides.autoCleanup;
    // Keep range-query routing in step with what the cleanup actually deletes.
    setMinuteRetentionDays(merged.connectionLogsDays);
    return {
      ...merged,
      healthLogDays: this.overrides.healthLogDays ?? merged.hourlyStatsDays,
    };
  }

  /**
   * Start automatic cleanup scheduling.
   *
   * The timer is always scheduled so that toggling autoCleanup via the UI
   * takes effect on the next tick without needing to restart the service.
   * Each tick re-reads the config and short-circuits if autoCleanup is off.
   */
  start(): void {
    if (this.cleanupTimer) {
      return; // Already running
    }

    const config = this.getConfig();
    console.log(`[Cleanup] Starting with retention policy:`, {
      autoCleanup: config.autoCleanup,
      minuteStats: `${config.connectionLogsDays} days`,
      hourlyStats: `${config.hourlyStatsDays} days`,
      healthLogs: `${config.healthLogDays} days`,
      interval: `${config.cleanupInterval} hours`,
    });

    // Run initial cleanup immediately so upgrading users see the effect at boot.
    this.runCleanup();

    const intervalMs = config.cleanupInterval * 60 * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      this.runCleanup();
    }, intervalMs);
  }

  /**
   * Stop automatic cleanup
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('[Cleanup] Stopped');
    }
  }

  /**
   * Run cleanup manually
   */
  async runCleanup(): Promise<void> {
    const config = this.getConfig();
    if (!config.autoCleanup) {
      return;
    }

    if (this.isRunning) {
      console.log('[Cleanup] Previous cleanup still running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // Clean up old minute-level stats
      const logsDeleted = this.cleanupConnectionLogs();

      // Clean up old hourly stats
      const hourlyDeleted = this.cleanupHourlyStats();

      // Clean up old health logs (independently overridable, defaults to hourlyStatsDays)
      this.cleanupHealthLogs();

      // Vacuum database to reclaim space (only if significant data deleted)
      const totalDeleted = logsDeleted + hourlyDeleted;
      if (totalDeleted > 10000) {
        console.log(`[Cleanup] Deleted ${totalDeleted} records, vacuuming database...`);
        this.db.vacuum();
      }

      const duration = Date.now() - startTime;
      console.log(`[Cleanup] Completed in ${duration}ms: ${logsDeleted} logs, ${hourlyDeleted} hourly records deleted`);
    } catch (err) {
      console.error('[Cleanup] Failed:', err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Clean up old minute stats (replaced connection logs)
   */
  private cleanupConnectionLogs(): number {
    const config = this.getConfig();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.connectionLogsDays);
    const cutoff = cutoffDate.toISOString();

    return this.db.deleteOldMinuteStats(cutoff);
  }

  /**
   * Clean up old health logs (uses healthLogDays override, falling back to hourlyStatsDays)
   */
  private cleanupHealthLogs(): void {
    const config = this.getConfig();
    this.db.repos.health.pruneOldLogs(config.healthLogDays);
  }

  /**
   * Clean up old hourly stats
   */
  private cleanupHourlyStats(): number {
    const config = this.getConfig();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.hourlyStatsDays);
    const cutoff = cutoffDate.toISOString().slice(0, 13) + ':00:00';

    return this.db.deleteOldHourlyStats(cutoff);
  }

  /**
   * Get current database size statistics
   */
  getStats(): {
    connectionLogsCount: number;
    hourlyStatsCount: number;
    oldestConnectionLog: string | null;
    oldestHourlyStat: string | null;
  } {
    return this.db.getCleanupStats();
  }

  /**
   * Update retention configuration
   */
  updateConfig(config: Partial<RetentionConfig>): void {
    // Save to database
    this.db.updateRetentionConfig({
      connectionLogsDays: config.connectionLogsDays,
      hourlyStatsDays: config.hourlyStatsDays,
      autoCleanup: config.autoCleanup,
    });

    // Handle interval change
    if (config.cleanupInterval !== undefined) {
      this.overrides.cleanupInterval = config.cleanupInterval;
    }

    // Restart only when the tick interval changed — autoCleanup is re-evaluated
    // on every tick now, so toggling it doesn't require a restart.
    if (config.cleanupInterval !== undefined && this.cleanupTimer) {
      this.stop();
      this.start();
    }
  }
}
