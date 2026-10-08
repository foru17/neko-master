package agent

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/foru17/neko-master/apps/agent/internal/config"
	"github.com/foru17/neko-master/apps/agent/internal/domain"
	"github.com/foru17/neko-master/apps/agent/internal/gateway"
)

type trackedFlow struct {
	LastUpload  int64
	LastDown    int64
	LastSeenMs  int64
	Counted     bool
	Domain      string
	IP          string
	SourceIP    string
	Chains      []string
	Rule        string
	RulePayload string
}

type reportPayload struct {
	BackendID       int                    `json:"backendId"`
	RequestID       string                 `json:"requestId,omitempty"`
	AgentID         string                 `json:"agentId"`
	AgentVersion    string                 `json:"agentVersion,omitempty"`
	ProtocolVersion int                    `json:"protocolVersion"`
	Updates         []domain.TrafficUpdate `json:"updates"`
}

type heartbeatPayload struct {
	BackendID        int    `json:"backendId"`
	AgentID          string `json:"agentId"`
	Hostname         string `json:"hostname,omitempty"`
	Version          string `json:"version,omitempty"`
	AgentVersion     string `json:"agentVersion,omitempty"`
	ProtocolVersion  int    `json:"protocolVersion"`
	GatewayType      string `json:"gatewayType,omitempty"`
	GatewayURL       string `json:"gatewayUrl,omitempty"`
	GatewayLatencyMs int64  `json:"gatewayLatencyMs,omitempty"`
	ServerLatencyMs  int64  `json:"serverLatencyMs,omitempty"`
}

type configPayload struct {
	BackendID int                           `json:"backendId"`
	AgentID   string                        `json:"agentId"`
	Config    *domain.GatewayConfigSnapshot `json:"config"`
}

type policyStatePayload struct {
	BackendID   int                         `json:"backendId"`
	AgentID     string                      `json:"agentId"`
	PolicyState *domain.PolicyStateSnapshot `json:"policyState"`
}

type Runner struct {
	cfg           config.Config
	httpClient    *http.Client
	gatewayClient *gateway.Client
	hostname      string
	lockFile      *os.File

	mu         sync.Mutex
	queue      []domain.TrafficUpdate
	flows      map[string]trackedFlow
	dropped    int64
	retryBatch []domain.TrafficUpdate
	retryID    string

	lastConfigHash   string
	lastPolicyHash   string
	gatewayLatencyMs int64
	serverLatencyMs  int64

	// startedAtMs marks when this agent began watching. Flows the gateway
	// opened before it only establish a baseline (issue #50).
	startedAtMs int64
}

// preexistingFlowGraceMs absorbs clock skew between gateway and agent.
const preexistingFlowGraceMs = 5_000

func NewRunner(cfg config.Config) *Runner {
	httpClient := &http.Client{Timeout: cfg.RequestTimeout}
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "unknown-host"
	}

	return &Runner{
		cfg:           cfg,
		httpClient:    httpClient,
		gatewayClient: gateway.NewClient(httpClient, cfg.GatewayType, cfg.GatewayEndpoint, cfg.GatewayToken),
		hostname:      hostname,
		queue:         make([]domain.TrafficUpdate, 0, cfg.ReportBatchSize*2),
		flows:         make(map[string]trackedFlow, 2048),
		startedAtMs:   time.Now().UnixMilli(),
	}
}

func (r *Runner) acquireLock() error {
	// Use OS temp directory for lock file
	lockDir := os.TempDir()
	lockPath := fmt.Sprintf("%s/neko-agent-backend-%d.lock", lockDir, r.cfg.BackendID)

	// Check if lock file exists and if process is still running
	if data, err := os.ReadFile(lockPath); err == nil {
		var pid int
		if _, err := fmt.Sscanf(string(data), "%d", &pid); err == nil {
			// Check if process is still running
			if pid > 0 && pid != os.Getpid() {
				if isProcessRunning(pid) {
					return fmt.Errorf("another agent instance (PID %d) is already running for backend %d", pid, r.cfg.BackendID)
				}
				// Process is not running, stale lock file
				log.Printf("[agent:%s] removing stale lock file from PID %d", r.cfg.AgentID, pid)
				os.Remove(lockPath)
			}
		}
	}

	// Create lock file with exclusive flag (O_EXCL)
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		if os.IsExist(err) {
			return fmt.Errorf("lock file already exists for backend %d", r.cfg.BackendID)
		}
		return fmt.Errorf("failed to create lock file: %w", err)
	}

	// Write PID to lock file
	pid := fmt.Sprintf("%d", os.Getpid())
	if _, err := file.WriteString(pid); err != nil {
		file.Close()
		os.Remove(lockPath)
		return fmt.Errorf("failed to write PID to lock file: %w", err)
	}

	r.lockFile = file
	return nil
}

func (r *Runner) releaseLock() {
	if r.lockFile != nil {
		lockPath := r.lockFile.Name()
		r.lockFile.Close()
		os.Remove(lockPath)
		r.lockFile = nil
	}
}

// isProcessRunning checks whether the PID is alive AND belongs to a
// neko-agent process. On Linux we cross-check /proc/<pid>/comm so that a
// stale PID later reused by an unrelated process cannot permanently block
// agent startup. On non-Linux (or if /proc isn't available) we fall back to
// the signal-0 liveness check.
func isProcessRunning(pid int) bool {
	if err := syscall.Kill(pid, 0); err != nil {
		return false
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/comm", pid))
	if err != nil {
		// /proc not readable (non-Linux, restricted hidepid, etc.) — treat
		// liveness check as authoritative.
		return true
	}
	return strings.Contains(strings.TrimSpace(string(data)), "neko-agent")
}

func (r *Runner) Run(ctx context.Context) {
	log.Printf("[agent:%s] starting, backend=%d, gateway_type=%s, server=%s", r.cfg.AgentID, r.cfg.BackendID, r.cfg.GatewayType, r.cfg.ServerAPIBase)

	// Acquire singleton lock to prevent multiple instances for same backend
	if err := r.acquireLock(); err != nil {
		log.Printf("[agent:%s] failed to acquire lock: %v", r.cfg.AgentID, err)
		log.Printf("[agent:%s] hint: another agent instance may be running for backend %d", r.cfg.AgentID, r.cfg.BackendID)
		return
	}
	defer r.releaseLock()

	var wg sync.WaitGroup
	wg.Add(5)
	go r.runCollectorLoop(ctx, &wg)
	go r.runReportLoop(ctx, &wg)
	go r.runHeartbeatLoop(ctx, &wg)
	go r.runConfigSyncLoop(ctx, &wg)
	go r.runPolicyStateSyncLoop(ctx, &wg)

	<-ctx.Done()
	log.Printf("[agent:%s] stopping...", r.cfg.AgentID)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Drain the queue in batches until empty or the deadline hits — flushOnce
	// only sends one ReportBatchSize chunk per call, so a single invocation
	// would silently drop anything beyond it.
	for {
		if err := r.flushOnce(shutdownCtx); err != nil {
			log.Printf("[agent:%s] final flush failed: %v", r.cfg.AgentID, err)
			break
		}
		pending, _ := r.queueStats()
		if pending == 0 {
			break
		}
		if shutdownCtx.Err() != nil {
			break
		}
	}

	wg.Wait()
	pending, dropped := r.queueStats()
	if pending > 0 {
		log.Printf("[agent:%s] exit with %d pending updates", r.cfg.AgentID, pending)
	}
	if dropped > 0 {
		log.Printf("[agent:%s] dropped updates due to queue overflow: %d", r.cfg.AgentID, dropped)
	}
}

func (r *Runner) runCollectorLoop(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()

	failures := 0
	for {
		t0 := time.Now()
		snapshots, err := r.gatewayClient.Collect(ctx)
		delay := r.cfg.GatewayPollInterval
		if err != nil {
			failures++
			delay = calculateBackoff(r.cfg.GatewayPollInterval, failures, 60*time.Second)
			log.Printf("[agent:%s] collector error (%d): %v", r.cfg.AgentID, failures, err)
		} else {
			failures = 0
			latencyMs := time.Since(t0).Milliseconds()
			r.mu.Lock()
			r.gatewayLatencyMs = latencyMs
			r.mu.Unlock()
			r.ingestSnapshots(snapshots, time.Now().UnixMilli())
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

func (r *Runner) runReportLoop(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()
	ticker := time.NewTicker(r.cfg.ReportInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.flushOnce(ctx); err != nil {
				log.Printf("[agent:%s] report error: %v", r.cfg.AgentID, err)
			}
		}
	}
}

func (r *Runner) runHeartbeatLoop(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()

	if err := r.sendHeartbeat(ctx); err != nil {
		log.Printf("[agent:%s] heartbeat error: %v", r.cfg.AgentID, err)
	}

	ticker := time.NewTicker(r.cfg.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.sendHeartbeat(ctx); err != nil {
				log.Printf("[agent:%s] heartbeat error: %v", r.cfg.AgentID, err)
			}
		}
	}
}

func (r *Runner) runConfigSyncLoop(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()

	// Initial sync with retry for binding conflicts
	// If server returns 409 (already bound), retry with backoff
	maxRetries := 5
	for i := 0; i < maxRetries; i++ {
		err := r.syncConfig(ctx)
		if err == nil {
			log.Printf("[agent:%s] config synced successfully", r.cfg.AgentID)
			break
		}
		if i == maxRetries-1 {
			log.Printf("[agent:%s] init config sync failed after %d retries: %v", r.cfg.AgentID, maxRetries, err)
		} else {
			// Check if it's a binding conflict (409)
			if strings.Contains(err.Error(), "409") || strings.Contains(err.Error(), "AGENT_TOKEN_ALREADY_BOUND") {
				backoff := time.Duration(i+1) * 5 * time.Second
				log.Printf("[agent:%s] config sync binding conflict, retrying in %v... (%d/%d)", r.cfg.AgentID, backoff, i+1, maxRetries)
				time.Sleep(backoff)
			} else {
				// Non-binding error, log and continue with ticker
				log.Printf("[agent:%s] init config sync error: %v", r.cfg.AgentID, err)
				break
			}
		}
	}

	// Then every 2 minutes
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.syncConfig(ctx); err != nil {
				log.Printf("[agent:%s] config sync error: %v", r.cfg.AgentID, err)
			}
		}
	}
}

func (r *Runner) syncConfig(ctx context.Context) error {
	snap, err := r.gatewayClient.GetConfigSnapshot(ctx)
	if err != nil {
		return err
	}

	// Calculate a simple hash to avoid sending if unmodified
	data, err := json.Marshal(snap)
	if err != nil {
		return fmt.Errorf("marshal config snapshot: %w", err)
	}
	hash := fmt.Sprintf("%x", md5.Sum(data))
	r.mu.Lock()
	unchanged := hash == r.lastConfigHash
	r.mu.Unlock()
	if unchanged {
		return nil
	}
	snap.Hash = hash
	snap.Timestamp = time.Now().UnixMilli()

	payload := configPayload{
		BackendID: r.cfg.BackendID,
		AgentID:   r.cfg.AgentID,
		Config:    snap,
	}

	if err := r.postJSON(ctx, "/agent/config", payload); err != nil {
		return err
	}

	r.mu.Lock()
	r.lastConfigHash = hash
	r.mu.Unlock()
	return nil
}

// runPolicyStateSyncLoop syncs only the dynamic policy selection state (now field)
// This runs more frequently (30s) than config sync (2min) to keep chain flow visualization accurate
func (r *Runner) runPolicyStateSyncLoop(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()

	// Wait a bit for initial config sync to complete, but stay responsive to shutdown
	select {
	case <-ctx.Done():
		return
	case <-time.After(5 * time.Second):
	}

	// Initial sync
	if err := r.syncPolicyState(ctx); err != nil {
		log.Printf("[agent:%s] init policy state sync error: %v", r.cfg.AgentID, err)
	}

	// Then every 30 seconds
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.syncPolicyState(ctx); err != nil {
				log.Printf("[agent:%s] policy state sync error: %v", r.cfg.AgentID, err)
			}
		}
	}
}

func (r *Runner) syncPolicyState(ctx context.Context) error {
	snap, err := r.gatewayClient.GetPolicyStateSnapshot(ctx)
	if err != nil {
		return err
	}

	// Skip POST when policy state is unchanged (same as syncConfig dedup pattern)
	data, _ := json.Marshal(snap)
	hash := fmt.Sprintf("%x", md5.Sum(data))

	r.mu.Lock()
	unchanged := hash == r.lastPolicyHash
	r.mu.Unlock()

	if unchanged {
		return nil
	}

	snap.Timestamp = time.Now().UnixMilli()

	payload := policyStatePayload{
		BackendID:   r.cfg.BackendID,
		AgentID:     r.cfg.AgentID,
		PolicyState: snap,
	}

	if err := r.postJSON(ctx, "/agent/policy-state", payload); err != nil {
		return err
	}

	r.mu.Lock()
	r.lastPolicyHash = hash
	r.mu.Unlock()
	return nil
}

func (r *Runner) ingestSnapshots(snapshots []domain.FlowSnapshot, nowMs int64) {
	active := make(map[string]struct{}, len(snapshots))
	updates := make([]domain.TrafficUpdate, 0, len(snapshots))

	r.mu.Lock()
	defer r.mu.Unlock()

	for _, s := range snapshots {
		active[s.ID] = struct{}{}

		prev, hasPrev := r.flows[s.ID]
		counted := false
		if hasPrev {
			counted = prev.Counted
		}
		domainName := strings.TrimSpace(s.Domain)
		ip := strings.TrimSpace(s.IP)
		sourceIP := strings.TrimSpace(s.SourceIP)
		chains := normalizeChains(s.Chains)
		rule := defaultString(strings.TrimSpace(s.Rule), "Match")
		rulePayload := strings.TrimSpace(s.RulePayload)
		if hasPrev {
			// Keep per-flow metadata stable once first seen, matching direct mode
			// semantics in collector (existing connection fields are reused).
			domainName = prev.Domain
			ip = prev.IP
			sourceIP = prev.SourceIP
			chains = cloneStringSlice(prev.Chains)
			rule = defaultString(prev.Rule, "Match")
			rulePayload = prev.RulePayload
		}

		deltaUp := s.Upload
		deltaDown := s.Download
		if !hasPrev && s.StartMs > 0 && s.StartMs < r.startedAtMs-preexistingFlowGraceMs {
			// Opened before this agent started: the cumulative counters include
			// traffic from before we were watching (likely already reported by
			// the previous process). Baseline only; later deltas count normally.
			deltaUp = 0
			deltaDown = 0
			counted = true
		} else if hasPrev {
			if s.Upload < prev.LastUpload || s.Download < prev.LastDown {
				// Counter reset (gateway restart / connection id reuse): the
				// counter went backwards. Match the direct gateway collector and
				// treat the current value as new traffic instead of silently
				// dropping it, and re-count the connection.
				deltaUp = s.Upload
				deltaDown = s.Download
				counted = false
			} else {
				deltaUp = s.Upload - prev.LastUpload
				deltaDown = s.Download - prev.LastDown
			}
		}

		connections := int64(0)
		if (deltaUp > 0 || deltaDown > 0) && !counted {
			connections = 1
			counted = true
		}

		r.flows[s.ID] = trackedFlow{
			LastUpload:  s.Upload,
			LastDown:    s.Download,
			LastSeenMs:  nowMs,
			Counted:     counted,
			Domain:      domainName,
			IP:          ip,
			SourceIP:    sourceIP,
			Chains:      cloneStringSlice(chains),
			Rule:        rule,
			RulePayload: rulePayload,
		}
		if deltaUp <= 0 && deltaDown <= 0 {
			continue
		}

		ts := s.TimestampMs
		if ts <= 0 {
			ts = nowMs
		}

		updates = append(updates, domain.TrafficUpdate{
			Domain:      domainName,
			IP:          ip,
			Chain:       firstChain(chains),
			Chains:      cloneStringSlice(chains),
			Rule:        rule,
			RulePayload: rulePayload,
			Upload:      deltaUp,
			Download:    deltaDown,
			Connections: connections,
			SourceIP:    sourceIP,
			TimestampMs: ts,
		})
	}

	for id, f := range r.flows {
		if _, ok := active[id]; ok {
			continue
		}
		if nowMs-f.LastSeenMs > r.cfg.StaleFlowTimeout.Milliseconds() {
			delete(r.flows, id)
		}
	}

	if len(updates) == 0 {
		return
	}

	r.queue = append(r.queue, updates...)
	if len(r.queue) > r.cfg.MaxPendingUpdates {
		overflow := len(r.queue) - r.cfg.MaxPendingUpdates
		r.queue = r.queue[overflow:]
		r.dropped += int64(overflow)
	}
}

func (r *Runner) flushOnce(ctx context.Context) error {
	batch, requestID := r.takePendingBatch()
	if len(batch) == 0 {
		return nil
	}

	payload := reportPayload{
		BackendID:       r.cfg.BackendID,
		RequestID:       requestID,
		AgentID:         r.cfg.AgentID,
		AgentVersion:    config.AgentVersion,
		ProtocolVersion: config.AgentProtocolVersion,
		Updates:         batch,
	}

	if err := r.postJSON(ctx, "/agent/report", payload); err != nil {
		r.setRetryBatch(batch, requestID)
		return err
	}
	return nil
}

// takePendingBatch returns the retry batch (with its original requestId) if one
// exists, otherwise dequeues a fresh batch from the queue and generates a new id.
func (r *Runner) takePendingBatch() ([]domain.TrafficUpdate, string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.retryBatch) > 0 {
		batch := r.retryBatch
		id := r.retryID
		r.retryBatch = nil
		r.retryID = ""
		return batch, id
	}
	if len(r.queue) == 0 {
		return nil, ""
	}
	limit := r.cfg.ReportBatchSize
	if limit > len(r.queue) {
		limit = len(r.queue)
	}
	out := make([]domain.TrafficUpdate, limit)
	copy(out, r.queue[:limit])
	r.queue = r.queue[limit:]
	return out, newRequestID()
}

func (r *Runner) setRetryBatch(batch []domain.TrafficUpdate, id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.retryBatch = batch
	r.retryID = id
}

func (r *Runner) sendHeartbeat(ctx context.Context) error {
	r.mu.Lock()
	gatewayLatencyMs := r.gatewayLatencyMs
	serverLatencyMs := r.serverLatencyMs
	r.mu.Unlock()

	payload := heartbeatPayload{
		BackendID:        r.cfg.BackendID,
		AgentID:          r.cfg.AgentID,
		Hostname:         r.hostname,
		Version:          config.AgentVersion,
		AgentVersion:     config.AgentVersion,
		ProtocolVersion:  config.AgentProtocolVersion,
		GatewayType:      r.cfg.GatewayType,
		GatewayURL:       r.cfg.GatewayEndpoint,
		GatewayLatencyMs: gatewayLatencyMs,
		ServerLatencyMs:  serverLatencyMs,
	}
	latencyMs, err := r.postJSONWithLatency(ctx, "/agent/heartbeat", payload)
	if err != nil {
		return err
	}

	r.mu.Lock()
	r.serverLatencyMs = latencyMs
	r.mu.Unlock()
	return nil
}

func (r *Runner) postJSON(ctx context.Context, path string, payload interface{}) error {
	_, err := r.postJSONWithLatency(ctx, path, payload)
	return err
}

func (r *Runner) postJSONWithLatency(ctx context.Context, path string, payload interface{}) (int64, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err = gz.Write(body); err != nil {
		return 0, err
	}
	if err = gz.Close(); err != nil {
		return 0, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.cfg.ServerAPIBase+path, &buf)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "gzip")
	req.Header.Set("Authorization", "Bearer "+r.cfg.BackendToken)

	requestAt := time.Now()
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return time.Since(requestAt).Milliseconds(), nil
	}

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	msg := string(bytes.TrimSpace(respBody))
	if msg == "" {
		msg = resp.Status
	}
	return 0, fmt.Errorf("server http %d: %s", resp.StatusCode, msg)
}

func newRequestID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (r *Runner) takeBatch(limit int) []domain.TrafficUpdate {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.queue) == 0 {
		return nil
	}
	if limit > len(r.queue) {
		limit = len(r.queue)
	}
	out := make([]domain.TrafficUpdate, limit)
	copy(out, r.queue[:limit])
	r.queue = r.queue[limit:]
	return out
}

func (r *Runner) requeueFront(batch []domain.TrafficUpdate) {
	if len(batch) == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	newQueue := make([]domain.TrafficUpdate, 0, len(batch)+len(r.queue))
	newQueue = append(newQueue, batch...)
	newQueue = append(newQueue, r.queue...)

	if len(newQueue) > r.cfg.MaxPendingUpdates {
		overflow := len(newQueue) - r.cfg.MaxPendingUpdates
		newQueue = newQueue[overflow:]
		r.dropped += int64(overflow)
	}
	r.queue = newQueue
}

func (r *Runner) queueStats() (pending int, dropped int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.queue), r.dropped
}

func firstChain(chains []string) string {
	if len(chains) == 0 {
		return "DIRECT"
	}
	if strings.TrimSpace(chains[0]) == "" {
		return "DIRECT"
	}
	return strings.TrimSpace(chains[0])
}

func normalizeChains(chains []string) []string {
	if len(chains) == 0 {
		return []string{"DIRECT"}
	}
	out := make([]string, 0, len(chains))
	for _, chain := range chains {
		trimmed := strings.TrimSpace(chain)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
		if len(out) >= 12 {
			break
		}
	}
	if len(out) == 0 {
		return []string{"DIRECT"}
	}
	return out
}

func cloneStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
}

func defaultString(v string, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return strings.TrimSpace(v)
}

func calculateBackoff(base time.Duration, failures int, max time.Duration) time.Duration {
	if failures <= 0 {
		return base
	}
	delay := base
	for i := 0; i < failures; i++ {
		delay *= 2
		if delay >= max {
			return max
		}
	}
	return delay
}
