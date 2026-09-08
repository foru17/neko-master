#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
node_parser.py — 把各种单节点分享链接解析为 mihomo (Clash Meta) proxy 字典
支持: vmess / vless / trojan / ss / ssr / hysteria2(hy2) / tuic / http / socks5
纯标准库实现
"""
import base64
import json
import re
import urllib.parse


def _b64d(s, url_safe=True):
    s = s.strip()
    pad = "=" * (-len(s) % 4)
    try:
        if url_safe:
            return base64.urlsafe_b64decode(s + pad).decode("utf-8")
        return base64.b64decode(s + pad).decode("utf-8")
    except Exception:
        # 有些 ssr 链接里是标准 b64 但带 -_ 字符；先按 urlsafe 失败再试标准
        try:
            return base64.b64decode(s + pad).decode("utf-8")
        except Exception:
            return None


def _bool_param(v):
    if v is None:
        return None
    v = urllib.parse.unquote(str(v)).lower()
    return v in ("1", "true", "yes", "on")


def _int_or(v, d=None):
    try:
        return int(v)
    except Exception:
        return d


def _clean_name(raw, fallback):
    if raw:
        try:
            raw = urllib.parse.unquote(raw)
        except Exception:
            pass
        return raw.strip()
    return fallback


def _split_host_port(hostport):
    """'host:port?query...' 或 'host:port' -> (host, port, query)"""
    hostport, _, qs = hostport.partition("?")
    host, _, port = hostport.rpartition(":")
    return host, port, qs


def parse_vmess(link):
    raw = link[len("vmess://"):]
    dec = _b64d(raw)
    if dec is None:
        # 某些客户端是明文 JSON 不带 base64
        dec = raw
    data = json.loads(dec)
    host = data.get("add") or data.get("host")
    port = data.get("port")
    if not host or not port:
        raise ValueError("vmess 链接缺少地址或端口")
    p = {
        "name": _clean_name(data.get("ps"), f"vmess-{host}"),
        "type": "vmess",
        "server": host,
        "port": _int_or(port),
        "uuid": data.get("id"),
        "alterId": _int_or(data.get("aid"), 0),
        "cipher": data.get("scy") or data.get("security") or "auto",
        "udp": True,
    }
    net = (data.get("net") or "tcp").lower()
    tls = (data.get("tls") or "").lower()
    if tls in ("tls", "true", "1", "reality"):
        p["tls"] = True
        if tls == "reality":
            p["reality-opts"] = {}
            for k in ("public-key", "short-id"):
                if data.get(k):
                    p["reality-opts"][k] = data[k]
            fp = data.get("fp")
            if fp:
                p["client-fingerprint"] = fp
        sni = data.get("sni") or data.get("servername")
        if sni:
            p["servername"] = sni
        if data.get("alpn"):
            p["alpn"] = [str(x) for x in str(data["alpn"]).split(",") if x]
    if net == "ws":
        p["network"] = "ws"
        p["ws-opts"] = {"path": data.get("path") or "/"}
        if data.get("host"):
            p["ws-opts"]["headers"] = {"Host": data["host"]}
    elif net == "grpc":
        p["network"] = "grpc"
        p["grpc-opts"] = {"grpc-service-name": data.get("serviceName") or data.get("path") or ""}
    elif net == "h2" or net == "http":
        p["network"] = "http"
        p["http-opts"] = {"path": [data.get("path") or "/"]}
        if data.get("host"):
            p["http-opts"]["headers"] = {"Host": [data["host"]]}
    return p


def _parse_url_params(qs):
    """query string -> dict(保留原始可重复), 自动 unquote"""
    out = {}
    for k, v in urllib.parse.parse_qsl(qs, keep_blank_values=True):
        out[k] = v
    return out


def parse_vless(link):
    rest = link[len("vless://"):]
    head, _, frag = rest.partition("#")
    userinfo, _, hostport = head.partition("@")
    host, port, _ = _split_host_port(hostport)
    uuid = userinfo
    params = _parse_url_params(head.split("?", 1)[1]) if "?" in head else {}
    p = {
        "name": _clean_name(frag, f"vless-{host}"),
        "type": "vless",
        "server": host,
        "port": _int_or(port),
        "uuid": uuid,
        "udp": True,
    }
    net = (params.get("type") or "tcp").lower()
    sec = (params.get("security") or "none").lower()
    flow = params.get("flow")
    if flow and flow not in ("", "none"):
        p["flow"] = flow
    if sec in ("tls", "reality"):
        p["tls"] = True
        sni = params.get("sni") or params.get("servername")
        if sni:
            p["servername"] = sni
        if sec == "reality":
            pbk = params.get("pbk") or params.get("publicKey")
            sid = params.get("sid") or params.get("shortId")
            if pbk:
                p.setdefault("reality-opts", {})["public-key"] = pbk
            if sid:
                p.setdefault("reality-opts", {})["short-id"] = sid
            spx = params.get("spx")
            if spx:
                p.setdefault("reality-opts", {})["spider-x"] = spx
        fp = params.get("fp") or params.get("fingerprint")
        if fp:
            p["client-fingerprint"] = fp
        elif sec == "reality":
            p["client-fingerprint"] = "chrome"
        if params.get("alpn"):
            p["alpn"] = [x for x in params["alpn"].split(",") if x]
    insecure = _bool_param(params.get("allowInsecure")) or _bool_param(params.get("insecure"))
    if insecure:
        p["skip-cert-verify"] = True
    if net == "ws":
        p["network"] = "ws"
        opts = {"path": params.get("path") or "/"}
        host_h = params.get("host")
        if host_h:
            opts["headers"] = {"Host": host_h}
        p["ws-opts"] = opts
    elif net == "grpc":
        p["network"] = "grpc"
        p["grpc-opts"] = {"grpc-service-name": params.get("serviceName") or params.get("path") or ""}
    elif net == "http" or net == "h2":
        p["network"] = "http"
        opts = {"path": [params.get("path") or "/"]}
        if params.get("host"):
            opts["headers"] = {"Host": [params["host"]]}
        p["http-opts"] = opts
    elif net == "tcp" and params.get("headerType") == "http":
        p["network"] = "http"
        p["http-opts"] = {"path": [params.get("path") or "/"]}
    # ---------- sing-box / 第三方导出风格兼容 ----------
    # 例: vless://base64(:uuid@host:port)?path=xxx&remarks=名称&obfs=xhttp&tls=1&peer=域名&pbk=..&sid=..
    if params.get("remarks") and not frag:
        p["name"] = urllib.parse.unquote(params["remarks"])
    if not p.get("tls") and params.get("tls") in ("1", "true", "on"):
        p["tls"] = True
    if params.get("peer") and not p.get("servername"):
        p["servername"] = params["peer"]
    if params.get("pbk") or params.get("sid") or params.get("spx"):
        ro = p.setdefault("reality-opts", {})
        if params.get("pbk"):
            ro["public-key"] = params["pbk"]
        if params.get("sid"):
            ro["short-id"] = params["sid"]
        if params.get("spx"):
            ro["spider-x"] = params["spx"]
    if params.get("fp") and not p.get("client-fingerprint"):
        p["client-fingerprint"] = params["fp"]
    elif p.get("reality-opts") and not p.get("client-fingerprint"):
        # REALITY 必须带 uTLS 指纹，未指定时默认 chrome（各客户端通用默认）
        p["client-fingerprint"] = "chrome"
    # obfs= 传输映射 (sing-box 风格: ws / xhttp / httpupgrade / grpc ...)
    obfs = (params.get("obfs") or "").lower()
    if obfs and net == "tcp":
        if obfs == "xhttp":
            p["network"] = "xhttp"
            xo = {"path": params.get("path") or "/"}
            if params.get("mode"):
                xo["mode"] = params["mode"]
            if params.get("host"):
                xo["host"] = params["host"]
            p["xhttp-opts"] = xo
        elif obfs == "ws":
            p["network"] = "ws"
            wo = {"path": params.get("path") or "/"}
            if params.get("host"):
                wo["headers"] = {"Host": params["host"]}
            p["ws-opts"] = wo
        elif obfs == "httpupgrade":
            p["network"] = "httpupgrade"
            ho = {"path": params.get("path") or "/"}
            if params.get("host"):
                ho["headers"] = {"Host": params["host"]}
            p["httpupgrade-opts"] = ho
        elif obfs == "grpc":
            p["network"] = "grpc"
            p["grpc-opts"] = {"grpc-service-name": params.get("serviceName") or params.get("path") or ""}
        elif obfs == "http":
            p["network"] = "http"
            p["http-opts"] = {"path": [params.get("path") or "/"]}
    return p


def parse_trojan(link):
    rest = link[len("trojan://"):]
    head, _, frag = rest.partition("#")
    userinfo, _, hostport = head.partition("@")
    host, port, _ = _split_host_port(hostport)
    password = userinfo
    params = _parse_url_params(head.split("?", 1)[1]) if "?" in head else {}
    p = {
        "name": _clean_name(frag, f"trojan-{host}"),
        "type": "trojan",
        "server": host,
        "port": _int_or(port),
        "password": password,
        "udp": True,
    }
    if params.get("allowInsecure") in ("1", "true") or params.get("insecure") in ("1", "true"):
        p["skip-cert-verify"] = True
    sni = params.get("sni") or params.get("peer")
    if sni:
        p["sni"] = sni
    if params.get("alpn"):
        p["alpn"] = [x for x in params["alpn"].split(",") if x]
    net = (params.get("type") or "tcp").lower()
    if net == "ws":
        p["network"] = "ws"
        opts = {"path": params.get("path") or "/"}
        if params.get("host"):
            opts["headers"] = {"Host": params["host"]}
        p["ws-opts"] = opts
    elif net == "grpc":
        p["network"] = "grpc"
        p["grpc-opts"] = {"grpc-service-name": params.get("serviceName") or params.get("path") or ""}
    elif net == "http":
        p["network"] = "http"
        opts = {"path": [params.get("path") or "/"]}
        if params.get("host"):
            opts["headers"] = {"Host": [params["host"]]}
        p["http-opts"] = opts
    return p


def parse_ss(link):
    rest = link[len("ss://"):]
    frag = ""
    if "#" in rest:
        rest, _, frag = rest.partition("#")
    if "@" in rest:
        # sip002 形式: base64(method:password)@host:port
        b64part, _, hostport = rest.partition("@")
        hostport = hostport.split("?", 1)[0]
        dec = _b64d(b64part) or _b64d(b64part, url_safe=False)
        if not dec or ":" not in dec:
            raise ValueError("ss 链接格式无法解析")
        method, _, password = dec.partition(":")
        host, port, _ = _split_host_port(hostport)
    else:
        # 老格式: base64(method:password@host:port) 可能带 path 前缀
        dec = _b64d(rest)
        if not dec:
            raise ValueError("ss 链接格式无法解析")
        userinfo, _, hostport = dec.rpartition("@")
        method, _, password = userinfo.partition(":")
        host, _, port = hostport.rpartition(":")
    if not all([method, password, host, port]):
        raise ValueError("ss 链接字段不完整")
    p = {
        "name": _clean_name(frag, f"ss-{host}"),
        "type": "ss",
        "server": host,
        "port": _int_or(port),
        "cipher": method,
        "password": password,
        "udp": True,
    }
    # 处理 plugin (obfs-local / v2ray-plugin)
    head = link[len("ss://"):]
    qpos = head.find("?")
    if qpos != -1:
        params = _parse_url_params(head[qpos + 1:].split("#")[0])
        plugin = params.get("plugin", "")
        if plugin:
            _apply_ss_plugin(p, plugin)
    return p


def _apply_ss_plugin(p, plugin):
    plugin = urllib.parse.unquote(plugin)
    parts = plugin.split(";")
    pname = parts[0].strip()
    args = {}
    for x in parts[1:]:
        if "=" in x:
            k, _, v = x.partition("=")
            args[k.strip()] = v.strip()
    if pname in ("obfs-local", "simple-obfs", "obfs"):
        p["plugin"] = "obfs"
        mode = args.get("obfs", "http")
        p["plugin-opts"] = {"mode": mode}
        if args.get("obfs-host"):
            p["plugin-opts"]["host"] = args["obfs-host"]
        if mode == "http" and args.get("obfs-uri"):
            p["plugin-opts"]["path"] = args["obfs-uri"]
    elif pname in ("v2ray-plugin",):
        p["plugin"] = "v2ray-plugin"
        mode = args.get("mode", "websocket")
        opts = {"mode": mode}
        if args.get("host"):
            opts["host"] = args["host"]
        if args.get("path"):
            opts["path"] = args["path"]
        if args.get("tls") == "true":
            opts["tls"] = True
        p["plugin-opts"] = opts


def parse_ssr(link):
    b64 = link[len("ssr://"):]
    dec = _b64d(b64)
    if not dec:
        raise ValueError("ssr 链接无法解码")
    # host:port:protocol:method:obfs:base64pass  ?params  #name
    main, _, params_s = dec.partition("?")
    frag = ""
    if "#" in main:
        main, _, frag = main.partition("#")
    parts = main.split(":")
    if len(parts) < 6:
        raise ValueError("ssr 链接格式无法解析")
    host, port = parts[0], parts[1]
    protocol, method, obfs = parts[2], parts[3], parts[4]
    pass_b64 = ":".join(parts[5:])
    password = _b64d(pass_b64) or ""
    p = {
        "name": _clean_name(frag, f"ssr-{host}"),
        "type": "ssr",
        "server": host,
        "port": _int_or(port),
        "cipher": method,
        "password": password,
        "protocol": protocol,
        "obfs": obfs,
        "udp": True,
    }
    if params_s:
        for k, v in urllib.parse.parse_qsl(params_s):
            if k == "protoparam":
                p["protocol-param"] = _b64d(v) or v
            elif k == "obfsparam":
                p["obfs-param"] = _b64d(v) or v
    return p


def parse_hysteria2(link):
    rest = link.split("://", 1)[1]
    head, _, frag = rest.partition("#")
    auth, _, hostport = head.partition("@")
    host, port, _ = _split_host_port(hostport)
    params = _parse_url_params(head.split("?", 1)[1]) if "?" in head else {}
    p = {
        "name": _clean_name(frag, f"hy2-{host}"),
        "type": "hysteria2",
        "server": host,
        "port": _int_or(port, 443),
        "password": auth,
        "udp": True,
    }
    if params.get("sni"):
        p["sni"] = params["sni"]
    if _bool_param(params.get("insecure")) or _bool_param(params.get("allowInsecure")):
        p["skip-cert-verify"] = True
    if params.get("alpn"):
        p["alpn"] = [x for x in params["alpn"].split(",") if x]
    if params.get("obfs"):
        p["obfs"] = params["obfs"]
        if params.get("obfs-password"):
            p["obfs-password"] = params["obfs-password"]
    return p


def parse_tuic(link):
    rest = link.split("://", 1)[1]
    head, _, frag = rest.partition("#")
    userinfo, _, hostport = head.partition("@")
    uuid, _, password = userinfo.partition(":")
    host, port, _ = _split_host_port(hostport)
    params = _parse_url_params(head.split("?", 1)[1]) if "?" in head else {}
    p = {
        "name": _clean_name(frag, f"tuic-{host}"),
        "type": "tuic",
        "server": host,
        "port": _int_or(port, 443),
        "uuid": uuid,
        "password": password or "",
        "congestion-controller": params.get("congestion_controller", "bbr"),
        "udp": True,
    }
    if params.get("sni"):
        p["sni"] = params["sni"]
    if params.get("alpn"):
        p["alpn"] = [x for x in params["alpn"].split(",") if x]
    if _bool_param(params.get("allowInsecure")) or _bool_param(params.get("insecure")):
        p["skip-cert-verify"] = True
    return p


def parse_plain(link):
    """http:// https:// socks5:// socks:// trojan 非标准形式等"""
    scheme = link.split("://", 1)[0].lower()
    rest = link.split("://", 1)[1]
    head, _, frag = rest.partition("#")
    if "@" in head:
        userinfo, _, hostport = head.partition("@")
    else:
        userinfo, hostport = "", head
    host, port, _ = _split_host_port(hostport)
    mtype = "socks5" if scheme.startswith("socks") else "http"
    p = {
        "name": _clean_name(frag, f"{mtype}-{host}"),
        "type": mtype,
        "server": host,
        "port": _int_or(port, 443 if scheme == "https" else 80),
    }
    if userinfo and ":" in userinfo:
        u, _, pw = userinfo.partition(":")
        p["username"] = urllib.parse.unquote(u)
        p["password"] = urllib.parse.unquote(pw)
    if scheme == "https":
        p["tls"] = True
    return p


def parse_node_link(link):
    """入口: 解析任意单节点链接 -> mihomo proxy dict"""
    link = link.strip()
    if not link:
        raise ValueError("链接为空")
    scheme = link.split("://", 1)[0].lower()
    # 兼容 base64 包装的非标准链接: "vless://<base64内容>[?参数][#名称]"
    if scheme in ("vless", "vmess", "trojan", "ss", "tuic", "hysteria2", "hy2"):
        rest = link.split("://", 1)[1]
        core = rest.split("?", 1)[0].split("#", 1)[0]
        if "@" not in core and len(core) > 20 and re.fullmatch(r"[A-Za-z0-9+/_\-=]+", core):
            dec = _b64d(core)
            if dec and "@" in dec and ":" in dec:
                dec = dec.lstrip(":")  # 某些导出格式会在开头残留冒号
                inner = f"{scheme}://" + dec
                if "?" in rest or "#" in rest:
                    inner += rest[len(core):]  # 补回明文参数/名称
                return parse_node_link(inner)
    if scheme == "vmess":
        return parse_vmess(link)
    if scheme == "vless":
        return parse_vless(link)
    if scheme == "trojan":
        return parse_trojan(link)
    if scheme == "ss":
        return parse_ss(link)
    if scheme == "ssr":
        return parse_ssr(link)
    if scheme in ("hysteria2", "hy2"):
        return parse_hysteria2(link)
    if scheme == "tuic":
        return parse_tuic(link)
    if scheme in ("http", "https", "socks", "socks5", "socks4"):
        return parse_plain(link)
    raise ValueError(f"不支持的节点协议: {scheme}")


def parse_multi(text):
    """按行解析多个链接，容忍空行和注释"""
    out = []
    errs = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # 过滤掉整段订阅/非链接文字
        if "://" not in line:
            errs.append(f"忽略非链接内容: {line[:40]}")
            continue
        try:
            out.append(parse_node_link(line))
        except Exception as e:
            errs.append(f"{line[:50]}... -> {e}")
    return out, errs
