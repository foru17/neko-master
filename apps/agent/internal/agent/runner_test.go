package agent

import (
	"testing"
	"time"

	"github.com/foru17/neko-master/apps/agent/internal/config"
	"github.com/foru17/neko-master/apps/agent/internal/domain"
)

func TestIngestSnapshotsDeltaCalculation(t *testing.T) {
	runner := NewRunner(config.Config{
		ServerAPIBase:       "http://localhost:3000/api",
		BackendID:           1,
		BackendToken:        "token",
		AgentID:             "agent-test",
		GatewayType:         "surge",
		GatewayEndpoint:     "http://127.0.0.1:9091/v1/requests/recent",
		ReportInterval:      time.Second,
		HeartbeatInterval:   time.Second,
		GatewayPollInterval: time.Second,
		RequestTimeout:      time.Second,
		ReportBatchSize:     100,
		MaxPendingUpdates:   1000,
		StaleFlowTimeout:    time.Minute,
	})

	runner.ingestSnapshots([]domain.FlowSnapshot{{
		ID:       "flow-1",
		Upload:   10,
		Download: 20,
		Chains:   []string{"Proxy"},
		Rule:     "MATCH",
	}}, 1000)

	first := runner.takeBatch(10)
	if len(first) != 1 {
		t.Fatalf("expected first batch len 1, got %d", len(first))
	}
	if first[0].Upload != 10 || first[0].Download != 20 {
		t.Fatalf("expected first delta 10/20, got %d/%d", first[0].Upload, first[0].Download)
	}
	if first[0].Connections != 1 {
		t.Fatalf("expected first connections 1, got %d", first[0].Connections)
	}

	runner.ingestSnapshots([]domain.FlowSnapshot{{
		ID:       "flow-1",
		Upload:   25,
		Download: 50,
		Chains:   []string{"Proxy"},
		Rule:     "MATCH",
	}}, 2000)

	second := runner.takeBatch(10)
	if len(second) != 1 {
		t.Fatalf("expected second batch len 1, got %d", len(second))
	}
	if second[0].Upload != 15 || second[0].Download != 30 {
		t.Fatalf("expected second delta 15/30, got %d/%d", second[0].Upload, second[0].Download)
	}
	if second[0].Connections != 0 {
		t.Fatalf("expected second connections 0, got %d", second[0].Connections)
	}

	runner.ingestSnapshots([]domain.FlowSnapshot{{
		ID:       "flow-1",
		Upload:   5,
		Download: 3,
		Chains:   []string{"Proxy"},
		Rule:     "MATCH",
	}}, 3000)

	// Counter reset (upload went backwards 25 -> 5): match the direct gateway
	// collector and count the current value as new traffic, re-counting the
	// connection, instead of silently dropping it.
	third := runner.takeBatch(10)
	if len(third) != 1 {
		t.Fatalf("expected third batch len 1 when counters reset, got %d", len(third))
	}
	if third[0].Upload != 5 || third[0].Download != 3 {
		t.Fatalf("expected reset to count current 5/3 as new traffic, got %d/%d", third[0].Upload, third[0].Download)
	}
	if third[0].Connections != 1 {
		t.Fatalf("expected reset to re-count connection (1), got %d", third[0].Connections)
	}
}

func TestIngestSnapshotsFirstTrafficAfterZeroCarriesConnection(t *testing.T) {
	runner := NewRunner(config.Config{
		ServerAPIBase:       "http://localhost:3000/api",
		BackendID:           1,
		BackendToken:        "token",
		AgentID:             "agent-test",
		GatewayType:         "clash",
		GatewayEndpoint:     "http://127.0.0.1:9090",
		ReportInterval:      time.Second,
		HeartbeatInterval:   time.Second,
		GatewayPollInterval: time.Second,
		RequestTimeout:      time.Second,
		ReportBatchSize:     100,
		MaxPendingUpdates:   1000,
		StaleFlowTimeout:    time.Minute,
	})

	runner.ingestSnapshots([]domain.FlowSnapshot{{
		ID:       "flow-2",
		Upload:   0,
		Download: 0,
		Chains:   []string{"DIRECT"},
		Rule:     "Match",
	}}, 1000)

	if batch := runner.takeBatch(10); len(batch) != 0 {
		t.Fatalf("expected no batch for zero traffic, got %d", len(batch))
	}

	runner.ingestSnapshots([]domain.FlowSnapshot{{
		ID:       "flow-2",
		Upload:   8,
		Download: 5,
		Chains:   []string{"DIRECT"},
		Rule:     "Match",
	}}, 2000)

	second := runner.takeBatch(10)
	if len(second) != 1 {
		t.Fatalf("expected one update after first traffic, got %d", len(second))
	}
	if second[0].Upload != 8 || second[0].Download != 5 {
		t.Fatalf("expected delta 8/5, got %d/%d", second[0].Upload, second[0].Download)
	}
	if second[0].Connections != 1 {
		t.Fatalf("expected connections 1 for first non-zero traffic, got %d", second[0].Connections)
	}
}

func TestIngestSnapshotsBaselinesFlowsOpenedBeforeStart(t *testing.T) {
	runner := NewRunner(config.Config{
		ServerAPIBase:       "http://localhost:3000/api",
		BackendID:           1,
		BackendToken:        "token",
		AgentID:             "agent-test",
		GatewayType:         "clash",
		GatewayEndpoint:     "http://127.0.0.1:9090",
		ReportInterval:      time.Second,
		HeartbeatInterval:   time.Second,
		GatewayPollInterval: time.Second,
		RequestTimeout:      time.Second,
		ReportBatchSize:     100,
		MaxPendingUpdates:   1000,
		StaleFlowTimeout:    time.Minute,
	})
	started := runner.startedAtMs

	// Issue #50: after a restart the first snapshot still carries the full
	// cumulative counters of long-lived connections.
	runner.ingestSnapshots([]domain.FlowSnapshot{
		{ID: "old", Upload: 17_000_000_000, Download: 1, StartMs: started - 3_600_000, Chains: []string{"Proxy"}},
		{ID: "new", Upload: 300, Download: 400, StartMs: started + 1_000, Chains: []string{"Proxy"}},
		{ID: "unknown-start", Upload: 7, Download: 8, Chains: []string{"Proxy"}},
	}, started+2_000)

	first := runner.takeBatch(10)
	var total int64
	for _, u := range first {
		total += u.Upload + u.Download
	}
	if len(first) != 2 || total != 300+400+7+8 {
		t.Fatalf("expected only new and unknown-start flows counted (715 bytes in 2 updates), got %d updates / %d bytes", len(first), total)
	}

	runner.ingestSnapshots([]domain.FlowSnapshot{
		{ID: "old", Upload: 17_000_001_000, Download: 1, StartMs: started - 3_600_000, Chains: []string{"Proxy"}},
	}, started+3_000)

	second := runner.takeBatch(10)
	if len(second) != 1 || second[0].Upload != 1000 || second[0].Download != 0 {
		t.Fatalf("expected baseline flow delta 1000/0, got %+v", second)
	}
	if second[0].Connections != 0 {
		t.Fatalf("expected baselined flow not re-counted as a connection, got %d", second[0].Connections)
	}
}
