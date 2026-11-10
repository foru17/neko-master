# AGENTS.md

Guidance for coding agents working in this monorepo. This file is the single source of truth for agent guidance — `CLAUDE.md` and `.github/copilot-instructions.md` are thin pointers to it.

## Scope and Priorities

1. Follow this file for repo-specific workflows and conventions.
2. Follow direct user instructions over this file when they conflict.
3. Keep changes minimal, targeted, and consistent with existing code.

## Skills (task-specific workflow guides)

Reusable process checklists live in `.claude/skills/*/SKILL.md` (plain Markdown — usable by any tool; Claude Code loads them automatically). Consult the matching one BEFORE starting these task types:

| Skill | When to use |
|---|---|
| [`verify-changes`](./.claude/skills/verify-changes/SKILL.md) | After any edit — minimal check set per touched area |
| [`add-stats-dimension`](./.claude/skills/add-stats-dimension/SKILL.md) | Any schema / stats-table / write-path change (several registries must change together) |
| [`release`](./.claude/skills/release/SKILL.md) | Version bumps, CHANGELOG, tagging, CI verification |
| [`ui-conventions`](./.claude/skills/ui-conventions/SKILL.md) | Any UI change — i18n, dark mode, three-state views |
| [`db-conventions`](./.claude/skills/db-conventions/SKILL.md) | Queries, repositories, ClickHouse topology, debugging data drift |
| [`agent-probe-dev`](./.claude/skills/agent-probe-dev/SKILL.md) | Anything under `apps/agent` (Go probe) |

## Repository Overview

- Package manager: `pnpm` (workspace monorepo).
- Task runner: `turbo` at repo root.
- Main apps:
  - `apps/web`: Next.js 16 + React 19 frontend.
  - `apps/collector`: Fastify + WebSocket + SQLite backend service.
  - `apps/agent`: Go probe deployed on routers/servers (reports to the collector over HTTP).
- Shared package:
  - `packages/shared`: shared TypeScript types and utility functions.

## Project Map (key files)

```
apps/collector/src/
  database/schema.ts                     # ALL table/index DDL (single source of truth)
  database/repositories/
    traffic-writer.repository.ts         # THE traffic write path (batchUpdateTrafficStats)
    base.repository.ts                   # time keys, range routing (resolveFactTable), chain parsing
    rule.repository.ts                   # rule stats + chain-flow DAG queries
    backend.repository.ts                # backend CRUD + deleteBackendData table list
    config.repository.ts                 # retention deletes, app_config
  shared/utils/rule-name.ts              # buildRuleName — the rule naming contract
  modules/collector/                     # gateway WS clients + BatchBuffer (30s flush)
  modules/realtime/realtime.store.ts     # in-memory deltas between flushes
  modules/websocket/websocket.server.ts  # web-client WS: subscriptions, broadcast, backpressure
  modules/stats/stats.service.ts         # SQLite/ClickHouse read routing (*WithRouting)
  modules/clickhouse/                    # CH writer/reader/config (parity with SQLite reads)
  modules/app/app.ts                     # Fastify composition root + agent ingest endpoints
apps/web/
  lib/api.ts, lib/websocket.ts           # HTTP client + stats WS hook (backendId-tagged pushes)
  lib/stats-query-keys.ts                # centralized React Query keys
  messages/{zh,en,ru}.json               # i18n — every key in zh + en; ru is community (falls back to en)
  components/features/                   # domain components (rules/, countries/, backend/, stats/)
  app/[locale]/dashboard/                # main dashboard route
apps/agent/
  internal/agent/runner.go               # main loop, retry/idempotency
  nekoagent                              # POSIX-sh service manager (install/upgrade/systemd/procd)
docs/
  architecture(.en).md                   # system architecture
  agent/                                 # probe docs (user-facing)
  dev/                                   # internal analysis reports (not authoritative)
```

## Key Contracts (violating these has caused real regressions)

1. **Rule naming**: multi-hop chains aggregate under the top-level policy group (last chain hop); only `buildRuleName` implements this. The web flow graph and gateway-rule matching key on it (regressed in v1.3.9 — see `docs/dev/deep-review-2026-07.md`).
2. **One traffic write path**: `batchUpdateTrafficStats`, one atomic outer transaction. Never add a parallel write implementation.
3. **Schema changes are multi-registry**: schema.ts + migration + retention + `deleteBackendData` + ClickHouse writer/reader parity + shared types (checklist: `add-stats-dimension` skill).
4. **CSV column dedup** uses the delimiter-aware `INSTR(','||col||',', ','||@v||',')` pattern — never bare `INSTR`.
5. **i18n + dark mode**: every user-facing string in both `messages/{zh,en}.json` (community locales such as `ru.json` are best-effort; missing keys fall back to English in `i18n/request.ts`); every light-palette Tailwind class has a `dark:` counterpart; inline SVG/chart colors switch on `resolvedTheme`.
6. **Agent protocol**: payload changes bump `AgentProtocolVersion` (Go) and the collector's minimum in the same commit.

## Environment and Toolchain

- Node.js: project docs target Node 22.
- TypeScript is strict across packages.
- Module systems:
  - `apps/collector` and `packages/shared`: ESM (`type: module`, `NodeNext`).
  - `apps/web`: Next.js/bundler TS config.

## Install and Bootstrap

- Install dependencies: `pnpm install`
- Start all apps in dev mode: `pnpm dev`
- Optional helper script: `./start.sh`

## Build, Lint, and Test Commands

### Root (all workspaces)

- Build all packages/apps: `pnpm build`
- Run lint across workspaces: `pnpm lint`
- Start all dev tasks: `pnpm dev`

### Filtered workspace commands (recommended during development)

- Build web only: `pnpm --filter @neko-master/web build`
- Build collector only: `pnpm --filter @neko-master/collector build`
- Build shared only: `pnpm --filter @neko-master/shared build`
- Lint web only: `pnpm --filter @neko-master/web lint`
- Lint collector only: `pnpm --filter @neko-master/collector lint`

### Tests

- This repo currently has tests in `apps/collector` (Vitest).
- Run all collector tests: `pnpm --filter @neko-master/collector test`
- Watch mode: `pnpm --filter @neko-master/collector test:watch`

### Run a single test file (important)

- Run one test file:
  - `pnpm --filter @neko-master/collector test -- src/modules/auth/auth.service.test.ts`
- Run one test file by pattern:
  - `pnpm --filter @neko-master/collector test -- src/**/*.geoip-config.test.ts`
- Run a single test case by name:
  - `pnpm --filter @neko-master/collector test -- -t "should validate token format"`
- Run single file + test name:
  - `pnpm --filter @neko-master/collector test -- src/modules/auth/auth.service.test.ts -t "should validate token format"`

### Writing tests (collector)

- Use Vitest (`describe`/`it`/`expect` imported from `'vitest'`).
- Use `createTestDatabase()` and `createTestBackend()` from `src/__tests__/helpers.ts` to set up a temporary SQLite DB in `beforeEach` and call `cleanup()` in `afterEach`.
- Test files live next to the code they test (e.g., `auth.service.test.ts` beside `auth.service.ts`).

### Type checks and push safety

- Collector type check: `pnpm --filter @neko-master/collector exec tsc --noEmit`
- Note: `.husky/pre-push` runs checks when pushing to `main`:
  - collector `tsc --noEmit`
  - web `build`

## Code Style Guidelines

### General TypeScript Rules

- Prefer explicit types on exported APIs and `import type` for type-only imports.
- Keep strict-null and unknown-safe patterns; narrow with guards.
- Avoid `any`; if unavoidable, keep scope tiny and document briefly.
- Prefix intentionally unused variables/parameters with `_` (e.g., `_unused`).
- Prefer small pure functions for transformations and parsing logic.

### ESLint Key Rules (collector)

- `no-console`: **`console.log` is forbidden** — use `console.info`, `console.warn`, or `console.error` instead.
- `@typescript-eslint/no-unused-vars`: warn-level; variables/args prefixed with `_` are exempted.
- `@typescript-eslint/no-explicit-any`: warn-level in source code.
- **Test files** (`*.test.ts`, `__tests__/**`): `no-explicit-any` and `no-console` are turned off.

### Imports and Module Boundaries

- Keep import groups logically ordered:
  1) platform/native modules,
  2) third-party packages,
  3) workspace/internal modules.
- Use relative imports with `.js` extension in ESM NodeNext packages (`collector`, `shared`).
- In web app code, prefer alias imports via `@/*` for internal modules.
- Do not create cross-app deep imports; use `@neko-master/shared` for shared contracts.

### Formatting and Layout

- Match local file style instead of forcing global formatting changes.
- Existing style is **not uniform**, even within a single package:
  - `apps/web`: double quotes and semicolons.
  - `apps/collector`: mixed — some files use single quotes, others use double quotes. Always follow the style of the file you are editing.
  - `packages/shared`: single quotes and semicolons.
- Preserve existing whitespace and line-wrap style in touched files.

### Naming Conventions

- Filenames: kebab-case (e.g., `auth.service.ts`, `use-gateway.ts`).
- React components: PascalCase exports; file names remain kebab-case.
- React hooks: `useXxx` naming.
- Types/interfaces/enums: PascalCase.
- Variables/functions: camelCase.
- Environment variables/constants: UPPER_SNAKE_CASE.
- Database-origin fields may use snake_case (`is_active`, `created_at`); preserve API contracts.

### Error Handling and Logging

- In `catch`, use `error: unknown`, then narrow via `instanceof Error`.
- Return structured API errors for HTTP handlers (e.g., `{ error: string }`) with proper status codes.
- Add contextual logs for operational failures (network, DB, background jobs).
- Use timeouts for external network calls where appropriate (`AbortSignal.timeout(...)`).
- Prefer resilient flows (`Promise.allSettled`) when partial results are acceptable.

### Backend (collector) Patterns

- Keep business logic in services; route/controller handlers should stay thin.
- Reuse repository/base-repository helpers for DB query logic.
- Maintain backend isolation by `backendId` in data paths and caches.
- For auth/security behavior, preserve cookie/token compatibility paths.
- **Fastify plugin pattern**: controllers export a `FastifyPluginAsync` function, registered in `app.ts` via `app.register(controller, { prefix: '/api/xxx' })`. Services are injected onto the Fastify instance through `declare module 'fastify'` augmentation and accessed as `fastify.xxxService`.

### Frontend (web) Patterns

- Respect Next.js App Router conventions (`app/[locale]/...`).
- Add `"use client"` only for client components/hooks that need it.
- Prefer React Query hooks for server state and caching.
- Keep API contract types aligned with `@neko-master/shared` and `apps/web/lib/api.ts`.
- Reuse shared utility helpers (`cn`, formatting utilities) instead of ad-hoc duplicates.
- **i18n**: uses `next-intl` with `zh` (default), `en`, and community-maintained `ru`.
  - Translation files: `apps/web/messages/{zh,en,ru}.json`. Non-English locales are deep-merged over `en.json`, so a key missing from a community locale renders in English.
  - Routing config: `apps/web/i18n/routing.ts`.
  - Use `useTranslations('namespace')` in components; never hardcode user-facing strings.
- **UI components**: shadcn/ui (`new-york` style) + Tailwind CSS v4 + `lucide-react` icons.
  - Base UI primitives live in `apps/web/components/ui/`.
  - Config: `apps/web/components.json`.
  - Always reuse existing UI components before creating new ones.

### Shared Package Patterns

- `packages/shared` should stay framework-agnostic and side-effect free.
- Keep shared types backward compatible when possible.
- Export shared helpers from `packages/shared/src/index.ts` intentionally.

## Testing Expectations for Changes

- Backend-only changes: run collector lint + targeted tests first, then full collector tests if broad.
- Frontend-only changes: run web lint; also run web build for production-impacting changes.
- Cross-package changes: run `pnpm lint` and `pnpm build` before final handoff when feasible.

## Related Entry Files

- `CLAUDE.md` (Claude Code) and `.github/copilot-instructions.md` (Copilot) are thin pointers to this file — keep them that way; add new guidance HERE, not there.
- No `.cursor/rules/` or `.cursorrules` currently exist; if added later, they must also defer to this file.

## Agent Working Notes

- Prefer minimal, surgical edits over large refactors.
- Avoid renaming/moving files unless required by the task.
