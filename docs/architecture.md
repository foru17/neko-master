# Neko Master 业务架构图

## 整体架构概览

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                       前端展示层 (Frontend)                                │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Next.js 16 (App Router)                                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │  Dashboard  │  │  Overview   │  │   Charts    │  │  Interactive Tables     │ │   │
│  │  │  (仪表板)    │  │  (概览)     │  │  (图表)     │  │  (交互式表格)            │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  React Query (TanStack)                                                 │   │   │
│  │  │  - API 数据获取与缓存                                                    │   │   │
│  │  │  - 乐观更新与状态管理                                                    │   │   │
│  │  │  - 自动重试与错误处理                                                    │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  useStatsWebSocket Hook                                                  │   │   │
│  │  │  - WebSocket 连接管理                                                    │   │   │
│  │  │  - 实时数据订阅                                                          │   │   │
│  │  │  - 自动重连与心跳                                                        │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           │ HTTP / WebSocket
                                           │ (Cookie 认证)
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                      服务层 (Collector)                                  │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         API Server (Fastify)                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  REST API Endpoints                                                      │   │   │
│  │  │  ├─ /api/backends        - 后端管理                                       │   │   │
│  │  │  ├─ /api/stats           - 统计数据                                       │   │   │
│  │  │  ├─ /api/auth            - 认证管理                                       │   │   │
│  │  │  ├─ /api/domains         - 域名统计                                       │   │   │
│  │  │  ├─ /api/ips             - IP 统计                                        │   │   │
│  │  │  ├─ /api/proxies         - 代理统计                                       │   │   │
│  │  │  ├─ /api/rules           - 规则统计                                       │   │   │
│  │  │  ├─ /api/devices         - 设备统计                                       │   │   │
│  │  │  ├─ /api/gateway/*       - 网关代理接口                                   │   │   │
│  │  │  └─ /api/retention       - 数据保留配置                                    │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                           │                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     WebSocket Server (ws)                                        │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  实时数据推送                                                            │   │   │
│  │  │  - 连接管理 (Client Connections)                                         │   │   │
│  │  │  - 订阅管理 (Range, Backend, PushInterval)                               │   │   │
│  │  │  - 广播推送 (Broadcast Stats)                                            │   │   │
│  │  │  - 摘要缓存 (Summary Cache, 2s TTL)                                       │   │   │
│  │  │  - 策略缓存同步 (Surge Policy Sync)                                       │   │   │
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
│  │  │       ↕ (实时)      │  │       ↕ (实时)      │  │       ↕ (2s 轮询)   │      │   │
│  │  │    Gateway WS       │  │    Gateway WS       │  │    HTTP API         │      │   │
│  │  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘      │   │
│  │                                                                                  │   │
│  │  功能：                                                                          │   │
│  │  - 连接池管理 (Reconnection)                                                     │   │
│  │  - 流量追踪 (Traffic Tracking)                                                   │   │
│  │  - 增量计算 (Delta Calculation)                                                  │   │
│  │  - 批量缓冲 (Batch Buffer, 30s flush)                                            │   │
│  │  - 策略缓存同步 (Policy Cache Sync, 10min)                                        │   │
│  │  - 指数退避重试 (Exponential Backoff)                                            │   │
│  │  - GeoIP 查询集成                                                                │   │
│  │  - 实时数据广播 (→ RealtimeStore)                                                │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     Policy Sync Service                                          │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  Surge 策略缓存同步 (背景任务)                                           │   │   │
│  │  │  - 定时同步: /v1/policies + /v1/policy_groups/select                     │   │   │
│  │  │  - 存储: surge_policy_cache 表                                           │   │   │
│  │  │  - 缓存过期: 10 分钟                                                     │   │   │
│  │  │  - 回退机制: 直接 API 获取                                               │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     RealtimeStore (内存实时数据)                                 │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  实时增量缓存 (按 backend 隔离)                                           │   │   │
│  │  │  - summaryByBackend:    总体流量增量                                      │   │   │
│  │  │  - minuteByBackend:     分钟级流量桶                                      │   │   │
│  │  │  - domainByBackend:     域名增量                                          │   │   │
│  │  │  - ipByBackend:         IP 增量                                           │   │   │
│  │  │  - proxyByBackend:      代理增量                                          │   │   │
│  │  │  - deviceByBackend:     设备增量                                          │   │   │
│  │  │  - ruleByBackend:       规则增量                                          │   │   │
│  │  │  - countryByBackend:    国家/地区增量                                     │   │   │
│  │  │                                                                             │   │   │
│  │  │  功能：merge* 方法合并数据库数据与实时增量                                   │   │   │
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
│  │  │  IP 地理位置查询                                                          │   │   │
│  │  │  - IP-API.com (默认)                                                     │   │   │
│  │  │  - IPInfo.io (备选)                                                      │   │   │
│  │  │  - 本地缓存 (LRU)                                                         │   │   │
│  │  │  - 批量查询优化                                                           │   │   │
│  │  │  - 失败冷却机制                                                           │   │   │
│  │  │  - IPv4/IPv6 双栈支持                                                     │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ├──→ SQLite (better-sqlite3) [始终写入]
                                           └──→ ClickHouse HTTP API [可选双写]
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                      数据存储层 (Storage)                                │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                     SQLite Database (WAL Mode)  [始终启用]                       │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  统计表 (按 backend_id 分区)                                              │   │   │
│  │  │                                                                             │   │   │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │   │
│  │  │  │  domain_stats  │ │   ip_stats     │ │  proxy_stats   │               │   │   │
│  │  │  │  (域名统计)    │ │  (IP 统计)     │ │  (代理统计)    │               │   │   │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘               │   │   │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │   │
│  │  │  │  rule_stats    │ │ country_stats  │ │  device_stats  │               │   │   │
│  │  │  │  (规则统计)    │ │  (国家统计)    │ │  (设备统计)    │               │   │   │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘               │   │   │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │   │
│  │  │  │minute_stats    │ │ hourly_stats   │ │  daily_stats   │               │   │   │
│  │  │  │(分钟级详细)   │ │ (小时级聚合)   │ │ (日级聚合)     │               │   │   │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘               │   │   │
│  │  │                                                                             │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  配置与缓存表                                                            │   │   │
│  │  │                                                                             │   │   │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │   │
│  │  │  │ backend_configs│ │   geoip_cache  │ │   asn_cache    │               │   │   │
│  │  │  │  (后端配置)    │ │  (GeoIP 缓存)  │ │  (ASN 缓存)    │               │   │   │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘               │   │   │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │   │
│  │  │  │  auth_config   │ │ retention_config│ │surge_policy_cache│             │   │   │
│  │  │  │  (认证配置)    │ │  (保留策略)    │ │(Surge策略缓存) │               │   │   │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘               │   │   │
│  │  └─────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │              ClickHouse Database [可选，CH_ENABLED=1 时启用]                     │   │
│  │                                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  Buffer 表（异步接收写入，约 5min 合并）                                  │   │   │
│  │  │                                                                             │   │   │
│  │  │  ┌───────────────────────┐  ┌───────────────────────┐                   │   │   │
│  │  │  │  traffic_detail_buffer│  │  traffic_agg_buffer   │                   │   │   │
│  │  │  │  (连接详情)           │  │  (聚合统计)           │                   │   │   │
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
│                                      数据源层 (Data Sources)                             │
│                                                                                          │
│  ┌─────────────────────────────────┐    ┌─────────────────────────────────────────────┐  │
│  │     Clash / Mihomo Gateway      │    │         Surge Gateway (v5+)               │  │
│  │                                 │    │                                             │  │
│  │  ┌─────────────────────────┐   │    │  ┌─────────────────────────────────────┐   │  │
│  │  │ /connections WebSocket  │   │    │  │ HTTP REST API Endpoints             │   │  │
│  │  │ (实时推送)              │   │    │  │                                     │   │  │
│  │  └─────────────────────────┘   │    │  │  ├─ GET /v1/requests/recent        │   │  │
│  │  ┌─────────────────────────┐   │    │  │  │   (最近连接，2s 轮询)              │   │  │
│  │  │ /traffic                │   │    │  │  ├─ GET /v1/policies               │   │  │
│  │  │ /rules                  │   │    │  │  │   (策略列表)                       │   │  │
│  │  │ /proxies                │   │    │  │  ├─ GET /v1/policy_groups/select   │   │  │
│  │  └─────────────────────────┘   │    │  │  │   (策略组详情)                     │   │  │
│  │                                 │    │  │                                     │   │  │
│  │  连接格式：                    │    │  │  开启方法：                         │   │  │
│  │  {                             │    │  │  http-api = 127.0.0.1:9091         │   │  │
│  │    "connections": [{           │    │  │                                     │   │  │
│  │    "id": "uuid",               │    │  └─────────────────────────────────────┘   │  │
│  │    "metadata": {               │    │                                             │  │
│  │      "host": "example.com",    │    │  注意：DNS 在代理服务器解析，               │  │
│  │      "destinationIP": "1.2.3", │    │  无法获取真实落地 IP                        │  │
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

## Agent 模式架构

Agent 模式允许一个中心化的 Neko Master 面板接收来自远程 LAN 网关的数据，无需 collector 直连网关。

### 组件说明

| 组件 | 说明 |
|---|---|
| `neko-agent` | 数据采集守护进程，运行于网关旁边，周期性拉取并上报到面板 |
| `nekoagent` | CLI 管理器（Shell 脚本），管理 `neko-agent` 实例的生命周期 |

### 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    中心面板 (Neko Master)                        │
│                                                                   │
│  Fastify API Server                                               │
│  ├─ POST /api/agent/report       ← 接收批量流量增量               │
│  ├─ POST /api/agent/heartbeat    ← 接收心跳（在线状态更新）        │
│  ├─ POST /api/agent/config-sync  ← 接收规则/代理/Provider 配置    │
│  └─ POST /api/agent/policy-state ← 接收当前策略状态               │
│                                                                   │
│  Backend 类型：agent://，系统生成 token，绑定 agentId             │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                     HTTP (token 鉴权)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                   网关旁边的主机 (Remote Host)                    │
│                                                                   │
│  nekoagent（CLI 管理器）                                          │
│  ├─ /etc/neko-agent/<instance>.env  (配置文件)                    │
│  └─ /var/run/neko-agent/<instance>.pid (PID 文件)                 │
│                                                                   │
│  neko-agent（守护进程）                                           │
│  │                                                                │
│  ├── 1. 拉取网关数据                                              │
│  │      ├─ Clash/Mihomo: WebSocket /connections (实时推送)        │
│  │      └─ Surge: HTTP GET /v1/requests/recent (2s 轮询)          │
│  │                                                                │
│  ├── 2. 增量计算 (Delta)                                          │
│  │      - 识别新连接 / 更新连接                                   │
│  │      - 计算 upload/download 增量                               │
│  │      - 聚合 domain + proxy + rule                              │
│  │                                                                │
│  ├── 3. 批量上报 (每 2s)                                          │
│  │      POST /api/agent/report                                    │
│  │      - 最多 1000 条/批，积压上限 50000 条                      │
│  │                                                                │
│  ├── 4. 心跳 (每 30s)                                             │
│  │      POST /api/agent/heartbeat                                 │
│  │                                                                │
│  ├── 5. 配置同步 (每 2min，MD5 去重)                              │
│  │      POST /api/agent/config-sync                               │
│  │      - rules / proxies / providers                             │
│  │                                                                │
│  └── 6. 策略状态同步 (每 30s，状态变化才上报)                     │
│         POST /api/agent/policy-state                              │
│                                                                   │
│  PID 锁：同一 backendId 同时只允许一个进程运行                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                    本地网络 (LAN)
                              │
            ┌─────────────────────────────┐
            │  Clash/Mihomo or Surge      │
            │  Gateway API                │
            └─────────────────────────────┘
```

### 直连模式 vs Agent 模式

| 维度 | 直连（Direct） | Agent |
|---|---|---|
| collector 是否需连接网关 | ✅ 是 | ❌ 否 |
| 数据实时性 | 毫秒级 (WS) | 约 2s 上报周期 |
| 网络隔离 | 需要 collector → 网关可达 | agent 发起连接，无需入站 |
| 多站点场景 | 复杂（需 VPN/内网穿透） | 原生支持，每站点独立 agent |
| 安全边界 | 需要共享网关 API token | 面板 token 与网关 token 隔离 |

### 安全模型

- 面板为每个 Agent backend 生成唯一 token
- `agentId` 由 backend token 派生：`"agent-" + sha256(token)[:16]`，重启后保持稳定，无需手动指定
- Token 与 `agentId` 绑定，同一 token 不能以不同 `agentId` 注册（跨实例复用被服务端拒绝）
- Token 轮换后旧进程的请求立即被拒绝（需重新配置新 token 再启动）
- 配置同步与策略同步均有 MD5 去重，减少无效 POST

---

## 数据流详解

### 1. Clash 数据采集流程

```
Clash Gateway
    │
    │ WebSocket 推送
    │ (每秒/每连接更新)
    ▼
ClashCollector
    │
    ├── 1. 流量追踪 (Traffic Tracking)
    │      - 识别新连接/更新连接
    │      - 计算增量 (delta = current - last)
    │      - 提取代理链 (chains)
    │
    ├── 2. 批量缓冲 (Batch Buffer)
    │      - 按 domain+ip+chain+rule 聚合
    │      - 30s 定时 flush 或 5000 条触发
    │
    ├── 3. GeoIP 查询
    │      - 异步查询 IP 地理位置
    │      - 批量缓存优化
    │
    ├── 4. 数据写入
    │      ├──→ SQLite (持久化，始终写入)
    │      ├──→ ClickHouse (可选双写，CH_WRITE_ENABLED=1 时)
    │      └──→ RealtimeStore (内存实时)
    │
    └── 5. 触发广播
           └──→ WebSocketServer.broadcastStats()
```

### 2. Surge 数据采集流程

```
Surge Gateway
    │
    │ HTTP 轮询 (2s 间隔)
    │ GET /v1/requests/recent
    ▼
SurgeCollector
    │
    ├── 1. 请求处理
    │      - 指数退避重试 (最多 5 次)
    │      - 错误处理和日志记录
    │
    ├── 2. 流量追踪 (Traffic Tracking)
    │      - 使用 recentlyCompleted Map 防重复
    │      - 计算增量 (delta = current - last)
    │      - 从 notes 提取策略路径
    │
    ├── 3. 策略缓存同步
    │      - 后台同步策略配置
    │      - 10 分钟定时更新
    │
    ├── 4. 批量缓冲
    │      - 与 Clash 相同的聚合逻辑
    │      - 30s 定时 flush
    │
    ├── 5. 数据写入
    │      ├──→ SQLite (持久化，始终写入)
    │      ├──→ ClickHouse (可选双写，CH_WRITE_ENABLED=1 时)
    │      └──→ RealtimeStore (内存实时)
    │
    └── 6. 触发广播
           └──→ WebSocketServer.broadcastStats()
```

### 3. 实时数据推送流程

```
WebSocketServer
    │
    ├── 客户端连接
    │      - Cookie 认证验证
    │      - 建立 ClientInfo (backend, range, interval)
    │
    ├── 数据准备
    │      - 从 SQLite 或 ClickHouse 查询基础数据（由 STATS_QUERY_SOURCE 决定）
    │      - RealtimeStore.merge*() 合并实时增量
    │      - 摘要缓存 (2s TTL)
    │
    └── 广播推送
           ├──→ 全量推送 (stats)
           ├──→ 趋势数据 (trend)
           ├──→ 域名分页 (domains)
           └──→ IP 分页 (ips)
```

### 4. 前端数据获取流程

```
React Component
    │
    ├── 方式 1: React Query (HTTP API)
    │      useTrafficTrend() ──→ api.getTrafficTrendAggregated()
    │                                      │
    │                                      ▼
    │                              Collector API
    │
    └── 方式 2: WebSocket Hook
           useStatsWebSocket() ──→ WebSocket 连接
                                          │
                                          ├── 订阅消息 (subscribe)
                                          ├── 接收推送 (stats/pong)
                                          └── 自动重连
```

---

## 关键设计模式

### Repository 模式 (Database Layer)

```
StatsDatabase (门面类, ~1000 行)
    │
    ├── init() / migrations        ── DDL 建表、迁移逻辑 (保留在 db.ts)
    ├── getSummary()               ── 跨表聚合查询 (保留在 db.ts)
    │
    └── this.repos                 ── Repository 实例组合
           ├── trafficWriter          ── 流量写入 (updateTrafficStats, batch)
           ├── domain                 ── 域名统计 (6 方法)
           ├── ip                     ── IP 统计 + ASN/GeoIP (17 方法)
           ├── rule                   ── 规则统计 + ChainFlow (10 方法)
           ├── proxy                  ── 代理统计 (3 方法)
           ├── device                 ── 设备统计 (3 方法)
           ├── country                ── 国家/地区 (3 方法)
           ├── timeseries             ── 时序数据 (5 方法)
           ├── config                 ── 数据库配置/清理 (12 方法)
           ├── backend                ── 后端管理 (11 方法)
           ├── auth                   ── 认证配置 (2 方法)
           └── surge                  ── Surge 策略缓存 (4 方法)

BaseRepository (抽象基类)
    │
    ├── parseMinuteRange()         ── 时间范围解析
    ├── splitChainParts()          ── 代理链解析
    ├── expandShortChainsForRules() ── 规则链展开
    ├── aggregateProxyStatsByFirstHop()
    ├── allocateByWeights()        ── 按权重分配
    └── ... 共 13 个共享工具方法
```

### 三写模式 (Triple Write)

```
Collector 收到流量数据
    │
    ├──→ SQLite (持久化存储，始终写入)
    │      └─ 配置 / 元数据 / 统计历史（CH 不可用时自动回退）
    │
    ├──→ ClickHouse (可选，CH_WRITE_ENABLED=1)
    │      └─ 流量统计双写 → Buffer 表 → SummingMergeTree 异步合并
    │      └─ 健康回退：连续失败 CH_UNHEALTHY_THRESHOLD 次后自动回退 SQLite
    │
    └──→ RealtimeStore (内存实时)
           └─ 用于实时展示、低延迟推送（补偿 Buffer 延迟）
```

**读取路由（STATS_QUERY_SOURCE）**

```
STATS_QUERY_SOURCE=sqlite     → 全部读 SQLite（默认）
STATS_QUERY_SOURCE=clickhouse → 全部读 ClickHouse
STATS_QUERY_SOURCE=auto       → 智能路由（近期走 CH，历史走 SQLite）
```

### 增量合并模式 (Delta Merge)

```
客户端请求 stats
    │
    ▼
数据库基础数据 (DB)
    │
    ├── 域名统计: 100MB
    ├── 代理统计: 50MB
    └── ...
    │
    ▼
RealtimeStore.merge*(DB数据, 内存增量)
    │
    └── 合并后数据 (DB + 实时增量)
           例如: 100MB + 5MB (最近30秒)
```

### 多后端隔离 (Multi-Backend Isolation)

```
所有数据结构按 backendId 隔离:

SQLite: PRIMARY KEY (backend_id, domain)
RealtimeStore: Map<backendId, Map<key, Data>>
WebSocket: ClientInfo.backendId

支持混合后端:
├── Backend #1: Clash (WebSocket 实时)
├── Backend #2: Clash (WebSocket 实时)
└── Backend #3: Surge (HTTP 轮询)
```

### 合并视图 (Merged View)

```
保留 ID MERGED_BACKEND_ID = -1 表示「所有 enabled + listening 的后端合并」
（真实 ID 来自 AUTOINCREMENT，恒为正，不会冲突）

HTTP  /api/stats/*?backendId=-1      ─┐
WebSocket  subscribe {backendId:-1}  ─┴─> MergedAwareStatsService (extends StatsService)
                                           │ 普通后端 ID：原样走父类实现，行为不变
                                           │ -1：对每个成员后端调用父类同名方法
                                           ▼
                                   stats.merge.ts（纯函数，不访问数据库）
                                     按 key 合并：流量计数求和、lastSeen 取最大、字符串列表取并集
                                     覆盖域名 / IP / 设备 / 代理 / 规则 / 国家 / 时序 / 规则链路图

去重计数（域名数、IP 数、分页 total）：
  backend_id IN (...) 的 COUNT，SQLite 与 ClickHouse 各一份，
  走范围缓存，任一后端 flush 时失效
```

广播：合并订阅者接收任一成员后端的流量推送；`clearBackendCache(backendId)` 同时清掉 `-1|…` 的缓存条目。

### 防重复计算模式 (Surge)

```
SurgeCollector
    │
    ├── recentlyCompleted Map
    │      key: requestId
    │      value: { finalUpload, finalDownload, completedAt }
    │      TTL: 5 分钟
    │
    └── 处理逻辑
           ├── 新连接 → 记录初始状态
           ├── 更新中 → 计算增量
           └── 已完成 → 检查 Map，防止重复计入
```

---

## ClickHouse 模块设计

### 写入器 (ClickHouseWriter)

```
ClickHouseWriter
    │
    ├── 健康状态追踪
    │      consecutiveFailures  ── 连续失败计数
    │      isHealthy()          ── 判断是否健康（< CH_UNHEALTHY_THRESHOLD）
    │
    ├── insertRows()
    │      ├── 正常写入 → HTTP POST → ClickHouse Buffer 表
    │      │      成功时: consecutiveFailures 清零，日志记录恢复
    │      └── 失败时: consecutiveFailures++
    │             达到阈值 → 标记不健康 + 告警日志
    │
    └── 写入积压保护
           pendingBatches ≥ CH_WRITE_MAX_PENDING_BATCHES → 丢弃新批次
```

### 读取器 (ClickHouseReader)

```
ClickHouseReader
    │
    ├── query(sql)
    │      HTTP POST body 传送 SQL（避免 URL 长度限制）
    │      → FORMAT JSON → 解析结果集
    │
    └── toDateTime(value)
           正常日期 → 格式化为 ClickHouse datetime 字符串
           无效日期 → 取当前时间（防止 epoch 导致全表扫描）
```

### 双写调度 (BatchBuffer)

```
BatchBuffer.flush()
    │
    ├── 1. 评估写入模式
    │      clickHouseWriter.isHealthy() → true
    │          → shouldSkipSqliteStatsWrites(true) → CH_ONLY_MODE=1 时跳过 SQLite 统计写入
    │      clickHouseWriter.isHealthy() → false
    │          → 强制写 SQLite（无论 CH_ONLY_MODE 如何）
    │
    ├── 2. SQLite 写入（按模式决定是否执行）
    │
    └── 3. ClickHouse 写入（CH_WRITE_ENABLED=1 时并行执行）
           写入失败 → 不影响 SQLite；错误由 Writer 内部追踪
```

### 读取路由 (StatsService)

```
STATS_QUERY_SOURCE 环境变量
    │
    ├── sqlite      → 全部走 SQLite Repository（默认）
    ├── clickhouse  → 全部走 ClickHouseReader
    └── auto        → shouldUseClickHouse()
                       ├── 时间范围有效 → ClickHouseReader
                       └── 时间范围无效 → SQLite（兜底）
```

---

## 认证流程 (Cookie-Based)

```
用户登录
    │
    ▼
POST /api/auth/login
    │
    ▼
服务端验证 → 设置 HttpOnly Cookie (auth-token)
    │
    ▼
后续请求自动携带 Cookie
    │
    ├──→ HTTP API 认证
    └──→ WebSocket 连接认证 (req.headers.cookie)
```

---

## 性能优化策略

| 层面     | 优化手段                       | 效果               |
| -------- | ------------------------------ | ------------------ |
| **采集** | 批量写入 (Batch Buffer)        | 减少 90% DB 写入   |
| **采集** | GeoIP 批量查询 + 缓存          | 减少 80% 外部请求  |
| **采集** | 策略缓存同步 (Policy Cache)    | 减少 95% API 调用  |
| **采集** | 指数退避重试                   | 提高连接稳定性     |
| **查询** | RealtimeStore 增量合并         | 实时数据 < 100ms   |
| **查询** | WebSocket 摘要缓存 (2s TTL)    | 减少 70% DB 查询   |
| **查询** | ClickHouse 列式存储（可选）    | 大时间窗口聚合提速 10x+ |
| **存储** | SQLite WAL Mode                | 并发读写优化       |
| **存储** | ClickHouse SummingMergeTree    | 自动去重聚合，节省存储 |
| **存储** | 数据保留策略 (自动清理)        | 控制存储增长       |

---

## 响应式布局策略

```
Dashboard 布局 (Tailwind CSS)
    │
    ├── 单列布局 (默认)
    │      grid-cols-1
    │      └─ TOP DOMAINS 撑满宽度，显示更多数据
    │
    ├── 双列布局 (md: 768px+)
    │      md:grid-cols-2
    │      └─ 卡片自适应排列
    │
    └── 三列布局 (xl: 1280px+)
           xl:grid-cols-3
           └─ 三列并排，窄卡片使用垂直布局

容器查询 (@container)
    │
    ├── @min-[200px]: 窄卡片垂直布局
    └── @min-[500px]: 宽卡片水平布局，显示更多数据
```

---

## 项目目录结构

```
neko-master/
├── apps/
│   ├── web/                          # Next.js 前端
│   │   ├── app/                      # App Router
│   │   ├── components/
│   │   │   ├── features/             # 功能组件
│   │   │   │   ├── backend/          # 后端配置
│   │   │   │   ├── devices/          # 设备统计
│   │   │   │   ├── domains/          # 域名统计
│   │   │   │   ├── proxies/          # 代理统计
│   │   │   │   ├── rules/            # 规则统计
│   │   │   │   └── stats/            # 统计图表
│   │   │   ├── layout/               # 布局组件
│   │   │   └── ui/                   # 基础 UI 组件
│   │   ├── hooks/api/                # API Hooks
│   │   ├── lib/                      # 工具库
│   │   └── messages/                 # i18n 翻译
│   │
│   └── collector/                    # Fastify 数据采集服务
│       ├── src/
│       │   ├── collectors/           # 采集器实现
│       │   │   ├── clash-collector.ts    # Clash WebSocket
│       │   │   └── surge-collector.ts    # Surge HTTP
│       │   ├── database/
│       │   │   └── repositories/     # Repository 模式
│       │   │       ├── base.repository.ts     # 抽象基类 (13 个共享工具)
│       │   │       ├── domain.repository.ts   # 域名统计
│       │   │       ├── ip.repository.ts       # IP 统计 + ASN/GeoIP
│       │   │       ├── rule.repository.ts     # 规则统计 + ChainFlow
│       │   │       ├── proxy.repository.ts    # 代理统计
│       │   │       ├── device.repository.ts   # 设备统计
│       │   │       ├── country.repository.ts  # 国家/地区统计
│       │   │       ├── timeseries.repository.ts # 时序数据
│       │   │       ├── traffic-writer.repository.ts # 流量写入
│       │   │       ├── config.repository.ts   # 数据库配置/清理
│       │   │       ├── backend.repository.ts  # 后端管理
│       │   │       ├── auth.repository.ts     # 认证配置
│       │   │       ├── surge.repository.ts    # Surge 策略缓存
│       │   │       └── index.ts               # 统一导出
│       │   ├── db.ts                 # 门面类 (~1000 行, DDL + 委托)
│       │   ├── modules/              # 业务模块
│       │   │   ├── auth/             # 认证
│       │   │   ├── backend/          # 后端管理
│       │   │   ├── clickhouse/       # ClickHouse 模块（可选）
│       │   │   │   ├── clickhouse.config.ts   # 配置加载
│       │   │   │   ├── clickhouse.writer.ts   # 写入器（双写 + 健康追踪）
│       │   │   │   └── clickhouse.reader.ts   # 读取器（POST 查询）
│       │   │   ├── collector/        # 采集核心
│       │   │   │   └── batch-buffer.ts        # 批量缓冲 + 双写调度
│       │   │   ├── stats/            # 统计服务（读取路由）
│       │   │   │   ├── stats.service.ts       # 读取路由（STATS_QUERY_SOURCE）
│       │   │   │   └── stats-write-mode.ts    # 写入模式决策
│       │   │   ├── surge/            # Surge 服务
│       │   │   ├── realtime/         # 实时数据
│       │   │   └── websocket/        # WebSocket
│       │   ├── routes/               # API 路由
│       │   ├── services/             # 基础服务
│       │   │   ├── geoip.ts          # GeoIP 服务
│       │   │   ├── policy-sync.ts    # 策略同步
│       │   │   └── realtime-store.ts # 实时数据存储
│       │   └── index.ts              # 入口
│       └── package.json
│
├── packages/
│   └── shared/                       # 共享类型定义
│
├── docs/
│   ├── architecture.md               # 本文档（中文）
│   ├── architecture.en.md            # 架构文档（英文）
│   └── agent/                        # Agent 模式文档
│       ├── overview.md               # 架构说明与模式对比
│       ├── quick-start.md            # 快速开始
│       ├── install.md                # 安装指南（含 systemd/launchd）
│       ├── config.md                 # 参数配置参考
│       ├── release.md                # 发布与兼容策略
│       └── troubleshooting.md        # 常见问题
│
├── apps/
│   └── agent/                        # Agent 守护进程（Go）
│       ├── internal/agent/           # 核心逻辑
│       │   └── runner.go             # 采集循环、上报、心跳、配置同步
│       ├── install.sh                # Agent 一键安装脚本
│       └── nekoagent                 # CLI 管理器（Shell 脚本）
│
└── docker-compose.yml
```
