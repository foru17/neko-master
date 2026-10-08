# CLAUDE.md

All repo guidance lives in [AGENTS.md](./AGENTS.md) — commands, conventions, key contracts, and the project map. Read it first.

Reusable workflows are packaged as skills in [`.claude/skills/`](./.claude/skills/) (Claude Code loads them automatically):

- `verify-changes` — minimal check set per touched area
- `add-stats-dimension` — coupled-registry checklist for schema/stats changes
- `release` — tag-driven release lines (v* Docker / agent-v* binaries)
- `ui-conventions` — i18n, dark mode, three-state views
- `db-conventions` — data-layer invariants (SQLite/ClickHouse)
- `agent-probe-dev` — Go probe development and constraints

## UI 基准

- 基准 = 上一个已发布的 Docker 镜像（`foru17/neko-master:<上一版本>`），与候选镜像并排起容器、灌同一份种子数据后对比。
- 最近一次登记：v1.4.1（2026-10-09，报告在本地 `.ui-acceptance/2026-10-09/REPORT.md`）。
