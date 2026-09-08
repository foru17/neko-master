"use client";

import { useState, memo } from "react";
import { useTranslations } from "next-intl";
import {
  keepPreviousData,
  useQuery,
} from "@tanstack/react-query";
import { BarChart3, Link2 } from "lucide-react";
import { StatsCards, TopDomainsChart } from "@/components/features/stats";
import { OverviewTab } from "@/components/overview";
import { InteractiveProxyStats } from "@/components/features/proxies";
import { InteractiveDeviceStats } from "@/components/features/devices";
import { InteractiveRuleStats } from "@/components/features/rules";
import { HealthContent } from "@/components/features/health";
import { NodesContent } from "@/components/features/nodes";
import { DaemonContent } from "@/components/features/daemon";
import { RuleCfgContent } from "@/components/features/rulecfg";
import { DiagContent } from "@/components/features/diag";
import { OpsContent } from "@/components/features/ops";
import { WorldTrafficMap, CountryTrafficList } from "@/components/features/countries";
import { DomainsTable, IPsTable } from "@/components/features/stats/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InsightThreePanelSkeleton } from "@/components/ui/insight-skeleton";
import { api, type TimeRange } from "@/lib/api";
import { getDevicesQueryKey } from "@/lib/stats-query-keys";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import { cn } from "@/lib/utils";
import type { BackendStatus, TabId, TimePreset } from "@/lib/types/dashboard";
import type {
  StatsSummary,
  CountryStats,
  DeviceStats,
  ProxyStats,
} from "@neko-master/shared";
import type { PageSize } from "@/lib/stats-utils";

interface ContentProps {
  activeTab: TabId;
  data: StatsSummary | null;
  countryData: CountryStats[];
  error: string | null;
  timeRange: TimeRange;
  timePreset: TimePreset;
  autoRefresh: boolean;
  activeBackendId?: number;
  backendStatus: BackendStatus;
  onNavigate?: (tab: string) => void;
  isLoading?: boolean;
  isTransitioning?: boolean;
}

// Overview Content Component
const OverviewContent = memo(function OverviewContent({
  data,
  countryData,
  error,
  timeRange,
  timePreset,
  autoRefresh,
  activeBackendId,
  onNavigate,
  backendStatus,
  isLoading,
}: {
  data: StatsSummary | null;
  countryData: CountryStats[];
  error: string | null;
  timeRange: TimeRange;
  timePreset: TimePreset;
  autoRefresh: boolean;
  activeBackendId?: number;
  onNavigate?: (tab: string) => void;
  backendStatus: BackendStatus;
  isLoading?: boolean;
}) {
  return (
    <div className="space-y-6">
      <StatsCards 
        data={data} 
        error={error} 
        backendStatus={backendStatus} 
        isLoading={isLoading} 
      />
      <OverviewTab
        domains={data?.topDomains || []}
        proxies={data?.proxyStats || []}
        countries={countryData}
        timeRange={timeRange}
        timePreset={timePreset}
        autoRefresh={autoRefresh}
        activeBackendId={activeBackendId}
        onNavigate={onNavigate}
        backendStatus={backendStatus}
        isLoading={isLoading}
      />
    </div>
  );
});

// Domains Content Component
const DomainsContent = memo(function DomainsContent({
  activeBackendId,
  timeRange,
  autoRefresh,
}: {
  activeBackendId?: number;
  timeRange: TimeRange;
  autoRefresh: boolean;
}) {
  const t = useTranslations("domains");
  const [sharedPageSize, setSharedPageSize] = useState<PageSize>(10);

  return (
    <div className="space-y-6">
      <TopDomainsChart
        activeBackendId={activeBackendId}
        timeRange={timeRange}
      />
      <Tabs defaultValue="domains" className="w-full">
        <TabsList className="glass">
          <TabsTrigger value="domains">{t("domainList")}</TabsTrigger>
          <TabsTrigger value="ips">{t("ipList")}</TabsTrigger>
        </TabsList>
        <TabsContent value="domains" className="overflow-hidden">
          <DomainsTable
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            autoRefresh={autoRefresh}
            pageSize={sharedPageSize}
            onPageSizeChange={setSharedPageSize}
          />
        </TabsContent>
        <TabsContent value="ips" className="overflow-hidden">
          <IPsTable
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            autoRefresh={autoRefresh}
            pageSize={sharedPageSize}
            onPageSizeChange={setSharedPageSize}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
});

// Countries Content Component
const CountriesContent = memo(function CountriesContent({
  countryData,
}: {
  countryData: CountryStats[];
}) {
  const t = useTranslations("countries");
  const [sortBy, setSortBy] = useState<"traffic" | "connections">("traffic");

  return (
    <div className="space-y-6">
      <WorldTrafficMap data={countryData} />
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg font-semibold">
              {t("details")}
            </CardTitle>
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md transition-all",
                  sortBy === "traffic"
                    ? "bg-background shadow-sm text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setSortBy("traffic")}
                title={t("sortByTraffic")}
                aria-label={t("sortByTraffic")}
              >
                <BarChart3 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md transition-all",
                  sortBy === "connections"
                    ? "bg-background shadow-sm text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setSortBy("connections")}
                title={t("sortByConnections")}
                aria-label={t("sortByConnections")}
              >
                <Link2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <CountryTrafficList data={countryData} sortBy={sortBy} />
        </CardContent>
      </Card>
    </div>
  );
});

// Proxies Content Component
const ProxiesContent = memo(function ProxiesContent({
  data,
  activeBackendId,
  timeRange,
  backendStatus,
  autoRefresh,
}: {
  data?: ProxyStats[];
  activeBackendId?: number;
  timeRange: TimeRange;
  backendStatus: BackendStatus;
  autoRefresh: boolean;
}) {
  return (
    <div className="space-y-6">
      <InteractiveProxyStats
        data={data}
        activeBackendId={activeBackendId}
        timeRange={timeRange}
        backendStatus={backendStatus}
        autoRefresh={autoRefresh}
      />
    </div>
  );
});

// Rules Content Component
const RulesContent = memo(function RulesContent({
  activeBackendId,
  timeRange,
  backendStatus,
  autoRefresh,
}: {
  activeBackendId?: number;
  timeRange: TimeRange;
  backendStatus: BackendStatus;
  autoRefresh: boolean;
}) {
  return (
    <div className="space-y-6">
      <InteractiveRuleStats
        activeBackendId={activeBackendId}
        timeRange={timeRange}
        backendStatus={backendStatus}
        autoRefresh={autoRefresh}
      />
    </div>
  );
});

// Devices Content Component
const DevicesContent = memo(function DevicesContent({
  data,
  activeBackendId,
  timeRange,
  backendStatus,
  autoRefresh,
}: {
  data?: DeviceStats[];
  activeBackendId?: number;
  timeRange: TimeRange;
  backendStatus: BackendStatus;
  autoRefresh: boolean;
}) {
  const stableTimeRange = useStableTimeRange(timeRange, { roundToMinute: true });

  const devicesQuery = useQuery({
    queryKey: getDevicesQueryKey(activeBackendId, 50, stableTimeRange),
    queryFn: () => api.getDevices(activeBackendId, 50, stableTimeRange),
    enabled: !data && !!activeBackendId,
    placeholderData: keepPreviousData,
  });

  const deviceStats: DeviceStats[] = data ?? devicesQuery.data ?? [];
  const loading = !data && devicesQuery.isLoading && !devicesQuery.data;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6">
          <InsightThreePanelSkeleton />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <InteractiveDeviceStats
        data={deviceStats}
        activeBackendId={activeBackendId}
        timeRange={timeRange}
        backendStatus={backendStatus}
        autoRefresh={autoRefresh}
      />
    </div>
  );
});

// Network Content Component
const NetworkContent = memo(function NetworkContent() {
  const t = useTranslations("network");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _typeCheck: TabId = "overview"; // Ensure TabId type is imported
  return (
    <div className="space-y-6">
      <div className="p-12 text-center text-muted-foreground border rounded-xl">
        <p>{t("comingSoon")}</p>
      </div>
    </div>
  );
});

export function Content({
  activeTab,
  data,
  countryData,
  error,
  timeRange,
  timePreset,
  autoRefresh,
  activeBackendId,
  backendStatus,
  onNavigate,
  isTransitioning,
}: ContentProps) {
  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return (
          <OverviewContent
            data={data}
            countryData={countryData}
            error={error}
            timeRange={timeRange}
            timePreset={timePreset}
            autoRefresh={autoRefresh}
            activeBackendId={activeBackendId}
            onNavigate={onNavigate}
            backendStatus={backendStatus}
          />
        );
      case "domains":
        return (
          <DomainsContent
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            autoRefresh={autoRefresh}
          />
        );
      case "countries":
        return <CountriesContent countryData={countryData} />;
      case "proxies":
        return (
          <ProxiesContent
            data={data?.proxyStats}
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            backendStatus={backendStatus}
            autoRefresh={autoRefresh}
          />
        );
      case "rules":
        return (
          <RulesContent
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            backendStatus={backendStatus}
            autoRefresh={autoRefresh}
          />
        );
      case "devices":
        return (
          <DevicesContent
            data={data?.deviceStats}
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            backendStatus={backendStatus}
            autoRefresh={autoRefresh}
          />
        );
      case "network":
        return <NetworkContent />;
      case "health":
        return <HealthContent timeRange={timeRange} />;
      case "nodes":
        return <NodesContent />;
      case "daemon":
        return <DaemonContent />;
      case "rulecfg":
        return <RuleCfgContent />;
      case "diag":
        return <DiagContent />;
      case "ops":
        return <OpsContent />;
      default:
        return (
          <OverviewContent
            data={data}
            countryData={countryData}
            error={error}
            timeRange={timeRange}
            timePreset={timePreset}
            autoRefresh={autoRefresh}
            activeBackendId={activeBackendId}
            onNavigate={onNavigate}
            backendStatus={backendStatus}
          />
        );
    }
  };

  return (
    <div>
      {renderContent()}
    </div>
  );
}
