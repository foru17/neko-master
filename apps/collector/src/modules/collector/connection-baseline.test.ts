import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { StatsDatabase } from "../db/db.js";
import { realtimeStore } from "../realtime/realtime.store.js";
import {
  PREEXISTING_GRACE_MS,
  isPreexistingConnection,
  parseConnectionStartMs,
} from "./connection-baseline.js";
import { createCollector } from "./gateway.collector.js";
import { createSurgeCollector } from "./surge.collector.js";

// Every DB method is a no-op; these tests only observe what reaches the
// realtime store.
const fakeDb = new Proxy(
  {},
  { get: () => vi.fn(() => undefined) },
) as unknown as StatsDatabase;

const recordedBytes = (spy: { mock: { calls: unknown[][] } }, backendId: number) =>
  spy.mock.calls
    .filter((call) => call[0] === backendId)
    .map((call) => {
      const traffic = call[1] as { upload: number; download: number };
      return { up: traffic.upload, down: traffic.download, conns: call[2] };
    });

describe("connection start parsing", () => {
  it("parses ISO strings, epoch seconds and epoch milliseconds", () => {
    expect(parseConnectionStartMs("2026-10-09T08:00:00.000Z")).toBe(
      Date.parse("2026-10-09T08:00:00.000Z"),
    );
    expect(parseConnectionStartMs(1_760_000_000.5)).toBe(1_760_000_000_500);
    expect(parseConnectionStartMs(1_760_000_000_500)).toBe(1_760_000_000_500);
  });

  it("returns null for missing or invalid values", () => {
    expect(parseConnectionStartMs(undefined)).toBeNull();
    expect(parseConnectionStartMs("")).toBeNull();
    expect(parseConnectionStartMs("not a date")).toBeNull();
    expect(parseConnectionStartMs(0)).toBeNull();
    expect(parseConnectionStartMs(Number.NaN)).toBeNull();
  });

  it("only treats clearly older connections as preexisting", () => {
    const startedAt = Date.parse("2026-10-09T08:00:00.000Z");
    expect(isPreexistingConnection("2026-10-09T07:00:00.000Z", startedAt)).toBe(true);
    // Within the clock-skew grace window: counted as new.
    expect(
      isPreexistingConnection(new Date(startedAt - PREEXISTING_GRACE_MS + 1).toISOString(), startedAt),
    ).toBe(false);
    expect(isPreexistingConnection("2026-10-09T08:00:01.000Z", startedAt)).toBe(false);
    // Unknown start time never drops traffic.
    expect(isPreexistingConnection(undefined, startedAt)).toBe(false);
  });
});

describe("gateway collector restart baseline (issue #50)", () => {
  let wss: WebSocketServer | null = null;
  let stop: (() => void) | null = null;

  afterEach(async () => {
    stop?.();
    stop = null;
    vi.restoreAllMocks();
    if (wss) {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((r) => wss!.close(() => r()));
      wss = null;
    }
  });

  it("does not count cumulative bytes of connections opened before start", async () => {
    const spy = vi.spyOn(realtimeStore, "recordTraffic");
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss!.on("listening", () => r()));
    const port = (wss.address() as AddressInfo).port;
    const socketReady = new Promise<WsSocket>((r) => wss!.on("connection", r));

    const backendId = 9050;
    const collector = createCollector(
      fakeDb,
      `ws://127.0.0.1:${port}`,
      undefined,
      undefined,
      undefined,
      backendId,
    );
    stop = () => collector.disconnect();
    collector.connect();
    const socket = await socketReady;

    const oldStart = new Date(Date.now() - 3_600_000).toISOString();
    const newStart = new Date(Date.now() + 1_000).toISOString();
    const conn = (id: string, start: string, upload: number, download: number) => ({
      id,
      start,
      upload,
      download,
      chains: ["Proxy"],
      rule: "Match",
      rulePayload: "",
      metadata: { host: `${id}.example.com`, destinationIP: "1.1.1.1", sourceIP: "10.0.0.2" },
    });

    // First snapshot after (re)start: a long-lived connection carrying 17 GB
    // of history, plus a connection opened after the collector started.
    socket.send(
      JSON.stringify({
        connections: [
          conn("old", oldStart, 17e9, 17e9),
          conn("idle", oldStart, 0, 0),
          conn("new", newStart, 300, 400),
        ],
      }),
    );
    await vi.waitFor(() => expect(recordedBytes(spy, backendId)).toHaveLength(1), {
      timeout: 2000,
      interval: 20,
    });
    expect(recordedBytes(spy, backendId)).toEqual([{ up: 300, down: 400, conns: 1 }]);

    // Second snapshot: the old connection moves 1000 bytes, which is counted
    // as a delta; it was already counted as a connection before the restart.
    socket.send(
      JSON.stringify({
        connections: [
          conn("old", oldStart, 17e9 + 1000, 17e9),
          conn("idle", oldStart, 50, 0),
          conn("new", newStart, 300, 400),
        ],
      }),
    );
    await vi.waitFor(() => expect(recordedBytes(spy, backendId)).toHaveLength(3), {
      timeout: 2000,
      interval: 20,
    });
    expect(recordedBytes(spy, backendId).slice(1)).toEqual([
      { up: 1000, down: 0, conns: 0 },
      // An idle preexisting connection was never counted, so its first bytes
      // still add one connection.
      { up: 50, down: 0, conns: 1 },
    ]);
  });
});

describe("surge collector restart baseline (issue #50)", () => {
  let stop: (() => void) | null = null;

  afterEach(() => {
    stop?.();
    stop = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not count requests that started before the collector", async () => {
    const spy = vi.spyOn(realtimeStore, "recordTraffic");
    const nowSec = Date.now() / 1000;
    const request = (id: string, startDate: number, outBytes: number, inBytes: number) => ({
      id,
      time: Date.now(),
      startDate,
      policyName: "Proxy",
      originalPolicyName: "Proxy",
      rule: "FINAL",
      processPath: "",
      remoteHost: `${id}.example.com:443`,
      remoteAddress: "1.1.1.1",
      sourceAddress: "10.0.0.2",
      outBytes,
      inBytes,
    });

    let poll = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (!url.includes("/v1/requests/recent")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        poll++;
        const oldBytes = poll === 1 ? 17e9 : 17e9 + 500;
        return new Response(
          JSON.stringify({
            requests: [
              request("old", nowSec - 3600, oldBytes, 0),
              // Completed before the restart but still in the recent list.
              { ...request("done", nowSec - 600, 9e9, 9e9), completed: true },
              request("new", nowSec + 1, 300, 400),
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const backendId = 9051;
    const collector = createSurgeCollector(
      fakeDb,
      "http://surge.test:6171",
      undefined,
      undefined,
      undefined,
      backendId,
    );
    stop = () => collector.stop();
    collector.start();

    await vi.waitFor(() => expect(recordedBytes(spy, backendId)).toHaveLength(2), {
      timeout: 6000,
      interval: 50,
    });
    expect(recordedBytes(spy, backendId)).toEqual([
      { up: 300, down: 400, conns: 1 },
      { up: 500, down: 0, conns: 0 },
    ]);
  }, 10_000);
});
