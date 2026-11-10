import { afterEach, describe, expect, it, vi } from "vitest";
import type { StatsDatabase } from "../db/db.js";
import { realtimeStore } from "../realtime/realtime.store.js";
import { createCollector } from "./gateway.collector.js";
import { createSurgeCollector } from "./surge.collector.js";

// A gateway outage longer than the stale-connection timeout must not evict
// still-open connections: the first snapshot after reconnect would otherwise
// count their full cumulative bytes a second time.

const fakeDb = new Proxy(
  {},
  { get: () => vi.fn(() => undefined) },
) as unknown as StatsDatabase;

const OUTAGE_MS = 6.5 * 60 * 1000; // longer than the 5-minute stale timeout

const recorded = (spy: { mock: { calls: unknown[][] } }, backendId: number) =>
  spy.mock.calls
    .filter((call) => call[0] === backendId)
    .map((call) => {
      const traffic = call[1] as { upload: number; download: number };
      return { up: traffic.upload, down: traffic.download, conns: call[2] };
    });

describe("stale-connection eviction during a gateway outage", () => {
  let stop: (() => void) | null = null;

  afterEach(() => {
    stop?.();
    stop = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("gateway: only counts the bytes that moved after reconnect", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
    const spy = vi.spyOn(realtimeStore, "recordTraffic");
    const backendId = 9061;
    const collector = createCollector(fakeDb, "ws://127.0.0.1:1/connections", undefined, undefined, undefined, backendId);
    stop = () => collector.disconnect();
    const onData = (collector as unknown as { onData: (d: unknown) => void }).onData;
    const snapshot = (upload: number, download: number) => ({
      connections: [{
        id: "c1",
        upload,
        download,
        start: "2026-11-11T00:00:10Z",
        metadata: { host: "big.example.com", destinationIP: "203.0.113.9", sourceIP: "192.168.1.2" },
        chains: ["HK01", "Auto", "Proxy"],
        rule: "RuleSet",
        rulePayload: "x",
      }],
    });

    vi.setSystemTime(new Date("2026-11-11T00:00:20Z"));
    onData(snapshot(1_000, 5_000_000_000));
    // Link down: no snapshots, but the cleanup timer keeps firing.
    await vi.advanceTimersByTimeAsync(OUTAGE_MS);
    onData(snapshot(1_100, 5_000_000_500));

    expect(recorded(spy, backendId)).toEqual([
      { up: 1_000, down: 5_000_000_000, conns: 1 },
      { up: 100, down: 500, conns: 0 },
    ]);
  });

  it("surge: only counts the bytes that moved after reconnect", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
    const spy = vi.spyOn(realtimeStore, "recordTraffic");
    const backendId = 9062;
    const collector = createSurgeCollector(fakeDb, "http://surge.test:6171", undefined, undefined, undefined, backendId);
    stop = () => collector.stop();
    const onData = (collector as unknown as { onData: (d: unknown) => void }).onData;
    const startSec = Date.parse("2026-11-11T00:00:10Z") / 1000;
    const snapshot = (outBytes: number, inBytes: number) => ({
      requests: [{
        id: "r1",
        time: Date.now(),
        startDate: startSec,
        policyName: "Proxy",
        originalPolicyName: "Proxy",
        rule: "FINAL",
        processPath: "",
        remoteHost: "big.example.com:443",
        remoteAddress: "203.0.113.9",
        sourceAddress: "10.0.0.2",
        outBytes,
        inBytes,
      }],
    });

    vi.setSystemTime(new Date("2026-11-11T00:00:20Z"));
    onData(snapshot(1_000, 5_000_000_000));
    await vi.advanceTimersByTimeAsync(OUTAGE_MS);
    onData(snapshot(1_100, 5_000_000_500));

    expect(recorded(spy, backendId)).toEqual([
      { up: 1_000, down: 5_000_000_000, conns: 1 },
      { up: 100, down: 500, conns: 0 },
    ]);
  });
});
