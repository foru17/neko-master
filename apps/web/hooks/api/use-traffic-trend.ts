import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api, type TimeRange } from "@/lib/api";
import { getTrafficTrendQueryKey } from "@/lib/stats-query-keys";

import { QUERY_CONFIG } from "@/lib/query-config";

interface UseTrafficTrendOptions {
  activeBackendId?: number;
  minutes?: number;
  bucketMinutes?: number;
  tzOffsetMinutes?: number;
  range?: TimeRange;
  enabled?: boolean;
  refetchInterval?: number | false | ((query: any) => number | false);
}

const TREND_CACHE_TTL_MS = QUERY_CONFIG.STALE_TIME.DETAIL;

export function useTrafficTrend({
  activeBackendId,
  minutes = 30,
  bucketMinutes = 1,
  tzOffsetMinutes,
  range,
  enabled = true,
  refetchInterval,
}: UseTrafficTrendOptions) {
  return useQuery({
    queryKey: getTrafficTrendQueryKey(activeBackendId, minutes, bucketMinutes, range, tzOffsetMinutes),
    queryFn: async () => {
      if (!activeBackendId) throw new Error("Backend ID is required");
      return api.getTrafficTrendAggregated(
        activeBackendId,
        minutes,
        bucketMinutes,
        range,
        tzOffsetMinutes
      );
    },
    enabled: !!activeBackendId && enabled,
    placeholderData: keepPreviousData,
    staleTime: TREND_CACHE_TTL_MS,
    gcTime: 5 * 60 * 1000, 
    refetchInterval,
  });
}
