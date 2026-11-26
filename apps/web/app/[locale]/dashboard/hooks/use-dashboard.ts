"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useTheme } from "next-themes";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { api, getPresetTimeRange, type TimeRange } from "@/lib/api";
import type {
  BackendStatus,
  TabId,
  TimePreset,
} from "@/lib/types/dashboard";
import {
  getCountriesQueryKey,
  getDevicesQueryKey,
  getSummaryQueryKey,
} from "@/lib/stats-query-keys";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import { useStatsWebSocket, type SummaryField } from "@/lib/websocket";
import { useRequireAuth } from "@/lib/auth";
import { useSettings, type BackendView } from "@/lib/settings";
import { toast } from "sonner";
import {
  isMergedBackendId,
  MERGED_BACKEND_ID,
  type CountryStats,
  type StatsSummary,
} from "@neko-master/shared";

export type { BackendStatus, TabId, TimePreset };

type RollingTimePreset = Exclude<TimePreset, "custom">;

const SUMMARY_WS_MIN_PUSH_MS = 3000;

function isRollingTimePreset(preset: TimePreset): preset is RollingTimePreset {
  return preset !== "custom";
}

export interface UseDashboardReturn {
  // State
  activeTab: TabId;
  timeRange: TimeRange;
  timePreset: TimePreset;
  autoRefresh: boolean;
  isManualRefreshing: boolean;
  showBackendDialog: boolean;
  showAboutDialog: boolean;
  isFirstTime: boolean;
  autoRefreshTick: number;

  // Data
  data: StatsSummary | null;
  countryData: CountryStats[];
  backends: Awaited<ReturnType<typeof api.getBackends>>;
  activeBackend: Awaited<ReturnType<typeof api.getBackends>>[0] | null;
  listeningBackends: Awaited<ReturnType<typeof api.getBackends>>;
  activeBackendId: number | undefined;
  /** True while every collecting backend is shown combined (activeBackendId is the reserved merged id). */
  isMergedView: boolean;
  backendStatus: BackendStatus;
  backendStatusHint: string | null;
  queryError: string | null;
  wsConnected: boolean;
  wsRealtimeActive: boolean;
  isLoading: boolean;
  isTransitioning: boolean;

  // Actions
  setActiveTab: (tab: TabId) => void;
  setAutoRefresh: (value: boolean | ((prev: boolean) => boolean)) => void;
  setShowBackendDialog: (value: boolean) => void;
  setShowAboutDialog: (value: boolean) => void;
  handleTimeRangeChange: (range: TimeRange, preset: TimePreset) => void;
  handleSwitchBackend: (backendId: number) => Promise<void>;
  handleBackendChange: () => Promise<void>;
  setBackendView: (view: BackendView) => void;
  refreshNow: (showLoading?: boolean) => Promise<void>;

  // Theme
  theme: string | undefined;
  setTheme: (theme: string) => void;

  // Locale/Router
  locale: string;
  router: ReturnType<typeof useRouter>;
  pathname: string;

  // Translations
  t: ReturnType<typeof useTranslations>;
  dashboardT: ReturnType<typeof useTranslations>;
  backendT: ReturnType<typeof useTranslations>;
}

export function useDashboard(): UseDashboardReturn {
  const t = useTranslations("nav");
  const dashboardT = useTranslations("dashboard");
  const backendT = useTranslations("backend");
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const { settings, setSettings } = useSettings();

  // Locale from next-intl context — robust against route structure changes,
  // unlike parsing the pathname.
  const locale = useLocale();

  // UI State
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [timeRange, setTimeRange] = useState<TimeRange>(getPresetTimeRange("24h"));
  const [timePreset, setTimePreset] = useState<TimePreset>("24h");
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoRefreshTick, setAutoRefreshTick] = useState(0);
  const [showBackendDialog, setShowBackendDialog] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);

  const stableTimeRange = useStableTimeRange(timeRange, {
    roundToMinute: isRollingTimePreset(timePreset),
  });
  const isWsSummaryTab =
    activeTab === "overview" ||
    activeTab === "countries" ||
    activeTab === "proxies" ||
    activeTab === "rules" ||
    activeTab === "devices";

  const wsSummaryFields = useMemo<SummaryField[] | undefined>(() => {
    switch (activeTab) {
      case "overview":
        return ["totals", "topDomains", "proxyStats", "countryStats"];
      case "countries":
        return ["countryStats"];
      case "proxies":
        return ["proxyStats"];
      case "rules":
        return ["totals"];
      case "devices":
        return ["deviceStats"];
      default:
        return undefined;
    }
  }, [activeTab]);

  const wsSummaryFieldSet = useMemo(() => {
    return new Set<SummaryField>(wsSummaryFields ?? []);
  }, [wsSummaryFields]);
  
  // Auth check
  const { showLogin, isLoading: isAuthLoading } = useRequireAuth();
  const shouldFetch = !showLogin && !isAuthLoading;

  // Backends Query
  const backendsQuery = useQuery({
    queryKey: ["backends"],
    queryFn: () => api.getBackends(),
    refetchInterval: autoRefresh ? 5000 : false,
    refetchIntervalInBackground: true,
    enabled: shouldFetch,
  });

  const backends = backendsQuery.data ?? [];
  const activeBackend = useMemo(
    () => backends.find((backend) => backend.is_active) || backends[0] || null,
    [backends]
  );
  const listeningBackends = useMemo(
    () => backends.filter((backend) => backend.listening),
    [backends]
  );
  // The merged view needs something to merge; otherwise fall back to the active backend.
  const prefersMergedView = settings.backendView === "merged";
  const isMergedView = prefersMergedView && listeningBackends.length > 1;
  const activeBackendId = isMergedView ? MERGED_BACKEND_ID : activeBackend?.id;

  // WebSocket
  const wsEnabled = autoRefresh && isWsSummaryTab && !!activeBackendId;
  const { status: wsStatus, lastMessage: wsSummary } = useStatsWebSocket({
    backendId: activeBackendId,
    range: stableTimeRange,
    minPushIntervalMs: SUMMARY_WS_MIN_PUSH_MS,
    summaryFields: wsSummaryFields,
    enabled: wsEnabled,
    onMessage: useCallback(
      (stats: StatsSummary) => {
        if (!activeBackendId) return;
        setAutoRefreshTick((tick) => (tick + 1) % 3600);

        const summaryPatch: Partial<StatsSummary> = {};

        if (wsSummaryFieldSet.has("totals")) {
          summaryPatch.totalUpload = stats.totalUpload;
          summaryPatch.totalDownload = stats.totalDownload;
          summaryPatch.totalConnections = stats.totalConnections;
          summaryPatch.totalDomains = stats.totalDomains;
          summaryPatch.totalIPs = stats.totalIPs;
          summaryPatch.totalProxies = stats.totalProxies;
          summaryPatch.totalRules = stats.totalRules;
        }
        if (wsSummaryFieldSet.has("topDomains")) {
          summaryPatch.topDomains = stats.topDomains;
        }
        if (wsSummaryFieldSet.has("topIPs")) {
          summaryPatch.topIPs = stats.topIPs;
        }
        if (wsSummaryFieldSet.has("proxyStats")) {
          summaryPatch.proxyStats = stats.proxyStats;
        }
        if (wsSummaryFieldSet.has("countryStats") && stats.countryStats) {
          summaryPatch.countryStats = stats.countryStats;
        }
        if (wsSummaryFieldSet.has("deviceStats") && stats.deviceStats) {
          summaryPatch.deviceStats = stats.deviceStats;
        }
        if (wsSummaryFieldSet.has("ruleStats") && stats.ruleStats) {
          summaryPatch.ruleStats = stats.ruleStats;
        }
        if (wsSummaryFieldSet.has("hourlyStats")) {
          summaryPatch.hourlyStats = stats.hourlyStats;
        }

        queryClient.setQueryData(
          getSummaryQueryKey(activeBackendId, stableTimeRange),
          (previous) => ({
            ...(typeof previous === "object" && previous ? previous : {}),
            ...summaryPatch,
          })
        );
        if (stats.countryStats) {
          queryClient.setQueryData(
            getCountriesQueryKey(activeBackendId, 50, stableTimeRange),
            stats.countryStats
          );
        }
        if (stats.deviceStats) {
          queryClient.setQueryData(
            getDevicesQueryKey(activeBackendId, 50, stableTimeRange),
            stats.deviceStats
          );
        }
      },
      [activeBackendId, queryClient, stableTimeRange, wsSummaryFieldSet]
    ),
  });

  const wsConnected = wsStatus === "connected";
  const wsRealtimeActive = wsEnabled && wsConnected;
  const shouldReducePolling = wsRealtimeActive;
  const shouldUseHttpFallback =
    !wsEnabled || wsStatus === "disconnected" || wsStatus === "error" || wsStatus === "connecting";
  const fallbackRefetchInterval =
    autoRefresh && isWsSummaryTab && shouldUseHttpFallback ? 5000 : false;
  const hasWsCountries =
    wsRealtimeActive &&
    !!wsSummary?.countryStats &&
    (activeTab === "overview" || activeTab === "countries");

  const needsSummaryData =
    activeTab === "overview" || activeTab === "proxies" || activeTab === "rules" || activeTab === "devices";
  const needsCountries = activeTab === "overview" || activeTab === "countries";

  // Stats Queries
  const summaryQuery = useQuery({
    queryKey: getSummaryQueryKey(activeBackendId, stableTimeRange),
    queryFn: () => api.getSummary(activeBackendId, stableTimeRange),
    enabled: !!activeBackendId && needsSummaryData && shouldUseHttpFallback,
    placeholderData: keepPreviousData,
    refetchInterval: fallbackRefetchInterval,
    refetchIntervalInBackground: true,
  });

  const countriesQuery = useQuery({
    queryKey: getCountriesQueryKey(activeBackendId, 50, stableTimeRange),
    queryFn: () => api.getCountries(activeBackendId, 50, stableTimeRange),
    enabled: !!activeBackendId && needsCountries && !hasWsCountries && shouldUseHttpFallback,
    placeholderData: keepPreviousData,
    refetchInterval: needsCountries ? fallbackRefetchInterval : false,
    refetchIntervalInBackground: true,
  });

  const data: StatsSummary | null =
    (wsEnabled && wsConnected && wsSummary) || summaryQuery.data || null;
  const countryData: CountryStats[] =
    (hasWsCountries ? wsSummary?.countryStats : countriesQuery.data) ?? [];

  // Errors
  const summaryError = useMemo(() => {
    if (!summaryQuery.error) return null;
    return summaryQuery.error instanceof Error
      ? summaryQuery.error.message
      : "Unknown error";
  }, [summaryQuery.error]);
  const effectiveSummaryError = wsEnabled && wsConnected ? null : summaryError;

  const countriesError = useMemo(() => {
    if (!countriesQuery.error) return null;
    return countriesQuery.error instanceof Error
      ? countriesQuery.error.message
      : "Unknown error";
  }, [countriesQuery.error]);
  const effectiveCountriesError = hasWsCountries ? null : countriesError;

  const queryError = effectiveSummaryError ?? effectiveCountriesError;
  const isSummaryTransitioning =
    needsSummaryData &&
    shouldUseHttpFallback &&
    (summaryQuery.isLoading || summaryQuery.isFetching);

  // Backend Status
  const backendStatus: BackendStatus = useMemo(() => {
    if (isMergedView) {
      if (effectiveSummaryError) return "unhealthy";
      // The combined view only breaks down when every member is down.
      if (listeningBackends.every((backend) => backend.health?.status === "unhealthy")) {
        return "unhealthy";
      }
      return "healthy";
    }
    if (!activeBackend) return "unknown";
    if (effectiveSummaryError) return "unhealthy";
    // Prefer the live health-check result when available
    if (activeBackend.health?.status === "unhealthy") return "unhealthy";
    if (activeBackend.health?.status === "healthy") return "healthy";
    // Fallback: infer from listening flag
    if (activeBackend.listening) return "healthy";
    return "unhealthy";
  }, [activeBackend, effectiveSummaryError, isMergedView, listeningBackends]);

  const backendStatusHint = useMemo(() => {
    if (effectiveSummaryError) return effectiveSummaryError;
    if (isMergedView) {
      return backendStatus === "unhealthy" ? dashboardT("backendUnavailableHint") : null;
    }
    if (activeBackend && !activeBackend.listening)
      return dashboardT("backendUnavailableHint");
    return null;
  }, [effectiveSummaryError, activeBackend, dashboardT, isMergedView, backendStatus]);

  // Actions
  const refreshNow = useCallback(
    async (showLoading = false) => {
      if (showLoading) {
        setIsManualRefreshing(true);
      }
      try {
        if (isRollingTimePreset(timePreset)) {
          setTimeRange(getPresetTimeRange(timePreset));
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["stats"] }),
          queryClient.invalidateQueries({ queryKey: ["backends"] }),
        ]);
      } finally {
        if (showLoading) {
          setIsManualRefreshing(false);
        }
      }
    },
    [queryClient, timePreset]
  );

  const handleTimeRangeChange = useCallback(
    (range: TimeRange, preset: TimePreset) => {
      setTimePreset(preset);
      setTimeRange(range);
    },
    []
  );

  const setBackendView = useCallback(
    (view: BackendView) => setSettings({ backendView: view }),
    [setSettings]
  );

  const handleSwitchBackend = useCallback(
    async (backendId: number) => {
      // The merged view is a client-side choice; there is nothing to activate.
      if (isMergedBackendId(backendId)) {
        if (isMergedView) return;
        setBackendView("merged");
        await refreshNow(true);
        return;
      }

      try {
        await api.setActiveBackend(backendId);
        const { data: latestBackends } = await backendsQuery.refetch();
        // Leave the merged view only once the refreshed list shows the chosen
        // backend as active, so the dashboard never flashes the previous one.
        if (prefersMergedView) {
          setBackendView("single");
        }
        await refreshNow(true);
        
        // Check backend health after switching (use fresh data from refetch)
        const switchedBackend = latestBackends?.find(b => b.id === backendId);
        if (switchedBackend?.health?.status === 'unhealthy') {
          toast.warning(
            dashboardT("backendUnhealthyTitle"), 
            {
              description: switchedBackend.health.message || dashboardT("backendUnhealthyDesc"),
              duration: 5000,
            }
          );
        }
      } catch (err) {
        console.error("Failed to switch backend:", err);
      }
    },
    [backendsQuery.refetch, refreshNow, dashboardT, prefersMergedView, setBackendView, isMergedView]
  );

  const handleBackendChange = useCallback(async () => {
    await backendsQuery.refetch();
    await refreshNow(true);
  }, [backendsQuery.refetch, refreshNow]);

  // Effects

  // Open setup dialog automatically when no backend is configured
  useEffect(() => {
    // Don't open backend dialog if we need to login
    if (showLogin) return;
    
    if (backendsQuery.isError) return;
    // Strictly check if data is present to avoid "empty" state during initial loading/idle
    if (!backendsQuery.data && !backendsQuery.isSuccess) return;
    if (backendsQuery.isLoading || backendsQuery.isFetching) return;
    
    if (backends.length === 0) {
      setIsFirstTime(true);
      setShowBackendDialog(true);
      return;
    }
    if (isFirstTime) {
      setIsFirstTime(false);
    }
  }, [
    backends.length,
    backendsQuery.isError,
    backendsQuery.isFetching,
    backendsQuery.isLoading,
    isFirstTime,
    showLogin,
  ]);

  // Rolling presets: keep the time window moving
  useEffect(() => {
    if (!autoRefresh || !isRollingTimePreset(timePreset)) return;
    const intervalMs =
      activeTab === "rules" ? 30000 : shouldReducePolling ? 30000 : 5000;
    const interval = setInterval(() => {
      setAutoRefreshTick((tick) => (tick + 1) % 3600);
      setTimeRange(getPresetTimeRange(timePreset));
    }, intervalMs);
    return () => clearInterval(interval);
  }, [activeTab, autoRefresh, shouldReducePolling, timePreset]);

  // Fixed presets: keep HTTP polling only when WS realtime is not active
  useEffect(() => {
    if (!autoRefresh || isRollingTimePreset(timePreset) || wsRealtimeActive)
      return;
    const intervalMs = 5000;
    const interval = setInterval(() => {
      setAutoRefreshTick((tick) => (tick + 1) % 3600);
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [autoRefresh, queryClient, wsRealtimeActive, timePreset]);

  return {
    // State
    activeTab,
    timeRange,
    timePreset,
    autoRefresh,
    isManualRefreshing,
    showBackendDialog,
    showAboutDialog,
    isFirstTime,
    autoRefreshTick,

    // Data
    data,
    countryData,
    backends,
    activeBackend,
    listeningBackends,
    activeBackendId,
    isMergedView,
    backendStatus,
    backendStatusHint,
    queryError,
    wsConnected,
    wsRealtimeActive,
    isLoading: summaryQuery.isLoading || (backendsQuery.isLoading && !backends.length),
    isTransitioning: (isSummaryTransitioning || isManualRefreshing) && !queryError,

    // Actions
    setActiveTab,
    setAutoRefresh,
    setShowBackendDialog,
    setShowAboutDialog,
    handleTimeRangeChange,
    handleSwitchBackend,
    handleBackendChange,
    setBackendView,
    refreshNow,

    // Theme
    theme,
    setTheme,

    // Locale/Router
    locale,
    router,
    pathname,

    // Translations
    t,
    dashboardT,
    backendT,
  };
}
