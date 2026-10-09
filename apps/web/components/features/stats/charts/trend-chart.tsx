"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Activity, Clock, BarChart3, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatBytes, formatBytesPerSecond } from "@/lib/utils";
import type { TrafficTrendPoint } from "@neko-master/shared";

type TimeRange = "30m" | "1h" | "24h" | "today";
type TrendGranularity = "minute" | "day";
type TrendMode = "traffic" | "speed";

interface TrafficTrendChartProps {
  data: TrafficTrendPoint[];
  granularity: TrendGranularity;
  /** Bucket size of `data`, used to turn bytes per bucket into bytes/s. */
  bucketMinutes?: number;
  /** End of the queried window (ISO); the last bucket may be partial. */
  rangeEnd?: string;
  timeRange?: TimeRange;
  timeRangeOptions?: TimeRange[];
  onTimeRangeChange?: (range: TimeRange) => void;
  isLoading?: boolean;
  emptyHint?: string;
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: { time: string; download: number; upload: number } }>;
  granularity: TrendGranularity;
  formatValue: (value: number) => string;
  labels: { download: string; upload: string; total: string };
}

// Module-level so it is not re-created on every render; recharts injects
// `active` and `payload` when it clones the element.
function TrendTooltip({ active, payload, granularity, formatValue, labels }: TrendTooltipProps) {
  if (active && payload && payload.length) {
    const dataPoint = payload[0].payload;
    // Append Z to indicate UTC if not present, then convert to local
    const timeStr = dataPoint.time.endsWith("Z")
      ? dataPoint.time
      : dataPoint.time + "Z";
    const date = new Date(timeStr);
    const title =
      granularity === "day"
        ? date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : date.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
    return (
      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
        <p className="text-xs text-muted-foreground mb-2">{title}</p>
        <div className="space-y-1">
          <p className="text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">
              {labels.download}:
            </span>
            <span className="font-medium tabular-nums">
              {formatValue(dataPoint.download)}
            </span>
          </p>
          <p className="text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            <span className="text-muted-foreground">
              {labels.upload}:
            </span>
            <span className="font-medium tabular-nums">
              {formatValue(dataPoint.upload)}
            </span>
          </p>
          <p className="text-sm flex items-center gap-2 pt-1 border-t border-border/50 mt-1">
            <span className="w-2 h-2 rounded-full bg-transparent" />
            <span className="text-muted-foreground">{labels.total}:</span>
            <span className="font-semibold tabular-nums">
              {formatValue(dataPoint.download + dataPoint.upload)}
            </span>
          </p>
        </div>
      </div>
    );
  }
  return null;
}

/** Wall clock that ticks while `enabled`, without calling Date.now during render. */
function useNow(enabled: boolean, intervalMs = 5_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, intervalMs]);
  return now;
}

export const TrafficTrendChart = React.memo(
  function TrafficTrendChart({
    data,
    granularity,
    bucketMinutes = 1,
    rangeEnd,
    timeRange,
    timeRangeOptions = [],
    onTimeRangeChange,
    isLoading = false,
    emptyHint,
  }: TrafficTrendChartProps) {
    const t = useTranslations("trend");
    const chartT = useTranslations("chart");
    const [mode, setMode] = useState<TrendMode>("traffic");
    const bucketSeconds = Math.max(60, Math.round(bucketMinutes * 60));
    const formatValue = mode === "speed" ? formatBytesPerSecond : formatBytes;
    const nowMs = useNow(mode === "speed");
    // Upper bound of complete buckets: now, or the query end for past windows.
    const rangeEndMs = Math.max(rangeEnd ? new Date(rangeEnd).getTime() || 0 : 0, nowMs);
    
    // Track if we've ever received data to avoid showing empty state on initial load
    const [hasEverReceivedData, setHasEverReceivedData] = useState(false);
    if (data.length > 0 && !hasEverReceivedData) {
      // Adjusting state while rendering (React's documented pattern) instead of a ref.
      setHasEverReceivedData(true);
    }

    const selectorOptions = useMemo(() => {
      const allOptions: { value: TimeRange; label: string }[] = [
        { value: "30m", label: t("30m") },
        { value: "1h", label: t("1h") },
        { value: "24h", label: t("24h") },
        { value: "today", label: t("today") },
      ];
      return allOptions.filter((item) => timeRangeOptions.includes(item.value));
    }, [t, timeRangeOptions]);

    const showTimeRangeSelector =
      !!onTimeRangeChange && selectorOptions.length > 1 && !!timeRange;

    const selectorSlotClassName = cn(
      "items-center justify-end",
      showTimeRangeSelector ? "flex h-7 sm:min-w-[168px]" : "hidden lg:flex h-7 min-w-[168px]",
    );

    // Calculate total traffic for the period
    const stats = useMemo(() => {
      if (!data?.length) return { totalDownload: 0, totalUpload: 0 };

      let totalDownload = 0;
      let totalUpload = 0;

      for (const point of data) {
        totalDownload += point.download;
        totalUpload += point.upload;
      }

      return { totalDownload, totalUpload };
    }, [data]);

    // Format data for chart - convert UTC to local time
    const chartData = useMemo(() => {
      // In speed mode, skip the bucket that is still filling: its bytes are
      // still arriving, so it would always read low. Live speed is on the cards.
      const bucketMs = bucketSeconds * 1000;
      const points =
        mode === "speed" && rangeEndMs
          ? data.filter((point) => {
              const start = new Date(point.time.endsWith("Z") ? point.time : `${point.time}Z`).getTime();
              return !Number.isFinite(start) || start + bucketMs <= rangeEndMs;
            })
          : data;
      return points.map((point) => {
        // Append Z to indicate UTC if not present, then convert to local
        const timeStr = point.time.endsWith("Z")
          ? point.time
          : point.time + "Z";
        const date = new Date(timeStr);
        const timeLabel =
          granularity === "day"
            ? date.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            : date.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });
        const scale = mode === "speed" ? bucketSeconds : 1;
        return {
          time: point.time,
          download: point.download / scale,
          upload: point.upload / scale,
          timeLabel,
          timestamp: date.getTime(), // for sorting/debugging
        };
      });
    }, [data, granularity, mode, bucketSeconds, rangeEndMs]);


    // Loading skeleton - show when loading or on initial load with no data yet
    // This prevents flickering from empty state to skeleton on first load
    if ((isLoading && chartData.length === 0) || (chartData.length === 0 && !hasEverReceivedData)) {
      return (
        <Card className="h-full">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4" />
                {t("title")}
                </CardTitle>
                <div className="h-7 w-[168px] bg-muted/50 rounded-lg animate-pulse hidden lg:block" />
            </div>
             <div className="hidden lg:flex items-center gap-6 mt-3">
                <div className="h-4 w-24 bg-muted/50 rounded animate-pulse" />
                <div className="h-4 w-24 bg-muted/50 rounded animate-pulse" />
                <div className="h-4 w-24 bg-muted/50 rounded animate-pulse ml-auto" />
             </div>
             <div className="grid grid-cols-3 gap-2 mt-2 lg:hidden">
                <div className="h-10 bg-muted/50 rounded animate-pulse" />
                <div className="h-10 bg-muted/50 rounded animate-pulse" />
                <div className="h-10 bg-muted/50 rounded animate-pulse" />
             </div>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] w-full bg-muted/20 rounded-xl animate-pulse flex items-end justify-between px-4 pb-4 gap-2">
                 {/* Use fixed heights to avoid hydration mismatch between SSR and client */}
                 {[35, 62, 28, 75, 45, 58, 32, 68, 40, 55, 30, 65].map((height, i) => (
                    <div key={i} className="w-full bg-muted/40 rounded-t" style={{ height: `${height}%` }} />
                 ))}
            </div>
          </CardContent>
        </Card>
      );
    }

    // If no data and we've previously received data, show empty state
    // Otherwise (initial load with no data), keep showing skeleton to avoid flickering
    if (!isLoading && chartData.length === 0 && hasEverReceivedData) {
      return (
        <Card className="h-full">
          <CardHeader className="pb-2">
             <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4" />
                {t("title")}
              </CardTitle>
              {/* Maintain height of selector */}
              <div className="h-7 w-[168px] hidden lg:block" />
            </div>
            
            {/* Maintain height of stats row */}
             <div className="hidden lg:flex items-center gap-6 mt-3 opacity-0 pointer-events-none" aria-hidden="true">
                <div className="h-4 w-24" />
             </div>
             <div className="grid grid-cols-3 gap-2 mt-2 lg:hidden opacity-0 pointer-events-none" aria-hidden="true">
                <div className="h-10" />
             </div>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] rounded-xl border border-dashed border-border/60 bg-card/20 flex flex-col items-center justify-center text-center px-4">
              <Activity className="w-5 h-5 text-muted-foreground mb-2" />
              <p className="text-sm font-medium text-muted-foreground">
                {t("noData")}
              </p>
              <p className="text-xs text-muted-foreground/80 mt-1">
                {emptyHint || t("noDataHint")}
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4" />
              {t("title")}
            </CardTitle>

            <div className="flex items-center gap-2">
              <div
                role="radiogroup"
                aria-label={t("modeLabel")}
                className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
                {(["traffic", "speed"] as const).map((option) => (
                  <Button
                    key={option}
                    variant="ghost"
                    size="sm"
                    role="radio"
                    aria-checked={mode === option}
                    className={cn(
                      "h-7 px-3 text-xs rounded-md transition-all",
                      mode === option
                        ? "bg-background shadow-sm text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setMode(option)}>
                    {option === "traffic" ? t("modeTraffic") : t("modeSpeed")}
                  </Button>
                ))}
              </div>
              <div className={selectorSlotClassName}>
                {showTimeRangeSelector ? (
                  <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
                    {selectorOptions.map((option) => (
                      <Button
                        key={option.value}
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-7 px-3 text-xs rounded-md transition-all",
                          timeRange === option.value
                            ? "bg-background shadow-sm text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => onTimeRangeChange?.(option.value)}>
                        {option.label}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div aria-hidden className="h-7 w-[168px]" />
                )}
              </div>
            </div>
          </div>

          {/* Stats summary - Mobile: card layout, Desktop: inline layout */}
          {/* Mobile layout */}
          <div className="grid grid-cols-3 gap-2 mt-2 lg:hidden">
            <div className="flex flex-col items-center py-1.5 px-1 rounded-md bg-secondary/50 border border-border/50">
              <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {t("totalDownload")}
              </span>
              <span className="text-xs font-semibold tabular-nums">
                {formatBytes(stats.totalDownload)}
              </span>
            </div>
            <div className="flex flex-col items-center py-1.5 px-1 rounded-md bg-secondary/50 border border-border/50">
              <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                <BarChart3 className="w-2.5 h-2.5" />
                {t("totalUpload")}
              </span>
              <span className="text-xs font-semibold tabular-nums">
                {formatBytes(stats.totalUpload)}
              </span>
            </div>
            <div className="flex flex-col items-center py-1.5 px-1 rounded-md bg-secondary/50 border border-border/50">
              <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                <Activity className="w-2.5 h-2.5" />
                {t("total")}
              </span>
              <span className="text-xs font-bold tabular-nums">
                {formatBytes(stats.totalDownload + stats.totalUpload)}
              </span>
            </div>
          </div>
          {/* Desktop layout */}
          <div className="hidden lg:flex items-center gap-6 mt-3 text-xs">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">
                {t("totalDownload")}:
              </span>
              <span className="font-semibold text-blue-500 tabular-nums">
                {formatBytes(stats.totalDownload)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">{t("totalUpload")}:</span>
              <span className="font-semibold text-purple-500 tabular-nums">
                {formatBytes(stats.totalUpload)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-muted-foreground">{t("total")}:</span>
              <span className="font-bold tabular-nums">
                {formatBytes(stats.totalDownload + stats.totalUpload)}
              </span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <div className="relative h-[200px] w-full">
            {chartData.length === 0 ? (
              <div className="absolute inset-x-0 top-0 bottom-6 flex items-center justify-center text-muted-foreground">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 shadow-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-xs font-medium">{t("loading")}</span>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient
                      id="colorDownload"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient
                      id="colorUpload"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#888888"
                    strokeOpacity={0.2}
                  />
                  <XAxis
                    dataKey="timeLabel"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#888888" }}
                    interval="preserveStartEnd"
                    minTickGap={30}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#888888" }}
                    tickFormatter={(value) =>
                      mode === "speed"
                        ? `${formatBytes(value, 1).replace(" ", "")}/s`
                        : formatBytes(value).replace(" ", "")
                    }
                    width={mode === "speed" ? 70 : 60}
                  />
                  <Tooltip
                    content={
                      <TrendTooltip
                        granularity={granularity}
                        formatValue={formatValue}
                        labels={{
                          download: chartT("download"),
                          upload: chartT("upload"),
                          total: t("total"),
                        }}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="download"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorDownload)"
                    name={chartT("download")}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="upload"
                    stroke="#a855f7"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorUpload)"
                    name={chartT("upload")}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}

            {isLoading && chartData.length > 0 && (
              <div className="absolute inset-x-0 top-0 bottom-6 flex items-center justify-center bg-background/35 backdrop-blur-[1px] pointer-events-none">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 shadow-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-xs font-medium">{t("loading")}</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  },
  (prev, next) => {
    return (
      JSON.stringify(prev.data) === JSON.stringify(next.data) &&
      prev.granularity === next.granularity &&
      prev.bucketMinutes === next.bucketMinutes &&
      prev.rangeEnd === next.rangeEnd &&
      prev.timeRange === next.timeRange &&
      JSON.stringify(prev.timeRangeOptions) ===
        JSON.stringify(next.timeRangeOptions) &&
      prev.isLoading === next.isLoading
    );
  },
);
