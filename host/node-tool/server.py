#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mihomo-node-tool server — Web 界面热更新自建节点到 mihomo
- 粘贴节点链接(单/多) -> 解析 -> 写入 mihomo config proxies 段
- systemctl reload mihomo 热加载（不重启进程）
- 通过 mihomo RESTful API 在「🚀 默认代理」组中自动选中新节点 -> 立即生效
仅依赖: python3 标准库 + pyyaml
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import yaml
except ImportError:
    sys.stderr.write("缺少 pyyaml: apt-get install -y python3-yaml\n")
    sys.exit(1)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from node_parser import parse_node_link, parse_multi
from daemon_mgr import run_action as daemon_run_action, status_all as daemon_status_all
import diag_mgr

CONFIG_PATH = os.environ.get("MIHOMO_CONFIG", "/root/.config/mihomo/config.yaml")
BACKUP_DIR = os.path.join(os.path.dirname(CONFIG_PATH), "backups")
API_BASE = os.environ.get("MIHOMO_API", "http://127.0.0.1:9090")
MAIN_GROUP = os.environ.get("MAIN_GROUP", "🚀 默认代理")
PORT = int(os.environ.get("TOOL_PORT", "8008"))
MAX_BACKUPS = 30

BUILTIN_TYPES = ("direct", "reject", "compatible", "pass")


# ---------- mihomo REST API ----------
def mihomo_api(method, path, body=None, secret=None, timeout=8):
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


def read_secret(cfg):
    return cfg.get("secret")


def current_selection(secret):
    code, data = mihomo_api("GET", "/proxies/" + urllib.parse.quote(MAIN_GROUP, safe=""), secret=secret)
    if code == 200 and isinstance(data, dict):
        return data.get("now"), data.get("all", [])
    return None, []


def select_node(name, secret, group=MAIN_GROUP):
    """mihomo API: PUT /proxies/{组名}  body={"name": 节点名}"""
    code, data = mihomo_api("PUT", "/proxies/" + urllib.parse.quote(group, safe=""),
                            body={"name": name}, secret=secret)
    return code, data


def select_node_verified(name, secret, retries=5, delay=0.8):
    """选中节点并校验，mihomo 重载后可能异步恢复缓存选中，需重试确保生效"""
    last_now = None
    for _ in range(retries):
        try:
            select_node(name, secret)
        except Exception:
            pass
        time.sleep(delay)
        last_now, _ = current_selection(secret)
        if last_now == name:
            return True, f"已选中: {name}"
    return False, f"选中未生效(当前: {last_now})，可稍后在页面上手动选择"


def mihomo_health():
    cfg = load_cfg(silent=True)
    secret = read_secret(cfg) if cfg else None
    code, data = mihomo_api("GET", "/version", secret=secret)
    if code == 200:
        return True, data.get("version", "?")
    return False, data.get("error", f"HTTP {code}")


# ---------- 配置读写 ----------
def load_cfg(silent=False):
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        if not silent:
            raise RuntimeError(f"读取配置失败: {e}")
        return None


def backup_cfg():
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


def save_cfg(cfg):
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False,
                       default_flow_style=False, width=4096)
    os.replace(tmp, CONFIG_PATH)


def reload_mihomo():
    """热加载: 优先 systemctl reload, 退回 SIGHUP"""
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
            os.kill(int(pid), 1)  # SIGHUP
        return f"SIGHUP to {len(out)} mihomo process(es)"
    except Exception as e:
        raise RuntimeError(f"热加载失败: {e}")


def wait_proxy_visible(name, secret, timeout=8):
    """等待节点出现在主组（include-all 生效）"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        now, opts = current_selection(secret)
        if opts and name in opts:
            return True
        time.sleep(0.4)
    return False


# ---------- 节点操作 ----------
def list_nodes():
    cfg = load_cfg()
    nodes = []
    for p in cfg.get("proxies") or []:
        if p.get("type") in BUILTIN_TYPES and p.get("type") != "direct":
            continue
        nodes.append({
            "name": p.get("name"),
            "type": p.get("type"),
            "server": p.get("server", ""),
            "port": p.get("port", ""),
        })
    return nodes


def add_nodes(texts, auto_select=True):
    """texts: [raw link...] -> (added:[dict], errors:[str])"""
    added, errs = [], []
    cfg = load_cfg()
    secret = read_secret(cfg)
    proxies = cfg.setdefault("proxies", [])
    by_name = {p.get("name"): p for p in proxies if p.get("name")}

    for t in texts:
        t = t.strip()
        if not t or t.startswith("#"):
            continue
        try:
            proxy = parse_node_link(t)
        except Exception as e:
            errs.append(str(e))
            continue
        name = proxy["name"]
        if name in by_name:
            idx = proxies.index(by_name[name])
            proxies[idx] = proxy  # 同名覆盖更新
        else:
            proxies.append(proxy)
            by_name[name] = proxy
        added.append({"name": name, "type": proxy["type"],
                      "server": proxy.get("server"), "port": proxy.get("port")})

    if not added:
        return [], errs, None

    bk = backup_cfg()
    save_cfg(cfg)
    how = reload_mihomo()
    visible = wait_proxy_visible(added[-1]["name"], secret)

    sel_msg = None
    if auto_select and visible:
        ok, sel_msg = select_node_verified(added[-1]["name"], secret)
        if not ok:
            sel_msg = "⚠️ " + sel_msg
    elif auto_select and not visible:
        sel_msg = "节点已写入，但未在主组可见（等待中，可手动在面板选择）"

    return added, errs, {"backup": bk, "reload": how,
                         "visible": visible, "select": sel_msg}


def delete_node(name):
    cfg = load_cfg()
    secret = read_secret(cfg)
    proxies = cfg.get("proxies") or []
    target = next((p for p in proxies if p.get("name") == name), None)
    if not target:
        return {"error": f"未找到节点: {name}"}

    # 记录删除前主组选中，用于恢复
    prev_now, _ = current_selection(secret)

    cfg["proxies"] = [p for p in proxies if p.get("name") != name]
    bk = backup_cfg()
    save_cfg(cfg)
    how = reload_mihomo()

    # 若删除的是当前选中 -> 切回原选中或第一个可用项
    if prev_now == name:
        code, data = mihomo_api("GET", "/proxies/" + urllib.parse.quote(MAIN_GROUP, safe=""),
                                secret=secret)
        opts = (data.get("all") or []) if code == 200 else []
        fallback = next((o for o in opts if o != name and o != "REJECT"), None) or "直连"
        try:
            select_node_verified(fallback, secret)
        except Exception:
            pass
    return {"ok": True, "backup": bk, "reload": how}


def switch_selection(group, name):
    ok, msg = select_node_verified(name, read_secret(load_cfg()))
    if ok:
        return {"ok": True, "group": group, "now": name}
    return {"error": msg}


# ---------- 规则管理 ----------
RULE_TYPES = [
    "DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "DOMAIN-REGEX",
    "GEOIP", "GEOSITE", "IP-CIDR", "IP-CIDR6", "PROCESS-NAME", "RULE-SET",
]
NO_RESOLVE_TYPES = ("IP-CIDR", "IP-CIDR6", "GEOIP")


def rule_targets():
    """规则可指向的目标: 策略组 + 节点 + 内置出口"""
    cfg = load_cfg(silent=True) or {}
    names = [g.get("name") for g in cfg.get("proxy-groups") or [] if g.get("name")]
    names += [p.get("name") for p in cfg.get("proxies") or [] if p.get("name")]
    for extra in ("DIRECT", "REJECT"):
        if extra not in names:
            names.append(extra)
    return names


def get_rules():
    cfg = load_cfg()
    return list(cfg.get("rules") or [])


def validate_rule_text(text):
    text = (text or "").strip()
    if not text:
        raise ValueError("规则不能为空")
    parts = [p.strip() for p in text.split(",")]
    head = parts[0].upper()
    if head == "MATCH":
        if len(parts) < 2:
            raise ValueError("MATCH 规则需要目标: MATCH,策略组")
        return text
    if head not in RULE_TYPES:
        raise ValueError(f"未知规则类型「{parts[0]}」，支持: {', '.join(RULE_TYPES)}")
    if head == "RULE-SET":
        if len(parts) < 2:
            raise ValueError("RULE-SET 需要规则集名: RULE-SET,规则集名,目标")
        rps = (load_cfg(silent=True) or {}).get("rule-providers") or {}
        if parts[1] not in rps:
            names = sorted(rps.keys())
            raise ValueError(f"规则集「{parts[1]}」不存在——可用规则集: {', '.join(names[:8])}{'…' if len(names) > 8 else ''}（也可在「规则集」卡片新建本地规则集）")
        if len(parts) < 3:
            raise ValueError("RULE-SET 需要目标: RULE-SET,规则集名,策略组/节点")
        policy = parts[2]
        if policy not in rule_targets():
            raise ValueError(f"目标「{policy}」不存在——可选: {', '.join(rule_targets()[:10])}…")
        return text
    if len(parts) < 3:
        raise ValueError("规则至少 3 段: 类型,匹配值,目标 (例: DOMAIN-SUFFIX,example.com,🚀 默认代理)")
    policy = parts[2]
    if policy not in rule_targets():
        raise ValueError(f"目标「{policy}」不存在——可选: {', '.join(rule_targets()[:10])}…")
    if head in NO_RESOLVE_TYPES:
        for extra in parts[3:]:
            if extra != "no-resolve":
                raise ValueError(f"多余参数「{extra}」: {head} 规则只允许追加 no-resolve")
    return text


def _is_match(r):
    return str(r).strip().upper().startswith("MATCH")


def _match_idx(rules):
    for i, r in enumerate(rules):
        if _is_match(r):
            return i
    return None


def test_config():
    """mihomo -t 校验配置合法性 -> (code, output)"""
    try:
        r = subprocess.run(["mihomo", "-t", "-f", CONFIG_PATH],
                           capture_output=True, text=True, timeout=40)
        return r.returncode, (r.stdout + r.stderr).strip()[-400:]
    except Exception as e:
        return 1, str(e)


def apply_rules_change(mutator):
    """通用流程: 备份 -> 改 -> mihomo -t 校验 -> 热重载; 校验失败自动回滚(不重载)"""
    cfg = load_cfg()
    rules = cfg.setdefault("rules", [])
    msg = mutator(rules)
    bk = backup_cfg()
    save_cfg(cfg)
    code, out = test_config()
    if code != 0:
        shutil.copy2(bk, CONFIG_PATH)  # 文件回滚; mihomo 未 reload, 运行态不变
        raise RuntimeError(f"⚠️ 规则校验未通过，已自动回滚\nmihomo: {out}")
    how = reload_mihomo()
    return {"backup": bk, "reload": how, "message": msg}


def add_rule(text, position="bottom"):
    text = validate_rule_text(text)
    def mut(rules):
        if text in [str(x).strip() for x in rules]:
            raise ValueError("该规则已存在，无需重复添加")
        mi = _match_idx(rules)
        if position == "top":
            rules.insert(0, text)
        else:
            rules.insert(mi if mi is not None else len(rules), text)
        return "已添加规则" + ("(置顶)" if position == "top" else "(兜底前)")
    return apply_rules_change(mut)


def update_rule(idx, text):
    text = validate_rule_text(text)
    def mut(rules):
        if idx < 0 or idx >= len(rules):
            raise ValueError("规则序号越界")
        if _is_match(rules[idx]):
            raise ValueError("MATCH 兜底规则不可修改")
        rules[idx] = text
        return f"已更新第 {idx + 1} 条规则"
    return apply_rules_change(mut)


def delete_rule(idx):
    def mut(rules):
        if idx < 0 or idx >= len(rules):
            raise ValueError("规则序号越界")
        if _is_match(rules[idx]):
            raise ValueError("MATCH 兜底规则不可删除")
        removed = rules.pop(idx)
        return f"已删除: {removed}"
    return apply_rules_change(mut)


def move_rule(idx, direction):
    def mut(rules):
        if idx < 0 or idx >= len(rules):
            raise ValueError("规则序号越界")
        if _is_match(rules[idx]):
            raise ValueError("MATCH 兜底规则不可移动")
        j = idx - 1 if direction == "up" else idx + 1
        if j < 0 or j >= len(rules):
            raise ValueError("已在边界，无法继续移动")
        if _is_match(rules[j]):
            raise ValueError("不能越过 MATCH 兜底规则")
        rules[idx], rules[j] = rules[j], rules[idx]
        return f"已移动: {rules[j]} ↔ {rules[idx]}"
    return apply_rules_change(mut)


# ---------- 规则集(rule-providers)管理 ----------
# 本地自定义规则集存于 config 目录 rules/custom/<name>.yaml,
# rule-providers 以 type: file 引用 -> 可独立编辑、mihomo -t 校验、热重载。
# 远程库(http/mrs)只读展示，不提供编辑。
PROVIDER_DIR = os.path.join(os.path.dirname(CONFIG_PATH), "rules", "custom")
CUSTOM_PROVIDER_PREFIX = "custom_"  # 本地自定义规则集统一前缀，便于识别/清理
PROVIDER_BEHAVIORS = ("domain", "ipcidr", "classical")
PROVIDER_NAME_RE = re.compile(r"^[A-Za-z0-9_]{2,32}$")


def _cfg_providers(cfg):
    return cfg.setdefault("rule-providers", {})


def list_providers():
    """返回全部 rule-providers: 远程库(只读) + 本地自定义(可编辑)"""
    cfg = load_cfg()
    rps = cfg.get("rule-providers") or {}
    out = []
    for name, p in rps.items():
        p = p or {}
        is_local = p.get("type") == "file"
        out.append({
            "name": name,
            "type": p.get("type", "http"),
            "behavior": p.get("behavior", ""),
            "format": p.get("format", ""),
            "interval": p.get("interval"),
            "url": p.get("url", ""),
            "path": p.get("path", ""),
            "editable": is_local,
        })
    out.sort(key=lambda x: (not x["editable"], x["name"]))
    return out


def _provider_file(name):
    """本地自定义规则集的磁盘路径(相对 config 目录 rules/custom/)"""
    return os.path.join(PROVIDER_DIR, name + ".yaml")


def provider_content(name):
    """读取规则集内容: 本地 file 型返回行列表; 远程型不可读则抛错"""
    cfg = load_cfg()
    p = (cfg.get("rule-providers") or {}).get(name)
    if not p:
        raise ValueError(f"规则集「{name}」不存在")
    if p.get("type") != "file":
        raise ValueError("远程规则库(mrs/自动更新)内容不可在线编辑——它是自动维护的")
    path = p.get("path") or ""
    # path 可能是 ./rules/custom/xx.yaml 相对 config 目录
    if path.startswith("./"):
        path = os.path.join(os.path.dirname(CONFIG_PATH), path[2:])
    if not os.path.isfile(path):
        raise ValueError(f"规则集文件不存在: {path}")
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    lines = []
    for ln in raw.splitlines():
        ln = ln.strip()
        if ln and not ln.startswith(("#", "payload:")):
            lines.append(ln)
    return {"name": name, "path": path, "behavior": p.get("behavior", "domain"),
            "lines": lines}


def validate_provider_name(name):
    if not PROVIDER_NAME_RE.match(name):
        raise ValueError("规则集名需为 2-32 位字母/数字/下划线")
    if name.startswith("custom_") and name != name:
        raise ValueError("非法名称")
    return name


def create_provider(name, behavior, lines, overwrite=False):
    """新建/更新本地自定义规则集: 写文件 -> rule-providers 登记 -> 校验 -> 热重载"""
    name = validate_provider_name(name)
    if behavior not in PROVIDER_BEHAVIORS:
        raise ValueError(f"behavior 需为: {'/'.join(PROVIDER_BEHAVIORS)}")
    lines = [ln.strip() for ln in (lines or []) if ln.strip() and not ln.strip().startswith("#")]
    if not lines:
        raise ValueError("规则集内容为空——至少需要一行")
    if behavior == "ipcidr":
        import ipaddress
        for ln in lines:
            try:
                ipaddress.ip_network(ln.split(",")[0])
            except Exception:
                raise ValueError(f"无效 IP 网段: {ln}")
    if behavior == "classical":
        for ln in lines:
            head = ln.split(",")[0].strip().upper()
            if head in ("MATCH", "RULE-SET"):
                raise ValueError(f"classical 规则集内不允许 {head} 行: {ln}")
    # classical 文件行可能已带策略组, 若不带则引用处统一给; 校验仅做基础项

    cfg = load_cfg()
    rps = _cfg_providers(cfg)
    existing = name in rps
    if existing and not overwrite:
        raise ValueError(f"规则集「{name}」已存在——如需覆盖请用更新接口")
    if existing and rps[name].get("type") != "file":
        raise ValueError(f"「{name}」是远程规则库，不能覆盖为本地规则集")

    os.makedirs(PROVIDER_DIR, exist_ok=True)
    fpath = _provider_file(name)
    rel = "./rules/custom/" + name + ".yaml"
    with open(fpath, "w", encoding="utf-8") as f:
        f.write("# 本地自定义规则集 " + name + " (behavior: " + behavior + ")\n"
                "# 由 mihomo-node-tool 管理\n")
        for ln in lines:
            f.write(ln + "\n")

    rps[name] = {"type": "file", "behavior": behavior, "path": rel}
    bk = backup_cfg()
    save_cfg(cfg)
    code, out = test_config()
    if code != 0:
        shutil.copy2(bk, CONFIG_PATH)
        raise RuntimeError(f"⚠️ 规则集校验未通过，已自动回滚\nmihomo: {out}")
    how = reload_mihomo()
    action = "更新" if existing else "创建"
    return {"message": f"已{action}规则集「{name}」", "backup": bk, "reload": how}


def delete_provider(name):
    """删除本地自定义规则集(同时移除规则行中对该集的引用)"""
    cfg = load_cfg()
    rps = cfg.get("rule-providers") or {}
    p = rps.get(name)
    if not p:
        raise ValueError(f"规则集「{name}」不存在")
    if p.get("type") != "file":
        raise ValueError(f"「{name}」是远程规则库，不可删除(自动更新维护)")

    rules = cfg.get("rules") or []
    refs = [r for r in rules
            if str(r).strip().upper().startswith("RULE-SET," + name.upper() + ",")]
    if refs:
        raise ValueError(f"规则集中仍有 {len(refs)} 条引用未移除，请先删除对应规则行:\n"
                         + "\n".join(refs[:3]))

    # 删除磁盘文件 + 移除登记
    fpath = _provider_file(name)
    try:
        os.remove(fpath)
    except OSError:
        pass
    del rps[name]
    bk = backup_cfg()
    save_cfg(cfg)
    code, out = test_config()
    if code != 0:
        shutil.copy2(bk, CONFIG_PATH)
        raise RuntimeError(f"⚠️ 校验未通过，已自动回滚\nmihomo: {out}")
    how = reload_mihomo()
    return {"message": f"已删除规则集「{name}」", "backup": bk, "reload": how}


# ---------- HTTP 服务 ----------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def _send(self, code, obj, raw=False):
        body = obj if raw else json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        if not raw:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._send_static()
        elif path == "/api/state":
            ok, ver = mihomo_health()
            cfg = load_cfg(silent=True)
            secret = read_secret(cfg) if cfg else None
            now, opts = current_selection(secret) if secret else (None, [])
            self._send(200, {
                "mihomo": {"connected": ok, "version": ver},
                "main_group": MAIN_GROUP,
                "main_now": now,
                "main_options": opts or [],
                "config": CONFIG_PATH,
                "nodes": list_nodes(),
            })
        elif path == "/api/nodes":
            self._send(200, {"nodes": list_nodes()})
        elif path == "/api/daemon/status":
            try:
                self._send(200, daemon_status_all())
            except Exception as e:
                self._send(500, {"error": str(e)})
        elif path == "/api/rules":
            cfg = load_cfg(silent=True) or {}
            rules = [{"index": i, "text": r, "match": _is_match(r),
                      "rule_set": str(r).strip().upper().startswith("RULE-SET")}
                     for i, r in enumerate(get_rules())]
            groups = [g.get("name") for g in cfg.get("proxy-groups") or []]
            self._send(200, {"rules": rules, "targets": rule_targets(),
                             "groups": groups, "types": RULE_TYPES})
        elif path == "/api/providers":
            self._send(200, {"providers": list_providers()})
        elif path == "/api/diag/egress":
            try:
                self._send(200, diag_mgr.egress_info())
            except Exception as e:
                self._send(500, {"error": str(e)})
        elif path == "/api/diag/speed":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            targets = [t for t in (qs.get("targets", [""])[0].split(",") if qs.get("targets") else []) if t]
            try:
                self._send(200, diag_mgr.speedtest(targets or None))
            except Exception as e:
                self._send(500, {"error": str(e)})
        elif path == "/api/diag/connections":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                limit = int((qs.get("limit") or ["100"])[0])
            except Exception:
                limit = 100
            self._send(200, diag_mgr.list_connections(limit))
        elif path == "/api/diag/backups":
            self._send(200, diag_mgr.list_backups())
        elif path == "/api/diag/config":
            try:
                self._send(200, diag_mgr.read_config())
            except Exception as e:
                self._send(500, {"error": str(e)})
        elif path.startswith("/api/providers/"):
            m = re.match(r"^/api/providers/(.+)$", path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                try:
                    self._send(200, provider_content(name))
                except ValueError as e:
                    self._send(400, {"error": str(e)})
                except Exception as e:
                    self._send(500, {"error": str(e)})
            else:
                self._send(404, {"error": "Not Found"})
        else:
            self._send(404, {"error": "Not Found"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/nodes":
            try:
                body = self._read_json()
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            text = (body.get("text") or "").strip()
            if not text:
                return self._send(400, {"error": "请先粘贴节点链接"})
            links = [ln for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
            if not links and "://" not in text:
                return self._send(400, {"error": "没有检测到可解析的链接"})
            try:
                added, errs, meta = add_nodes(links,
                                              auto_select=body.get("auto_select", True))
                resp = {"added": added, "errors": errs, "meta": meta,
                        "nodes": list_nodes()}
                code = 200 if added else 400
                return self._send(code, resp)
            except Exception as e:
                return self._send(500, {"error": str(e)})
        elif path == "/api/select":
            try:
                body = self._read_json()
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            group = body.get("group") or MAIN_GROUP
            name = body.get("name")
            if not name:
                return self._send(400, {"error": "缺少节点名称"})
            return self._send(200, switch_selection(group, name))
        elif path == "/api/rules":
            try:
                body = self._read_json()
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            text = (body.get("text") or "").strip()
            if not text:
                return self._send(400, {"error": "规则内容不能为空"})
            try:
                result = add_rule(text, position=body.get("position", "bottom"))
                return self._send(200, result)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:
                return self._send(500, {"error": str(e)})
        elif path.startswith("/api/rules/"):
            m = re.match(r"^/api/rules/(\d+)/move$", path)
            if m:
                try:
                    body = self._read_json()
                except Exception:
                    return self._send(400, {"error": "请求体不是合法 JSON"})
                try:
                    result = move_rule(int(m.group(1)),
                                       direction=body.get("direction", "up"))
                    return self._send(200, result)
                except ValueError as e:
                    return self._send(400, {"error": str(e)})
                except Exception as e:
                    return self._send(500, {"error": str(e)})
            self._send(404, {"error": "Not Found"})
        elif path == "/api/providers":
            try:
                body = self._read_json()
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            name = (body.get("name") or "").strip()
            behavior = (body.get("behavior") or "domain").strip()
            lines = body.get("lines")
            if not name:
                return self._send(400, {"error": "缺少规则集名称"})
            if not isinstance(lines, list):
                return self._send(400, {"error": "lines 需为数组"})
            try:
                result = create_provider(name, behavior, lines,
                                         overwrite=body.get("overwrite") is True)
                return self._send(200, result)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:
                return self._send(500, {"error": str(e)})
        elif path == "/api/diag/trace":
            try:
                body = self._read_json()
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            domain = (body.get("domain") or "").strip()
            if not domain:
                return self._send(400, {"error": "缺少域名"})
            try:
                self._send(200, diag_mgr.trace_domain(domain))
            except Exception as e:
                self._send(500, {"error": str(e)})
        elif path == "/api/diag/backups/restore":
            try:
                body = self._read_json()
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            file = (body.get("file") or "").strip()
            if not file:
                return self._send(400, {"error": "缺少备份文件名"})
            try:
                result = diag_mgr.restore_backup(file)
                return self._send(200, result)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:
                return self._send(500, {"error": str(e)})
        elif path == "/api/diag/config":
            try:
                body = self._read_json()
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            content = body.get("content")
            if not isinstance(content, str) or not content.strip():
                return self._send(400, {"error": "配置内容不能为空"})
            try:
                result = diag_mgr.write_config(content)
                return self._send(200, result)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:
                return self._send(500, {"error": str(e)})
        elif path == "/api/diag/connections/close-all":
            try:
                return self._send(200, diag_mgr.close_all())
            except Exception as e:
                return self._send(500, {"error": str(e)})
        elif path.startswith("/api/providers/"):
            m = re.match(r"^/api/providers/(.+)$", path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                try:
                    body = self._read_json()
                except Exception:
                    return self._send(400, {"error": "请求体不是合法 JSON"})
                behavior = (body.get("behavior") or "domain").strip()
                lines = body.get("lines")
                if not isinstance(lines, list):
                    return self._send(400, {"error": "lines 需为数组"})
                try:
                    result = create_provider(name, behavior, lines, overwrite=True)
                    return self._send(200, result)
                except ValueError as e:
                    return self._send(400, {"error": str(e)})
                except Exception as e:
                    return self._send(500, {"error": str(e)})
            self._send(404, {"error": "Not Found"})
        elif path.startswith("/api/daemon/"):
            # /api/daemon/install|update|start|restart|stop|uninstall
            action = path.rsplit("/", 1)[-1]
            try:
                body = self._read_json()
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            if not isinstance(body, dict):
                body = {}
            try:
                result = daemon_run_action(action, body)
                code = 200 if not result.get("error") else 400
                return self._send(code, result)
            except Exception as e:
                return self._send(500, {"error": str(e)})
        else:
            self._send(404, {"error": "Not Found"})

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        m = re.match(r"^/api/nodes/(.+)$", path)
        if m:
            name = urllib.parse.unquote(m.group(1))
            return self._send(200, delete_node(name))
        m = re.match(r"^/api/rules/(\d+)$", path)
        if m:
            try:
                result = delete_rule(int(m.group(1)))
                return self._send(200, result)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:
                return self._send(500, {"error": str(e)})
        m = re.match(r"^/api/providers/(.+)$", path)
        if m:
            name = urllib.parse.unquote(m.group(1))
            try:
                result = delete_provider(name)
                return self._send(200, result)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:
                return self._send(500, {"error": str(e)})
        m = re.match(r"^/api/diag/connections/(.+)$", path)
        if m:
            cid = urllib.parse.unquote(m.group(1))
            try:
                result = diag_mgr.close_connection(cid)
                code = 200 if result.get("ok") else 400
                return self._send(code, result)
            except Exception as e:
                return self._send(500, {"error": str(e)})
        self._send(404, {"error": "Not Found"})

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        m = re.match(r"^/api/rules/(\d+)$", path)
        if m:
            try:
                body = self._read_json()
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            text = (body.get("text") or "").strip()
            if not text:
                return self._send(400, {"error": "规则内容不能为空"})
            try:
                result = update_rule(int(m.group(1)), text)
                return self._send(200, result)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:
                return self._send(500, {"error": str(e)})
        m = re.match(r"^/api/providers/(.+)$", path)
        if m:
            name = urllib.parse.unquote(m.group(1))
            try:
                body = self._read_json()
            except Exception:
                return self._send(400, {"error": "请求体不是合法 JSON"})
            behavior = (body.get("behavior") or "domain").strip()
            lines = body.get("lines")
            if not isinstance(lines, list):
                return self._send(400, {"error": "lines 需为数组"})
            try:
                result = create_provider(name, behavior, lines, overwrite=True)
                return self._send(200, result)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:
                return self._send(500, {"error": str(e)})
        self._send(404, {"error": "Not Found"})

    def _send_static(self):
        index = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
        try:
            with open(index, "rb") as f:
                body = f.read()
        except Exception:
            body = "<h1>index.html 缺失</h1>".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    cfg = load_cfg(silent=True)
    if cfg is None:
        sys.stderr.write(f"无法读取 {CONFIG_PATH}，服务退出\n")
        sys.exit(1)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    sys.stderr.write(f"mihomo-node-tool 已启动: http://0.0.0.0:{PORT}  "
                     f"(config={CONFIG_PATH})\n")
    srv.serve_forever()


if __name__ == "__main__":
    main()
