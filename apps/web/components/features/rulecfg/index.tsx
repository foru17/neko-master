"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ListTree,
  RefreshCw,
  PlusCircle,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  CircleCheck,
  CircleX,
  Lock,
  FileStack,
  FolderCog,
  Eye,
  Save,
  X,
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ---------- types (mirror the host node-tool /api/rules) ----------
interface RuleItem {
  index: number;
  text: string;
  match?: boolean;
  rule_set?: boolean;
}

interface RulesPayload {
  rules?: RuleItem[];
  targets?: string[];
  groups?: string[];
  types?: string[];
}

interface OpResult {
  message?: string;
  backup?: string;
  reload?: string;
  error?: string;
}

interface ProviderInfo {
  name: string;
  type: string;
  behavior?: string;
  format?: string;
  interval?: number;
  url?: string;
  path?: string;
  editable: boolean;
}

interface ProviderContent {
  name: string;
  path: string;
  behavior: string;
  lines: string[];
}

const TYPE_LABELS: Record<string, string> = {
  DOMAIN: "🌐 Domain",
  "DOMAIN-SUFFIX": "🔗 Domain suffix",
  "DOMAIN-KEYWORD": "🔍 Domain keyword",
  "DOMAIN-REGEX": "🧩 Domain regex",
  GEOIP: "🌏 IP country",
  GEOSITE: "🗂 Geosite category",
  "IP-CIDR": "📡 IP range",
  "IP-CIDR6": "📡 IPv6 range",
  "PROCESS-NAME": "⚙️ Process name",
  "RULE-SET": "📦 Ruleset ref",
};

const NO_RESOLVE_TYPES = new Set(["IP-CIDR", "IP-CIDR6", "GEOIP"]);

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

export function RuleCfgContent() {
  const t = useTranslations("rulecfg");
  const [data, setData] = useState<RulesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingIdx, setEditingIdx] = useState(-1);

  // form state
  const [rType, setRType] = useState("DOMAIN-SUFFIX");
  const [rValue, setRValue] = useState("");
  const [rTarget, setRTarget] = useState("");
  const [rNoResolve, setRNoResolve] = useState(false);
  const [rPosition, setRPosition] = useState("bottom");

  // providers state
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provLoading, setProvLoading] = useState(false);
  const [viewProv, setViewProv] = useState<ProviderInfo | null>(null);
  const [viewContent, setViewContent] = useState<string>("");
  const [editProv, setEditProv] = useState<ProviderInfo | null>(null); // null = closed; {editable:false name} = new
  const [provName, setProvName] = useState("");
  const [provBehavior, setProvBehavior] = useState("domain");
  const [provLines, setProvLines] = useState("");
  const [provBusy, setProvBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await ntRequest<RulesPayload>("GET", "/rules");
      setData(d);
    } catch (e) {
      toast.error(t("loadFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadProviders = useCallback(async () => {
    setProvLoading(true);
    try {
      const d = await ntRequest<{ providers: ProviderInfo[] }>("GET", "/providers");
      setProviders(d.providers || []);
    } catch (e) {
      toast.error(t("provLoadFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setProvLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    void loadProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const types = data?.types || [];
  const targets = data?.targets || [];
  const groupSet = new Set(data?.groups || []);
  const groupTargets = targets.filter((x) => groupSet.has(x));
  const nodeTargets = targets.filter((x) => !groupSet.has(x) && x !== "DIRECT" && x !== "REJECT");
  const builtinTargets = targets.filter((x) => x === "DIRECT" || x === "REJECT");
  const rules = data?.rules || [];

  // pick default target when payload arrives
  useEffect(() => {
    if (!rTarget && groupTargets.length) {
      const def = groupTargets.find((g) => g.includes("默认代理")) || groupTargets[0];
      setRTarget(def);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const preview = (): string | null => {
    const v = rValue.trim();
    if (!v) return null;
    let line = `${rType},${v},${rTarget || ""}`;
    if (rNoResolve && !line.includes("no-resolve")) line += ",no-resolve";
    return line;
  };

  const resetForm = () => {
    setEditingIdx(-1);
    setRValue("");
    setRNoResolve(false);
    setRPosition("bottom");
  };

  const doSave = async () => {
    const text = preview();
    if (!text) {
      toast.error(t("valueRequired"));
      return;
    }
    setBusy(true);
    try {
      let r: OpResult;
      if (editingIdx >= 0) {
        r = await ntRequest<OpResult>("PUT", `/rules/${editingIdx}`, { text });
      } else {
        r = await ntRequest<OpResult>("POST", "/rules", {
          text,
          position: rPosition,
        });
      }
      if (r.error) throw new Error(r.error);
      toast.success(r.message || t("saveOk"));
      resetForm();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doMove = async (idx: number, dir: "up" | "down") => {
    try {
      const r = await ntRequest<OpResult>("POST", `/rules/${idx}/move`, { direction: dir });
      if (r.error) throw new Error(r.error);
      toast.success(r.message || t("movedOk"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doDelete = async (idx: number, text: string) => {
    if (!window.confirm(t("deleteConfirm", { idx: idx + 1, text }))) return;
    try {
      const r = await ntRequest<OpResult>("DELETE", `/rules/${idx}`);
      if (r.error) throw new Error(r.error);
      toast.success(r.message || t("deletedOk"));
      if (editingIdx === idx) resetForm();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /* ---- 规则集操作 ---- */
  const openProvView = async (p: ProviderInfo) => {
    setViewProv(p);
    setViewContent("");
    if (!p.editable) {
      setViewContent(
        t("provRemoteView", {
          url: p.url || "",
          interval: p.interval ?? "—",
        }),
      );
      return;
    }
    try {
      const d = await ntRequest<ProviderContent>(
        "GET",
        `/providers/${encodeURIComponent(p.name)}`,
      );
      setViewContent((d.lines || []).join("\n"));
    } catch (e) {
      setViewContent(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const openProvCreate = () => {
    setEditProv({ name: "", type: "file", editable: true });
    setProvName("");
    setProvBehavior("domain");
    setProvLines("");
  };

  const openProvEdit = async (p: ProviderInfo) => {
    if (!p.editable) return;
    try {
      const d = await ntRequest<ProviderContent>(
        "GET",
        `/providers/${encodeURIComponent(p.name)}`,
      );
      setEditProv(p);
      setProvName(d.name);
      setProvBehavior(d.behavior || "domain");
      setProvLines((d.lines || []).join("\n"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const saveProv = async () => {
    const name = provName.trim();
    if (!name) {
      toast.error(t("provNameRequired"));
      return;
    }
    const lines = provLines.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!lines.length) {
      toast.error(t("provLinesRequired"));
      return;
    }
    setProvBusy(true);
    try {
      const isNew = !editProv || !editProv.name;
      let r: OpResult;
      if (isNew) {
        r = await ntRequest<OpResult>("POST", "/providers", {
          name,
          behavior: provBehavior,
          lines,
        });
      } else {
        r = await ntRequest<OpResult>(
          "PUT",
          `/providers/${encodeURIComponent(editProv.name)}`,
          { behavior: provBehavior, lines },
        );
      }
      if (r.error) throw new Error(r.error);
      toast.success(r.message || t("provSaved"));
      setEditProv(null);
      await loadProviders();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setProvBusy(false);
    }
  };

  const delProv = async (p: ProviderInfo) => {
    if (!p.editable) return;
    if (!window.confirm(t("provDeleteConfirm", { name: p.name }))) return;
    try {
      const r = await ntRequest<OpResult>(
        "DELETE",
        `/providers/${encodeURIComponent(p.name)}`,
      );
      if (r.error) throw new Error(r.error);
      toast.success(r.message || t("provDeleted"));
      await loadProviders();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const startEdit = (item: RuleItem) => {
    if (item.match) {
      toast.error(t("matchProtected"));
      return;
    }
    const parts = item.text.split(",");
    const type = parts[0].trim();
    const last = parts[parts.length - 1].trim();
    const hasNR = last === "no-resolve";
    const targetIdx = hasNR ? parts.length - 2 : parts.length - 1;
    const value = parts.slice(1, hasNR ? parts.length - 2 : parts.length - 1).join(",").trim();
    if (types.includes(type)) setRType(type);
    setRValue(value);
    setRNoResolve(hasNR && NO_RESOLVE_TYPES.has(type));
    const tgt = parts[targetIdx]?.trim() || "";
    if (targets.includes(tgt)) setRTarget(tgt);
    setEditingIdx(item.index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const typeIsNoResolve = NO_RESOLVE_TYPES.has(rType);
  const editing = editingIdx >= 0;
  const groupLabel = (name: string) =>
    name === "DIRECT" ? "DIRECT (直连)" : name === "REJECT" ? "REJECT (拦截)" : name;

  return (
    <div className="space-y-6">
      {/* Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <ListTree className="w-5 h-5" />
            {t("statusTitle")}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={() => void load()} title={t("refresh")}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {t("totalRules", { n: rules.length })}
            </span>
            <span className="text-xs text-muted-foreground/70">· mihomo-node-tool :8008</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{t("help")}</p>
        </CardContent>
      </Card>

      {/* Add / Edit form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            {editing ? <Pencil className="w-4 h-4" /> : <PlusCircle className="w-4 h-4" />}
            {editing ? t("editTitle", { idx: editingIdx + 1 }) : t("addTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("type")}</Label>
              <Select value={rType} onValueChange={(v) => setRType(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map((tp) => (
                    <SelectItem key={tp} value={tp}>
                      {TYPE_LABELS[tp] || tp}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t(`typeHelp.${rType}`, { defaultValue: "" }) || ""}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("target")}</Label>
              <Select value={rTarget} onValueChange={(v) => setRTarget(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {groupTargets.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        策略组
                      </div>
                      {groupTargets.map((g) => (
                        <SelectItem key={g} value={g}>
                          {groupLabel(g)}
                        </SelectItem>
                      ))}
                    </>
                  )}
                  {nodeTargets.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        节点
                      </div>
                      {nodeTargets.map((n) => (
                        <SelectItem key={n} value={n}>
                          {n}
                        </SelectItem>
                      ))}
                    </>
                  )}
                  {builtinTargets.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        内置
                      </div>
                      {builtinTargets.map((b) => (
                        <SelectItem key={b} value={b}>
                          {groupLabel(b)}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("value")}</Label>
              <Input
                value={rValue}
                onChange={(e) => setRValue(e.target.value)}
                placeholder="google.com"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5 flex items-end">
              <div className="flex flex-wrap items-center gap-4 pb-1">
                {typeIsNoResolve && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rNoResolve}
                      onChange={(e) => setRNoResolve(e.target.checked)}
                      className="accent-primary w-4 h-4"
                    />
                    {t("noResolve")}
                  </label>
                )}
                {!editing && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{t("position")}:</span>
                    <Select value={rPosition} onValueChange={(v) => setRPosition(v)}>
                      <SelectTrigger className="w-44 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bottom">{t("positionBottom")}</SelectItem>
                        <SelectItem value="top">{t("positionTop")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-dashed px-3 py-2 font-mono text-xs text-primary">
            {preview() ? `📋 ${preview()}` : t("previewEmpty")}
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => void doSave()} disabled={busy}>
              {busy ? t("saving") : editing ? t("editSaveBtn") : t("addBtn")}
            </Button>
            {editing && (
              <Button variant="outline" onClick={resetForm}>
                {t("cancel")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Rules list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            {t("listTitle")}
            <span className="text-sm font-normal text-muted-foreground">
              ({rules.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t("emptyList")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">{t("colNo")}</TableHead>
                  <TableHead>{t("colRule")}</TableHead>
                  <TableHead className="w-36 text-right">{t("colOps")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.index}>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {r.index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.match && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <Lock className="w-2.5 h-2.5" />
                            {t("matchTag")}
                          </span>
                        )}
                        {r.rule_set && !r.match && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                            <FileStack className="w-2.5 h-2.5" />
                            {t("ruleSetTag")}
                          </span>
                        )}
                        <span className="font-mono text-xs break-all">{r.text}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {r.match ? (
                          <span className="text-muted-foreground/50 text-xs">—</span>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={t("up")}
                              onClick={() => void doMove(r.index, "up")}>
                              <ArrowUp className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={t("down")}
                              onClick={() => void doMove(r.index, "down")}>
                              <ArrowDown className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={t("edit")}
                              onClick={() => startEdit(r)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title={t("delete")}
                              onClick={() => void doDelete(r.index, r.text)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Rule set (rule-providers) card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <FolderCog className="w-5 h-5" />
            {t("provTitle")}
            <span className="text-sm font-normal text-muted-foreground">
              ({t("provCount", { n: providers.length })})
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void loadProviders()}
              title={t("refresh")}>
              <RefreshCw className={cn("w-4 h-4", provLoading && "animate-spin")} />
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={openProvCreate}>
              <PlusCircle className="w-3.5 h-3.5 mr-1" />
              {t("provNew")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">{t("provHint")}</p>
          {providers.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {provLoading ? t("loading") : t("emptyList")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("provColName")}</TableHead>
                  <TableHead className="w-24">{t("provColType")}</TableHead>
                  <TableHead className="w-28">{t("provColBehavior")}</TableHead>
                  <TableHead>{t("provColSource")}</TableHead>
                  <TableHead className="w-32 text-right">{t("colOps")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={p.editable ? "default" : "secondary"}
                          className="text-[10px] px-1.5 py-0 h-4">
                          {p.editable ? t("provLocal") : t("provRemote")}
                        </Badge>
                        <span className="text-sm font-medium">{p.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.type}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.behavior || p.format || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground break-all">
                      {p.editable
                        ? t("provSourceLocal")
                        : (p.url || "").replace(/^https?:\/\//, "").slice(0, 60)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={t("provView")}
                          onClick={() => void openProvView(p)}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {p.editable && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={t("provEdit")}
                              onClick={() => void openProvEdit(p)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title={t("provDelete")}
                              onClick={() => void delProv(p)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* View provider dialog */}
      <Dialog open={viewProv !== null} onOpenChange={(o) => !o && setViewProv(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Eye className="w-4 h-4" />
              {viewProv ? t("provView") + " · " + viewProv.name : ""}
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-[50vh] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all">
            {viewContent || t("loading")}
          </pre>
        </DialogContent>
      </Dialog>

      {/* Create/edit provider dialog */}
      <Dialog
        open={editProv !== null}
        onOpenChange={(o) => !o && setEditProv(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FolderCog className="w-4 h-4" />
              {editProv?.name ? t("provEditTitle", { name: editProv.name }) : t("provNewTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("provNameLabel")}</Label>
              <Input
                value={provName}
                onChange={(e) => setProvName(e.target.value)}
                disabled={!!editProv?.name}
                placeholder="my_list"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("provBehaviorLabel")}</Label>
              <Select value={provBehavior} onValueChange={(v) => setProvBehavior(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="domain">{t("provBehaviorDomain")}</SelectItem>
                  <SelectItem value="ipcidr">{t("provBehaviorIp")}</SelectItem>
                  <SelectItem value="classical">{t("provBehaviorClassical")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("value")}</Label>
            <textarea
              value={provLines}
              onChange={(e) => setProvLines(e.target.value)}
              placeholder={"example.com\ngoogle.com"}
              className="min-h-[200px] w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary resize-y"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProv(null)}>
              <X className="w-3.5 h-3.5 mr-1" />
              {t("provCancel")}
            </Button>
            <Button onClick={() => void saveProv()} disabled={provBusy}>
              <Save className="w-3.5 h-3.5 mr-1" />
              {provBusy ? t("saving") : t("provSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
