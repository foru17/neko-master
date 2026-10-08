package gateway

import "testing"

func TestConnectionStartParsing(t *testing.T) {
	if got := parseClashStart("2026-10-09T08:00:00.123456789Z"); got != 1_791_532_800_123 {
		t.Fatalf("parseClashStart RFC3339Nano: got %d", got)
	}
	if got := parseClashStart("2026-10-09T16:00:00+08:00"); got != 1_791_532_800_000 {
		t.Fatalf("parseClashStart offset: got %d", got)
	}
	for _, bad := range []string{"", "  ", "yesterday"} {
		if got := parseClashStart(bad); got != 0 {
			t.Fatalf("parseClashStart(%q): expected 0, got %d", bad, got)
		}
	}
	if got := epochToMs(1_791_532_800.5); got != 1_791_532_800_500 {
		t.Fatalf("epochToMs seconds: got %d", got)
	}
	if got := epochToMs(1_791_532_800_500); got != 1_791_532_800_500 {
		t.Fatalf("epochToMs millis: got %d", got)
	}
	if got := epochToMs(0); got != 0 {
		t.Fatalf("epochToMs zero: got %d", got)
	}
}
