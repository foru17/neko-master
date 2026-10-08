import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { GatewayCollector } from "./gateway.collector.js";

describe("GatewayCollector", () => {
  let servers: WebSocketServer[] = [];
  let collectors: GatewayCollector[] = [];

  const makeServer = () =>
    new Promise<WebSocketServer>((resolve) => {
      const wss = new WebSocketServer({ port: 0 });
      servers.push(wss);
      wss.on("listening", () => resolve(wss));
    });

  afterEach(async () => {
    for (const c of collectors) c.disconnect();
    collectors = [];
    await Promise.all(
      servers.map(
        (wss) =>
          new Promise<void>((r) => {
            // Force-close any client sockets first (a paused/half-dead socket
            // would otherwise keep wss.close() pending forever).
            for (const client of wss.clients) client.terminate();
            wss.close(() => r());
          }),
      ),
    );
    servers = [];
  });

  it.each([
    {
      gateway: "Stash",
      id: 648256,
      upload: { current: 0, max: 10, total: 5157 },
      download: { current: 0, max: 20, total: 6681 },
    },
    { gateway: "Clash", id: "648256", upload: 5157, download: 6681 },
  ])("delivers cumulative $gateway counters to the traffic callback", async (fixture) => {
    const wss = await makeServer();
    const port = (wss.address() as AddressInfo).port;
    const onData = vi.fn();
    const metadata = { host: "example.com", destinationIP: "203.0.113.1" };
    const connection = { ...fixture, metadata, chains: ["DIRECT"], rule: "Match" };
    wss.on("connection", (socket) => {
      socket.send(JSON.stringify({
        uploadTotal: 5157,
        downloadTotal: 6681,
        connections: [connection],
      }));
      socket.send(JSON.stringify({
        uploadTotal: 5177,
        downloadTotal: 6731,
        connections: [{
          ...connection,
          upload: fixture.gateway === "Stash" ? { total: 5177, current: 0 } : 5177,
          download: fixture.gateway === "Stash" ? { total: 6731, current: 0 } : 6731,
        }],
      }));
    });
    const collector = new GatewayCollector(3, { url: `ws://127.0.0.1:${port}`, onData });
    collectors.push(collector);
    collector.connect();

    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(2));
    const first = onData.mock.calls[0][0].connections[0];
    const second = onData.mock.calls[1][0].connections[0];
    expect(first).toMatchObject({ id: "648256", upload: 5157, download: 6681, metadata });
    expect(second.id).toBe(first.id);
    expect(second.upload - first.upload).toBe(20);
    expect(second.download - first.download).toBe(50);
  });

  it("ignores invalid counter totals and preserves keepalive messages", async () => {
    const wss = await makeServer();
    const port = (wss.address() as AddressInfo).port;
    const onData = vi.fn();
    wss.on("connection", (socket) => {
      socket.send(JSON.stringify({ connections: [{ id: "invalid", upload: { total: "123" }, download: { total: -1 } }] }));
      socket.send(JSON.stringify({ connections: [] }));
      socket.send(JSON.stringify({ memory: 1024 }));
    });
    const collector = new GatewayCollector(4, { url: `ws://127.0.0.1:${port}`, onData });
    collectors.push(collector);
    collector.connect();
    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(3));
    expect(onData.mock.calls[0][0].connections[0]).toMatchObject({ upload: 0, download: 0 });
    expect(onData.mock.calls[1][0]).toEqual({ connections: [] });
    expect(onData.mock.calls[2][0]).toEqual({ memory: 1024 });
  });

  it("terminates and reconnects when the link goes silent (no data, no pong)", async () => {
    const wss = await makeServer();
    const port = (wss.address() as AddressInfo).port;

    let connectionCount = 0;
    wss.on("connection", (socket) => {
      connectionCount++;
      if (connectionCount === 1) {
        // Simulate a silently dropped TCP connection: stop reading the raw
        // socket so the server never auto-replies to pings and never sends
        // data, yet never emits a close/RST frame either. Without the
        // watchdog the client would stay "connected" forever.
        const raw = (socket as unknown as { _socket?: { pause(): void } })
          ._socket;
        raw?.pause();
      }
    });

    const collector = new GatewayCollector(1, {
      url: `ws://127.0.0.1:${port}`,
      reconnectInterval: 50,
      heartbeatInterval: 30,
      heartbeatTimeout: 90,
    });
    collectors.push(collector);
    collector.connect();

    // A reconnect (2nd connection) proves the dead first connection was
    // detected and torn down by the watchdog.
    await vi.waitFor(() => expect(connectionCount).toBeGreaterThanOrEqual(2), {
      timeout: 3000,
      interval: 25,
    });
  });

  it("keeps a healthy connection alive without spurious reconnects", async () => {
    const wss = await makeServer();
    const port = (wss.address() as AddressInfo).port;

    let connectionCount = 0;
    wss.on("connection", (socket) => {
      connectionCount++;
      // Healthy backend: stream data periodically. ws also auto-replies to
      // the client pings, so lastActivity stays fresh.
      const timer = setInterval(() => {
        socket.send(JSON.stringify({ connections: [] }));
      }, 20);
      socket.on("close", () => clearInterval(timer));
    });

    const collector = new GatewayCollector(2, {
      url: `ws://127.0.0.1:${port}`,
      reconnectInterval: 50,
      heartbeatInterval: 30,
      heartbeatTimeout: 90,
    });
    collectors.push(collector);
    collector.connect();

    await new Promise((r) => setTimeout(r, 400));
    // Still the original single connection: the watchdog must not tear down a
    // live link.
    expect(connectionCount).toBe(1);
  });
});
