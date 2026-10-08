package config

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// AgentVersion is set at build time via -ldflags "-X ...config.AgentVersion=<tag>"
// Falls back to "dev" for local/untagged builds.
var AgentVersion = "dev"
const AgentProtocolVersion = 1

var (
	ErrHelp    = errors.New("help requested")
	ErrVersion = errors.New("version requested")
)

type Config struct {
	ServerAPIBase       string
	BackendID           int
	BackendToken        string
	AgentID             string
	LogEnabled          bool
	GatewayType         string
	GatewayEndpoint     string
	GatewayToken        string
	GatewayInsecureTLS  bool
	ReportInterval      time.Duration
	HeartbeatInterval   time.Duration
	GatewayPollInterval time.Duration
	RequestTimeout      time.Duration
	ReportBatchSize     int
	MaxPendingUpdates   int
	StaleFlowTimeout    time.Duration
}

func Parse(args []string) (Config, error) {
	fs := flag.NewFlagSet("neko-agent", flag.ContinueOnError)
	fs.SetOutput(new(strings.Builder))

	serverURL := fs.String("server-url", "", "Neko Master server URL, e.g. https://neko.example.com")
	backendID := fs.Int("backend-id", 0, "Backend ID configured in Neko Master")
	backendToken := fs.String("backend-token", "", "Backend token for agent authentication")
	agentID := fs.String("agent-id", "", "Agent ID (optional, auto-generated from backend-token if not provided)")
	gatewayType := fs.String("gateway-type", "clash", "Gateway type: clash or surge")
	gatewayURL := fs.String("gateway-url", "", "Gateway control endpoint URL")
	gatewayToken := fs.String("gateway-token", "", "Gateway secret token (optional)")
	gatewayInsecureTLS := fs.Bool("gateway-insecure-tls", false, "Skip gateway TLS certificate verification (trusted LAN only; env NEKO_GATEWAY_INSECURE_TLS)")
	logEnabled := fs.Bool("log", true, "Enable runtime logs (set false to disable)")

	reportInterval := fs.Duration("report-interval", 2*time.Second, "Report interval, e.g. 2s")
	heartbeatInterval := fs.Duration("heartbeat-interval", 30*time.Second, "Heartbeat interval")
	gatewayPollInterval := fs.Duration("gateway-poll-interval", 2*time.Second, "Gateway polling interval")
	requestTimeout := fs.Duration("request-timeout", 15*time.Second, "HTTP request timeout")
	reportBatchSize := fs.Int("report-batch-size", 1000, "Maximum updates per report request")
	maxPending := fs.Int("max-pending-updates", 50000, "Maximum buffered updates in memory")
	staleFlowTimeout := fs.Duration("stale-flow-timeout", 5*time.Minute, "Flow state stale timeout")
	showVersion := fs.Bool("version", false, "Print version and exit")
	help := fs.Bool("help", false, "Show help")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return Config{}, ErrHelp
		}
		return Config{}, err
	}

	if *help {
		return Config{}, ErrHelp
	}
	if *showVersion {
		return Config{}, ErrVersion
	}

	gatewayInsecureTLSSet := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "gateway-insecure-tls" {
			gatewayInsecureTLSSet = true
		}
	})
	if value := strings.TrimSpace(os.Getenv("NEKO_GATEWAY_INSECURE_TLS")); value != "" && !gatewayInsecureTLSSet {
		enabled, err := strconv.ParseBool(value)
		if err != nil {
			return Config{}, fmt.Errorf("invalid NEKO_GATEWAY_INSECURE_TLS: %w", err)
		}
		*gatewayInsecureTLS = enabled
	}

	if strings.TrimSpace(*serverURL) == "" || *backendID <= 0 || strings.TrimSpace(*backendToken) == "" || strings.TrimSpace(*gatewayURL) == "" {
		return Config{}, errors.New("server-url, backend-id, backend-token, gateway-url are required")
	}

	gt := strings.ToLower(strings.TrimSpace(*gatewayType))
	if gt != "clash" && gt != "surge" {
		return Config{}, fmt.Errorf("invalid gateway-type: %s", *gatewayType)
	}

	if *reportInterval <= 0 || *heartbeatInterval <= 0 || *gatewayPollInterval <= 0 || *requestTimeout <= 0 {
		return Config{}, errors.New("interval and timeout flags must be positive")
	}
	if *reportBatchSize <= 0 || *maxPending <= 0 {
		return Config{}, errors.New("report-batch-size and max-pending-updates must be positive")
	}

	// Generate stable agent ID based on backend token
	// This ensures the same agent always uses the same ID across restarts
	backendTokenTrimmed := strings.TrimSpace(*backendToken)
	finalAgentID := strings.TrimSpace(*agentID)
	if finalAgentID == "" {
		// Use first 16 chars of backend token hash as agent ID
		// This is stable across restarts and unique per backend
		hash := sha256.Sum256([]byte(backendTokenTrimmed))
		hashStr := hex.EncodeToString(hash[:])
		finalAgentID = "agent-" + hashStr[:16]
	}
	if len(finalAgentID) > 128 {
		finalAgentID = finalAgentID[:128]
	}

	return Config{
		ServerAPIBase:       normalizeServerAPIBase(*serverURL),
		BackendID:           *backendID,
		BackendToken:        strings.TrimSpace(*backendToken),
		AgentID:             finalAgentID,
		LogEnabled:          *logEnabled,
		GatewayType:         gt,
		GatewayEndpoint:     normalizeGatewayEndpoint(gt, *gatewayURL),
		GatewayToken:        strings.TrimSpace(*gatewayToken),
		GatewayInsecureTLS:  *gatewayInsecureTLS,
		ReportInterval:      *reportInterval,
		HeartbeatInterval:   *heartbeatInterval,
		GatewayPollInterval: *gatewayPollInterval,
		RequestTimeout:      *requestTimeout,
		ReportBatchSize:     *reportBatchSize,
		MaxPendingUpdates:   *maxPending,
		StaleFlowTimeout:    *staleFlowTimeout,
	}, nil
}

func Usage() string {
	lines := []string{
		"Usage:",
		"  neko-agent --server-url <url> --backend-id <id> --backend-token <token> --gateway-type <clash|surge> --gateway-url <url> [options]",
		"",
		"Required:",
		"  --server-url            Neko Master server URL",
		"  --backend-id            Backend ID in Neko Master",
		"  --backend-token         Backend token",
		"  --gateway-url           Gateway API URL",
		"",
		"Optional:",
		"  --agent-id              Agent ID (auto-generated from backend-token if not set)",
		"  --log                   enable runtime logs (default true, set --log=false to disable)",
		"  --gateway-type          clash|surge (default clash)",
		"  --gateway-token         Gateway secret",
		"  --gateway-insecure-tls  Skip gateway TLS certificate verification (default false; env NEKO_GATEWAY_INSECURE_TLS; trusted LAN only)",
		"  --report-interval       default 2s",
		"  --heartbeat-interval    default 30s",
		"  --gateway-poll-interval default 2s",
		"  --request-timeout       default 15s",
		"  --report-batch-size     default 1000",
		"  --max-pending-updates   default 50000",
		"  --stale-flow-timeout    default 5m",
		"  --version               print version",
	}
	return strings.Join(lines, "\n") + "\n"
}

func sanitizeID(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return "agent"
	}
	builder := strings.Builder{}
	builder.Grow(len(v))
	for _, r := range v {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			builder.WriteRune(r)
		} else {
			builder.WriteByte('-')
		}
	}
	out := strings.Trim(builder.String(), "-")
	if out == "" {
		return "agent"
	}
	return out
}

func normalizeServerAPIBase(raw string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	if strings.HasSuffix(trimmed, "/api") {
		return trimmed
	}
	return trimmed + "/api"
}

func normalizeGatewayEndpoint(gatewayType, raw string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	if gatewayType == "clash" {
		trimmed = strings.Replace(trimmed, "ws://", "http://", 1)
		trimmed = strings.Replace(trimmed, "wss://", "https://", 1)
		return strings.TrimSuffix(trimmed, "/connections")
	}
	return strings.TrimSuffix(trimmed, "/v1/requests/recent")
}
