# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.3] - 2026-10-09

This release adds a few small features that users have asked for repeatedly.

### Added

- **Live speed and a speed view** ([#93], thanks @seth-shi for the suggestion)
  - The Total Download and Total Upload cards show the current speed, averaged over the last 15 seconds of cumulative totals. It appears only for live time ranges (not custom ranges). After you switch the time range or backend, it waits until the new totals settle (about 10–15 seconds) before calculating, so it never shows negative or absurd values
  - The traffic trend chart has a new Traffic / Speed toggle. Speed is the bytes in each time bucket divided by the bucket length. The newest bucket, which is still filling, is not plotted, so the right edge doesn't dip
- **Export associated domains** ([#54], thanks @ron159 for the suggestion)
  - Domain lists in the rule, proxy and device views, and in the IP expand panel, have an export button. It saves the full filtered and sorted list as a txt file with one domain per line, ready to paste into your own rule-set
- **`LOG_LEVEL` environment variable** ([#80], thanks @ilupin for the suggestion)
  - Accepts `error`, `warn`, `info` or `debug` (default `info`) and controls how much the collector process logs. `console.error` is always printed. Output from the container start script and Next.js is not affected

### Fixed

- **Live totals periodically dropped and jumped back** 🐛: after each flush, the realtime deltas in memory are cleared, but query results for persisted data stay cached for a few seconds (8s for DB queries, 2s for live pushes). Until that cache expired, "cached persisted totals + realtime deltas" was missing one flush interval of traffic, so the Total Download/Upload cards dropped every flush and jumped back on the next push. Clearing realtime data on flush now also invalidates both caches, for the mihomo, Surge and agent collection paths

### Agent (shipped as `agent-v1.4.8`)

- **GitHub token for upgrades and installs** ([#77], thanks @8MiYile for the suggestion): with `GITHUB_TOKEN` (or `GITHUB_PAT`) set, `nekoagent upgrade` and `install.sh` send the token when they query the GitHub API, so anonymous rate limits no longer block them. The token goes only to `api.github.com`: it is never attached to binary downloads, never saved in instance config and never logged. A 401, 403 or 429 from the API now produces a clear error
- Downloads and API requests now use a connect timeout, an overall timeout and retries

[#54]: https://github.com/foru17/neko-master/issues/54
[#77]: https://github.com/foru17/neko-master/issues/77
[#80]: https://github.com/foru17/neko-master/issues/80
[#93]: https://github.com/foru17/neko-master/issues/93

## [1.4.2] - 2026-10-09

This release merges community bug-fix PRs and finishes the timezone part of #82. Thanks to @MaxwellChang98, @yafeishi, @heroixinu and @GodD6366.

### Fixed

- **Region details shifted in device, domain and other lists** (PR [#81], thanks @MaxwellChang98) 🐛
  - GeoIP arrays are positional (country, country name, city, ASN organization). `filter(Boolean)` dropped an empty city, which moved the ASN organization into the city slot. Empty slots are now kept. Three parsers the PR missed (rule and proxy lists) are fixed too, with a regression test
- **Stash gateway shows zero traffic** (PR [#97], thanks @yafeishi) 🐛
  - Stash reports per-connection upload/download as `{ total, current, max }` objects and uses numeric connection IDs. They are now normalized to cumulative byte counts and string IDs at ingestion. mihomo/Clash are unaffected
- **Live updates drop after login (WebSocket 4003)** (PR [#92], thanks @heroixinu) 🐛
  - The session cookie is URL-encoded when set, but the WebSocket server parsed cookies itself without decoding and also cut the token at any `=` inside it, so tokens containing `+`, `/` or `=` failed authentication. It now splits on the first `=` only and decodes the value; the auth service also accepts encoded tokens
- **Every device shows the Surge gateway's own IP** (PR [#90], thanks @GodD6366) 🐛
  - The device IP now comes from Surge's `sourceAddress` (the client that sent the request) instead of `localAddress` (the gateway's own address). Requests made by the Surge host itself report a loopback `sourceAddress` and stay attributed to the host's LAN IP
  - **Behavior change**: LAN devices behind Surge are now counted by their real IPs. History recorded under the gateway IP before the upgrade is not migrated
- **Daily trend buckets follow the local day** ([#82] follow-up) 🐛
  - For daily trends the web sends the browser's timezone offset, and SQLite, ClickHouse and realtime data are bucketed by the viewer's local day instead of the UTC day (UTC+8 buckets were shifted by 8 hours). Callers that don't send an offset are unchanged. For non-whole-hour offsets (e.g. +5:30), SQLite still aligns day boundaries to whole hours

### Agent (shipped as `agent-v1.4.7`)

- Surge device IP now comes from `sourceAddress`, with the same rules as above (PR [#90]). The report protocol version is unchanged

[#81]: https://github.com/foru17/neko-master/pull/81
[#82]: https://github.com/foru17/neko-master/issues/82
[#90]: https://github.com/foru17/neko-master/pull/90
[#92]: https://github.com/foru17/neko-master/pull/92
[#97]: https://github.com/foru17/neko-master/pull/97

## [1.4.1] - 2026-10-09

This release addresses bug and compatibility reports from GitHub issues.

### Fixed

- **Huge traffic spike after upgrading/restarting** ([#50], thanks @PlutoNameless) 🐛
  - Gateways report cumulative bytes per connection. After a collector or agent restart (e.g. a container upgrade), the first snapshot counted the full history of every already-open long-lived connection again, adding tens of GB within minutes. Connections whose gateway start time (mihomo `start` / Surge `startDate`) is more than 5s before the process start now only establish a baseline, and later deltas are counted normally. Connections without a start time keep the old behavior, so no traffic is dropped. This applies to the direct mihomo collector, the Surge poller and the Go agent
  - **Behavior change**: the pre-restart history of connections open at restart time is no longer counted (it was double counting), so the curve at upgrade time is lower than before. Known limits: this relies on the gateway reporting connection start times with roughly synced clocks, and traffic of pre-existing connections during a gateway disconnect longer than 5 minutes is not counted
- **Idle agents keep showing offline** ([#58], thanks @yf-9186) 🐛
  - The offline timeout default (30s) equaled the agent heartbeat interval (30s), agents skip reports when there is no traffic, and the backend list and manual test used an 8s window, so healthy idle agents showed offline most of the time. All checks now use the heartbeat timeout, which defaults to 90s (3 × the heartbeat interval) and can be set with `AGENT_HEARTBEAT_TIMEOUT_MS` (minimum 15000). **Behavior change**: an agent that really goes down is marked offline after up to 90s
- **`fetch failed` when Surge `http-api-tls` is enabled** ([#88], thanks @fgprodigal) 🐛
  - Surge `http-api-tls` and mihomo `external-controller-tls` use self-signed certificates, so every gateway request failed with a bare `fetch failed`. Poll and test-connection errors now include the underlying cause (e.g. `DEPTH_ZERO_SELF_SIGNED_CERT`, `ECONNREFUSED`), with a hint for certificate errors
  - New `BACKEND_TLS_INSECURE=1` skips certificate verification for gateway APIs only, with a one-time startup warning. GeoIP, ClickHouse and other outbound requests still verify certificates. Use only on trusted networks
- **Trend chart tooltip wrong for ranges over 24 hours** ([#82], thanks @pengbins) 🐛
  - Fixed daily bucketing in the realtime merger and store, and raised the query bucket limit to 1440 minutes. Daily buckets follow UTC days; aligning them to the local day is tracked separately
- **PWA forced to portrait on tablets** ([#73], thanks @ICEY16360): manifest `orientation` changed from `natural` to `any`

### Agent (shipped as `agent-v1.4.6`)

- **`nekoagent status` shows stopped on OpenWrt** ([#71], thanks @yf-9186): the procd init script now writes a pidfile (`/var/run/neko-agent/<name>.pid`), so `status` reports the running state and PID. The docs for hand-written init scripts are updated in both languages
- **New `--gateway-insecure-tls`** ([#88]): env `NEKO_GATEWAY_INSECURE_TLS`. Skips certificate verification for gateway APIs only; reporting to the collector still verifies certificates. `nekoagent add` accepts and persists it. The flag is passed to the agent only when enabled, so instances whose wrapper is upgraded before the binary still start
- Fixed double counting of long-lived connections after a restart ([#50], see above). The report protocol version is unchanged

[#50]: https://github.com/foru17/neko-master/issues/50
[#58]: https://github.com/foru17/neko-master/issues/58
[#71]: https://github.com/foru17/neko-master/issues/71
[#73]: https://github.com/foru17/neko-master/issues/73
[#82]: https://github.com/foru17/neko-master/issues/82
[#88]: https://github.com/foru17/neko-master/issues/88

## [1.4.0] - 2026-07-19

This release comes from a second external deep code review. Each finding was independently verified before fixing; the high-priority ones — data correctness, security defaults, error visibility, and a live install failure — are addressed here.

### Fixed

- **Agent install/upgrade 404**: `install.sh` and `nekoagent` resolved download URLs via GitHub `releases/latest`, which points at whatever release GitHub marks latest — including main-app `v*` releases that carry no agent binaries, so every fresh install and upgrade 404'd. They now list releases, pick the newest `agent-v*` tag, and download from that concrete tag.
- **Silent data loss in agent CH_ONLY mode**: when SQLite writes were skipped (ClickHouse considered healthy) and the ClickHouse write then failed, the buffer was already cleared and data vanished from both memory and disk. A SQLite fallback (traffic + country) now persists the snapshot, matching the gateway/surge collectors.
- **Unbounded realtime store growth in agent mode**: the agent path never called `pruneIfNeeded`, so the in-memory store grew without bound while ClickHouse kept failing — OOM on long-lived router/gateway deployments. It is now pruned each flush.
- **Missing query error state**: on a collector failure the dashboard silently showed "no data" — the worst failure mode for a monitoring tool. KPI cards now render an error alert when a query fails.

### Security

- **CORS denies cross-origin by default**: with `CORS_ORIGIN` unset, the server previously reflected any Origin with `credentials: true`, letting any website read a logged-in user's traffic data cross-site. Cross-origin is now denied by default; same-origin deployments (the default Docker setup) are unaffected. **Upgrade note**: if your dashboard and collector run on different origins, set `CORS_ORIGIN` explicitly (see `.env.example`) or cross-origin requests will be rejected.
- **`GET /api/backends` no longer returns plaintext tokens**: the list/read endpoints returned the stored upstream/agent token verbatim. It is now stripped; the edit form treats an empty token as "unchanged", so editing still works.

## [1.3.10] - 2026-07-04

This release comes from a project-wide deep review (architecture / database / performance / frontend / UX) and fixes the high-risk findings. Full report: `docs/dev/deep-review-2026-07.md`.

### Fixed

- **RuleSet/IPCIDR type nodes appeared in the rule chain-flow entry column (v1.3.9 regression)** 🐛
  - The v1.3.9 rule-naming change (PR [#68]) switched mihomo's aggregation key from the top-level policy group to the raw rule type + payload, breaking the flow-graph entry column and the frontend's gateway-rule matching (both key on policy-group names). Multi-hop chains key on the last chain hop again; rule detail names remain only for single-hop DIRECT/REJECT chains. A one-time startup migration remaps the polluted rows back to policy-group names and merges totals
- **A 30-day range effectively contained only 7 days of dimension data** 🐛
  - `hourly_dim_stats` / `hourly_country_stats` (backing every >6h range query) were deleted with the 7-day minute-level retention cutoff. They now follow the hourly retention window (default 30 days)
- **Silent missing data when ClickHouse writes are enabled but reads stay on SQLite** 🐛
  - Reduced SQLite writes (skipping domain/IP/rule/dim tables) previously only checked ClickHouse write health; deployments with the default `STATS_QUERY_SOURCE=sqlite` kept reading from SQLite where those tables were never written. Reduction now requires reads to actually prefer ClickHouse (clickhouse/auto/CH_ONLY_MODE) and the misconfiguration warns at startup
- **Substring mismatches dropped values from CSV association columns** 🐛
  - Bare `INSTR` dedup treated `a.com` as already present when `aa.com` was in the list (same for IPs and rule/chain names). All columns now use the delimiter-aware `','||list||','` pattern
- **Non-atomic batch writes double-counted on retry** 🐛
  - The three sub-transactions of a batch flush committed independently; a mid-flush failure caused the retried buffer to double-count tables that had already committed. One outer transaction now wraps them (inner ones degrade to savepoints)
- **Cross-backend data bleed while switching backends** 🐛
  - WebSocket stats pushes now carry `backendId` and the client drops in-flight pushes that don't match the current subscription
- **Error surfaces**: added route-level and global error boundaries (a crashing visualization no longer blanks the whole dashboard); chain-flow load failures render a retry card instead of disappearing silently
- **Dark mode fixes** 🌓: the world map is now theme-aware (no-data fill / color ramp / stroke / legend — previously a glaring light-colored map on dark backgrounds); upload arrows in the rules list used blue in dark mode making up/down indistinguishable; health test button hover and unhealthy badge gained missing dark variants
- **Active Policy whitelist never updated**: the `UnifiedRuleChainFlow` memo comparator ignored `visibleRuleNames`

### Changed

- **Chain-flow query complexity**: realtime merge went from O(R×N) per-row `findIndex` to a Map merge; the DAG source rows are capped to the top-N by traffic (`RULE_CHAIN_FLOW_MAX_ROWS`, default 2000) instead of a full-table scan; the realtime rule-chain map is no longer deep-copied per broadcast
- **WebSocket broadcast concurrency + outbound backpressure**: broadcast payloads now fetch concurrently (previously serially awaited per client); clients whose outbound buffer exceeds `WS_MAX_BUFFERED_BYTES` (default 4MB) are skipped for the round so one slow reader can't grow the heap unboundedly; metrics line gains `backpressure_skips`
- **Dropped four expression indexes** on `(total_download + total_upload)` that the query planner never used, removing write amplification on the four hottest tables; existing databases drop them at startup
- **Single write implementation**: removed the drifted, caller-less single-update write path; `updateTrafficStats` now wraps the batch path

[#68]: https://github.com/foru17/neko-master/pull/68

## [1.3.9] - 2026-06-23

### Fixed

- **Silent persistence data loss when ClickHouse degrades** 🐛
  - When ClickHouse was considered healthy the SQLite stats write was skipped, but the in-memory batch was cleared before the async ClickHouse write was confirmed. If that write failed (queue full / partial table failure / timeout) the data only lived briefly in the realtime memory store and was never persisted. The collector now writes the batch snapshot to SQLite as a durable fallback whenever the ClickHouse write fails and SQLite was skipped
  - A full write queue now counts toward the unhealthy threshold so callers resume durable SQLite writes
  - Health is reset only after a *complete* (detail + agg) traffic batch succeeds, so a table that fails persistently while another succeeds can no longer keep resetting the failure counter and mask the outage
- **Agent mode under-counted traffic on counter resets** 🐛
  - The Go agent dropped traffic to zero when a flow's counter went backwards (gateway restart / connection id reuse), diverging from the already-fixed direct collector. It now counts the current value as new traffic and re-counts the connection
- **Deleting a backend left orphaned data** 🐛
  - `PRAGMA foreign_keys` defaults OFF so the declared `ON DELETE CASCADE` never fired; deleting a backend removed only the config row and left all of its stats behind. `deleteBackend` now explicitly removes all associated data (including health logs, policy cache, agent heartbeats and snapshots)
- **Collector did not recover after a backend password change** ([#65]) 🐛
  - When a credential change restarted the collector, `disconnect` deferred the real teardown until after an async flush, so the old WebSocket kept reconnecting with the stale token and detached from management. The socket is now torn down synchronously first (set `isClosing`, clear the reconnect timer, close the socket) and flushed afterward
- **WebSocket port env vars had no effect** ([#61]) 🐛
  - `runtime-config.js` (written with the real external ports at container start) suffered a script-load race and caching, so the browser fell back to the build-time default port and `WS_EXTERNAL_PORT` appeared ineffective. The script is now loaded `beforeInteractive`, served `no-store`, and excluded from the PWA precache
- **Mihomo proxy groups parsed as rules** ([#67], PR [#68] by @cesaryuan) 🐛
  - Rule names no longer mis-use the last chain hop (the proxy group); they use the real matched rule, centralized into a shared `buildRuleName` helper that also removes drift between the multiple write paths
- **Collector silently hangs, stops syncing** ([#74], PR [#76] by @zj1123581321) 🐛
  - Adds a WebSocket heartbeat watchdog: it pings periodically and tracks last activity, force-terminating a silent link past the timeout to trigger the existing reconnect logic — fixing silently dropped TCP connections (gateway restart / NAT timeout) that left the socket "connected" while data stopped

### Improved

- **WebSocket reconnect now uses exponential backoff with jitter**: prevents a reconnect storm when several collectors hammer a down/flapping backend every 5s in lockstep; backoff resets after a successful connect. The Surge collector's backoff retries also gain jitter (`WS_MAX_RECONNECT_INTERVAL_MS`, default 60s)

[#61]: https://github.com/foru17/neko-master/issues/61
[#65]: https://github.com/foru17/neko-master/issues/65
[#67]: https://github.com/foru17/neko-master/issues/67
[#68]: https://github.com/foru17/neko-master/pull/68
[#74]: https://github.com/foru17/neko-master/issues/74
[#76]: https://github.com/foru17/neko-master/pull/76

## [1.3.8] - 2026-06-10

### Fixed

- **Gateway collector lost traffic after counter resets** 🐛
  - When a backend restarted or a connection ID was reused, `Math.max(0, delta)` silently discarded the traffic, and because the high-water mark was never reset, all subsequent traffic kept being swallowed until counters exceeded the old values. Now matches the Surge collector: resets are detected, current totals are counted as new traffic, and resets are logged
  - Fixed long-lived idle connections being evicted as stale after 5 minutes and then re-added as "new", double-counting their full cumulative totals — connections present in the feed now always refresh `lastSeen` and the counter watermark
- **Graceful shutdown could lose buffered data** 🐛
  - `APIServer.stop()` didn't `await app.close()`, and the synchronous `shutdown()` called `process.exit(0)` before the `onClose` hook could flush pending agent buffers; the whole chain is now awaited
- **WebSocket dead-client leak**: clients whose socket is already closed are now removed from the client map when a broadcast send fails, instead of being re-broadcast forever
- **Memory bounds**: realtime store now evicts the outer per-source-IP device detail maps (cap 10,000); WebSocket summary cache has a hard 1,000-entry cap; agent request-ID dedup map is pruned on a timer instead of a size-modulo check
- **Web frontend**
  - Login-confirm `setTimeout` was never cleared on unmount
  - Dashboard derived the locale by regex-parsing the pathname; now uses `useLocale()` from next-intl
  - Traffic chart hardcoded `en-US` time formatting and stat cards called `toLocaleString()` without a locale, producing inconsistent formats after switching languages
- **Shared package**: `parseGatewayRule` now validates object inputs at runtime so it can no longer return `proxy: undefined` in violation of its type contract
- **Go agent**: `syncConfig` read `lastConfigHash` without holding the mutex (TOCTOU); the policy sync loop's startup delay now responds to context cancellation; lock file permissions tightened to 0600; `json.Marshal` errors are no longer ignored
- **install.sh**: `download_file` unconditionally returned 0, masking download failures; curl/wget now have timeouts and retries (connect 10s / total 120s / 3 retries)

### Security

- **Configurable CORS**: new `CORS_ORIGIN` env var (comma-separated) restricts allowed origins; default stays permissive for LAN deployments
- **API security headers**: added `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy`
- **Constant-time token comparison**: agent token and dashboard token verification now use `crypto.timingSafeEqual`
- **Backend URL scheme validation**: only `http(s)` / `ws(s)` / `agent://` are accepted; dangerous schemes like `file:` are rejected
- **Persistent cookie secret**: when `COOKIE_SECRET` is not configured, the generated secret is persisted in the database so restarts no longer invalidate all sessions

### Changed

- **Dependencies upgraded across the board**: TypeScript 6.0, ESLint 10 (collector), better-sqlite3 12, recharts 3, react-day-picker 10, lucide-react 1.x, tailwind-merge 3, dotenv 17, Next.js 16.2.7, and more — all at latest; the web app stays on ESLint 9 until `eslint-plugin-react` supports v10

## [1.3.7] - 2026-04-12

### Fixed

- **SQLite retention policy silently disabled** 🐛 ([#66](https://github.com/foru17/neko-master/issues/66))
  - Fixed `autoCleanup` defaulting to `false` on fresh installs: when no row exists in `app_config`, the DB read returned `false` instead of the declared default `true`, so minute-level and hourly stats tables were never pruned
  - Fixed `backend_health_logs` never being cleaned up: the startup flow used an inline `runAutoCleanup` that only covered `minute_*` / `hourly_*` tables; the real `CleanupService` (which handles health logs) was never instantiated
  - Fixed UI autoCleanup toggle not taking effect: `CleanupService.start()` used to early-return when `autoCleanup=false`, so the timer was never scheduled and subsequent toggles had no effect
  - Added env-var overrides: `SQLITE_RETENTION_MINUTE_DAYS` / `SQLITE_RETENTION_HOURLY_DAYS` / `SQLITE_RETENTION_HEALTH_LOG_DAYS` for set-and-forget Docker Compose deployments
  - Thanks to @airobot-bot for the detailed row-level measurements

- **Backend URL silently rewritten on edit** 🐛 ([#65](https://github.com/foru17/neko-master/issues/65))
  - Fixed an issue where editing any field of a backend (including token-only changes) would rebuild the URL from `host` / `port` / `ssl`, silently dropping any path, query string, or embedded credentials present in the original URL
  - Fix: when `host` / `port` / `ssl` haven't been touched, the original URL is preserved as-is
  - Collector now logs the specific fields that changed when restarting a collector (e.g. `changed: token`), so users can self-verify from logs that the reconcile loop picked up their change
  - Thanks to @yuhongwei380 for the report

## [1.3.6] - 2026-03-26

### Fixed

- **WebSocket port config ineffective in Docker direct-access mode** 🐛
  - Fixed an issue where setting `WS_EXTERNAL_PORT` had no effect: the frontend still connected to the Web port instead of the configured WS port
  - Root cause: in production mode, `/_cm_ws` (using `window.location.host`, i.e. the Web port) was tried first; since Next.js has no WebSocket proxy for that path, the connection failed and fell back to HTTP polling before the direct-port URL was ever tried
  - Fix: when `runtime-config.WS_PORT` is present (i.e. `WS_EXTERNAL_PORT` is set), the direct-port URL is now preferred — no need to set `NEXT_PUBLIC_WS_URL` as a workaround

## [1.3.5] - 2026-03-03

### Added

- **WebSocket Summary Data Enhancement** 📊
  - WebSocket broadcasts now include total proxy count and rule count in summary data
  - Refined dashboard data fetching strategy during active WebSocket connections
- **Responsive Overview List Display** 📐
  - New `useResponsiveItemCount` hook dynamically adjusts list item count based on viewport height
  - Top Domains card now includes traffic progress bars for visual proportion display
- **Country/Region Name Internationalization** 🌍
  - Replaced manually-maintained country name mappings with `Intl.DisplayNames` API, supporting localized names for all 249 ISO country codes
  - All region-related panels (overview, top list, traffic list, pie chart, world map, IP details) now display correctly localized country names
  - Custom name overrides for specific regions ensure consistent display across different browser/OS CLDR versions
- **New Logo** 🎨

### Fixed

- **Rules statistics not showing** 🐛
  - Fixed Dashboard displaying 0 for total rules and total proxies after the 1.3.4 WebSocket summary optimization
  - Root cause: `totalProxies`/`totalRules` were previously derived from `proxyStats`/`ruleStats` array lengths, but the summary optimization skipped fetching these arrays
  - Fix: moved both counts into the WebSocket summary cache so they are always available
- **Dashboard stuck in loading state during WebSocket connection**
  - Fixed Dashboard showing infinite transition animation when WebSocket was in `connecting` state
  - Refined `isTransitioning` logic to only show loading state when HTTP fallback data fetching is actually needed
- **Settings toggle switch jitter** ⚡
  - Fixed the Collect toggle and Active backend switch causing the entire backend list to flash with skeleton loading
  - Changed to silent data refresh, avoiding unnecessary full re-renders
- **Desktop dropdown menu scrollbar flicker**
  - Fixed layout shift caused by scrollbar appearing/disappearing when opening dropdown menus, dialogs, or theme switcher
  - Scrollbar space reservation now only applies on desktop (`pointer: fine`), preserving correct Radix popover positioning on mobile

## [1.3.4] - 2026-02-26

### Added

- **Enhanced Backend Health Monitoring** 🏥
  - Agents now report gateway latency to the collector for improved health monitoring
  - New `nekoagent restart-all` command to restart all Agent instances with one command
  - Backend health status now supports explicit state identifiers (healthy/unhealthy/unknown)
  - Health charts now auto-color based on latency: green for low, yellow for medium, red for high
  - Direct mode backends display latency curves; Agent mode backends display online/offline status
  - Gateway latency calculation algorithm optimized, chart labels localized (Chinese/English)

- **Agent Auto-Start on Boot** 🚀
  - Install script now supports system service managers for automatic Agent startup on boot
  - Supports systemd (Linux mainstream distros), launchd (macOS), OpenWrt procd, cron (universal)
  - Automatically detects system type and configures the appropriate service during installation
  - Auto-start can be disabled with `--no-autostart` flag

- **WebSocket Performance Optimization** ⚡
  - New `includeSummary` parameter for WebSocket stats to enable on-demand summary retrieval
  - Selective summary field retrieval reduces unnecessary data transmission
  - `useStableTimeRange` now rounds to the nearest minute to avoid boundary jitter
  - Granular summary data fetching with client-side caching mechanism
  - Rules Tab now displays top summary stat cards

### Changed

- Optimized `tr` command character set conversion for improved cross-platform compatibility
- Fixed redundant manager file synchronization issue

## [1.3.3] - 2026-02-24

### Added

- **Backend Health Monitoring Tab** 🏥
  - New dedicated Health tab for historical health status visualization across all configured backends
  - Per-backend time-series area chart: latency curve for Direct mode, online/offline status for Agent mode
  - Unhealthy and unknown periods are shaded red/amber; interior data gaps (between first and last recorded point) are automatically treated as downtime, while leading/trailing gaps remain blank
  - Multi-range support (1h / 6h / 12h / 24h / 7d / 30d) with axis label format auto-switching (time-only / month+time / date-only) based on span
  - Six summary stat cards at the top: overall uptime %, healthy backends, unhealthy backends, total backends, avg latency, bucket granularity — visual style aligned with the Overview tab
  - Health check interval defaults to 30 seconds (min 5 s), configurable via `BACKEND_HEALTH_CHECK_INTERVAL_MS`
  - New `backend_health_logs` table keyed on `(backend_id, minute)`; multiple checks within the same minute are UPSERT-deduplicated; logs are automatically pruned on a 30-day retention schedule alongside hourly stats
  - Health history API supports filtering by `backendId`; data is grouped by backend and enriched with names in the service layer, keeping the controller as a thin routing layer
- **Country traffic connection counting**
  - Country traffic statistics now include a connections dimension; the Country Traffic panel supports sort-by-connections
  - Agent report payloads include an explicit `connections` field with legacy-compatible fallback
- **Time range preset expansion**
  - `5m` and `30m` quick presets are now available in production environments

### Changed

- **Traffic collection connection counting aligned**
  - Both Agent and Direct modes now count connections once per flush interval, eliminating duplicate increments
  - Removed the connection count accumulation side-effect from the legacy `requeueFront` retry path
- **Case normalization function compatibility**
  - `tr`-based character class conversions replaced with explicit character lists for consistent cross-platform behavior

## [1.3.2] - 2026-02-22

### Added

- **ClickHouse high-performance storage backend (major update)** 🗄️
  - Added ClickHouse as an optional analytics storage engine, forming a dual-write architecture alongside SQLite
  - Health-aware write routing: SQLite stats writes are automatically skipped when ClickHouse is healthy, significantly reducing local disk I/O
  - ClickHouse-exclusive mode available for large-scale multi-agent deployments
  - New `ClickHouseWriter` module with batched writes, health monitoring, consecutive-failure fallback, and graceful recovery
- **`NEKO_AGENT_REF` branch testing support**
  - Added `NEKO_AGENT_REF` environment variable to the install script to download `nekoagent` from any GitHub branch
  - E.g. `NEKO_AGENT_REF=refactor/clickhouse` lets you test pre-release branches without modifying the script

### Performance

- **Agent report traffic gzip compression (~10-15x ratio)** 🚀
  - All `neko-agent` HTTP report requests are now gzip-compressed; overnight upload traffic reduced from ~4 GB to ~300 MB
  - Collector transparently decompresses via Fastify `preParsing` hook with no new dependencies
  - Fully backward-compatible: older uncompressed `neko-agent` versions continue to work alongside compressed ones

### Fixed

- **[P0] ClickHouse health check used wrong method, causing silent data loss**
  - Fixed `shouldSkipSqliteStatsWrites` in `app.ts` incorrectly calling `clickHouseWriter.isEnabled()` instead of `clickHouseWriter.isHealthy()`
  - When ClickHouse has consecutive write failures it now correctly falls back to SQLite writes, preventing silent data loss
- **[P1] Agent retry lost requestId, causing duplicate traffic counting**
  - Agent report payload now includes a `requestId` (32-char hex generated via `crypto/rand`)
  - Collector implements server-side idempotency dedup (5-minute TTL Map); duplicate `requestId` arrivals are silently discarded
  - Fixed the old `requeueFront` pattern where re-queuing a failed batch assigned it a new ID, allowing the same data to be counted twice; failed batches now carry the same `requestId` for the entire retry window

### Changed

- **`nekoagent update` / `upgrade` completely rewritten**
  - The old `update` command was re-running the install script and invoking `nekoagent add` — it never actually updated the binary
  - Rewritten to download the target version directly, SHA256-verify it, and replace the installed binary in-place; skips download when already at target version
  - Added `upgrade` as an alias for `update`
- **`nekoagent add` auto-starts by default**
  - `auto_start` default changed from `false` to `true`; instances now start automatically after `add` without requiring a manual `start`
  - Added `--no-start` flag to suppress auto-start when needed
  - Install script `NEKO_AUTO_START=false` now correctly passes `--no-start` through to the `add` command
- **Unified agent versioning**
  - `neko-agent` binary version is now injected at build time via ldflags (`-X ...config.AgentVersion=<tag>`), replacing the previous hardcoded constant
  - CI `agent-release.yml` automatically extracts and injects the version from the git tag; local dev builds report `dev`
  - `nekoagent version` now displays both the manager script version and the `neko-agent` binary version together for consistent version visibility
- **Install script incremental version detection**
  - When an existing installation is detected, the script queries the GitHub Releases API to determine the latest remote version
  - If local version matches the target: skip download and call `nekoagent add` directly; otherwise update the binary first, then add the instance

### Documentation

- **`docs/` directory reorganization**
  - Added `docs/dev/` (ClickHouse analysis and refactor docs) and `docs/research/` (model research reports) subdirectories
  - Added `docs/README.md` (Chinese doc index) and `docs/README.en.md` (English doc index) with categorized clickable links
  - Fixed broken Agent doc links in `README.en.md` that pointed to Chinese `.md` files instead of `.en.md`
  - Architecture guide updated with a dedicated Agent mode section covering deployment topology and data flow

## [1.3.1] - 2026-02-19

### Added

- **Agent mode (major update)** 🤖
  - Introduced passive reporting via `agent://` backends for centralized panel + edge collection deployments
  - Added Agent setup script UX with copy-ready run/install commands
  - Added token rotation flow for controlled re-binding and immediate invalidation of old instances
- **Agent release automation and packaging**
  - Added GitHub Actions: `agent-build.yml` (tests/cross-build) and `agent-release.yml` (multi-arch release)
  - Standardized release artifact naming and checksum publishing (`checksums.txt`)
- **Agent installation and operations tooling**
  - Upgraded installer with architecture detection, release download, checksum verification, and startup
  - Added `nekoagent` management CLI (init/start/stop/status/logs/update/remove/uninstall)
- **Agent documentation set**
  - Added `docs/agent/*` (overview, quick start, install, config, release, troubleshooting)
  - Added release checklist `docs/release-checklist.md`

### Changed

- Refactored backend UX for Agent: add/edit moved into dialogs, action row alignment improved
- Improved Agent Script modal responsiveness and scroll behavior for mobile/smaller viewports
- Locked gateway type (Clash/Surge) after creation to prevent destructive mode mutation

### Security

- Agent token is now system-managed: historical tokens are not re-shown; rotation generates new random token
- Added backend token binding guard: one token cannot be reused by multiple `agentId` values

### Compatibility

- Added protocol/version gate support with `MIN_AGENT_PROTOCOL_VERSION` and `MIN_AGENT_VERSION`
- Incompatible requests now return explicit codes:
  - `AGENT_PROTOCOL_TOO_OLD`
  - `AGENT_VERSION_REQUIRED`
  - `AGENT_VERSION_TOO_OLD`

## [1.3.0] - 2026-02-16

### Added

- **Chain-flow delimiter compatibility (Issue #34)**
  - Rule/node names containing `|` are now supported in chain-flow graphs without key-splitting conflicts
- **GeoIP config status fields**
  - Added `configuredProvider` and `effectiveProvider` to `/api/db/geoip` responses to clearly separate configured vs. runtime-effective source
- **Regression test coverage**
  - Added `app.geoip-config.test.ts` for GeoIP config API behavior
  - Added `db.geoip-normalization.test.ts` for GeoIP normalization compatibility
  - Added chain-flow test coverage for names containing `|`

### Changed

- **GeoIP normalization moved to shared**
  - Added `packages/shared/src/geo-ip-utils.ts` and unified `normalizeGeoIP` usage across frontend/backend
  - Narrowed `IPStats.geoIP` to a structured object type and removed array-shape dependency
  - Applied normalization consistently in collector IP-related query outputs for backward compatibility
- **Config module refactor**
  - Moved `/api/db/*` routes out of `app.ts` into a dedicated `config.controller`
  - Added `autoListen` option to `createApp` for better testability and controlled startup
- **GeoIP service reliability improvements**
  - Reused MMDB required-file constants to avoid hardcoded filenames
  - Added short TTL cache for MMDB missing-file checks to reduce repeated filesystem probes
  - Added queue-overflow logging and `destroy()` resource cleanup
  - Improved private IPv6 detection (including `::ffff:` mapped IPv4) and failure-cooldown handling

### Fixed

- **Fixed `/api/stats/rules/chain-flow-all` 500 errors**
  - Resolved `Cannot read properties of undefined (reading 'name')` caused by delimiter-based link key parsing
- **Fixed side effects when reading GeoIP config**
  - `GET /api/db/geoip` no longer mutates persisted provider config
  - Settings selection state now follows `effectiveProvider` to avoid UI/runtime mismatch
- **Fixed Windows flag emoji rendering in React Flow chain nodes**
  - Applied `emoji-flag-font` to rule/group/proxy node labels
  - Unified active-link key encoding across backend/frontend to avoid ambiguous link matching

## [1.2.9] - 2026-02-16

### Added

- **Offline GeoIP lookup via local MMDB** 🌐
  - Added IP lookup source switching in Settings (`online` / `local`)
  - Added support for local MMDB files: `GeoLite2-City.mmdb`, `GeoLite2-ASN.mmdb` (required), `GeoLite2-Country.mmdb` (optional)
- **MMDB preflight checks and safeguards**
  - Required MMDB files are validated before enabling local mode
  - Local option is disabled when required files are missing, with missing-file hints in UI
- **MMDB availability fallback safeguards**
  - If MMDB files are removed, runtime lookup now falls back to online API automatically
  - If config is still `local` while MMDB is unavailable, backend auto-reverts persisted provider to `online` to keep UI and runtime behavior consistent
- **Improved local development MMDB directory detection**
  - Improved MMDB directory resolution with multiple candidates and env override support
  - Fixed the case where Local could not be enabled even though MMDB files existed in local development
- **Unified mobile details interaction**
  - Rules page (Domains / IPs) now uses Drawer for mobile details
  - Mobile details behavior is aligned with devices and stats pages
- **Improved settings interaction consistency**
  - `IP Lookup Source` selected-state visuals are now consistent with the Favicon selector
  - Options are now fully row-clickable instead of requiring direct radio-button clicks

### Changed

- Documentation updates (`README.md` / `README.en.md` / `.env.example`):
  - Added clearer local MMDB deployment and mount instructions
  - Clarified that `GEOIP_ONLINE_API_URL` is intended for endpoints compatible with the `ipinfo.my` response schema
  - Consolidated duplicate English README entry points

## [1.2.8] - 2026-02-15

### Performance

- **Up to 60x query performance improvement** 🚀
  - Added `hourly_dim_stats` / `hourly_country_stats` pre-aggregation tables, maintained in real-time on write
  - All dimension queries (domain/ip/proxy/rule/device/country) automatically route to hourly pre-aggregated tables for ranges > 6h
  - Timeseries query optimization: `getHourlyStats`, `getTrafficInRange`, `getTrafficTrend`, `getTrafficTrendAggregated` now read directly from `hourly_stats` for long-range queries instead of scanning and re-aggregating `minute_stats`
  - 7-day range queries reduced from ~10,080 rows scanned to ~168 rows
  - Per WebSocket broadcast total row scans reduced from ~20,160 to ~336
- **`resolveFactTableSplit` hybrid query strategy**: Long-range queries split into hourly (completed hours) + minute (current hour tail) for both performance and precision

### Added

- **Testing Infrastructure** 🧪
  - Introduced Vitest framework with unit tests for `traffic-writer`, `auth.service`, and `stats.service`
  - Added test helpers (`helpers.ts`)
  - Added ESLint configuration and `.env.example`
- **Time Range Picker Enhancements**
  - Added "1 hour" quick preset, replacing the default 30-minute view
  - Added "Today" quick option for trend charts (midnight to current time)
  - Moved 30-minute preset to debug short presets list
- **`BatchBuffer` module**: Standalone batch buffering module, decoupled from collector

### Fixed

- **Cookie authentication security**: Changed `secure` flag from `process.env.NODE_ENV === 'production'` to `request.protocol === 'https'`, fixing login loop on HTTP intranet environments where cookies could not be set
- **Windows emoji flag display**: Added `emoji-flag-font` CSS class to proxy-related components (list, chart, grid, interactive stats, rule stats) to fix broken flag emoji rendering on Windows

### Refactored

- **Global AuthGuard refactoring**: Extracted authentication logic from dashboard layout into a standalone `AuthGuard` component, simplified `auth.tsx` and `auth-queries.ts`
- **Collector service decomposition**: Significantly slimmed down `collector.ts` and `surge-collector.ts` by extracting `BatchBuffer` and `RealtimeStore` modules
- Removed legacy `api.ts` entry file, unified to modular controllers

### Technical Details

- `hourly_dim_stats` schema: `(backend_id, hour, dimension, dim_key, upload, download, connections)`, updated in real-time via `INSERT ... ON CONFLICT DO UPDATE`
- `resolveFactTable` / `resolveFactTableSplit` methods implemented in `BaseRepository`, shared across all repositories
- Timeseries query thresholds: `getTrafficInRange`/`getTrafficTrend` switch to `hourly_stats` at > 6h; `getTrafficTrendAggregated` switches when `bucketMinutes >= 60`
- Seamless upgrade: new tables auto-created via `CREATE TABLE IF NOT EXISTS`, existing `minute_dim_stats` data backfilled to hourly tables on first startup

## [1.2.7] - 2026-02-14

### Added

- **Surge Backend Support** 🚀
  - Full support for Surge HTTP REST API data collection
  - Complete rule chain visualization (Rule Chain Flow)
  - Full feature support including proxy distribution charts and domain statistics
  - Intelligent policy cache system with background sync
  - Automatic retry mechanism with exponential backoff for failed API requests
  - Anti-duplicate protection using `recentlyCompleted` Map to prevent double-counting completed connections
- **Responsive Layout Improvements**
  - RULE LIST cards support container queries for adaptive layout switching
  - TOP DOMAINS cards expand to full width in single-column layout with more data items
- **UX Improvements**
  - Added skeleton loading screen for Backends list in Settings dialog

### Fixed

- **Surge collector short-lived connection traffic loss**: Fixed issue where traffic deltas for completed connections (status=Complete) were not being counted; uses `recentlyCompleted` Map to record final traffic and correctly calculate differences
- **Cleanup timer determinism**: Changed `recentlyCompleted` cleanup from `setInterval` to deterministic triggering tied to the polling cycle
- Fixed IPv6 validation logic using Node.js native `net.isIPv4/isIPv6`

### Refactored

- **Database Repository Pattern Refactoring** 🏗️
  - Split the 5400+ line monolithic `db.ts` into 14 independent Repository files
  - Added `database/repositories/` directory with Repository Pattern architecture
  - Slimmed `db.ts` down to ~1000 lines, retaining only DDL, migrations, and one-line delegation methods
  - Extracted Repositories: `base`, `domain`, `ip`, `rule`, `proxy`, `device`, `country`, `timeseries`, `traffic-writer`, `config`, `backend`, `auth`, `surge`
  - `BaseRepository` encapsulates 13 shared utility methods including `parseMinuteRange`, `expandShortChainsForRules`, etc.
- **Code cleanup** (~140 lines removed)
  - Removed unused `parseRule` function, duplicate `buildGatewayHeaders`/`getGatewayBaseUrl`
  - Cleaned up debug `console.log` statements, unused `sleep()`, `DailyStats` import
  - Removed unused `EXTENDED_RETENTION`/`MINIMAL_RETENTION` constants

### Technical Details

- Surge collector uses `/v1/policy_groups/select` endpoint for policy group details
- `BackendRepository` now includes `type: 'clash' | 'surge'` field across create, query, and update flows
- Cleaned up debug code in `/api/gateway/proxies`

## [1.2.6] - 2026-02-13

### Security
- **Cookie-based Authentication System**
  - Replaced localStorage token storage with HttpOnly cookies for enhanced security
  - WebSocket connections now authenticate via cookies instead of URL tokens
  - Implemented server-side session management with automatic refresh

### Changed
- Refactored authentication flow with server-side cookie setting after login
- Added welcome page image asset

## [1.2.5] - 2026-02-13

### Added
- Added transition progress bar to dashboard header for smoother data switching experience
- Implemented skeleton loading states for dashboard data widgets
- Introduced `ClientOnly` component for optimized client-side rendering
- New API hooks for devices, traffic, rules, and proxies with unified data fetching logic
- Time range restrictions for showcase mode stats display
- Backend switching capability in showcase mode
- Enhanced rule chain flow visualization with zero-traffic chain merging

### Changed
- Improved Traffic Trend skeleton loading to prevent empty state flickering
- Refined Top Domains/Proxies/Regions skeleton heights to match actual content
- Optimized database batch upserts using sub-transactions for better performance
- Enhanced GeoIP service reliability with failure cooldowns and queue limits
- Implemented WebSocket summary caching to reduce redundant data transmission
- Enhanced i18n support for settings and theme options
- Improved API error handling mechanism

### Fixed
- Hydration Mismatch error caused by `Math.random()` in skeleton screens
- Optimized login dialog dark theme styling
- Fixed login dialog auto-focus issue
- Refined transition state detection logic

## [1.2.0] - 2026-02-12

### Added
- **Token-based Authentication System**
  - New login dialog
  - Auth Guard for route protection
  - Corresponding backend authentication services
- **Showcase Mode**
  - Restrict backend operations and configuration changes
  - URL masking for enhanced security
  - Standardized forbidden error messages
  - Improved access control checks
- WebSocket token verification for secure real-time communication

### Changed
- Updated project description
- Refined UI layouts for improved responsiveness
- Added Windows detection hook

## [1.1.0] - 2026-02-11

### Changed
- **Project Rebranding**: Renamed from "Clash Master" to "Neko Master"
  - Updated all assets and branding materials
  - Changed package scope from `@clashmaster` to `@neko-master`
  - Cleanup of legacy references
- Restructured web app components into `common`, `layout`, and `features` directories
- Migrated API routes from monolithic `api.ts` to dedicated controllers
- Introduced new `collector` service for backend data management

### Added
- Skeleton loading for better UX
- Domain preview with copy functionality

## [1.0.5] - 2026-02-07

### Changed
- **Upgraded to Next.js 16**
- Migrated manifest to dynamic generation

### Fixed
- Ensured manifest is properly emitted in HTML head
- Added dev image tags for Docker

## [1.0.4] - 2026-02-08 ~ 2026-02-10

### Added
- **WebSocket Real-time Data Support**
  - WebSocket push interval control
  - Service worker caching for connection robustness
  - Client-side push interval control
- Country traffic list sorting (by traffic and connections)
- `useStableTimeRange` hook for consistent time range handling
- `keepPreviousByIdentity` query placeholder
- `ExpandReveal` UI component
- Auto-refresh spinning animation

### Performance
- Optimized WebSocket data payloads and push frequency
- Improved GeoIP lookup efficiency through batching
- Optimized rule chain flow rendering with component memoization
- Throttled data updates for better performance
- Conditional fetching based on active tab

### Changed
- Migrated data fetching to `@tanstack/react-query` for improved state management and caching
- Enhanced Top Domains Chart with stacked traffic and self-fetching data
- Added flag fonts for country/region display

## [1.0.3] - 2026-02-07 ~ 2026-02-08

### Added
- **Interactive Rule Statistics**
  - Paginated domain/IP tables
  - Proxy chain tracking
  - Zero-traffic rules display
- **Device Statistics** with dedicated tables and backend collection
- **IP Statistics** with detailed information
- **Domain Statistics** with filtering capabilities
- Time range filtering for interactive stats
- `CountryFlag` component for visual country/region representation
- Real-time traffic statistics collection
- Zooming support in rule chain flow visualization
- Custom date range display formatting
- Calendar layout refactored to use CSS Grid

### Changed
- Refactored data cleanup to use minute-level statistics
- Enhanced version status display in about dialog

## [1.0.2] - 2026-02-06 ~ 2026-02-07

### Added
- **PWA (Progressive Web App) Support**
  - Service worker implementation
  - Manifest file
  - PWA install functionality
- **Interactive Proxy Statistics**
  - Detailed domain and IP tables
  - Sorting and pagination
  - Per-proxy traffic breakdown
- Database data retention management
- Favicon provider selection
- Docker health checks
- Backend configuration verification
- Toast notifications for better UX
- About dialog with version information
- API endpoint to test existing backend connections by ID

### Changed
- Standardized port environment variables across Dockerfile, docker-compose, and Next.js configuration
- Added package.json version to Docker image tags
- Automated Docker Hub description updates
- Enhanced dashboard mobile experience for tables
- Improved scrollbar and backend error handling UI

### Infrastructure
- Added CI/CD workflows
  - Dev branch hygiene workflow
  - Preview branch creation workflow
  - Enhanced Docker image tagging strategy

## [1.0.1] - 2026-02-06

### Added
- English README documentation
- Language selection support in main README

### Changed
- Enhanced README with first-use setup screenshot
- Updated README header styling with larger logo
- Updated Docker deployment instructions to use pre-built images from Docker Hub

## [1.0.0] - 2026-02-06

### Added
- Initial release of Clash Master
- Modern traffic analytics dashboard for edge gateways
- Real-time network traffic visualization
- Backend management and configuration
- Docker deployment support
- Multi-backend support
- Traffic statistics overview
- Country traffic distribution
- Proxy traffic statistics
- Rule-based traffic analysis
