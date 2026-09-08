"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  PlusCircle,
  RefreshCw,
  Trash2,
  Server,
  ListTree,
  CircleCheck,
  CircleX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ---------- types (mirror the host node-tool API) ----------
interface NodeInfo {
  name: string;
  type: string;
  server?: string;
  port?: string | number;
}

interface NtState {
  mihomo?: { connected: boolean; version?: string };
  main_group?: string;
  main_now?: string;
  main_options?: string[];
  config?: string;
  nodes?: NodeInfo[];
}

interface AddResult {
  added?: NodeInfo[];
  errors?: string[];
  meta?: { reload?: string; backup?: string; select?: string };
  nodes?: NodeInfo[];
  error?: string;
}

interface OpResult {
  ok?: boolean;
  now?: string;
  error?: string;
  message?: string;
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

export function NodesContent() {
  const t = useTranslations("nodes");
  const [state, setState] = useState<NtState | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [autoSelect, setAutoSelect] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await ntRequest<NtState>("GET", "/state");
      setState(s);
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

  const doAdd = async () => {
    const value = text.trim();
    if (!value) {
      toast.error(t("emptyInput"));
      return;
    }
    setBusy(true);
    try {
      const r = await ntRequest<AddResult>("POST", "/nodes", {
        text: value,
        auto_select: autoSelect,
      });
      const msgs: string[] = [];
      for (const a of r.added || []) {
        msgs.push(t("addedOk", { name: a.name }));
      }
      if (r.meta?.select) msgs.push(r.meta.select);
      if (msgs.length) toast.success(msgs.join("\n"));
      for (const e of r.errors || []) toast.error(e);
      if (!r.added?.length && !r.errors?.length) toast.error(t("noNodeParsed"));
      setText("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doSelect = async (name: string) => {
    if (!name) return;
    setSelecting(true);
    try {
      const r = await ntRequest<OpResult>("POST", "/select", { name });
      if (r.ok) toast.success(t("selectedOk", { name: r.now || name }));
      else toast.error(r.error || t("selectFailed"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(false);
    }
  };

  const doDelete = async (name: string) => {
    if (!window.confirm(t("deleteConfirm", { name }))) return;
    try {
      const r = await ntRequest<OpResult>("DELETE", `/nodes/${encodeURIComponent(name)}`);
      if (r.error) toast.error(r.error);
      else toast.success(t("deletedOk", { name }));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const nodes = state?.nodes || [];
  const connected = state?.mihomo?.connected;

  return (
    <div className="space-y-6">
      {/* Status card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <Server className="w-5 h-5" />
            {t("statusTitle")}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={() => void load()} title={t("refresh")}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            {loading ? (
              <span className="text-muted-foreground">{t("loading")}</span>
            ) : connected ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CircleCheck className="w-4 h-4" />
                {t("connected")} {state?.mihomo?.version ? `v${state.mihomo.version}` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                <CircleX className="w-4 h-4" />
                {t("disconnected")}
              </span>
            )}
            {state?.main_group ? (
              <span className="text-muted-foreground">
                · {t("mainGroup")}: {state.main_group}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>{t("currentSelect")}</Label>
              <Select
                value={state?.main_now || ""}
                disabled={selecting}
                onValueChange={(v) => void doSelect(v)}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder={t("selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {(state?.main_options || []).map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add node card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <PlusCircle className="w-5 h-5" />
            {t("addTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("pastePlaceholder")}
            spellCheck={false}
            className="w-full min-h-24 resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="flex flex-wrap items-center gap-4">
            <Button onClick={() => void doAdd()} disabled={busy}>
              {busy ? t("adding") : t("addBtn")}
            </Button>
            <div className="flex items-center gap-2">
              <Switch
                id="nt-auto-select"
                checked={autoSelect}
                onCheckedChange={setAutoSelect}
              />
              <Label htmlFor="nt-auto-select" className="text-sm text-muted-foreground cursor-pointer">
                {t("autoSelect")}
              </Label>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("pasteHint")}</p>
        </CardContent>
      </Card>

      {/* Node list card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <ListTree className="w-5 h-5" />
            {t("listTitle")}
            <span className="text-sm font-normal text-muted-foreground">({nodes.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {nodes.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">{t("colName")}</TableHead>
                  <TableHead>{t("colType")}</TableHead>
                  <TableHead>{t("colServer")}</TableHead>
                  <TableHead>{t("colPort")}</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((n) => (
                  <TableRow key={n.name}>
                    <TableCell className="font-medium">{n.name}</TableCell>
                    <TableCell>{n.type}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {n.server || "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {n.port || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                        onClick={() => void doDelete(n.name)}
                        title={t("delete")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
