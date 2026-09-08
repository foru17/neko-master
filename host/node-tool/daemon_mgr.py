#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
daemon_mgr.py — mihomo/clash 服务端生命周期管理（宿主执行器）
install / update / start / restart / stop / uninstall / status

原则:
- 一律通过 systemd unit 管理（不存在则按模板创建）
- 二进制替换前自动备份到 <engine>_backups/
- 卸载默认保留配置(purge=false)；purge=true 时连配置目录一起备份后删除
- 下载优先走环境变量代理 (HTTP_PROXY/HTTPS_PROXY)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request

BASE = "/usr/local/lib/neko-host-tool"
BACKUP_ROOT = os.environ.get("DAEMON_BACKUP_DIR", "/var/lib/neko-host-tool/backups")

_lock = threading.Lock()

# ---------------- 引擎注册表 ----------------
def _ver_str(path):
    """从二进制 -v 输出提取版本号"""
    try:
        out = subprocess.run([path, "-v"], capture_output=True, text=True, timeout=10)
        m = re.search(r"v?\d+\.\d+\.\d+", out.stdout or out.stderr or "")
        return m.group(0) if m else (out.stdout or out.stderr or "").strip()[:40]
    except Exception:
        return ""

def _systemctl(args):
    r = subprocess.run(["systemctl"] + args, capture_output=True, text=True, timeout=30)
    return r.returncode, (r.stdout + r.stderr).strip()

def _unit_state(unit):
    """返回: (exists_in_fs, is_active, is_enabled)"""
    fs = (os.path.exists(f"/etc/systemd/system/{unit}.service")
          or os.path.exists(f"/lib/systemd/system/{unit}.service")
          or os.path.exists(f"/usr/lib/systemd/system/{unit}.service"))
    _, active = _systemctl(["is-active", unit])
    _, enabled = _systemctl(["is-enabled", unit])
    return fs, active.strip() == "active", enabled.strip() == "enabled"

class Engine:
    def __init__(self, key, name, bin_path, unit, config_dir, run_args,
                 default_url=None, version_cmd=None):
        self.key = key
        self.name = name
        self.bin = bin_path
        self.unit = unit
        self.config_dir = config_dir
        self.run_args = run_args          # list 追加在 ExecStart 后, 如 ["-d", "/root/.config/mihomo"]
        self.default_url = default_url
        self.version_cmd = version_cmd or ["-v"]

    # ---- 检测 ----
    def detect(self):
        installed = os.path.exists(self.bin)
        unit_fs, active, enabled = _unit_state(self.unit)
        return {
            "engine": self.key,
            "name": self.name,
            "installed": installed,
            "version": _ver_str(self.bin) if installed else "",
            "bin": self.bin,
            "config_dir": self.config_dir,
            "unit_exists": unit_fs,
            "running": active,
            "autostart": enabled,
        }

    # ---- systemd ----
    def _start(self): return _systemctl(["start", self.unit])
    def _stop(self):  return _systemctl(["stop", self.unit])
    def _restart(self): return _systemctl(["restart", self.unit])

    def ensure_unit(self):
        """确保 systemd unit 存在且 ExecStart 与预期一致。
        注意: dpkg 升级可能覆盖 /lib 下的 unit (例如 mihomo deb 默认 -d /etc/mihomo)，
        若 ExecStart 不匹配则备份并重写为受管模板，避免重启后加载错误配置。"""
        unit_path = f"/etc/systemd/system/{self.unit}.service"
        exe = " ".join([self.bin] + self.run_args)
        expected_exec = f"ExecStart={exe}"
        if os.path.exists(unit_path):
            with open(unit_path) as f:
                content = f.read()
            if expected_exec in content:
                return
            # 备份被外部工具覆盖的 unit
            bak = os.path.join(BACKUP_ROOT, f"{self.key}-unit-{time.strftime('%Y%m%d-%H%M%S')}.service")
            os.makedirs(BACKUP_ROOT, exist_ok=True)
            shutil.copy2(unit_path, bak)
            print(f"[daemon_mgr] unit ExecStart 不匹配，已备份旧 unit 至 {bak}")
        unit = f"""[Unit]
Description={self.name} Daemon (managed by neko-host-tool)
After=network.target

[Service]
Type=simple
ExecStart={exe}
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
"""
        with open(unit_path, "w") as f:
            f.write(unit)
        _systemctl(["daemon-reload"])

    def _backup_bin(self):
        os.makedirs(BACKUP_ROOT, exist_ok=True)
        if not os.path.exists(self.bin):
            return None
        dst = os.path.join(BACKUP_ROOT, f"{self.key}-bin-{time.strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(self.bin, dst)
        return dst

    # ---- 下载/安装 ----
    def _resolve_download_url(self, url):
        if url:
            return url
        if self.key == "mihomo":
            # 动态解析 MetaCubeX/mihomo 最新 release 的 amd64 gz 资产
            api = "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest"
            req = urllib.request.Request(api, headers={"User-Agent": "neko-host-tool/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                rel = json.load(r)
            tag = rel.get("tag_name", "")  # e.g. v1.19.30
            assets = [a.get("browser_download_url", "") for a in rel.get("assets", [])]
            for pat in (f"mihomo-linux-amd64-v1-{tag}.gz",
                        f"mihomo-linux-amd64-{tag}.gz"):
                for a in assets:
                    if a.endswith(pat):
                        return a
            for a in assets:
                if "linux-amd64" in a and a.endswith(".gz") \
                        and "-v2-" not in a and "-v3-" not in a:
                    return a
            raise RuntimeError("未能在 mihomo 最新 release 中找到 amd64 .gz 资产")
        if self.default_url:
            return self.default_url
        raise RuntimeError(f"{self.name}: 未提供下载地址且无默认地址")

    def _download(self, url):
        url = self._resolve_download_url(url)
        tmp = tempfile.mkdtemp(prefix="neko-dl-")
        target = os.path.join(tmp, "binary")
        req = urllib.request.Request(url, headers={"User-Agent": "neko-host-tool/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        if url.endswith(".gz") or data[:2] == b"\x1f\x8b":
            import gzip
            data = gzip.decompress(data)
        elif url.endswith(".tar.gz") or data[:2] == b"\x1f\x8b":
            tarpath = os.path.join(tmp, "pkg.tar.gz")
            with open(tarpath, "wb") as f:
                f.write(data)
            with tarfile.open(tarpath, "r:gz") as tf:
                member = next((m for m in tf.getmembers()
                               if m.isfile() and os.path.basename(m.name) == self.key), None)
                if member is None:
                    raise RuntimeError("压缩包内未找到可执行文件")
                f = tf.extractfile(member)
                data = f.read() if f else b""
        elif url.endswith(".deb") or url.endswith(".deb?"):
            dpath = os.path.join(tmp, "pkg.deb")
            with open(dpath, "wb") as f:
                f.write(data)
            r = subprocess.run(["dpkg", "-i", dpath], capture_output=True, text=True, timeout=120)
            if r.returncode != 0:
                raise RuntimeError(f"dpkg 安装失败: {r.stderr[-300:]}")
            os.path.dirname(self.bin) and os.makedirs(os.path.dirname(self.bin), exist_ok=True)
            return  # dpkg 已放置二进制
        with open(target, "wb") as f:
            f.write(data)
        os.chmod(target, 0o755)
        # 验证能执行
        try:
            subprocess.run([target] + self.version_cmd, capture_output=True, timeout=10)
        except Exception as e:
            raise RuntimeError(f"下载的二进制无法执行: {e}")
        bak = self._backup_bin()
        os.makedirs(os.path.dirname(self.bin), exist_ok=True)
        shutil.move(target, self.bin)
        os.chmod(self.bin, 0o755)
        shutil.rmtree(tmp, ignore_errors=True)
        if bak:
            return bak
        return None

    def install(self, url=None, autostart=True):
        bak = self._download(url)
        self.ensure_unit()
        if autostart:
            _systemctl(["enable", self.unit])
        code, msg = _systemctl(["start", self.unit])
        # 启动失败但 unit 已装好时不算致命（可能配置缺失），如实报告
        return {
            "ok": code == 0 or True,
            "engine": self.key,
            "action": "install",
            "version": _ver_str(self.bin),
            "backup": bak,
            "started": code == 0,
            "start_msg": msg if code != 0 else "started",
        }

    def update(self, url=None):
        return self.install(url=url, autostart=True)

    def start(self):
        code, msg = _systemctl(["start", self.unit])
        return {"ok": code == 0, "engine": self.key, "action": "start", "message": msg}

    def stop(self):
        code, msg = _systemctl(["stop", self.unit])
        return {"ok": code == 0, "engine": self.key, "action": "stop", "message": msg}

    def restart(self):
        code, msg = _systemctl(["restart", self.unit])
        return {"ok": code == 0, "engine": self.key, "action": "restart", "message": msg}

    def uninstall(self, purge=False):
        msgs = []
        _systemctl(["stop", self.unit])
        _systemctl(["disable", self.unit])
        msgs.append("unit stopped & disabled")
        unit_path = f"/etc/systemd/system/{self.unit}.service"
        if os.path.exists(unit_path):
            os.remove(unit_path)
            _systemctl(["daemon-reload"])
            msgs.append("unit file removed")
        bak = self._backup_bin()
        if os.path.exists(self.bin):
            os.remove(self.bin)
            msgs.append("binary removed")
        if purge and os.path.isdir(self.config_dir):
            dst = os.path.join(BACKUP_ROOT, f"{self.key}-config-{time.strftime('%Y%m%d-%H%M%S')}")
            shutil.move(self.config_dir, dst)
            msgs.append(f"config dir moved to backup: {dst}")
        return {"ok": True, "engine": self.key, "action": "uninstall",
                "purge": purge, "binary_backup": bak, "messages": msgs}


ENGINES = {
    "mihomo": Engine(
        key="mihomo", name="mihomo", bin_path="/usr/bin/mihomo",
        unit="mihomo", config_dir="/root/.config/mihomo",
        run_args=["-d", "/root/.config/mihomo"],
        default_url="https://github.com/MetaCubeX/mihomo/releases/latest/download/mihomo-linux-amd64-v1.gz",
    ),
    "clash": Engine(
        key="clash", name="clash", bin_path="/usr/local/bin/clash",
        unit="clash", config_dir="/etc/clash",
        run_args=["-d", "/etc/clash"],
        default_url="https://github.com/Dreamacro/clash/releases/download/v1.18.0/clash-linux-amd64-v1.18.0.gz",
    ),
}


def run_action(action, payload):
    """actions: status|install|update|start|restart|stop|uninstall"""
    with _lock:
        engine_key = (payload.get("engine") or "mihomo").lower()
        if engine_key not in ENGINES:
            return {"error": f"不支持的引擎: {engine_key} (可选: {list(ENGINES)})"}
        eng = ENGINES[engine_key]

        if action == "status":
            return {"ok": True, "status": eng.detect()}

        if action in ("start", "stop", "restart"):
            return eng.start() if action == "start" else (eng.stop() if action == "stop" else eng.restart())

        if action in ("install", "update"):
            return eng.install(url=payload.get("url") or None)

        if action == "uninstall":
            if not payload.get("confirm"):
                return {"error": "卸载需要 confirm: true（此操作不可逆，但二进制与配置会先备份）"}
            return eng.uninstall(purge=bool(payload.get("purge")))

        return {"error": f"未知操作: {action}"}


def status_all():
    return {"ok": True, "engines": [e.detect() for e in ENGINES.values()]}
