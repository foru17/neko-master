"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  Clock,
  RotateCcw,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { enUS, ru, zhCN } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getPresetTimeRange, type TimeRange } from "@/lib/api";

type PresetType =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "24h"
  | "7d"
  | "30d"
  | "today"
  | "custom";

interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange, preset: PresetType) => void;
  className?: string;
  showcaseMode?: boolean;
}

function toLocalTimeInputValue(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function mergeDateAndTime(date: Date, time: string): Date {
  const [hour, minute] = time.split(":").map((v) => parseInt(v || "0", 10));
  const next = new Date(date);
  next.setHours(hour || 0, minute || 0, 0, 0);
  return next;
}

function inferPresetFromRange(range: TimeRange): PresetType {
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return "custom";
  }

  const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
  if (diffMin === 1) return "1m";
  if (diffMin === 5) return "5m";
  if (diffMin === 15) return "15m";
  if (diffMin === 30) return "30m";
  if (diffMin === 60) return "1h";
  if (diffMin === 24 * 60) return "24h";
  if (diffMin === 7 * 24 * 60) return "7d";
  if (diffMin === 30 * 24 * 60) return "30d";

  const isToday =
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    start.getSeconds() === 0 &&
    start.getMilliseconds() === 0 &&
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (isToday) return "today";

  return "custom";
}

function formatDateButton(
  date: Date | undefined,
  localeCode: string,
  fallbackText: string,
): string {
  if (!date) return fallbackText;
  return date.toLocaleDateString(localeCode, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatCustomRangeDisplay(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";

  const dateNoYear = (d: Date) => `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  const dateShortYear = (d: Date) =>
    `${String(d.getFullYear()).slice(-2)}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  const time = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (sameDay) {
    return `${dateNoYear(start)} ${time(start)}-${time(end)}`;
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) {
    return `${dateNoYear(start)} ${time(start)}-${dateNoYear(end)} ${time(end)}`;
  }

  return `${dateShortYear(start)} ${time(start)}-${dateShortYear(end)} ${time(end)}`;
}

export function TimeRangePicker({
  value,
  onChange,
  className,
  showcaseMode,
}: TimeRangePickerProps) {
  const locale = useLocale();
  const t = useTranslations("timeRangePicker");
  const localeCode = locale.startsWith("zh")
    ? "zh-CN"
    : locale.startsWith("ru")
      ? "ru-RU"
      : "en-US";
  const calendarLocale = locale.startsWith("zh")
    ? zhCN
    : locale.startsWith("ru")
      ? ru
      : enUS;
  const showDebugShortPresets = process.env.NODE_ENV !== "production";
  const showShortPresetInProduction = (
    preset: Extract<PresetType, "1m" | "5m" | "15m" | "30m">,
  ) => preset === "5m" || preset === "30m";

  const quickPresets = useMemo<
    Array<{ value: Exclude<PresetType, "custom">; label: string }>
  >(() => {
    const stablePresets: Array<{
      value: Exclude<PresetType, "custom">;
      label: string;
    }> = [
      { value: "1h", label: t("preset.1h") },
      { value: "24h", label: t("preset.24h") },
      { value: "7d", label: t("preset.7d") },
      { value: "30d", label: t("preset.30d") },
      { value: "today", label: t("preset.today") },
    ];

    const shortPresets: Array<{
      value: Extract<PresetType, "1m" | "5m" | "15m" | "30m">;
      label: string;
    }> = [
      { value: "1m", label: t("preset.1m") },
      { value: "5m", label: t("preset.5m") },
      { value: "15m", label: t("preset.15m") },
      { value: "30m", label: t("preset.30m") },
    ];

    const enabledShortPresets = shortPresets.filter((preset) =>
      showDebugShortPresets
        ? true
        : showShortPresetInProduction(preset.value),
    );

    return [...enabledShortPresets, ...stablePresets];
  }, [showDebugShortPresets, t]);

  const [open, setOpen] = useState(false);
  const [openFromDate, setOpenFromDate] = useState(false);
  const [openToDate, setOpenToDate] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetType>(
    inferPresetFromRange(value),
  );

  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [fromTime, setFromTime] = useState("00:00");
  const [toTime, setToTime] = useState("23:59");

  const syncDraftFromRange = (range: TimeRange) => {
    const start = new Date(range.start);
    const end = new Date(range.end);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      setFromDate(start);
      setToDate(end);
      setFromTime(toLocalTimeInputValue(start));
      setToTime(toLocalTimeInputValue(end));
    }
    const inferredPreset = inferPresetFromRange(range);
    const normalizedPreset =
      !showDebugShortPresets &&
      (inferredPreset === "1m" ||
        inferredPreset === "15m")
        ? "custom"
        : inferredPreset;
    setSelectedPreset(normalizedPreset);
  };

  const syncDraftFromValue = () => syncDraftFromRange(value);

  // Keep draft synced with external value except while actively editing custom
  // range in the opened panel.
  useEffect(() => {
    if (open && selectedPreset === "custom") return;
    syncDraftFromValue();
  }, [value, open, selectedPreset]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const desktopDisplayText = useMemo(() => {
    if (selectedPreset === "custom") {
      return formatCustomRangeDisplay(value.start, value.end);
    }
    const match = quickPresets.find((p) => p.value === selectedPreset);
    if (!match) return t("defaultRange");
    if (match.value === "today") return t("today");
    return `${t("recentPrefix")} ${match.label}`;
  }, [selectedPreset, value.start, value.end, localeCode, quickPresets, t]);

  const mobileDisplayText = useMemo(() => {
    if (selectedPreset === "custom") {
      return t("customShort");
    }
    const match = quickPresets.find((p) => p.value === selectedPreset);
    if (!match) return t("preset.24h");
    if (match.value === "today") return t("today");
    return match.label;
  }, [selectedPreset, quickPresets, t]);

  const applyQuickPreset = (preset: Exclude<PresetType, "custom">) => {
    const next = getPresetTimeRange(preset);
    syncDraftFromRange(next);
    setSelectedPreset(preset);
    onChange(next, preset);
    setOpen(false);
  };

  const applyCustom = () => {
    if (!fromDate || !toDate) return;
    const start = mergeDateAndTime(fromDate, fromTime);
    const end = mergeDateAndTime(toDate, toTime);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start > end
    ) {
      return;
    }
    onChange({ start: start.toISOString(), end: end.toISOString() }, "custom");
    setSelectedPreset("custom");
    setOpen(false);
  };

  const resetToDefault = () => {
    const next = getPresetTimeRange("24h");
    onChange(next, "24h");
    setSelectedPreset("24h");
    setOpen(false);
  };

  const [lockIcon, setLockIcon] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-9 w-[138px] justify-between rounded-xl border-0 bg-secondary/45 px-3 text-sm shadow-none hover:bg-secondary/65",
            selectedPreset === "custom"
              ? "sm:w-[220px] lg:w-[250px] xl:w-[280px]"
              : "sm:w-[152px]",
            className,
          )}>
          <span className="flex min-w-0 items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="truncate sm:hidden">{mobileDisplayText}</span>
            <span className="hidden truncate sm:inline">{desktopDisplayText}</span>
          </span>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      
      <PopoverContent
              className="w-[calc(100vw-2rem)] sm:w-[352px] max-w-[calc(100vw-1rem)] rounded-xl border border-border/60 bg-popover text-popover-foreground p-4 shadow-xs space-y-4"
              align={isMobile ? "center" : "end"}
              sideOffset={8}
              collisionPadding={12}>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground ">
                  {t("quickRange")}
                </Label>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  {quickPresets.map((preset) => {
                    const active = selectedPreset === preset.value;
                    // In showcase mode, disable presets larger than 24h (7d, 30d)
                    // We allow "today" as it is within 24h context usually, or at least acceptable
                    const isDisabled = showcaseMode && (preset.value === "7d" || preset.value === "30d");
                    
                    return (
                      <Button
                        key={preset.value}
                        size="sm"
                        variant="outline"
                        disabled={isDisabled}
                        className={cn(
                          "rounded-full transition-colors",
                          active
                            ? "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-500/90 hover:text-white"
                            : "bg-secondary/50 border-border/70 text-muted-foreground hover:bg-secondary hover:text-foreground",
                          isDisabled && "opacity-50 cursor-not-allowed"
                        )}
                        onClick={() => applyQuickPreset(preset.value)}>
                        {preset.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
      
              <div className="space-y-3 border-t border-border pt-3">
                  <div className="text-xs text-muted-foreground">
                    {t("customRange")}
                  </div>
        
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="time-range-from-date" className="text-xs">
                        {t("startDate")}
                      </Label>
                      <Popover open={openFromDate} onOpenChange={setOpenFromDate}>
                        <PopoverTrigger asChild>
                          <Button
                            id="time-range-from-date"
                            variant="outline"
                            className="w-full justify-between font-normal">
                            {formatDateButton(fromDate, localeCode, t("pickDate"))}
                            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-auto overflow-hidden rounded-xl border border-border/60 bg-popover text-popover-foreground p-0 shadow-xs z-[90]"
                          align="start"
                          sideOffset={6}
                          collisionPadding={12}>
                          <Calendar
                            locale={calendarLocale}
                            mode="single"
                            selected={fromDate}
                            onSelect={(date) => {
                              setFromDate(date);
                              setOpenFromDate(false);
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="time-range-from-time" className="text-xs">
                        {t("time")}
                      </Label>
                      <Input
                        id="time-range-from-time"
                        type="time"
                        step={60}
                        value={fromTime}
                        onChange={(e) => setFromTime(e.target.value)}
                        className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                      />
                    </div>
                  </div>
        
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="time-range-to-date" className="text-xs">
                        {t("endDate")}
                      </Label>
                      <Popover open={openToDate} onOpenChange={setOpenToDate}>
                        <PopoverTrigger asChild>
                          <Button
                            id="time-range-to-date"
                            variant="outline"
                            className="w-full justify-between font-normal">
                            {formatDateButton(toDate, localeCode, t("pickDate"))}
                            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-auto overflow-hidden rounded-xl border border-border/60 bg-popover text-popover-foreground p-0 shadow-xs z-[90]"
                          align="start"
                          sideOffset={6}
                          collisionPadding={12}>
                          <Calendar
                            locale={calendarLocale}
                            mode="single"
                            selected={toDate}
                            disabled={fromDate ? { before: fromDate } : undefined}
                            onSelect={(date) => {
                              setToDate(date);
                              setOpenToDate(false);
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="time-range-to-time" className="text-xs">
                        {t("time")}
                      </Label>
                      <Input
                        id="time-range-to-time"
                        type="time"
                        step={60}
                        value={toTime}
                        onChange={(e) => setToTime(e.target.value)}
                        className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                      />
                    </div>
                  </div>
        
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="flex-1 bg-blue-600 hover:bg-blue-600/90 text-white"
                      onClick={applyCustom}>
                      {t("applyCustom")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={resetToDefault}>
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
            </PopoverContent>
    </Popover>
  );
}

export function QuickTimePresets({
  onChange,
}: {
  onChange: (range: TimeRange) => void;
}) {
  const showDebugShortPresets = process.env.NODE_ENV !== "production";
  const presets = [
    ...(showDebugShortPresets
      ? [{ label: "1m", range: getPresetTimeRange("1m") }]
      : []),
    { label: "5m", range: getPresetTimeRange("5m") },
    ...(showDebugShortPresets
      ? [{ label: "15m", range: getPresetTimeRange("15m") }]
      : []),
    { label: "30m", range: getPresetTimeRange("30m") },
    { label: "1h", range: getPresetTimeRange("1h") },
    { label: "24h", range: getPresetTimeRange("24h") },
    { label: "7d", range: getPresetTimeRange("7d") },
    { label: "30d", range: getPresetTimeRange("30d") },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((preset) => (
        <Button
          key={preset.label}
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => onChange(preset.range)}>
          {preset.label}
        </Button>
      ))}
    </div>
  );
}
