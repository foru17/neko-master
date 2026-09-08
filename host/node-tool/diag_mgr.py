#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
diag_mgr.py — mihomo-node-tool 诊断/运维扩展模块
- 出口信息(当前节点 + 公网 IP/地区)
- 全节点/组延迟测速
- 规则追踪(真实请求某域名, 看命中哪条规则、走哪个策略链)
- 活动连接列表 / 断开连接
- 配置备份列表 / 一键回滚
- 完整配置读取(secret 打码) / 保存(备份->校验->重载, 失败回滚)
仅依赖: python3 标准库 + pyyaml
"""
import json
import os
import re
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

CONFIG_PATH = os.environ.get("MIHOMO_CONFIG", "/root/.config/mihomo/config.yaml")
BACKUP_DIR = os.path.join(os.path.dirname(CONFIG_PATH), "backups")
API_BASE = os.environ.get("MIHOMO_API", "http://127.0.0.1:9090")
PROXY_URL = os.environ.get("MIHOMO_PROXY", "http://127.0.0.1:7890")
SPEED_URL = os.environ.get("SPEED_URL", "https://www.gstatic.com/generate_204")
MAX_BACKUPS = 30


# ---------- 基础 ----------
def _load_cfg():
    import yaml
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _secret():
    try:
        return _load_cfg().get("secret")
    except Exception:
        return None


def mihomo_api(method, path, body=None, secret=None, timeout=12):
    url = API_BASE.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if secret:
        req.add_header("Authorization", "Bearer " + secret)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw[:200]}
    except Exception as e:
        return 0, {"error": str(e)}


def _backup():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    dst = os.path.join(BACKUP_DIR, f"config-{ts}.yaml")
    shutil.copy2(CONFIG_PATH, dst)
    try:
        bks = sorted(os.listdir(BACKUP_DIR))
        for old in bks[:-MAX_BACKUPS]:
            os.remove(os.path.join(BACKUP_DIR, old))
    except Exception:
        pass
    return dst


def _test_config():
    try:
        r = subprocess.run(["mihomo", "-t", "-f", CONFIG_PATH],
                           capture_output=True, text=True, timeout=40)
        return r.returncode, (r.stdout + r.stderr).strip()[-400:]
    except Exception as e:
        return 1, str(e)


def _reload():
    try:
        r = subprocess.run(["systemctl", "reload", "mihomo"],
                           capture_output=True, text=True, timeout=15)
        if r.returncode == 0:
            return "systemctl reload mihomo"
    except Exception:
        pass
    try:
        out = subprocess.run(["pgrep", "-x", "mihomo"], capture_output=True,
                             text=True, timeout=10).stdout.split()
        for pid in out:
            os.kill(int(pid), 1)
        return f"SIGHUP to {len(out)} mihomo process(es)"
    except Exception as e:
        raise RuntimeError(f"热加载失败: {e}")


def _save_cfg_text(content):
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, CONFIG_PATH)


def _names(kind):
    """kind=proxies|proxy-groups -> [names]"""
    cfg = _load_cfg()
    return [x.get("name") for x in (cfg.get(kind) or []) if x.get("name")]


# ---------- 出口信息 ----------
def egress_info():
    sec = _secret()
    # 当前主组选择(第一个 include-all 的 select 组近似为主组, 直接查全部组太贵 ->
    # 从 /proxies 拿 Selector 且名字带默认代理的; 退化为列出所有含节点的组)
    main_group = None
    main_now = None
    groups = _names("proxy-groups")
    for g in groups:
        if "默认代理" in g or "代理" in g:
            code, d = mihomo_api("GET", "/proxies/" + urllib.parse.quote(g, safe=""), secret=sec)
            if code == 200:
                main_group, main_now = g, d.get("now")
                break
    # 公网出口(走代理)
    ip = region = org = None
    egress_err = None
    try:
        with urllib.request.urlopen(
                urllib.request.Request("https://ipinfo.io/json",
                                       headers={"User-Agent": "curl/8"}), timeout=10) as r:
            d = json.loads(r.read().decode())
        ip = d.get("ip")
        loc = d.get("city") or ""
        if d.get("region"):
            loc += (", " if loc else "") + d["region"]
        if d.get("country"):
            loc += (", " if loc else "") + d["country"]
        region = loc
        org = d.get("org")
    except Exception as e:
        # 走代理失败时回退: 尝试通过 mihomo 代理端口 curl
        egress_err = str(e)[:150]
        try:
            r = subprocess.run(
                ["curl", "-s", "-m", "10", "-x", PROXY_URL, "https://ipinfo.io/json"],
                capture_output=True, text=True, timeout=15)
            if r.returncode == 0 and r.stdout.strip():
                d = json.loads(r.stdout)
                ip = d.get("ip")
                region = ", ".join(x for x in [d.get("city"), d.get("region"), d.get("country")] if x)
                org = d.get("org")
                egress_err = None
        except Exception as e2:
            egress_err = str(e2)[:150]
    # 直连出口(对照)
    direct_ip = None
    try:
        r = subprocess.run(["curl", "-s", "-m", "8", "https://ipinfo.io/json"],
                           capture_output=True, text=True, timeout=12)
        if r.returncode == 0 and r.stdout.strip():
            direct_ip = json.loads(r.stdout).get("ip")
    except Exception:
        pass
    return {
        "main_group": main_group,
        "main_now": main_now,
        "proxy_ip": ip,
        "proxy_region": region,
        "proxy_org": org,
        "direct_ip": direct_ip,
        "egress_error": egress_err,
        "groups": groups,
    }


# ---------- 延迟测速 ----------
def speedtest(targets=None):
    """targets=None 表示全部 proxy + 全部组; 返回 [{name, type, delay_ms|error}]"""
    sec = _secret()
    proxies = _names("proxies")
    groups = _names("proxy-groups")
    all_names = []
    meta = {}
    for p in proxies:
        all_names.append(p)
        meta[p] = "proxy"
    for g in groups:
        all_names.append(g)
        meta[g] = "group"

    if targets:
        wanted = set(targets)
        all_names = [n for n in all_names if n in wanted]
    if not all_names:
        return {"results": [], "note": "无节点/组可测"}

    def test_one(name):
        path = "/proxies/" + urllib.parse.quote(name, safe="") + "/delay?url=" + \
            urllib.parse.quote(SPEED_URL, safe="") + "&timeout=3000"
        code, d = mihomo_api("GET", path, secret=sec, timeout=8)
        if code == 200 and isinstance(d, dict) and d.get("delay") is not None:
            return {"name": name, "type": meta[name], "delay_ms": d["delay"]}
        return {"name": name, "type": meta[name], "error": (d.get("error") if isinstance(d, dict) else str(d)) or f"HTTP {code}"}

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(test_one, all_names))
    results.sort(key=lambda x: (x.get("delay_ms") is None, x.get("delay_ms") or 10**9))
    return {"results": results, "url": SPEED_URL}


# ---------- 规则追踪 ----------
def trace_domain(domain):
    """真实请求该域名(走代理), 观察 mihomo 连接记录确认命中规则/策略链"""
    sec = _secret()
    domain = (domain or "").strip().lower()
    if not domain or not re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", domain):
        return {"error": f"域名格式不正确: {domain}"}
    if not domain.startswith(("http://", "https://")):
        url = "https://" + domain
    # 后台慢速请求保持连接(限速), 期间轮询 connections
    proc = subprocess.Popen(
        ["curl", "-s", "-m", "12", "--limit-rate", "20k", "-o", "/dev/null",
         "-x", PROXY_URL, url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 11
        while time.time() < deadline:
            time.sleep(1.0)
            code, d = mihomo_api("GET", "/connections", secret=sec, timeout=5)
            if code != 200:
                continue
            for c in (d.get("connections") or []):
                md = c.get("metadata") or {}
                host = (md.get("host") or "").lower()
                if host == domain or (host and domain in host) or \
                        md.get("destinationIP") == domain or domain in host:
                    return {
                        "domain": domain,
                        "found": True,
                        "rule": c.get("rule") or "(直连/未匹配规则)",
                        "rule_payload": c.get("rulePayload") or "",
                        "chains": c.get("chains") or [],
                        "process": md.get("process") or "",
                        "network": md.get("network") or "",
                        "type": md.get("type") or "",
                    }
    finally:
        try:
            proc.kill()
        except Exception:
            pass
    return {"domain": domain, "found": False,
            "error": "10s 内未在活动连接中看到该域名——可能已被规则直连(DIRECT 不走代理)或域名不可达",
            "hint": "可到「运维中心-连接」查看当前活动连接确认"}


# ---------- 连接管理 ----------
def list_connections(limit=100):
    sec = _secret()
    code, d = mihomo_api("GET", "/connections", secret=sec, timeout=6)
    if code != 200:
        return {"error": f"HTTP {code}: {d}"}
    conns = d.get("connections") or []
    out = []
    for c in conns:
        md = c.get("metadata") or {}
        out.append({
            "id": c.get("id", ""),
            "host": md.get("host") or md.get("destinationIP") or "",
            "dest_ip": md.get("destinationIP") or "",
            "source_ip": md.get("sourceIP") or "",
            "source_port": md.get("sourcePort") or "",
            "process": md.get("process") or "",
            "network": md.get("network") or "",
            "type": md.get("type") or "",
            "rule": c.get("rule") or "",
            "rule_payload": c.get("rulePayload") or "",
            "chains": c.get("chains") or [],
            "upload": c.get("upload") or 0,
            "download": c.get("download") or 0,
            "start": c.get("start") or 0,
        })
    out.sort(key=lambda x: x["start"], reverse=True)
    return {"total": len(out), "connections": out[:limit]}


def close_connection(cid):
    sec = _secret()
    code, d = mihomo_api("DELETE", "/connections/" + urllib.parse.quote(cid, safe=""), secret=sec)
    if code in (204, 200):
        return {"ok": True, "closed": cid}
    return {"error": f"断开失败 HTTP {code}: {d}"}


def close_all():
    sec = _secret()
    code, d = mihomo_api("DELETE", "/connections", secret=sec)
    if code in (204, 200):
        return {"ok": True, "message": "已断开全部连接"}
    return {"error": f"HTTP {code}: {d}"}


# ---------- 备份/回滚 ----------
def list_backups():
    if not os.path.isdir(BACKUP_DIR):
        return {"backups": []}
    out = []
    for fn in sorted(os.listdir(BACKUP_DIR), reverse=True):
        fp = os.path.join(BACKUP_DIR, fn)
        if os.path.isfile(fp) and fn.endswith(".yaml"):
            st = os.stat(fp)
            out.append({"file": fn, "size": st.st_size,
                        "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime))})
    return {"backups": out, "dir": BACKUP_DIR}


def restore_backup(file):
    """回滚: 备份当前 -> 用备份文件覆盖 -> mihomo -t 校验 -> 重载; 失败恢复现场"""
    fp = os.path.join(BACKUP_DIR, os.path.basename(file or ""))
    if not os.path.isfile(fp):
        raise ValueError(f"备份文件不存在: {file}")
    cur_bk = _backup()  # 当前现场备份
    shutil.copy2(fp, CONFIG_PATH)
    code, out = _test_config()
    if code != 0:
        shutil.copy2(cur_bk, CONFIG_PATH)
        raise RuntimeError(f"⚠️ 该备份校验未通过，已保持原配置\nmihomo: {out}")
    how = _reload()
    return {"ok": True, "restored": os.path.basename(file),
            "safety_backup": os.path.basename(cur_bk), "reload": how}


# ---------- 完整配置读写 ----------
SECRET_RE = re.compile(r"^(\s*secret\s*:\s*)(\"[^\"]*\"|'[^']*'|[^\s#]+)", re.M)
MASKED = "********"


def read_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        text = f.read()

    def _mask(m):
        return m.group(1) + '"' + MASKED + '"'
    redacted = SECRET_RE.sub(_mask, text)
    return {"content": redacted, "secret_masked": redacted != text,
            "path": CONFIG_PATH, "size": os.path.getsize(CONFIG_PATH)}


def _restore_secret(content, orig_secret):
    """把打码的 secret 占位还原为真实值; 若用户显式写了新值则保留新值"""
    if not orig_secret:
        return content
    pat = re.compile(r"^(\s*secret\s*:\s*)\"?\*{4,}\"?", re.M)

    def _unmask(m):
        return m.group(1) + orig_secret
    return pat.sub(_unmask, content)


def write_config(content):
    """保存完整配置: 还原被 mask 的 secret -> 备份 -> 写入 -> 校验 -> 重载"""
    if not content or not content.strip():
        raise ValueError("配置内容为空")
    # 从当前配置取真实 secret 先还原, 再整体做 YAML 校验
    import yaml
    cur_text = open(CONFIG_PATH, "r", encoding="utf-8").read()
    try:
        orig_secret = yaml.safe_load(cur_text).get("secret")
    except Exception:
        orig_secret = None
    content = _restore_secret(content, orig_secret)
    try:
        parsed = yaml.safe_load(content)
        if not isinstance(parsed, dict):
            raise ValueError("配置必须是一个 YAML 映射")
        for need in ("proxies", "rules"):
            if need not in parsed:
                raise ValueError(f"配置缺少关键字段: {need}（可能是空配置，已拒绝保存）")
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"YAML 解析失败: {e}")

    bk = _backup()
    _save_cfg_text(content)
    code, out = _test_config()
    if code != 0:
        shutil.copy2(bk, CONFIG_PATH)
        raise RuntimeError(f"⚠️ 配置校验未通过，已自动回滚\nmihomo: {out}")
    how = _reload()
    return {"ok": True, "backup": os.path.basename(bk), "reload": how,
            "message": "配置已保存并热加载"}


if __name__ == "__main__":
    # 快速自测
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "egress":
        print(json.dumps(egress_info(), ensure_ascii=False, indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] == "speed":
        print(json.dumps(speedtest(), ensure_ascii=False, indent=2)[:2000])
    elif len(sys.argv) > 2 and sys.argv[1] == "trace":
        print(json.dumps(trace_domain(sys.argv[2]), ensure_ascii=False, indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] == "conns":
        print(json.dumps(list_connections(20), ensure_ascii=False, indent=2)[:2000])
