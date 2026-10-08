<p align="center">
  <img src="./assets/icon-neko-master.png" width="200" alt="Neko Master Logo" style="margin-bottom: 16px;">
  <br>
  <b style="font-size: 32px;">Neko Master</b>
</p>

<p align="center">
  <b>See your network traffic clearly.</b><br>
  <span>Real-time monitoring · Traffic auditing · Multi-gateway support</span>
</p>

<p align="center">
  <b>English</b> | <a href="./README.zh.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/foru17/neko-master/stargazers"><img src="https://img.shields.io/github/stars/foru17/neko-master?style=flat-square&color=yellow" alt="Stars"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/pulls/foru17/neko-master?style=flat-square&color=blue&logo=docker" alt="Docker Pulls"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/v/foru17/neko-master?style=flat-square&label=Docker&color=2496ED" alt="Docker Version"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/image-size/foru17/neko-master/latest?style=flat-square&logo=docker" alt="Image Size"></a>
  <a href="https://github.com/foru17/neko-master/blob/main/LICENSE"><img src="https://img.shields.io/github/license/foru17/neko-master?style=flat-square&color=green" alt="License"></a>
  <img src="https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js">
  <a href="https://github.com/foru17/neko-master/actions/workflows/docker-build.yml"><img src="https://img.shields.io/github/actions/workflow/status/foru17/neko-master/docker-build.yml?style=flat-square&label=Docker%20CI" alt="Docker CI"></a>
  <a href="./docs/architecture.en.md"><img src="https://img.shields.io/badge/docs-architecture-0ea5e9?style=flat-square" alt="Architecture Docs"></a>
</p>

> [!IMPORTANT]
> **Disclaimer**
>
> This project is a traffic analysis and visualization tool
> for local gateway environments.
>
> It does not provide any network access service,
> proxy subscription, or cross-network connectivity.
> All data is collected from the user's own network environment.
>
> This project is open-sourced under the MIT License. We assume no responsibility for any consequences resulting from the use of this software. Please use it in compliance with applicable laws and regulations.

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./assets/neko-master-overview-light.png" alt="Neko Master Preview (Light 1)" />
    </td>
    <td align="center" width="50%">
      <img src="./assets/neko-master-regions-light.png" alt="Neko Master Preview (Light 2)" />
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./assets/neko-master-rules-dark.png" alt="Neko Master Preview (Dark 1)" />
    </td>
    <td align="center" width="50%">
      <img src="./assets/neko-master-domains-dark.png" alt="Neko Master Preview (Dark 2)" />
    </td>
  </tr>
</table>

## About the Name

**Neko** (ねこ) means _cat_ in Japanese.
Pronounced **/ˈneɪkoʊ/** (NEH-ko).

Like a cat, Neko Master observes network traffic quietly and precisely.
It is a lightweight analytics dashboard designed for modern gateway environments.

## 📋 Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [🤖 Agent Deployment](#-agent-deployment)
- [📖 First Use](#-first-use)
- [🔧 Port Conflict Resolution](#-port-conflict-resolution)
- [🐳 Docker Configuration](#-docker-configuration)
- [🗄️ ClickHouse (Optional)](#-clickhouse-optional)
- [🌐 Reverse Proxy & Tunnel](#-reverse-proxy--tunnel)
- [🔐 Authentication & Security](#-authentication--security)
- [❓ FAQ](#-faq)
- [🏗️ Architecture Guide](#-architecture-guide)
- [🤝 Feedback & Issues](#-feedback--issues)
- [📁 Project Structure](#-project-structure)
- [🛠️ Tech Stack](#-tech-stack)
- [📄 License](#-license)

## ✨ Features

| Feature                     | Description                                                   |
| --------------------------- | ------------------------------------------------------------- |
| 📊 **Real-time Monitoring** | WebSocket real-time collection with millisecond latency       |
| 📈 **Trend Analysis**       | Multi-dimensional traffic trends: 30min / 1h / 24h            |
| 🌐 **Domain Analysis**      | View traffic, associated IPs, and connection count per domain |
| 🗺️ **IP Analysis**          | ASN, geo-location, and associated domain display              |
| 🚀 **Proxy Statistics**     | Traffic distribution and connection count per proxy node      |
| 📱 **PWA Support**          | Install as desktop app for native experience                  |
| 🌙 **Dark Mode**            | Light / Dark / System theme support                           |
| 🌍 **i18n Support**         | English / Chinese seamless switching                          |
| 🔄 **Multi-Backend**        | Monitor multiple OpenClash backend instances simultaneously   |

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)

> The repository's built-in `docker-compose.yml` maps `3000/3001/3002` by default.
> Scenarios A/B below are minimal templates for common deployments.

#### Scenario A: Minimal deployment (only expose 3000)

```yaml
services:
  neko-master:
    image: foru17/neko-master:latest
    container_name: neko-master
    restart: unless-stopped
    ports:
      - "3000:3000" # Web UI
    volumes:
      - ./data:/app/data
      # Local MMDB (optional, files should be downloaded into ./geoip)
      - ./geoip:/app/data/geoip:ro
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/stats.db
      - COOKIE_SECRET=${COOKIE_SECRET}
```

> Recommended in `.env` (same directory as `docker-compose.yml`):
> `COOKIE_SECRET=<at least 32-byte random string>` (generate with `openssl rand -hex 32`)

> This mode is fully upgrade-compatible and works out of the box.
> If WS is not routed, the app falls back to HTTP polling automatically.

#### Scenario B: Real-time WebSocket (recommended with reverse proxy)

```yaml
services:
  neko-master:
    image: foru17/neko-master:latest
    container_name: neko-master
    restart: unless-stopped
    ports:
      - "3000:3000" # Web UI
      - "3002:3002" # WebSocket (for Nginx / Tunnel forwarding)
    volumes:
      - ./data:/app/data
      # Local MMDB (optional, files should be downloaded into ./geoip)
      - ./geoip:/app/data/geoip:ro
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/stats.db
      - COOKIE_SECRET=${COOKIE_SECRET}
```

Then run:

```bash
docker compose up -d
```

Open <http://localhost:3000> to get started.

If you use the repository's built-in Compose file (default `3000/3001/3002`), run the same command.

### Option 2: Docker Run

```bash
# Generate a fixed cookie secret first (for session persistence)
export COOKIE_SECRET="$(openssl rand -hex 32)"
```

```bash
# Minimal (only 3000)
docker run -d \
  --name neko-master \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e COOKIE_SECRET="$COOKIE_SECRET" \
  --restart unless-stopped \
  foru17/neko-master:latest

# Real-time WS (with reverse proxy)
docker run -d \
  --name neko-master \
  -p 3000:3000 \
  -p 3002:3002 \
  -v $(pwd)/data:/app/data \
  -e COOKIE_SECRET="$COOKIE_SECRET" \
  --restart unless-stopped \
  foru17/neko-master:latest
```

Open <http://localhost:3000> to get started.

> The frontend uses same-origin `/api` by default, so port 3001 is usually not required externally.
> For real-time WS, your reverse proxy/tunnel must be able to reach port `3002`. If not, the app falls back to ~5s HTTP polling.

> For `docker run`, change external ports using `-p` mappings directly.
> Only if you use direct WS access (no reverse proxy) and external WS port is not `3002`, also pass `-e WS_EXTERNAL_PORT=<external-ws-port>`.
>
> Local MMDB lookup mode (optional): mount `-v $(pwd)/geoip:/app/data/geoip:ro`,
> then switch source to Local in `Settings -> Preferences -> IP Lookup Source`.

### Option 3: One-Click Script

Automatically detects port conflicts and configures everything:

```bash
# Using curl
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash

# Or using wget
wget -qO- https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash
```

The script will automatically:

- ✅ Download `docker-compose.yml`
- ✅ Check if default ports (3000/3001/3002) are in use
- ✅ Suggest available alternative ports
- ✅ Create configuration file and start the service

### Option 4: Source Code

```bash
# 1. Clone the repository
git clone https://github.com/foru17/neko-master.git
cd neko-master

# 2. Install dependencies
pnpm install

# 3. Prepare collector env (source mode reads apps/collector/.env)
cp apps/collector/.env.example apps/collector/.env

# 4. Start development services
pnpm dev
```

Open <http://localhost:3000> to configure.

> In source mode: collector listens on `3001/3002`, web listens on `3000` by default.
> If you changed `API_PORT` (not 3001), set `API_URL` accordingly (for example `API_URL=http://localhost:4001`) so web `/api` rewrite targets the correct API.
> `apps/collector/.env.local` takes precedence over `apps/collector/.env`.

## 🤖 Agent Deployment

Use Agent mode when you want one centralized Neko Master service and multiple remote devices (OpenWrt, Linux, macOS) collecting local gateway data. The agent runs near the gateway, pulls data, and reports to the panel — the panel never connects to the gateway directly.

Supported gateway types: **Clash / Mihomo** (WebSocket real-time) and **Surge v5+** (HTTP polling).

### Quick Install (UI-generated command)

1. In the dashboard, go to `Settings → Backends`, add an `Agent` backend, select gateway type
2. Click **"View Agent Script"** and copy the one-line install command, then run it on the target host:

```bash
# Clash / Mihomo gateway example
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='1' \
        NEKO_BACKEND_TOKEN='ag_xxx' \
        NEKO_GATEWAY_TYPE='clash' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9090' \
        sh

# Surge gateway example
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='2' \
        NEKO_BACKEND_TOKEN='ag_yyy' \
        NEKO_GATEWAY_TYPE='surge' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9091' \
        sh
```

After install, manage instances with `nekoagent`:

```bash
nekoagent list               # list all instances
nekoagent status <instance>  # check running state
nekoagent logs <instance>    # tail live logs
nekoagent restart <instance> # restart
nekoagent upgrade            # global upgrade (CLI + binary)
```

> The script auto-detects an existing installation — if `neko-agent` is already present, it only adds the new instance without re-downloading.
> Multiple instances can run on the same host (different `NEKO_INSTANCE_NAME`), each pointing to a different gateway.

### Agent Documentation

- [Overview](./docs/agent/overview.en.md): architecture, Direct vs Agent comparison, security model
- [Quick Start](./docs/agent/quick-start.en.md): end-to-end setup from UI to running agent
- [Install Guide](./docs/agent/install.en.md): install methods, systemd / launchd autostart
- [Configuration](./docs/agent/config.en.md): full flag and env variable reference
- [Release Flow](./docs/agent/release.en.md): versioning and compatibility policy
- [Troubleshooting](./docs/agent/troubleshooting.en.md): common errors and fixes

## 📖 First Use

![First Use](./assets/neko-master-setup.png)

### Connect Clash / Mihomo

1. Open <http://localhost:3000>
2. The **Gateway Configuration** dialog will appear on first visit
3. Fill in your network gateway (e.g., OpenClash) connection info:
   - **Name**: Custom name (e.g., "Home Gateway")
   - **Type**: Select `Clash / Mihomo`
   - **Host**: Gateway backend address (e.g., `192.168.101.1`)
   - **Port**: Gateway backend port (e.g., `9090`)
   - **Token**: Fill if Secret is configured, otherwise leave empty
4. Click "Add Backend" to save
5. The system will automatically start collecting and analyzing traffic data

> 💡 **Get Gateway Address**: Go to your gateway control panel (e.g., OpenClash) → Enable "External Control" → Copy API address

### Connect Surge

![Surge HTTP API Configuration](./assets/neko-master-surge.png)

Neko Master supports connecting to Surge gateways for complete rule chain visualization and traffic analysis.

#### 1. Enable Surge HTTP API

Enable HTTP remote API in your Surge configuration:

```ini
[General]
http-api = 127.0.0.1:9091
http-api-tls = false
http-api-web-dashboard = true
```

Or configure via Surge's graphical interface:

- **HTTP Remote API**: `Settings` → `General` → `HTTP Remote API`
- **Port**: Default `9091`
- **Authentication**: Recommended to set a password for enhanced security

#### 2. Add Surge Backend in Neko Master

1. Open Neko Master settings dialog
2. Click "Add Backend"
3. Fill in the connection info:
   - **Name**: Custom name (e.g., "Surge Home")
   - **Type**: Select `Surge`
   - **Host**: IP address where Surge is running (e.g., `192.168.1.1` or `127.0.0.1`)
   - **Port**: HTTP API port (default `9091`)
   - **Token**: HTTP API password (if configured)
4. Click "Test Connection" to verify the configuration
5. Save the configuration

> 💡 **Note**: Surge uses HTTP polling to fetch data (compared to Clash's WebSocket real-time stream), with a data refresh delay of approximately 2 seconds.

## 🔧 Port Conflict Resolution

If you see "port already in use" error, here are the solutions:

### Solution 1: Use .env File

Create a `.env` file in the same directory as `docker-compose.yml`:

```env
WEB_EXTERNAL_PORT=8080    # Change Web UI port
API_EXTERNAL_PORT=8081    # Change API port
WS_EXTERNAL_PORT=8082     # Change WebSocket external port (only for direct access)
COOKIE_SECRET=your-long-random-secret   # Strongly recommended to keep fixed
```

Then restart:

```bash
docker compose down
docker compose up -d
```

Now access <http://localhost:8080>

### Solution 2: Directly Modify docker-compose.yml

```yaml
ports:
  - "8080:3000" # External 8080 → Internal 3000
  - "8082:3002" # External 8082 → Internal 3002 (for proxy/tunnel WS forwarding)
```

> Note: if you use direct WS access (no reverse proxy) and external WS port is not `3002`, set `WS_EXTERNAL_PORT=<external-ws-port>`.

### Solution 3: Use One-Click Script

```bash
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash
```

The script will automatically detect and suggest available ports.

## 🐳 Docker Configuration

### Ports

| Port |  Purpose  | External Required | Description                                                                                                 |
| :--: | :-------: | :---------------: | :---------------------------------------------------------------------------------------------------------- |
| 3000 |  Web UI   |        ✅         | Frontend entry point                                                                                        |
| 3001 |    API    |     Optional      | Frontend uses same-origin `/api` by default; usually no public exposure needed (default Compose maps it)  |
| 3002 | WebSocket |     Optional      | Real-time push endpoint; recommended for reverse proxy/tunnel forwarding only (default Compose maps it)    |

### Environment Variables (Deployment)

| Variable | Default | Purpose | When to set |
| :-- | :-- | :-- | :-- |
| `WEB_PORT` | `3000` | Web listen port (inside container) | Usually unchanged |
| `API_PORT` | `3001` | API listen port (inside container) | Usually unchanged |
| `COLLECTOR_WS_PORT` | `3002` | WS listen port (inside container) | Usually unchanged |
| `DB_PATH` | `/app/data/stats.db` | SQLite data path | Custom data path |
| `WEB_EXTERNAL_PORT` | `3000` | External web port mapping in `docker-compose.yml` | External web port changed |
| `API_EXTERNAL_PORT` | `3001` | External API port mapping in `docker-compose.yml` | Direct external API access needed |
| `WS_EXTERNAL_PORT` | `3002` | External WS port mapping in `docker-compose.yml`; also used for direct WS port inference | Direct WS access without proxy and external WS port changed |
| `NEXT_PUBLIC_API_URL` | empty | Override frontend API base URL (e.g. `https://api.example.com`) | API is not same-origin `/api` |
| `NEXT_PUBLIC_WS_URL` | empty | Override frontend WS URL (absolute URL or `/custom_ws`) | Custom WS path/domain |
| `NEXT_PUBLIC_WS_PORT` | `3002` | WS direct-connection fallback port (**build-time only — setting this at Docker runtime has no effect**; use `WS_EXTERNAL_PORT` instead) | Only for custom source builds |
| `API_URL` | `http://localhost:3001` | Next.js `/api` rewrite target (mainly source/custom builds) | API listen address changed |
| `COOKIE_SECRET` | auto-generated | Cookie signing secret; if not fixed, sessions can be invalidated after restart when data dir is not persisted | Strongly recommended in production |
| `BACKEND_TLS_INSECURE` | empty | Set to `1` to skip TLS certificate verification for gateway APIs only (Surge `http-api-tls`, mihomo `external-controller-tls` with self-signed certs). Logs a warning at startup | Gateway uses HTTPS with a self-signed / IP-mismatched certificate |
| `GEOIP_LOOKUP_PROVIDER` | `online` | IP geolocation source (`online` / `local`) | Default to local MMDB lookup |
| `GEOIP_ONLINE_API_URL` | `https://api.ipinfo.es/ipinfo` | Online IP geolocation API endpoint (must be compatible with `ipinfo.my` response schema) | Set only when you deploy a compatible endpoint |
| `FORCE_ACCESS_CONTROL_OFF` | `false` | Force disable access control (emergency recovery) | Temporary use only when token is lost |
| `SHOWCASE_SITE_MODE` | `false` | Read-only showcase mode (blocks sensitive write operations) | Public demo sites only |

### Advanced Tuning Variables (Optional)

| Variable | Default | Description |
| :-- | :-- | :-- |
| `AGENT_HEARTBEAT_TIMEOUT_MS` | `90000` | Collector-side agent heartbeat timeout for automatic health checks in milliseconds (minimum `15000`); defaults to 3 × the agent's 30s heartbeat interval to tolerate delayed reports |
| `FLUSH_INTERVAL_MS` | `30000` | Buffer flush interval for collector writes |
| `FLUSH_MAX_BUFFER_SIZE` | `5000` | Max buffer entries before early flush |
| `REALTIME_MAX_MINUTES` | `180` | Realtime in-memory window size (minutes) |
| `REALTIME_RANGE_END_TOLERANCE_MS` | `120000` | End-time tolerance for range queries |
| `SURGE_POLICY_SYNC_INTERVAL_MS` | `600000` | Surge policy sync interval |
| `DB_RANGE_QUERY_CACHE_TTL_MS` | `8000` | Range-query cache TTL |
| `DB_HISTORICAL_QUERY_CACHE_TTL_MS` | `300000` | Historical-query cache TTL |
| `DB_RANGE_QUERY_CACHE_MAX_ENTRIES` | `1024` | Max range-query cache entries |
| `DB_RANGE_QUERY_CACHE_DISABLED` | empty | Set `1` to disable range-query cache |
| `DEBUG_SURGE` | `false` | Enable Surge collector debug logs (`true`) |

### API / WS Resolution Priority

1. API client base: `runtime-config.API_URL` → `NEXT_PUBLIC_API_URL` → same-origin `/api`
2. `/api` server-side rewrite target: `API_URL` (default `http://localhost:3001`, applied in Next.js rewrites)
3. WS URL: `runtime-config.WS_URL` → `NEXT_PUBLIC_WS_URL` → auto candidates (when `runtime-config.WS_PORT` is set, direct port is preferred; otherwise `/_cm_ws` is tried first)
4. WS port: `runtime-config.WS_PORT` (from `WS_EXTERNAL_PORT`) → `NEXT_PUBLIC_WS_PORT` → `3002`
5. In normal deployments, `NEXT_PUBLIC_WS_URL` is usually unnecessary unless you use a custom WS path/domain

### Production Environment Baseline (Recommended)

```env
NODE_ENV=production
DB_PATH=/app/data/stats.db
COOKIE_SECRET=<at least 32-byte random string>
# Optional: default to local MMDB lookup
# GEOIP_LOOKUP_PROVIDER=local
# Keep false in normal operation
# FORCE_ACCESS_CONTROL_OFF=false
```

Use `openssl rand -hex 32` to generate `COOKIE_SECRET`.

Additional recommendations:

1. Mount persistent storage (for example `./data:/app/data`) to avoid data and secret loss.
2. If using direct WS access and external WS port is not `3002`, set `WS_EXTERNAL_PORT` accordingly.
3. If API port/address changes in source deployment, update `API_URL` as well.
4. For local MMDB lookup, mount `./geoip:/app/data/geoip:ro` and switch source in `Settings -> Preferences -> IP Lookup Source`.
5. MMDB files are large and are not bundled in the image. Download and place them in `./geoip` with fixed names:
   `GeoLite2-City.mmdb`, `GeoLite2-ASN.mmdb` (required), and `GeoLite2-Country.mmdb` (optional).
   Recommended source: <https://github.com/P3TERX/GeoLite.mmdb>.

> Advanced Agent details (install, config, release, compatibility) are maintained under `docs/agent/*`.

## 🗄️ ClickHouse (Optional)

SQLite is Neko Master's default storage engine and works well for most users.
Consider enabling ClickHouse if you need:

- Very large datasets (hundreds of thousands of domain/IP entries)
- Fast aggregation queries over long time ranges (≥ 7 days)
- Separation of historical stats from configuration/metadata storage

> ClickHouse is entirely optional. SQLite remains as the configuration and metadata store regardless of whether ClickHouse is enabled.

### Architecture Overview

When ClickHouse is enabled, the system enters **dual-write mode**:

```
BatchBuffer.flush()
    │
    ├──→ SQLite (config / metadata, always written)
    └──→ ClickHouse (stats traffic data, dual-write)
           └── Buffer tables → SummingMergeTree async merge
```

Read source is controlled by `STATS_QUERY_SOURCE` (default: `sqlite`).

### Enabling ClickHouse (Docker)

#### Step 1: Start the ClickHouse container

The repository's built-in `docker-compose.yml` already includes a ClickHouse service, gated by
`profiles: [clickhouse]` so it does not start by default. From the repository root, run:

```bash
docker compose --profile clickhouse up -d
```

> ClickHouse data is persisted to `./data/clickhouse`, separate from the main app data directory.

If you use a **custom `docker-compose.yml`** (such as Scenario A/B above), add the ClickHouse
service block manually:

```yaml
services:
  neko-master:
    # ... your existing config ...
    environment:
      # append to existing environment section:
      - CH_ENABLED=${CH_ENABLED:-0}
      - CH_HOST=${CH_HOST:-clickhouse}
      - CH_PORT=${CH_PORT:-8123}
      - CH_DATABASE=${CH_DATABASE:-neko_master}
      - CH_USER=${CH_USER:-neko}
      - CH_PASSWORD=${CH_PASSWORD:-neko_master}
      - CH_WRITE_ENABLED=${CH_WRITE_ENABLED:-0}
      - STATS_QUERY_SOURCE=${STATS_QUERY_SOURCE:-sqlite}
    networks:
      - neko-master-network

  clickhouse:
    image: clickhouse/clickhouse-server:24.8
    container_name: neko-master-clickhouse
    restart: unless-stopped
    profiles: ["clickhouse"]
    ports:
      - "${CH_EXTERNAL_HTTP_PORT:-8123}:8123"
      - "${CH_EXTERNAL_NATIVE_PORT:-9000}:9000"
    volumes:
      - ./data/clickhouse:/var/lib/clickhouse
    environment:
      - CLICKHOUSE_DB=${CH_DATABASE:-neko_master}
      - CLICKHOUSE_USER=${CH_USER:-neko}
      - CLICKHOUSE_PASSWORD=${CH_PASSWORD:-neko_master}
      - CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1
    networks:
      - neko-master-network
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:8123/ping || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  neko-master-network:
    driver: bridge
```

#### Step 2: Configure environment variables

Add to your `.env` (same directory as `docker-compose.yml`):

```env
# Enable ClickHouse connection
CH_ENABLED=1

# Enable dual-write
CH_WRITE_ENABLED=1

# Read source: sqlite (default) / auto (smart routing) / clickhouse (force)
STATS_QUERY_SOURCE=auto

# ClickHouse connection (defaults match docker-compose.yml, no change needed)
CH_HOST=clickhouse
CH_PORT=8123
CH_DATABASE=neko_master
CH_USER=neko
CH_PASSWORD=neko_master
```

Restart:

```bash
docker compose --profile clickhouse up -d
```

### ClickHouse Environment Variables

| Variable | Default | Description |
| :-- | :-- | :-- |
| `CH_ENABLED` | `0` | Enable ClickHouse connection (`1` to enable) |
| `CH_WRITE_ENABLED` | `0` | Enable dual-write (requires `CH_ENABLED=1`) |
| `CH_ONLY_MODE` | `0` | When CH is healthy, skip SQLite stats writes (CH-only mode) |
| `CH_HOST` | `clickhouse` | ClickHouse host address |
| `CH_PORT` | `8123` | ClickHouse HTTP port |
| `CH_DATABASE` | `neko_master` | Database name |
| `CH_USER` | `neko` | Username |
| `CH_PASSWORD` | `neko_master` | Password |
| `CH_SECURE` | `0` | Use HTTPS connection |
| `CH_REQUIRED` | `0` | Refuse to start if CH is unavailable |
| `CH_AUTO_CREATE_TABLES` | `1` | Auto-create tables on first start |
| `CH_WRITE_MAX_PENDING_BATCHES` | `200` | Max pending write batches |
| `CH_UNHEALTHY_THRESHOLD` | `5` | Consecutive failures before marking unhealthy (auto-fallback to SQLite) |
| `STATS_QUERY_SOURCE` | `sqlite` | Read source: `sqlite` / `auto` / `clickhouse` |
| `CH_COMPARE_ENABLED` | `0` | Enable SQLite ↔ ClickHouse consistency check |
| `CH_EXTERNAL_HTTP_PORT` | `8123` | ClickHouse HTTP external port (Compose mapping) |
| `CH_EXTERNAL_NATIVE_PORT` | `9000` | ClickHouse Native external port (Compose mapping) |

> **Health & Fallback**: After `CH_UNHEALTHY_THRESHOLD` consecutive write failures, the system automatically marks ClickHouse as unhealthy and resumes SQLite writes—even when `CH_ONLY_MODE=1`. Once ClickHouse recovers, it is re-marked healthy and logged.

### Migration Guide for Existing Users

> Upgrading from a SQLite-only version? **Your data is safe.**
> The SQLite file (`./data/stats.db`) is fully preserved. Here is the recommended gradual migration path:

#### Phase 1: Dual-write (observation period, recommended starting point)

```env
CH_ENABLED=1
CH_WRITE_ENABLED=1
STATS_QUERY_SOURCE=sqlite   # Keep reading from SQLite while CH accumulates data
```

Start and watch `[ClickHouse Writer]` logs to confirm successful writes.

#### Phase 2: Switch read source

```env
STATS_QUERY_SOURCE=auto        # Smart routing: recent data from CH, historical from SQLite
# or
STATS_QUERY_SOURCE=clickhouse  # Force all reads to ClickHouse
```

#### Phase 3 (optional): Migrate historical data

To move historical SQLite stats into ClickHouse:

```bash
# Standard migration (truncate CH then re-import, with consistency check)
./scripts/ch-migrate-docker.sh

# Append mode (keep existing CH data, incremental import)
./scripts/ch-migrate-docker.sh --append

# Specific time window
./scripts/ch-migrate-docker.sh --from 2026-02-01T00:00:00Z --to 2026-02-20T00:00:00Z
```

#### Phase 4 (optional): CH-only mode

Once ClickHouse is running stably, stop SQLite stats writes:

```env
CH_ONLY_MODE=1
```

> Even with `CH_ONLY_MODE=1`, if ClickHouse becomes unhealthy the system automatically falls back to SQLite writes—no data loss.

### Reverting to SQLite-only

You can always roll back completely:

```env
CH_ENABLED=0
CH_WRITE_ENABLED=0
CH_ONLY_MODE=0
STATS_QUERY_SOURCE=sqlite
```

Restart and everything returns to pure SQLite mode. Historical data remains intact.

---

## 🌐 Reverse Proxy & Tunnel

Recommended approach: keep Web and WS under the same domain, with path routing:
`/` → `3000`, `/_cm_ws` → `3002`.

### Nginx Standard Example

```nginx
server {
  listen 443 ssl http2;
  server_name neko.example.com;

  location / {
    proxy_pass http://<neko-master-host>:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location ^~ /_cm_ws {
    proxy_pass http://<neko-master-host>:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    proxy_buffering off;
  }
}
```

Optional env override:

```env
# Not required by default (already /_cm_ws)
# NEXT_PUBLIC_WS_URL=/custom_ws
```

### Cloudflare Tunnel Standard Example

`~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-name-or-id>
credentials-file: /path/to/<credentials>.json

ingress:
  - hostname: neko.example.com
    path: /_cm_ws*
    service: http://localhost:3002
  - hostname: neko.example.com
    path: /*
    service: http://localhost:3000
  - service: http_status:404
```

Run:

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run <your-tunnel-name-or-id>
```

For Zero Trust dashboard-managed routes (token mode), configure the same two routes and keep `/_cm_ws*` above `/*`.

### Key Notes

1. Do not use `ws` (without leading slash) as WS path; it can overmatch and cause `/_next/static/...` → `426 Upgrade Required`
2. WS route must be above catch-all `/*`
3. `NEXT_PUBLIC_WS_URL` is optional by default; if customized, restart frontend/container after changes
4. Mapping only `3000` still works, but falls back to HTTP polling (~5s), with less real-time responsiveness
5. `beacon.min.js` failures (Cloudflare analytics script) are typically unrelated to app API/WS data flow
6. No extra `/api` reverse-proxy rule is required in most setups; frontend uses same-origin `/api` and app handles internal forwarding to `3001`

> Note: `/_next/static/... 426 Upgrade Required` is common in **misconfigured reverse proxy / tunnel** setups; it is uncommon in direct local access without a proxy.

### Multi-Architecture Support

Docker images support both `linux/amd64` and `linux/arm64`.

### Data Persistence

Data is stored in `/app/data` inside the container. Mount it to host to prevent data loss:

```yaml
volumes:
  - ./data:/app/data
```

### Update to Latest

```bash
# Pull the latest image and restart
docker compose pull
docker compose up -d
```

## 🔐 Authentication & Security

Neko Master supports access authentication to protect dashboard data.

### Production Security Baseline

1. Set a fixed `COOKIE_SECRET` (otherwise sessions may be invalidated after restart).
2. Do not keep `FORCE_ACCESS_CONTROL_OFF=true` enabled in normal operation.
3. Use `SHOWCASE_SITE_MODE=true` only for public demo environments (write operations are restricted).

Example:

```env
COOKIE_SECRET=<at least 32-byte random string>
# FORCE_ACCESS_CONTROL_OFF=false
# SHOWCASE_SITE_MODE=false
```

### Enable / Disable Authentication

1. Open dashboard and click "Settings" in the lower-left sidebar.
2. Go to the "Security" tab.
3. Enable/disable access control and set your token.

### Forgot Token (Emergency Reset)

If you forgot the token, temporarily set `FORCE_ACCESS_CONTROL_OFF=true` to enter emergency mode.

#### Docker Compose

1. Add to `docker-compose.yml`:

   ```yaml
   environment:
     - FORCE_ACCESS_CONTROL_OFF=true
   ```

2. Restart:

   ```bash
   docker compose up -d
   ```

3. Open dashboard and reset token in "Settings -> Security".
4. Remove this env var immediately after reset, then restart again.

#### Docker CLI

1. Stop and remove container:

   ```bash
   docker stop neko-master
   docker rm neko-master
   ```

2. Re-run with emergency flag:

   ```bash
   docker run -d \
     --name neko-master \
     -p 3000:3000 \
     -v $(pwd)/data:/app/data \
     -e FORCE_ACCESS_CONTROL_OFF=true \
     foru17/neko-master:latest
   ```

3. Reset token, then remove this flag and restart normally.


## ❓ FAQ

### Q: Can I run normally with only `3000:3000` exposed?

**A:** Yes. Core features still work.
If WS is not routed, the app automatically falls back to HTTP polling.
For full realtime experience, route `/_cm_ws` to `3002`.

### Q: Port conflict or inaccessible after port changes?

**A:** Create/update `.env` (same directory as `docker-compose.yml`):

```env
WEB_EXTERNAL_PORT=8080
API_EXTERNAL_PORT=8081
WS_EXTERNAL_PORT=8082
```

Then restart:

```bash
docker compose down
docker compose up -d
```

### Q: Why does login/session disappear after restart?

**A:** Usually because `COOKIE_SECRET` is not fixed or data directory is not persisted.

1. Set a fixed `COOKIE_SECRET`
2. Mount `./data:/app/data`

### Q: Which files are required for local MMDB lookup?

**A:** Create `./geoip` in your project directory (same level as `docker-compose.yml` is recommended), then place:

1. `GeoLite2-City.mmdb` (required)
2. `GeoLite2-ASN.mmdb` (required)
3. `GeoLite2-Country.mmdb` (optional)

Recommended source: <https://github.com/P3TERX/GeoLite.mmdb>.
Inside the container, the fixed lookup path is `/app/data/geoip`, so keep:
`./geoip:/app/data/geoip:ro`. To update later, just replace files in host `./geoip`.

### Q: Failed to connect OpenClash / gateway?

**A:** Check:

1. External control is enabled on gateway side
2. Host/port is correct
3. Token/Secret is correct (if configured)
4. Container network can reach gateway

### Q: How to backup and restore data?

**A:** Backup first:

```bash
cp -r ./data ./data-backup-$(date +%Y%m%d)
```

Restore:

```bash
docker compose down
cp -r ./data-backup-YYYYMMDD/. ./data/
docker compose up -d
```

## 🏗️ Architecture Guide

If you want to quickly understand the system design depth, read in this order:

1. **System Architecture Diagram**: end-to-end layering and module responsibilities → [docs/architecture.en.md](./docs/architecture.en.md)
2. **Data Flow**: Clash / Surge collection pipelines and aggregation
3. **Data Model & Storage**: SQLite schema, ClickHouse Buffer tables, retention policy
4. **Realtime Channel Design**: `RealtimeStore` merge strategy and WS push
5. **ClickHouse Module**: dual-write architecture, health fallback, read routing

Full documentation index: [docs/README.md](./docs/README.md)

> This documentation covers the core design of collection, aggregation, caching, realtime push, and multi-backend management.

## 🤝 Feedback & Issues

This project uses GitHub Issue Templates (Bug / Feature / Support).

Please include at least:

1. Deployment method (Compose / Docker Run / Source)
2. Version info (image tag or commit)
3. Key env vars (masked, e.g. `COOKIE_SECRET=***`)
4. Reproduction steps and expected vs actual behavior
5. Key logs (`docker logs`, browser console, network errors)

## 📁 Project Structure

```
neko-master/
├── docker-compose.yml      # Docker Compose config
├── Dockerfile              # Docker image build
├── setup.sh                # One-click setup script
├── docker-start.sh         # Docker container startup script
├── start.sh                # Source code dev startup script
├── docs/                   # Documentation (see docs/README.md)
│   ├── README.md           # Documentation index (English default)
│   ├── README.zh.md        # Documentation index (Chinese)
│   ├── README.en.md        # Documentation index (English mirror)
│   ├── architecture.md     # System architecture (Chinese)
│   ├── architecture.en.md  # System architecture (English)
│   ├── release-checklist.md
│   ├── agent/              # Agent docs (bilingual)
│   │   ├── overview.md / overview.en.md
│   │   ├── quick-start.md / quick-start.en.md
│   │   ├── install.md / install.en.md
│   │   ├── config.md / config.en.md
│   │   ├── release.md / release.en.md
│   │   └── troubleshooting.md / troubleshooting.en.md
│   ├── research/           # Research reports
│   └── dev/                # Internal development docs
├── assets/                 # Screenshots and icons
├── apps/
│   ├── collector/          # Data collection service (Node.js + WebSocket)
│   ├── agent/              # Agent daemon (Go)
│   └── web/                # Next.js frontend app
└── packages/
    └── shared/             # Shared types and utilities
```

## 🛠️ Tech Stack

- **Frontend**: [Next.js 16](https://nextjs.org/) + [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **Charts**: [Recharts](https://recharts.org/)
- **i18n**: [next-intl](https://next-intl-docs.vercel.app/)
- **Backend**: [Node.js](https://nodejs.org/) + [Fastify](https://www.fastify.io/) + WebSocket
- **Database**: [SQLite](https://www.sqlite.org/) ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) + [ClickHouse](https://clickhouse.com/) (optional)
- **Build**: [pnpm](https://pnpm.io/) + [Turborepo](https://turbo.build/)

## 🤝 Contributing

Contributions are welcome!

- 🐛 [Submit Bug](https://github.com/foru17/neko-master/issues/new)
- 💡 [Request Feature](https://github.com/foru17/neko-master/issues/new)
- 🔧 [Contribute Code](https://github.com/foru17/neko-master/pulls)

Before opening a PR, read [CONTRIBUTING.md](./CONTRIBUTING.md) (workflow, checks, i18n/dark-mode requirements).

**Developing with an AI coding tool?** (Claude Code, Copilot, Cursor, Codex, ...) Point it at [AGENTS.md](./AGENTS.md) — conventions, key contracts, and the project map — plus the task-specific workflow guides in [`.claude/skills/`](./.claude/skills/). Claude Code picks both up automatically.

## 📄 License

[MIT](LICENSE) © [foru17](https://github.com/foru17)

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=foru17/neko-master&type=date&legend=top-left)](https://www.star-history.com/#foru17/neko-master&type=date&legend=top-left)

---

<p align="center">
  <sub>Made with ❤️ by <a href="https://github.com/foru17">@foru17</a></sub><br>
  <sub>If this project helps you, please consider giving it a ⭐</sub>
</p>
