---
name: release
description: Cut and publish a Neko Master release — main product (Docker, v* tags) or Go agent (agent-v* tags). Use when bumping versions, writing CHANGELOG entries, tagging, or verifying CI artifacts.
---

# Release Process

Two independent release lines, both driven entirely by git tags:

| Line | Tag | CI workflow | Artifact |
|---|---|---|---|
| Main product | `vX.Y.Z` | `.github/workflows/docker-build.yml` | Multi-arch Docker image (Docker Hub + GHCR), ~20 min |
| Agent probe | `agent-vX.Y.Z` | `.github/workflows/agent-release.yml` | Multi-arch agent binaries, ~1 min |

`agent-v*` does not build Docker images. The agent binary version is injected at build time from the tag via ldflags — there is no version file to bump for the agent.

## Main product release

1. **Version**: bump `version` in the **root** `package.json` only (apps/* keep their own independent versions; the root field is the single source of truth).
2. **Changelog**: add a dated section to BOTH `CHANGELOG.md` (Chinese) and `CHANGELOG.en.md` (English), Keep-a-Changelog style (`## [X.Y.Z] - YYYY-MM-DD`, `### 修复/Fixed`, `### 优化/Changed`). Link issue/PR numbers as reference-style links at the section end. Credit external contributors by handle.
3. **Env docs**: any new environment variable must be documented in `.env.example` before release.
4. **Test gates** (all must pass):

```bash
pnpm --filter @neko-master/collector exec tsc --noEmit
pnpm --filter @neko-master/collector test
pnpm --filter @neko-master/web exec tsc --noEmit
pnpm --filter @neko-master/web exec next build
```

5. **Ship**:

```bash
git push origin main
git tag -a vX.Y.Z -m "<one-line summary>"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file notes.md   # English only, see Conventions
```

6. **Verify CI**: `gh run list --limit 3` → the tag-branch "Build and Push Docker Image" run must end `completed/success`. Multi-arch builds can exceed 20 minutes; poll rather than assume.

## Agent release

See `docs/agent/release.en.md` for full details. Short form:

```bash
cd apps/agent && go vet ./... && go test ./... && sh -n nekoagent && sh -n install.sh
git tag agent-vX.Y.Z && git push origin agent-vX.Y.Z
```

Keep `AgentProtocolVersion` (Go, `internal/config/config.go`) and the collector's minimum accepted protocol version in sync when the payload changes — the collector rejects too-old agents with HTTP 426.

## Conventions

- Also check `docs/release-checklist.md` (pre-release validation for combined product+agent releases).
- **GitHub release notes are written in English** (title + body), like every release up to v1.3.10. Derive them from the `CHANGELOG.en.md` section, never from the Chinese `CHANGELOG.md`; Chinese belongs only in `CHANGELOG.md`. Check before publishing: `grep -P '\p{Han}' notes.md` must print nothing.
- Upgrade notes in the release body must call out any automatic startup migration so operators aren't surprised by one-time log output.
- Commit messages follow conventional-commit style (`fix(scope): ...`, `release: vX.Y.Z — ...`).
