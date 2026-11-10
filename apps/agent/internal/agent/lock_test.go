package agent

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/foru17/neko-master/apps/agent/internal/config"
)

func newLockTestRunner(t *testing.T, backendID int) *Runner {
	t.Helper()
	t.Setenv("TMPDIR", t.TempDir())
	return NewRunner(config.Config{AgentID: "lock-test", BackendID: backendID, ReportBatchSize: 10})
}

func TestAcquireLockIsExclusivePerBackend(t *testing.T) {
	first := newLockTestRunner(t, 4242)
	if err := first.acquireLock(); err != nil {
		t.Fatalf("first acquireLock: %v", err)
	}

	second := NewRunner(config.Config{AgentID: "lock-test-2", BackendID: 4242, ReportBatchSize: 10})
	err := second.acquireLock()
	if err == nil {
		t.Fatal("second acquireLock succeeded while the first instance holds the lock")
	}
	if !strings.Contains(err.Error(), fmt.Sprintf("PID %d", os.Getpid())) {
		t.Fatalf("error should name the holder PID, got: %v", err)
	}

	first.releaseLock()
	if err := second.acquireLock(); err != nil {
		t.Fatalf("acquireLock after release: %v", err)
	}
	second.releaseLock()
}

func TestAcquireLockIgnoresStaleLockFile(t *testing.T) {
	runner := newLockTestRunner(t, 4343)
	// A crashed instance (or an older agent version) left a lock file with a
	// PID that may since have been reused. Without a live flock it must not
	// block startup.
	if err := os.WriteFile(runner.lockPath(), []byte("1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runner.acquireLock(); err != nil {
		t.Fatalf("acquireLock with stale file: %v", err)
	}
	data, _ := os.ReadFile(runner.lockPath())
	if strings.TrimSpace(string(data)) != fmt.Sprintf("%d", os.Getpid()) {
		t.Fatalf("lock file should hold our PID, got %q", data)
	}
	runner.releaseLock()
}
