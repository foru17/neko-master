import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { StatsSummary } from '@neko-master/shared';
import type { TimeRange } from '@/lib/api';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type SummaryField =
  | 'totals'
  | 'topDomains'
  | 'topIPs'
  | 'proxyStats'
  | 'countryStats'
  | 'deviceStats'
  | 'ruleStats'
  | 'hourlyStats';

const SUMMARY_FIELD_SET = new Set<SummaryField>([
  'totals',
  'topDomains',
  'topIPs',
  'proxyStats',
  'countryStats',
  'deviceStats',
  'ruleStats',
  'hourlyStats',
]);

export interface LiveConnection {
  id: string;
  timestamp: number;
  network: string;
  sourceIP: string;
  sourcePort: string;
  destinationIP: string;
  destinationPort: string;
  domain?: string;
  rule: string;
  rulePayload?: string;
  proxy: string;
  upload: number;
  download: number;
}

interface WebSocketMessage {
  type: 'stats' | 'ping' | 'pong';
  backendId?: number;
  /** Range the payload was computed for. */
  start?: string;
  end?: string;
  summaryFields?: SummaryField[];
  data?: StatsSummary;
  liveConnections?: LiveConnection[];
  timestamp: string;
}

function sameInstant(a?: string, b?: string): boolean {
  if (!a || !b) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** True when the push carries a range that differs from the current subscription. */
function isOtherRange(message: WebSocketMessage, range?: TimeRange): boolean {
  if (!range || (message.start === undefined && message.end === undefined)) return false;
  return !sameInstant(message.start, range.start) || !sameInstant(message.end, range.end);
}

interface UseStatsWebSocketOptions {
  backendId?: number;
  range?: TimeRange;
  minPushIntervalMs?: number;
  includeSummary?: boolean;
  summaryFields?: SummaryField[];
  includeTrend?: boolean;
  trendMinutes?: number;
  trendBucketMinutes?: number;
  includeDeviceDetails?: boolean;
  deviceSourceIP?: string;
  deviceDetailLimit?: number;
  includeProxyDetails?: boolean;
  proxyChain?: string;
  proxyDetailLimit?: number;
  includeRuleDetails?: boolean;
  ruleName?: string;
  ruleDetailLimit?: number;
  includeRuleChainFlow?: boolean;
  includeDomainsPage?: boolean;
  domainsPageOffset?: number;
  domainsPageLimit?: number;
  domainsPageSortBy?: string;
  domainsPageSortOrder?: "asc" | "desc";
  domainsPageSearch?: string;
  includeIPsPage?: boolean;
  ipsPageOffset?: number;
  ipsPageLimit?: number;
  ipsPageSortBy?: string;
  ipsPageSortOrder?: "asc" | "desc";
  ipsPageSearch?: string;
  includeLiveConnections?: boolean;
  liveConnectionsLimit?: number;
  trackLastMessage?: boolean;
  enabled?: boolean;
  onMessage?: (data: StatsSummary, liveConnections?: LiveConnection[]) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

type RuntimeConfig = {
  WS_URL?: string;
  WS_PORT?: string | number;
  WS_HOST?: string;
};

function getRuntimeConfig(): RuntimeConfig | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as any).__RUNTIME_CONFIG__ as RuntimeConfig | undefined;
}

function normalizeWsUrl(rawUrl: string, runtime?: RuntimeConfig): string {
  if (typeof window === 'undefined') return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

  if (trimmed.startsWith('/')) {
    const host = runtime?.WS_HOST || window.location.host;
    return `${wsProtocol}://${host}${trimmed}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http/i, 'ws');
  }

  return trimmed;
}

function getWsUrlCandidates(): string[] {
  const runtime = getRuntimeConfig();
  const wsPort = runtime?.WS_PORT || process.env.NEXT_PUBLIC_WS_PORT || '3002';

  const configuredUrls = [
    runtime?.WS_URL,
    process.env.NEXT_PUBLIC_WS_URL,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value)
    .map((value) => normalizeWsUrl(value, runtime))
    .filter(Boolean);

  const uniqueCandidates: string[] = [];
  const pushCandidate = (url: string) => {
    if (!url || uniqueCandidates.includes(url)) return;
    uniqueCandidates.push(url);
  };

  for (const url of configuredUrls) {
    pushCandidate(url);
  }

  if (typeof window !== 'undefined') {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const hostForPort = runtime?.WS_HOST || window.location.hostname;
    const directUrl = `${wsProtocol}://${hostForPort}:${wsPort}`;
    const hostForPath = runtime?.WS_HOST || window.location.host;
    const pathUrl = `${wsProtocol}://${hostForPath}/_cm_ws`;

    // Prefer direct port URL when an explicit WS port is configured at runtime
    // (e.g. Docker with WS_EXTERNAL_PORT), since /_cm_ws has no WS proxy in Next.js.
    // In development, also prefer direct so the dev WS server is hit first.
    const preferDirect =
      process.env.NODE_ENV === 'development' || !!runtime?.WS_PORT;
    if (preferDirect) {
      pushCandidate(directUrl);
      pushCandidate(pathUrl);
    } else {
      pushCandidate(pathUrl);
      pushCandidate(directUrl);
    }

    return uniqueCandidates;
  }

  pushCandidate(`ws://localhost:${wsPort}`);
  return uniqueCandidates;
}

function normalizeSummaryFields(fields?: SummaryField[]): SummaryField[] | undefined {
  if (!fields || fields.length === 0) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      fields.filter((field): field is SummaryField => SUMMARY_FIELD_SET.has(field)),
    ),
  ).sort();

  return normalized.length > 0 ? normalized : undefined;
}

function summaryFieldsKey(fields?: SummaryField[]): string {
  const normalized = normalizeSummaryFields(fields);
  return normalized?.join(',') || '';
}

export function useStatsWebSocket(options: UseStatsWebSocketOptions = {}) {
  const {
    backendId,
    range,
    minPushIntervalMs,
    includeSummary,
    summaryFields,
    includeTrend,
    trendMinutes,
    trendBucketMinutes,
    includeDeviceDetails,
    deviceSourceIP,
    deviceDetailLimit,
    includeProxyDetails,
    proxyChain,
    proxyDetailLimit,
    includeRuleDetails,
    ruleName,
    ruleDetailLimit,
    includeRuleChainFlow,
    includeDomainsPage,
    domainsPageOffset,
    domainsPageLimit,
    domainsPageSortBy,
    domainsPageSortOrder,
    domainsPageSearch,
    includeIPsPage,
    ipsPageOffset,
    ipsPageLimit,
    ipsPageSortBy,
    ipsPageSortOrder,
    ipsPageSearch,
    includeLiveConnections,
    liveConnectionsLimit,
    trackLastMessage = true,
    enabled = true,
  } = options;
  const normalizedSummaryFields = useMemo(
    () => normalizeSummaryFields(summaryFields),
    [summaryFields],
  );
  const summaryFieldsDependencyKey = normalizedSummaryFields?.join(',') || '';
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<StatsSummary | null>(null);
  const [liveConnections, setLiveConnections] = useState<LiveConnection[]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPingTimeRef = useRef<number>(0);
  const reconnectAttemptsRef = useRef<number>(0);
  const wsUrlIndexRef = useRef<number>(0);
  const maxReconnectDelayMs = 30000;
  const onMessageRef = useRef(options.onMessage);
  const onConnectRef = useRef(options.onConnect);
  const onDisconnectRef = useRef(options.onDisconnect);
  const onErrorRef = useRef(options.onError);
  const trackLastMessageRef = useRef(trackLastMessage);
  const summaryFieldsKeyRef = useRef(summaryFieldsDependencyKey);
  const hasSummaryFieldsFilterRef = useRef(!!normalizedSummaryFields);
  const backendIdRef = useRef(backendId);
  const rangeRef = useRef(range);
  onMessageRef.current = options.onMessage;
  onConnectRef.current = options.onConnect;
  onDisconnectRef.current = options.onDisconnect;
  onErrorRef.current = options.onError;
  trackLastMessageRef.current = trackLastMessage;
  summaryFieldsKeyRef.current = summaryFieldsDependencyKey;
  hasSummaryFieldsFilterRef.current = !!normalizedSummaryFields;
  backendIdRef.current = backendId;
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (wsRef.current) {
      // Nullify handlers BEFORE closing to prevent stale onclose/onerror
      // from overwriting status set by a newer connection
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) return;
    if (typeof window === 'undefined') return;

    setStatus('connecting');

    const wsUrls = getWsUrlCandidates();
    if (wsUrlIndexRef.current >= wsUrls.length) {
      wsUrlIndexRef.current = 0;
    }
    const wsUrl = wsUrls[wsUrlIndexRef.current]!;
    
    // Cookie is handled automatically by browser
    const urlWithToken = wsUrl;
      
    console.log('[WebSocket] Connecting to:', wsUrl);

    try {
      const ws = new WebSocket(urlWithToken);
      wsRef.current = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        console.log('[WebSocket] Connected successfully');
        setStatus('connected');
        reconnectAttemptsRef.current = 0;
        wsUrlIndexRef.current = 0;
        onConnectRef.current?.();

        // Start ping interval
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            lastPingTimeRef.current = Date.now();
            ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;

          if (message.type === 'stats' && message.data) {
            // Drop in-flight pushes from a previously subscribed backend —
            // without this a backend switch briefly writes the old backend's
            // data into the new backend's caches.
            if (
              message.backendId !== undefined &&
              backendIdRef.current !== undefined &&
              message.backendId !== backendIdRef.current
            ) {
              return;
            }

            // Likewise drop late pushes computed for a previous time range.
            if (isOtherRange(message, rangeRef.current)) {
              return;
            }

            if (hasSummaryFieldsFilterRef.current) {
              const incomingSummaryFieldsKey = summaryFieldsKey(message.summaryFields);
              if (
                incomingSummaryFieldsKey &&
                incomingSummaryFieldsKey !== summaryFieldsKeyRef.current
              ) {
                return;
              }
            }

            if (trackLastMessageRef.current) {
              setLastMessage(message.data);
            }
            if (message.liveConnections) {
              setLiveConnections(message.liveConnections);
            }
            onMessageRef.current?.(message.data, message.liveConnections);
          } else if (message.type === 'pong') {
            if (lastPingTimeRef.current > 0) {
              setLatency(Date.now() - lastPingTimeRef.current);
            }
          }
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };

      ws.onclose = (event) => {
        console.log(`[WebSocket] Disconnected. Code: ${event.code}, Reason: ${event.reason}`);
        setStatus('disconnected');
        // Consumers fall back to HTTP while disconnected; a stale push must not
        // reappear (as if current) when the socket reconnects.
        if (trackLastMessageRef.current) {
          setLastMessage(null);
        }
        onDisconnectRef.current?.();

        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Try alternate endpoint (e.g. /_cm_ws <-> :3002) before backoff reconnect.
        if (!opened && wsUrlIndexRef.current < wsUrls.length - 1) {
          wsUrlIndexRef.current += 1;
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, 200);
          return;
        }

        // Auto reconnect with exponential backoff.
        const delay = Math.min(3000 * Math.pow(2, reconnectAttemptsRef.current), maxReconnectDelayMs);
        reconnectAttemptsRef.current++;
        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = (error) => {
        // Only log error if we've exhausted all candidate URLs or if the connection was already established
        if (opened || wsUrlIndexRef.current >= wsUrls.length - 1) {
          console.error('[WebSocket] Connection error. URL:', wsUrl);
        }
        setStatus('error');
        onErrorRef.current?.(error);
      };
    } catch (err) {
      console.error('[WebSocket] Failed to create connection:', err);
      setStatus('error');
    }
  }, []);

  // Send subscribe message when backend/time-range changes or WS becomes connected.
  useEffect(() => {
    if (status !== 'connected') return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    if (backendId === undefined) return;

    console.log('[WebSocket] Subscribing to backend:', backendId);
    wsRef.current.send(JSON.stringify({
      type: 'subscribe',
      backendId,
      start: range?.start,
      end: range?.end,
      minPushIntervalMs,
      includeSummary,
      summaryFields: normalizedSummaryFields,
      includeTrend,
      trendMinutes,
      trendBucketMinutes,
      includeDeviceDetails,
      deviceSourceIP,
      deviceDetailLimit,
      includeProxyDetails,
      proxyChain,
      proxyDetailLimit,
      includeRuleDetails,
      ruleName,
      ruleDetailLimit,
      includeRuleChainFlow,
      includeDomainsPage,
      domainsPageOffset,
      domainsPageLimit,
      domainsPageSortBy,
      domainsPageSortOrder,
      domainsPageSearch,
      includeIPsPage,
      ipsPageOffset,
      ipsPageLimit,
      ipsPageSortBy,
      ipsPageSortOrder,
      ipsPageSearch,
      includeLiveConnections,
      liveConnectionsLimit,
      timestamp: new Date().toISOString(),
    }));
  }, [
    backendId,
    range?.start,
    range?.end,
    minPushIntervalMs,
    includeSummary,
    summaryFieldsDependencyKey,
    includeTrend,
    trendMinutes,
    trendBucketMinutes,
    includeDeviceDetails,
    deviceSourceIP,
    deviceDetailLimit,
    includeProxyDetails,
    proxyChain,
    proxyDetailLimit,
    includeRuleDetails,
    ruleName,
    ruleDetailLimit,
    includeRuleChainFlow,
    includeDomainsPage,
    domainsPageOffset,
    domainsPageLimit,
    domainsPageSortBy,
    domainsPageSortOrder,
    domainsPageSearch,
    includeIPsPage,
    ipsPageOffset,
    ipsPageLimit,
    ipsPageSortBy,
    ipsPageSortOrder,
    ipsPageSearch,
    includeLiveConnections,
    liveConnectionsLimit,
    status,
  ]);

  const disconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    wsUrlIndexRef.current = 0;
    cleanup();
    setStatus('disconnected');
  }, [cleanup]);

  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }

    reconnectAttemptsRef.current = 0;
    connect();

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    status,
    lastMessage,
    liveConnections,
    latency,
    connect,
    disconnect,
  };
}
