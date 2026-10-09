# Agent Install Guide

[中文](./install.md) | **English**

## Supported targets

Release artifacts are published for:

- `darwin-amd64`
- `darwin-arm64`
- `linux-amd64`
- `linux-arm64`
- `linux-armv7`
- `linux-mips`
- `linux-mipsle`

## Install via script (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='13' \
        NEKO_BACKEND_TOKEN='ag_xxx' \
        NEKO_GATEWAY_TYPE='clash' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9090' \
        sh
```

Optional env:

- `NEKO_GATEWAY_TOKEN`: gateway auth token
- `NEKO_AGENT_VERSION`: `latest` (default) or explicit tag like `agent-v0.2.0`
- `NEKO_INSTALL_DIR`: install directory (default `$HOME/.local/bin`)
- `NEKO_AUTO_START`: `true|false` (default `true`, starts immediately and auto-registers boot autostart)
- `NEKO_LOG`: `true|false` (default `true`)
- `NEKO_LOG_FILE`: runtime log file path
- `NEKO_PACKAGE_URL`: custom package URL override
- `NEKO_CHECKSUMS_URL`: custom checksums URL override
- `NEKO_INSTANCE_NAME`: instance name for `nekoagent` manager (default `backend-<id>`)
- `NEKO_BIN_LINK_MODE`: `auto|true|false` for symlink into global bin dir (default `auto`)
- `NEKO_LINK_DIR`: global bin dir for symlink (default `/usr/local/bin`)
- `GITHUB_TOKEN`: token for GitHub API queries; falls back to `GITHUB_PAT` when empty

Set `AGENT_HEARTBEAT_TIMEOUT_MS` in the collector process environment to adjust how long an agent may stay silent before it is shown offline (backend list, automatic health checks and manual test) (milliseconds, default `90000`, minimum `15000`). The default allows 3 × the agent's default 30-second heartbeat interval to tolerate delayed reports; this is a collector setting, not an agent install option.

After install, manage agent with:

```bash
nekoagent status <instance>
nekoagent logs <instance>
nekoagent restart <instance>
nekoagent upgrade
nekoagent upgrade agent-vX.Y.Z
nekoagent remove <instance>
```

Uninstall binaries:

```bash
nekoagent uninstall
```

### GitHub API rate limit / private mirrors

If fetching the latest version hits GitHub's anonymous API rate limit, set `GITHUB_TOKEN` and retry:

```sh
GITHUB_TOKEN='<github-token>' nekoagent upgrade
```

For installation, set the same variable before running a downloaded `install.sh`, preserving your existing `NEKO_*` installation settings:

```sh
GITHUB_TOKEN='<github-token>' \
NEKO_SERVER='http://your-panel:3000' \
NEKO_BACKEND_ID='13' \
NEKO_BACKEND_TOKEN='ag_xxx' \
NEKO_GATEWAY_TYPE='clash' \
NEKO_GATEWAY_URL='http://127.0.0.1:9090' \
sh ./install.sh
```

A non-empty `GITHUB_TOKEN` takes precedence; otherwise, `GITHUB_PAT` is used. The token is sent only to `https://api.github.com`, never to release binaries, raw files, or mirror download URLs, and is not saved in instance configs. If installation with a private mirror still queries GitHub for the latest version, this variable authenticates that API query; access to the mirror download itself must be handled separately.

- `GitHub token rejected (401)`: the token is invalid or expired; replace it and retry.
- `GitHub API rate limit or forbidden (HTTP 403); set GITHUB_TOKEN` (or `HTTP 429`): the API is rate-limited or access is forbidden; set a valid token and check permissions or wait for the limit to reset.

## Manual install

1. Download the correct tarball from GitHub Releases
2. Verify hash using `checksums.txt`
3. Extract `neko-agent`
4. Run executable with backend parameters

### Optional gateway flags

| Flag | Environment variable | Default | Description |
| --- | --- | --- | --- |
| `--gateway-insecure-tls` | `NEKO_GATEWAY_INSECURE_TLS` | `false` | Skip gateway API TLS certificate verification for self-signed Surge `http-api-tls` / mihomo `external-controller-tls` certificates. Use only on a trusted LAN. Server reporting still verifies certificates. |

Append `--gateway-insecure-tls` to `nekoagent add` to persist the setting. For an existing instance, set `NEKO_GATEWAY_INSECURE_TLS=true` in `/etc/neko-agent/<name>.env` and restart it.

## OpenWrt note

Before build selection, check architecture:

```sh
uname -m
opkg print-architecture
```

Common mapping:

- `x86_64` -> `linux-amd64`
- `aarch64` -> `linux-arm64`
- `armv7*` -> `linux-armv7`
- `mips` -> `linux-mips`
- `mipsle` -> `linux-mipsle`

## What gets installed

The install script places two binaries into `NEKO_INSTALL_DIR` (default `~/.local/bin`):

- `neko-agent` — the data collection daemon (runs continuously, reports to panel)
- `nekoagent` — the CLI manager for lifecycle operations (start / stop / upgrade / remove)

The `nekoagent` manager stores:

- Instance configs in `CONFIG_DIR` (default `/etc/neko-agent/<name>.env`)
- PID and log files in `STATE_DIR` (default `/var/run/neko-agent/`)

## Autostart on system boot

Since `agent-v0.2.1`, when `NEKO_AUTO_START=true` the installer automatically attempts to
register boot autostart (systemd / OpenWrt procd / launchd / cron fallback).
If permissions are insufficient or the platform is unsupported, configure a system service
manually so the agent survives reboots.

### Linux — systemd

Create `/etc/systemd/system/neko-agent-<instance>.service` (replace `<instance>` with your
instance name, e.g. `backend-1`):

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

If `NEKO_GATEWAY_TOKEN` is set, append it to `ExecStart`:

```ini
ExecStart=/usr/local/bin/neko-agent \
  ...
  --gateway-token ${NEKO_GATEWAY_TOKEN}
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable neko-agent-<instance>
systemctl start neko-agent-<instance>
systemctl status neko-agent-<instance>
```

View logs:

```bash
journalctl -u neko-agent-<instance> -f
```

> Note: If `neko-agent` is installed to `~/.local/bin` (non-root), adjust `ExecStart` path
> accordingly and consider running the service under a non-root user.

### macOS — launchd

Create `~/Library/LaunchAgents/io.neko-master.agent.<instance>.plist`:

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

Load the service:

```bash
launchctl load ~/Library/LaunchAgents/io.neko-master.agent.<instance>.plist
```

Unload:

```bash
launchctl unload ~/Library/LaunchAgents/io.neko-master.agent.<instance>.plist
```

### OpenWrt — init.d

Create `/etc/init.d/neko-agent`:

```sh
#!/bin/sh /etc/rc.common
USE_PROCD=1
START=95
STOP=10

PROG=/usr/local/bin/neko-agent
INSTANCE=backend-1   # change as needed
CONF=/etc/neko-agent/${INSTANCE}.env

start_service() {
    mkdir -p /var/run/neko-agent
    # load config
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

Enable:

```bash
chmod +x /etc/init.d/neko-agent
/etc/init.d/neko-agent enable
/etc/init.d/neko-agent start
```
