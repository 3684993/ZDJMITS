# Codex P0 专项：V3.9.8 Engine 异常退出 / 失联 / 卡死的根因归因、修复与稳定性验收

> **任务优先级：P0；暂停非必要交易策略、交易记录、TP 参数及风险模型优化。**
>
> 用户明确要求彻底解决 Engine 经常崩溃/停止/失联的工程可靠性问题，目标是**可归因、可修复、可恢复、可持续观测并经现场验证**，不是将 CI PASS 或短暂 READY 宣称为稳定。**不要承诺任何软件可 100% 永不崩溃**；报告实测运行时间、故障率和残留风险。
>
> **执行纪律：先 GitHub/latest main 和本机只读取证→定位故障模式/因果链→把事实报告与实施计划提交 GitHub 并完成远端 readback→根据证据在隔离 worktree 离线修复/测试/提交 GitHub。任何部署、启动、重启、停止 Engine、改服务管理器/自启/watchdog 或实际交易所写入均须用户另行明确授权。本轮不因急于恢复自动启动 Engine。**
>
> 这份文件给 Codex 规定问题、证据与验收门禁；**不指定真实停止的根因，不授权“无证据先调整 Node/V8 flags”或循环重启猜测。**

## 1. 最新主线与必须核对的已知事实

仓库：`3684993/ZDJMITS`。从 **最新** `origin/main` 获取、核验当前 SHA、相应 GitHub Actions 和本地 worktree，不要以本文件写作时的 `50e4708f5ed738d421375f487cb2b03c8fad94c9` 为永久 HEAD。

**按顺序阅读：**

1. `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`（顶部最新状态优先，历史“RUNNING”不可覆盖顶部“offline/UNAVAILABLE”）
2. `docs/reports/v398-trade-record-integrity-20261009/IMPLEMENTATION_REPORT.md`
3. `docs/reports/v398-trade-record-integrity-20261009/FACT_AUDIT_REPORT.md`
4. `docs/reports/v398-trade-record-integrity-20261009/evidence/runtime-preservation.json`
5. `docs/plans/V398_TRADE_RECORD_INTEGRITY_IMPLEMENTATION_PLAN_20261009.md`
6. `docs/reports/v398-entry-sizing-quality-review/IMPLEMENTATION_REPORT.md`
7. `docs/reports/v398-entry-sizing-quality-review/evidence-20261008/RUNTIME_CLOSEOUT.json`
8. `docs/reports/v397-ssh-socks-remediation-20261008/REACTIVITY_DEPLOYMENT_ACCEPTANCE.md`、private reconciliation fan-out 相关 closeout
9. `docs/prompts/CODEX_DEPLOY_REACTIVITY_ACCEPTANCE.md` 和 `docs/prompts/CODEX_PRIVATE_RECONCILIATION_FANOUT_REMEDIATION.md`，以及历史 Engine `0xC0000409` / `engine.foreground.20261006-090715.log` 相关已提交的日志、原始报告和对应当时源代码
10. 当前 Engine 启动脚本、process host/launcher、Windows lifecycle/status/health、runtime logger、startup/shutdown hooks、uncaughtException/unhandledRejection、SQLite storage、worker/native add-ons、reconciliation、market/AI/scheduler、Settings CAS 审计代码，及已有最小测试。

**可靠的截至本提示词编写时事实（必须重新验证）：**

- 2026-10-09 约 07:00 +08，V3.9.8 Engine `PID8524`、instance `c685f035-1f52-48ac-80fa-998811ff3fe5`、build `3.9.8-7271c941c2cdec049610`，health READY/200；运行 **`5fe95a8` worktree 对应的已加载 src/dist**，**不是**后续 `feef659` 的交易记录离线修改，更不是最新版 `50e4708`。
- 约 07:38 +08 首次确认 8 个 GET 全部 UNAVAILABLE；PID8524 不在进程清单、8080 无监听；07:56 复核仍不可达。**停止时间的真实最窄区间须从证据重建，不能把“发现时刻”写成“发生时刻”。**
- 旧运行 `RUNTIME_CLOSEOUT` 的已知 `restartCount=276` 不是本次任务的实际重启次数，更不证明此进程刚自动重启。上轮有一次用户授权的 MANUAL_START、未启用 auto-restart；此前曾存在 `0xC0000409` 崩溃和约 6.14 秒 event-loop stall，**不证明 10/9 此次 PID 消失就是相同原因**。
- `runtime-preservation.json` 有独立 Settings CAS 变化 `247→248→…→253`；多个 summary 涉及 `message/maxPositions`。提交者/执行者和与停止的因果关系 **UNKNOWN**。要比较 timestamp、callsite/actor、CPU/内存和 process exit 事实；**不得将 Settings CAS 当成已经证实的凶手，也不可擅自回滚用户设置**。
- 上一轮离线测试曾发生 native/host OOM、384MB V8 heap OOM、proxy/jitless/Undici 冲突，修正离线命令环境后验证通过。这些是 **Codex 测试进程** 的证据，**不是 PID8524 运行时 OOM 的证明**。不得把 `NODE_OPTIONS`、heap cap、jitless、代理参数随意写入运行实例以“试修”。
- GitHub `50e4708` 对应 Actions `37862324032` 据用户报告 SUCCESS，需通过 workflow GET 的 `head_sha/status/conclusion/jobs` 重新核查；本地 2086 tests pass 与远端 225 hashes 不是 runtime uptime 验收。

**所有时间都明确写 UTC 和 Asia/Shanghai +08；按原始进程创建时间和 PID/instance/build 工作树身份归属，禁止把不同实例的 last-success event 拼成同一次事故。**

## 2. 事故分类：必须先分清“到底是哪种死机”

请不要由一个 8080 错误就断言引擎 crash。用不可互相替代的证据分开归因：

- **PROCESS_EXIT_CRASH**：Windows 进程明确异常退出，NTSTATUS/exit code、faulting module/offset、WER/Event ID、minidump/stack、fatal log 对上同一 PID 与时刻。
- **PROCESS_EXIT_NORMAL_OR_EXTERNAL**：进程结束由有据可查的 shutdown/kill/CTRL_C、终端关闭、parent/JobObject/Task Scheduler、service manager、OS sleep/reboot/update、系统策略/杀软/安全工具等引起；exit code 0 或非零均不能单独解释 cause。
- **PROCESS_ALIVE_HTTP_UNAVAILABLE**：PID 尚活但 8080 不响应，区分 event-loop block、死锁、socket/port、router/health、network/proxy/firewall/客户端解析异常。
- **RESOURCE_PRESSURE_OR_NATIVE_FAILURE**：OOM/commit limit/pagefile pressure、GPU/model/worker/native SQLite 线程/锁、resource exhaustion、access violation/0xC0000409 等要有自己的直接证据。
- **MULTIPLE / UNKNOWN**：历史不同事故可属不同类别；直接证据不足写 UNKNOWN，并明确需要补什么证据。

每次故障给出 `incidentId`、PID/parent PID/process start time、image path/build/commit、last HTTP success、last process seen、first HTTP failure、last log timestamp、Windows/Node/host exit observation、last successful subsystem/event、last in-flight task，标上各时间来源与 clock skew。产生 `INCIDENT_TIMELINE.json`、`EXIT_CLASSIFICATION.json`，对证据源“已采/未采/不可得”逐项说明。

**优先回答：PID8524 在第一次不可达之前的最后成功子系统调用/event 是什么？其随后具体在执行什么？是否有明确的异常退出记录？**

## 3. 第一阶段立即只读取证：先保存现有历史，不要先启动

在 **`D:\MITS` 和 `D:\MITS-worktrees\v398-entry-quality-20261008` 等实际项目工作树**中先检查当前 dirty、HEAD 和实际运行代码路径。尽量利用现有支持的诊断/日志采集工具，不覆盖、截断或清理历史。

- 现场状态：当前 8080 TCP listener、PID/process tree（创建时间/命令行/父进程及实例 identity）、其它 8081/8083/8084 模型/辅助端口、host parent PID、Windows uptime、sleep/reboot 更新事件；判断现状而非单凭旧 PID 宣称失效。
- 日志源：前台/后台 stdout stderr 原字节、launcher/host exit receipts、Engine structured logs、crash/termination log、Windows Application/System event log（Application Error/WER 及相关系统终止事件）、Node/V8 fatal/uncaught/unhandled traces、已有 WER dump/minidump、进程最后 heartbeat、exit/shutdown reason；对每个来源记录查找范围、总数和未取得原因。
- 时间窗至少包括**最后确认 READY→第一次确认 8080 失效**，向前增加有限上下文以定位开始异常的 tick 与最后成功 subsystem；必要时只读延伸到上一次实际启动时间。优先 Windows/EventLog 定向过滤 PID、过程 path、应用名、fault module 和时间，拒绝一次性无界导出整个 Event Log。
- 对比 Settings `247→253` 每条 CAS timestamp/summary 与系统资源、活动任务、host shutdown/exit；不访问/上传隐私 Settings payload、账户凭据、private prompt。不要凭同一秒共现认定因果。
- 回顾 historical `engine.foreground.20261006-090715.log` 和 `0xC0000409` 的事件链**仅作为“是否同类签名”的比较**。此次可能根本没有这个异常码；没有证据不能沿用旧诊断。

如果 PID 当前已死亡，**不准试图通过 HTTP、V8 profiler、process inspector 连接这个不存在的 PID**；先从离线日志、WER、event log 与 host receipt 定位。Windows 有权限限制、dump 未启用、历史 stdout 被回收，应报告 GAP 并准备**只对未来事故生效**的有界采集方案；不修改现有系统注册表、安全策略或擅自开启全量 dump。

必须审计任何候选采集脚本，避免采集器本身引发 RAM/CPU/SQLite lock：绝不再在运行中的 SQLite 上通过无限时的 online backup 卡住；不泄露 keys、token、account ID、private prompts、数据库原始内容。私有 dump/完整事件日志/数据库镜像留本机，GitHub 只上传脱敏诊断、hash/指针与可复算摘要。

## 4. 只在有证据时分析以下潜在路径（列表不是根因暗示）

以 **真实当前版本 + 出事时已加载版本** 两套代码的差异查验：

1. **Engine 生命周期与父进程**：CMD/PowerShell launcher、detached host、控制台关联、任务/服务、进程 exit handler、shutdown signal 和外部管理器；是否存在 退出定时器、supervisor、更新部署、旧进程清理、意外终止条件？是否能证明是谁发出停机动作？
2. **Node/V8/OS 级崩溃**：fatal/error code、native module、SQLite binding、worker thread、websocket、TLS/HTTP、Windows exception、堆栈/符号/源码位置；检查是否有可重复触发点。不能仅由用户曾看到 0xC0000409 就认定是栈损坏或归罪某库。
3. **内存与资源**：测试进程 vs Engine PID 的 per-process private bytes/RSS/heap/commit、host memory/pagefile/commit headroom、native allocator/SQLite/WAL/worker buffer、句柄/线程/文件描述符、模型 GPU/CPU contention 的**同一时刻**证据；与历史 host OOM 区分，不能看到可用物理内存就认为 commit 永不紧张。
4. **应用主线程停顿**：历史多秒 event-loop delay 的剩余未定位路径；当前 scheduler、private reconciliation/event fan-out、market freshness、order journal、derived history/read model、TP、settings/CAS、AI/HTTP/worker messaging/SQLite checkpoint，找每一次独立 stall 的 wall-clock start/end、上游 event、durable/derived write 分类与 blocking stack。**历史 6.14s stall 证明响应延迟，不证明进程会消失。**
5. **并发与阻塞**：SQLite busy/locking/WAL checkpoint/transaction duration、同步 JSON/stringify、全历史扫描、过量 Promise、同步 EventBus 扩散、未等待任务异常、synchronous FS 与 worker crash propagation。需要实际调用栈/时间线，不做无差别大范围重构。
6. **网络与外部资源**：gateway/SSH/SOCKS/WS/REST 的超时可导致 8080 不 READY 吗？断线是否触发异常 shutdown？没有证明不要动 SSH/SOCKS 或 8081/8083/8084 模型。
7. **已加载代码和新版本差异**：`5fe95a8` Engine 已加载 build vs `feef659/50e4708` 离线代码；**不能把未部署的新交易记录代码当作旧实例退出的原因**。只比较可证实在当前事故期间执行过的路径。

将每种候选根因标 `PROVEN / STRONG_EVIDENCE / WEAK / CONTRADICTED / UNKNOWN`，附上事件时间线、精确源码 file:line/commit、支持/反对证据与复现实验。禁止“优化某个可疑热点→没有 crash dump→宣布修复”。

## 5. 稳定性目标的三个层次

用户要求“保证系统稳定运行”，Codex 的计划必须明确区别：

**A. 找出并修复此次真正停止的根因**：关键目标。若 crash stack/host-exit 证据缺失，应先提高取证可归因性，再对有证据的代码错误做最小修复；不能假设重启就是修复。

**B. 避免“进程仍在但不能交易/不能 HTTP”的假在线状态**：进程、API、event loop、private/market truth、scheduler、TP/position、SQLite durable claim、worker 需要不同健康维度；`HTTP200`/READY 不应掩盖持续多秒 stall、订单身份 UNKNOWN 或保护丢失。

**C. 异常发生后的安全恢复**：任何 watchdog、服务托管、自动 restart、故障转储、报警、单实例 fencing/lease、跨重启恢复检查都应在 Phase B 计划中**评估而非先启用**。若未来获得独立授权考虑 automatic recovery，必须保证 TESTNET-only、单 Engine writer、真实 durable origin/exact clientOrderId、UNKNOWN 不重复提交、no-add、已持仓和 TP 保护、HUMAN_MANAGED、Production writes 0，不能盲目每隔 1 秒启动一个新交易引擎；使用退避/熔断且永久证据先落盘。任何为了 uptime 关闭防护、删除 SQLite/WAL、伪造 READY 或偷偷扩大资金杠杆，都不合格。

“稳定性”应以明确观测窗口、进程持续性、无未归因退出、可及时探测/可追溯异常、事件循环与重要交易链健康的指标来判断，不能给一个绝对永远在线保证。没有长时运行验证，状态只能 `CODE_FIXED_RUNTIME_NOT_ACCEPTED`。

## 6. 三个明确阶段门禁

### R0 — 立即保存只读事故证据，给出最新状态

- GitHub `main` / CI、`D:\MITS` dirty 状态、实际 runtime source identity。
- 截止 07:56 的现场最后成功/首次失败时间窗、PID 消失和 Windows exit code/WER 等正反证据。
- 详细 last successful subsystem/event 到第一不可达的 timeline 和每个已检索来源的覆盖/缺口。
- 区分此次“进程结束”与旧 `0xC0000409`、历史多秒 stall、离线测试 OOM 的关系，不能推断为同一故障。
- **未取得根因证据时，不继续更换 Node/V8 参数、没有依据地全仓加 try/catch 或无界性能调优。**

### R1 — Codex 自己制定、先提交 GitHub 的事实报告及实施计划

在开始改业务源码前，将以下文件**提交 GitHub 并远端 readback 核验**：

- `docs/reports/v398-engine-stability-p0-20261009/INCIDENT_FORENSICS_REPORT.md`
- `docs/plans/V398_ENGINE_STABILITY_P0_IMPLEMENTATION_PLAN_20261009.md`
- 同报告证据目录：`INCIDENT_TIMELINE.json`、`EXIT_CLASSIFICATION.json`、脱敏日志/进程/Windows 事件目录、source map、调查覆盖表、未取得/风险证据、manifest 与 hash，以及如有安全可部署的**未来崩溃取证**设计说明。

实施计划由 Codex 根据证据制定：根因/备选假设、文件级最小修改范围、如何验证/复现、隔离执行步骤、故障存活/故障恢复、影响交易安全之处、数据与日志保留、长期验收的停止条件。**没有明确根因时可先提出最小化的诊断增强实施，不得把 `UNKNOWN` 写成“问题已找出”；必要时向用户说明还需要经过单独许可的受控前台捕获。**

必须先普通 FF commit/push，确认远端已保存并逐 hash readback，再进入 R2 源码实施。远端 main 变化必须协调，不 reset/stash/clean/force push。记录 CI；CI 未完成不能写 SUCCESS。

### R2 — 有依据的离线修复及验证（不触碰 live Engine）

在隔离 worktree 中按 R1 实施经证据支持的最小修复、测试和有界诊断；对 Windows/process-host、异常处理、SQLite、workers/事件循环的改动应具有可证伪的前后测试，不凭“没有复现”当 PASS。重点测试：

- fatal/exception/exit cause 与 last successful subsystem/event 的可追溯性；
- 同一 PID/instance 与 parent exit、意外被杀、失去监听、event-loop 卡住、数据库忙、native/worker error、资源压力的**独立**状态分类；
- 日志写入容量/保留/脱敏、磁盘满或写入失败不形成新 crash cause；
- 并发/SQLite WAL、重启恢复、原始订单 UNKNOWN/idempotency、一次性原始建仓 cap/no-add、HUMAN 及原 TP 保护；
- TESTNET-only；Production writes 0；健康退化不误认为物理仓位为零、不利用降级状态发额外订单；
- 不把卸载或新版本代码的测试结果拼成已运行实例验证。

执行仓库认可 targeted tests、`npm run verify` 包含 S00/typecheck/build/workspace tests，所有实际 logs 与失败日志完整脱敏归档。源码与实施报告普通提交 GitHub、remote readback/Actions 核验；状态须清楚写 `SOURCE_READY_NOT_DEPLOYED` 或 `DIAGNOSTICS_READY_NOT_DEPLOYED`。

### R3 — 单独授权后的现场复核与可靠性接受（本提示词**不自行授权**）

即使 R2 通过 CI，**禁止立即盲目再次启动**。Codex 需要列明以下待授权事项：Windows WER/trace 安装或配置、是否允许单次前台诊断启动、是否允许一轮新 verified Engine 部署、是否允许长时自动观测与受控恢复，及可预期的资源成本。用户明确批准具体范围后再执行。

未来经批准的现场验收须至少包括：

1. 用已获批准的 verified SHA/build **一次受控启动**，start/exit/instance/parent identity、stdout/stderr 与 OS 退出事件日志闭环；不重用旧曾崩溃的源码来冒充新版接受。
2. 启动后分离 startup 与稳态时段，连续健康和日志观测；包含 PID 存在、8080 health/closeout、真实 TESTNET/private/market freshness、TP 保护、order claim、scheduler/event-loop latency、内存/Windows commit/handles/worker/SQLite锁，且 no-add/Primary/HUMAN/Production 0 全程成立。
3. 短时 5–10 分钟即时接受只是**初筛**。要评价稳定运行，至少应提交明确的一次连续稳态时段（例如 24 小时）的事实观测、异常次数及覆盖率、归因闭环；是否开启长窗口需用户另外批准。任何意外退出/长时间不可达、无法解释的重要订单状态 UNKNOWN 或 TP protection gap 都使相应验收 FAIL，而不是以最终恢复 READY 洗掉中途失败。
4. 如果自然事故再次出现，先保存原进程可关联 fault dump/exit code/last event，不自动无界重复重启，不制造 TESTNET 订单或人为故障；回到当前证据，精确定位并提交下一修复计划。即使未来计划保活，也不能让自动恢复掩盖根因或造成重复委托。

## 7. 全程不可突破的交易与系统硬边界

- **Primary 唯一 Entry authority；禁止同 symbol + positionSide 的独立补仓**；反向仓机会在账户 hedge/资金合法前提下可分析，不额外 Entry veto。
- TESTNET-only、Production writes 0；资金/交易所合法性、私有 WS 订单真相、公共 WS 行情真相、原始 clientOrderId/交易所订单 identity、UNKNOWNS、TP 与人工管理权限完全保留。
- 运行 Engine 可能已离线，离线不等于让 Codex 自行部署/重启；旧 `D:\MITS` dirty 六项保留，数据 junction 和 live SQLite/WAL/TradeRecord/订单历史不可删、reset、迁移、清空/重建；不停止 8081/8083/8084、模型或 SSH/SOCKS。
- 不修改 Settings、自动审批、生产网络认证或泄露凭据；不改变风险倍率、杠杆、交易机会过滤、TP 距离、Qwen 模型或 proxy 参数来“掩盖”进程问题。此前 F04/F10/F11 保持暂停。Reactivity 可在本**稳定性专项目标内**只就其与实际失联或可证实多秒停顿的链路调查，不顺带重新开启历史宽泛微调。
- 内存 dump、完整 SQLite 备份、私有 API、堆快照/完整用户消息及私有 prompt 仅存本机受控路径；GitHub 公共仓库只放脱敏结构、可复算数据、事件时间、哈希和私有文件的安全 locator。此前策略拒绝删除的私有备份继续按合规保留，不绕过删除 policy。
- 命令全部把完整 stdout/stderr 输出到文件，终端仅短摘要/绝对文件名；无需用户复制冗长控制台。
- 若证据表明是 Windows/host/外部 kill，必须据此定位外部条件，不以随意修改 JavaScript 源码宣称已修；若跨越该任务权限，明示 blocker，并提交未来安全捕获方案。

## 8. Codex 给用户最终汇报

简洁报告：当前 main/CI、`PID8524` 最后成功与消失的带时区时间线、`0xC0000409` 是否真的在此次重现、Windows exit/WER/stack 或 host stop 证据、Settings CAS 谁做的（如证据足够）、此次退出与 event-loop stall/离线 OOM 的关系、已排除和 UNKNOWN、根因确定等级、报告及计划 GitHub URL/commit/hash、修改与测试的实际结果、运行/部署是否变化。

**最后状态禁止使用泛化“稳定修复完成”**。明确列出 `FORENSICS_ONLY`、`OFFLINE_FIX_VERIFIED`、`RUNTIME_ACCEPTANCE_PENDING` 或 `RUNTIME_STABILITY_ACCEPTED_FOR_WINDOW`；后者必须有用户批准的真实连续运行窗口和足够的 telemetry，不能用 CI、单次 READY、自动重启后存活几分钟冒充。

**现在从 R0 开始，不许先重启。先取证、定位；保存 GitHub 计划后才离线改动。**
