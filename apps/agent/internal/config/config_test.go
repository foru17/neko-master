package config

import "testing"

func TestParseGatewayInsecureTLS(t *testing.T) {
	for _, tc := range []struct {
		name    string
		env     string
		flag    string
		want    bool
		wantErr bool
	}{
		{name: "default"},
		{name: "flag enabled", flag: "--gateway-insecure-tls", want: true},
		{name: "env enabled", env: "true", want: true},
		{name: "env disabled", env: "false"},
		{name: "flag overrides env", env: "true", flag: "--gateway-insecure-tls=false"},
		{name: "flag enables over env", env: "false", flag: "--gateway-insecure-tls=true", want: true},
		{name: "invalid env", env: "invalid", wantErr: true},
		{name: "flag overrides invalid env", env: "invalid", flag: "--gateway-insecure-tls=false"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("NEKO_GATEWAY_INSECURE_TLS", tc.env)
			args := []string{
				"--server-url", "https://collector.example.com",
				"--backend-id", "1",
				"--backend-token", "test-token",
				"--gateway-url", "https://127.0.0.1:9090",
			}
			if tc.flag != "" {
				args = append(args, tc.flag)
			}
			cfg, err := Parse(args)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected an error for invalid TLS configuration")
				}
				return
			}
			if err != nil {
				t.Fatalf("Parse returned error: %v", err)
			}
			if cfg.GatewayInsecureTLS != tc.want {
				t.Fatalf("GatewayInsecureTLS = %t, want %t", cfg.GatewayInsecureTLS, tc.want)
			}
		})
	}
}
