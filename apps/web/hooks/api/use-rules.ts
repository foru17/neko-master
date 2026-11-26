import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { isMergedBackendId } from "@neko-master/shared";
import { api, type TimeRange } from "@/lib/api";
import {
  getRulesQueryKey,
  getRuleDomainsQueryKey,
  getRuleIPsQueryKey,
} from "@/lib/stats-query-keys";
import { keepPreviousByIdentity } from "@/lib/query-placeholder";
import { QUERY_CONFIG } from "@/lib/query-config";

interface UseRulesOptions {
  activeBackendId?: number;
  limit?: number;
  range?: TimeRange;
  enabled?: boolean;
}

export function useRules({
  activeBackendId,
  limit = QUERY_CONFIG.LIMIT.DEFAULT,
  range,
  enabled = true,
}: UseRulesOptions) {
  return useQuery({
    queryKey: getRulesQueryKey(activeBackendId, limit, range),
    queryFn: () => api.getRules(activeBackendId, limit, range),
    enabled: !!activeBackendId && enabled,
    placeholderData: keepPreviousData,
    staleTime: QUERY_CONFIG.STALE_TIME.REALTIME,
  });
}

interface UseRuleDetailsOptions {
  rule: string | null;
  activeBackendId?: number;
  range?: TimeRange;
  enabled?: boolean;
}

export function useRuleDomains({
  rule,
  activeBackendId,
  range,
  enabled = true,
}: UseRuleDetailsOptions) {
  return useQuery({
    queryKey: getRuleDomainsQueryKey(rule, activeBackendId, range),
    queryFn: () => api.getRuleDomains(rule!, activeBackendId, range, QUERY_CONFIG.LIMIT.DETAIL),
    enabled: !!activeBackendId && !!rule && enabled,
    staleTime: QUERY_CONFIG.STALE_TIME.DETAIL,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousByIdentity(previousData, previousQuery, {
        rule: rule ?? "",
        backendId: activeBackendId ?? null,
      }),
  });
}

export function useRuleIPs({
  rule,
  activeBackendId,
  range,
  enabled = true,
}: UseRuleDetailsOptions) {
  return useQuery({
    queryKey: getRuleIPsQueryKey(rule, activeBackendId, range),
    queryFn: () => api.getRuleIPs(rule!, activeBackendId, range, QUERY_CONFIG.LIMIT.DETAIL),
    enabled: !!activeBackendId && !!rule && enabled,
    staleTime: QUERY_CONFIG.STALE_TIME.DETAIL,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousByIdentity(previousData, previousQuery, {
        rule: rule ?? "",
        backendId: activeBackendId ?? null,
      }),
  });
}

interface UseGatewayRulesOptions {
  activeBackendId?: number;
  enabled?: boolean;
}

export function useGatewayRules({
  activeBackendId,
  enabled = true,
}: UseGatewayRulesOptions) {
  // Live gateway rules belong to a single gateway, so the merged view has
  // none and must not borrow the previous backend's data as a placeholder.
  const isMerged = isMergedBackendId(activeBackendId);
  return useQuery({
    queryKey: ["rules", "gateway", { backendId: activeBackendId }],
    queryFn: () => {
      if (!activeBackendId) throw new Error("Backend ID is required");
      return api.getGatewayRules(activeBackendId);
    },
    enabled: !!activeBackendId && enabled && !isMerged,

    staleTime: QUERY_CONFIG.STALE_TIME.STATIC,
    placeholderData: isMerged ? undefined : keepPreviousData,
  });
}
