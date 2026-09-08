"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Wrench,
  RefreshCw,
  PlugZap,
  XCircle,
  History,
  RotateCcw,
  FileCode2,
  FolderOpen,
  Save,
  Link2,
  FileClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ---------- types (mirror diag_mgr API) ----------
interface ConnItem {
  id: string;
  host?: string;
  dest_ip?: string;
  source_ip?: string;
  source_port?: string;
  process?: string;
  network?: string;
  type?: string;
  rule?: string;
  rule_payload?: string;
  chains?: string[];
  download?: number;
}

interface ConnList {
  total?: number;
  connections?: ConnItem[];
  error?: string;
}

interface BackupItem {
  file: string;
  size: number;
  mtime: string;
}

interface BackupList {
  backups: BackupItem[];
}

interface ConfigPayload {
  content: string;
  secret_masked: boolean;
}

interface OpResult {
  ok?: boolean;
  message?: string;
  error?: string;
}

async function ntRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
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

function fmtBytes(b: number): string {
  if (!b) return "0B";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

export function OpsContent() {
  const t = useTranslations("ops");
  const [conns, setConns] = useState<ConnList | null>(null);
  const [connLoading, setConnLoading] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [bks, setBks] = useState<BackupItem[] | null>(null);
  const [bkLoading, setBkLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [cfg, setCfg] = useState<ConfigPayload | null>(null);
  const [cfgText, setCfgText] = useState("");
  const [cfgBusy, setCfgBusy] = useState(false);

  const loadConns = useCallback(async () => {
    setConnLoading(true);
    try {
      const d = await ntRequest<ConnList>("GET", "/diag/connections?limit=80");
      setConns(d);
    } catch (e) {
      toast.error(t("connLoadFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
      setConns({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setConnLoading(false);
    }
  }, [t]);

  const loadBks = useCallback(async () => {
    setBkLoading(true);
    try {
      const d = await ntRequest<BackupList>("GET", "/diag/backups");
      setBks(d.backups || []);
    } catch (e) {
      toast.error(t("bkLoadFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
      setBks([]);
    } finally {
      setBkLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadConns();
    void loadBks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeConn = async (id: string) => {
    setClosing(id);
    try {
      const r = await ntRequest<OpResult>("DELETE", `/diag/connections/${encodeURIComponent(id)}`);
      if (r.error) throw new Error(r.error);
      toast.success(t("connClosed"));
      await loadConns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setClosing(null);
    }
  };

  const closeAll = async () => {
    if (!window.confirm(t("connCloseAllConfirm"))) return;
    try {
      const r = await ntRequest<OpResult>("POST", "/diag/connections/close-all", {});
      if (r.error) throw new Error(r.error);
      toast.success(t("connClosedAll"));
      await loadConns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const restoreBk = async (file: string) => {
    if (!window.confirm(t("bkRestoreConfirm", { file }))) return;
    setRestoring(file);
    try {
      const r = await ntRequest<OpResult>("POST", "/diag/backups/restore", { file });
      if (r.error) throw new Error(r.error);
      toast.success(t("bkRestored") + `: ${file}`);
      await loadBks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(null);
    }
  };

  const loadCfg = async () => {
    try {
      const d = await ntRequest<ConfigPayload>("GET", "/diag/config");
      setCfg(d);
      setCfgText(d.content);
      toast.info(t("cfgLoaded"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const saveCfg = async () => {
    if (!cfgText.trim()) {
      toast.error(t("cfgEmpty"));
      return;
    }
    setCfgBusy(true);
    try {
      const r = await ntRequest<OpResult>("POST", "/diag/config", { content: cfgText });
      if (r.error) throw new Error(r.error);
      toast.success(t("cfgSaved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCfgBusy(false);
    }
  };

  const list = conns?.connections || [];
  const total = conns?.total ?? list.length;

  return (
    <div className="space-y-6">
      {/* Connections */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <PlugZap className="w-5 h-5" />
            {t("connTitle")}
            <span className="text-sm font-normal text-muted-foreground">({total})</span>
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadConns()}
              title={t("refresh")}>
              <RefreshCw className={cn("w-3.5 h-3.5 mr-1", connLoading && "animate-spin")} />
              {t("connRefresh")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => void closeAll()}>
              <XCircle className="w-3.5 h-3.5 mr-1" />
              {t("connCloseAll")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("connHint")}</p>
          {conns === null ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</div>
          ) : list.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {conns.error || t("connEmpty")}
            </div>
          ) : (
            <div className="max-h-[380px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("connColHost")}</TableHead>
                    <TableHead className="w-28">{t("connColSrc")}</TableHead>
                    <TableHead className="w-24">{t("connColProc")}</TableHead>
                    <TableHead className="w-32">{t("connColRule")}</TableHead>
                    <TableHead className="w-40">{t("connColChain")}</TableHead>
                    <TableHead className="w-16 text-right">{t("connColDl")}</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs max-w-[220px] truncate">
                        {c.host || c.dest_ip || "?"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.source_ip}
                        {c.source_port ? `:${c.source_port}` : ""}
                      </TableCell>
                      <TableCell className="text-xs">{c.process || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.rule || "—"}
                        {c.rule_payload ? `(${c.rule_payload.slice(0, 14)})` : ""}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground truncate">
                        {(c.chains || []).slice().reverse().join(" > ") || "DIRECT"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-right">
                        {fmtBytes(c.download || 0)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          title={t("connClose")}
                          disabled={closing === c.id}
                          onClick={() => void closeConn(c.id)}>
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backups */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <History className="w-5 h-5" />
            {t("bkTitle")}
            <span className="text-sm font-normal text-muted-foreground">
              ({bks ? bks.length : "…"})
            </span>
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={() => void loadBks()} title={t("refresh")}>
            <RefreshCw className={cn("w-4 h-4", bkLoading && "animate-spin")} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("bkHint")}</p>
          {bks === null ? (
            <div className="py-4 text-center text-sm text-muted-foreground">{t("loading")}</div>
          ) : bks.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">{t("bkEmpty")}</div>
          ) : (
            <div className="max-h-[280px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("bkColFile")}</TableHead>
                    <TableHead className="w-40">{t("bkColTime")}</TableHead>
                    <TableHead className="w-20 text-right">{t("bkColSize")}</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bks.map((b) => (
                    <TableRow key={b.file}>
                      <TableCell className="font-mono text-xs">{b.file}</TableCell>
                      <TableCell className="font-mono text-xs">{b.mtime}</TableCell>
                      <TableCell className="font-mono text-xs text-right">
                        {(b.size / 1024).toFixed(1)}KB
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          disabled={restoring === b.file}
                          onClick={() => void restoreBk(b.file)}>
                          <RotateCcw className="w-3 h-3 mr-1" />
                          {t("bkRestore")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full config editor */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <FileCode2 className="w-5 h-5" />
            {t("cfgTitle")}
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadCfg()}>
              <FolderOpen className="w-3.5 h-3.5 mr-1" />
              {t("cfgLoad")}
            </Button>
            <Button size="sm" onClick={() => void saveCfg()} disabled={cfgBusy || !cfgText}>
              {cfgBusy ? t("cfgSaving") : (
                <>
                  <Save className="w-3.5 h-3.5 mr-1" />
                  {t("cfgSave")}
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("cfgHint")}</p>
          {!cfg ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              <FileClock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              {t("cfgLoad")}
            </div>
          ) : (
            <textarea
              value={cfgText}
              onChange={(e) => setCfgText(e.target.value)}
              spellCheck={false}
              className="min-h-[320px] w-full rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:border-primary resize-y"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
