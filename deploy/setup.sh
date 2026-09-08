#!/usr/bin/env bash
# ============================================================
# Neko Host Stack — 一键部署
#   组件: 宿主执行器 node-tool (:8008) + Neko Master 面板 (:3000/3002)
#   用法: bash deploy/setup.sh [-n] [-f] [--no-build] [--skip-tool] [--skip-panel]
#   -n          干跑(只打印将要执行的动作)
#   -f          覆盖已存在配置(默认跳过已存在项)
#   --no-build  不构建镜像, 使用已有 neko-master:custom 或官方镜像
#   环境变量: NEKO_DIR TOOL_DIR TOOL_PORT MIHOMO_CONFIG_DIR PANEL_PORTS
# ============================================================
set -euo pipefail

# ---------- 参数 ----------
DRY=0; FORCE=0; BUILD=1; DO_TOOL=1; DO_PANEL=1
for a in "$@"; do
  case "$a" in
    -n) DRY=1 ;;
    -f) FORCE=1 ;;
    --no-build) BUILD=0 ;;
    --skip-tool) DO_TOOL=0 ;;
    --skip-panel) DO_PANEL=0 ;;
    *) echo "未知参数: $a"; exit 1 ;;
  esac
done

# ---------- 路径/环境 ----------
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEKO_DIR="${NEKO_DIR:-/opt/neko-master}"
TOOL_DIR="${TOOL_DIR:-/opt/mihomo-node-tool}"
TOOL_PORT="${TOOL_PORT:-8008}"
MIHOMO_CONFIG_DIR="${MIHOMO_CONFIG_DIR:-/root/.config/mihomo}"
PANEL_PORT="${PANEL_PORT:-3000}"
WS_PORT="${WS_PORT:-3002}"
BACKUP_DIR="/var/lib/neko-host-tool/backups"

log()  { echo -e "\033[1;32m[setup]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn ]\033[0m $*"; }
die()  { echo -e "\033[1;31m[error]\033[0m $*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then echo "    (dry-run) $*"; else "$@"; fi; }

# ---------- 前置检查 ----------
if [ "$DRY" != 1 ]; then
  command -v docker >/dev/null || die "未找到 docker — 请先安装: curl -fsSL https://get.docker.com | sh"
  [ "$(id -u)" = "0" ] || die "需要 root"
fi

# ---------- mihomo 探测 ----------
MIHOMO_BIN=""
for c in /usr/bin/mihomo /usr/local/bin/mihomo; do [ -x "$c" ] && MIHOMO_BIN="$c"; done
if [ -n "$MIHOMO_BIN" ]; then
  log "检测到 mihomo: $MIHOMO_BIN ($($MIHOMO_BIN -v 2>/dev/null | head -1 | grep -oE 'v[0-9.]+' || echo '?'))"
else
  warn "未检测到 mihomo — 装完面板后可在「⚙️服务端」页签一键安装"
fi
[ -f "$MIHOMO_CONFIG_DIR/config.yaml" ] && log "mihomo 配置: $MIHOMO_CONFIG_DIR/config.yaml" \
  || warn "未找到 $MIHOMO_CONFIG_DIR/config.yaml (面板节点功能需要它)"

# ---------- 1) 宿主执行器 ----------
if [ "$DO_TOOL" = 1 ]; then
  log "[1/3] 部署宿主执行器 → $TOOL_DIR (端口 $TOOL_PORT)"
  run apt-get install -y python3-yaml
  run install -d "$TOOL_DIR"
  if [ -f "$TOOL_DIR/server.py" ] && [ "$FORCE" != 1 ]; then
    warn "node-tool 已存在, 跳过 (用 -f 覆盖)"
  else
    run cp "$REPO_DIR/host/node-tool/"*.py "$REPO_DIR/host/node-tool/index.html" "$TOOL_DIR/"
  fi
  if systemctl is-active --quiet mihomo-node-tool 2>/dev/null && [ "$FORCE" != 1 ]; then
    warn "服务 mihomo-node-tool 已在运行, 跳过"
  else
    # 生成 unit (代理环境变量可选, 注释掉则直连)
    UNIT=/etc/systemd/system/mihomo-node-tool.service
    run bash -c "cat > $UNIT <<UNIT
[Unit]
Description=mihomo Node Hot-Update / Daemon Manager (host executor)
After=network.target
Wants=mihomo.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 $TOOL_DIR/server.py
WorkingDirectory=$TOOL_DIR
Environment=MIHOMO_CONFIG=$MIHOMO_CONFIG_DIR/config.yaml
Environment=MIHOMO_API=http://127.0.0.1:9090
Environment=TOOL_PORT=$TOOL_PORT
# Environment=HTTP_PROXY=http://PROXY_IP:PORT
# Environment=HTTPS_PROXY=http://PROXY_IP:PORT
# Environment=NO_PROXY=localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
Environment=DAEMON_BACKUP_DIR=$BACKUP_DIR
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT"
    run systemctl daemon-reload
    run systemctl enable --now mihomo-node-tool
  fi
fi

# ---------- 2) 面板镜像 ----------
if [ "$DO_PANEL" = 1 ]; then
  log "[2/3] 准备面板镜像"
  if docker image inspect neko-master:custom >/dev/null 2>&1; then
    log "镜像 neko-master:custom 已存在"
  elif [ "$BUILD" = 1 ]; then
    log "构建 neko-master:custom (首次约 5-15 分钟)..."
    run docker build -t neko-master:custom "$REPO_DIR"
  else
    warn "--no-build 且无本地镜像, 将使用官方 foru17/neko-master:latest (无扩展功能)"
  fi
fi

# ---------- 3) 面板容器 ----------
if [ "$DO_PANEL" = 1 ]; then
  log "[3/3] 部署面板容器 → $NEKO_DIR"
  run install -d "$NEKO_DIR"
  if [ -f "$NEKO_DIR/docker-compose.yml" ] && [ "$FORCE" != 1 ]; then
    warn "compose 已存在, 跳过 (用 -f 覆盖)"
  else
    run cp "$REPO_DIR/deploy/docker-compose.host.yml" "$NEKO_DIR/docker-compose.yml"
  fi
  if [ ! -f "$NEKO_DIR/.env" ]; then
    run bash -c "echo 'COOKIE_SECRET=$(openssl rand -hex 32)' > $NEKO_DIR/.env"
  fi
  run bash -c "cd $NEKO_DIR && docker compose up -d"
fi

# ---------- 完成 ----------
log "============================================"
log "部署完成!"
log "  面板:      http://<本机IP>:$PANEL_PORT   (容器健康检查通过前稍等 10-30s)"
log "  节点工具:  http://<本机IP>:$TOOL_PORT   (局域网内可直连, 无鉴权)"
log "  数据目录:  $NEKO_DIR/data  |  备份: $BACKUP_DIR"
log "下一步(首次):"
log "  1. 设置面板密钥:  curl -X POST http://127.0.0.1:$PANEL_PORT/api/auth/enable -H 'Content-Type: application/json' -d '{\"token\":\"MyToken2026\"}'"
log "  2. 浏览器打开面板 → 登录 → 设置里添加后端: url=http://host.docker.internal:9090  type=clash  secret=mihomo配置里的secret"
log "  3. 左侧「⚡节点」粘贴节点链接即用; 「⚙️服务端」管理 mihomo/clash 生命周期"
log "============================================"
