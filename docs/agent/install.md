# Agent 安装指南

**中文 | [English](./install.en.md)**

## 支持的目标平台

发布产物覆盖：

- `darwin-amd64`
- `darwin-arm64`
- `linux-amd64`
- `linux-arm64`
- `linux-armv7`
- `linux-mips`
- `linux-mipsle`

## 通过脚本安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='13' \
        NEKO_BACKEND_TOKEN='ag_xxx' \
        NEKO_GATEWAY_TYPE='clash' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9090' \
        sh
```

可选环境变量：

- `NEKO_GATEWAY_TOKEN`：网关认证 token
- `NEKO_AGENT_VERSION`：`latest`（默认）或具体标签如 `agent-v0.2.0`
- `NEKO_INSTALL_DIR`：安装目录（默认 `$HOME/.local/bin`）
- `NEKO_AUTO_START`：`true|false`（默认 `true`，安装后立即启动并自动注册开机自启）
- `NEKO_LOG`：`true|false`（默认 `true`）
- `NEKO_LOG_FILE`：运行时日志文件路径
- `NEKO_PACKAGE_URL`：自定义软件包 URL
- `NEKO_CHECKSUMS_URL`：自定义校验和 URL
- `NEKO_INSTANCE_NAME`：`nekoagent` 管理器中的实例名（默认 `backend-<id>`）
- `NEKO_BIN_LINK_MODE`：全局 bin 目录软链模式（`auto|true|false`，默认 `auto`）
- `NEKO_LINK_DIR`：软链目标目录（默认 `/usr/local/bin`）

采集器端可设置 `AGENT_HEARTBEAT_TIMEOUT_MS` 调整 Agent 判定离线的心跳超时（后端列表、自动健康检查与手动测试共用）（毫秒，默认 `90000`，最小 `15000`）。默认值为 Agent 默认 30 秒心跳间隔的 3 倍，用于容忍上报延迟；此变量应配置在采集器进程的环境中，而非 Agent 安装命令中。

安装完成后，使用以下命令管理 Agent：

```bash
nekoagent status <instance>
nekoagent logs <instance>
nekoagent restart <instance>
nekoagent upgrade
nekoagent upgrade agent-vX.Y.Z
nekoagent remove <instance>
```

卸载二进制：

```bash
nekoagent uninstall
```

## 手动安装

1. 从 GitHub Releases 下载对应平台的压缩包
2. 使用 `checksums.txt` 验证哈希
3. 解压 `neko-agent`
4. 携带后端参数直接运行可执行文件

### 可选网关参数

| Flag | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--gateway-insecure-tls` | `NEKO_GATEWAY_INSECURE_TLS` | `false` | 跳过网关 API 的 TLS 证书校验，适用于 Surge `http-api-tls` / mihomo `external-controller-tls` 自签证书；仅在可信局域网内使用。上报服务端仍校验证书。 |

使用 `nekoagent add` 时可追加 `--gateway-insecure-tls`，管理器会持久化该配置；已有实例可在 `/etc/neko-agent/<name>.env` 中设置 `NEKO_GATEWAY_INSECURE_TLS=true` 后重启。

## 安装了哪些文件

安装脚本在 `NEKO_INSTALL_DIR`（默认 `~/.local/bin`）中放置两个二进制文件：

- `neko-agent` — 数据采集守护进程（持续运行，向面板上报数据）
- `nekoagent` — CLI 管理器（Shell 脚本，管理实例生命周期：start / stop / upgrade / remove）

`nekoagent` 管理器的存储位置：

- 实例配置：`CONFIG_DIR`（默认 `/etc/neko-agent/<name>.env`）
- PID 与日志文件：`STATE_DIR`（默认 `/var/run/neko-agent/`）

## 开机自启配置

从 `agent-v0.2.1` 开始，安装脚本在 `NEKO_AUTO_START=true` 时会自动尝试注册系统开机自启（systemd / OpenWrt procd / launchd / cron 回退）。
若当前环境权限不足或不支持自动注册，可使用手动方式配置系统服务，确保重启后自动恢复运行。

### Linux — systemd

创建 `/etc/systemd/system/neko-agent-<instance>.service`（将 `<instance>` 替换为实例名，如 `backend-1`）：

```ini
[Unit]
Description=Neko Agent (<instance>)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=/etc/neko-agent/<instance>.env
ExecStart=/usr/local/bin/neko-agent \
  --server-url ${NEKO_SERVER} \
  --backend-id ${NEKO_BACKEND_ID} \
  --backend-token ${NEKO_BACKEND_TOKEN} \
  --gateway-type ${NEKO_GATEWAY_TYPE} \
  --gateway-url ${NEKO_GATEWAY_URL}
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

若设置了 `NEKO_GATEWAY_TOKEN`，在 `ExecStart` 末尾追加：

```ini
ExecStart=/usr/local/bin/neko-agent \
  ...
  --gateway-token ${NEKO_GATEWAY_TOKEN}
```

启用并启动：

```bash
systemctl daemon-reload
systemctl enable neko-agent-<instance>
systemctl start neko-agent-<instance>
systemctl status neko-agent-<instance>
```

查看日志：

```bash
journalctl -u neko-agent-<instance> -f
```

> 注意：若 `neko-agent` 安装在 `~/.local/bin`（非 root），需相应调整 `ExecStart` 路径，并考虑以非 root 用户运行服务。

### macOS — launchd

创建 `~/Library/LaunchAgents/io.neko-master.agent.<instance>.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.neko-master.agent.<instance></string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/neko-agent</string>
    <string>--server-url</string>
    <string>http://your-panel:3000</string>
    <string>--backend-id</string>
    <string>1</string>
    <string>--backend-token</string>
    <string>ag_xxx</string>
    <string>--gateway-type</string>
    <string>clash</string>
    <string>--gateway-url</string>
    <string>http://127.0.0.1:9090</string>
  </array>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/neko-agent-<instance>.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/neko-agent-<instance>.log</string>
</dict>
</plist>
```

加载服务：

```bash
launchctl load ~/Library/LaunchAgents/io.neko-master.agent.<instance>.plist
```

卸载服务：

```bash
launchctl unload ~/Library/LaunchAgents/io.neko-master.agent.<instance>.plist
```

### OpenWrt — init.d

创建 `/etc/init.d/neko-agent`：

```sh
#!/bin/sh /etc/rc.common
USE_PROCD=1
START=95
STOP=10

PROG=/usr/local/bin/neko-agent
INSTANCE=backend-1   # 按需修改
CONF=/etc/neko-agent/${INSTANCE}.env

start_service() {
    mkdir -p /var/run/neko-agent
    # 加载配置
    [ -f "$CONF" ] && . "$CONF"
    procd_open_instance
    procd_set_param command "$PROG" \
        --server-url "$NEKO_SERVER" \
        --backend-id "$NEKO_BACKEND_ID" \
        --backend-token "$NEKO_BACKEND_TOKEN" \
        --gateway-type "$NEKO_GATEWAY_TYPE" \
        --gateway-url "$NEKO_GATEWAY_URL"
    [ -n "$NEKO_GATEWAY_TOKEN" ] && \
        procd_append_param command --gateway-token "$NEKO_GATEWAY_TOKEN"
    procd_set_param respawn 3600 5 5
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_set_param pidfile "/var/run/neko-agent/${INSTANCE}.pid"
    procd_close_instance
}
```

启用：

```bash
chmod +x /etc/init.d/neko-agent
/etc/init.d/neko-agent enable
/etc/init.d/neko-agent start
```

## OpenWrt 注意事项

安装前确认架构：

```sh
uname -m
opkg print-architecture
```

常见对应关系：

- `x86_64` → `linux-amd64`
- `aarch64` → `linux-arm64`
- `armv7*` → `linux-armv7`
- `mips` → `linux-mips`
- `mipsle` → `linux-mipsle`
