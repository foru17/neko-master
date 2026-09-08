# host/node-tool — 宿主节点/服务端执行器 (python, 无第三方依赖)

Neko Master 跑在容器里，无法直接写宿主机 mihomo 配置或操作 systemd。
本工具以 systemd 服务跑在宿主机上，向面板提供两类能力（由 collector 代理 /api/nt/* 转发）：

- **节点热更新**: `POST /api/nodes` 解析粘贴的分享链接(vmess/vless/trojan/ss/ssr/hy2/tuic/http/socks)
  写入 mihomo config -> systemctl reload -> 自动在「🚀 默认代理」选中
- **服务端生命周期**: `/api/daemon/*` — mihomo/clash 的 install/update/start/restart/stop/uninstall/status
  (systemd unit 管理 + 二进制/配置自动备份)

## 部署

```bash
install -d /opt/mihomo-node-tool
cp host/node-tool/*.py host/node-tool/index.html /opt/mihomo-node-tool/
apt-get install -y python3-yaml   # 唯一依赖

cat > /etc/systemd/system/mihomo-node-tool.service <<UNIT
[Unit]
Description=mihomo Node Hot-Update Web Tool
After=network.target mihomo.service
Wants=mihomo.service
[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/mihomo-node-tool/server.py
WorkingDirectory=/opt/mihomo-node-tool
Environment=MIHOMO_CONFIG=/root/.config/mihomo/config.yaml
Environment=MIHOMO_API=http://127.0.0.1:9090
Environment=TOOL_PORT=8008
# 如需经 HTTP 代理访问外网(如下载 GitHub release)，取消注释并按你的网络填写:
# Environment=HTTP_PROXY=http://127.0.0.1:7890
# Environment=HTTPS_PROXY=http://127.0.0.1:7890
Environment=NO_PROXY=localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now mihomo-node-tool
```

容器内 collector 通过环境变量 `NODE_TOOL_URL`(默认 http://172.17.0.1:8008) 访问它。
