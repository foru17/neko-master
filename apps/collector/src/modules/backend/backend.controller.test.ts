import { request as httpRequest } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestBackend, createTestDatabase } from '../../__tests__/helpers.js';
import { createApp } from '../app/app.js';
import type { StatsDatabase } from '../db/db.js';
import { RealtimeStore } from '../realtime/realtime.store.js';

describe('BackendController with chunked requests', () => {
  let app: FastifyInstance;
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;
  let baseUrl: string;

  beforeEach(async () => {
    ({ db, cleanup } = createTestDatabase());
    createTestBackend(db, 'first-backend', 'agent://first-backend');
    backendId = db.createBackend({
      name: 'second-backend',
      url: 'agent://second-backend',
      token: 'original-token',
      type: 'clash',
    });
    app = await createApp({
      port: 0,
      db,
      realtimeStore: new RealtimeStore(),
      logger: false,
      autoListen: false,
    });
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    cleanup();
  });

  function postChunked(path: string, body?: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const req = httpRequest(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'transfer-encoding': 'chunked', ...headers },
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  it('activates a backend for an empty chunked POST without Content-Type', async () => {
    const response = await postChunked(`/api/backends/${backendId}/activate`);

    expect(response.status).toBe(200);
    expect(db.getActiveBackend()?.id).toBe(backendId);
  });

  it('tests an existing backend for an empty chunked POST without Content-Type', async () => {
    const testConnection = vi.spyOn(app.backendService, 'testExistingBackendConnection')
      .mockResolvedValue({ success: true, message: 'Connected' });

    const response = await postChunked(`/api/backends/${backendId}/test`);

    expect(response.status).toBe(200);
    expect(testConnection).toHaveBeenCalledWith(backendId);
  });

  it('rotates an agent token for an empty chunked POST without Content-Type', async () => {
    const response = await postChunked(`/api/backends/${backendId}/rotate-agent-token`);

    expect(response.status).toBe(200);
    expect(response.body.agentToken).toBeTypeOf('string');
    expect(db.getBackend(backendId)?.token).toBe(response.body.agentToken);
    expect(db.getBackend(backendId)?.token).not.toBe('original-token');
  });

  it('clears backend data for an empty chunked POST without Content-Type', async () => {
    const clearData = vi.spyOn(app.backendService, 'clearBackendData');

    const response = await postChunked(`/api/backends/${backendId}/clear-data`);

    expect(response.status).toBe(200);
    expect(clearData).toHaveBeenCalledWith(backendId);
  });

  it('returns 404 for an unknown backend with an empty chunked POST', async () => {
    const response = await postChunked('/api/backends/999999/activate');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Backend not found' });
  });

  it('continues to accept ordinary requests with an empty body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/backends/${backendId}/activate`,
      headers: { 'content-length': '0' },
    });

    expect(response.statusCode).toBe(200);
    expect(db.getActiveBackend()?.id).toBe(backendId);
  });

  it('still requires authentication when access control is enabled', async () => {
    vi.spyOn(app.authService, 'isAuthRequired').mockReturnValue(true);

    const response = await postChunked(`/api/backends/${backendId}/activate`);

    expect(response.status).toBe(401);
    expect(db.getActiveBackend()?.id).not.toBe(backendId);
  });

  it('keeps showcase restrictions on bodyless backend operations', async () => {
    vi.spyOn(app.authService, 'isShowcaseMode').mockReturnValue(true);

    for (const action of ['test', 'rotate-agent-token', 'clear-data']) {
      const response = await postChunked(`/api/backends/${backendId}/${action}`);
      expect(response.status).toBe(403);
    }

    const activate = await postChunked(`/api/backends/${backendId}/activate`);
    expect(activate.status).toBe(200);
  });

  it('rejects nonempty chunked requests without Content-Type', async () => {
    for (const action of ['activate', 'test', 'rotate-agent-token', 'clear-data']) {
      const response = await postChunked(`/api/backends/${backendId}/${action}`, '{}');

      expect(response.status).toBe(415);
      expect(response.body.code).toBe('FST_ERR_CTP_INVALID_MEDIA_TYPE');
    }
    expect(db.getActiveBackend()?.id).not.toBe(backendId);
    expect(db.getBackend(backendId)?.token).toBe('original-token');
  });

  it('rejects unsupported content types', async () => {
    for (const body of [undefined, 'data']) {
      const response = await postChunked(
        `/api/backends/${backendId}/activate`,
        body,
        { 'content-type': 'application/octet-stream' },
      );

      expect(response.status).toBe(415);
      expect(response.body.code).toBe('FST_ERR_CTP_INVALID_MEDIA_TYPE');
    }
  });

  it('continues to accept JSON for bodyless and body-requiring routes', async () => {
    const activate = await postChunked(
      `/api/backends/${backendId}/activate`,
      '{}',
      { 'content-type': 'application/json' },
    );
    const listening = await postChunked(
      `/api/backends/${backendId}/listening`,
      '{"listening":true}',
      { 'content-type': 'application/json' },
    );

    expect(activate.status).toBe(200);
    expect(listening.status).toBe(200);
    expect(db.getBackend(backendId)?.listening).toBeTruthy();
  });

  it('continues to reject malformed JSON', async () => {
    const response = await postChunked(
      `/api/backends/${backendId}/activate`,
      '{',
      { 'content-type': 'application/json' },
    );

    expect(response.status).toBe(400);
    expect(db.getActiveBackend()?.id).not.toBe(backendId);
  });

  it('does not change body parsing on routes that require a body', async () => {
    for (const path of ['/api/backends/', '/api/backends/test', `/api/backends/${backendId}/listening`]) {
      const response = await postChunked(path);
      expect(response.status).toBe(415);
      expect(response.body.code).toBe('FST_ERR_CTP_INVALID_MEDIA_TYPE');
    }
  });
});
