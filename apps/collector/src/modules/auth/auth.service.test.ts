import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, createTestBackend } from '../../__tests__/helpers.js';
import { AuthService } from './auth.service.js';
import type { StatsDatabase } from '../db/db.js';

describe('AuthService', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let authService: AuthService;

  beforeEach(() => {
    ({ db, cleanup } = createTestDatabase());
    createTestBackend(db);
    authService = new AuthService(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('getAuthState', () => {
    it('should return disabled state by default', () => {
      const state = authService.getAuthState();
      expect(state.enabled).toBe(false);
      expect(state.hasToken).toBe(false);
    });
  });

  describe('enableAuth / verifyToken', () => {
    it('should enable auth and verify correct token', async () => {
      await authService.enableAuth('test123abc');

      expect(authService.isAuthRequired()).toBe(true);

      const result = await authService.verifyToken('test123abc');
      expect(result.valid).toBe(true);
    });

    it('should verify URL-encoded session tokens', async () => {
      const token = 'abc1+/=';
      await authService.enableAuth(token);

      const encodedToken = encodeURIComponent(token);
      expect(encodedToken).toBe('abc1%2B%2F%3D');

      const result = await authService.verifyToken(encodedToken);
      expect(result.valid).toBe(true);
    });

    it('should reject incorrect token', async () => {
      await authService.enableAuth('correct1');

      const result = await authService.verifyToken('wrong-token-1');
      expect(result.valid).toBe(false);
    });
  });

  describe('disableAuth', () => {
    it('should disable auth and allow all requests', async () => {
      await authService.enableAuth('myToken1');
      expect(authService.isAuthRequired()).toBe(true);

      authService.disableAuth();
      expect(authService.isAuthRequired()).toBe(false);

      // Token verification should succeed when auth is disabled
      const result = await authService.verifyToken('anything');
      expect(result.valid).toBe(true);
    });
  });

  describe('isValidTokenFormat', () => {
    it('should reject tokens shorter than 6 characters', () => {
      expect(authService.isValidTokenFormat('ab1')).toBe(false);
    });

    it('should reject purely numeric tokens', () => {
      expect(authService.isValidTokenFormat('123456')).toBe(false);
    });

    it('should reject purely alphabetic tokens', () => {
      expect(authService.isValidTokenFormat('abcdef')).toBe(false);
    });

    it('should accept valid mixed tokens', () => {
      expect(authService.isValidTokenFormat('abc123')).toBe(true);
      expect(authService.isValidTokenFormat('MyP4ssw0rd')).toBe(true);
    });
  });

  describe('updateToken', () => {
    it('should update token and verify new one', async () => {
      await authService.enableAuth('oldToken1');
      await authService.updateToken('newToken2');

      const oldResult = await authService.verifyToken('oldToken1');
      expect(oldResult.valid).toBe(false);

      const newResult = await authService.verifyToken('newToken2');
      expect(newResult.valid).toBe(true);
    });
  });
});
