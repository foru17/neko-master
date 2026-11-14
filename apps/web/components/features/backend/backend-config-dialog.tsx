"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Server,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  RefreshCw,
  AlertCircle,
  ShieldAlert,
  CheckCircle2,
  Database,
  HardDrive,
  Trash,
  Settings,
  Radio,
  Eye,
  SlidersHorizontal,
  Globe,
  Shield,
  Lock,
  EyeOff,
  Key,
  Copy,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatBytes, formatNumber } from "@/lib/utils";
import { api, type GeoLookupConfig, type GeoLookupProvider } from "@/lib/api";
import { isAgentBackendUrl } from "@neko-master/shared";
import { toast } from "sonner";
import { BackendVerifyAnimation } from "@/components/features/backend/backend-verify-animation";
import { BackendListSkeleton } from "@/components/ui/insight-skeleton";
import { useSettings, FaviconProvider, getFaviconUrl } from "@/lib/settings";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuthState, authKeys } from "@/lib/auth-queries";
import { ProxyNameAliasSettings } from "./proxy-name-alias-settings";

// Favicon Provider Preview Component
function FaviconProviderPreview({
  selected,
  onChange,
  t,
}: {
  selected: FaviconProvider;
  onChange: (value: FaviconProvider) => void;
  t: (key: string) => string;
}) {
  // Preview domains for the right side (desktop: 4, mobile: 2)
  const previewDomains = [
    "youtube.com",
    "github.com",
    "instagram.com",
    "chatgpt.com",
  ];

  return (
    <RadioGroup
      value={selected}
      onValueChange={(value) => onChange(value as FaviconProvider)}
      className="space-y-3">
      {/* Google Option */}
      <div
        className={cn(
          "flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 rounded-lg border transition-all cursor-pointer",
          selected === "google"
            ? "border-primary bg-primary/5"
            : "border-border hover:bg-muted/50",
        )}
        onClick={() => onChange("google")}>
        {/* Top row: Radio + Icon + Label */}
        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <RadioGroupItem value="google" id="google" className="shrink-0" />

          {/* Provider Icon - Google */}
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center overflow-hidden shrink-0">
            <img
              src="https://www.google.com/favicon.ico"
              alt="Google"
              className="w-6 h-6 object-contain"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          {/* Label */}
          <Label
            htmlFor="google"
            className="font-medium cursor-pointer flex-1 min-w-0">
            {t("faviconGoogle")}
          </Label>
        </div>

        {/* Preview Icons - Bottom on mobile, Right on desktop */}
        <div className="flex items-center gap-2 pl-7 sm:pl-0">
          {previewDomains.map((domain) => (
            <div
              key={domain}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
              <img
                src={getFaviconUrl(domain, "google")}
                alt={domain}
                className="w-4 h-4 sm:w-5 sm:h-5 object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Favicon.im Option */}
      <div
        className={cn(
          "flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 rounded-lg border transition-all cursor-pointer",
          selected === "faviconim"
            ? "border-primary bg-primary/5"
            : "border-border hover:bg-muted/50",
        )}
        onClick={() => onChange("faviconim")}>
        {/* Top row: Radio + Icon + Label */}
        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <RadioGroupItem
            value="faviconim"
            id="faviconim"
            className="shrink-0"
          />

          {/* Provider Icon - favicon.im */}
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
            <img
              src="https://favicon.im/favicon.im?larger=true"
              alt="favicon.im"
              className="w-6 h-6 object-contain"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          {/* Label */}
          <Label
            htmlFor="faviconim"
            className="font-medium cursor-pointer flex-1 min-w-0">
            {t("faviconIm")}
          </Label>
        </div>

        {/* Preview Icons - Bottom on mobile, Right on desktop */}
        <div className="flex items-center gap-2 pl-7 sm:pl-0">
          {previewDomains.map((domain) => (
            <div
              key={domain}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
              <img
                src={getFaviconUrl(domain, "faviconim")}
                alt={domain}
                className="w-4 h-4 sm:w-5 sm:h-5 object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Off Option */}
      <div
        className={cn(
          "flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 rounded-lg border transition-all cursor-pointer",
          selected === "off"
            ? "border-primary bg-primary/5"
            : "border-border hover:bg-muted/50",
        )}
        onClick={() => onChange("off")}>
        {/* Top row: Radio + Icon + Label */}
        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <RadioGroupItem value="off" id="off" className="shrink-0" />

          {/* Provider Icon - Off */}
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
            <Globe className="w-5 h-5 text-muted-foreground" />
          </div>

          {/* Label */}
          <Label
            htmlFor="off"
            className="font-medium cursor-pointer flex-1 min-w-0">
            {t("faviconOff")}
          </Label>
        </div>

        {/* Preview Icons - Default placeholders */}
        <div className="flex items-center gap-2 pl-7 sm:pl-0">
          {previewDomains.map((domain) => (
            <div
              key={domain}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
              <Globe className="w-4 h-4 text-muted-foreground" />
            </div>
          ))}
        </div>
      </div>
    </RadioGroup>
  );
}

interface BackendHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastChecked: number;
  message?: string;
  latency?: number;
}

interface Backend {
  id: number;
  name: string;
  url: string;
  host: string;
  port?: number;
  mode: BackendMode;
  agentId: string;
  token: string;
  type?: 'clash' | 'surge';
  enabled: boolean;
  is_active: boolean;
  listening: boolean;
  hasToken?: boolean;
  health?: BackendHealth;
  created_at: string;
}

interface BackendConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isFirstTime?: boolean;
  onConfigComplete?: () => void;
  onBackendChange?: () => void;
}

interface AgentBootstrapInfo {
  backendId: number;
  agentId: string;
  token: string;
  tokenLocked?: boolean;
  type: 'clash' | 'surge';
  gatewayHost: string;
  gatewayPort: string;
  gatewaySsl: boolean;
  gatewayToken: string;
}

interface DbStats {
  size: number;
  sqliteSize: number;
  clickhouseSize: number;
  totalConnectionsCount: number;
}

// Retention presets - inspired by AdGuard Home
const RETENTION_PRESETS = [
  { key: "minimal", days: 3 },
  { key: "standard", days: 7 },
  { key: "extended", days: 30 },
  { key: "maximum", days: 90 },
] as const;

type PresetKey = (typeof RETENTION_PRESETS)[number]["key"];

interface RetentionConfig {
  connectionLogsDays: number;
  hourlyStatsDays: number;
  autoCleanup: boolean;
}

type BackendMode = "direct" | "agent";

interface ParsedBackendUrl {
  mode: BackendMode;
  host: string;
  port: string;
  ssl: boolean;
  agentId: string;
}

interface BackendFormState {
  name: string;
  mode: BackendMode;
  host: string;
  port: string;
  ssl: boolean;
  token: string;
  type: 'clash' | 'surge';
  agentId: string;
  agentGatewayHost: string;
  agentGatewayPort: string;
  agentGatewaySsl: boolean;
  agentGatewayToken: string;
}

const DEFAULT_BACKEND_PORT = "9090";
const DEFAULT_AGENT_GATEWAY_HOST = "127.0.0.1";
const AGENT_BOOTSTRAP_CONFIG_STORAGE_KEY = "neko-agent-bootstrap-config-v1";

interface AgentGatewayConfig {
  gatewayHost: string;
  gatewayPort: string;
  gatewaySsl: boolean;
  gatewayToken: string;
}

function getDefaultGatewayPort(type: 'clash' | 'surge'): string {
  return type === "surge" ? "9091" : "9090";
}

function getDefaultAgentGatewayConfig(type: 'clash' | 'surge'): AgentGatewayConfig {
  return {
    gatewayHost: DEFAULT_AGENT_GATEWAY_HOST,
    gatewayPort: getDefaultGatewayPort(type),
    gatewaySsl: false,
    gatewayToken: "",
  };
}

function buildGatewayUrl(type: 'clash' | 'surge', host: string, port: string, ssl: boolean): string {
  const normalizedHost = host.trim() || DEFAULT_AGENT_GATEWAY_HOST;
  const normalizedPort = port.trim() || getDefaultGatewayPort(type);
  const protocol = ssl ? "https" : "http";
  return `${protocol}://${normalizedHost}:${normalizedPort}`;
}

function loadAgentGatewayConfig(
  backendId: number,
  type: 'clash' | 'surge',
): AgentGatewayConfig {
  const fallback = getDefaultAgentGatewayConfig(type);
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(AGENT_BOOTSTRAP_CONFIG_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, Partial<AgentGatewayConfig>>;
    const stored = parsed[String(backendId)] || {};
    return {
      gatewayHost: String(stored.gatewayHost || fallback.gatewayHost),
      gatewayPort: String(stored.gatewayPort || fallback.gatewayPort),
      gatewaySsl: Boolean(stored.gatewaySsl),
      gatewayToken: String(stored.gatewayToken || ""),
    };
  } catch {
    return fallback;
  }
}

function saveAgentGatewayConfig(backendId: number, config: AgentGatewayConfig): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const raw = window.localStorage.getItem(AGENT_BOOTSTRAP_CONFIG_STORAGE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Record<string, Partial<AgentGatewayConfig>>)
      : {};
    parsed[String(backendId)] = {
      gatewayHost: config.gatewayHost.trim() || DEFAULT_AGENT_GATEWAY_HOST,
      gatewayPort: config.gatewayPort.trim(),
      gatewaySsl: config.gatewaySsl,
      gatewayToken: config.gatewayToken,
    };
    window.localStorage.setItem(
      AGENT_BOOTSTRAP_CONFIG_STORAGE_KEY,
      JSON.stringify(parsed),
    );
  } catch {
    // Ignore storage write errors.
  }
}

function sanitizeAgentId(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "agent";
}

function generateAgentMarker(seed: string): string {
  const base = sanitizeAgentId(seed || "agent");
  try {
    const bytes = new Uint8Array(4);
    globalThis.crypto?.getRandomValues?.(bytes);
    const hash = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `${base}-${hash}`;
  } catch {
    const fallback = Math.random().toString(16).slice(2, 10);
    return `${base}-${fallback}`;
  }
}

function getInitialFormState(): BackendFormState {
  return {
    name: "",
    mode: "direct",
    host: "",
    port: DEFAULT_BACKEND_PORT,
    ssl: false,
    token: "",
    type: "clash",
    agentId: "",
    agentGatewayHost: DEFAULT_AGENT_GATEWAY_HOST,
    agentGatewayPort: getDefaultGatewayPort("clash"),
    agentGatewaySsl: false,
    agentGatewayToken: "",
  };
}

function parseAgentId(url: string): string {
  const raw = url.replace(/^agent:\/\//i, "").split(/[/?#]/)[0] || "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// Parse backend URL for form/view rendering
function parseBackendUrl(url: string): ParsedBackendUrl {
  if (isAgentBackendUrl(url)) {
    return {
      mode: "agent",
      host: "",
      port: "",
      ssl: false,
      agentId: parseAgentId(url),
    };
  }

  try {
    const urlObj = new URL(url);
    return {
      mode: "direct",
      host: decodeURIComponent(urlObj.hostname),
      port: urlObj.port || (urlObj.protocol === "https:" ? "443" : "80"),
      ssl: urlObj.protocol === "https:",
      agentId: "",
    };
  } catch {
    return {
      mode: "direct",
      host: "",
      port: DEFAULT_BACKEND_PORT,
      ssl: false,
      agentId: "",
    };
  }
}

function buildDirectUrl(host: string, port: string, ssl: boolean): string {
  const protocol = ssl ? "https" : "http";
  return `${protocol}://${host}:${port}`;
}

function buildAgentUrl(agentId: string): string {
  return `agent://${sanitizeAgentId(agentId)}`;
}

const AGENT_INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh";

function getSuggestedServerUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function buildAgentRunCommand(info: AgentBootstrapInfo, showToken = true): string {
  let generated = "";
  {
    const gatewayUrlWithConfig = buildGatewayUrl(
      info.type,
      info.gatewayHost,
      info.gatewayPort,
      info.gatewaySsl,
    );
    const rawToken = info.token.trim() || "<backend-token>";
    const backendToken = showToken ? rawToken : "***";
    const lines = [
      "./neko-agent \\",
      "  --server-url " + shellQuote(getSuggestedServerUrl()) + " \\",
      "  --backend-id " + info.backendId + " \\",
      "  --backend-token " + shellQuote(backendToken) + " \\",
      "  --gateway-type " + shellQuote(info.type) + " \\",
      "  --gateway-url " + shellQuote(gatewayUrlWithConfig),
    ];

    if (info.gatewayToken.trim()) {
      lines[lines.length - 1] = lines[lines.length - 1] + " \\";
      lines.push("  --gateway-token " + shellQuote(info.gatewayToken.trim()));
    }

    generated = lines.join("\n");
  }

  const gatewayUrl =
    info.type === "surge" ? "http://127.0.0.1:9091" : "http://127.0.0.1:9090";

  const _legacy = [
    "./neko-agent \\",
    `  --server-url ${getSuggestedServerUrl()} \\`,
    `  --backend-id ${info.backendId} \\`,
    `  --backend-token ${info.token} \\`,
    `  --gateway-type ${info.type} \\`,
    `  --gateway-url ${gatewayUrl}`,
  ].join("\n");
  void _legacy;
  return generated;
}

function buildAgentInstallScriptCommand(info: AgentBootstrapInfo, showToken = true): string {
  let generated = "";
  {
    const gatewayUrlWithConfig = buildGatewayUrl(
      info.type,
      info.gatewayHost,
      info.gatewayPort,
      info.gatewaySsl,
    );
    const rawToken = info.token.trim() || "<backend-token>";
    const backendToken = showToken ? rawToken : "***";
    const lines = [
      "curl -fsSL " + AGENT_INSTALL_SCRIPT_URL + " \\",
      "  | env NEKO_SERVER=" + shellQuote(getSuggestedServerUrl()) + " \\",
      "        NEKO_BACKEND_ID=" + shellQuote(String(info.backendId)) + " \\",
      "        NEKO_BACKEND_TOKEN=" + shellQuote(backendToken) + " \\",
      "        NEKO_GATEWAY_TYPE=" + shellQuote(info.type) + " \\",
      "        NEKO_GATEWAY_URL=" + shellQuote(gatewayUrlWithConfig) + " \\",
    ];

    if (info.gatewayToken.trim()) {
      lines.push(
        "        NEKO_GATEWAY_TOKEN=" + shellQuote(info.gatewayToken.trim()) + " \\",
      );
    }

    lines.push("        sh");
    generated = lines.join("\n");
  }

  const gatewayUrl =
    info.type === "surge" ? "http://127.0.0.1:9091" : "http://127.0.0.1:9090";

  const _legacy = [
    `curl -fsSL ${AGENT_INSTALL_SCRIPT_URL} \\`,
    `  | env NEKO_SERVER=${shellQuote(getSuggestedServerUrl())} \\`,
    `        NEKO_BACKEND_ID=${shellQuote(String(info.backendId))} \\`,
    `        NEKO_BACKEND_TOKEN=${shellQuote(info.token)} \\`,
    `        NEKO_GATEWAY_TYPE=${shellQuote(info.type)} \\`,
    `        NEKO_GATEWAY_URL=${shellQuote(gatewayUrl)} \\`,
    `        sh`,
  ].join("\n");
  void _legacy;
  return generated;
}

function buildAgentQuickAddCommand(info: AgentBootstrapInfo, showToken = true): string {
  const gatewayUrlWithConfig = buildGatewayUrl(
    info.type,
    info.gatewayHost,
    info.gatewayPort,
    info.gatewaySsl,
  );
  const rawToken = info.token.trim() || "<backend-token>";
  const backendToken = showToken ? rawToken : "***";
  const instanceName = `backend-${info.backendId}`;

  const lines = [
    "nekoagent add " + shellQuote(instanceName) + " \\",
    "  --server-url " + shellQuote(getSuggestedServerUrl()) + " \\",
    "  --backend-id " + info.backendId + " \\",
    "  --backend-token " + shellQuote(backendToken) + " \\",
    "  --gateway-type " + shellQuote(info.type) + " \\",
    "  --gateway-url " + shellQuote(gatewayUrlWithConfig),
  ];

  if (info.gatewayToken.trim()) {
    lines[lines.length - 1] = lines[lines.length - 1] + " \\";
    lines.push("  --gateway-token " + shellQuote(info.gatewayToken.trim()));
  }

  return lines.join("\n");
}

export function BackendConfigDialog({
  open,
  onOpenChange,
  isFirstTime = false,
  onConfigComplete,
  onBackendChange,
}: BackendConfigDialogProps) {
  const t = useTranslations("backend");
  const commonT = useTranslations("common");

  const [backends, setBackends] = useState<Backend[]>([]);
  const [backendsLoading, setBackendsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<
    "backends" | "database" | "preferences" | "security"
  >("backends");
  const { settings, setSettings } = useSettings();
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [clearingLogs, setClearingLogs] = useState(false);

  // Data retention state
  const [retentionConfig, setRetentionConfig] = useState<RetentionConfig>({
    connectionLogsDays: 7,
    hourlyStatsDays: 30,
    autoCleanup: true,
  });
  const [updatingRetention, setUpdatingRetention] = useState(false);
  const [geoLookupConfig, setGeoLookupConfig] = useState<GeoLookupConfig>({
    provider: "online",
    configuredProvider: "online",
    effectiveProvider: "online",
    mmdbDir: "/app/data/geoip",
    onlineApiUrl: "https://api.ipinfo.es/ipinfo",
    localMmdbReady: false,
    missingMmdbFiles: [],
  });
  const [updatingGeoLookup, setUpdatingGeoLookup] = useState(false);

  // Alert Dialog States
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBackendId, setDeleteBackendId] = useState<number | null>(null);
  const [clearLogsDialogOpen, setClearLogsDialogOpen] = useState(false);
  const [clearLogsDays, setClearLogsDays] = useState<number>(0);
  const [clearBackendDataDialogOpen, setClearBackendDataDialogOpen] =
    useState(false);
  const [clearDataBackendId, setClearDataBackendId] = useState<number | null>(
    null,
  );
  const [agentBootstrapDialogOpen, setAgentBootstrapDialogOpen] =
    useState(false);
  const [agentBootstrapInfo, setAgentBootstrapInfo] =
    useState<AgentBootstrapInfo | null>(null);
  const [activeScriptTab, setActiveScriptTab] = useState<"install" | "add" | "run">("install");
  const [showAgentToken, setShowAgentToken] = useState(false);
  const [rotatingAgentToken, setRotatingAgentToken] = useState(false);
  const [rotateAgentTokenDialogOpen, setRotateAgentTokenDialogOpen] = useState(false);

  // Error Alert Dialog State
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Success Alert Dialog State


  // React Query Client
  const queryClient = useQueryClient();

  // Auth State from React Query
  const { data: authState } = useAuthState();
  const authEnabled = authState?.enabled ?? false;
  const isShowcase = authState?.showcaseMode ?? false;

  // Local auth form state
  const [authToken, setAuthToken] = useState("");
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [confirmEnableAuthDialogOpen, setConfirmEnableAuthDialogOpen] = useState(false);
  const [confirmDisableAuthDialogOpen, setConfirmDisableAuthDialogOpen] = useState(false);
  const [changeTokenDialogOpen, setChangeTokenDialogOpen] = useState(false);
  const [changeTokenForm, setChangeTokenForm] = useState({
    current: "",
    new: "",
    confirm: "",
  });

  // Verify Animation State
  const [showVerifyAnimation, setShowVerifyAnimation] = useState(false);
  const [verifyPhase, setVerifyPhase] = useState<
    "pending" | "success" | "error"
  >("pending");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [pendingBackend, setPendingBackend] = useState<{
    name: string;
    url: string;
    token: string;
    type: 'clash' | 'surge';
  } | null>(null);

  const [formData, setFormData] = useState<BackendFormState>(
    getInitialFormState(),
  );

  const [editFormData, setEditFormData] = useState<BackendFormState>(
    getInitialFormState(),
  );

  const [showAddForm, setShowAddForm] = useState(false);
  const [autoOpenedAddDialog, setAutoOpenedAddDialog] = useState(false);

  useEffect(() => {
    if (open) {
      loadBackends();
      loadDbStats();
      loadRetentionConfig();
      loadGeoLookupConfig();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !isFirstTime || backendsLoading || autoOpenedAddDialog) return;
    if (backends.length === 0) {
      setShowAddForm(true);
      setAutoOpenedAddDialog(true);
    }
  }, [open, isFirstTime, backendsLoading, backends.length, autoOpenedAddDialog]);

  useEffect(() => {
    if (!open) {
      setAutoOpenedAddDialog(false);
    }
  }, [open]);

  const loadBackends = async (silent = false) => {
    if (!silent) setBackendsLoading(true);
    try {
      const data = await api.getBackends();
      // Parse URL for display/form rendering
      const parsedData: Backend[] = data.map((b) => {
        const parsed = parseBackendUrl(b.url);
        return {
          ...b,
          type: b.type || "clash",
          mode: parsed.mode,
          host: parsed.host,
          port:
            parsed.mode === "direct"
              ? Number.parseInt(parsed.port || DEFAULT_BACKEND_PORT, 10) ||
                Number.parseInt(DEFAULT_BACKEND_PORT, 10)
              : undefined,
          agentId: parsed.agentId,
        };
      });
      setBackends(parsedData);
    } catch (error) {
      console.error("Failed to load backends:", error);
    } finally {
      if (!silent) setBackendsLoading(false);
    }
  };

  const loadDbStats = async () => {
    try {
      const stats = await api.getDbStats();
      setDbStats({
        size: stats.size,
        sqliteSize: stats.sqliteSize ?? stats.size,
        clickhouseSize: stats.clickhouseSize ?? 0,
        totalConnectionsCount: stats.totalConnectionsCount,
      });
    } catch (error) {
      console.error("Failed to load DB stats:", error);
    }
  };

  const loadRetentionConfig = async () => {
    try {
      const config = await api.getRetentionConfig();
      setRetentionConfig(config);
    } catch (error) {
      console.error("Failed to load retention config:", error);
    }
  };

  const loadGeoLookupConfig = async () => {
    try {
      const config = await api.getGeoLookupConfig();
      setGeoLookupConfig(config);
    } catch (error) {
      console.error("Failed to load geo lookup config:", error);
    }
  };

  const handleUpdateGeoLookupConfig = async (
    updates: {
      provider?: GeoLookupProvider;
      onlineApiUrl?: string;
    },
  ) => {
    try {
      setUpdatingGeoLookup(true);
      const result = await api.updateGeoLookupConfig(updates);
      setGeoLookupConfig(result.config);
      toast.success(t("geoLookupUpdated"));
    } catch (error: any) {
      toast.error(error.message || t("geoLookupUpdateFailed"));
    } finally {
      setUpdatingGeoLookup(false);
    }
  };

  const handleGeoLookupProviderChange = (value: string) => {
    const provider = value as GeoLookupProvider;
    if (provider !== "online" && provider !== "local") return;
    if (provider === "local" && !geoLookupConfig.localMmdbReady) {
      const missing = geoLookupConfig.missingMmdbFiles.join(", ");
      toast.error(
        t("geoLookupLocalUnavailable", {
          files: missing || "GeoLite2-City.mmdb, GeoLite2-ASN.mmdb",
        }),
      );
      return;
    }
    handleUpdateGeoLookupConfig({ provider });
  };

  const selectedGeoLookupProvider =
    geoLookupConfig.effectiveProvider ?? geoLookupConfig.provider;

  const handleUpdateRetention = async (
    key: keyof RetentionConfig,
    value: number | boolean,
  ) => {
    try {
      setUpdatingRetention(true);
      const newConfig = { ...retentionConfig, [key]: value };
      await api.updateRetentionConfig(newConfig);
      setRetentionConfig(newConfig);
      toast.success(t("retentionUpdated"));
    } catch (error: any) {
      toast.error(error.message || t("retentionUpdateFailed"));
    } finally {
      setUpdatingRetention(false);
    }
  };

  // Check which preset matches current config
  const getActivePreset = (): PresetKey | "custom" => {
    const preset = RETENTION_PRESETS.find(
      (p) => p.days === retentionConfig.connectionLogsDays,
    );
    return preset ? preset.key : "custom";
  };

  // Apply preset
  const applyPreset = async (presetKey: PresetKey) => {
    const preset = RETENTION_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;

    try {
      setUpdatingRetention(true);
      const newConfig = {
        connectionLogsDays: preset.days,
        hourlyStatsDays: Math.min(preset.days * 4, 90), // Hourly stats = 4x detail days, max 90
        autoCleanup: true,
      };
      await api.updateRetentionConfig(newConfig);
      setRetentionConfig(newConfig);
      toast.success(t("retentionUpdated"));
    } catch (error: any) {
      toast.error(error.message || t("retentionUpdateFailed"));
    } finally {
      setUpdatingRetention(false);
    }
  };

  // Apply custom days
  const applyCustomDays = async (days: number) => {
    const validDays = Math.max(1, Math.min(30, days));
    try {
      setUpdatingRetention(true);
      const newConfig = {
        connectionLogsDays: validDays,
        hourlyStatsDays: Math.min(validDays * 4, 90),
        autoCleanup: true,
      };
      await api.updateRetentionConfig(newConfig);
      setRetentionConfig(newConfig);
      toast.success(t("retentionUpdated"));
    } catch (error: any) {
      toast.error(error.message || t("retentionUpdateFailed"));
    } finally {
      setUpdatingRetention(false);
    }
  };

  const handleAdd = async () => {
    const name = formData.name.trim();
    if (!name) return;

    const isAgentMode = formData.mode === "agent";

    if (isAgentMode) {
      const agentId = generateAgentMarker(name);
      setLoading(true);
      try {
        const result = await api.createBackend({
          name,
          url: buildAgentUrl(agentId),
          type: formData.type,
        });

        setFormData(getInitialFormState());
        setShowAddForm(false);
        await loadBackends();
        await onBackendChange?.();

        toast.success(t("agentBackendCreated", { id: result.id }));
        const agentGatewayConfig: AgentGatewayConfig = {
          gatewayHost: formData.agentGatewayHost.trim() || DEFAULT_AGENT_GATEWAY_HOST,
          gatewayPort: formData.agentGatewayPort.trim() || getDefaultGatewayPort(formData.type),
          gatewaySsl: formData.agentGatewaySsl,
          gatewayToken: formData.agentGatewayToken,
        };
        saveAgentGatewayConfig(result.id, agentGatewayConfig);
        if (result.agentToken) {
          setAgentBootstrapInfo({
            backendId: result.id,
            agentId,
            token: result.agentToken,
            tokenLocked: true,
            type: formData.type,
            gatewayHost: agentGatewayConfig.gatewayHost,
            gatewayPort: agentGatewayConfig.gatewayPort,
            gatewaySsl: agentGatewayConfig.gatewaySsl,
            gatewayToken: agentGatewayConfig.gatewayToken,
          });
          setAgentBootstrapDialogOpen(true);
        }
        if (result.isActive) {
          toast.success(t("firstBackendAutoActive"));
        }

        if (isFirstTime && onConfigComplete && !result.agentToken) {
          await onConfigComplete();
          onOpenChange(false);
        }
      } catch (error: any) {
        setErrorMessage(error.message || "Failed to create backend");
        setErrorDialogOpen(true);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!formData.host.trim()) return;
    const url = buildDirectUrl(formData.host, formData.port, formData.ssl);

    // Show verification animation immediately
    setPendingBackend({ name, url, token: formData.token, type: formData.type });
    setVerifyPhase("pending");
    setVerifyMessage("");
    setShowVerifyAnimation(true);

    // Perform verification
    try {
      const testResult = await api.testBackend(url, formData.token, formData.type);

      if (testResult.success) {
        setVerifyPhase("success");
        setVerifyMessage(testResult.message || t("testSuccess"));
      } else {
        setVerifyPhase("error");
        setVerifyMessage(testResult.message || t("testFailed"));
      }
    } catch (error: any) {
      setVerifyPhase("error");
      setVerifyMessage(error.message || t("testFailed"));
    }
  };

  // Called after verification animation completes
  const handleVerifyComplete = async () => {
    if (!pendingBackend) return;

    // Only save if verification was successful
    if (verifyPhase === "success") {
      try {
        const result = await api.createBackend({
          name: pendingBackend.name,
          url: pendingBackend.url,
          token: pendingBackend.token,
          type: pendingBackend.type,
        });

        setFormData(getInitialFormState());
        setShowAddForm(false);
        setShowVerifyAnimation(false);
        setPendingBackend(null);
        await loadBackends();
        await onBackendChange?.();

        // Show success message for first backend
        if (result.isActive) {
          toast.success(t("firstBackendAutoActive"));
        }

        if (isFirstTime && onConfigComplete) {
          await onConfigComplete();
          onOpenChange(false);
        }
      } catch (error: any) {
        setShowVerifyAnimation(false);
        setPendingBackend(null);
        setErrorMessage(error.message || "Failed to create backend");
        setErrorDialogOpen(true);
      }
    } else {
      // Verification failed, just close animation and reset
      setShowVerifyAnimation(false);
      setPendingBackend(null);
    }
  };

  const handleUpdate = async (id: number) => {
    const name = editFormData.name.trim();
    if (!name) return;

    const current = backends.find((b) => b.id === id);
    const isAgentMode = editFormData.mode === "agent";
    const token = isAgentMode ? "" : editFormData.token.trim();

    if (!isAgentMode && !editFormData.host.trim()) return;

    setLoading(true);
    try {
      // Preserve the original URL when host/port/ssl haven't been touched.
      // Rebuilding via buildDirectUrl would silently drop any path, query, or
      // embedded credentials present in the original URL — see issue #65.
      let url: string;
      if (isAgentMode) {
        url =
          current && isAgentBackendUrl(current.url)
            ? current.url
            : buildAgentUrl(generateAgentMarker(name));
      } else if (current && !isAgentBackendUrl(current.url)) {
        const parsed = parseBackendUrl(current.url);
        const hostUnchanged = parsed.host === editFormData.host.trim();
        const portUnchanged = parsed.port === editFormData.port.trim();
        const sslUnchanged = parsed.ssl === editFormData.ssl;
        url =
          hostUnchanged && portUnchanged && sslUnchanged
            ? current.url
            : buildDirectUrl(editFormData.host, editFormData.port, editFormData.ssl);
      } else {
        url = buildDirectUrl(editFormData.host, editFormData.port, editFormData.ssl);
      }
      await api.updateBackend(id, {
        name,
        url,
        token: token ? token : undefined,
        type: editFormData.type,
      });
      setEditingId(null);
      setEditFormData(getInitialFormState());
      await loadBackends();
      await onBackendChange?.();
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to update backend");
      setErrorDialogOpen(true);
    } finally {
      setLoading(false);
    }
  };

  // Open delete confirmation dialog
  const openDeleteDialog = (id: number) => {
    setDeleteBackendId(id);
    setDeleteDialogOpen(true);
  };

  // Handle actual delete
  const handleDelete = async () => {
    if (!deleteBackendId) return;

    setLoading(true);
    try {
      await api.deleteBackend(deleteBackendId);
      await loadBackends();
      await onBackendChange?.();
      setDeleteDialogOpen(false);
      setDeleteBackendId(null);
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to delete backend");
      setErrorDialogOpen(true);
    } finally {
      setLoading(false);
    }
  };

  // Handle set active backend (for display)
  const handleSetActive = async (id: number) => {
    try {
      await api.setActiveBackend(id);
      // Refresh local backend list to update UI (active state, eye icon)
      await loadBackends(true);
      // Notify parent to refresh dashboard data
      await onBackendChange?.();
      // Show toast notification
      toast.success(t("switchSuccess"));
    } catch (error: any) {
      toast.error(error.message || t("switchFailed"));
    }
  };

  // Handle toggle listening (data collection)
  const handleToggleListening = async (id: number, listening: boolean) => {
    try {
      await api.setBackendListening(id, listening);
      await loadBackends(true);
      await onBackendChange?.();
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to update listening state");
      setErrorDialogOpen(true);
    }
  };

  // Open clear backend data dialog
  const openClearBackendDataDialog = (id: number) => {
    setClearDataBackendId(id);
    setClearBackendDataDialogOpen(true);
  };

  // Handle clear backend data
  const handleClearBackendData = async () => {
    if (!clearDataBackendId) return;

    setLoading(true);
    try {
      await api.clearBackendData(clearDataBackendId);
      await loadDbStats();
      await onBackendChange?.();
      setClearBackendDataDialogOpen(false);
      setClearDataBackendId(null);
    } catch (error: any) {
      setErrorMessage(
        error.message ||
          t("clearBackendDataError") ||
          "Failed to clear backend data",
      );
      setErrorDialogOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async (backend: Backend) => {
    setTestingId(backend.id);
    try {
      const result = await api.testBackendById(backend.id);
      const nextHealth: BackendHealth = {
        status: result.success ? "healthy" : "unhealthy",
        lastChecked: Date.now(),
        message: result.message,
      };
      setBackends((prev) =>
        prev.map((item) => (item.id === backend.id ? { ...item, health: nextHealth } : item)),
      );

      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      await loadBackends();
      await onBackendChange?.();
    } catch (error: any) {
      toast.error(error.message || "Test failed");
    } finally {
      setTestingId(null);
    }
  };

  // Open clear logs dialog
  const openClearLogsDialog = (days: number) => {
    setClearLogsDays(days);
    setClearLogsDialogOpen(true);
  };

  // Handle actual clear logs
  const handleClearLogs = async () => {
    setClearingLogs(true);
    try {
      await api.clearLogs(clearLogsDays);
      await loadDbStats();
      await onBackendChange?.();
      setClearLogsDialogOpen(false);
      toast.success(t("logsCleared"));
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to clear logs");
      setErrorDialogOpen(true);
    } finally {
      setClearingLogs(false);
    }
  };

  const copyText = async (text: string, successKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t(successKey));
    } catch {
      toast.error(commonT("error"));
    }
  };

  const openAgentSetup = (backend: Backend) => {
    const backendType = backend.type || "clash";
    const gatewayConfig = loadAgentGatewayConfig(backend.id, backendType);
    setAgentBootstrapInfo({
      backendId: backend.id,
      agentId: backend.agentId,
      token: backend.token || "",
      tokenLocked: true,
      type: backendType,
      gatewayHost: gatewayConfig.gatewayHost,
      gatewayPort: gatewayConfig.gatewayPort,
      gatewaySsl: gatewayConfig.gatewaySsl,
      gatewayToken: gatewayConfig.gatewayToken,
    });
    setAgentBootstrapDialogOpen(true);
    setShowAgentToken(false); // Reset token visibility when opening dialog
  };

  const handleRotateAgentToken = async () => {
    if (!agentBootstrapInfo) return;

    setRotatingAgentToken(true);
    try {
      const result = await api.rotateAgentToken(agentBootstrapInfo.backendId);
      setAgentBootstrapInfo({
        ...agentBootstrapInfo,
        token: result.agentToken,
        tokenLocked: true,
      });
      toast.success(t("agentRotateTokenSuccess"));
      await loadBackends();
      await onBackendChange?.();
      setRotateAgentTokenDialogOpen(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t("agentRotateTokenFailed");
      toast.error(message || t("agentRotateTokenFailed"));
    } finally {
      setRotatingAgentToken(false);
    }
  };

  const closeAgentBootstrapDialog = async () => {
    if (agentBootstrapInfo) {
      saveAgentGatewayConfig(agentBootstrapInfo.backendId, {
        gatewayHost: agentBootstrapInfo.gatewayHost,
        gatewayPort: agentBootstrapInfo.gatewayPort,
        gatewaySsl: agentBootstrapInfo.gatewaySsl,
        gatewayToken: agentBootstrapInfo.gatewayToken,
      });
    }
    setAgentBootstrapDialogOpen(false);
    setAgentBootstrapInfo(null);
    if (isFirstTime && onConfigComplete) {
      await onConfigComplete();
      onOpenChange(false);
    }
  };

  const [isTokenInvalid, setIsTokenInvalid] = useState(false);
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const editingBackend =
    editingId !== null ? backends.find((backend) => backend.id === editingId) || null : null;

  // Validate token format
  const isValidToken = (token: string): boolean => {
    if (token.length < 6) return false;
    const hasLetter = /[a-zA-Z]/.test(token);
    const hasNumber = /[0-9]/.test(token);
    return hasLetter && hasNumber;
  };

  // Handle enable auth
  const handleEnableAuth = async () => {
    if (!isValidToken(authToken)) {
      // toast.error(t("invalidToken"));
      setIsTokenInvalid(true);
      tokenInputRef.current?.focus();
      return;
    }
    setConfirmEnableAuthDialogOpen(true);
  };

  // Confirm enable auth
  const confirmEnableAuth = async () => {
    setAuthLoading(true);
    try {
      await api.enableAuth(authToken);
      setAuthToken("");
      setConfirmEnableAuthDialogOpen(false);
      // Invalidate auth state cache to trigger refetch
      queryClient.invalidateQueries({ queryKey: authKeys.state() });
      toast.success(t("auth.enabledSuccess"));
    } catch (error: any) {
      toast.error(error.message || t("auth.enableFailed"));
    } finally {
      setAuthLoading(false);
    }
  };

  // Handle disable auth
  const handleDisableAuth = async () => {
    setConfirmDisableAuthDialogOpen(true);
  };
  // Confirm disable auth
  const confirmDisableAuth = async () => {
    setAuthLoading(true);
    try {
      // Cookie is used for authentication
      await api.disableAuth();
      setAuthToken("");
      setConfirmDisableAuthDialogOpen(false);
      // Invalidate auth state cache to trigger refetch
      queryClient.invalidateQueries({ queryKey: authKeys.state() });
      toast.success(t("auth.disabledSuccess"));
    } catch (error: any) {
      toast.error(error.message || t("auth.disableFailed"));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleChangeToken = async () => {
    if (!changeTokenForm.new || changeTokenForm.new.length < 6) {
      toast.error(t("auth.invalidToken"));
      return;
    }
    if (changeTokenForm.new !== changeTokenForm.confirm) {
        toast.error(t("auth.passwordsDoNotMatch")); 
        return;
    }

    setAuthLoading(true);
    try {
        const res = await api.updateToken(changeTokenForm.current, changeTokenForm.new);
        if (res.success) {
            setChangeTokenForm({ current: "", new: "", confirm: "" });
            setChangeTokenDialogOpen(false);
            toast.success(t("auth.tokenUpdated"));
        } else {
            throw new Error(res.message || commonT("error"));
        }
    } catch (error: any) {
        setErrorMessage(error.message || t("auth.updateTokenFailed"));
        setErrorDialogOpen(true);
    } finally {
        setAuthLoading(false);
    }
  };

  const startEdit = (backend: Backend) => {
    setEditingId(backend.id);
    setEditFormData({
      name: backend.name,
      mode: backend.mode,
      host: backend.host || "",
      port: String(backend.port || DEFAULT_BACKEND_PORT),
      ssl: backend.mode === "direct" && backend.url.startsWith("https"),
      token: "",
      type: backend.type || "clash",
      agentId: backend.agentId || "",
      agentGatewayHost: DEFAULT_AGENT_GATEWAY_HOST,
      agentGatewayPort: getDefaultGatewayPort(backend.type || "clash"),
      agentGatewaySsl: false,
      agentGatewayToken: "",
    });
    setShowAddForm(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditFormData(getInitialFormState());
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              {isFirstTime ? t("firstTimeTitle") : t("title")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {isFirstTime ? t("firstTimeDescription") : t("description")}
            </p>

            {/* Tabs */}
            <div className="flex gap-2 mt-4 flex-wrap">
              <Button
                variant={activeTab === "backends" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("backends")}>
                <Server className="w-4 h-4 mr-2" />
                {t("backendsTab")}
              </Button>
              <Button
                variant={activeTab === "preferences" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("preferences")}>
                <SlidersHorizontal className="w-4 h-4 mr-2" />
                {t("preferencesTab")}
              </Button>
              <Button
                variant={activeTab === "security" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("security")}>
                <Shield className="w-4 h-4 mr-2" />
                {t("securityTab")}
              </Button>
              <Button
                variant={activeTab === "database" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("database")}>
                <Database className="w-4 h-4 mr-2" />
                {t("databaseTab")}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {activeTab === "backends" ? (
              // Backends Tab
              <div className="space-y-3">
                {backendsLoading ? (
                  <BackendListSkeleton count={3} />
                ) : backends.length === 0 && !showAddForm ? (
                  // Empty state
                  <div className="text-center py-8 text-muted-foreground">
                    <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">{t("noBackends")}</p>
                    <p className="text-xs mt-1 opacity-70">{t("addBackendHint")}</p>
                  </div>
                ) : (
                  <>
                {backends.map((backend) => (
                  <div
                    key={backend.id}
                    className={cn(
                      "p-4 rounded-lg border transition-all",
                      backend.is_active
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card",
                      !backend.enabled && "opacity-60",
                    )}>
                    {false && editingId === backend.id ? (
                      // Edit Mode
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium">
                              {t("name")}
                            </label>
                            <Input
                              value={editFormData.name}
                              onChange={(e) =>
                                setEditFormData({
                                  ...editFormData,
                                  name: e.target.value,
                                })
                              }
                              placeholder={t("namePlaceholder")}
                              className="h-9 mt-1"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium">
                              {t("connectionMode")}
                            </label>
                            <select
                              value={editFormData.mode}
                              onChange={(e) =>
                                setEditFormData({
                                  ...editFormData,
                                  mode: e.target.value as BackendMode,
                                })
                              }
                              className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              <option value="direct">{t("modeDirect")}</option>
                              <option value="agent">{t("modeAgent")}</option>
                            </select>
                          </div>
                        </div>
                        <div
                          className={cn(
                            "grid gap-3",
                            editFormData.mode === "direct" ? "grid-cols-2" : "grid-cols-1",
                          )}>
                          <div>
                            <label className="text-xs font-medium">
                              {t("type")}
                            </label>
                            <select
                              value={editFormData.type}
                              onChange={(e) =>
                                setEditFormData({ ...editFormData, type: e.target.value as 'clash' | 'surge' })
                              }
                              className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              <option value="clash">Clash / Mihomo</option>
                              <option value="surge">Surge</option>
                            </select>
                          </div>
                          {editFormData.mode === "direct" && (
                            <div>
                              <label className="text-xs font-medium">
                                {t("host")}
                              </label>
                              <Input
                                value={editFormData.host}
                                onChange={(e) =>
                                  setEditFormData({
                                    ...editFormData,
                                    host: e.target.value,
                                  })
                                }
                                placeholder="192.168.1.1"
                                className="h-9 mt-1"
                              />
                            </div>
                          )}
                        </div>
                        {editFormData.mode === "direct" && (
                          <>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs font-medium">
                                  {t("port")}
                                </label>
                                <Input
                                  value={editFormData.port}
                                  onChange={(e) =>
                                    setEditFormData({
                                      ...editFormData,
                                      port: e.target.value,
                                    })
                                  }
                                  placeholder={DEFAULT_BACKEND_PORT}
                                  className="h-9 mt-1"
                                />
                              </div>
                              <div className="flex items-center gap-2 pt-6">
                                <Switch
                                  checked={editFormData.ssl}
                                  onCheckedChange={(checked) =>
                                    setEditFormData({
                                      ...editFormData,
                                      ssl: checked,
                                    })
                                  }
                                />
                                <label className="text-sm">{t("useSsl")}</label>
                              </div>
                            </div>
                          </>
                        )}
                        <div>
                          <label className="text-xs font-medium">
                            {t("token")}
                          </label>
                          <Input
                            type="password"
                            value={editFormData.token}
                            onChange={(e) =>
                              setEditFormData({
                                ...editFormData,
                                token: e.target.value,
                              })
                            }
                            placeholder={
                              backend.hasToken
                                ? t("tokenKeepPlaceholder")
                                : editFormData.mode === "agent"
                                  ? t("tokenRequiredPlaceholder")
                                  : editFormData.type === "surge"
                                    ? t("tokenPlaceholderSurge")
                                    : t("tokenPlaceholder")
                            }
                            className="h-9 mt-1"
                          />
                          {editFormData.mode === "agent" && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {t("agentTokenHint")}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}>
                            <X className="w-4 h-4 mr-1" />
                            {commonT("cancel")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleUpdate(backend.id)}
                            disabled={loading}>
                            <Check className="w-4 h-4 mr-1" />
                            {commonT("save")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      // View Mode
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        {/* Left: Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-base">
                              {backend.name}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                              {backend.mode === "agent"
                                ? t("modeAgent")
                                : t("modeDirect")}
                            </span>
                            {/* Backend Type Icon */}
                            <div
                              className="w-4 h-4 rounded-sm bg-white/90 flex items-center justify-center p-0.5"
                              title={backend.type === 'surge' ? 'Surge' : 'Clash / Mihomo'}
                            >
                              <img
                                src={backend.type === 'surge' ? '/icons/icon-surge.png' : '/icons/icon-clash.png'}
                                alt={backend.type === 'surge' ? 'Surge' : 'Clash'}
                                className="w-full h-full object-contain"
                              />
                            </div>
                            {!backend.enabled && (
                              <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
                                {t("disabled")}
                              </span>
                            )}
                          </div>
                          <div
                            className="text-sm text-muted-foreground mt-1 break-all sm:break-normal sm:truncate"
                            title={
                              backend.mode === "agent"
                                ? backend.url
                                : `${backend.host}:${backend.port}`
                            }>
                            {backend.mode === "agent"
                              ? `${backend.url} · #${backend.id}`
                              : `${backend.host}:${backend.port}`}
                          </div>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex w-full sm:w-auto items-center justify-between sm:justify-end gap-2 shrink-0">
                          {/* Collect Toggle with Label */}
                          <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg bg-secondary/50">
                            <Switch
                              checked={backend.listening}
                              onCheckedChange={(checked) =>
                                handleToggleListening(backend.id, checked)
                              }
                              className="data-[state=checked]:bg-green-500"
                              disabled={isShowcase}
                            />
                            <span className="text-xs text-muted-foreground hidden sm:inline">
                              {t("collect")}
                            </span>
                          </div>

                          {/* Action Buttons Group */}
                          <div className="flex items-center gap-1 pl-0 border-l-0 sm:pl-2 sm:border-l sm:border-border">
                            {/* Set Active Button - Show placeholder when active to maintain layout */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-8 w-8",
                                backend.is_active &&
                                  "opacity-50 cursor-not-allowed",
                              )}
                              onClick={() =>
                                !backend.is_active &&
                                handleSetActive(backend.id)
                              }
                              disabled={backend.is_active}
                              title={
                                backend.is_active
                                  ? t("displaying")
                                  : t("setActive")
                              }>
                              <Eye
                                className={cn(
                                  "w-4 h-4",
                                  backend.is_active && "text-primary",
                                )}
                              />
                            </Button>

                            <TooltipProvider delayDuration={100}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={cn(
                                      "h-8 w-8",
                                      backend.health?.status === 'healthy' && "text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-500/10",
                                      backend.health?.status === 'unhealthy' && "text-red-500 hover:text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-500/10",
                                      !backend.health && "text-gray-400"
                                    )}
                                    onClick={() => handleTest(backend)}
                                    disabled={testingId === backend.id}>
                                    <RefreshCw
                                      className={cn(
                                        "w-4 h-4",
                                        testingId === backend.id && "animate-spin",
                                        backend.health?.status === 'healthy' && !testingId && "text-green-500",
                                        backend.health?.status === 'unhealthy' && !testingId && "text-red-500",
                                      )}
                                    />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs max-w-[200px]">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-medium">{t("testConnection")}</span>
                                    {backend.health ? (
                                      <span className={cn(
                                        "text-[10px]",
                                        backend.health.status === 'healthy' ? "text-green-500" : 
                                        backend.health.status === 'unhealthy' ? "text-red-500" : "text-gray-400"
                                      )}>
                                        {backend.health.message || 
                                          (backend.health.status === 'healthy' ? 'Healthy' : 
                                           backend.health.status === 'unhealthy' ? 'Unhealthy' : 'Unknown')}
                                        {backend.health.latency && ` (${backend.health.latency}ms)`}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-gray-400">Click to test connection</span>
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>

                            {backend.mode === "agent" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openAgentSetup(backend)}
                                title={t("openAgentSetup")}
                                disabled={isShowcase}>
                                <Terminal className="w-4 h-4" />
                              </Button>
                            )}
                            {backend.mode !== "agent" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 invisible pointer-events-none"
                                tabIndex={-1}
                                aria-hidden="true">
                                <Terminal className="w-4 h-4" />
                              </Button>
                            )}

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => startEdit(backend)}
                              title={commonT("edit")}
                              disabled={isShowcase}>
                              <Edit2 className="w-4 h-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => openDeleteDialog(backend.id)}
                              title={commonT("delete")}
                              disabled={isShowcase}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                  </>
                )}

                {/* Add New Backend */}
                {false && (showAddForm || (isFirstTime && backends.length === 0)) ? (
                  <div className="p-4 rounded-lg border border-dashed border-border bg-muted/50">
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Plus className="w-4 h-4" />
                      {backends.length === 0 && isFirstTime
                        ? t("firstTimeTitle")
                        : t("addNew")}
                    </h4>
                    {isShowcase ? (
                      <div className="text-sm text-muted-foreground italic">
                        {t("showcaseModeAddDisabled") || "Adding backends is disabled in showcase mode"}
                      </div>
                    ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium">
                            {t("name")} *
                          </label>
                          <Input
                            value={formData.name}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                name: e.target.value,
                              })
                            }
                            placeholder={t("namePlaceholder")}
                            className="h-9 mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium">
                            {t("connectionMode")}
                          </label>
                          <select
                            value={formData.mode}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                mode: e.target.value as BackendMode,
                              })
                            }
                            className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <option value="direct">{t("modeDirect")}</option>
                            <option value="agent">{t("modeAgent")}</option>
                          </select>
                        </div>
                      </div>
                      <div
                        className={cn(
                          "grid gap-3",
                          formData.mode === "direct" ? "grid-cols-2" : "grid-cols-1",
                        )}>
                        <div>
                          <label className="text-xs font-medium">
                            {t("type")}
                          </label>
                          <select
                            value={formData.type}
                            onChange={(e) => {
                              const nextType = e.target.value as 'clash' | 'surge';
                              const currentDefaultPort = getDefaultGatewayPort(formData.type);
                              const nextDefaultPort = getDefaultGatewayPort(nextType);
                              setFormData({
                                ...formData,
                                type: nextType,
                                agentGatewayPort:
                                  formData.agentGatewayPort === currentDefaultPort
                                    ? nextDefaultPort
                                    : formData.agentGatewayPort,
                              });
                            }}
                            className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <option value="clash">Clash / Mihomo</option>
                            <option value="surge">Surge</option>
                          </select>
                        </div>
                        {formData.mode === "direct" && (
                          <div>
                            <label className="text-xs font-medium">
                              {t("host")} *
                            </label>
                            <Input
                              value={formData.host}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  host: e.target.value,
                                })
                              }
                              placeholder="192.168.1.1"
                              className="h-9 mt-1"
                            />
                          </div>
                        )}
                      </div>
                      {formData.mode === "direct" && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium">
                              {t("port")}
                            </label>
                            <Input
                              value={formData.port}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  port: e.target.value,
                                })
                              }
                              placeholder={DEFAULT_BACKEND_PORT}
                              className="h-9 mt-1"
                            />
                          </div>
                          <div className="flex items-center gap-2 pt-6">
                            <Switch
                              checked={formData.ssl}
                              onCheckedChange={(checked) =>
                                setFormData({ ...formData, ssl: checked })
                              }
                            />
                            <label className="text-sm">{t("useSsl")}</label>
                          </div>
                        </div>
                      )}
                      {formData.mode === "direct" ? (
                        <div>
                          <label className="text-xs font-medium">
                            {t("token")}
                          </label>
                          <Input
                            type="password"
                            value={formData.token}
                            onChange={(e) =>
                              setFormData({ ...formData, token: e.target.value })
                            }
                            placeholder={
                              formData.type === "surge"
                                ? t("tokenPlaceholderSurge")
                                : t("tokenPlaceholder")
                            }
                            className="h-9 mt-1"
                          />
                        </div>
                      ) : (
                        <div className="space-y-3 rounded-md border border-dashed p-3">
                          <p className="text-[11px] text-muted-foreground">
                            {t("agentTokenAutoHint")}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {t("agentGatewayOptionalHint")}
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-medium">
                                {t("host")}
                              </label>
                              <Input
                                value={formData.agentGatewayHost}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    agentGatewayHost: e.target.value,
                                  })
                                }
                                placeholder={DEFAULT_AGENT_GATEWAY_HOST}
                                className="h-9 mt-1"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium">
                                {t("port")}
                              </label>
                              <Input
                                value={formData.agentGatewayPort}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    agentGatewayPort: e.target.value,
                                  })
                                }
                                placeholder={getDefaultGatewayPort(formData.type)}
                                className="h-9 mt-1"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs font-medium">
                              {t("gatewayToken")}
                            </label>
                            <Input
                              type="password"
                              value={formData.agentGatewayToken}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  agentGatewayToken: e.target.value,
                                })
                              }
                              placeholder={t("agentGatewayTokenPlaceholder")}
                              className="h-9 mt-1"
                            />
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2">
                        {backends.length > 0 && (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setShowAddForm(false);
                              setFormData(getInitialFormState());
                            }}
                            className="flex-shrink-0">
                            <X className="w-4 h-4 mr-2" />
                            {commonT("cancel")}
                          </Button>
                        )}
                        <Button
                          onClick={handleAdd}
                          disabled={
                            loading ||
                            !formData.name.trim() ||
                            (formData.mode === "direct" && !formData.host.trim())
                          }
                          className="flex-1">
                          <Plus className="w-4 h-4 mr-2" />
                          {isFirstTime && backends.length === 0
                            ? t("saveAndContinue")
                            : t("addBackend")}
                        </Button>
                      </div>
                    </div>
                    )}
                  </div>
                ) : (
                  !isShowcase && (
                  <Button
                    variant="outline"
                    className="w-full border-dashed"
                    onClick={() => {
                      cancelEdit();
                      setFormData(getInitialFormState());
                      setShowAddForm(true);
                    }}>
                    <Plus className="w-4 h-4 mr-2" />
                    {t("addNew")}
                  </Button>
                  )
                )}
              </div>
            ) : activeTab === "preferences" ? (
              <div className="space-y-6">
                <ProxyNameAliasSettings backends={backends} disabled={isShowcase} />
                {/* Favicon Provider */}
                <div className="p-4 rounded-lg border bg-card">
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    {t("faviconProvider")}
                  </h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("faviconProviderDescription")}
                  </p>

                  {/* Favicon Preview */}
                  <FaviconProviderPreview
                    selected={settings.faviconProvider}
                    onChange={(value) =>
                      setSettings({ faviconProvider: value })
                    }
                    t={t}
                  />
                </div>

                {/* GeoIP Lookup Provider */}
                <div className="p-4 rounded-lg border bg-card space-y-4">
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Radio className="w-4 h-4" />
                    {t("geoLookupProvider")}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {t("geoLookupProviderDescription")}
                  </p>

                  <RadioGroup
                    value={selectedGeoLookupProvider}
                    onValueChange={handleGeoLookupProviderChange}
                    className="space-y-2"
                    disabled={updatingGeoLookup || isShowcase}>
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-md border p-3 transition-all",
                        selectedGeoLookupProvider === "online"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50",
                        !(updatingGeoLookup || isShowcase) && "cursor-pointer",
                      )}
                      onClick={() => {
                        if (updatingGeoLookup || isShowcase) return;
                        handleGeoLookupProviderChange("online");
                      }}>
                      <RadioGroupItem value="online" id="geo-provider-online" />
                      <Label htmlFor="geo-provider-online" className="cursor-pointer font-medium">
                        {t("geoLookupOnline")}
                      </Label>
                    </div>
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-md border p-3 transition-all",
                        selectedGeoLookupProvider === "local"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50",
                        !geoLookupConfig.localMmdbReady &&
                          "opacity-60 cursor-not-allowed hover:bg-transparent",
                        geoLookupConfig.localMmdbReady &&
                          !(updatingGeoLookup || isShowcase) &&
                          "cursor-pointer",
                      )}
                      onClick={() => {
                        if (updatingGeoLookup || isShowcase || !geoLookupConfig.localMmdbReady) return;
                        handleGeoLookupProviderChange("local");
                      }}>
                      <RadioGroupItem
                        value="local"
                        id="geo-provider-local"
                        disabled={!geoLookupConfig.localMmdbReady}
                      />
                      <Label
                        htmlFor="geo-provider-local"
                        className={cn(
                          "cursor-pointer font-medium",
                          !geoLookupConfig.localMmdbReady && "cursor-not-allowed",
                        )}>
                        {t("geoLookupLocal")}
                      </Label>
                    </div>
                  </RadioGroup>

                  <p className="text-xs text-muted-foreground">
                    {t("geoLookupFixedPathHint")}
                  </p>
                  {!geoLookupConfig.localMmdbReady && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {t("geoLookupLocalUnavailable", {
                        files:
                          geoLookupConfig.missingMmdbFiles.join(", ") ||
                          "GeoLite2-City.mmdb, GeoLite2-ASN.mmdb",
                      })}
                    </p>
                  )}
                </div>
              </div>
            ) : activeTab === "security" ? (
              <div className="space-y-6">
                {authState?.forceAccessControlOff && (
                  <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive dark:bg-destructive/10">
                    <div className="flex items-center gap-2 font-medium">
                      <ShieldAlert className="h-4 w-4" />
                      {t("auth.forceOffWarningTitle") || "Emergency Access Mode Active"}
                    </div>
                    <p className="mt-1 ml-6 text-xs opacity-90">
                      {t("auth.forceOffWarningDescription") || "Authentication is forced off via environment variable. You can reset your password without providing the current one."}
                    </p>
                  </div>
                )}

                {/* Authentication Settings */}
                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" />
                      <h4 className="text-sm font-medium">{t("auth.title")}</h4>
                    </div>
                    <Switch
                      checked={authEnabled}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          handleEnableAuth();
                        } else {
                          handleDisableAuth();
                        }
                       }}
                       disabled={authLoading || isShowcase}
                    />
                  </div>

                  <p className="text-sm text-muted-foreground mb-4">
                    {t("auth.description")}
                  </p>

                  {/* Show set password UI when auth is disabled OR forced off */}
                  {(!authEnabled || (authState?.forceAccessControlOff && !authEnabled)) && (
                    <div className="space-y-3">
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          ref={tokenInputRef}
                          type={showAuthToken ? "text" : "password"}
                          placeholder={t("auth.tokenPlaceholder")}
                          value={authToken}
                          onChange={(e) => {
                            setAuthToken(e.target.value);
                            setIsTokenInvalid(false);
                          }}
                          className={cn(
                            "pl-10 pr-10 transition-all duration-200",
                            isTokenInvalid && "border-destructive ring-destructive/20 focus-visible:ring-destructive"
                          )}
                          disabled={authLoading || isShowcase}
                        />
                        <button
                          type="button"
                          onClick={() => setShowAuthToken(!showAuthToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showAuthToken ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      {isTokenInvalid && (
                        <p className="text-xs text-destructive animate-in slide-in-from-top-1 duration-200">
                          {t("auth.tokenRequirements") || "Token must be at least 6 characters and contain both letters and numbers"}
                        </p>
                      )}

                      {!isTokenInvalid && authToken && !isValidToken(authToken) && (
                        <p className="text-xs text-destructive">
                          {t("auth.tokenRequirements")}
                        </p>
                      )}

                      <p className="text-xs text-muted-foreground">
                        {t("auth.tokenHint")}
                      </p>
                    </div>
                  )}

                  {authEnabled && (
                    <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <div className="flex items-center gap-2 text-sm text-green-600">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{t("auth.enabled")}</span>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-8 bg-background/50 hover:bg-background/80 border-green-500/30 text-green-700 dark:text-green-400"
                        onClick={() => setChangeTokenDialogOpen(true)}
                        disabled={isShowcase}
                      >
                        <Key className="w-3.5 h-3.5 mr-1.5" />
                        {authState?.forceAccessControlOff ? "Reset Password" : t("auth.changeToken")}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Warning when auth is enabled */}
                {authEnabled && !authState?.forceAccessControlOff && (
                  <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5" />
                      <div className="text-sm text-amber-800 dark:text-amber-200">
                        <p className="font-medium">{t("auth.warningTitle")}</p>
                        <p className="mt-1">{t("auth.warningDescription")}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : activeTab === "database" ? (
              // Database Tab
              <div className="space-y-6">
                {/* DB Stats */}
                <div className="p-4 rounded-lg border bg-card">
                  <h4 className="text-sm font-medium mb-4 flex items-center gap-2">
                    <HardDrive className="w-4 h-4" />
                    {t("databaseStats")}
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-lg bg-muted flex flex-col justify-between h-full">
                      <div className="text-xs text-muted-foreground mb-1">
                        {t("dbSize")}
                      </div>
                      <div className="text-lg font-semibold">
                        {dbStats ? formatBytes(dbStats.size) : "--"}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {dbStats
                          ? t("dbSizeBreakdown", {
                              sqlite: formatBytes(dbStats.sqliteSize),
                              clickhouse: formatBytes(dbStats.clickhouseSize),
                            })
                          : "--"}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted flex flex-col justify-between h-full">
                      <div className="text-xs text-muted-foreground mb-1">
                        {t("connectionsCount")}
                      </div>
                      <div className="text-lg font-semibold">
                        {dbStats
                          ? formatNumber(dbStats.totalConnectionsCount)
                          : "--"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Data Retention Settings */}
                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      {t("dataRetention")}
                    </h4>
                    <span className="text-sm text-muted-foreground">
                      {t("retentionDays", {
                        days: retentionConfig.connectionLogsDays,
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    {t("dataRetentionDescription")}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {/* Preset Buttons */}
                    {RETENTION_PRESETS.map((preset) => {
                      const isActive = getActivePreset() === preset.key;
                      return (
                        <button
                          key={preset.key}
                          onClick={() => applyPreset(preset.key)}
                          disabled={updatingRetention || isShowcase}
                          className={cn(
                            "px-3 py-1.5 text-sm rounded-md border transition-all",
                            isActive
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-border hover:bg-muted/50 text-muted-foreground",
                          )}
                          title={t(
                            `retentionPreset${preset.key.charAt(0).toUpperCase() + preset.key.slice(1)}Desc`,
                          )}>
                          {t(
                            `retentionPreset${preset.key.charAt(0).toUpperCase() + preset.key.slice(1)}`,
                          )}
                        </button>
                      );
                    })}

                    {/* Custom Input */}
                    <div
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded-md border transition-all",
                        getActivePreset() === "custom"
                          ? "border-primary bg-primary/10"
                          : "border-border",
                      )}>
                      <Input
                        type="number"
                        min={1}
                        max={90}
                        value={retentionConfig.connectionLogsDays}
                        onChange={(e) => {
                          const days = parseInt(e.target.value) || 1;
                          applyCustomDays(Math.min(90, Math.max(1, days)));
                        }}
                        disabled={updatingRetention || isShowcase}
                        className="w-14 h-6 text-sm text-center p-0 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                      <span className="text-xs text-muted-foreground">
                        {commonT("days")}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Clear Logs - Dangerous action, placed at the bottom */}
                <div className="p-4 rounded-lg border ">
                  <h4 className="text-sm font-medium mb-4 flex items-center gap-2 text-destructive">
                    <Trash className="w-4 h-4" />
                    {t("clearLogs")}
                  </h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("clearLogsDescription")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openClearLogsDialog(1)}
                      disabled={clearingLogs || isShowcase}>
                      {t("clear1Day")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openClearLogsDialog(7)}
                      disabled={clearingLogs || isShowcase}>
                      {t("clear7Days")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openClearLogsDialog(30)}
                      disabled={clearingLogs || isShowcase}>
                      {t("clear30Days")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => openClearLogsDialog(0)}
                      disabled={clearingLogs || isShowcase}>
                      {t("clearAll")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Close button for non-first-time */}
            {!isFirstTime && (
              <div className="flex justify-end pt-4 border-t">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {commonT("close")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={editingId !== null}
        onOpenChange={(open) => {
          if (!open) {
            cancelEdit();
          }
        }}>
        <DialogContent className="sm:max-w-xl" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{commonT("edit")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">{t("name")}</label>
                <Input
                  value={editFormData.name}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      name: e.target.value,
                    })
                  }
                  placeholder={t("namePlaceholder")}
                  className="h-9 mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium">{t("connectionMode")}</label>
                <select
                  value={editFormData.mode}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      mode: e.target.value as BackendMode,
                    })
                  }
                  className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="direct">{t("modeDirect")}</option>
                  <option value="agent">{t("modeAgent")}</option>
                </select>
              </div>
            </div>

            <div
              className={cn(
                "grid gap-3",
                editFormData.mode === "direct" ? "grid-cols-2" : "grid-cols-1",
              )}>
              <div>
                <label className="text-xs font-medium">{t("type")}</label>
                <select
                  value={editFormData.type}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, type: e.target.value as 'clash' | 'surge' })
                  }
                  disabled
                  className="h-9 mt-1 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm text-muted-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed">
                  <option value="clash">Clash / Mihomo</option>
                  <option value="surge">Surge</option>
                </select>
              </div>
              {editFormData.mode === "direct" && (
                <div>
                  <label className="text-xs font-medium">{t("host")}</label>
                  <Input
                    value={editFormData.host}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        host: e.target.value,
                      })
                    }
                    placeholder="192.168.1.1"
                    className="h-9 mt-1"
                  />
                </div>
              )}
            </div>

            {editFormData.mode === "direct" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">{t("port")}</label>
                  <Input
                    value={editFormData.port}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        port: e.target.value,
                      })
                    }
                    placeholder={DEFAULT_BACKEND_PORT}
                    className="h-9 mt-1"
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch
                    checked={editFormData.ssl}
                    onCheckedChange={(checked) =>
                      setEditFormData({
                        ...editFormData,
                        ssl: checked,
                      })
                    }
                  />
                  <label className="text-sm">{t("useSsl")}</label>
                </div>
              </div>
            )}

            {editFormData.mode === "direct" ? (
              <div>
                <label className="text-xs font-medium">{t("token")}</label>
                <Input
                  type="password"
                  value={editFormData.token}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      token: e.target.value,
                    })
                  }
                  placeholder={
                    editingBackend?.hasToken
                      ? t("tokenKeepPlaceholder")
                      : editFormData.type === "surge"
                        ? t("tokenPlaceholderSurge")
                        : t("tokenPlaceholder")
                  }
                  className="h-9 mt-1"
                />
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">{t("agentTokenManagedHint")}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelEdit}>
              {commonT("cancel")}
            </Button>
            <Button
              onClick={() => editingId && handleUpdate(editingId)}
              disabled={loading || editingId === null}>
              {commonT("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showAddForm}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddForm(false);
            setFormData(getInitialFormState());
          }
        }}>
        <DialogContent className="sm:max-w-xl" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("addNew")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">{t("name")} *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t("namePlaceholder")}
                  className="h-9 mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium">{t("connectionMode")}</label>
                <select
                  value={formData.mode}
                  onChange={(e) =>
                    setFormData({ ...formData, mode: e.target.value as BackendMode })
                  }
                  className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="direct">{t("modeDirect")}</option>
                  <option value="agent">{t("modeAgent")}</option>
                </select>
              </div>
            </div>

            <div className={cn("grid gap-3", formData.mode === "direct" ? "grid-cols-2" : "grid-cols-1")}>
              <div>
                <label className="text-xs font-medium">{t("type")}</label>
                <select
                  value={formData.type}
                  onChange={(e) => {
                    const nextType = e.target.value as 'clash' | 'surge';
                    const currentDefaultPort = getDefaultGatewayPort(formData.type);
                    const nextDefaultPort = getDefaultGatewayPort(nextType);
                    setFormData({
                      ...formData,
                      type: nextType,
                      agentGatewayPort:
                        formData.agentGatewayPort === currentDefaultPort
                          ? nextDefaultPort
                          : formData.agentGatewayPort,
                    });
                  }}
                  className="h-9 mt-1 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="clash">Clash / Mihomo</option>
                  <option value="surge">Surge</option>
                </select>
              </div>
              {formData.mode === "direct" && (
                <div>
                  <label className="text-xs font-medium">{t("host")} *</label>
                  <Input
                    value={formData.host}
                    onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                    placeholder="192.168.1.1"
                    className="h-9 mt-1"
                  />
                </div>
              )}
            </div>

            {formData.mode === "direct" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium">{t("port")}</label>
                    <Input
                      value={formData.port}
                      onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                      placeholder={DEFAULT_BACKEND_PORT}
                      className="h-9 mt-1"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <Switch
                      checked={formData.ssl}
                      onCheckedChange={(checked) => setFormData({ ...formData, ssl: checked })}
                    />
                    <label className="text-sm">{t("useSsl")}</label>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium">{t("token")}</label>
                  <Input
                    type="password"
                    value={formData.token}
                    onChange={(e) => setFormData({ ...formData, token: e.target.value })}
                    placeholder={
                      formData.type === "surge" ? t("tokenPlaceholderSurge") : t("tokenPlaceholder")
                    }
                    className="h-9 mt-1"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-3 rounded-md border border-dashed p-3">
                <p className="text-[11px] text-muted-foreground">{t("agentTokenAutoHint")}</p>
                <p className="text-[11px] text-muted-foreground">{t("agentGatewayOptionalHint")}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium">{t("host")}</label>
                    <Input
                      value={formData.agentGatewayHost}
                      onChange={(e) => setFormData({ ...formData, agentGatewayHost: e.target.value })}
                      placeholder={DEFAULT_AGENT_GATEWAY_HOST}
                      className="h-9 mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("port")}</label>
                    <Input
                      value={formData.agentGatewayPort}
                      onChange={(e) => setFormData({ ...formData, agentGatewayPort: e.target.value })}
                      placeholder={getDefaultGatewayPort(formData.type)}
                      className="h-9 mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.agentGatewaySsl}
                    onCheckedChange={(checked) => setFormData({ ...formData, agentGatewaySsl: checked })}
                  />
                  <label className="text-xs font-medium">{t("useSsl")}</label>
                </div>
                <div>
                  <label className="text-xs font-medium">{t("gatewayToken")}</label>
                  <Input
                    type="password"
                    value={formData.agentGatewayToken}
                    onChange={(e) => setFormData({ ...formData, agentGatewayToken: e.target.value })}
                    placeholder={t("agentGatewayTokenPlaceholder")}
                    className="h-9 mt-1"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddForm(false);
                setFormData(getInitialFormState());
              }}>
              {commonT("cancel")}
            </Button>
            <Button
              onClick={handleAdd}
              disabled={
                loading || !formData.name.trim() || (formData.mode === "direct" && !formData.host.trim())
              }>
              <Plus className="w-4 h-4 mr-2" />
              {isFirstTime && backends.length === 0 ? t("saveAndContinue") : t("addBackend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={rotateAgentTokenDialogOpen}
        onOpenChange={setRotateAgentTokenDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rotateAgentToken")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("agentRotateTokenConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotatingAgentToken}>
              {commonT("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleRotateAgentToken()}
              disabled={rotatingAgentToken}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {rotatingAgentToken ? t("rotating") : t("rotateAgentToken")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteBackendId(null)}>
              {commonT("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {commonT("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear Logs Confirmation Dialog */}
      <AlertDialog
        open={clearLogsDialogOpen}
        onOpenChange={setClearLogsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clearLogs")}</AlertDialogTitle>
            <AlertDialogDescription>
              {clearLogsDays === 0
                ? t("confirmClearAllLogs")
                : t("confirmClearLogs", { days: clearLogsDays })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{commonT("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearLogs}
              className={
                clearLogsDays === 0
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }>
              {commonT("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Error Alert Dialog */}
      <AlertDialog open={errorDialogOpen} onOpenChange={setErrorDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              {commonT("error") || "Error"}
            </AlertDialogTitle>
            <AlertDialogDescription>{errorMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorDialogOpen(false)}>
              {commonT("ok") || "OK"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



      {/* Confirm Enable Auth Dialog */}
      <AlertDialog
        open={confirmEnableAuthDialogOpen}
        onOpenChange={setConfirmEnableAuthDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-500" />
              {authState?.forceAccessControlOff 
                ? t("auth.emergencyResetTitle")
                : t("auth.confirmEnableTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild className="space-y-2">
              <div className="text-sm text-muted-foreground">
                <p>
                  {authState?.forceAccessControlOff
                    ? t("auth.emergencyResetDescription")
                    : t("auth.confirmEnableDescription")}
                </p>
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  {authState?.forceAccessControlOff
                    ? t("auth.emergencyResetWarning")
                    : t("auth.rememberTokenWarning")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setConfirmEnableAuthDialogOpen(false)}>
              {commonT("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmEnableAuth}
              className="bg-primary">
              {authState?.forceAccessControlOff ? t("auth.changeToken") : t("auth.confirmEnable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Disable Auth Dialog */}
      <AlertDialog
        open={confirmDisableAuthDialogOpen}
        onOpenChange={setConfirmDisableAuthDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-destructive" />
              {t("auth.confirmDisableTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("auth.confirmDisableDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setConfirmDisableAuthDialogOpen(false)}>
              {commonT("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDisableAuth}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("auth.confirmDisable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change Token Dialog */}
      <Dialog open={changeTokenDialogOpen} onOpenChange={setChangeTokenDialogOpen}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("auth.changeTokenTitle")}</DialogTitle>
            <DialogDescription>
              {t("auth.changeTokenDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!authState?.forceAccessControlOff && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("auth.currentToken")}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="password"
                    value={changeTokenForm.current}
                    onChange={(e) => setChangeTokenForm({ ...changeTokenForm, current: e.target.value })}
                    className="pl-9"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("auth.newToken")}</label>
              <div className="relative">
                <Key className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  type="password"
                  value={changeTokenForm.new}
                  onChange={(e) => setChangeTokenForm({ ...changeTokenForm, new: e.target.value })}
                  className="pl-9"
                />
              </div>
              {changeTokenForm.new && !isValidToken(changeTokenForm.new) && (
                <p className="text-xs text-destructive">{t("auth.tokenRequirements")}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("auth.confirmNewToken")}</label>
              <div className="relative">
                <Key className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  type="password"
                  value={changeTokenForm.confirm}
                  onChange={(e) => setChangeTokenForm({ ...changeTokenForm, confirm: e.target.value })}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeTokenDialogOpen(false)}>
              {commonT("cancel")}
            </Button>
            <Button 
                onClick={handleChangeToken} 
                disabled={authLoading || (!authState?.forceAccessControlOff && !changeTokenForm.current) || !changeTokenForm.new || !isValidToken(changeTokenForm.new)}
            >
              {commonT("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agent Bootstrap Dialog */}
      <Dialog
        open={agentBootstrapDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            void closeAgentBootstrapDialog();
            return;
          }
          setAgentBootstrapDialogOpen(true);
        }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden p-0 flex flex-col" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader className="px-6 pt-6 pb-2 border-b shrink-0">
            <DialogTitle>{t("agentSetupTitle")}</DialogTitle>
            <DialogDescription>
              {t("agentSetupDescription", {
                id: agentBootstrapInfo?.backendId ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {agentBootstrapInfo && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("backendId")}</label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      disabled
                      value={String(agentBootstrapInfo.backendId)}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        void copyText(
                          String(agentBootstrapInfo.backendId),
                          "agentInfoCopied",
                        )
                      }
                      title={t("copyBackendId")}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("agentId")}</label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      disabled
                      value={agentBootstrapInfo.agentId || "-"}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        void copyText(agentBootstrapInfo.agentId, "agentInfoCopied")
                      }
                      title={t("copyAgentId")}
                      disabled={!agentBootstrapInfo.agentId.trim()}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("token")}</label>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="relative flex-1">
                      <Input
                        readOnly
                        value={showAgentToken ? agentBootstrapInfo.token : agentBootstrapInfo.token.replace(/./g, "•")}
                        placeholder={t("agentTokenHidden")}
                        className="font-mono text-xs pr-10"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowAgentToken(!showAgentToken)}
                        title={showAgentToken ? t("hideToken") : t("showToken")}
                      >
                        {showAgentToken ? (
                          <EyeOff className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        void copyText(
                          agentBootstrapInfo.token,
                          "agentTokenCopied",
                        )
                      }
                      title={t("copyAgentToken")}
                      disabled={!agentBootstrapInfo.token.trim()}>
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRotateAgentTokenDialogOpen(true)}
                      disabled={rotatingAgentToken}
                      className="w-full sm:w-auto"
                    >
                      {rotatingAgentToken ? t("rotating") : t("rotateAgentToken")}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {agentBootstrapInfo.token
                      ? t("agentTokenRotateHint")
                      : t("agentTokenUnavailableHint")}
                  </p>
                </div>

              <div className="space-y-3 rounded-md border border-dashed p-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t("agentGatewaySectionTitle")}</p>
                  <p className="text-[11px] text-muted-foreground">{t("agentGatewaySectionHint")}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">{t("type")}</label>
                    <select
                      value={agentBootstrapInfo.type}
                      disabled
                      className="h-9 mt-1 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm text-muted-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed">
                      <option value="clash">Clash / Mihomo</option>
                      <option value="surge">Surge</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t("host")}</label>
                    <Input
                      value={agentBootstrapInfo.gatewayHost}
                      onChange={(e) =>
                        setAgentBootstrapInfo({
                          ...agentBootstrapInfo,
                          gatewayHost: e.target.value,
                        })
                      }
                      placeholder={DEFAULT_AGENT_GATEWAY_HOST}
                      className="h-9 mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t("port")}</label>
                    <Input
                      value={agentBootstrapInfo.gatewayPort}
                      onChange={(e) =>
                        setAgentBootstrapInfo({
                          ...agentBootstrapInfo,
                          gatewayPort: e.target.value,
                        })
                      }
                      placeholder={getDefaultGatewayPort(agentBootstrapInfo.type)}
                      className="h-9 mt-1"
                    />
                  </div>
                  <div className="flex items-center gap-2 sm:pt-7">
                    <Switch
                      checked={agentBootstrapInfo.gatewaySsl}
                      onCheckedChange={(checked) =>
                        setAgentBootstrapInfo({
                          ...agentBootstrapInfo,
                          gatewaySsl: checked,
                        })
                      }
                    />
                    <label className="text-sm font-medium">{t("useSsl")}</label>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">{t("gatewayToken")}</label>
                  <Input
                    type="text"
                    value={agentBootstrapInfo.gatewayToken}
                    onChange={(e) =>
                      setAgentBootstrapInfo({
                        ...agentBootstrapInfo,
                        gatewayToken: e.target.value,
                      })
                    }
                    placeholder={t("agentGatewayTokenPlaceholder")}
                    className="h-9 mt-1 font-mono"
                  />
                </div>
              </div>

              {/* Script Tabs */}
              <div className="space-y-3">
                {/* Tab Headers - Mobile: full width, Desktop: auto */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-1 p-1 bg-muted rounded-lg overflow-x-auto">
                    <button
                      onClick={() => setActiveScriptTab("install")}
                      className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none text-center ${
                        activeScriptTab === "install"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t("scriptTabInstall")}
                    </button>
                    <button
                      onClick={() => setActiveScriptTab("add")}
                      className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none text-center ${
                        activeScriptTab === "add"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t("scriptTabAdd")}
                    </button>
                    <button
                      onClick={() => setActiveScriptTab("run")}
                      className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none text-center ${
                        activeScriptTab === "run"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t("scriptTabRun")}
                    </button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 w-full sm:w-auto"
                    disabled={!agentBootstrapInfo.token.trim()}
                    onClick={() => {
                      const text =
                        activeScriptTab === "install"
                          ? buildAgentInstallScriptCommand(agentBootstrapInfo, showAgentToken)
                          : activeScriptTab === "add"
                            ? buildAgentQuickAddCommand(agentBootstrapInfo, showAgentToken)
                            : buildAgentRunCommand(agentBootstrapInfo, showAgentToken);
                      void copyText(
                        text,
                        activeScriptTab === "install"
                          ? "agentInstallScriptCopied"
                          : activeScriptTab === "add"
                            ? "agentQuickAddCopied"
                            : "agentCommandCopied",
                      );
                    }}>
                    <Copy className="w-4 h-4 mr-1.5" />
                    {t("copy")}
                  </Button>
                </div>

                {/* Tab Content */}
                <div className="relative">
                  {activeScriptTab === "install" && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        {t("agentInstallScriptHint")}
                      </p>
                      <textarea
                        readOnly
                        value={buildAgentInstallScriptCommand(agentBootstrapInfo, showAgentToken)}
                        className="w-full min-h-[140px] sm:min-h-[180px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono leading-5"
                      />
                    </div>
                  )}
                  {activeScriptTab === "add" && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        {t("agentQuickAddHint")}
                      </p>
                      <textarea
                        readOnly
                        value={buildAgentQuickAddCommand(agentBootstrapInfo, showAgentToken)}
                        className="w-full min-h-[120px] sm:min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono leading-5"
                      />
                    </div>
                  )}
                  {activeScriptTab === "run" && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        {t("agentRunHint")}
                      </p>
                      <textarea
                        readOnly
                        value={buildAgentRunCommand(agentBootstrapInfo, showAgentToken)}
                        className="w-full min-h-[120px] sm:min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono leading-5"
                      />
                    </div>
                  )}
                  {!agentBootstrapInfo.token.trim() && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      {t("agentTokenGenerateFirstHint")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          </div>

          <DialogFooter className="px-6 py-4 border-t shrink-0">
            <Button onClick={() => void closeAgentBootstrapDialog()}>
              {commonT("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verification Animation */}
      <BackendVerifyAnimation
        show={showVerifyAnimation}
        phase={verifyPhase}
        backendName={pendingBackend?.name}
        message={verifyMessage}
        onComplete={handleVerifyComplete}
      />
    </>
  );
}
