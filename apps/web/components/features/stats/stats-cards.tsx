"use client";

import { useRef, useEffect } from "react";
import { Download, Upload, Globe, Activity, Server, Route, AlertTriangle } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { animate, motion, useTransform, useMotionValue } from "framer-motion";
import { formatBytes, formatBytesPerSecond, cn } from "@/lib/utils";
import type { TransferRate } from "@/lib/transfer-rate";
import type { StatsSummary } from "@neko-master/shared";

interface StatsCardsProps {
  data: StatsSummary | null;
  error?: string | null;
  backendStatus?: "healthy" | "unhealthy" | "unknown";
  isLoading?: boolean;
  /** Live rate for the latest window; undefined hides the rate line. */
  rate?: TransferRate | null;
}

// ---------- Animated number display ----------

const animationConfig = { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const };

function AnimatedValue({
  value,
  formatter,
  className,
  title,
}: {
  value: number;
  formatter: (n: number) => string;
  className?: string;
  title?: string;
}) {
  const motionValue = useMotionValue(0);
  const display = useTransform(motionValue, (v) => {
    const safe = Number.isFinite(v) ? Math.max(0, v) : 0;
    const bounded = Math.min(safe, Number.MAX_SAFE_INTEGER);
    const rounded = Math.round(bounded);
    const formatted = formatter(rounded);
    if (!formatted || formatted.includes("undefined") || formatted.includes("NaN")) {
      return formatter(0);
    }
    return formatted;
  });
  const isFirstRender = useRef(true);

  useEffect(() => {
    const target = Number.isFinite(value) ? Math.max(0, value) : 0;

    if (isFirstRender.current) {
      // Jump to initial value instantly (no animation on mount)
      motionValue.jump(target);
      isFirstRender.current = false;
      return;
    }

    const controls = animate(motionValue, target, animationConfig);
    return () => controls.stop();
  }, [value, motionValue]);

  return (
    <motion.span className={className} title={title}>
      {display}
    </motion.span>
  );
}

// ---------- Animated Stat Card (for numeric values) ----------

function AnimatedStatCard({
  value,
  formatter,
  label,
  subvalue,
  icon: Icon,
  color,
}: {
  value: number;
  formatter: (n: number) => string;
  label: string;
  subvalue?: React.ReactNode;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="rounded-xl p-3.5 border bg-card shadow-xs flex flex-col">
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center mb-2.5"
        style={{ backgroundColor: `${color}15` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div className="flex-1">
        <p className="text-muted-foreground text-[11px] uppercase tracking-[0.14em] font-medium truncate">
          {label}
        </p>
        <AnimatedValue
          value={value}
          formatter={formatter}
          className="text-lg leading-none font-semibold mt-2.5 tabular-nums truncate block"
          title={formatter(value)}
        />
        {subvalue && (
          <p className="text-[11px] text-muted-foreground mt-1.5 truncate tabular-nums">
            {subvalue}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- Main ----------

function RateLine({ value, label }: { value: number | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span
        aria-hidden
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          value === null ? "bg-muted-foreground/40" : "bg-emerald-500 dark:bg-emerald-400",
        )}
      />
      <span className="sr-only">{label}: </span>
      {value === null ? "—" : formatBytesPerSecond(value)}
    </span>
  );
}

export function StatsCards({ data, backendStatus, isLoading, error, rate }: StatsCardsProps) {
  const t = useTranslations("stats");
  const locale = useLocale();
  const formatCount = (n: number) => n.toLocaleString(locale);
  const summaryIsZero =
    !data ||
    ((data.totalDownload || 0) === 0 &&
      (data.totalUpload || 0) === 0 &&
      (data.totalConnections || 0) === 0 &&
      (data.totalDomains || 0) === 0 &&
      (data.totalRules || 0) === 0);

  const showUnavailablePlaceholder = backendStatus === "unhealthy" && summaryIsZero;

  const PlaceholderStatCard = ({
    icon: Icon,
    label,
    color,
    shimmer = false,
  }: {
    icon: React.ElementType;
    label: string;
    color: string;
    shimmer?: boolean;
  }) => (
    <div className="rounded-xl p-3.5 border bg-card shadow-xs flex flex-col">
      <div
        className={cn("w-8 h-8 rounded-md flex items-center justify-center mb-2.5", shimmer && "animate-pulse")}
        style={{ backgroundColor: `${color}15` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div className="flex-1">
        <p className="text-muted-foreground text-[11px] uppercase tracking-[0.14em] font-medium truncate">
          {label}
        </p>
        {shimmer ? (
          <div className="h-5 w-24 bg-muted/50 rounded mt-2.5 mb-1 animate-pulse" />
        ) : (
          <p className="text-lg leading-none font-semibold mt-2.5 tabular-nums text-muted-foreground">
            --
          </p>
        )}
        {shimmer ? (
           <div className="h-3 w-12 bg-muted/30 rounded mt-1.5 animate-pulse" />
        ) : (
          <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
            {t("unavailable")}
          </p>
        )}
      </div>
    </div>
  );

  if (error && !isLoading) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-destructive">{t("loadErrorTitle")}</p>
          <p className="text-[13px] text-muted-foreground mt-0.5 break-words">{error}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <PlaceholderStatCard icon={Download} label={t("totalDownload")} color="#3B82F6" shimmer />
          <PlaceholderStatCard icon={Upload} label={t("totalUpload")} color="#8B5CF6" shimmer />
          <PlaceholderStatCard icon={Server} label={t("total")} color="#EC4899" shimmer />
          <PlaceholderStatCard icon={Activity} label={t("totalConnections")} color="#10B981" shimmer />
          <PlaceholderStatCard icon={Globe} label={t("domains")} color="#06B6D4" shimmer />
          <PlaceholderStatCard icon={Route} label={t("rules")} color="#F59E0B" shimmer />
      </div>
    );
  }

  return (
    <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
      {showUnavailablePlaceholder ? (
        <>
          <PlaceholderStatCard icon={Download} label={t("totalDownload")} color="#3B82F6" />
          <PlaceholderStatCard icon={Upload} label={t("totalUpload")} color="#8B5CF6" />
          <PlaceholderStatCard icon={Server} label={t("total")} color="#EC4899" />
          <PlaceholderStatCard icon={Activity} label={t("totalConnections")} color="#10B981" />
          <PlaceholderStatCard icon={Globe} label={t("domains")} color="#06B6D4" />
          <PlaceholderStatCard icon={Route} label={t("rules")} color="#F59E0B" />
        </>
      ) : (
        <>
          <AnimatedStatCard
            value={data?.totalDownload || 0}
            formatter={formatBytes}
            icon={Download}
            label={t("totalDownload")}
            subvalue={
              rate !== undefined ? (
                <RateLine value={rate?.download ?? null} label={t("currentDownload")} />
              ) : undefined
            }
            color="#3B82F6"
          />
          <AnimatedStatCard
            value={data?.totalUpload || 0}
            formatter={formatBytes}
            icon={Upload}
            label={t("totalUpload")}
            subvalue={
              rate !== undefined ? (
                <RateLine value={rate?.upload ?? null} label={t("currentUpload")} />
              ) : undefined
            }
            color="#8B5CF6"
          />
          <AnimatedStatCard
            value={(data?.totalDownload || 0) + (data?.totalUpload || 0)}
            formatter={formatBytes}
            label={t("total")}
            icon={Server}
            color="#EC4899"
          />
          <AnimatedStatCard
            value={data?.totalConnections || 0}
            formatter={formatCount}
            label={t("totalConnections")}
            icon={Activity}
            color="#10B981"
          />
          <AnimatedStatCard
            value={data?.totalDomains || 0}
            formatter={formatCount}
            label={t("domains")}
            icon={Globe}
            color="#06B6D4"
          />
          <AnimatedStatCard
            value={data?.totalRules || 0}
            formatter={formatCount}
            label={t("rules")}
            icon={Route}
            color="#F59E0B"
          />
        </>
      )}
    </div>
  );
}
