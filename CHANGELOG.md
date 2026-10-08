# 更新日志

本文档记录了本项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
并且本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [1.4.1] - 2026-10-09

本版本集中处理 GitHub 上反馈的 bug 与兼容问题。

### 修复

- **升级/重启后流量出现巨大尖峰**（[#50]，感谢 @PlutoNameless）🐛
  - 网关上报的是每条连接的累计字节数。collector 或 agent 重启（例如升级容器）后，首轮快照会把所有已存在长连接的历史累计量当作新增流量再记一遍，10 分钟内凭空多出数十 GB。现在，网关开始时间（mihomo `start` / Surge `startDate`）早于进程启动 5 秒以上的连接只建立基线，此后的增量照常计入；没有开始时间的连接保持旧行为，不丢数据。mihomo 直连、Surge 轮询与 Go agent 三条路径一致生效
  - **行为变化**：重启瞬间已存在连接的历史累计量不再计入（这部分本来就是重复计数），所以升级时刻的曲线会比以前"低"
- **Agent 空闲时频繁显示离线**（[#58]，感谢 @yf-9186）🐛
  - 离线判定超时默认值（30 秒）与 agent 心跳间隔（30 秒）相同，再加上没有流量时 agent 不上报，后端列表与手动测试还用的是 8 秒窗口，空闲但健康的 agent 大部分时间都会显示离线。现在统一使用心跳超时，默认改为 90 秒（心跳间隔的 3 倍），可用 `AGENT_HEARTBEAT_TIMEOUT_MS` 调整（最小 15000）。**行为变化**：agent 真正掉线后，最多 90 秒才会标记为离线
- **Surge 开启 `http-api-tls` 后报 `fetch failed`**（[#88]，感谢 @fgprodigal）🐛
  - Surge `http-api-tls` 与 mihomo `external-controller-tls` 使用自签证书，所有网关请求都会失败，而且只显示一句笼统的 `fetch failed`。现在轮询和测试连接的报错会带上底层原因（如 `DEPTH_ZERO_SELF_SIGNED_CERT`、`ECONNREFUSED`），证书类错误会附带处理提示
  - 新增 `BACKEND_TLS_INSECURE=1`：仅对网关 API 跳过证书校验，启动时打印一次警告；GeoIP、ClickHouse 等其他出站请求仍正常校验。只建议在可信局域网内使用
- **趋势图选择超过 24 小时的范围时 Tooltip 不准确**（[#82]，感谢 @pengbins）🐛
  - 修正 realtime 合并与存储中的按日分桶，并把查询的分桶上限放宽到 1440 分钟
- **平板安装 PWA 后被强制竖屏**（[#73]，感谢 @ICEY16360）：manifest 的 `orientation` 从 `natural` 改为 `any`

### Agent（随 `agent-v1.4.6` 发布）

- **OpenWrt 上 `nekoagent status` 显示 stopped**（[#71]，感谢 @yf-9186）：procd init 脚本现在会写入 pidfile（`/var/run/neko-agent/<name>.pid`），`status` 可以正确显示运行状态与 PID；手写 init 脚本的中英文文档同步更新
- **新增 `--gateway-insecure-tls`**（[#88]）：对应环境变量 `NEKO_GATEWAY_INSECURE_TLS`，仅跳过网关 API 的证书校验，向 collector 上报仍然校验证书。`nekoagent add` 支持该参数并会持久化；只有启用时才把该参数传给 agent，所以先升级管理脚本、后升级二进制的实例也能正常启动
- 修复重启后长连接流量被重复计入的问题（[#50]，见上）。上报协议版本不变

[#50]: https://github.com/foru17/neko-master/issues/50
[#58]: https://github.com/foru17/neko-master/issues/58
[#71]: https://github.com/foru17/neko-master/issues/71
[#73]: https://github.com/foru17/neko-master/issues/73
[#82]: https://github.com/foru17/neko-master/issues/82
[#88]: https://github.com/foru17/neko-master/issues/88

## [1.4.0] - 2026-07-19

本版本源自第二次外部深度代码评审，逐条证伪核验后修复其中的高优先级问题：数据正确性、安全默认值、错误可见性，以及一处当前正在发生的安装故障。

### 修复

- **Agent 安装/升级 404**：`install.sh` 与 `nekoagent` 此前用 GitHub `releases/latest` 解析下载地址，而该端点会命中不带 agent 二进制的主应用 `v*` release，导致新装和升级全部 404。改为列出 releases 并筛选最新的 `agent-v*` tag，再从该具体 tag 下载。
- **Agent 模式 CH_ONLY 静默丢数据**：当 ClickHouse 被判定健康而跳过 SQLite 写入、随后 ClickHouse 写入失败时，缓冲区已清空、数据从内存与磁盘同时消失。现补齐与 gateway/surge 一致的 SQLite 兜底回写（流量与国家维度）。
- **Agent 模式 realtime store 无界增长**：agent 路径此前从不调用 `pruneIfNeeded`，ClickHouse 持续故障时内存无限累积，长时间运行的软路由/网关部署会 OOM。现每次 flush 后修剪。
- **统计错误态缺失**：仪表盘 collector 请求失败时静默显示为"暂无数据"——对监控工具是最糟的失败模式。KPI 卡片现会在查询失败时显示错误提示。

### 安全

- **CORS 默认拒绝跨源**：未设置 `CORS_ORIGIN` 时，此前会反射任意 Origin 且携带凭证（`credentials: true`），任何网站都能借已登录用户的浏览器跨站读取流量数据。现默认拒绝跨源；同源部署（默认 Docker 形态）不受影响。**升级提示**：若你的仪表盘与 collector 部署在不同源，需显式设置 `CORS_ORIGIN`（见 `.env.example`），否则跨源请求将被拒绝。
- **`GET /api/backends` 不再返回明文 token**：列表/读取接口此前原样返回存储的上游/agent token。现已剥离；编辑表单将空 token 视为"不修改"，编辑功能不受影响。

## [1.3.10] - 2026-07-04

本版本源自一次全项目深度审查（架构 / 数据库 / 性能 / 前端 / 交互），集中修复其中的高危问题。完整审查报告见 `docs/dev/deep-review-2026-07.md`。

### 修复

- **规则链路图入口列出现 RuleSet/IPCIDR 类型节点（v1.3.9 回归）** 🐛
  - v1.3.9 的规则命名调整（PR [#68]）把 mihomo 流量的聚合主键从顶层策略组改成了原始规则类型 + payload，破坏了链路图入口列与前端网关规则匹配（两者都以策略组名为键）。多跳链路恢复以最后一跳策略组为主键；规则明细名仅用于直连 DIRECT/REJECT 的单跳链路。启动时一次性迁移会把污染数据重映射回策略组名并合并累计值
- **30 天时间范围实际只有 7 天维度数据** 🐛
  - `hourly_dim_stats` / `hourly_country_stats`（支撑所有 >6 小时范围查询）被 7 天的分钟级 retention 一并删除。现改为跟随小时级 retention 窗口（默认 30 天）
- **ClickHouse 写启用但读源为 SQLite 时静默缺数据** 🐛
  - 精简 SQLite 写入（跳过 domain/IP/rule/dim 表）此前只看 ClickHouse 写健康状态；默认 `STATS_QUERY_SOURCE=sqlite` 的部署读的还是 SQLite，那些表却没写。现在只有读源确实偏向 ClickHouse（clickhouse/auto/CH_ONLY_MODE）时才精简写入，配置错位时启动告警
- **CSV 关联列子串误匹配丢数据** 🐛
  - 裸 `INSTR` 去重会把 `a.com` 误判为已存在于 `aa.com`（IP、规则名同理），导致 domain/ip 关联列表静默缺项。统一改为带分隔符的 `','||list||','` 匹配
- **批量写非原子导致重试双计** 🐛
  - 批量落库的三段子事务独立提交，中途失败后 buffer 重放会对已提交的表二次累加。现在由外层单事务包住（内层自动降级为 savepoint）
- **切换后端瞬间数据串台** 🐛
  - WebSocket 推送现在携带 `backendId`，前端丢弃与当前订阅不符的在飞推送，避免旧后端数据写入新后端缓存
- **前端错误处理补全**：新增路由级与全局错误边界（可视化组件异常不再白屏整页）；链路图加载失败渲染带重试的占位卡片，不再静默消失
- **暗色模式修复** 🌓：世界地图整体适配暗色（无数据国家 / 色阶 / 描边 / 图例，此前是一块刺眼的亮色地图）；规则列表上传箭头暗色误用蓝色致上下行不可分；后端健康按钮 hover 与异常徽标补齐 dark 变体
- **Active Policy 白名单不生效**：`UnifiedRuleChainFlow` 的 memo 比较器漏比 `visibleRuleNames`，首屏后白名单一直是旧值

### 优化

- **规则链路图查询降复杂度**：realtime 合并从 O(R×N) 的逐条 `findIndex` 改为 Map 合并；DAG 源数据按流量取 Top-N（`RULE_CHAIN_FLOW_MAX_ROWS`，默认 2000）而非全表扫描；去掉每次广播对 realtime 规则链路表的整表深拷贝
- **WebSocket 广播并发化 + 出站背压**：广播负载并发预取（此前逐客户端串行 await）；出站缓冲超过 `WS_MAX_BUFFERED_BYTES`（默认 4MB）的慢客户端跳过本轮推送，防止内存被单个慢连接拖爆，指标行新增 `backpressure_skips`
- **删除四个从未被查询计划使用的表达式索引**（`total_download + total_upload`），消除四张最热表的无谓写放大；存量库启动时自动 DROP
- **写路径唯一化**：删除与批量实现漂移已久且无生产调用方的单条写路径，`updateTrafficStats` 现在是批量路径的一层包装

[#68]: https://github.com/foru17/neko-master/pull/68

## [1.3.9] - 2026-06-23

### 修复

- **ClickHouse 降级时静默丢失持久化数据** 🐛
  - 当 ClickHouse 被判定为健康时会跳过 SQLite 写入，但内存批次在 ClickHouse 异步写入确认前就被清空；一旦写入失败（队列满 / 部分表失败 / 超时），数据只短暂留在实时内存里，从未落盘。现在 ClickHouse 写入失败且 SQLite 被跳过时，会把本批快照回灌写入 SQLite 作为持久化兜底
  - 写入队列已满现在计入「不健康」阈值，使采集器恢复 SQLite 写入
  - 健康状态只在「detail+agg 整批」成功后才重置，避免某个表持续失败、另一个表成功时反复重置计数从而长期掩盖故障
- **Agent 模式计数器重置漏记流量** 🐛
  - Go Agent 在计数器回退（网关重启 / 连接 ID 复用）时把增量置 0 丢弃流量，与已修复的直采采集器不一致。现在同样将当前值计为新流量并重新计入连接数
- **删除后端遗留孤儿数据** 🐛
  - `PRAGMA foreign_keys` 默认关闭使 `ON DELETE CASCADE` 从未生效，删除后端只删除配置行、残留所有统计数据。`deleteBackend` 现显式删除全部关联数据（含健康日志、策略缓存、Agent 心跳与快照）
- **更新后端密码后采集不恢复**（[#65]）🐛
  - 凭据变更触发采集器重启时，`disconnect` 把真正的断开延迟到异步 flush 之后，旧 WebSocket 仍带旧 token 重连并脱离管理。现在先同步断开（置 `isClosing`、清重连定时器、关闭 socket）再 flush
- **WebSocket 端口环境变量不生效**（[#61]）🐛
  - `runtime-config.js`（容器启动时写入真实外部端口）存在脚本加载竞态与缓存，浏览器回退到构建期默认端口，使 `WS_EXTERNAL_PORT` 看似无效。现以 `beforeInteractive` 加载该脚本、对其设置 `no-store` 且排除出 PWA 预缓存
- **Mihomo 代理组被解析成规则**（[#67]，PR [#68] 由 @cesaryuan 贡献）🐛
  - 规则名不再误用链路最后一跳（代理组），改用真实匹配规则，并集中到共享 `buildRuleName` helper，消除多写路径的逻辑漂移
- **采集器静默挂起、数据停止同步**（[#74]，PR [#76] 由 @zj1123581321 贡献）🐛
  - 新增 WebSocket 心跳看门狗：定期 ping 并跟踪最近活跃时间，链路静默超时则强制 terminate，触发既有重连逻辑，修复 TCP 静默断开（网关重启 / NAT 超时）导致的「连接仍在但数据停更」

### 优化

- **WebSocket 重连改为指数退避 + 抖动**：避免后端宕机 / 抖动时多个采集器每 5 秒同步重连造成的雪崩；连接成功后重置退避。Surge 采集器的退避重试也加入抖动（`WS_MAX_RECONNECT_INTERVAL_MS` 可配，默认 60s）

[#61]: https://github.com/foru17/neko-master/issues/61
[#65]: https://github.com/foru17/neko-master/issues/65
[#67]: https://github.com/foru17/neko-master/issues/67
[#68]: https://github.com/foru17/neko-master/pull/68
[#74]: https://github.com/foru17/neko-master/issues/74
[#76]: https://github.com/foru17/neko-master/pull/76

## [1.3.8] - 2026-06-10

### 修复

- **Gateway 采集器流量计数器重置后丢失流量** 🐛
  - 修复后端重启或连接 ID 复用导致计数器回退时，`Math.max(0, delta)` 静默丢弃流量、且高水位未重置导致重置后的流量持续被吞掉的问题；现在与 Surge 采集器一致，将当前值计为新流量并记录日志
  - 修复长连接空闲超过 5 分钟被误判为 stale 清理后，重新加入时按累计值整体重复计数的问题：连接只要出现在推送中即刷新 `lastSeen` 与计数水位
- **优雅停机可能丢失待写入数据** 🐛
  - `APIServer.stop()` 未 `await app.close()`，且 `shutdown()` 同步执行后立即 `process.exit(0)`，导致 `onClose` 钩子中的 Agent 缓冲区 flush 来不及完成；现已全链路 await
- **WebSocket 死连接泄漏**：广播发送失败且 socket 已关闭时，从客户端表中移除，避免无效广播持续累积
- **内存边界**：实时统计 store 新增按 source IP 的外层设备明细表淘汰（上限 10,000）；WebSocket 摘要缓存新增 1,000 条硬上限；Agent 请求去重表改为基于时间的定期清理
- **Web 前端**
  - 登录确认 `setTimeout` 在组件卸载时未清理
  - Dashboard 通过正则解析路径获取 locale，改用 `next-intl` 的 `useLocale()`
  - 流量图表硬编码 `en-US` 时间格式、统计卡片 `toLocaleString()` 未传 locale，切换语言后格式不一致
- **共享包**：`parseGatewayRule` 对对象输入增加运行时校验，避免返回 `proxy: undefined` 违反类型契约
- **Go Agent**：`syncConfig` 读取 `lastConfigHash` 未加锁（TOCTOU）；策略同步循环启动等待期间不响应 ctx 取消；锁文件权限收紧为 0600；`json.Marshal` 错误不再忽略
- **install.sh**：`download_file` 无条件 `return 0` 掩盖下载失败；curl/wget 增加超时与重试（connect 10s / 总 120s / 重试 3 次）

### 安全

- **CORS 可配置**：新增 `CORS_ORIGIN` 环境变量（逗号分隔）限制跨域来源，默认保持宽松以兼容 LAN 部署
- **API 安全响应头**：新增 `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy`
- **令牌比较改为常数时间**：Agent token 与 Dashboard token 校验使用 `crypto.timingSafeEqual`
- **后端 URL 协议校验**：仅允许 `http(s)` / `ws(s)` / `agent://`，拒绝 `file:` 等危险协议
- **Cookie 密钥持久化**：未配置 `COOKIE_SECRET` 时自动生成并持久化到数据库，重启不再使所有会话失效

### 变更

- **依赖全面升级**：TypeScript 6.0、ESLint 10（collector）、better-sqlite3 12、recharts 3、react-day-picker 10、lucide-react 1.x、tailwind-merge 3、dotenv 17、Next.js 16.2.7 等全部升至最新；Web 端 ESLint 因 `eslint-plugin-react` 生态尚未支持 v10 暂留 v9

## [1.3.7] - 2026-04-12

### 修复

- **SQLite 数据保留策略静默失效** 🐛 ([#66](https://github.com/foru17/neko-master/issues/66))
  - 修复全新安装的实例默认 `autoCleanup` 为 `false` 的 bug：`app_config` 表无配置行时读取返回 `false`，与代码声明的默认值 `true` 不一致，导致 minute 级和 hourly 级统计表从未被清理
  - 修复 `backend_health_logs` 从未被清理：启动流程使用的是内联 `runAutoCleanup`，只清 `minute_*` / `hourly_*`，真正包含健康日志清理的 `CleanupService` 从未被实例化
  - 修复 UI 切换 `autoCleanup` 开关不生效：`CleanupService.start()` 在 `autoCleanup=false` 时早退，定时器未挂起，后续切换无效
  - 新增环境变量覆盖：`SQLITE_RETENTION_MINUTE_DAYS` / `SQLITE_RETENTION_HOURLY_DAYS` / `SQLITE_RETENTION_HEALTH_LOG_DAYS`，便于 Docker Compose 用户 set-and-forget
  - 感谢 @airobot-bot 提供的详细行级统计数据

- **编辑后端时 URL 被静默重建** 🐛 ([#65](https://github.com/foru17/neko-master/issues/65))
  - 修复更新后端任何字段（包括只改密钥）时 URL 被强制重建的 bug：前端编辑表单只保留 `host` / `port` / `ssl`，保存时用 `buildDirectUrl` 重建，丢掉原 URL 中的 path / query / embedded credentials
  - 修复方式：当 `host` / `port` / `ssl` 未被修改时，保留原始 URL 原样提交
  - Collector 后端日志增强：重启时打印具体变更字段（如 `changed: token`），便于用户自证重启逻辑触发
  - 感谢 @yuhongwei380 的报告

## [1.3.6] - 2026-03-26

### 修复

- **WebSocket 端口配置在 Docker 直连场景下无效** 🐛
  - 修复生产环境下 `WS_EXTERNAL_PORT` 设置后，前端仍连接到 Web 端口（而非 WS 端口）的问题
  - 根因：生产模式优先尝试 `/_cm_ws` 路径（使用 `window.location.host`，即 Web 端口），而非配置的 WS 端口；`/_cm_ws` 在 Next.js 中没有 WebSocket 代理，导致连接失败后才 fallback 到直连端口，但此时已触发 HTTP 轮询回退
  - 修复方式：当 `runtime-config.WS_PORT` 存在时（即用户配置了 `WS_EXTERNAL_PORT`），优先使用直连端口 URL，无需再设置 `NEXT_PUBLIC_WS_URL`

## [1.3.5] - 2026-03-03

### 新增

- **WebSocket 摘要数据增强** 📊
  - WebSocket 推送新增代理节点总数和规则总数摘要字段
  - 优化 Dashboard 在 WebSocket 连接期间的数据获取策略
- **概览列表自适应展示** 📐
  - 新增 `useResponsiveItemCount` Hook，根据窗口高度自动计算列表显示条目数
  - Top Domains 卡片新增流量进度条，直观展示各域名流量占比
- **国家/地区名称国际化** 🌍
  - 使用 `Intl.DisplayNames` API 替代手动维护的国家名称映射，支持全部 249 个 ISO 国家代码的本地化翻译
  - 中文界面下所有地区板块（概览、排行、列表、饼图、世界地图、IP 详情）均正确显示中文国家名
  - 支持自定义名称覆盖，确保跨浏览器/系统版本显示一致
- **新 Logo** 🎨

### 修复

- **规则统计不显示** 🐛
  - 修复 1.3.4 WebSocket 摘要优化后，规则总数和代理总数在 Dashboard 上显示为 0 的问题
  - 原因：`totalProxies`/`totalRules` 原先从 `proxyStats`/`ruleStats` 数组长度计算，但摘要优化跳过了这些数组的获取
  - 修复方式：将这两个计数纳入 WebSocket 摘要缓存，确保始终可用
- **Dashboard 在 WebSocket 连接中卡在加载状态**
  - 修复 WebSocket 处于 `connecting` 状态时 Dashboard 无限显示过渡动画的问题
  - 优化 `isTransitioning` 判断逻辑，仅在确实需要 HTTP 回退获取数据时显示加载状态
- **Settings 开关切换抖动** ⚡
  - 修复切换 Collect 开关和 Active 节点时整个后端列表闪烁骨架屏的问题
  - 改为静默刷新数据，避免不必要的全量重渲染
- **桌面端下拉菜单滚动条闪烁**
  - 修复打开下拉菜单、弹窗、主题切换时页面滚动条出现/消失导致的布局跳动
  - 仅在桌面端（`pointer: fine`）应用滚动条空间预留，不影响移动端 Radix 弹出层定位

## [1.3.4] - 2026-02-26

### 新增

- **后端健康监控增强** 🏥
  - Agent 现在向 collector 上报网关延迟，用于健康监控
  - 新增 `nekoagent restart-all` 命令，可一键重启所有 Agent 实例
  - 后端健康状态支持显式状态标识（healthy/unhealthy/unknown）
  - 健康图表根据延迟自动着色：低延迟为绿色、中等延迟为黄色、高延迟为红色
  - Direct 模式后端显示延迟曲线，Agent 模式后端显示在线/离线状态
  - 网关延迟计算算法优化，图表标签本地化（中文/英文）

- **Agent 开机自启动** 🚀
  - 安装脚本新增系统服务管理器支持，可实现 Agent 开机自动启动
  - 支持 systemd（Linux 主流发行版）、launchd（macOS）、OpenWrt procd、cron（通用）
  - 安装时自动检测系统类型并配置相应的服务
  - 可通过 `--no-autostart` 禁用自动启动

- **WebSocket 性能优化** ⚡
  - 新增 `includeSummary` 参数，支持按需获取 WebSocket 统计摘要
  - 实现选择性摘要字段检索，大幅减少不必要的数据传输
  - `useStableTimeRange` 时间范围取整到分钟，避免边界抖动
  - 实现细粒度摘要数据获取和客户端缓存机制
  - 规则标签页（Rules Tab）新增顶部汇总统计卡片

### 变更

- 优化 `tr` 命令字符集转换，提升跨平台兼容性
- 修复管理脚本重复同步问题

## [1.3.3] - 2026-02-24

### 新增

- **后端健康监控面板（Health Tab）** 🏥
  - 新增独立 Health 标签页，支持对所有已配置后端进行历史健康状态可视化
  - 每个后端展示一张时序面积图：Direct 模式显示延迟曲线，Agent 模式显示在线/离线状态
  - 异常区间（unhealthy / unknown）以红/橙色背景着色；首末数据点之间的数据缺口自动标记为故障，首尾 leading/trailing 空白保持留白
  - 支持多时间范围（1h / 6h / 12h / 24h / 7d / 30d），X 轴标签随时间跨度自动切换格式（纯时间 / 月日时间 / 纯日期）
  - 顶部 6 张汇总卡片：整体可用率、健康节点数、异常节点数、节点总数、平均延迟、统计粒度，与 Overview 视觉风格统一
  - 健康检查间隔默认 30 秒，最小 5 秒，可通过 `BACKEND_HEALTH_CHECK_INTERVAL_MS` 环境变量自定义
  - 新增 `backend_health_logs` 表，以 `(backend_id, minute)` 为主键，同一分钟内多次检查 UPSERT 去重；历史数据随 hourly stats 同步按 30 天保留期自动清理
  - 健康 history API 支持按 `backendId` 过滤，数据按后端分组并附带名称，Controller 仅负责参数解析
- **国家流量连接数计数**
  - 国家流量统计新增连接数维度，Country Traffic 面板现可按连接数排序
  - Agent 上报数据新增显式 `connections` 字段，带旧版兼容 fallback
- **时间范围预设扩展**
  - `5m` 和 `30m` 快捷预设在生产环境下恢复可用

### 变更

- **流量采集连接数计算对齐**
  - Agent 模式与 Direct 模式的连接数均改为每次 flush 周期计算一次，避免重复计数
  - 移除旧的 `requeueFront` 逻辑中的连接数累加副作用
- **大小写归一化函数兼容性**
  - 字符类转换函数中的 `tr` 字符集改为显式字符列表，提升跨平台一致性

## [1.3.2] - 2026-02-22

### 新增

- **ClickHouse 高性能存储后端（重大更新）** 🗄️
  - 新增 ClickHouse 作为可选分析存储引擎，与 SQLite 形成双写架构
  - 健康状态感知路由：ClickHouse 健康时自动跳过 SQLite 统计写入，显著降低本地磁盘 IO
  - 支持纯 ClickHouse 模式，适用于大规模多 Agent 部署场景
  - 新增 `ClickHouseWriter` 模块，支持批量写入、健康检测、连续失败降级与优雅恢复
- **`NEKO_AGENT_REF` 分支测试支持**
  - 安装脚本新增 `NEKO_AGENT_REF` 环境变量，支持指定任意 GitHub 分支下载 `nekoagent` 管理脚本
  - 如 `NEKO_AGENT_REF=refactor/clickhouse` 可测试未合并分支，无需手动修改脚本

### 性能优化

- **Agent 上报流量 Gzip 压缩（~10-15x 压缩比）** 🚀
  - `neko-agent` HTTP 上报请求全面启用 gzip 压缩，实测夜间流量由 ~4 GB 降至 ~300 MB
  - Collector 通过 Fastify `preParsing` Hook 透明解压，零额外依赖
  - 兼容旧版无压缩 `neko-agent` 客户端，新旧版本可并存运行

### 修复

- **[P0] ClickHouse 健康判断方法错误导致静默数据丢失**
  - 修复 `app.ts` 中 `shouldSkipSqliteStatsWrites` 误用 `clickHouseWriter.isEnabled()` 的问题
  - 更正为 `clickHouseWriter.isHealthy()`：ClickHouse 连续写入失败时正确回退到 SQLite，防止数据静默丢失
- **[P1] Agent 重试批次丢失 requestId 导致流量重复计算**
  - Agent 上报 payload 新增 `requestId`（`crypto/rand` 生成 32 位随机 hex）
  - Collector 实现服务端幂等去重（5 分钟 TTL Map），同一 `requestId` 多次到达只处理一次
  - 修复旧 `requeueFront` 逻辑：失败批次重入队列时会生成新 ID，导致重试可被重复计算；现在失败批次在整个重试周期内持有同一 `requestId`

### 变更

- **`nekoagent update` / `upgrade` 彻底重写**
  - 旧版 `update` 实为重新执行安装脚本并调用 `nekoagent add`，从不更新二进制
  - 重写为直接下载目标版本 binary、SHA256 校验后原地替换；版本相同时跳过下载
  - 新增 `upgrade` 作为 `update` 的别名
- **`nekoagent add` 默认自动启动**
  - `auto_start` 默认值由 `false` 改为 `true`，`add` 后实例自动启动，无需再手动 `start`
  - 新增 `--no-start` flag 可在 `add` 时抑制自动启动
  - 安装脚本 `NEKO_AUTO_START=false` 现可正确透传 `--no-start` 到 `add` 命令
- **Agent 版本系统统一**
  - `neko-agent` 二进制版本号改由编译时 ldflags 注入（`-X ...config.AgentVersion=<tag>`），废弃原硬编码常量
  - CI `agent-release.yml` 自动从 git tag 提取版本注入；本地开发版本显示 `dev`
  - `nekoagent version` 同时展示管理脚本版本和 `neko-agent` 二进制版本，版本信息一致可查
- **安装脚本版本检测与增量更新**
  - 检测到已安装时，自动查询 GitHub Releases API 获取远端最新版本号
  - 本地版本 == 目标版本时直接调用 `nekoagent add` 跳过下载；否则先更新二进制再添加实例

### 文档

- **`docs/` 目录重组**
  - 新增 `docs/dev/`（ClickHouse 分析与重构文档）和 `docs/research/`（模型研究报告）子目录
  - 新增 `docs/README.md`（中文文档索引）和 `docs/README.en.md`（英文文档索引），含分类可点击链接
  - 修复主 README 中 Agent 文档链接路径错误（指向中文 `.md` 而非英文 `.en.md`）
  - 架构文档新增独立 Agent 模式章节，描述部署拓扑与完整数据流

## [1.3.1] - 2026-02-19

### 新增

- **Agent 模式（重大更新）** 🤖
  - 支持通过 `agent://` 后端被动上报，适配中心化面板 + 边缘采集部署模型
  - 新增 Agent 脚本引导，支持一键复制运行命令与安装命令
  - 新增 Agent 令牌重置（Rotate Token）流程，支持失效旧实例并快速重绑
- **Agent 跨平台发布与自动化**
  - 新增 GitHub Actions：`agent-build.yml`（测试/交叉编译）与 `agent-release.yml`（多架构打包发布）
  - 发布产物统一命名并附带 `checksums.txt`，支持 `darwin/linux` 多架构
- **Agent 安装与运维工具链**
  - 安装脚本升级：自动识别系统架构、下载 release、校验 checksum、安装并启动
  - 新增 `nekoagent` 管理命令（实例初始化、启停、状态、日志、更新、移除/卸载）
- **Agent 文档体系**
  - 新增 `docs/agent/*`（总览、快速开始、安装、配置、发布、排障）
  - 新增发布清单 `docs/release-checklist.md`

### 变更

- Agent 配置页交互重构：新增/编辑改为独立弹窗，列表布局对齐优化
- Agent Script 弹窗支持响应式与滚动优化，适配移动端
- Agent 类型（Clash/Surge）在创建后改为只读，避免破坏性修改

### 安全

- Agent token 改为系统管理：历史 token 不回显，需通过重置生成新随机 token
- 服务端新增 Agent 绑定约束：同一 backend token 禁止被多个 `agentId` 复用

### 兼容

- 新增 Agent 协议与版本门禁：支持 `MIN_AGENT_PROTOCOL_VERSION` 与 `MIN_AGENT_VERSION`
- 不兼容请求返回明确错误码：`AGENT_PROTOCOL_TOO_OLD`、`AGENT_VERSION_REQUIRED`、`AGENT_VERSION_TOO_OLD`

## [1.3.0] - 2026-02-16

### 新增

- **链路图分隔符兼容（Issue #34）**
  - 链路流向图现在支持规则名/节点名中包含 `|` 字符，不再因分隔符冲突导致构图失败
- **GeoIP 配置状态字段增强**
  - `/api/db/geoip` 响应新增 `configuredProvider` 与 `effectiveProvider`，明确“已配置来源”与“实际生效来源”
- **回归测试补充**
  - 新增 `app.geoip-config.test.ts`（GeoIP 配置 API 行为）
  - 新增 `db.geoip-normalization.test.ts`（GeoIP 归一化兼容）
  - 新增规则链分隔符场景测试，覆盖 `|` 名称链路构建

### 变更

- **GeoIP 归一化能力下沉到 shared**
  - 新增 `packages/shared/src/geo-ip-utils.ts`，统一前后端 `normalizeGeoIP`
  - `IPStats.geoIP` 类型收敛为结构化对象，移除数组形态依赖
  - Collector 多个 IP 相关查询统一做 GeoIP 归一化返回，兼容历史数据
- **配置模块工程化重构**
  - 将 `/api/db/*` 路由从 `app.ts` 抽离到独立 `config.controller`
  - `createApp` 新增 `autoListen` 选项，便于集成测试和可控启动
- **GeoIP 服务稳定性增强**
  - MMDB 必需文件名复用配置常量，减少硬编码
  - 增加 MMDB 缺失状态短 TTL 缓存，降低频繁文件系统探测开销
  - 增加队列溢出日志、`destroy()` 资源释放能力
  - 优化私网 IPv6 判断（含 `::ffff:` 映射 IPv4）与失败冷却策略

### 修复

- **修复 `/api/stats/rules/chain-flow-all` 500 错误**
  - 解决 `Cannot read properties of undefined (reading 'name')` 异常，根因是链路 key 使用字符串分隔导致解析错位
- **修复 GeoIP 配置读取副作用**
  - 读取 `/api/db/geoip` 不再隐式改写已保存配置（side-effect free）
  - 设置页按 `effectiveProvider` 显示选中态，避免“配置值”和“实际值”视觉不一致
- **修复 React Flow 规则链节点在 Windows 下国旗 emoji 显示**
  - 规则/分组/代理节点名称补齐 `emoji-flag-font` 适配
  - 前后端 active link key 编码方式统一，避免链路匹配歧义

## [1.2.9] - 2026-02-16

### 新增

- **离线 GeoIP（本地 MMDB）能力** 🌐
  - 设置页新增 IP 查询来源切换（`online` / `local`）
  - 支持本地 MMDB 数据源：`GeoLite2-City.mmdb`、`GeoLite2-ASN.mmdb`（必需），`GeoLite2-Country.mmdb`（可选）
- **MMDB 预检测与保护**
  - 切换到本地模式前先检查必需 MMDB 文件
  - 缺失文件时本地选项自动禁用，并显示缺失文件列表
- **MMDB 可用性兜底机制**
  - 当用户删除历史 MMDB 文件后，运行时查询会自动回退到在线接口
  - 若配置仍是 `local` 且 MMDB 不可用，服务端会自动回写为 `online`，避免 UI 与实际行为不一致
- **本地开发目录识别增强**
  - 增强 MMDB 目录探测逻辑（支持多候选目录与环境变量覆盖）
  - 修复本地开发场景下 `geoip` 目录已存在但仍无法启用 Local 的问题
- **移动端详情交互统一**
  - 规则页（Domains / IPs）移动端详情统一改为 Drawer 交互
  - 与设备页、统计页保持一致的移动端信息展示方式
- **设置页交互一致性增强**
  - `IP Lookup Source` 选中态视觉与 Favicon 选项统一
  - 选项改为整行可点击，不再只能点击前置单选按钮

### 变更

- 文档更新（中英文 README / `.env.example`）：
  - 增补本地 MMDB 部署与挂载说明
  - 明确 `GEOIP_ONLINE_API_URL` 仅适用于兼容 `ipinfo.my` 响应结构的在线接口
  - 收敛重复英文 README，保留统一入口

## [1.2.8] - 2026-02-15

### 性能优化

- **查询性能大幅提升（最高 60x）** 🚀
  - 新增 `hourly_dim_stats` / `hourly_country_stats` 预聚合表，写入时实时维护
  - 所有维度表查询（domain/ip/proxy/rule/device/country）在 > 6h 范围时自动路由到小时级预聚合表
  - 时序查询优化：`getHourlyStats`、`getTrafficInRange`、`getTrafficTrend`、`getTrafficTrendAggregated` 在长范围查询时直接读取 `hourly_stats`，避免扫描 `minute_stats` 并重新聚合
  - 7 天范围查询扫描行数从 ~10,080 行降至 ~168 行
  - 每次 WebSocket broadcast 总扫描行数从 ~20,160 行降至 ~336 行
- **`resolveFactTableSplit` 混合查询策略**：长范围查询拆分为 hourly（已完成小时）+ minute（当前小时尾部），兼顾性能与精度

### 新增

- **测试基础设施** 🧪
  - 引入 Vitest 测试框架，新增 `traffic-writer`、`auth.service`、`stats.service` 单元测试
  - 新增测试辅助工具 `helpers.ts`
  - 新增 ESLint 配置和 `.env.example`
- **时间范围选择器增强**
  - 新增「1 小时」快捷预设，替代默认的 30 分钟视图
  - 趋势图新增「今天」快捷选项，从午夜到当前时间
  - 30 分钟预设移至调试模式的短预设列表
- **`BatchBuffer` 模块**：独立的批量缓冲处理模块，从 collector 中解耦

### 修复

- **Cookie 认证安全性**：将 `secure` 标志从 `process.env.NODE_ENV === 'production'` 改为 `request.protocol === 'https'`，修复 HTTP 内网环境下无法设置 Cookie 导致登录循环的问题
- **Windows 平台 emoji 国旗显示**：为 proxy 相关组件（列表、图表、Grid、交互式统计、规则统计）添加 `emoji-flag-font` 样式类，修复 Windows 下国旗 emoji 显示异常

### 重构

- **全局 AuthGuard 重构**：将认证逻辑从 dashboard layout 提取为独立的 `AuthGuard` 组件，简化 `auth.tsx` 和 `auth-queries.ts`
- **Collector 服务拆分**：`collector.ts` 和 `surge-collector.ts` 大幅瘦身，提取 `BatchBuffer` 和 `RealtimeStore` 模块
- 移除旧的 `api.ts` 入口文件，统一使用模块化控制器

### 技术细节

- `hourly_dim_stats` 表结构：`(backend_id, hour, dimension, dim_key, upload, download, connections)`，写入时通过 `INSERT ... ON CONFLICT DO UPDATE` 实时更新
- `resolveFactTable` / `resolveFactTableSplit` 方法在 `BaseRepository` 中实现，所有 Repository 共享
- 时序查询阈值：`getTrafficInRange`/`getTrafficTrend` 在 > 6h 时切换到 `hourly_stats`；`getTrafficTrendAggregated` 在 `bucketMinutes >= 60` 时切换

## [1.2.7] - 2026-02-14

### 新增

- **Surge 后端支持** 🚀
  - 完全支持 Surge HTTP REST API 数据采集
  - 支持规则链可视化展示（Rule Chain Flow）
  - 支持代理节点分布图、域名统计等完整功能
  - 智能策略缓存系统，后台同步 Surge 策略配置
  - 自动重试机制：API 请求失败时采用指数退避策略
  - 反重复计算保护：通过 `recentlyCompleted` Map 防止已完成连接被重复计算
- **响应式布局优化**
  - RULE LIST 卡片支持容器查询自适应，狭窄空间自动切换垂直布局
  - TOP DOMAINS 卡片在单列布局时自动撑满宽度并显示更多数据
- **用户体验改进**
  - Settings 对话框新增 Backends 列表骨架屏，解决首次加载白屏问题

### 修复

- **Surge 采集器短连接流量丢失**：修复已完成连接（status=Complete）的流量增量未被计入的问题，通过 `recentlyCompleted` Map 记录最终流量并正确计算差值
- **清理定时器确定性**：将 `recentlyCompleted` 的清理从 `setInterval` 改为与轮询周期绑定的确定性触发
- 修复 IPv6 验证逻辑，使用 Node.js 内置 `net.isIPv4/isIPv6`

### 重构

- **数据库 Repository 模式重构** 🏗️
  - 将 5400+ 行的单体 `db.ts` 拆分为 14 个独立 Repository 文件
  - 新增 `database/repositories/` 目录，采用 Repository Pattern 架构
  - `db.ts` 瘦身至 ~1000 行，仅保留 DDL、迁移逻辑和一行委托方法
  - 提取的 Repository：`base`、`domain`、`ip`、`rule`、`proxy`、`device`、`country`、`timeseries`、`traffic-writer`、`config`、`backend`、`auth`、`surge`
  - `BaseRepository` 封装了 `parseMinuteRange`、`expandShortChainsForRules` 等 13 个共享工具方法
- **代码清理**（~140 行）
  - 移除未使用的 `parseRule` 函数、重复的 `buildGatewayHeaders`/`getGatewayBaseUrl`
  - 清理调试 `console.log`、未使用的 `sleep()`、`DailyStats` 导入
  - 移除未使用的 `EXTENDED_RETENTION`/`MINIMAL_RETENTION` 常量

### 技术细节

- Surge 采集器使用 `/v1/policy_groups/select` 端点获取策略组详情
- `BackendRepository` 新增 `type: 'clash' | 'surge'` 字段，贯穿创建、查询、更新全链路
- 清理 `/api/gateway/proxies` 中的调试代码

## [1.2.6] - 2026-02-13

### 安全
- **Cookie-based 认证系统**
  - 使用 HttpOnly Cookie 替代 localStorage 存储 token，提升安全性
  - WebSocket 连接改为通过 Cookie 进行认证，避免 token 暴露在 URL 中
  - 实现服务端会话管理，支持会话过期自动刷新

### 变更
- 重构认证流程，前端登录后由服务端设置 Cookie
- 新增欢迎页面图片资源

## [1.2.5] - 2026-02-13

### 新增
- 仪表板头部添加过渡进度条，提升数据切换体验
- 为数据部件实现骨架屏加载状态
- 新增 `ClientOnly` 组件，优化客户端渲染
- 新的 API hooks（devices、traffic、rules、proxies），统一数据获取逻辑
- 展示模式下的时间范围限制
- 展示模式下支持后端切换
- 增强规则链流可视化，支持合并零流量链

### 优化
- Traffic Trend 骨架屏加载体验，避免空状态闪动
- Top Domains/Proxies/Regions 骨架屏高度与实际内容保持一致
- 数据库批量 upserts 使用子事务优化性能
- GeoIP 服务可靠性增强，添加失败冷却和队列限制
- 实现 WebSocket 摘要缓存，减少重复数据传输
- 增强设置和主题选项的国际化（i18n）支持
- 改进 API 错误处理机制

### 修复
- 骨架屏使用 `Math.random()` 导致的 Hydration Mismatch 错误
- 登录对话框暗黑主题样式优化
- 修复登录对话框自动聚焦问题
- 优化过渡状态判断逻辑

## [1.2.0] - 2026-02-12

### 新增
- **基于 Token 的身份认证系统**
  - 新增登录对话框
  - 认证守卫 (Auth Guard)
  - 对应的后端认证服务
- **展示模式 (Showcase Mode)**
  - 限制后端操作和配置更改
  - URL 掩码保护，提升安全性
  - 标准化的禁止访问错误提示
  - 完善访问控制检查
- WebSocket Token 验证，保障实时通信安全

### 优化
- 更新项目描述
- 优化 UI 布局，提升响应式体验
- 新增 Windows 系统检测 Hook

## [1.1.0] - 2026-02-11

### 变更
- **项目品牌重塑**：从 "Clash Master" 更名为 "Neko Master"
  - 更新所有素材和品牌标识
  - 包作用域从 `@clashmaster` 更改为 `@neko-master`
  - 清理遗留引用
- 重构 Web 应用组件目录结构，划分为 `common`、`layout` 和 `features` 三个目录
- 将 API 路由从单体 `api.ts` 迁移到专用控制器
- 引入新的 `collector` 服务用于后端数据管理

### 新增
- 骨架屏加载效果，提升用户体验
- 域名预览及一键复制功能

## [1.0.5] - 2026-02-07

### 变更
- **升级至 Next.js 16**
- 将 Manifest 迁移为动态生成

### 修复
- 确保 Manifest 正确输出到 HTML head
- 添加 Docker 开发镜像标签

## [1.0.4] - 2026-02-08 ~ 2026-02-10

### 新增
- **WebSocket 实时数据支持**
  - WebSocket 推送间隔控制
  - Service Worker 缓存，增强连接稳定性
  - 客户端推送间隔控制
- 国家流量列表排序（支持按流量和连接数排序）
- `useStableTimeRange` Hook，确保时间范围一致性
- `keepPreviousByIdentity` 查询占位符
- `ExpandReveal` UI 组件
- 自动刷新旋转动画

### 性能优化
- 优化 WebSocket 数据包大小和推送频率
- 通过批量处理提升 GeoIP 查询效率
- 使用组件记忆化优化规则链流渲染
- 节流数据更新，降低性能开销
- 基于活跃标签页的按需数据获取

### 变更
- 将数据获取迁移至 `@tanstack/react-query`，改善状态管理和缓存
- 增强 Top Domains 图表，支持堆叠流量和自获取数据
- 添加国旗字体，优化国家/地区展示

## [1.0.3] - 2026-02-07 ~ 2026-02-08

### 新增
- **交互式规则统计**
  - 支持分页的域名/IP 表格
  - 代理链追踪
  - 零流量规则展示
- **设备统计** - 专用表格和后端采集
- **IP 统计** - 详细信息展示
- **域名统计** - 支持筛选功能
- 交互式统计的时间范围过滤
- `CountryFlag` 组件，可视化展示国家/地区
- 实时流量统计采集
- 规则链流可视化支持缩放
- 自定义日期范围显示格式
- 日历布局重构为 CSS Grid 实现

### 变更
- 数据清理重构为使用分钟级统计
- 优化关于对话框中的版本状态展示

## [1.0.2] - 2026-02-06 ~ 2026-02-07

### 新增
- **PWA（渐进式 Web 应用）支持**
  - Service Worker 实现
  - Manifest 配置文件
  - PWA 安装功能
- **交互式代理统计**
  - 详细的域名和 IP 表格
  - 排序和分页功能
  - 单代理流量分解
- 数据库数据保留管理
- Favicon 提供商选择
- Docker 健康检查
- 后端配置验证
- Toast 通知，提升交互体验
- 关于对话框，展示版本信息
- API 端点：按 ID 测试现有后端连接

### 变更
- 标准化 Dockerfile、docker-compose 和 Next.js 配置中的端口环境变量
- Docker 镜像标签添加 package.json 版本号
- 自动化 Docker Hub 描述更新
- 优化仪表板移动端表格体验
- 改进滚动条和后端错误处理 UI

### 基础设施
- 新增 CI/CD 工作流
  - 开发分支清理工作流
  - 预览分支创建工作流
  - 增强 Docker 镜像标签策略

## [1.0.1] - 2026-02-06

### 新增
- 英文 README 文档
- 主 README 支持语言选择

### 变更
- 添加首次使用设置截图，丰富 README 内容
- 更新 README 头部样式，使用更大的 Logo
- 更新 Docker 部署文档，推荐使用 Docker Hub 预构建镜像

## [1.0.0] - 2026-02-06

### 新增
- Clash Master 初始版本发布
- 现代化的边缘网关流量分析仪表板
- 实时网络流量可视化
- 后端管理和配置
- Docker 部署支持
- 多后端支持
- 流量统计概览
- 国家/地区流量分布
- 代理流量统计
- 基于规则的流量分析
