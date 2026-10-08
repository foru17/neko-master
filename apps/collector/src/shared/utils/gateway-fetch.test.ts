import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeGatewayError, gatewayFetch } from "./gateway-fetch.js";

// Generate a throwaway self-signed certificate at test time instead of
// committing a private key. Skip if openssl is unavailable.
let certDir = "";
let tls: { key: Buffer; cert: Buffer } | null = null;
try {
  certDir = mkdtempSync(join(tmpdir(), "neko-gw-tls-"));
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=surge.test",
      "-keyout", join(certDir, "key.pem"),
      "-out", join(certDir, "cert.pem"),
    ],
    { stdio: "ignore" },
  );
  tls = {
    key: readFileSync(join(certDir, "key.pem")),
    cert: readFileSync(join(certDir, "cert.pem")),
  };
} catch {
  tls = null;
}

describe("describeGatewayError", () => {
  it("surfaces the hidden cause code of a fetch failure", () => {
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error("self-signed certificate in certificate chain"), {
        code: "SELF_SIGNED_CERT_IN_CHAIN",
      }),
    });
    const text = describeGatewayError(err);
    expect(text).toContain("fetch failed");
    expect(text).toContain("SELF_SIGNED_CERT_IN_CHAIN");
    expect(text).toContain("BACKEND_TLS_INSECURE");
  });

  it("adds the TLS hint for ws errors that carry a top-level code", () => {
    const err = Object.assign(new Error("self-signed certificate"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    const text = describeGatewayError(err);
    expect(text).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(text).toContain("BACKEND_TLS_INSECURE");
    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(describeGatewayError(refused)).toBe("connect ECONNREFUSED");
  });

  it("keeps plain errors unchanged", () => {
    expect(describeGatewayError(new Error("HTTP 500"))).toBe("HTTP 500");
    const refused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" }),
    });
    expect(describeGatewayError(refused)).toBe(
      "fetch failed (connect ECONNREFUSED 127.0.0.1:1)",
    );
  });
});

describe.skipIf(!tls)("gatewayFetch against a self-signed HTTPS gateway (issue #88)", () => {
  let server: Server;
  let url = "";

  beforeAll(async () => {
    server = createServer(tls!, (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ deviceName: "test-surge" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/v1/environment`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((r) => server.close(() => r()));
    if (certDir) rmSync(certDir, { recursive: true, force: true });
  });

  it("fails with a visible certificate error by default", async () => {
    vi.stubEnv("BACKEND_TLS_INSECURE", "");
    const error = await gatewayFetch(url).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect(describeGatewayError(error)).toMatch(/SELF_SIGNED|CERT/);
  });

  it("connects when BACKEND_TLS_INSECURE=1 and warns once", async () => {
    vi.stubEnv("BACKEND_TLS_INSECURE", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await gatewayFetch(url, { headers: { Accept: "application/json" } });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ deviceName: "test-surge" });
    await gatewayFetch(url);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("BACKEND_TLS_INSECURE"))).toHaveLength(1);
    warn.mockRestore();
  });
});
