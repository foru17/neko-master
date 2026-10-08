<p align="center">
  <img src="./assets/icon-neko-master.png" width="200" alt="Neko Master Logo" style="margin-bottom: 16px;">
  <br>
  <b style="font-size: 32px;">Neko Master</b>
</p>

<p align="center">
  <b>让你的网络流量一目了然。</b><br>
  <span>实时监控 · 流量审计 · 多网关管理</span>
</p>

<p align="center">
  <b>中文</b> | <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/foru17/neko-master/stargazers"><img src="https://img.shields.io/github/stars/foru17/neko-master?style=flat-square&color=yellow" alt="Stars"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/pulls/foru17/neko-master?style=flat-square&color=blue&logo=docker" alt="Docker Pulls"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/v/foru17/neko-master?style=flat-square&label=Docker&color=2496ED" alt="Docker Version"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/image-size/foru17/neko-master/latest?style=flat-square&logo=docker" alt="Image Size"></a>
  <a href="https://github.com/foru17/neko-master/blob/main/LICENSE"><img src="https://img.shields.io/github/license/foru17/neko-master?style=flat-square&color=green" alt="License"></a>
  <img src="https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js">
  <a href="https://github.com/foru17/neko-master/actions/workflows/docker-build.yml"><img src="https://img.shields.io/github/actions/workflow/status/foru17/neko-master/docker-build.yml?style=flat-square&label=Docker%20CI" alt="Docker CI"></a>
  <a href="./docs/architecture.md"><img src="https://img.shields.io/badge/docs-architecture-0ea5e9?style=flat-square" alt="Architecture Docs"></a>
</p>

> [!IMPORTANT]
> **免责声明**
>
> 本项目为 **网络流量分析与可视化工具**，
> 用于展示与统计本地网关的流量数据。
>
> 本项目 **不提供任何网络接入服务、代理订阅或跨网络连接功能**。
> 所有数据均来源于用户自有网络环境。
>
> 本项目遵循 MIT 协议开源，不对因使用本软件产生的任何后果承担责任。请在合规范围内使用。

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

## 🌐 在线演示

**演示地址**: https://neko-master.is26.com  
**访问密码**: `neko2026`

> 演示站为只读展示模式，部分功能受限。

## 关于名称

**Neko**（ねこ）在日语中意为“猫”，
发音为 **/ˈneɪkoʊ/**（NEH-ko）。

如同猫一般安静而敏锐，
Neko Master 专注于对网络流量进行轻量、精确的分析与可视化。

## 📋 目录

- [🚀 快速开始](#-快速开始)
- [🤖 Agent 部署](#-agent-部署)
- [📖 首次使用](#-首次使用)
- [🔧 端口冲突解决](#-端口冲突解决)
- [🐳 Docker 配置](#-docker-配置)
- [🗄️ ClickHouse（可选）](#-clickhouse-可选)
- [🌐 反向代理与 Tunnel](#-反向代理与-tunnel)
- [🔐 认证与安全](#-认证与安全)
- [❓ 常见问题](#-常见问题)
- [🏗️ 架构文档指引](#-架构文档指引)
- [🤝 反馈与 Issue](#-反馈与-issue)
- [📁 项目结构](#-项目结构)
- [🛠️ 技术栈](#-技术栈)
- [📝 更新日志](./CHANGELOG.md)
- [📄 许可证](#-许可证)

## 🚀 快速开始

### 方式一：Docker Compose（推荐）

> 仓库内置的 `docker-compose.yml` 默认映射 `3000/3001/3002`。  
> 下方场景 A/B 是更精简的常见部署模板，可按需选择。

#### 场景 A：最简部署（仅暴露 3000）

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
      # 本地 MMDB（可选，文件需自行下载并放到 ./geoip）
      - ./geoip:/app/data/geoip:ro
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/stats.db
      - COOKIE_SECRET=${COOKIE_SECRET}
```

> 建议在 `docker-compose.yml` 同目录的 `.env` 中配置：  
> `COOKIE_SECRET=<至少32字节随机字符串>`（可用 `openssl rand -hex 32` 生成）

> 该模式完全兼容升级，页面可用。  
> 未打通 WS 时会自动回退到 HTTP 轮询刷新。

#### 场景 B：实时 WebSocket（推荐，配合反向代理）

```yaml
services:
  neko-master:
    image: foru17/neko-master:latest
    container_name: neko-master
    restart: unless-stopped
    ports:
      - "3000:3000" # Web UI
      - "3002:3002" # WebSocket（供 Nginx / Tunnel 转发）
    volumes:
      - ./data:/app/data
      # 本地 MMDB（可选，文件需自行下载并放到 ./geoip）
      - ./geoip:/app/data/geoip:ro
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/stats.db
      - COOKIE_SECRET=${COOKIE_SECRET}
```

启动服务：

```bash
docker compose up -d
```

访问 <http://localhost:3000>

若你直接使用仓库内置 Compose 文件（默认暴露 `3000/3001/3002`），执行同一命令即可。

### 方式二：Docker 直接运行

```bash
# 建议先生成固定 Cookie 密钥（用于会话持久）
export COOKIE_SECRET="$(openssl rand -hex 32)"
```

```bash
# 最简（仅 3000）
docker run -d \
  --name neko-master \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e COOKIE_SECRET="$COOKIE_SECRET" \
  --restart unless-stopped \
  foru17/neko-master:latest

# 实时 WS（配合反代）
docker run -d \
  --name neko-master \
  -p 3000:3000 \
  -p 3002:3002 \
  -v $(pwd)/data:/app/data \
  -e COOKIE_SECRET="$COOKIE_SECRET" \
  --restart unless-stopped \
  foru17/neko-master:latest
```

> 默认前端 API 走同域 `/api`，通常不需要额外暴露 3001。  
> 若希望 WebSocket 实时生效，需要让反代层可以访问 `3002`；未打通时会回退到 HTTP 轮询（约 5 秒级）。

访问 <http://localhost:3000>

> `docker run` 修改外部端口时，直接改 `-p` 映射即可。  
> 仅在“非反代直连 WS 且外部 WS 端口不是 3002”时，额外传入 `-e WS_EXTERNAL_PORT=<外部WS端口>`。
>
> 本地 MMDB 查询模式（可选）：额外挂载 `-v $(pwd)/geoip:/app/data/geoip:ro`，
> 并在面板「设置 -> 偏好设置 -> IP 查询来源」切换到本地。

### 方式三：一键脚本

自动检测端口冲突并配置，适合不熟悉 Docker 的用户：

```bash
# 使用 curl
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash

# 或使用 wget
wget -qO- https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash
```

脚本会自动：

- ✅ 下载 `docker-compose.yml`
- ✅ 检测默认端口（3000/3001/3002）是否被占用
- ✅ 提供可用的替代端口
- ✅ 创建配置文件并启动服务

### 方式四：源码运行

```bash
# 1. 克隆仓库
git clone https://github.com/foru17/neko-master.git
cd neko-master

# 2. 安装依赖
pnpm install

# 3. 准备 collector 环境变量（源码模式读取 apps/collector/.env）
cp apps/collector/.env.example apps/collector/.env

# 4. 启动开发服务
pnpm dev
```

访问 <http://localhost:3000>

> 源码模式下：`collector` 默认监听 `3001/3002`，`web` 默认监听 `3000`。  
> 如果你修改了 `API_PORT`（非 3001），请同步设置 `API_URL`（例如 `API_URL=http://localhost:4001`）供 web 的 `/api` 转发使用。  
> `apps/collector/.env.local` 的优先级高于 `apps/collector/.env`。

## 🤖 Agent 部署

当你希望中心化部署一个 Neko Master 服务，并在不同设备（OpenWrt、Linux、macOS）本地采集网关数据时，推荐使用 Agent 模式。Agent 运行在网关旁边，主动拉取数据并上报至面板，面板无需主动连接网关。

支持网关类型：**Clash / Mihomo**（WebSocket 实时）和 **Surge v5+**（HTTP 轮询）。

### 快速安装（UI 生成命令）

1. 在面板「设置 → 后端」中添加一个 `Agent` 类型后端，选择网关类型（Clash 或 Surge）
2. 点击「查看安装脚本」，复制一键安装命令，在目标主机上执行：

```bash
# Clash / Mihomo 网关示例
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='1' \
        NEKO_BACKEND_TOKEN='ag_xxx' \
        NEKO_GATEWAY_TYPE='clash' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9090' \
        sh

# Surge 网关示例
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='2' \
        NEKO_BACKEND_TOKEN='ag_yyy' \
        NEKO_GATEWAY_TYPE='surge' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9091' \
        sh
```

安装完成后，使用 `nekoagent` 管理实例：

```bash
nekoagent list               # 列出所有实例
nekoagent status <instance>  # 查看运行状态
nekoagent logs <instance>    # 实时日志
nekoagent restart <instance> # 重启
nekoagent upgrade            # 全局升级（CLI + 二进制）
```

> 脚本会自动检测已有安装，若已存在则只添加新实例而不重新下载二进制。
> 同一主机可同时运行多个实例（不同 `NEKO_INSTANCE_NAME`），对应不同网关。

### Agent 文档

- [总览](./docs/agent/overview.md)：架构说明、直连 vs Agent 对比、安全模型
- [快速开始](./docs/agent/quick-start.md)：从 UI 到运行的完整步骤
- [安装指南](./docs/agent/install.md)：安装方式、systemd / launchd / OpenWrt 开机自启
- [参数配置](./docs/agent/config.md)：完整参数列表与示例
- [发布流程](./docs/agent/release.md)：版本命名与兼容性策略
- [常见问题](./docs/agent/troubleshooting.md)：常见错误与解决方法

## 📖 首次使用

![首次使用](./assets/neko-master-setup.png)

### 接入 Clash / Mihomo

1. 打开 <http://localhost:3000>
2. 首次访问会弹出**网关配置**对话框
3. 填写网络网关（如 OpenClash）连接信息：
   - **名称**: 自定义名称（如 "Home Gateway"）
   - **类型**: 选择 `Clash / Mihomo`
   - **地址**: 网关后端地址（如 `192.168.101.1`）
   - **端口**: 网关后端端口（如 `9090`）
   - **Token**: 如果配置了 Secret 则填写，否则留空
4. 点击「添加后端」保存配置
5. 系统将自动开始采集并分析流量数据

> 💡 **获取网关地址**: 进入网关控制面板（如 OpenClash） → 打开「外部控制」→ 复制 API 地址

### 接入 Surge

![Surge HTTP API 配置](./assets/neko-master-surge.png)

Neko Master 支持接入 Surge 网关，实现完整的规则链可视化和流量分析。

#### 1. 开启 Surge HTTP API

在 Surge 配置中启用 HTTP 远程 API：

```ini
[General]
http-api = 127.0.0.1:9091
http-api-tls = false
http-api-web-dashboard = true
```

或者通过 Surge 的图形界面配置：
- **HTTP 远程 API**: `设置` → `常规` → `HTTP 远程 API`
- **端口**: 默认 `9091`
- **认证**: 建议设置密码增强安全性

#### 2. 在 Neko Master 中添加 Surge 后端

1. 打开 Neko Master 设置对话框
2. 点击「添加后端」
3. 填写连接信息：
   - **名称**: 自定义名称（如 "Surge Home"）
   - **类型**: 选择 `Surge`
   - **地址**: Surge 运行的 IP 地址（如 `192.168.1.1` 或 `127.0.0.1`）
   - **端口**: HTTP API 端口（默认 `9091`）
   - **Token**: HTTP API 密码（如果设置了的话）
4. 点击「测试连接」确认配置正确
5. 保存配置

> 💡 **注意**: Surge 使用 HTTP 轮询方式获取数据（相比 Clash 的 WebSocket 实时流），数据刷新延迟约 2 秒。

## 🔧 端口冲突解决

如果看到错误提示端口已被占用，有以下几种解决方案：

### 方案 1：使用 .env 文件

创建 `.env` 文件（与 `docker-compose.yml` 同目录）：

```env
WEB_EXTERNAL_PORT=8080    # 修改 Web UI 端口
API_EXTERNAL_PORT=8081    # 修改 API 端口
WS_EXTERNAL_PORT=8082     # 修改 WebSocket 外部端口（仅直连时需要）
COOKIE_SECRET=your-long-random-secret   # 强烈建议固定
```

然后重启：

```bash
docker compose down
docker compose up -d
```

现在访问 <http://localhost:8080>

### 方案 2：直接修改 docker-compose.yml

```yaml
ports:
  - "8080:3000" # 外部 8080 → 内部 3000
  - "8082:3002" # 外部 8082 → 内部 3002（给反代/Tunnel 转发 WS）
```

> 说明：如果你不走反代、直接让浏览器连 `ws://host:端口`，且外部 WS 端口不是 `3002`，请同时设置 `WS_EXTERNAL_PORT=<外部端口>`。

### 方案 3：使用一键脚本

```bash
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash
```

脚本会自动检测并提供可用的端口。

## 🐳 Docker 配置

### 端口说明

| 端口 |   用途    | 外部必需 | 说明                                             |
| :--: | :-------: | :------: | :----------------------------------------------- |
| 3000 | Web 界面  |    ✅    | 前端访问入口                                     |
| 3001 | API 接口  |   可选   | 前端默认同域 `/api`，一般无需公网暴露（仓库默认 Compose 会映射） |
| 3002 | WebSocket |   可选   | 实时推送端口，建议仅给反代层转发，不直接公网暴露（仓库默认 Compose 会映射） |

### 环境变量说明（部署）

| 变量名 | 默认值 | 作用 | 何时设置 |
| :-- | :-- | :-- | :-- |
| `WEB_PORT` | `3000` | Web 服务监听端口（容器内） | 一般不改 |
| `API_PORT` | `3001` | API 服务监听端口（容器内） | 一般不改 |
| `COLLECTOR_WS_PORT` | `3002` | WS 服务监听端口（容器内） | 一般不改 |
| `DB_PATH` | `/app/data/stats.db` | SQLite 文件路径 | 自定义数据目录时 |
| `WEB_EXTERNAL_PORT` | `3000` | `docker-compose.yml` 的 Web 外部端口映射 | 外部 Web 端口变更时 |
| `API_EXTERNAL_PORT` | `3001` | `docker-compose.yml` 的 API 外部端口映射 | 需要外部直连 API 时 |
| `WS_EXTERNAL_PORT` | `3002` | `docker-compose.yml` 的 WS 外部端口映射；同时用于前端直连 WS 端口推断 | 非反代直连 WS 且外部端口变化时 |
| `NEXT_PUBLIC_API_URL` | 空 | 覆盖前端 API 基地址（如 `https://api.example.com`） | API 不走同域 `/api` 时 |
| `NEXT_PUBLIC_WS_URL` | 空 | 覆盖前端 WS 地址（支持绝对 URL 或 `/custom_ws`） | WS 路径/域名自定义时 |
| `NEXT_PUBLIC_WS_PORT` | `3002` | WS 直连端口兜底值（**构建时注入，Docker 运行时设置无效**；Docker 场景请用 `WS_EXTERNAL_PORT`） | 仅源码自构建时需要自定义端口 |
| `API_URL` | `http://localhost:3001` | Next.js `/api` rewrite 目标（主要用于源码/自构建） | 你修改了 API 实际监听地址时 |
| `COOKIE_SECRET` | 自动生成 | Cookie 签名密钥；未固定时会自动生成（数据目录不持久化时重启后会话会失效） | 生产环境强烈建议固定配置 |
| `AGENT_HEARTBEAT_TIMEOUT_MS` | `90000` | Agent 超过该时长（毫秒，最小 `15000`）没有心跳/上报即显示离线（后端列表、健康检查、手动测试）。默认为 Agent 30 秒心跳间隔的 3 倍 | 网络较慢、Agent 在线状态反复跳变时 |
| `BACKEND_TLS_INSECURE` | 空 | 设为 `1` 时仅对网关 API 跳过 TLS 证书校验（Surge `http-api-tls`、mihomo `external-controller-tls` 自签证书），启动时打印警告 | 网关走 HTTPS 且证书为自签 / 与 IP 不匹配时 |
| `GEOIP_LOOKUP_PROVIDER` | `online` | IP 地理查询来源（`online`/`local`） | 需要默认走本地 MMDB 查询时 |
| `GEOIP_ONLINE_API_URL` | `https://api.ipinfo.es/ipinfo` | 在线 IP 查询接口地址（需兼容 `ipinfo.my` 的响应结构） | 仅在你部署了兼容接口时设置 |
| `FORCE_ACCESS_CONTROL_OFF` | `false` | 强制关闭访问控制（紧急恢复） | 仅忘记密码临时使用 |
| `SHOWCASE_SITE_MODE` | `false` | 演示只读模式（禁用敏感写操作） | 仅公开演示站点 |

### 高级调优变量（可选）

| 变量名 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `FLUSH_INTERVAL_MS` | `30000` | 采集缓冲区落库间隔 |
| `FLUSH_MAX_BUFFER_SIZE` | `5000` | 采集缓冲区最大条目，达到即提前落库 |
| `REALTIME_MAX_MINUTES` | `180` | 实时内存窗口大小（分钟） |
| `REALTIME_RANGE_END_TOLERANCE_MS` | `120000` | 查询结束时间容差，缓解边界抖动 |
| `SURGE_POLICY_SYNC_INTERVAL_MS` | `600000` | Surge 策略同步周期 |
| `DB_RANGE_QUERY_CACHE_TTL_MS` | `8000` | 范围查询缓存 TTL |
| `DB_HISTORICAL_QUERY_CACHE_TTL_MS` | `300000` | 历史查询缓存 TTL |
| `DB_RANGE_QUERY_CACHE_MAX_ENTRIES` | `1024` | 范围查询缓存最大条目 |
| `DB_RANGE_QUERY_CACHE_DISABLED` | 空 | 设为 `1` 可关闭范围查询缓存 |
| `DEBUG_SURGE` | `false` | Surge 采集调试日志开关（`true` 开启） |

### API / WS 地址解析优先级

1. API 客户端基址：`runtime-config.API_URL` → `NEXT_PUBLIC_API_URL` → 默认同域 `/api`
2. `/api` 的服务端转发目标：`API_URL`（默认 `http://localhost:3001`，在 Next.js rewrite 中生效）
3. WS URL：`runtime-config.WS_URL` → `NEXT_PUBLIC_WS_URL` → 自动候选（`runtime-config.WS_PORT` 存在时优先直连端口，否则优先 `/_cm_ws`）
4. WS 端口：`runtime-config.WS_PORT`（来自 `WS_EXTERNAL_PORT`）→ `NEXT_PUBLIC_WS_PORT` → `3002`
5. 默认部署下无需手动配置 `NEXT_PUBLIC_WS_URL`；仅当你自定义 WS 路径/域名时再设置

### 线上环境建议（强烈）

```env
NODE_ENV=production
DB_PATH=/app/data/stats.db
COOKIE_SECRET=<至少32字节随机字符串>
# 可选：默认切换到本地 MMDB 查询
# GEOIP_LOOKUP_PROVIDER=local
# 仅紧急恢复时临时开启，平时不要保留 true
# FORCE_ACCESS_CONTROL_OFF=false
```

可使用 `openssl rand -hex 32` 生成 `COOKIE_SECRET`。

补充建议：

1. 挂载持久化目录（如 `./data:/app/data`），避免数据库与自动生成密钥丢失。
2. 如果外部直连 WS 且端口非 `3002`，务必同步设置 `WS_EXTERNAL_PORT`。
3. 若源码部署修改了 API 端口或地址，记得同步设置 `API_URL`。
4. 如需本地 MMDB 查询：挂载 `./geoip:/app/data/geoip:ro`，并在面板「设置 -> 偏好设置 -> IP 查询来源」切换为本地。
5. MMDB 文件体积较大，项目镜像不内置数据库。请自行下载并放入 `./geoip`，文件名固定为：
   `GeoLite2-City.mmdb`、`GeoLite2-ASN.mmdb`（必需），`GeoLite2-Country.mmdb`（可选）。
   推荐来源：<https://github.com/P3TERX/GeoLite.mmdb>。

> 进阶说明：Agent 模式的安装、参数、发布与兼容策略已迁移到 `docs/agent/*`，请以文档为准。

## 🗄️ ClickHouse（可选）

SQLite 是 Neko Master 的默认存储引擎，对大多数用户已完全够用。  
如果你有以下需求，可以额外启用 ClickHouse：

- 数据量很大（域名 / IP 条目数十万以上）
- 需要快速的长时间范围（≥ 7 天）聚合查询
- 希望将历史统计数据与配置数据分层存储

> ClickHouse 完全可选。SQLite 作为配置和元数据存储，无论是否启用 ClickHouse 都不会被移除。

### 架构说明

启用 ClickHouse 后，系统进入**双写模式**：

```
BatchBuffer.flush()
    │
    ├──→ SQLite（配置 / 元数据，始终写入）
    └──→ ClickHouse（统计流量数据，双写）
           └── Buffer 表 → SummingMergeTree 异步合并
```

读取来源由 `STATS_QUERY_SOURCE` 控制，默认仍为 `sqlite`。

### 启用 ClickHouse（Docker）

#### 步骤一：启动 ClickHouse 容器

仓库内置的 `docker-compose.yml` 已包含 ClickHouse 服务，通过 `profiles: [clickhouse]` 隔离，默认不启动。
直接在仓库根目录执行：

```bash
docker compose --profile clickhouse up -d
```

> ClickHouse 数据持久化到 `./data/clickhouse`，与主应用数据分目录存储。

如果你使用的是**自定义 `docker-compose.yml`**（如上方场景 A/B），需手动添加 ClickHouse 服务块：

```yaml
services:
  neko-master:
    # ... 你的现有配置 ...
    environment:
      # 在现有 environment 中追加：
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

#### 步骤二：配置环境变量

在 `.env` 中添加（与 `docker-compose.yml` 同目录）：

```env
# 开启 ClickHouse 连接
CH_ENABLED=1

# 开启双写
CH_WRITE_ENABLED=1

# 读取来源：sqlite（默认）/ auto（自动选择）/ clickhouse（强制）
STATS_QUERY_SOURCE=auto

# ClickHouse 连接信息（使用 docker-compose.yml 默认值时，以下无需修改）
CH_HOST=clickhouse
CH_PORT=8123
CH_DATABASE=neko_master
CH_USER=neko
CH_PASSWORD=neko_master
```

重启：

```bash
docker compose --profile clickhouse up -d
```

### ClickHouse 环境变量说明

| 变量名 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `CH_ENABLED` | `0` | 是否启用 ClickHouse 连接（`1` 开启） |
| `CH_WRITE_ENABLED` | `0` | 是否开启双写（须先开 `CH_ENABLED`） |
| `CH_ONLY_MODE` | `0` | CH 健康时跳过 SQLite 统计写入（纯 CH 模式） |
| `CH_HOST` | `clickhouse` | ClickHouse 主机地址 |
| `CH_PORT` | `8123` | ClickHouse HTTP 端口 |
| `CH_DATABASE` | `neko_master` | 数据库名称 |
| `CH_USER` | `neko` | 用户名 |
| `CH_PASSWORD` | `neko_master` | 密码 |
| `CH_SECURE` | `0` | 是否使用 HTTPS 连接 |
| `CH_REQUIRED` | `0` | CH 不可用时拒绝启动（`1` 开启） |
| `CH_AUTO_CREATE_TABLES` | `1` | 首次启动时自动建表 |
| `CH_WRITE_MAX_PENDING_BATCHES` | `200` | 最大写入积压批次数 |
| `CH_UNHEALTHY_THRESHOLD` | `5` | 连续失败次数超过此值后标记为不健康，自动回退 SQLite |
| `STATS_QUERY_SOURCE` | `sqlite` | 读取来源：`sqlite` / `auto` / `clickhouse` |
| `CH_COMPARE_ENABLED` | `0` | 开启 SQLite ↔ ClickHouse 数据对账 |
| `CH_EXTERNAL_HTTP_PORT` | `8123` | ClickHouse HTTP 外部端口（Compose 映射） |
| `CH_EXTERNAL_NATIVE_PORT` | `9000` | ClickHouse Native 外部端口（Compose 映射） |

> **健康回退机制**：ClickHouse 连续写入失败超过 `CH_UNHEALTHY_THRESHOLD` 次后，系统自动标记为不健康，SQLite 写入恢复（即使开启了 `CH_ONLY_MODE`）。ClickHouse 恢复正常后自动重新标记为健康。

### 老用户迁移指引

> 从纯 SQLite 版本升级时，**你的数据不会丢失**。  
> SQLite 文件（`./data/stats.db`）完整保留，以下是推荐的渐进迁移路径：

#### 第一阶段：双写（观察期，推荐起点）

```env
CH_ENABLED=1
CH_WRITE_ENABLED=1
STATS_QUERY_SOURCE=sqlite   # 继续读 SQLite，CH 在后台积累数据
```

启动并观察 `[ClickHouse Writer]` 日志确认写入正常。

#### 第二阶段：切换读取来源

```env
STATS_QUERY_SOURCE=auto     # 自动选择：最近数据走 CH，历史走 SQLite
# 或
STATS_QUERY_SOURCE=clickhouse  # 强制读 CH
```

#### 第三阶段（可选）：迁移历史数据

如需将 SQLite 历史统计数据搬入 ClickHouse：

```bash
# 标准迁移（清空 CH 后重新导入，附带对账验证）
./scripts/ch-migrate-docker.sh

# 追加模式（保留 CH 现有数据，增量导入）
./scripts/ch-migrate-docker.sh --append

# 指定时间窗口
./scripts/ch-migrate-docker.sh --from 2026-02-01T00:00:00Z --to 2026-02-20T00:00:00Z
```

#### 第四阶段（可选）：纯 ClickHouse 模式

当 ClickHouse 稳定运行后，可停止 SQLite 统计写入：

```env
CH_ONLY_MODE=1
```

> 即使在 `CH_ONLY_MODE=1` 下，若 ClickHouse 不健康，系统会自动回退到 SQLite 写入，数据不会丢失。

### 回退到纯 SQLite

随时可以完全回退：

```env
CH_ENABLED=0
CH_WRITE_ENABLED=0
CH_ONLY_MODE=0
STATS_QUERY_SOURCE=sqlite
```

重启后恢复纯 SQLite 模式，历史数据完整保留。

---

## 🌐 反向代理与 Tunnel

推荐将 Web 页面与 WS 都放在同一个域名下，通过不同路径转发：`/` → `3000`，`/_cm_ws` → `3002`。

### Nginx 标准示例（推荐）

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

配套 Docker 环境变量：

```env
# 默认无需配置（已默认 /_cm_ws）
# 如需自定义可设置：
# NEXT_PUBLIC_WS_URL=/custom_ws
```

### Cloudflare Tunnel 标准示例

`~/.cloudflared/config.yml`：

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

启动：

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run <your-tunnel-name-or-id>
```

如果使用 Zero Trust Dashboard 托管路由（token 方式），请在 Dashboard 中配置同样两条规则，并保证 `/_cm_ws*` 在 `/*` 之前。

### 关键注意事项

1. 不要把 WS 路径写成 `ws`（无前导 `/`），容易误匹配静态资源，导致 `/_next/static/...` 返回 `426 Upgrade Required`
2. WS 路由必须高于 catch-all 路由（`/*`）
3. 默认不需要配置 `NEXT_PUBLIC_WS_URL`；如你自定义了该变量，修改后需重启前端进程/容器
4. 容器仅映射 `3000` 也能正常用，但会自动回退到 HTTP 轮询（约 5 秒级），实时性弱于 WS
5. `beacon.min.js` 等第三方脚本失败通常不影响主数据链路（API/WS）
6. 默认不需要单独配置 `/api` 反代：前端会同域访问 `/api` 并由应用内部转发到 `3001`

> 说明：`/_next/static/... 426 Upgrade Required` 在 **反向代理 / Tunnel 配置错误** 时比较常见；本地直连（不经反代）通常不会遇到。

### 多架构支持

Docker 镜像同时支持 `linux/amd64` 和 `linux/arm64`。

### 数据持久化

数据默认存储在容器内的 `/app/data` 目录，建议映射到宿主机：

```yaml
volumes:
  - ./data:/app/data
```

### 更新到最新版本

```bash
# 拉取最新镜像并重新启动
docker compose pull
docker compose up -d
```

## 🔐 认证与安全

Neko Master 支持访问鉴权功能，保护你的面板数据安全。

### 生产环境安全基线

1. 固定配置 `COOKIE_SECRET`（否则重启后会话可能失效）。
2. 不要长期保留 `FORCE_ACCESS_CONTROL_OFF=true`。
3. `SHOWCASE_SITE_MODE=true` 仅用于演示站点（会限制写操作）。

示例：

```env
COOKIE_SECRET=<至少32字节随机字符串>
# FORCE_ACCESS_CONTROL_OFF=false
# SHOWCASE_SITE_MODE=false
```

### 开启/关闭鉴权

1. 进入面板，点击左侧边栏底部的「设置」。
2. 切换到「安全」标签页。
3. 在此页面可以开启/关闭访问控制，并设置访问令牌（Token）。

### 忘记密码（重置访问令牌）

如果你忘记了访问令牌，可以通过环境变量 `FORCE_ACCESS_CONTROL_OFF` 强制进入**紧急访问模式**。

#### Docker Compose 用户

1. 修改 `docker-compose.yml`，在 `environment` 下添加：

   ```yaml
   environment:
     - FORCE_ACCESS_CONTROL_OFF=true
   ```

2. 重启容器：

   ```bash
   docker compose up -d
   ```

3. 刷新页面，你将看到“紧急访问模式”警告。此时无需旧密码即可在「设置 -> 安全」中重置新令牌。

4. **重要**：重置完成后，务必删除该环境变量并再次重启容器，以恢复访问控制。

#### Docker 命令行用户

1. 停止并删除旧容器（数据在挂载卷中，不会丢失）：

   ```bash
   docker stop neko-master
   docker rm neko-master
   ```

2. 添加 `-e FORCE_ACCESS_CONTROL_OFF=true` 参数重新启动：

   ```bash
   docker run -d \
     --name neko-master \
     -p 3000:3000 \
     -v $(pwd)/data:/app/data \
     -e FORCE_ACCESS_CONTROL_OFF=true \
     foru17/neko-master:latest
   ```

3. 重置密码后，再次停止容器，去除该参数并重启，恢复正常保护模式。


## ❓ 常见问题

### Q: 只映射 `3000:3000` 可以正常使用吗？

**A:** 可以。页面功能仍可用，未打通 WS 时会自动回退为 HTTP 轮询。  
如需完整实时能力，请按上文配置反代路径（如 `/_cm_ws`）并转发到 `3002`。

### Q: 端口冲突或改端口后无法访问怎么办？

**A:** 先在项目根目录创建 `.env`（与 `docker-compose.yml` 同目录）：

```env
WEB_EXTERNAL_PORT=8080
API_EXTERNAL_PORT=8081
WS_EXTERNAL_PORT=8082
```

然后重启并用新端口访问：

```bash
docker compose down
docker compose up -d
```

### Q: 为什么重启后登录状态会失效？

**A:** 通常是 `COOKIE_SECRET` 未固定或数据目录未持久化导致。建议：

1. 设置固定 `COOKIE_SECRET`
2. 挂载 `./data:/app/data`

### Q: 本地 MMDB 查询要准备哪些文件？

**A:** 建议在项目目录创建 `./geoip`（可与 `docker-compose.yml` 同级），然后放置以下文件：

1. `GeoLite2-City.mmdb`（必需）
2. `GeoLite2-ASN.mmdb`（必需）
3. `GeoLite2-Country.mmdb`（可选）

推荐下载源：<https://github.com/P3TERX/GeoLite.mmdb>。  
容器内固定读取目录是 `/app/data/geoip`，因此建议保持挂载：
`./geoip:/app/data/geoip:ro`。后续你只需替换宿主机 `./geoip` 里的文件即可完成更新。

### Q: 连接 OpenClash / 网关失败？

**A:** 检查以下几点：

1. OpenClash 的「外部控制」是否已开启
2. OpenClash 地址是否正确（格式：`IP:端口`）
3. 如果配置了 Secret，Token 是否填写正确
4. 容器是否能访问到 OpenClash 所在网络

### Q: 如何备份和恢复数据？

**A:** 数据默认在 `./data/stats.db`。先备份：

```bash
cp -r ./data ./data-backup-$(date +%Y%m%d)
```

恢复时停止服务、覆盖数据目录再启动：

```bash
docker compose down
cp -r ./data-backup-YYYYMMDD/. ./data/
docker compose up -d
```

## 🏗️ 架构文档指引

如果你想快速理解系统设计与实现深度，建议按下面顺序阅读：

1. **整体架构图**：端到端分层与模块职责 → [docs/architecture.md](./docs/architecture.md)
2. **数据流详解**：Clash / Surge 两条采集链路与聚合过程
3. **数据模型与存储**：SQLite 表结构、ClickHouse Buffer 表、保留策略
4. **实时通道设计**：`RealtimeStore` 合并策略与 WS 推送机制
5. **ClickHouse 模块**：双写架构、健康回退、读取路由

完整文档索引：[docs/README.zh.md](./docs/README.zh.md)

> 该文档覆盖采集、聚合、缓存、实时推送与多后端管理的核心设计。

## 🤝 反馈与 Issue

本项目已启用 GitHub Issue 模板（Bug / Feature / Support）。

建议提单时至少包含：

1. 部署方式（Compose / Docker Run / 源码）
2. 版本信息（镜像 tag 或 commit）
3. 关键环境变量（请脱敏，如 `COOKIE_SECRET=***`）
4. 复现步骤与预期/实际结果
5. 关键日志（`docker logs`、浏览器 Console、网络报错）

## 📁 项目结构

```
neko-master/
├── docker-compose.yml      # Docker Compose 配置
├── Dockerfile              # Docker 镜像构建
├── setup.sh                # 一键配置脚本
├── docker-start.sh         # Docker 容器启动脚本
├── start.sh                # 源码开发启动脚本
├── docs/                   # 文档（见 docs/README.zh.md）
│   ├── README.md           # 文档总索引（英文默认）
│   ├── README.zh.md        # 文档总索引（中文）
│   ├── README.en.md        # 文档总索引（英文镜像）
│   ├── architecture.md     # 系统架构（中文）
│   ├── architecture.en.md  # 系统架构（英文）
│   ├── release-checklist.md
│   ├── agent/              # Agent 模式文档（中英文双语）
│   │   ├── overview.md / overview.en.md
│   │   ├── quick-start.md / quick-start.en.md
│   │   ├── install.md / install.en.md
│   │   ├── config.md / config.en.md
│   │   ├── release.md / release.en.md
│   │   └── troubleshooting.md / troubleshooting.en.md
│   ├── research/           # 研究报告
│   └── dev/                # 内部开发文档
├── assets/                 # 预览图和图标
├── apps/
│   ├── collector/          # 数据收集服务（Node.js + WebSocket）
│   ├── agent/              # Agent 守护进程（Go）
│   └── web/                # Next.js 前端应用
└── packages/
    └── shared/             # 共享类型定义和工具
```

## 🛠️ 技术栈

- **前端**: Next.js 16 + React 19 + TypeScript + Tailwind CSS
- **UI 组件**: shadcn/ui
- **数据收集**: Node.js + Fastify + WebSocket + SQLite（+ ClickHouse 可选）
- **可视化**: Recharts + D3.js
- **国际化**: next-intl（中/英）
- **部署**: Docker + Docker Compose

## 🤝 参与贡献

欢迎贡献！

- 🐛 [提交 Bug](https://github.com/foru17/neko-master/issues/new)
- 💡 [功能建议](https://github.com/foru17/neko-master/issues/new)
- 🔧 [贡献代码](https://github.com/foru17/neko-master/pulls)

提 PR 前请阅读 [CONTRIBUTING.zh.md](./CONTRIBUTING.zh.md)（开发流程、检查项、i18n/暗色模式要求）。

**使用 AI 编码工具开发？**（Claude Code、Copilot、Cursor、Codex 等）让它先读 [AGENTS.md](./AGENTS.md)——编码规范、关键契约与项目地图——以及 [`.claude/skills/`](./.claude/skills/) 里的任务级流程指南。Claude Code 会自动加载两者。

## 📄 许可证

MIT License © 2024 [foru17](https://github.com/foru17)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=foru17/neko-master&type=date&legend=top-left)](https://www.star-history.com/#foru17/neko-master&type=date&legend=top-left)

---

<p align="center">
  如果这个项目对你有帮助，请给个 ⭐ Star 支持一下！
</p>
