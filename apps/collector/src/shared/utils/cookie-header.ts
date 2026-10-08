/**
 * Read one cookie from a raw `Cookie` header. The WebSocket server sees the
 * header before any cookie plugin runs, and @fastify/cookie percent-encodes
 * values when it sets them, so values are decoded here (issue #92). Only the
 * first `=` separates name and value; base64 tokens may contain `=`.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}
