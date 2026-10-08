import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase, createTestBackend } from '../../__tests__/helpers.js';
import { AuthService } from '../auth/auth.service.js';
import type { StatsDatabase } from '../db/db.js';
import { RealtimeStore } from '../realtime/realtime.store.js';
import { BackendService } from './backend.service.js';

describe('BackendService agent heartbeat health checks', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;
  let service: BackendService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db, 'test-agent', 'agent://test-agent');
    db.setBackendListening(backendId, true);
    service = new BackendService(db, new RealtimeStore(), new AuthService(db));
  });

  afterEach(() => {
    service.stopHealthChecks();
    cleanup();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it.each([
    { timeout: undefined, ageMs: 45_000, expected: 'healthy' },
    { timeout: '20000', ageMs: 45_000, expected: 'unhealthy' },
    { timeout: undefined, ageMs: 90_000, expected: 'healthy' },
    { timeout: undefined, ageMs: 90_001, expected: 'unhealthy' },
    { timeout: 'invalid', ageMs: 45_000, expected: 'healthy' },
    { timeout: '1000', ageMs: 15_000, expected: 'healthy' },
    { timeout: '1000', ageMs: 15_001, expected: 'unhealthy' },
  ])('reports $expected for a $ageMs ms old heartbeat with timeout=$timeout', ({ timeout, ageMs, expected }) => {
    vi.stubEnv('AGENT_HEARTBEAT_TIMEOUT_MS', timeout);
    db.upsertAgentHeartbeat({
      backendId,
      agentId: 'test-agent',
      lastSeen: new Date(Date.now() - ageMs).toISOString(),
    });

    service.startHealthChecks();

    expect(service.getHealthStatus(backendId)?.status).toBe(expected);
  });

  // Issue #58: an idle agent refreshes lastSeen only via its 30s heartbeat.
  // The backend list badge and the manual test must not use a shorter window.
  it('keeps an idle agent healthy in the backend list and manual test', async () => {
    db.upsertAgentHeartbeat({
      backendId,
      agentId: 'test-agent',
      lastSeen: new Date(Date.now() - 25_000).toISOString(),
    });

    const listed = service.getAllBackends().find((b) => b.id === backendId);
    expect(listed?.health?.status).toBe('healthy');

    const manual = await service.testExistingBackendConnection(backendId);
    expect(manual.success).toBe(true);
  });

  it('still honours an explicit AGENT_MANUAL_TEST_TIMEOUT_MS', async () => {
    vi.stubEnv('AGENT_MANUAL_TEST_TIMEOUT_MS', '8000');
    db.upsertAgentHeartbeat({
      backendId,
      agentId: 'test-agent',
      lastSeen: new Date(Date.now() - 25_000).toISOString(),
    });

    const manual = await service.testExistingBackendConnection(backendId);
    expect(manual.success).toBe(false);
  });
});
