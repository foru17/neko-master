# Neko Master Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                     Frontend Layer                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Next.js 16 (App Router)                                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │  Dashboard  │  │  Overview   │  │   Charts    │  │  Interactive Tables     │ │   │
│  │  │             │  │             │  │             │  │                         │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  React Query (TanStack)                                                 │   │   │
│  │  │  - API data fetching and caching                                        │   │   │
│  │  │  - Optimistic updates and state management                              │   │   │
│  │  │  - Auto-retry and error handling                                        │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  useStatsWebSocket Hook                                                  │   │   │
│  │  │  - WebSocket connection management                                        │   │   │
│  │  │  - Real-time data subscription                                            │   │   │
│  │  │  - Auto-reconnect and heartbeat                                           │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           │ HTTP / WebSocket
                                           │ (Cookie Authentication)
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                     Collector Layer                                      │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         API Server (Fastify)                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  REST API Endpoints                                                      │   │   │
│  │  │  ├─ /api/backends        - Backend management                             │   │   │
│  │  │  ├─ /api/stats           - Statistics                                     │   │   │
│  │  │  ├─ /api/auth            - Authentication                                 │   │   │
│  │  │  ├─ /api/domains         - Domain statistics                              │   │   │
│  │  │  ├─ /api/ips             - IP statistics                                  │   │   │
│  │  │  ├─ /api/proxies         - Proxy statistics                               │   │   │
│  │  │  ├─ /api/rules           - Rule statistics                                │   │   │
│  │  │  ├─ /api/devices         - Device statistics                              │   │   │
│  │  │  ├─ /api/gateway/*       - Gateway proxy APIs                             │   │   │
│  │  │  └─ /api/retention       - Data retention config                          │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                           │                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     WebSocket Server (ws)                                        │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  Real-time Data Push                                                      │   │   │
│  │  │  - Connection management (Client Connections)                             │   │   │
│  │  │  - Subscription management (Range, Backend, PushInterval)                 │   │   │
│  │  │  - Broadcast push (Broadcast Stats)                                       │   │   │
│  │  │  - Summary cache (2s TTL)                                                 │   │   │
│  │  │  - Policy cache sync (Surge Policy Sync)                                  │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     Gateway Collector(s)                                        │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐      │   │
│  │  │   Clash Collector   │  │   Clash Collector   │  │   Surge Collector   │      │   │
│  │  │   (Clash/Mihomo)    │  │   (Clash/Mihomo)    │  │   (Surge)           │      │   │
│  │  │                     │  │                     │  │                     │      │   │
│  │  │  WebSocket Client   │  │  WebSocket Client   │  │  HTTP REST Polling  │      │   │
│  │  │       ↕ (Real-time) │  │       ↕ (Real-time) │  │       ↕ (2s Poll)   │      │   │
│  │  │    Gateway WS       │  │    Gateway WS       │  │    HTTP API         │      │   │
│  │  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘      │   │
│  │                                                                                  │   │
│  │  Features:                                                                       │   │
│  │  - Connection pool management (Reconnection)                                     │   │
│  │  - Traffic tracking (Traffic Tracking)                                           │   │
│  │  - Delta calculation (Delta Calculation)                                         │   │
│  │  - Batch buffering (Batch Buffer, 30s flush)                                     │   │
│  │  - Policy cache sync (Policy Cache Sync, 10min)                                  │   │
│  │  - Exponential backoff retry                                                     │   │
│  │  - GeoIP query integration                                                       │   │
│  │  - Real-time data broadcast (→ RealtimeStore)                                    │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     Policy Sync Service                                          │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  Surge Policy Cache Sync (Background Task)                                │   │   │
│  │  │  - Scheduled sync: /v1/policies + /v1/policy_groups/select               │   │   │
│  │  │  - Storage: surge_policy_cache table                                     │   │   │
│  │  │  - Cache TTL: 10 minutes                                                 │   │   │
│  │  │  - Fallback: Direct API fetch                                            │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     RealtimeStore (In-Memory Real-time Data)                     │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  Real-time delta cache (isolated by backend)                              │   │   │
│  │  │  - summaryByBackend:    Total traffic delta                               │   │   │
│  │  │  - minuteByBackend:     Minute-level traffic buckets                      │   │   │
│  │  │  - domainByBackend:     Domain deltas                                     │   │   │
│  │  │  - ipByBackend:         IP deltas                                         │   │   │
│  │  │  - proxyByBackend:      Proxy deltas                                      │   │   │
│  │  │  - deviceByBackend:     Device deltas                                     │   │   │
│  │  │  - ruleByBackend:       Rule deltas                                       │   │   │
│  │  │  - countryByBackend:    Country/region deltas                             │   │   │
│  │  │                                                                             │   │   │
│  │  │  Functions: merge* methods merge DB data with real-time deltas             │   │   │
│  │  │  - mergeTopDomains()                                                      │   │   │
│  │  │  - mergeProxyStats()                                                      │   │   │
│  │  │  - mergeTrend()                                                           │   │   │
│  │  │  - applySummaryDelta()                                                    │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     GeoIP Service                                                │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  IP Geolocation Query                                                     │   │   │
│  │  │  - IP-API.com (default)                                                  │   │   │
│  │  │  - IPInfo.io (fallback)                                                  │   │   │
│  │  │  - Local cache (LRU)                                                      │   │   │
│  │  │  - Batch query optimization                                               │   │   │
│  │  │  - Failure cooldown mechanism                                             │   │   │
│  │  │  - IPv4/IPv6 dual-stack support                                           │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ├──→ SQLite (better-sqlite3) [always written]
                                           └──→ ClickHouse HTTP API [optional dual-write]
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                      Storage Layer                                       │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     SQLite Database (WAL Mode)  [always enabled]                 │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  Statistics Tables (partitioned by backend_id)                            │   │   │
│  │  │                                                                             │   │   │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │   │
│  │  │  │  domain_stats  │ │   ip_stats     │ │  proxy_stats   │               │   │   │
│  │  │  │                │ │                │ │                │               │   │   │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘               │   │   │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │   │
│  │  │  │  rule_stats    │ │ country_stats  │ │  device_stats  │               │   │   │
│  │  │  │                │ │                │ │                │               │   │   │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘               │   │   │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │   │
│  │  │  │minute_stats    │ │ hourly_stats   │ │  daily_stats   │               │   │   │
│  │  │  │                │ │                │ │                │               │   │   │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘               │   │   │
│  │  │                                                                             │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  Configuration & Cache Tables                                             │   │   │
│  │  │                                                                             │   │   │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │   │
│  │  │  │ backend_configs│ │   geoip_cache  │ │   asn_cache    │               │   │   │
│  │  │  │                │ │                │ │                │               │   │   │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘               │   │   │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │   │
│  │  │  │  auth_config   │ │ retention_config│ │surge_policy_cache│             │   │   │
│  │  │  │                │ │                │ │                │               │   │   │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘               │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │              ClickHouse Database [optional, enabled with CH_ENABLED=1]           │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  Buffer Tables (async receive, ~5min merge)                               │   │   │
│  │  │                                                                             │   │   │
│  │  │  ┌───────────────────────┐  ┌───────────────────────┐                   │   │   │
│  │  │  │  traffic_detail_buffer│  │  traffic_agg_buffer   │                   │   │   │
│  │  │  └───────────┬───────────┘  └──────────┬────────────┘                   │   │   │
│  │  │              │ merge                    │ merge                           │   │   │
│  │  │              ▼                          ▼                                │   │   │
│  │  │  ┌───────────────────────┐  ┌───────────────────────┐                   │   │   │
│  │  │  │  traffic_detail       │  │  traffic_agg          │                   │   │   │
│  │  │  │  (SummingMergeTree)   │  │  (SummingMergeTree)   │                   │   │   │
│  │  │  └───────────────────────┘  └───────────────────────┘                   │   │   │
│  │  │                                                                             │   │   │
│  │  │  ┌───────────────────────┐                                               │   │   │
│  │  │  │  country_buffer       │ → country_stats (SummingMergeTree)            │   │   │
│  │  │  └───────────────────────┘                                               │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           ▲
                                           │
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                     Data Sources                                         │
│                                                                                          │
│  ┌─────────────────────────────────┐    ┌─────────────────────────────────────────────┐  │
│  │     Clash / Mihomo Gateway      │    │         Surge Gateway (v5+)               │  │
│  │                                 │    │                                             │  │
│  │  ┌─────────────────────────┐   │    │  ┌─────────────────────────────────────┐   │  │
│  │  │ /connections WebSocket  │   │    │  │ HTTP REST API Endpoints             │   │  │
│  │  │ (Real-time Push)        │   │    │  │                                     │   │  │
│  │  └─────────────────────────┘   │    │  │  ├─ GET /v1/requests/recent        │   │  │
│  │  ┌─────────────────────────┐   │    │  │  │   (Recent connections, 2s poll)    │   │  │
│  │  │ /traffic                │   │    │  │  ├─ GET /v1/policies               │   │  │
│  │  │ /rules                  │   │    │  │  │   (Policy list)                    │   │  │
│  │  │ /proxies                │   │    │  │  ├─ GET /v1/policy_groups/select   │   │  │
│  │  └─────────────────────────┘   │    │  │  │   (Policy group details)           │   │  │
│  │                                 │    │  │                                     │   │  │
│  │  Connection Format:            │    │  │  Enable:                            │   │  │
│  │  {                             │    │  │  http-api = 127.0.0.1:9091         │   │  │
│  │    "connections": [{           │    │  │                                     │   │  │
│  │    "id": "uuid",               │    │  └─────────────────────────────────────┘   │  │
│  │    "metadata": {               │    │                                             │  │
│  │      "host": "example.com",    │    │  Note: DNS resolved on proxy server,        │  │
│  │      "destinationIP": "1.2.3", │    │  cannot get real landing IP                 │  │
│  │      "sourceIP": "192.168.x",  │    └─────────────────────────────────────────────┘  │
│  │      "chains": [...],          │                                                   │
│  │      "rule": "RuleSet",        │                                                   │
│  │      "upload": 1024,           │                                                   │
│  │      "download": 2048          │                                                   │
│  │    }]                          │                                                   │
│  │  }                             │                                                   │
│  └─────────────────────────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Agent Mode Architecture

Agent mode allows a centralized Neko Master panel to receive data from remote LAN gateways
without requiring direct collector-to-gateway network access.

### Components

| Component | Description |
|---|---|
| `neko-agent` | Data collection daemon — runs near the gateway, pulls data and reports to panel |
| `nekoagent` | CLI manager (shell script) — manages `neko-agent` instance lifecycle |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Central Panel (Neko Master)                   │
│                                                                   │
│  Fastify API Server                                               │
│  ├─ POST /api/agent/report       ← receive batch traffic deltas  │
│  ├─ POST /api/agent/heartbeat    ← receive heartbeat (online)    │
│  ├─ POST /api/agent/config-sync  ← receive rules/proxies config  │
│  └─ POST /api/agent/policy-state ← receive current policy state  │
│                                                                   │
│  Backend type: agent://, system-generated token, bound to agentId│
└─────────────────────────────────────────────────────────────────┘
                              ↑
                     HTTP (token auth)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                   Remote Host (near gateway)                      │
│                                                                   │
│  nekoagent (CLI manager)                                          │
│  ├─ /etc/neko-agent/<instance>.env  (config file)                │
│  └─ /var/run/neko-agent/<instance>.pid (PID file)                 │
│                                                                   │
│  neko-agent (daemon)                                              │
│  │                                                                │
│  ├── 1. Pull gateway data                                         │
│  │      ├─ Clash/Mihomo: WebSocket /connections (real-time push)  │
│  │      └─ Surge: HTTP GET /v1/requests/recent (2s poll)          │
│  │                                                                │
│  ├── 2. Delta calculation                                         │
│  │      - Identify new/updated connections                        │
│  │      - Compute upload/download deltas                          │
│  │      - Aggregate by domain + proxy + rule                      │
│  │                                                                │
│  ├── 3. Batch report (every 2s)                                   │
│  │      POST /api/agent/report                                    │
│  │      - Up to 1000 entries/batch, queue cap 50000               │
│  │                                                                │
│  ├── 4. Heartbeat (every 30s)                                     │
│  │      POST /api/agent/heartbeat                                 │
│  │                                                                │
│  ├── 5. Config sync (every 2min, MD5 dedup)                       │
│  │      POST /api/agent/config-sync                               │
│  │      - rules / proxies / providers                             │
│  │                                                                │
│  └── 6. Policy state sync (every 30s, only on state change)       │
│         POST /api/agent/policy-state                              │
│                                                                   │
│  PID lock: only one process per backendId at a time               │
└─────────────────────────────────────────────────────────────────┘
                              │
                      Local Network (LAN)
                              │
            ┌─────────────────────────────┐
            │  Clash/Mihomo or Surge      │
            │  Gateway API                │
            └─────────────────────────────┘
```

### Direct vs Agent Mode

| Dimension | Direct | Agent |
|---|---|---|
| Does collector connect to gateway? | ✅ Yes | ❌ No |
| Data latency | Milliseconds (WS) | ~2s report interval |
| Network isolation | Requires collector → gateway access | Agent initiates; no inbound needed |
| Multi-site | Complex (VPN / tunnels) | Natively supported |
| Security boundary | Shared gateway API token | Panel token isolated from gateway token |

### Security Model

- Panel generates a unique token per Agent backend
- `agentId` is derived from the backend token: `"agent-" + sha256(token)[:16]` — stable across restarts, no manual configuration needed
- A token is bound to one `agentId`; registering with the same token under a different `agentId` is rejected by the server
- Token rotation immediately invalidates old agent processes (must reconfigure with new token before restarting)
- Config sync and policy sync use MD5 dedup to skip unchanged POSTs

---

## Data Flow

### 1. Clash Data Collection Flow

```
Clash Gateway
    │
    │ WebSocket Push
    │ (per second / per connection update)
    ▼
ClashCollector
    │
    ├── 1. Traffic Tracking
    │      - Identify new/updated connections
    │      - Calculate delta (delta = current - last)
    │      - Extract proxy chains
    │
    ├── 2. Batch Buffer
    │      - Aggregate by domain+ip+chain+rule
    │      - 30s flush or 5000 entries trigger
    │
    ├── 3. GeoIP Query
    │      - Async IP geolocation query
    │      - Batch cache optimization
    │
    ├── 4. Data Write
    │      ├──→ SQLite (Persistence, always written)
    │      ├──→ ClickHouse (optional dual-write, when CH_WRITE_ENABLED=1)
    │      └──→ RealtimeStore (In-Memory)
    │
    └── 5. Trigger Broadcast
           └──→ WebSocketServer.broadcastStats()
```

### 2. Surge Data Collection Flow

```
Surge Gateway
    │
    │ HTTP Polling (2s interval)
    │ GET /v1/requests/recent
    ▼
SurgeCollector
    │
    ├── 1. Request Handling
    │      - Exponential backoff retry (max 5)
    │      - Error handling and logging
    │
    ├── 2. Traffic Tracking
    │      - Use recentlyCompleted Map to prevent duplicates
    │      - Calculate delta (delta = current - last)
    │      - Extract policy path from notes
    │
    ├── 3. Policy Cache Sync
    │      - Background policy config sync
    │      - 10-minute scheduled update
    │
    ├── 4. Batch Buffer
    │      - Same aggregation logic as Clash
    │      - 30s flush
    │
    ├── 5. Data Write
    │      ├──→ SQLite (Persistence, always written)
    │      ├──→ ClickHouse (optional dual-write, when CH_WRITE_ENABLED=1)
    │      └──→ RealtimeStore (In-Memory)
    │
    └── 6. Trigger Broadcast
           └──→ WebSocketServer.broadcastStats()
```

### 3. Real-time Data Push Flow

```
WebSocketServer
    │
    ├── Client Connection
    │      - Cookie authentication verification
    │      - Establish ClientInfo (backend, range, interval)
    │
    ├── Data Preparation
    │      - Query base data from SQLite or ClickHouse (controlled by STATS_QUERY_SOURCE)
    │      - RealtimeStore.merge*() merge real-time deltas
    │      - Summary cache (2s TTL)
    │
    └── Broadcast Push
           ├──→ Full push (stats)
           ├──→ Trend data (trend)
           ├──→ Domain pagination (domains)
           └──→ IP pagination (ips)
```

### 4. Frontend Data Fetching Flow

```
React Component
    │
    ├── Method 1: React Query (HTTP API)
    │      useTrafficTrend() ──→ api.getTrafficTrendAggregated()
    │                                      │
    │                                      ▼
    │                              Collector API
    │
    └── Method 2: WebSocket Hook
           useStatsWebSocket() ──→ WebSocket Connection
                                          │
                                          ├── Subscribe message (subscribe)
                                          ├── Receive push (stats/pong)
                                          └── Auto-reconnect
```

---

## Key Design Patterns

### Repository Pattern (Database Layer)

```
StatsDatabase (Facade Class, ~1000 lines)
    │
    ├── init() / migrations        ── DDL table creation, migration logic (kept in db.ts)
    ├── getSummary()               ── Cross-table aggregation query (kept in db.ts)
    │
    └── this.repos                 ── Repository instance composition
           ├── trafficWriter          ── Traffic writing (updateTrafficStats, batch)
           ├── domain                 ── Domain stats (6 methods)
           ├── ip                     ── IP stats + ASN/GeoIP (17 methods)
           ├── rule                   ── Rule stats + ChainFlow (10 methods)
           ├── proxy                  ── Proxy stats (3 methods)
           ├── device                 ── Device stats (3 methods)
           ├── country                ── Country/region (3 methods)
           ├── timeseries             ── Time-series data (5 methods)
           ├── config                 ── DB config/cleanup (12 methods)
           ├── backend                ── Backend management (11 methods)
           ├── auth                   ── Auth config (2 methods)
           └── surge                  ── Surge policy cache (4 methods)

BaseRepository (Abstract Base Class)
    │
    ├── parseMinuteRange()         ── Time range parsing
    ├── splitChainParts()          ── Proxy chain parsing
    ├── expandShortChainsForRules() ── Rule chain expansion
    ├── aggregateProxyStatsByFirstHop()
    ├── allocateByWeights()        ── Weight-based allocation
    └── ... 13 shared utility methods total
```

### Triple Write Pattern

```
Collector receives traffic data
    │
    ├──→ SQLite (Persistent Storage, always written)
    │      └─ Config / metadata / historical stats (auto-fallback when CH is down)
    │
    ├──→ ClickHouse (optional, when CH_WRITE_ENABLED=1)
    │      └─ Stats dual-write → Buffer tables → SummingMergeTree async merge
    │      └─ Health fallback: after CH_UNHEALTHY_THRESHOLD consecutive failures,
    │         automatically falls back to SQLite writes
    │
    └──→ RealtimeStore (In-Memory Real-time)
           └─ For real-time display, low-latency push (compensates Buffer delay)
```

**Read Routing (STATS_QUERY_SOURCE)**

```
STATS_QUERY_SOURCE=sqlite     → all reads from SQLite (default)
STATS_QUERY_SOURCE=clickhouse → all reads from ClickHouse
STATS_QUERY_SOURCE=auto       → smart routing (recent → CH, historical → SQLite)
```

### Delta Merge Pattern

```
Client requests stats
    │
    ▼
Database base data (DB)
    │
    ├── Domain stats: 100MB
    ├── Proxy stats: 50MB
    └── ...
    │
    ▼
RealtimeStore.merge*(DB data, memory delta)
    │
    └── Merged data (DB + real-time delta)
           Example: 100MB + 5MB (last 30 seconds)
```

### Multi-Backend Isolation

```
All data structures isolated by backendId:

SQLite: PRIMARY KEY (backend_id, domain)
RealtimeStore: Map<backendId, Map<key, Data>>
WebSocket: ClientInfo.backendId

Support mixed backends:
├── Backend #1: Clash (WebSocket real-time)
├── Backend #2: Clash (WebSocket real-time)
└── Backend #3: Surge (HTTP polling)
```

### Merged View

```
The reserved id MERGED_BACKEND_ID = -1 means "every enabled + listening backend, merged"
(real ids come from AUTOINCREMENT and are always positive, so it cannot collide)

HTTP  /api/stats/*?backendId=-1      ─┐
WebSocket  subscribe {backendId:-1}  ─┴─> MergedAwareStatsService (extends StatsService)
                                           │ normal backend id: parent implementation, unchanged
                                           │ -1: the same parent method for every member backend
                                           ▼
                                   stats.merge.ts (pure functions, no database access)
                                     merge by key: counters summed, latest lastSeen, string lists unioned
                                     covers domains / IPs / devices / proxies / rules / countries /
                                     time series / the rule chain graph

Distinct counts (domain count, IP count, page totals):
  COUNT over backend_id IN (...), one implementation each for SQLite and ClickHouse,
  range-cached and invalidated by a flush of any backend
```

Broadcasts: a merged subscriber receives the pushes of every member backend, and `clearBackendCache(backendId)` also drops the `-1|…` cache entries.

### Duplicate Prevention Pattern (Surge)

```
SurgeCollector
    │
    ├── recentlyCompleted Map
    │      key: requestId
    │      value: { finalUpload, finalDownload, completedAt }
    │      TTL: 5 minutes
    │
    └── Processing logic
           ├── New connection → Record initial state
           ├── Updating → Calculate delta
           └── Completed → Check Map, prevent duplicate counting
```

---

## ClickHouse Module Design

### Writer (ClickHouseWriter)

```
ClickHouseWriter
    │
    ├── Health Tracking
    │      consecutiveFailures  ── consecutive failure counter
    │      isHealthy()          ── true if < CH_UNHEALTHY_THRESHOLD
    │
    ├── insertRows()
    │      ├── Normal path → HTTP POST → ClickHouse Buffer table
    │      │      success: reset consecutiveFailures, log recovery
    │      └── On error: consecutiveFailures++
    │             reaching threshold → mark unhealthy + warn log
    │
    └── Backpressure protection
           pendingBatches ≥ CH_WRITE_MAX_PENDING_BATCHES → drop incoming batch
```

### Reader (ClickHouseReader)

```
ClickHouseReader
    │
    ├── query(sql)
    │      HTTP POST body carries SQL (avoids URL length limits)
    │      → FORMAT JSON → parse result set
    │
    └── toDateTime(value)
           valid date  → format as ClickHouse datetime string
           invalid date → clamp to current time (prevents epoch → full table scan)
```

### Dual-Write Dispatcher (BatchBuffer)

```
BatchBuffer.flush()
    │
    ├── 1. Evaluate write mode
    │      clickHouseWriter.isHealthy() → true
    │          → shouldSkipSqliteStatsWrites(true)
    │            → CH_ONLY_MODE=1: skip SQLite stats writes
    │      clickHouseWriter.isHealthy() → false
    │          → force SQLite write (regardless of CH_ONLY_MODE)
    │
    ├── 2. SQLite write (conditional on mode)
    │
    └── 3. ClickHouse write (parallel, when CH_WRITE_ENABLED=1)
           failure → does not affect SQLite; tracked internally by Writer
```

### Read Routing (StatsService)

```
STATS_QUERY_SOURCE env var
    │
    ├── sqlite      → all queries via SQLite Repository (default)
    ├── clickhouse  → all queries via ClickHouseReader
    └── auto        → shouldUseClickHouse()
                       ├── valid time range → ClickHouseReader
                       └── invalid time range → SQLite (fallback)
```

---

## Authentication Flow (Cookie-Based)

```
User Login
    │
    ▼
POST /api/auth/login
    │
    ▼
Server Verification → Set HttpOnly Cookie (auth-token)
    │
    ▼
Subsequent requests automatically carry Cookie
    │
    ├──→ HTTP API Authentication
    └──→ WebSocket Connection Authentication (req.headers.cookie)
```

---

## Performance Optimization

| Layer        | Optimization Technique                | Effect                           |
| ------------ | ------------------------------------- | -------------------------------- |
| **Collect**  | Batch Write (Batch Buffer)            | Reduce 90% DB writes             |
| **Collect**  | GeoIP Batch Query + Cache             | Reduce 80% external requests     |
| **Collect**  | Policy Cache Sync                     | Reduce 95% API calls             |
| **Collect**  | Exponential Backoff Retry             | Improve connection stability     |
| **Query**    | RealtimeStore Delta Merge             | Real-time data < 100ms           |
| **Query**    | WebSocket Summary Cache (2s TTL)      | Reduce 70% DB queries            |
| **Query**    | ClickHouse columnar storage (optional)| 10x+ speedup for wide time ranges|
| **Storage**  | SQLite WAL Mode                       | Concurrent read/write            |
| **Storage**  | ClickHouse SummingMergeTree           | Auto-dedup aggregation, less I/O |
| **Storage**  | Data Retention Policy (Auto-cleanup)  | Control storage growth           |

---

## Responsive Layout Strategy

```
Dashboard Layout (Tailwind CSS)
    │
    ├── Single Column (Default)
    │      grid-cols-1
    │      └─ TOP DOMAINS full width, show more data
    │
    ├── Two Columns (md: 768px+)
    │      md:grid-cols-2
    │      └─ Cards auto-arrange
    │
    └── Three Columns (xl: 1280px+)
           xl:grid-cols-3
           └─ Three columns side-by-side, narrow cards use vertical layout

Container Queries (@container)
    │
    ├── @min-[200px]: Narrow card vertical layout
    └── @min-[500px]: Wide card horizontal layout, show more data
```

---

## Project Directory Structure

```
neko-master/
├── apps/
│   ├── web/                          # Next.js Frontend
│   │   ├── app/                      # App Router
│   │   ├── components/
│   │   │   ├── features/             # Feature components
│   │   │   │   ├── backend/          # Backend config
│   │   │   │   ├── devices/          # Device stats
│   │   │   │   ├── domains/          # Domain stats
│   │   │   │   ├── proxies/          # Proxy stats
│   │   │   │   ├── rules/            # Rule stats
│   │   │   │   └── stats/            # Stats charts
│   │   │   ├── layout/               # Layout components
│   │   │   └── ui/                   # Base UI components
│   │   ├── hooks/api/                # API Hooks
│   │   ├── lib/                      # Utilities
│   │   └── messages/                 # i18n translations
│   │
│   └── collector/                    # Fastify Data Collection Service
│       ├── src/
│       │   ├── collectors/           # Collector implementations
│       │   │   ├── clash-collector.ts    # Clash WebSocket
│       │   │   └── surge-collector.ts    # Surge HTTP
│       │   ├── database/
│       │   │   └── repositories/     # Repository Pattern
│       │   │       ├── base.repository.ts     # Abstract base (13 shared utils)
│       │   │       ├── domain.repository.ts   # Domain stats
│       │   │       ├── ip.repository.ts       # IP stats + ASN/GeoIP
│       │   │       ├── rule.repository.ts     # Rule stats + ChainFlow
│       │   │       ├── proxy.repository.ts    # Proxy stats
│       │   │       ├── device.repository.ts   # Device stats
│       │   │       ├── country.repository.ts  # Country/region stats
│       │   │       ├── timeseries.repository.ts # Time-series data
│       │   │       ├── traffic-writer.repository.ts # Traffic writing
│       │   │       ├── config.repository.ts   # DB config/cleanup
│       │   │       ├── backend.repository.ts  # Backend management
│       │   │       ├── auth.repository.ts     # Auth config
│       │   │       ├── surge.repository.ts    # Surge policy cache
│       │   │       └── index.ts               # Barrel exports
│       │   ├── db.ts                 # Facade (~1000 lines, DDL + delegates)
│       │   ├── modules/              # Business modules
│       │   │   ├── auth/             # Authentication
│       │   │   ├── backend/          # Backend management
│       │   │   ├── clickhouse/       # ClickHouse module (optional)
│       │   │   │   ├── clickhouse.config.ts   # Config loader
│       │   │   │   ├── clickhouse.writer.ts   # Writer (dual-write + health tracking)
│       │   │   │   └── clickhouse.reader.ts   # Reader (POST-body SQL queries)
│       │   │   ├── collector/        # Collector core
│       │   │   │   └── batch-buffer.ts        # Batch buffer + dual-write dispatcher
│       │   │   ├── stats/            # Stats service (read routing)
│       │   │   │   ├── stats.service.ts       # Read routing (STATS_QUERY_SOURCE)
│       │   │   │   └── stats-write-mode.ts    # Write mode decision
│       │   │   ├── surge/            # Surge service
│       │   │   ├── realtime/         # Real-time data
│       │   │   └── websocket/        # WebSocket
│       │   ├── routes/               # API routes
│       │   ├── services/             # Base services
│       │   │   ├── geoip.ts          # GeoIP service
│       │   │   ├── policy-sync.ts    # Policy sync
│       │   │   └── realtime-store.ts # Real-time data store
│       │   └── index.ts              # Entry point
│       └── package.json
│
├── packages/
│   └── shared/                       # Shared type definitions
│
├── docs/
│   ├── architecture.md               # This doc (Chinese)
│   ├── architecture.en.md            # This doc (English)
│   └── agent/                        # Agent mode documentation
│       ├── overview.md               # Architecture and mode comparison
│       ├── quick-start.md            # End-to-end quick start
│       ├── install.md                # Install guide (systemd / launchd / OpenWrt)
│       ├── config.md                 # Configuration reference
│       ├── release.md                # Release and compatibility policy
│       └── troubleshooting.md        # Common errors and fixes
│
├── apps/
│   └── agent/                        # Agent daemon (Go)
│       ├── internal/agent/           # Core logic
│       │   └── runner.go             # Collection loop, report, heartbeat, config sync
│       ├── install.sh                # Agent one-click install script
│       └── nekoagent                 # CLI manager (shell script)
│
└── docker-compose.yml
```
