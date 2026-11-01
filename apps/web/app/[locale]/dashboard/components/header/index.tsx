"use client";

import React, { useEffect, useState } from "react";
import {
  Server,
  Radio,
  RefreshCw,
  ChevronDown,
  AlertTriangle,
  Settings,
  Globe,
  Moon,
  Sun,
  Monitor,
  MoreVertical,
  Info,
  LogOut,
  ShieldAlert,
} from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { TimeRangePicker, LanguageSwitcher, ThemeToggle, ClientOnly } from "@/components/common";
import { cn } from "@/lib/utils";
import type { TimeRange } from "@/lib/api";
import type { BackendStatus, TabId, TimePreset } from "@/lib/types/dashboard";

interface BackendHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastChecked: number;
  message?: string;
  latency?: number;
}

interface Backend {
  id: number;
  name: string;
  is_active: boolean;
  listening: boolean;
  health?: BackendHealth;
}

import { useAuth } from "@/lib/auth";
import { useAuthState } from "@/lib/auth-queries"; // Added
import { useTranslations } from "next-intl"; // Added

interface HeaderProps {
  // Backend data
  backends: Backend[];
  activeBackend: Backend | null;
  listeningBackends: Backend[];
  backendStatus: BackendStatus;
  backendStatusHint: string | null;

  // Time range
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange, preset: TimePreset) => void;

  // Auto refresh
  autoRefresh: boolean;
  autoRefreshTick: number;
  onAutoRefreshToggle: () => void;

  // Actions
  onSwitchBackend: (backendId: number) => void;
  onOpenBackendDialog: () => void;
  onRefresh: () => void;
  onOpenAboutDialog: () => void;

  // Theme
  theme: string | undefined;
  onThemeChange: (theme: string) => void;

  // Locale/Router
  locale: string;
  pathname: string;
  onNavigate: (path: string) => void;

  // Active tab (to conditionally show time picker)
  activeTab?: TabId;

  // Loading states
  isLoading: boolean;
  isTransitioning?: boolean;

  // Translations
  backendT: (key: string) => string;
  dashboardT: (key: string) => string;
}

export function Header({
  backends,
  activeBackend,
  listeningBackends,
  backendStatus,
  backendStatusHint,
  timeRange,
  onTimeRangeChange,
  autoRefresh,
  autoRefreshTick,
  onAutoRefreshToggle,
  onSwitchBackend,
  onOpenBackendDialog,
  onRefresh,
  onOpenAboutDialog,
  theme,
  onThemeChange,
  locale,
  pathname,
  onNavigate,
  activeTab,
  isLoading,
  isTransitioning,
  backendT,
  dashboardT,
}: HeaderProps) {
  const showTimeRangePicker = true; // All tabs use the global time range picker
  const { logout, authState } = useAuth();
  const { data: authQueryState } = useAuthState(); // Added
  const isShowcase = authQueryState?.showcaseMode ?? false; // Added
  const navT = useTranslations("nav"); // Added
  const settingsT = useTranslations("settings");
  const themeT = useTranslations("theme");
  const aboutT = useTranslations("about");

  const [showProgress, setShowProgress] = React.useState(false);

  React.useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (isTransitioning) {
      setShowProgress(true);
    } else {
      // Add a small delay before hiding to let the animation play out a bit
      // and prevent it from flashing too quickly
      timeout = setTimeout(() => {
        setShowProgress(false);
      }, 800);
    }
    return () => clearTimeout(timeout);
  }, [isTransitioning]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="flex items-center justify-between h-14 px-4 lg:px-6">
        <div className="flex items-center gap-3">
          {/* Mobile: Logo */}
          <div className="flex items-center gap-2">
            <div className="lg:hidden w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden">
              <Image
                src="/logo.png"
                alt="Neko Master"
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Backend Selector */}
          {listeningBackends.length > 0 && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-2 sm:px-3"
                >
                  <Server className="w-4 h-4" />
                  <span className="max-w-[80px] sm:max-w-[120px] truncate">
                    {activeBackend?.name || backendT("selectBackend")}
                  </span>
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>{backendT("backendsTab")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {listeningBackends.map((backend) => {
                  const healthStatus = backend.health?.status;
                  const isUnhealthy = healthStatus === 'unhealthy';
                  
                  return (
                    <DropdownMenuItem
                      key={backend.id}
                      onClick={() => onSwitchBackend(backend.id)}
                      className={cn(
                        "flex items-center justify-between",
                        isUnhealthy && "text-red-600"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate",
                            backend.is_active && "font-medium"
                          )}
                        >
                          {backend.name}
                        </span>
                        {isUnhealthy && (
                          <AlertTriangle className="w-3 h-3 text-red-500" />
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {!!backend.is_active && (
                          <Badge
                            variant="default"
                            className={cn(
                              "text-[10px] h-5",
                              isUnhealthy && "bg-red-500 hover:bg-red-600"
                            )}
                          >
                            {isUnhealthy ? backendT("unhealthy") : backendT("displaying")}
                          </Badge>
                        )}
                        {!!backend.listening && !backend.is_active && (
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[10px] h-5 gap-1",
                              isUnhealthy && "bg-red-100 text-red-600 border-red-200 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/25"
                            )}
                          >
                            <Radio className={cn("w-2 h-2", isUnhealthy && "text-red-500")} />
                            {isUnhealthy ? backendT("unhealthy") : backendT("collecting")}
                          </Badge>
                        )}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onOpenBackendDialog}>
                  <Settings className="w-4 h-4 mr-2" />
                  {backendT("manageBackends")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Listening Indicators */}
          {listeningBackends.length > 0 && (
            <TooltipProvider delayDuration={100}>
            <div className="hidden md:flex items-center gap-1">
              {listeningBackends.slice(0, 3).map((backend) => {
                // Determine color based on health status
                const healthStatus = backend.health?.status;
                const badgeClasses = {
                  healthy: "border-green-500/30 text-green-600 bg-green-50/50 dark:bg-green-500/15 dark:text-green-400 dark:border-green-500/25",
                  unhealthy: "border-red-500/30 text-red-600 bg-red-50/50 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/25",
                  unknown: "border-gray-500/30 text-gray-500 bg-gray-50/50 dark:bg-gray-500/15 dark:text-gray-400 dark:border-gray-500/25",
                };
                const iconClasses = {
                  healthy: "text-green-500 dark:text-green-400",
                  unhealthy: "text-red-500 dark:text-red-400",
                  unknown: "text-gray-400 dark:text-gray-500",
                };
                const status = healthStatus || 'unknown';
                const tooltipText = backend.health?.message || 
                  (status === 'healthy' ? 'Connected' : status === 'unhealthy' ? 'Connection failed' : 'Checking...');
                
                return (
                    <Tooltip key={backend.id}>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] h-5 gap-1 px-1.5 cursor-pointer",
                            badgeClasses[status]
                          )}
                        >
                          <Radio className={cn("w-2 h-2", iconClasses[status])} />
                          {backend.name}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{backend.name}</span>
                          <span className={cn(
                            "text-[10px]",
                            status === 'healthy' ? "text-green-500" : 
                            status === 'unhealthy' ? "text-red-500" : "text-gray-400"
                          )}>
                            {tooltipText}
                            {backend.health?.latency && ` (${backend.health.latency}ms)`}
                          </span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                );
              })}
              {listeningBackends.length > 3 && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  +{listeningBackends.length - 3}
                </Badge>
              )}
            </div>
            </TooltipProvider>
          )}
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Desktop: Compact auto-refresh toggle */}
          <div className="hidden sm:flex items-center mr-1">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onAutoRefreshToggle}
                    aria-label={
                      autoRefresh
                        ? dashboardT("autoRefresh")
                        : dashboardT("paused")
                    }
                    className={cn(
                      "h-9 w-9 rounded-full transition-colors",
                      autoRefresh
                        ? "text-emerald-600 hover:bg-emerald-500/10"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <RefreshCw
                      className={cn(
                        "w-4 h-4",
                        autoRefresh && "text-emerald-500"
                      )}
                      style={
                        autoRefresh
                          ? {
                              transform: `rotate(${autoRefreshTick * 360}deg)`,
                              transition: "transform 650ms linear",
                            }
                          : undefined
                      }
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="font-medium">
                    {autoRefresh
                      ? dashboardT("autoRefresh")
                      : dashboardT("paused")}
                  </p>
                  <p className="opacity-80">
                    {autoRefresh
                      ? dashboardT("clickToPause")
                      : dashboardT("clickToResume")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Desktop: Language & Theme */}
          <div className="hidden sm:flex items-center gap-1">
            {showTimeRangePicker && (
              <ClientOnly fallback={<div className="h-9 w-[152px] bg-secondary/45 rounded-xl" />}>
                <TimeRangePicker
                  value={timeRange}
                  onChange={onTimeRangeChange}
                  showcaseMode={isShowcase}
                />
              </ClientOnly>
            )}
            <LanguageSwitcher />

            <ThemeToggle />
            {authState?.enabled && (
              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                title={dashboardT("logout")}
                className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Mobile: Time range picker */}
          {showTimeRangePicker && (
            <div className="sm:hidden">
              <ClientOnly fallback={<div className="h-9 w-[122px] bg-secondary/45 rounded-xl" />}>
                <TimeRangePicker
                  value={timeRange}
                  onChange={onTimeRangeChange}
                  className="w-[122px]"
                  showcaseMode={isShowcase}
                />
              </ClientOnly>
            </div>
          )}



          {/* Mobile: More Options Dropdown */}
          <div className="sm:hidden">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 relative">
                  {backendStatus === "unhealthy" && (
                    <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping [animation-duration:900ms]" />
                  )}
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {/* Backend Warning - show when unhealthy */}
                {backendStatus === "unhealthy" && (
                  <>
                    <DropdownMenuLabel className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                      <AlertTriangle className="w-4 h-4" />
                      {dashboardT("backendUnavailable")}
                    </DropdownMenuLabel>
                    <div className="px-2 py-1.5">
                      <p className="text-xs text-muted-foreground">
                        {backendStatusHint || dashboardT("backendUnavailableHint")}
                      </p>
                    </div>
                    <DropdownMenuSeparator />
                  </>
                )}

                {/* Showcase Mode Indicator */}
                {isShowcase && (
                  <>
                    <DropdownMenuLabel className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                      <ShieldAlert className="w-4 h-4" />
                      {navT("showcaseMode")}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Auto Refresh Toggle */}
                <DropdownMenuLabel className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  {dashboardT("refresh")}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onAutoRefreshToggle();
                  }}
                >
                  <div className="flex items-center justify-between w-full">
                    <span>
                      {autoRefresh
                        ? dashboardT("autoRefresh")
                        : dashboardT("paused")}
                    </span>
                    <Switch
                      checked={autoRefresh}
                      onCheckedChange={onAutoRefreshToggle}
                      onClick={(event) => event.stopPropagation()}
                      className="data-[state=checked]:bg-emerald-500 ml-2"
                    />
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                {/* Manual Refresh */}
                <DropdownMenuItem onClick={onRefresh} disabled={isLoading}>
                  <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />
                  {dashboardT("refresh")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* Theme Selection */}
                <DropdownMenuLabel className="flex items-center gap-2">
                  {theme === "dark" ? (
                    <Moon className="w-4 h-4" />
                  ) : (
                    <Sun className="w-4 h-4" />
                  )}
                  {settingsT("theme")}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => onThemeChange("light")}
                  className={theme === "light" ? "bg-muted" : ""}
                >
                  <Sun className="w-4 h-4 mr-2 text-amber-500" />
                  {themeT("light")} {theme === "light" && "✓"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onThemeChange("dark")}
                  className={theme === "dark" ? "bg-muted" : ""}
                >
                  <Moon className="w-4 h-4 mr-2 text-indigo-500" />
                  {themeT("dark")} {theme === "dark" && "✓"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onThemeChange("system")}
                  className={theme === "system" ? "bg-muted" : ""}
                >
                  <Monitor className="w-4 h-4 mr-2 text-slate-500" />
                  {themeT("system")} {theme === "system" && "✓"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                {/* Language Selection */}
                <DropdownMenuLabel className="flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  {settingsT("language")}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    const newPathname = pathname.replace(
                      `/${locale}`,
                      "/en"
                    );
                    onNavigate(newPathname);
                  }}
                  className={locale === "en" ? "bg-muted" : ""}
                >
                  English {locale === "en" && "✓"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const newPathname = pathname.replace(
                      `/${locale}`,
                      "/zh"
                    );
                    onNavigate(newPathname);
                  }}
                  className={locale === "zh" ? "bg-muted" : ""}
                >
                  中文 {locale === "zh" && "✓"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const newPathname = pathname.replace(
                      `/${locale}`,
                      "/ru"
                    );
                    onNavigate(newPathname);
                  }}
                  className={locale === "ru" ? "bg-muted" : ""}
                >
                  Русский {locale === "ru" && "✓"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                {/* Settings */}
                <DropdownMenuItem onClick={onOpenBackendDialog}>
                  <Settings className="w-4 h-4 mr-2" />
                  {backendT("manageBackends")}
                </DropdownMenuItem>

                {/* About */}
                <DropdownMenuItem onClick={onOpenAboutDialog}>
                  <Info className="w-4 h-4 mr-2 text-primary" />
                  {aboutT("title")}
                </DropdownMenuItem>
                {authState?.enabled && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                      <LogOut className="w-4 h-4 mr-2" />
                      {dashboardT("logout")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Refresh Button - show when auto refresh is off or backend is unhealthy (desktop only) */}
          {(!autoRefresh || backendStatus === "unhealthy") && (
            <Button
              variant="outline"
              size="icon"
              onClick={onRefresh}
              disabled={isLoading}
              className="h-9 w-9 hidden sm:flex"
            >
              <RefreshCw
                className={cn("w-4 h-4", isLoading && "animate-spin")}
              />
            </Button>
          )}

        </div>
      </div>
      {/* Transition progress bar - sits at the bottom edge of the header */}
      {showProgress && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 bg-primary/60 rounded-full animate-progress-indeterminate" />
        </div>
      )}
    </header>
  );
}
