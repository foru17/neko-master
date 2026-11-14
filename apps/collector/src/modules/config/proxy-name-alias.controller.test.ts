import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, createTestBackend } from '../../__tests__/helpers.js';
import { AuthService } from '../auth/auth.service.js';
import type { StatsDatabase } from '../db/db.js';
import { RealtimeStore } from '../realtime/realtime.store.js';
import configController from './config.controller.js';
import { createApp } from '../app/app.js';

describe('proxy name alias settings API', () => {
  let app: FastifyInstance;
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;
  let authService: AuthService;
  const notifySettingsChanged = vi.fn();
  const rules = [{ match: 'prefix', value: 'US node - ', alias: 'US node' }];

  beforeEach(async () => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
    authService = new AuthService(db);
    app = Fastify();
    app.decorate('db', db);
    app.decorate('authService', authService);
    app.decorate('realtimeStore', new RealtimeStore());
    app.decorate('notifyStatsSettingsChanged', notifySettingsChanged);
    notifySettingsChanged.mockReset();
    await app.register(configController, { prefix: '/api/db' });
  });
  afterEach(async () => { await app.close(); cleanup(); vi.restoreAllMocks(); });

  it('saves and loads backend-scoped rules', async () => {
    const save = await app.inject({ method: 'PUT', url: '/api/db/proxy-name-aliases', payload: { backendId, rules } });
    expect(save.statusCode).toBe(200);
    expect(notifySettingsChanged).toHaveBeenCalledWith(backendId);
    const load = await app.inject(`/api/db/proxy-name-aliases?backendId=${backendId}`);
    expect(load.json()).toEqual({ rules });
    const otherId = createTestBackend(db, 'other');
    expect((await app.inject(`/api/db/proxy-name-aliases?backendId=${otherId}`)).json()).toEqual({ rules: [] });
  });

  it.each(['', '0', '-1', '1.5', '1 OR 1=1'])('rejects an invalid backend ID: %s', async id => {
    const response = await app.inject(`/api/db/proxy-name-aliases?backendId=${encodeURIComponent(id)}`);
    expect(response.statusCode).toBe(400);
  });

  it('rejects missing backends and invalid rules without changing saved configuration', async () => {
    db.updateProxyNameAliases(backendId, rules);
    expect((await app.inject(`/api/db/proxy-name-aliases?backendId=999`)).statusCode).toBe(404);
    const response = await app.inject({ method: 'PUT', url: '/api/db/proxy-name-aliases', payload: { backendId, rules: [{ match: 'prefix', value: '', alias: 'US' }] } });
    expect(response.statusCode).toBe(400);
    expect(db.getProxyNameAliases(backendId)).toEqual(rules);
  });

  it('forbids showcase mutations', async () => {
    vi.spyOn(authService, 'isShowcaseMode').mockReturnValue(true);
    const response = await app.inject({ method: 'PUT', url: '/api/db/proxy-name-aliases', payload: { backendId, rules } });
    expect(response.statusCode).toBe(403);
    expect(db.getProxyNameAliases(backendId)).toEqual([]);
    expect(notifySettingsChanged).not.toHaveBeenCalled();
  });

  it('inherits authentication and refreshes statistics without discarding live traffic', async () => {
    await app.close();
    db.setBackendListening(backendId, false);
    const store = new RealtimeStore();
    store.setDatabase(db);
    store.recordTraffic(backendId, { domain: 'example.com', ip: '1.1.1.1', chains: ['US node - 50GB'], rule: 'MATCH', rulePayload: '', upload: 1, download: 7 });
    app = await createApp({ port: 0, autoListen: false, db, realtimeStore: store, onStatsSettingsChanged: notifySettingsChanged });
    await app.authService.enableAuth('testToken123');
    expect((await app.inject(`/api/db/proxy-name-aliases?backendId=${backendId}`)).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/db/proxy-name-aliases', payload: { backendId, rules } })).statusCode).toBe(401);
    const response = await app.inject({ method: 'PUT', url: '/api/db/proxy-name-aliases', headers: { authorization: 'Bearer testToken123' }, payload: { backendId, rules } });
    expect(response.statusCode).toBe(200);
    expect(notifySettingsChanged).toHaveBeenCalledWith(backendId);
    expect(store.getSummaryDelta(backendId).download).toBe(7);
    expect(store.mergeProxyStats(backendId, [])).toMatchObject([{ chain: 'US node', totalDownload: 7 }]);
  });
});
