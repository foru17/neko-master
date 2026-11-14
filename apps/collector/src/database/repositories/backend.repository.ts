/**
 * Backend Repository
 * 
 * Handles all backend configuration and management operations including:
 * - Backend CRUD operations
 * - Backend activation and listening state
 * - Backend data management
 */
import type Database from 'better-sqlite3';
import { deleteProxyNameAliases } from '../proxy-name-alias.js';

export interface BackendConfig {
  id: number;
  name: string;
  url: string;
  token: string;
  type: 'clash' | 'surge';
  enabled: boolean;
  is_active: boolean;
  listening: boolean;
  created_at: string;
  updated_at: string;
}

export class BackendRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create a new backend configuration
   */
  createBackend(backend: { name: string; url: string; token?: string; type?: 'clash' | 'surge' }): number {
    const stmt = this.db.prepare(`
      INSERT INTO backend_configs (name, url, token, type, enabled, is_active, listening)
      VALUES (?, ?, ?, ?, 1, 0, 1)
    `);
    const result = stmt.run(backend.name, backend.url, backend.token || '', backend.type || 'clash');
    return Number(result.lastInsertRowid);
  }

  /**
   * Get all backend configurations
   */
  getAllBackends(): BackendConfig[] {
    const stmt = this.db.prepare(`
      SELECT id, name, url, token, type, enabled, is_active, listening, created_at, updated_at
      FROM backend_configs
      ORDER BY created_at ASC
    `);
    return stmt.all() as BackendConfig[];
  }

  /**
   * Get a backend by ID
   */
  getBackend(id: number): BackendConfig | undefined {
    const stmt = this.db.prepare(`
      SELECT id, name, url, token, type, enabled, is_active, listening, created_at, updated_at
      FROM backend_configs
      WHERE id = ?
    `);
    return stmt.get(id) as BackendConfig | undefined;
  }

  /**
   * Get the currently active backend
   */
  getActiveBackend(): BackendConfig | undefined {
    const stmt = this.db.prepare(`
      SELECT id, name, url, token, type, enabled, is_active, listening, created_at, updated_at
      FROM backend_configs
      WHERE is_active = 1
      LIMIT 1
    `);
    return stmt.get() as BackendConfig | undefined;
  }

  /**
   * Get all backends that should be listening (collecting data)
   */
  getListeningBackends(): BackendConfig[] {
    const stmt = this.db.prepare(`
      SELECT id, name, url, token, type, enabled, is_active, listening, created_at, updated_at
      FROM backend_configs
      WHERE listening = 1 AND enabled = 1
    `);
    return stmt.all() as BackendConfig[];
  }

  /**
   * Update a backend configuration
   */
  updateBackend(id: number, updates: Partial<Omit<BackendConfig, 'id' | 'created_at'>>): void {
    const sets: string[] = [];
    const values: (string | number | boolean)[] = [];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      values.push(updates.name);
    }
    if (updates.url !== undefined) {
      sets.push('url = ?');
      values.push(updates.url);
    }
    if (updates.token !== undefined) {
      sets.push('token = ?');
      values.push(updates.token);
    }
    if (updates.type !== undefined) {
      sets.push('type = ?');
      values.push(updates.type);
    }
    if (updates.enabled !== undefined) {
      sets.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.listening !== undefined) {
      sets.push('listening = ?');
      values.push(updates.listening ? 1 : 0);
    }
    if (updates.is_active !== undefined) {
      sets.push('is_active = ?');
      values.push(updates.is_active ? 1 : 0);
    }

    if (sets.length === 0) return;

    sets.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE backend_configs
      SET ${sets.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...values);
  }

  /**
   * Set a backend as active (for display) - unsets all others
   */
  setActiveBackend(id: number): void {
    this.db.exec('BEGIN TRANSACTION');
    try {
      // Unset all backends as active
      this.db.prepare(`UPDATE backend_configs SET is_active = 0`).run();
      // Set the specified backend as active
      this.db.prepare(`UPDATE backend_configs SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Set listening state for a backend (controls data collection)
   */
  setBackendListening(id: number, listening: boolean): void {
    const stmt = this.db.prepare(`
      UPDATE backend_configs
      SET listening = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(listening ? 1 : 0, id);
  }

  /**
   * Delete a backend and all its associated data
   */
  deleteBackend(id: number): void {
    // ON DELETE CASCADE is declared on the child tables, but `PRAGMA
    // foreign_keys` defaults OFF in better-sqlite3 (and enabling it globally
    // would interfere with the table-rebuild migrations), so the cascade never
    // fires. Explicitly delete all associated data first to avoid orphaned
    // rows accumulating after a backend is removed.
    this.deleteBackendData(id);
    deleteProxyNameAliases(this.db, id);
    const stmt = this.db.prepare(`DELETE FROM backend_configs WHERE id = ?`);
    stmt.run(id);
  }

  /**
   * Delete all data for a specific backend
   */
  deleteBackendData(id: number): void {
    this.db.exec('BEGIN TRANSACTION');
    try {
      this.db.prepare(`DELETE FROM domain_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM ip_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM proxy_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM rule_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM rule_proxy_map WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM rule_chain_traffic WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM rule_domain_traffic WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM rule_ip_traffic WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM country_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM hourly_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM connection_logs WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM minute_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM minute_dim_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM hourly_dim_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM minute_country_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM hourly_country_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM domain_proxy_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM ip_proxy_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM device_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM device_domain_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM device_ip_stats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM backend_health_logs WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM surge_policy_cache WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM agent_heartbeats WHERE backend_id = ?`).run(id);
      this.db.prepare(`DELETE FROM agent_snapshots WHERE backend_id = ?`).run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Get total stats across all backends
   */
  getGlobalSummary(): { 
    totalConnections: number; 
    totalUpload: number; 
    totalDownload: number; 
    uniqueDomains: number; 
    uniqueIPs: number; 
    backendCount: number 
  } {
    // Calculate totals from ip_stats to include traffic with unknown domains
    const trafficStmt = this.db.prepare(`
      SELECT 
        COALESCE(SUM(total_connections), 0) as connections,
        COALESCE(SUM(total_upload), 0) as upload, 
        COALESCE(SUM(total_download), 0) as download
      FROM ip_stats
    `);
    const { connections, upload, download } = trafficStmt.get() as { 
      connections: number; 
      upload: number; 
      download: number;
    };

    const domainsStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT domain) as count FROM domain_stats
    `);
    const uniqueDomains = (domainsStmt.get() as { count: number }).count;

    const ipsStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT ip) as count FROM ip_stats
    `);
    const uniqueIPs = (ipsStmt.get() as { count: number }).count;

    const backendStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM backend_configs
    `);
    const backendCount = (backendStmt.get() as { count: number }).count;

    return {
      totalConnections: connections,
      totalUpload: upload,
      totalDownload: download,
      uniqueDomains,
      uniqueIPs,
      backendCount
    };
  }

  /**
   * Check if a backend exists
   */
  backendExists(id: number): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM backend_configs WHERE id = ?
    `);
    return stmt.get(id) !== undefined;
  }

  /**
   * Get backend count
   */
  getBackendCount(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM backend_configs
    `);
    return (stmt.get() as { count: number }).count;
  }

  /**
   * Get first backend (for migrations)
   */
  getFirstBackend(): { id: number } | undefined {
    const stmt = this.db.prepare(`
      SELECT id FROM backend_configs LIMIT 1
    `);
    return stmt.get() as { id: number } | undefined;
  }
}
