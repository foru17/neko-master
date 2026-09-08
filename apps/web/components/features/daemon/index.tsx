"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  RefreshCw,
  ServerCog,
  Download,
  RotateCw,
  Play,
  Square,
  Trash2,
  CircleCheck,
  CircleX,
  Power,
  HardDrive,
  FolderCog,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ---------- types (mirror host daemon API) ----------
interface EngineStatus {
  engine: string;
  name: string;
  installed: boolean;
  version?: string;
  bin?: string;
  config_dir?: string;
  unit_exists?: boolean;
  running?: boolean;
  autostart?: boolean;
}

interface DaemonStatus {
  ok?: boolean;
  engines?: EngineStatus[];
}

interface DaemonResult {
  ok?: boolean;
  engine?: string;
  action?: string;
  version?: string;
  backup?: string | null;
  message?: string;
  messages?: string[];
  error?: string;
}

async function daemonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/nt${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload: unknown = {};
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }
  if (!res.ok) {
    const err = (payload as { error?: string }).error || `HTTP ${res.status}`;
    throw new Error(err);
  }
  return payload as T;
}

export function DaemonContent() {
  const t = useTranslations("daemon");
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyEngine, setBusyEngine] = useState<string | null>(null);
  const [opLog, setOpLog] = useState<DaemonResult[]>([]);

  const load = useCallback(async () => {
    try {
      const s = await daemonRequest<DaemonStatus>("GET", "/daemon/status");
      setStatus(s);
    } catch (e) {
      toast.error(t("loadFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (action: string, eng: EngineStatus, extra?: Record<string, unknown>) => {
    setBusyEngine(eng.engine);
    try {
      const r = await daemonRequest<DaemonResult>("POST", `/daemon/${action}`, {
        engine: eng.engine,
        confirm: true,
        ...extra,
      });
      setOpLog((prev) => [r, ...prev].slice(0, 12));
      if (r.error) {
        toast.error(t("actionFailed", { action: t(`act.${action}`) }), {
          description: r.error,
        });
      } else {
        const detail = r.version
          ? `v${r.version}`
          : r.message || r.messages?.join("; ") || "";
        toast.success(t("actionOk", { action: t(`act.${action}`) }), {
          description: detail || undefined,
        });
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyEngine(null);
    }
  };

  const engines = status?.engines || [];
  const anyBusy = busyEngine !== null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <ServerCog className="w-5 h-5" />
            {t("title")}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={() => void load()} title={t("refresh")}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && engines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            engines.map((eng) => {
              const busy = busyEngine === eng.engine;
              return (
                <div
                  key={eng.engine}
                  className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3"
                >
                  {/* header row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{eng.name}</span>
                      {eng.installed ? (
                        <>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {eng.version || "?"}
                          </Badge>
                          {eng.running ? (
                            <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                              <Activity className="w-3 h-3" />
                              {t("running")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              <CircleX className="w-3 h-3" />
                              {t("stopped")}
                            </Badge>
                          )}
                        </>
                      ) : (
                        <Badge variant="outline">{t("notInstalled")}</Badge>
                      )}
                      {eng.autostart && eng.installed ? (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Power className="w-3 h-3" />
                          {t("autostart")}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!eng.installed ? (
                        <Button size="sm" disabled={anyBusy} onClick={() => void run("install", eng)}>
                          {busy ? t("busy") : <><Download className="w-4 h-4 mr-1" />{t("act.install")}</>}
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={anyBusy}
                            onClick={() => void run("update", eng)}
                            title={t("updateHint")}
                          >
                            {busy ? t("busy") : <><RotateCw className="w-4 h-4 mr-1" />{t("act.update")}</>}
                          </Button>
                          {!eng.running ? (
                            <Button size="sm" disabled={anyBusy} onClick={() => void run("start", eng)}>
                              {busy ? t("busy") : <><Play className="w-4 h-4 mr-1" />{t("act.start")}</>}
                            </Button>
                          ) : (
                            <>
                              <Button size="sm" variant="secondary" disabled={anyBusy} onClick={() => void run("restart", eng)}>
                                {busy ? t("busy") : t("act.restart")}
                              </Button>
                              <Button size="sm" variant="outline" disabled={anyBusy} onClick={() => void run("stop", eng)}>
                                {busy ? t("busy") : <><Square className="w-4 h-4 mr-1" />{t("act.stop")}</>}
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                            disabled={anyBusy}
                            onClick={() => {
                              if (window.confirm(t("uninstallConfirm", { name: eng.name }))) {
                                void run("uninstall", eng, { purge: false });
                              }
                            }}
                          >
                            {busy ? t("busy") : <><Trash2 className="w-4 h-4 mr-1" />{t("act.uninstall")}</>}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {/* info row */}
                  {eng.installed && (
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3" />
                        {eng.bin}
                      </span>
                      <span className="flex items-center gap-1">
                        <FolderCog className="w-3 h-3" />
                        {eng.config_dir}
                      </span>
                      {eng.unit_exists ? (
                        <span className="flex items-center gap-1">
                          <CircleCheck className="w-3 h-3 text-emerald-500" />
                          {t("unitManaged")}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* operation log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">{t("logTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {opLog.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("logEmpty")}</p>
          ) : (
            <ul className="space-y-2 text-sm font-mono">
              {opLog.map((r, i) => (
                <li
                  key={i}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs",
                    r.error
                      ? "border-rose-500/30 text-rose-600 dark:text-rose-400"
                      : "border-border/60 text-muted-foreground",
                  )}
                >
                  <span className="font-semibold text-foreground">
                    [{r.engine}] {r.action}
                  </span>
                  {"  "}
                  {r.error ||
                    r.version ||
                    r.message ||
                    r.messages?.join("; ") ||
                    r.backup ||
                    "ok"}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
