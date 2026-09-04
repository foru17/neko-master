/**
 * Auth Service
 * 
 * Handles authentication configuration and token verification.
 * Uses SHA-256 hashing for token storage (not encryption, but one-way hash).
 */

import type { StatsDatabase } from '../db/db.js';
import type { AuthConfig, AuthVerifyResult, AuthState } from './auth.types.js';

// Simple hash function for token storage
async function hashToken(token: string): Promise<string> {
  // Use Node.js crypto for hashing
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function timingSafeHashEqual(a: string, b: string): Promise<boolean> {
  const crypto = await import('crypto');
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export class AuthService {
  private db: StatsDatabase;

  constructor(db: StatsDatabase) {
    this.db = db;
  }

  /**
   * Get current auth configuration
   */
  getAuthConfig(): AuthConfig {
    const config = this.db.getAuthConfig();
    return config;
  }

  /**
   * Check if access control is forced off via environment variable
   */
  isForceAccessControlOff(): boolean {
    return process.env.FORCE_ACCESS_CONTROL_OFF === 'true';
  }

  /**
   * Get auth state (for public API - doesn't expose hash)
   */
  getAuthState(): AuthState {
    const config = this.db.getAuthConfig();
    const forcedOff = this.isForceAccessControlOff();
    
    return {
      enabled: forcedOff ? false : config.enabled,
      hasToken: !!config.tokenHash,
      forceAccessControlOff: forcedOff,
      showcaseMode: this.isShowcaseMode(),
    };
  }

  /**
   * Check if showcase mode is enabled via environment variable
   */
  isShowcaseMode(): boolean {
    return process.env.SHOWCASE_SITE_MODE === 'true';
  }

  /**
   * Verified token if valid
   */ 
  async verifyToken(token: string): Promise<AuthVerifyResult> {
    if (this.isForceAccessControlOff()) {
      return { valid: true };
    }

    const config = this.db.getAuthConfig();
    
    if (!config.enabled || !config.tokenHash) {
      return { valid: true };
    }

    const tokenHash = await hashToken(token);

    if (await timingSafeHashEqual(tokenHash, config.tokenHash)) {
      return { valid: true };
    }

    // WebSocket authentication reads the raw Cookie header, where values set by
    // @fastify/cookie may still be percent-encoded. Keep the original check
    // above for backwards compatibility, then retry with the decoded value.
    try {
      const decodedToken = decodeURIComponent(token);
      if (decodedToken !== token) {
        const decodedTokenHash = await hashToken(decodedToken);
        if (await timingSafeHashEqual(decodedTokenHash, config.tokenHash)) {
          return { valid: true };
        }
      }
    } catch {
      // Malformed percent-encoding is simply treated as an invalid token.
    }

    return { valid: false, message: 'Invalid token' };
  }

  /**
   * Enable authentication with a new token
   */
  async enableAuth(token: string): Promise<void> {
    if (!this.isValidTokenFormat(token)) {
      throw new Error('Invalid token format. Token must be at least 6 characters and contain both letters and numbers.');
    }

    const tokenHash = await hashToken(token);
    this.db.updateAuthConfig({
      enabled: true,
      tokenHash,
    });
  }

  /**
   * Disable authentication
   */
  disableAuth(): void {
    this.db.updateAuthConfig({
      enabled: false,
      tokenHash: null,
    });
  }

  /**
   * Update token (when auth is already enabled)
   */
  async updateToken(token: string): Promise<void> {
    if (!this.isValidTokenFormat(token)) {
      throw new Error('Invalid token format. Token must be at least 6 characters and contain both letters and numbers.');
    }

    const tokenHash = await hashToken(token);
    this.db.updateAuthConfig({
      tokenHash,
    });
  }

  /**
   * Validate token format
   * - At least 6 characters
   * - Contains at least one letter
   * - Contains at least one number
   * - Not purely numbers or purely letters
   */
  isValidTokenFormat(token: string): boolean {
    if (!token || token.length < 6) {
      return false;
    }

    // Check for at least one letter
    const hasLetter = /[a-zA-Z]/.test(token);
    // Check for at least one number
    const hasNumber = /[0-9]/.test(token);

    return hasLetter && hasNumber;
  }

  /**
   * Check if authentication is required
   */
  isAuthRequired(): boolean {
    if (this.isForceAccessControlOff()) {
      return false;
    }
    const config = this.db.getAuthConfig();
    return config.enabled && !!config.tokenHash;
  }
}
