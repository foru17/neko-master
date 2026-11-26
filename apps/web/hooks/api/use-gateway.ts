"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isMergedBackendId } from "@neko-master/shared";
import { api } from "@/lib/api";
import { QUERY_CONFIG } from "@/lib/query-config";

const PROVIDERS_KEY = "gatewayProviders";
const PROXIES_KEY = "gatewayProxies";
const RULES_KEY = "gatewayRules";

interface UseGatewayOptions {
  activeBackendId?: number;
  enabled?: boolean;
}

/**
 * 获取 Gateway Providers (带缓存)
 */
export function useGatewayProviders({
  activeBackendId,
  enabled = true,
}: UseGatewayOptions) {
  // Live gateway state belongs to a single gateway, so the merged view has
  // none and must not borrow the previous backend's data as a placeholder.
  const isMerged = isMergedBackendId(activeBackendId);
  return useQuery({
    queryKey: [PROVIDERS_KEY, { backendId: activeBackendId }],
    queryFn: () => api.getGatewayProviders(activeBackendId),
    enabled: !!activeBackendId && enabled && !isMerged,
    staleTime: 5 * 60 * 1000, // 5 分钟
    placeholderData: isMerged ? undefined : (previous) => previous,
  });
}

/**
 * 获取 Gateway Proxies (带缓存)
 */
export function useGatewayProxies({
  activeBackendId,
  enabled = true,
}: UseGatewayOptions) {
  const isMerged = isMergedBackendId(activeBackendId);
  return useQuery({
    queryKey: [PROXIES_KEY, { backendId: activeBackendId }],
    queryFn: () => api.getGatewayProxies(activeBackendId),
    enabled: !!activeBackendId && enabled && !isMerged,
    staleTime: 5 * 60 * 1000, // 5 分钟
    placeholderData: isMerged ? undefined : (previous) => previous,
  });
}

/**
 * 获取 Gateway Rules (带缓存)
 * 注意: useGatewayRules 在 use-rules.ts 中已定义，这里导出以避免重复
 */
export { useGatewayRules as useGatewayRules } from "./use-rules";

/**
 * 刷新所有 Gateway 缓存
 */
export function useRefreshGatewayData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (backendId?: number) => {
      const [providers, proxies, rules] = await Promise.all([
        api.getGatewayProviders(backendId),
        api.getGatewayProxies(backendId),
        api.getGatewayRules(backendId),
      ]);
      return { providers, proxies, rules };
    },
    onSuccess: (data, backendId) => {
      // 更新缓存
      queryClient.setQueryData([PROVIDERS_KEY, { backendId }], data.providers);
      queryClient.setQueryData([PROXIES_KEY, { backendId }], data.proxies);
      queryClient.setQueryData([RULES_KEY, { backendId }], data.rules);
    },
  });
}

/**
 * 使 Gateway 缓存失效（用于强制刷新）
 */
export function useInvalidateGatewayCache() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: [PROVIDERS_KEY] });
    queryClient.invalidateQueries({ queryKey: [PROXIES_KEY] });
    queryClient.invalidateQueries({ queryKey: [RULES_KEY] });
  };
}
