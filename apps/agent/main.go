package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/foru17/neko-master/apps/agent/internal/agent"
	"github.com/foru17/neko-master/apps/agent/internal/config"
)

func main() {
	cfg, err := config.Parse(os.Args[1:])
	if err != nil {
		switch {
		case errors.Is(err, config.ErrHelp):
			fmt.Fprint(os.Stderr, config.Usage())
			return
		case errors.Is(err, config.ErrVersion):
			fmt.Println(config.AgentVersion)
			return
		default:
			log.Fatalf("config error: %v", err)
		}
	}

	if !cfg.LogEnabled {
		log.SetOutput(io.Discard)
	}

	runner := agent.NewRunner(cfg)
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := runner.Run(ctx); err != nil {
		// Non-zero so supervisors (procd/systemd) treat it as a failed start.
		os.Exit(1)
	}
}
