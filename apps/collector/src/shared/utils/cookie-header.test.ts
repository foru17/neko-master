import { describe, expect, it } from "vitest";
import { readCookie } from "./cookie-header.js";

describe("readCookie", () => {
  it("decodes percent-encoded values set by @fastify/cookie", () => {
    const header = `theme=dark; neko-session=${encodeURIComponent("abc1+/=")}`;
    expect(readCookie(header, "neko-session")).toBe("abc1+/=");
  });

  it("keeps everything after the first '=' as the value", () => {
    expect(readCookie("neko-session=YWJj==; x=1", "neko-session")).toBe("YWJj==");
  });

  it("returns the raw value when percent-encoding is malformed", () => {
    expect(readCookie("neko-session=%E0%A4%A", "neko-session")).toBe("%E0%A4%A");
  });

  it("returns null when the cookie is missing", () => {
    expect(readCookie("a=1; b=2", "neko-session")).toBeNull();
    expect(readCookie(undefined, "neko-session")).toBeNull();
  });
});
