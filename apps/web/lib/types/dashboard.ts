export type TimePreset =
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

export type BackendStatus = "healthy" | "unhealthy" | "unknown";

export type TabId =
  | "overview"
  | "domains"
  | "countries"
  | "devices"
  | "proxies"
  | "rules"
  | "network"
  | "health"
  | "nodes"
  | "daemon"
  | "rulecfg"
  | "diag"
  | "ops";
