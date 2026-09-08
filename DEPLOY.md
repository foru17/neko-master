# Neko Host Stack — 一键部署脚本

部署 **Neko Master 面板（含节点管理/服务端管理扩展）+ 宿主执行器** 到一台新的 Linux (x86_64) 机器上。

## 架构

```
浏览器 ──► Neko Master 面板 (Docker, :3000)  ←— 流量/节点/服务端 三个视角
                │  /api/nt/*   (collector 代理, 带面板登录鉴权)
                ▼
        宿主执行器 node-tool (:8008, python, systemd)
                │  写 mihomo 配置 / systemctl 操作
                ▼
        mihomo / clash (systemd, TUN + 分流)
```

- 面板容器通过 `host.docker.internal` 访问宿主机（`extra_hosts: host-gateway`，重建容器不失效）
- 容器无法直接改宿主配置，所以重活全在宿主执行器，面板只做 UI + 鉴权代理

## 快速开始（推荐）

```bash
# 0) 前置: x86_64 Linux + root + docker (无 docker 时脚本会提示安装)
# 1) 克隆仓库 (含本部署目录)
git clone https://github.com/A1me7n/neko-master.git && cd neko-master

# 2) 一键部署 (自动探测已装 mihomo; 构建面板镜像; 起服务)
bash deploy/setup.sh

# 3) 面板初始化: 设置登录密钥 + 添加 mihomo 后端 (见下文)
```

装完输出访问地址与初始化指引。

## 手动步骤速览（脚本等价内容）

```bash
# 1. 宿主执行器 (node-tool)
apt-get install -y python3-yaml
install -d /opt/mihomo-node-tool
cp host/node-tool/{server.py,node_parser.py,daemon_mgr.py,index.html} /opt/mihomo-node-tool/
cp deploy/mihomo-node-tool.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mihomo-node-tool
# 2. 面板 (自定义镜像)
install -d /opt/neko-master && cd /opt/neko-master
cp <repo>/deploy/docker-compose.host.yml docker-compose.yml
echo "COOKIE_SECRET=$(openssl rand -hex 32)" > .env
docker build -t neko-master:custom <repo目录>
docker compose up -d
```

## 面板初始化（首次）

```bash
# 设置登录密钥 (需同时含字母和数字, ≥6位)
curl -s -X POST http://127.0.0.1:3000/api/auth/enable \
  -H "Content-Type: application/json" -d '{"token":"YourToken2026"}'

# 添加 mihomo 后端 (secret 取自 mihomo 配置里的 external-controller secret)
curl -s -c /tmp/cj -X POST http://127.0.0.1:3000/api/auth/verify \
  -H "Content-Type: application/json" -d '{"token":"YourToken2026"}'
curl -s -b /tmp/cj -X POST http://127.0.0.1:3000/api/backends \
  -H "Content-Type: application/json" \
  -d '{"name":"mihomo本地","url":"http://host.docker.internal:9090","token":"<SECRET>","type":"clash"}'
```

浏览器打开 `http://<host>:3000`，密钥登录后左侧即可看到：概览/…/⚡节点/⚙️服务端。

## 常用操作

| 操作 | 命令 |
|---|---|
| 查看服务 | `systemctl status mihomo-node-tool` / `docker ps` |
| 更新面板代码并重建 | `cd /root/neko-build && git pull && docker build -t neko-master:custom . && cd /opt/neko-master && docker compose up -d` |
| 回滚面板 | 官方镜像仍在: 改 compose `image: foru17/neko-master:latest` 后 `docker compose up -d` |
| 备份 | mihomo 配置: `/root/.config/mihomo/backups/`; 执行器: `/var/lib/neko-host-tool/backups/`; 面板数据: `/opt/neko-master/data/` |

## 故障排查

| 现象 | 原因/处理 |
|---|---|
| 面板「后端连接异常」 | ① mihomo 是否监听 9090 (`ss -tlnp\|grep 9090`)；② dpkg 升级会覆盖 mihomo 的 systemd unit 使其用 `/etc/mihomo` 空配置启动 → `daemon_mgr` 的 start/restart 会自动修复（校验 ExecStart），或手动重写 `/etc/systemd/system/mihomo.service` 为 `ExecStart=/usr/bin/mihomo -d /root/.config/mihomo` |
| 容器内连不上宿主机 | compose 已带 `extra_hosts: host.docker.internal:host-gateway`，后端 URL 请使用 `http://host.docker.internal:9090`（不要写死 172.x 网关 IP，重建网络会变） |
| GitHub 下载慢/失败 | 给执行器 systemd unit 配 `HTTP_PROXY/HTTPS_PROXY`；或者直接用本机 mihomo 的 7890 混合端口做代理 |
