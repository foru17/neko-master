package gateway

import "testing"

func TestSurgeSourceIP(t *testing.T) {
	cases := []struct{ source, local, want string }{
		{"10.0.0.44", "10.0.0.88", "10.0.0.44"},
		{"10.0.0.44:51234", "", "10.0.0.44"},
		{"127.0.0.1", "10.0.0.88", "10.0.0.88"},
		{"::1", "10.0.0.88:6152", "10.0.0.88"},
		{"::ffff:127.0.0.1", "10.0.0.88", "10.0.0.88"},
		{"", "192.168.1.2:56123", "192.168.1.2"},
		{"127.0.0.1", "", "127.0.0.1"},
	}
	for _, c := range cases {
		if got := surgeSourceIP(c.source, c.local); got != c.want {
			t.Errorf("surgeSourceIP(%q, %q) = %q, want %q", c.source, c.local, got, c.want)
		}
	}
}
