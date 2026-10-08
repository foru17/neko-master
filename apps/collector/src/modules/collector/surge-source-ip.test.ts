import { describe, expect, it } from "vitest";
import { surgeSourceIP } from "./surge.collector.js";

describe("surgeSourceIP (issue #90)", () => {
  it("uses the requesting client from sourceAddress", () => {
    expect(surgeSourceIP("10.0.0.44", "10.0.0.88")).toBe("10.0.0.44");
    expect(surgeSourceIP("10.0.0.44:51234", "")).toBe("10.0.0.44");
  });

  it("falls back to localAddress for requests made by the Surge host itself", () => {
    expect(surgeSourceIP("127.0.0.1", "10.0.0.88")).toBe("10.0.0.88");
    expect(surgeSourceIP("::1", "10.0.0.88:6152")).toBe("10.0.0.88");
    expect(surgeSourceIP("::ffff:127.0.0.1", "10.0.0.88")).toBe("10.0.0.88");
  });

  it("falls back to localAddress when sourceAddress is missing", () => {
    expect(surgeSourceIP(undefined, "192.168.1.2:56123")).toBe("192.168.1.2");
    expect(surgeSourceIP("127.0.0.1", undefined)).toBe("127.0.0.1");
    expect(surgeSourceIP(undefined, undefined)).toBe("");
  });
});
