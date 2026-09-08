"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import {
  LayoutDashboard,
  Globe,
  MapPin,
  Server,
  Route,
  Settings,
  Info,
  ExternalLink,
  ArrowUpCircle,
  Smartphone,
  RefreshCw,
  X,
  ShieldAlert,
  HeartPulse,
  PlugZap,
  ServerCog,
  ListTree,
  Radar,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackendConfigDialog } from "@/components/features/backend";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useVersionCheck } from "@/hooks/use-version-check";
import { usePWAInstall } from "@/hooks/use-pwa-install";
import { useAuthState } from "@/lib/auth-queries"; // Added

interface NavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onBackendChange?: () => void;
  backendStatus?: "healthy" | "unhealthy" | "unknown";
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
const GITHUB_REPO =
  process.env.NEXT_PUBLIC_GITHUB_REPO || "foru17/neko-master";
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

const NAV_ITEMS = [
  { id: "overview", icon: LayoutDashboard },
  { id: "rules", icon: Route },
  { id: "domains", icon: Globe },
  { id: "countries", icon: MapPin },
  { id: "proxies", icon: Server },
  { id: "devices", icon: Smartphone },
  { id: "health", icon: HeartPulse },
  { id: "nodes", icon: PlugZap },
  { id: "daemon", icon: ServerCog },
  { id: "rulecfg", icon: ListTree },
  { id: "diag", icon: Radar },
  { id: "ops", icon: Wrench },
];

export function Navigation({
  activeTab,
  onTabChange,
  onBackendChange,
  backendStatus = "unknown",
}: NavigationProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const t = useTranslations("nav");

  const { data: authState } = useAuthState(); // Added
  const isShowcase = authState?.showcaseMode ?? false; // Added

  const headerT = useTranslations("header");
  const backendT = useTranslations("backend");
  const aboutT = useTranslations("about");
  const dashboardT = useTranslations("dashboard");
  const { latestVersion, hasUpdate, isChecking, stars, checkNow } =
    useVersionCheck(APP_VERSION);
  const { canInstall, promptInstall } = usePWAInstall();
  const pwaT = useTranslations("pwa");

  const statusClass =
    backendStatus === "healthy"
      ? "bg-emerald-500"
      : backendStatus === "unhealthy"
        ? "bg-rose-500"
        : "bg-amber-500";

  const statusPingClass =
    backendStatus === "healthy"
      ? "bg-emerald-400/70"
      : backendStatus === "unhealthy"
        ? "bg-rose-400/70"
        : "bg-amber-400/70";

  const statusText =
    backendStatus === "healthy"
      ? dashboardT("backendHealthy")
      : backendStatus === "unhealthy"
        ? dashboardT("backendUnavailable")
        : dashboardT("backendStatusUnknown");
  const isBackendUnhealthy = backendStatus === "unhealthy";
  const statusDotSizeClass = isBackendUnhealthy ? "h-3 w-3" : "h-2.5 w-2.5";
  const statusPingAnimationClass = isBackendUnhealthy
    ? "animate-ping [animation-duration:700ms]"
    : "animate-ping [animation-duration:2s]";

  return (
    <>
      {/* Desktop Navigation - Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 h-screen sticky top-0 border-r border-border/40 bg-background/80 backdrop-blur-md">
        {/* Logo */}
        <div className="flex items-start gap-3 p-6 border-b border-border/40">
          <div className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center overflow-hidden hover:opacity-80">
            <Image
              src="/logo.png"
              alt="Neko Master"
              width={40}
              height={40}
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-xl leading-tight whitespace-nowrap">
                {headerT("title")}
              </h1>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "relative inline-flex shrink-0",
                        statusDotSizeClass,
                      )}
                      aria-label={statusText}
                      role="status">
                      <span
                        className={cn(
                          "absolute inline-flex h-full w-full rounded-full",
                          statusPingClass,
                          statusPingAnimationClass,
                        )}
                      />
                      {isBackendUnhealthy && (
                        <span
                          className={cn(
                            "absolute inline-flex h-full w-full rounded-full animate-ping [animation-duration:700ms] [animation-delay:140ms]",
                            statusPingClass,
                          )}
                        />
                      )}
                      <span
                        className={cn(
                          "relative inline-flex rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.06)]",
                          statusClass,
                          statusDotSizeClass,
                        )}
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{statusText}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs leading-4 text-muted-foreground/60 min-h-8 mt-0.5">
              {headerT("subtitle")}
            </p>
          </div>
        </div>

        {/* Showcase Mode Indicator */}
        {isShowcase && (
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 transition-all hover:bg-amber-500/15">
              <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {t("showcaseMode")}
              </span>
            </div>
          </div>
        )}

        {/* Nav Items */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}>
                <Icon className="w-5 h-5" />
                {t(item.id)}
              </button>
            );
          })}
        </nav>

        {/* PWA Install Prompt */}
        {canInstall && (
          <div className="px-4 pb-3">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={promptInstall}
                    className="group w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all bg-gradient-to-r from-primary/8 to-primary/4 hover:from-primary/14 hover:to-primary/8 border border-primary/15 hover:border-primary/30">
                    <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 group-hover:bg-primary/15 transition-colors">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        className="text-primary">
                        <path
                          d="M8 1.5v8m0 0L5 6.5m3 3 3-3"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span className="text-primary/90">
                      {pwaT("installApp")}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <p className="text-xs">{pwaT("tooltip")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="p-4 border-t border-border/40 space-y-1">
          <button
            onClick={() => setAboutOpen(true)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all relative",
              "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}>
            <Info className="w-5 h-5" />
            {aboutT("title")}
            {hasUpdate && (
              <span className="ml-auto flex items-center gap-1.5 text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                {aboutT("newVersion")}
              </span>
            )}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
              "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}>
            <Settings className="w-5 h-5" />
            {backendT("title")}
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border/40 bg-background/80 backdrop-blur-md">
        <div className="h-16 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-center h-full min-w-full px-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    "min-w-[20%] shrink-0 flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg transition-all",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}>
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px]">{t(item.id)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Settings Dialog */}
      <BackendConfigDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        isFirstTime={false}
        onBackendChange={onBackendChange}
      />

      {/* About Dialog */}
      {aboutOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAboutOpen(false);
          }}>
          <Card className="w-full max-w-[420px]">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Info className="w-5 h-5" />
                {aboutT("title")}
              </CardTitle>
              <button
                onClick={() => setAboutOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors -mr-1.5"
                aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </CardHeader>
            <CardContent>
              {/* App Info */}
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                  <Image
                    src="/logo.png"
                    alt="Neko Master"
                    width={64}
                    height={64}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <h3 className="text-xl font-bold">{aboutT("projectName")}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {aboutT("description")}
                  </p>
                </div>
              </div>

              {/* All card rows with consistent spacing */}
              <div className="space-y-2">
                {/* Current Version */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/50">
                  <span className="text-sm font-medium">
                    {aboutT("currentVersion")}
                  </span>
                  <span className="text-sm font-mono tabular-nums text-primary font-semibold">
                    v{APP_VERSION}
                  </span>
                </div>

                {/* Latest Version / Update Status */}
                {hasUpdate && latestVersion ? (
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-xl border min-h-[3rem] bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10 transition-colors group">
                    <div>
                      <span className="text-sm font-medium">
                        {aboutT("latestVersion")}
                      </span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {aboutT("updateAvailable")} · v{APP_VERSION} → v
                        {latestVersion}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 h-7 shrink-0">
                      <span className="text-sm font-mono tabular-nums text-emerald-500 font-semibold flex items-center gap-1.5">
                        <ArrowUpCircle className="w-4 h-4" />v{latestVersion}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-emerald-500 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </a>
                ) : (
                  <div className="flex items-center justify-between p-3 rounded-xl border min-h-[3rem] bg-secondary/50 border-border/50">
                    <span className="text-sm font-medium">
                      {aboutT("latestVersion")}
                    </span>
                    <div className="flex items-center gap-2 h-7 min-w-[5.5rem] justify-end">
                      {isChecking ? (
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          {aboutT("checkingUpdate")}
                        </span>
                      ) : latestVersion ? (
                        <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                          <span className="font-mono tabular-nums">
                            v{latestVersion}
                          </span>
                          <span className="text-emerald-500">✓</span>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={checkNow}>
                          <RefreshCw className="w-3 h-3 mr-1" />
                          {aboutT("checkNow")}
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* License */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/50">
                  <span className="text-sm font-medium">
                    {aboutT("license")}
                  </span>
                  <span className="text-sm text-muted-foreground">MIT</span>
                </div>

                {/* GitHub Link */}
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/50 hover:bg-secondary/80 hover:border-primary/30 transition-all group">
                  <div className="flex items-center gap-3">
                    <svg
                      viewBox="0 0 24 24"
                      className="w-5 h-5 fill-foreground shrink-0"
                      aria-hidden="true">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {aboutT("openSource")}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {GITHUB_URL}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full min-w-[3rem] justify-center h-6">
                      {stars !== null ? (
                        <>
                          <svg
                            viewBox="0 0 16 16"
                            className="w-3.5 h-3.5 fill-amber-500 shrink-0"
                            aria-hidden="true">
                            <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z" />
                          </svg>
                          <span className="text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                            {stars >= 1000
                              ? `${(stars / 1000).toFixed(1)}k`
                              : stars}
                          </span>
                        </>
                      ) : (
                        <span className="w-8 h-4 bg-secondary/80 rounded animate-pulse" />
                      )}
                    </span>
                    <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
