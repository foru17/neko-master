"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { BarChart3, Link2, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell as BarCell,
  LabelList,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { type TimeRange } from "@/lib/api";
import {
  getDeviceDomainsQueryKey,
  getDeviceIPsQueryKey,
} from "@/lib/stats-query-keys";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import { useStatsWebSocket } from "@/lib/websocket";
import { Favicon } from "@/components/common";
import {
  DomainStatsTable,
  IPStatsTable,
} from "@/components/features/stats/table";
import { InsightChartSkeleton } from "@/components/ui/insight-skeleton";
import { COLORS, type PageSize } from "@/lib/stats-utils";
import { useDeviceDomains, useDeviceIPs } from "@/hooks/api/use-devices";
import type {
  DeviceStats,
  DomainStats,
  IPStats,
  StatsSummary,
} from "@neko-master/shared";

interface InteractiveDeviceStatsProps {
  data: DeviceStats[];
  activeBackendId?: number;
  timeRange?: TimeRange;
  backendStatus?: "healthy" | "unhealthy" | "unknown";
  autoRefresh?: boolean;
}
const DEVICE_DETAIL_WS_MIN_PUSH_MS = 3_000;

function renderCustomBarLabel(props: any) {
  const { x, y, width, value, height } = props;
  return (
    <text
      x={x + width + 6}
      y={y + height / 2}
      fill="currentColor"
      fontSize={11}
      dominantBaseline="central"
      textAnchor="start"
      style={{ fontVariantNumeric: "tabular-nums" }}>
      {formatBytes(value, 0)}
    </text>
  );
}

export function InteractiveDeviceStats({
  data,
  activeBackendId,
  timeRange,
  backendStatus,
  autoRefresh = true,
}: InteractiveDeviceStatsProps) {
  const t = useTranslations("devices");
  const domainsT = useTranslations("domains");
  const backendT = useTranslations("dashboard");
  const detailTimeRange = useStableTimeRange(timeRange, { roundToMinute: true });
  const queryClient = useQueryClient();

  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("domains");
  const [detailPageSize, setDetailPageSize] = useState<PageSize>(10);
  const [showDomainBarLabels, setShowDomainBarLabels] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 640px)");
    const update = () => setShowDomainBarLabels(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.map((device, index) => {
      // Prefer operator-supplied friendly names (alias > hostname > sourceIP).
      // The three optional fields are an extension point — they may be filled
      // by a sidecar in front of the collector that maps sourceIP to a
      // hostname from a DHCP lease, a static alias, etc.
      const alias = (device as DeviceStats & { alias?: string }).alias;
      const hostname = (device as DeviceStats & { hostname?: string }).hostname;
      const display = alias || hostname || device.sourceIP;
      return {
        name: display,
        rawName: device.sourceIP,
        alias: alias || "",
        hostname: hostname || "",
        value: device.totalDownload + device.totalUpload,
        download: device.totalDownload,
        upload: device.totalUpload,
        connections: device.totalConnections,
        color: COLORS[index % COLORS.length],
        rank: index,
      };
    });
  }, [data]);

  const totalTraffic = useMemo(
    () => chartData.reduce((sum, item) => sum + item.value, 0),
    [chartData],
  );
  const topDevices = useMemo(
    () => [...chartData].sort((a, b) => b.value - a.value).slice(0, 4),
    [chartData],
  );
  const maxTotal = useMemo(
    () => (chartData.length ? Math.max(...chartData.map((d) => d.value)) : 1),
    [chartData],
  );

  useEffect(() => {
    if (chartData.length === 0) {
      setSelectedDevice(null);
      return;
    }
    const exists =
      !!selectedDevice &&
      chartData.some((item) => item.rawName === selectedDevice);
    if (!exists) {
      setSelectedDevice(chartData[0].rawName);
    }
  }, [chartData, selectedDevice]);

  const wsDetailEnabled = autoRefresh && !!activeBackendId && !!selectedDevice;
  const { status: wsDetailStatus } = useStatsWebSocket({
    backendId: activeBackendId,
    range: detailTimeRange,
    minPushIntervalMs: DEVICE_DETAIL_WS_MIN_PUSH_MS,
    includeSummary: false,
    includeDeviceDetails: wsDetailEnabled,
    deviceSourceIP: selectedDevice ?? undefined,
    deviceDetailLimit: 5000,
    trackLastMessage: false,
    enabled: wsDetailEnabled,
    onMessage: useCallback(
      (stats: StatsSummary) => {
        if (!selectedDevice) return;
        if (stats.deviceDetailSourceIP !== selectedDevice) return;

        if (stats.deviceDomains) {
          queryClient.setQueryData(
            getDeviceDomainsQueryKey(
              selectedDevice,
              activeBackendId,
              detailTimeRange,
            ),
            stats.deviceDomains,
          );
        }
        if (stats.deviceIPs) {
          queryClient.setQueryData(
            getDeviceIPsQueryKey(
              selectedDevice,
              activeBackendId,
              detailTimeRange,
            ),
            stats.deviceIPs,
          );
        }
      },
      [selectedDevice, activeBackendId, detailTimeRange, queryClient],
    ),
  });

  const { data: domainsData, isLoading: domainsLoading } = useDeviceDomains({
    sourceIP: selectedDevice ?? undefined,
    activeBackendId,
    range: detailTimeRange,
    enabled: !wsDetailEnabled || wsDetailStatus !== "connected",
  });

  const { data: ipsData, isLoading: ipsLoading } = useDeviceIPs({
    sourceIP: selectedDevice ?? undefined,
    activeBackendId,
    range: detailTimeRange,
    enabled: !wsDetailEnabled || wsDetailStatus !== "connected",
  });

  const deviceDomains = domainsData ?? [];
  const deviceIPs = ipsData ?? [];

  const loading =
    !!selectedDevice &&
    (domainsLoading || ipsLoading) &&
    deviceDomains.length === 0 &&
    deviceIPs.length === 0;

  const handleDeviceClick = useCallback(
    (rawName: string) => {
      if (selectedDevice !== rawName) {
        setSelectedDevice(rawName);
      }
    },
    [selectedDevice],
  );

  const selectedDeviceData = useMemo(
    () => chartData.find((d) => d.rawName === selectedDevice),
    [chartData, selectedDevice],
  );

  const domainChartData = useMemo(() => {
    return [...deviceDomains]
      .sort(
        (a, b) =>
          b.totalDownload + b.totalUpload - (a.totalDownload + a.totalUpload),
      )
      .slice(0, 10)
      .map((d, i) => ({
        name: d.domain.length > 25 ? d.domain.slice(0, 22) + "..." : d.domain,
        fullName: d.domain,
        total: d.totalDownload + d.totalUpload,
        download: d.totalDownload,
        upload: d.totalUpload,
        connections: d.totalConnections,
        color: COLORS[i % COLORS.length],
      }));
  }, [deviceDomains]);

  const isBackendUnavailable = backendStatus === "unhealthy";
  const emptyHint = isBackendUnavailable
    ? backendT("backendUnavailableHint")
    : t("noDataHint");

  if (chartData.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="min-h-[220px] rounded-xl border border-dashed border-border/60 bg-card/30 px-4 py-6 flex flex-col items-center justify-center text-center">
            <Smartphone className="h-8 w-8 text-muted-foreground/70 mb-2" />
            <p className="text-sm font-medium text-muted-foreground">
              {t("noData")}
            </p>
            <p className="text-xs text-muted-foreground/80 mt-1 max-w-xs">
              {emptyHint}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-6">
        {/* Pie Chart */}
        <Card className="min-w-0 md:col-span-1 xl:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2 pb-4">
            <div className="h-[165px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    isAnimationActive={false}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload;
                        return (
                          <div className="bg-background border border-border p-3 rounded-lg shadow-lg">
                            <p className="font-medium text-sm mb-1">
                              {item.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatBytes(item.value)}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {topDevices.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider text-center">
                  Top 4
                </p>
                <div className="mt-1 space-y-1.5">
                  {topDevices.map((item, idx) => {
                    const rankBadgeClass =
                      idx === 0
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                        : idx === 1
                          ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          : idx === 2
                            ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                            : "bg-muted text-muted-foreground";
                    return (
                      <div
                        key={item.rawName}
                        title={item.name}
                        className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={cn(
                            "w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0",
                            rankBadgeClass,
                          )}>
                          {idx + 1}
                        </span>
                        <div
                          className="px-1.5 py-0.5 rounded-md text-[10px] font-medium text-white/90 truncate min-w-0 max-w-[140px] flex items-center gap-1"
                          style={{ backgroundColor: item.color }}>
                          <span className="truncate">{item.name}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Device List */}
        <Card className="min-w-0 md:col-span-1 xl:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <ScrollArea className="h-[280px] pr-3">
              <div className="space-y-2">
                {chartData.map((item) => {
                  const percentage =
                    totalTraffic > 0 ? (item.value / totalTraffic) * 100 : 0;
                  const barPercent = (item.value / maxTotal) * 100;
                  const isSelected = selectedDevice === item.rawName;
                  const badgeColor =
                    item.rank === 0
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      : item.rank === 1
                        ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        : item.rank === 2
                          ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                          : "bg-muted text-muted-foreground";
                  return (
                    <button
                      key={item.rawName}
                      onClick={() => handleDeviceClick(item.rawName)}
                      className={cn(
                        "w-full p-2.5 rounded-xl border text-left transition-all duration-200 overflow-hidden",
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "border-border/50 bg-card/50 hover:bg-card hover:border-primary/30",
                      )}>
                      <div className="flex items-center gap-2 mb-1.5 min-w-0">
                        <span
                          className={cn(
                            "w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0",
                            badgeColor,
                          )}>
                          {item.rank + 1}
                        </span>
                        <span
                          className="flex-1 text-sm font-medium truncate min-w-0"
                          title={item.name}>
                          {item.name}
                        </span>
                        <span className="text-sm font-bold tabular-nums shrink-0 whitespace-nowrap ml-auto">
                          {formatBytes(item.value)}
                        </span>
                      </div>
                      <div className="pl-7 space-y-1">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                          <div
                            className="h-full bg-blue-500 dark:bg-blue-400"
                            style={{
                              width: `${item.value > 0 ? (item.download / item.value) * barPercent : 0}%`,
                            }}
                          />
                          <div
                            className="h-full bg-purple-500 dark:bg-purple-400"
                            style={{
                              width: `${item.value > 0 ? (item.upload / item.value) * barPercent : 0}%`,
                            }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <span className="text-blue-500 dark:text-blue-400 whitespace-nowrap">
                              ↓ {formatBytes(item.download)}
                            </span>
                            <span className="text-purple-500 dark:text-purple-400 whitespace-nowrap">
                              ↑ {formatBytes(item.upload)}
                            </span>
                            <span className="flex items-center gap-1 tabular-nums">
                              <Link2 className="w-3 h-3" />
                              {formatNumber(item.connections)}
                            </span>
                          </div>
                          <span className="tabular-nums">
                            {percentage.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Top Domains Chart */}
        <Card className="min-w-0 md:col-span-2 xl:col-span-5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                {domainsT("title")}
              </CardTitle>
              {selectedDeviceData && (
                <span className="text-xs text-muted-foreground">
                  {selectedDeviceData.name}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <InsightChartSkeleton />
            ) : domainChartData.length === 0 ? (
              <div className="h-[280px] rounded-xl border border-dashed border-border/60 bg-card/30 px-4 py-5 flex flex-col items-center justify-center text-center">
                <BarChart3 className="h-5 w-5 text-muted-foreground/70 mb-2" />
                <p className="text-sm font-medium text-muted-foreground">
                  {domainsT("noData")}
                </p>
                <p className="text-xs text-muted-foreground/80 mt-1 max-w-xs">
                  {emptyHint}
                </p>
              </div>
            ) : (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={domainChartData}
                    layout="vertical"
                    margin={{
                      left: 0,
                      right: showDomainBarLabels ? 60 : 10,
                      top: 5,
                      bottom: 5,
                    }}>
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <RechartsTooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0].payload;
                          return (
                            <div className="bg-background border border-border p-3 rounded-lg shadow-lg min-w-[160px]">
                              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border/50">
                                <Favicon domain={item.fullName} size="sm" />
                                <span
                                  className="font-medium text-sm truncate max-w-[180px]"
                                  title={item.fullName}>
                                  {item.fullName}
                                </span>
                              </div>
                              <div className="space-y-2 text-xs">
                                <div className="flex justify-between items-center">
                                  <span className="text-muted-foreground">
                                    Total
                                  </span>
                                  <span className="font-semibold">
                                    {formatBytes(item.total)}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-blue-500">
                                    Download
                                  </span>
                                  <span>{formatBytes(item.download)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-purple-500">
                                    Upload
                                  </span>
                                  <span>{formatBytes(item.upload)}</span>
                                </div>
                                <div className="flex justify-between items-center pt-1 border-t border-border/50">
                                  <span className="text-emerald-500">
                                    Connections
                                  </span>
                                  <span>{formatNumber(item.connections)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                      cursor={{ fill: "rgba(128, 128, 128, 0.1)" }}
                    />
                    <Bar
                      dataKey="total"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={24}
                      isAnimationActive={false}>
                      {domainChartData.map((entry, index) => (
                        <BarCell key={`cell-${index}`} fill={entry.color} />
                      ))}
                      {showDomainBarLabels && (
                        <LabelList
                          dataKey="total"
                          position="right"
                          content={renderCustomBarLabel}
                        />
                      )}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom: Tabs with shared table components */}
      {selectedDevice && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="glass">
            <TabsTrigger value="domains">{domainsT("domainList")}</TabsTrigger>
            <TabsTrigger value="ips">IP Addresses</TabsTrigger>
          </TabsList>
          <TabsContent value="domains" className="mt-4">
            <DomainStatsTable
              domains={deviceDomains}
              loading={loading}
              pageSize={detailPageSize}
              onPageSizeChange={setDetailPageSize}
              activeBackendId={activeBackendId}
              timeRange={timeRange}
              sourceIP={selectedDevice ?? undefined}
              richExpand
            />
          </TabsContent>
          <TabsContent value="ips" className="mt-4">
            <IPStatsTable
              ips={deviceIPs}
              loading={loading}
              pageSize={detailPageSize}
              onPageSizeChange={setDetailPageSize}
              activeBackendId={activeBackendId}
              timeRange={timeRange}
              sourceIP={selectedDevice ?? undefined}
              richExpand
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
