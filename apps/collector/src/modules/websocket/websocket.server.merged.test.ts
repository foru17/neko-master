import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';
import { createTestDatabase, createTestBackend } from '../../__tests__/helpers.js';
import { MERGED_BACKEND_ID } from '@neko-master/shared';
import { StatsWebSocketServer } from './websocket.server.js';
import { MergedAwareStatsService } from '../stats/stats.merged.service.js';
import { realtimeStore } from '../realtime/realtime.store.js';
import type { StatsDatabase } from '../db/db.js';

const MERGED = MERGED_BACKEND_ID;

interface StatsMessage {
  type: string;
  backendId?: number;
  data?: { totalUpload: number; totalDownload: number; totalDomains: number };
}

function waitForMessage(messages: StatsMessage[], matches: () => number, atLeast: number): Promise<void> {
  if (matches() >= atLeast) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const timer = setInterval(() => {
      if (matches() >= atLeast) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for message ${atLeast}`));
      }
    }, 10);
  });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('StatsWebSocketServer merged subscriptions', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendA: number;
  let backendB: number;
  let server: StatsWebSocketServer;
  let port: number;
  const sockets: WebSocket[] = [];

  const traffic = (domain: string, ip: string, upload: number, download: number) => ({
    domain, ip, chain: 'DIRECT', chains: ['DIRECT'], rule: 'Match', rulePayload: '',
    upload, download, sourceIP: '192.168.1.10', timestampMs: Date.now(),
  });

  async function openClient(subscription: Record<string, unknown>): Promise<StatsMessage[]> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(ws);
    const messages: StatsMessage[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString()) as StatsMessage));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (error) => reject(error));
    });
    ws.send(JSON.stringify({ type: 'subscribe', includeSummary: true, summaryFields: ['totals'], ...subscription }));
    return messages;
  }

  const countFor = (messages: StatsMessage[], backendId: number) =>
    messages.filter((message) => message.type === 'stats' && message.backendId === backendId).length;

  beforeEach(async () => {
    ({ db, cleanup } = createTestDatabase());
    backendA = createTestBackend(db, 'alpha', 'http://127.0.0.1:9091');
    backendB = createTestBackend(db, 'beta', 'http://127.0.0.1:9092');
    db.batchUpdateTrafficStats(backendA, [traffic('a.com', '1.1.1.1', 100, 1000)]);
    db.batchUpdateTrafficStats(backendB, [traffic('b.com', '2.2.2.2', 200, 2000), traffic('a.com', '1.1.1.1', 5, 50)]);

    // Port 0 lets the OS pick a free port, so parallel test files cannot race for it.
    server = new StatsWebSocketServer(0, db, new MergedAwareStatsService(db, realtimeStore));
    server.start();
    const wss = (server as unknown as { wss: WebSocketServer }).wss;
    // address() stays null until the server is listening.
    if (wss.address() === null) {
      await new Promise<void>((resolve) => wss.once('listening', resolve));
    }
    const address = wss.address();
    if (address === null || typeof address === 'string') {
      throw new Error('WebSocket server did not report its port');
    }
    port = address.port;
  });

  afterEach(() => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    server.stop();
    realtimeStore.clearBackend(backendA);
    realtimeStore.clearBackend(backendB);
    cleanup();
  });

  it('serves a subscription for the merged id', async () => {
    const messages = await openClient({ backendId: MERGED });

    await waitForMessage(messages, () => countFor(messages, MERGED), 1);
    const merged = messages.find((message) => message.backendId === MERGED)!;

    expect(merged.type).toBe('stats');
    expect(merged.data).toMatchObject({ totalUpload: 305, totalDownload: 3050, totalDomains: 2 });
  });

  it('pushes traffic from any member backend to merged subscribers only', async () => {
    const merged = await openClient({ backendId: MERGED });
    const beta = await openClient({ backendId: backendB });
    await waitForMessage(merged, () => countFor(merged, MERGED), 1);
    await waitForMessage(beta, () => countFor(beta, backendB), 1);
    // A single-backend client receives both the initial snapshot (sent for the
    // active backend) and the reply to its subscription, both tagged with that
    // backend. Let them arrive before taking the baseline.
    await pause(300);
    const mergedBefore = countFor(merged, MERGED);
    const betaBefore = countFor(beta, backendB);

    // Traffic on backend A: the merged view follows it, backend B's own view does not.
    server.broadcastStats(backendA, true);
    await waitForMessage(merged, () => countFor(merged, MERGED), mergedBefore + 1);
    await pause(200);
    expect(countFor(beta, backendB)).toBe(betaBefore);

    // Traffic on backend B reaches both.
    server.broadcastStats(backendB, true);
    await waitForMessage(merged, () => countFor(merged, MERGED), mergedBefore + 2);
    await waitForMessage(beta, () => countFor(beta, backendB), betaBefore + 1);
  });

  it('refreshes the merged view when a member flushes', async () => {
    const messages = await openClient({ backendId: MERGED });
    await waitForMessage(messages, () => countFor(messages, MERGED), 1);
    const before = countFor(messages, MERGED);

    // What index.ts does when a backend flushes: drop that backend's range
    // cache and the WebSocket summary caches built from it.
    db.batchUpdateTrafficStats(backendA, [traffic('more.com', '3.3.3.3', 7, 70)]);
    db.clearRangeQueryCache(backendA);
    server.clearBackendCache(backendA);
    server.broadcastStats(backendA, true);

    await waitForMessage(messages, () => countFor(messages, MERGED), before + 1);
    const latest = messages.filter((message) => message.backendId === MERGED).at(-1)!;
    expect(latest.data).toMatchObject({ totalUpload: 312, totalDomains: 3 });
  });

  it('still refuses a subscription to a backend that does not exist', async () => {
    const messages = await openClient({ backendId: 99999 });
    await pause(300);

    // Only the initial snapshot (for the active backend) ever arrives.
    expect(countFor(messages, 99999)).toBe(0);
    expect(messages.some((message) => message.backendId === backendB)).toBe(true);
  });
});
