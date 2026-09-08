"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Radar,
  RefreshCw,
  Globe,
  Zap,
  Search,
  CircleCheck,
  CircleX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
interface EgressInfo {
  main_group?: string;
  main_now?: string;
  proxy_ip?: string;
  proxy_region?: string;
  proxy_org?: string;
  direct_ip?: string;
  egress_error?: string | null;
}

interface SpeedItem {
  name: string;
  type: string;
  delay_ms?: number;
  error?: string;
}

interface SpeedResult {
  results?: SpeedItem[];
  url?: string;
}

interface TraceResult {
  domain?: string;
  found?: boolean;
  error?: string;
  hint?: string;
  rule?: string;
  rule_payload?: string;
  chains?: string[];
  process?: string;
  network?: string;
  type?: string;
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

export function DiagContent() {
  const t = useTranslations("diag");
  const [egress, setEgress] = useState<EgressInfo | null>(null);
  const [egLoading, setEgLoading] = useState(false);
  const [speed, setSpeed] = useState<SpeedItem[] | null>(null);
  const [speedLoading, setSpeedLoading] = useState(false);
  const [domain, setDomain] = useState("");
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  const doEgress = useCallback(async () => {
    setEgLoading(true);
    try {
      const d = await ntRequest<EgressInfo>("GET", "/diag/egress");
      setEgress(d);
    } catch (e) {
      toast.error(t("egFail"), {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setEgLoading(false);
    }
  }, [t]);

  const doSpeed = async () => {
    setSpeedLoading(true);
    setSpeed(null);
    try {
      const d = await ntRequest<SpeedResult>("GET", "/diag/speed");
      setSpeed(d.results || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSpeedLoading(false);
    }
  };

  const doTrace = async () => {
    const d = domain.trim();
    if (!d) {
      toast.error(t("traceInputEmpty"));
      return;
    }
    setTraceLoading(true);
    setTrace(null);
    try {
      const r = await ntRequest<TraceResult>("POST", "/diag/trace", { domain: d });
      setTrace(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTraceLoading(false);
    }
  };

  const delayColor = (ms: number) =>
    ms < 300 ? "text-emerald-600 dark:text-emerald-400" : ms < 800 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  const okItems = (speed || []).filter((s) => s.delay_ms !== undefined);
  const badItems = (speed || []).filter((s) => s.delay_ms === undefined);

  return (
    <div className="space-y-6">
      {/* Egress */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <Globe className="w-5 h-5" />
            {t("egTitle")}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={() => void doEgress()} title={t("refresh")}>
            <RefreshCw className={cn("w-4 h-4", egLoading && "animate-spin")} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {egress ? (
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/50 border">
                <CircleCheck className="w-4 h-4 text-emerald-500" />
                {t("egMain")}: <b>{egress.main_group || "—"}</b> →{" "}
                <b className="text-primary">{egress.main_now || "—"}</b>
              </span>
              {egress.proxy_ip ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/50 border">
                  🌏 {t("egProxyIp")}: <b>{egress.proxy_ip}</b>
                  {egress.proxy_region ? ` · ${egress.proxy_region}` : ""}
                  {egress.proxy_org ? ` · ${egress.proxy_org}` : ""}
                </span>
              ) : null}
              {egress.direct_ip ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/50 border">
                  🏠 {t("egDirectIp")}: {egress.direct_ip}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {t("loading")}
            </div>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed">{t("egHint")}</p>
        </CardContent>
      </Card>

      {/* Speedtest */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <Zap className="w-5 h-5" />
            {t("speedTitle")}
            {speed ? (
              <span className="text-sm font-normal text-muted-foreground">
                ({speed.length})
              </span>
            ) : null}
          </CardTitle>
          <Button onClick={() => void doSpeed()} disabled={speedLoading} size="sm">
            {speedLoading ? t("speedRunning") : t("speedStart")}
          </Button>
        </CardHeader>
        <CardContent>
          {speed === null ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {speedLoading ? t("speedRunning") : t("speedStart")}
            </div>
          ) : speed.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">{t("speedNone")}</div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("speedColName")}</TableHead>
                    <TableHead className="w-20">{t("speedColType")}</TableHead>
                    <TableHead className="w-36 text-right">{t("speedColDelay")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {okItems.concat(badItems).map((r) => (
                    <TableRow key={r.name + r.type}>
                      <TableCell className="text-sm">{r.name}</TableCell>
                      <TableCell className="font-mono text-xs">{r.type}</TableCell>
                      <TableCell className="text-right">
                        {r.delay_ms !== undefined ? (
                          <span className={cn("font-mono text-sm", delayColor(r.delay_ms))}>
                            ⚡ {r.delay_ms} ms
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-rose-500">
                            ✖ {String(r.error || "timeout").slice(0, 24)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trace */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <Search className="w-5 h-5" />
            {t("traceTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void doTrace()}
              placeholder={t("tracePlaceholder")}
              className="font-mono"
            />
            <Button onClick={() => void doTrace()} disabled={traceLoading} className="shrink-0">
              {traceLoading ? t("traceRunning") : t("traceBtn")}
            </Button>
          </div>
          {trace ? (
            trace.error ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
                <CircleX className="w-4 h-4 shrink-0" />
                {trace.error}
                {trace.hint ? ` — ${trace.hint}` : ""}
              </div>
            ) : (
              <div className="rounded-lg border bg-secondary/30 p-3 space-y-1.5 font-mono text-xs">
                <div className="text-sm">🛰 <b>{trace.domain}</b></div>
                <div>
                  {t("traceHit")}: <b>{trace.rule || "—"}</b>
                  {trace.rule_payload ? ` (${trace.rule_payload})` : ""}
                </div>
                <div>
                  {t("traceChain")}:{" "}
                  <span className="text-primary">
                    {(trace.chains || []).slice().reverse().join(" → ") || t("traceDirect")}
                  </span>
                </div>
                {trace.process || trace.type ? (
                  <div className="text-muted-foreground">
                    {trace.process ? `proc: ${trace.process}` : ""}
                    {trace.type ? ` · ${trace.type}` : ""}
                    {trace.network ? `/${trace.network}` : ""}
                  </div>
                ) : null}
              </div>
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
