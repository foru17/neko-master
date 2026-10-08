/**
 * Surge Policy Sync Service
 * 
 * Manages background synchronization of Surge policy group selections.
 * Caches policy data in database to avoid frequent API calls.
 */

import type { StatsDatabase } from '../db/db.js';
import { gatewayFetch } from '../../shared/utils/gateway-fetch.js';

interface SurgePolicyDetail {
  policyGroup: string;
  selectedPolicy: string | null;
  policyType: string;
  allPolicies: string[];
}

export class SurgePolicySyncService {
  private syncTimers = new Map<number, NodeJS.Timeout>();
  private readonly SYNC_INTERVAL = 10 * 60 * 1000; // 10 minutes default
  private readonly SYNC_INTERVAL_MS = parseInt(process.env.SURGE_POLICY_SYNC_INTERVAL_MS || '600000');

  constructor(private db: StatsDatabase) {}

  /**
   * Start periodic sync for a backend
   */
  startSync(backendId: number, baseUrl: string, token?: string): void {
    this.stopSync(backendId);
    
    const interval = this.SYNC_INTERVAL_MS || this.SYNC_INTERVAL;
    
    // Execute immediately
    this.syncNow(backendId, baseUrl, token).catch(err => {
      console.error(`[SurgePolicySync:${backendId}] Initial sync failed:`, err.message);
    });
    
    // Set up periodic sync
    const timer = setInterval(() => {
      this.syncNow(backendId, baseUrl, token).catch(err => {
        console.error(`[SurgePolicySync:${backendId}] Scheduled sync failed:`, err.message);
      });
    }, interval);
    
    this.syncTimers.set(backendId, timer);
    console.log(`[SurgePolicySync:${backendId}] Started, interval: ${interval}ms`);
  }

  /**
   * Stop periodic sync for a backend
   */
  stopSync(backendId: number): void {
    const timer = this.syncTimers.get(backendId);
    if (timer) {
      clearInterval(timer);
      this.syncTimers.delete(backendId);
      console.log(`[SurgePolicySync:${backendId}] Stopped`);
    }
  }

  /**
   * Perform immediate sync
   */
  async syncNow(
    backendId: number, 
    baseUrl: string, 
    token?: string
  ): Promise<{ success: boolean; updated: number; message: string }> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (token) {
      headers['x-key'] = token;
    }

    try {
      // 1. Get policy groups list
      const res = await gatewayFetch(`${baseUrl}/v1/policies`, { 
        headers,
        signal: AbortSignal.timeout(10000)
      });
      
      if (!res.ok) {
        throw new Error(`Failed to fetch policies: ${res.status}`);
      }
      
      const data = await res.json() as { 
        proxies: string[]; 
        'policy-groups': string[];
      };
      
      const policyGroups = data['policy-groups'] || [];
      
      // 2. Fetch details for each policy group (with concurrency limit)
      const details: SurgePolicyDetail[] = [];
      const CONCURRENCY = 3;
      
      for (let i = 0; i < policyGroups.length; i += CONCURRENCY) {
        const batch = policyGroups.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(name => this.fetchPolicyDetail(baseUrl, name, headers))
        );
        
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            details.push(result.value);
          }
        }
      }

      // 3. Update database cache
      if (details.length > 0) {
        this.db.updateSurgePolicyCache(backendId, details);
      }

      console.log(`[SurgePolicySync:${backendId}] Synced ${details.length}/${policyGroups.length} policies`);
      
      return {
        success: true,
        updated: details.length,
        message: `Updated ${details.length} policies`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      console.error(`[SurgePolicySync:${backendId}] ${message}`);
      return { success: false, updated: 0, message };
    }
  }

  private async fetchPolicyDetail(
    baseUrl: string, 
    groupName: string, 
    headers: Record<string, string>
  ): Promise<SurgePolicyDetail | null> {
    try {
      // Surge uses /v1/policy_groups/select?group_name=xxx endpoint
      const res = await gatewayFetch(
        `${baseUrl}/v1/policy_groups/select?group_name=${encodeURIComponent(groupName)}`,
        { headers, signal: AbortSignal.timeout(5000) }
      );
      
      if (!res.ok) return null;
      
      const detail = await res.json() as { 
        policy?: string; 
        type?: string;
        policies?: string[];
      };
      
      return {
        policyGroup: groupName,
        selectedPolicy: detail.policy || null,
        policyType: detail.type || 'Select',
        allPolicies: detail.policies || [],
      };
    } catch {
      return null;
    }
  }

  /**
   * Get cache status for a backend
   */
  getCacheStatus(backendId: number): {
    cached: boolean;
    lastUpdate: string | null;
    policyCount: number;
  } {
    const lastUpdate = this.db.getSurgePolicyCacheLastUpdate(backendId);
    const policies = this.db.getSurgePolicyCache(backendId);
    
    return {
      cached: policies.length > 0,
      lastUpdate,
      policyCount: policies.length,
    };
  }
}
