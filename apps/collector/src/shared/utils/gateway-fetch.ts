import { Agent, fetch as undiciFetch } from "undici";

// Gateways (Surge with http-api-tls, mihomo with external-controller-tls)
// often serve a self-signed certificate, or one whose SAN does not match the
// LAN IP the collector uses. BACKEND_TLS_INSECURE=1 skips certificate
// verification for gateway traffic only (issue #88). It must never be done via
// NODE_TLS_REJECT_UNAUTHORIZED, which would also weaken GeoIP and ClickHouse.

let insecureAgent: Agent | null = null;
let warned = false;

export function isGatewayTlsInsecure(): boolean {
  const raw = (process.env.BACKEND_TLS_INSECURE || "").trim().toLowerCase();
  const enabled = raw === "1" || raw === "true" || raw === "yes";
  if (enabled && !warned) {
    warned = true;
    console.warn(
      "[Gateway] BACKEND_TLS_INSECURE is enabled: TLS certificates of gateway APIs are NOT verified. Use only on trusted networks.",
    );
  }
  return enabled;
}

/** Options to spread into `new WebSocket(url, options)` for gateway sockets. */
export function gatewayWsTlsOptions(): { rejectUnauthorized?: boolean } {
  return isGatewayTlsInsecure() ? { rejectUnauthorized: false } : {};
}

/**
 * fetch() for gateway HTTP APIs. Identical to the global fetch unless
 * BACKEND_TLS_INSECURE is set, in which case certificate verification is
 * skipped for this request.
 */
export function gatewayFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!isGatewayTlsInsecure()) {
    return fetch(input, init);
  }
  insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
  return undiciFetch(input, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: insecureAgent,
  }) as unknown as Promise<Response>;
}

/**
 * Error text for a failed gateway request. Node's fetch throws a bare
 * "fetch failed" and hides the real reason (TLS, DNS, refused) in `cause`.
 */
export function describeGatewayError(error: unknown): string {
  if (!(error instanceof Error)) return String(error || "Connection failed");
  const cause = (error as Error & { cause?: unknown }).cause as
    | { code?: unknown; message?: unknown }
    | undefined;
  const code = typeof cause?.code === "string" ? cause.code : "";
  const causeMessage = typeof cause?.message === "string" ? cause.message : "";
  if (!code && !causeMessage) return error.message;
  const detail = code && causeMessage
    ? causeMessage.includes(code) ? causeMessage : `${code}: ${causeMessage}`
    : code || causeMessage;
  const hint = isTlsVerificationCode(code)
    ? " (gateway certificate not trusted; set BACKEND_TLS_INSECURE=1 to skip verification on trusted networks)"
    : "";
  return `${error.message} (${detail})${hint}`;
}

function isTlsVerificationCode(code: string): boolean {
  return (
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
    code === "CERT_HAS_EXPIRED" ||
    code === "ERR_TLS_CERT_ALTNAME_INVALID"
  );
}
