"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Waypoints, Loader2 } from "lucide-react";
import { validateProxyNameAliases, type ProxyNameAlias } from "@neko-master/shared";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getProxyNameAliasesQueryKey } from "@/lib/stats-query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function AliasEditor({ backendId, disabled }: { backendId: number; disabled: boolean }) {
  const t = useTranslations("proxyNameAliases");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ProxyNameAlias[] | null>(null);
  const query = useQuery({
    queryKey: getProxyNameAliasesQueryKey(backendId),
    queryFn: () => api.getProxyNameAliases(backendId),
  });
  const rules = draft ?? query.data?.rules ?? [];
  const mutation = useMutation({
    mutationFn: (value: ProxyNameAlias[]) => api.updateProxyNameAliases(backendId, value),
    onSuccess: async (data) => {
      queryClient.setQueryData(getProxyNameAliasesQueryKey(backendId), data);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
      toast.success(t("saved"));
    },
    onError: () => toast.error(t("saveError")),
  });
  const locked = disabled || mutation.isPending;
  const update = (index: number, value: Partial<ProxyNameAlias>) =>
    setDraft(rules.map((rule, i) => i === index ? { ...rule, ...value } : rule));
  const save = () => {
    try {
      mutation.mutate(validateProxyNameAliases(rules));
    } catch {
      toast.error(t("invalidRules"));
    }
  };

  if (query.isPending) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>;
  if (query.isError) return <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{t("loadError")}</p><Button variant="outline" onClick={() => query.refetch()}>{t("retry")}</Button></div>;

  return (
    <div className="space-y-3">
      {rules.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      {rules.map((rule, index) => (
        <div key={index} className="space-y-2 rounded-lg border border-border bg-background p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`proxy-alias-match-${backendId}-${index}`}>{t("match")}</Label>
              <Select value={rule.match} disabled={locked} onValueChange={(match: ProxyNameAlias["match"]) => update(index, { match })}>
                <SelectTrigger id={`proxy-alias-match-${backendId}-${index}`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="prefix">{t("prefix")}</SelectItem><SelectItem value="exact">{t("exact")}</SelectItem></SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="icon" disabled={locked} aria-label={t("remove")}
              onClick={() => setDraft(rules.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor={`proxy-alias-value-${backendId}-${index}`}>{t("value")}</Label>
              <Input id={`proxy-alias-value-${backendId}-${index}`} value={rule.value} maxLength={256} disabled={locked}
                placeholder={t("valuePlaceholder")} onChange={(event) => update(index, { value: event.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor={`proxy-alias-name-${backendId}-${index}`}>{t("alias")}</Label>
              <Input id={`proxy-alias-name-${backendId}-${index}`} value={rule.alias} maxLength={256} disabled={locked}
                placeholder={t("aliasPlaceholder")} onChange={(event) => update(index, { alias: event.target.value })} /></div>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={locked || rules.length >= 50}
          onClick={() => setDraft([...rules, { match: "prefix", value: "", alias: "" }])}><Plus className="mr-2 h-4 w-4" />{t("add")}</Button>
        <Button disabled={locked || draft === null} onClick={save}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("save")}</Button>
        {draft !== null && <Button variant="ghost" disabled={locked} onClick={() => setDraft(null)}>{t("discard")}</Button>}
      </div>
    </div>
  );
}

export function ProxyNameAliasSettings({ backends, disabled }: {
  backends: Array<{ id: number; name: string; is_active?: boolean | number }>;
  disabled: boolean;
}) {
  const t = useTranslations("proxyNameAliases");
  const [selected, setSelected] = useState<number | null>(null);
  const backendId = backends.find(backend => backend.id === selected)?.id
    ?? backends.find(backend => backend.is_active)?.id ?? backends[0]?.id;
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-medium"><Waypoints className="h-4 w-4" />{t("title")}</h4>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <p className="text-xs text-muted-foreground">{t("precedence")}</p>
      </div>
      {backendId === undefined ? <p className="text-sm text-muted-foreground">{t("noBackends")}</p> : <>
        <div className="space-y-1"><Label htmlFor="proxy-alias-backend">{t("backend")}</Label>
          <Select value={String(backendId)} onValueChange={(value) => setSelected(Number(value))}>
            <SelectTrigger id="proxy-alias-backend" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{backends.map(backend => <SelectItem key={backend.id} value={String(backend.id)}>{backend.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <AliasEditor key={backendId} backendId={backendId} disabled={disabled} />
      </>}
    </div>
  );
}
