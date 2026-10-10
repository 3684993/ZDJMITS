# 2026-10-10 09:35+08 之后的新实施进度 — 性能仪表盘首批实码已在GitHub分支

**最新优先交接**：本轮 ChatGPT 已核对原始验收ABORTED证据并提交了真正可接入真实OS/Engine只读数据的首批性能驾驶舱到 GitHub branch [`chatgpt/v398-performance-real-metrics-d0-d2-20261010`](https://github.com/3684993/ZDJMITS/tree/chatgpt/v398-performance-real-metrics-d0-d2-20261010)。**还未合并main、未本机npm测试、未部署、也未开启模型负载借用。** 
- **直接Codex任务指令**：[CODEX_V398_GPU_PERFORMANCE_DASHBOARD_PHASE1_20261010](./prompts/CODEX_V398_GPU_PERFORMANCE_DASHBOARD_PHASE1_20261010.md)；**实施执行板**：[V398_GPU_PERFORMANCE_EXECUTION_BOARD_20261010](./plans/V398_GPU_PERFORMANCE_EXECUTION_BOARD_20261010.md)；**真实源码交付收据（未验证）**：[CHATGPT_INITIAL_CODE_DELIVERY](./reports/v398-performance-dashboard-20261010/CHATGPT_INITIAL_CODE_DELIVERY.md)；主任务Issue[#30](https://github.com/3684993/ZDJMITS/issues/30)。
- 已提交实码：Engine Native CPU/RAM/EngineRSS/heap轻量采样+只读`/api/v3/observability/performance/host`；Dashboard Vue3/ECharts5 `/performance` 中文页面、AI/私有同步/代理红黄绿灰灯、真实有限AI run统计、主机实时趋势和交易TP/收益现有可信快照。GPU/PCI/VRAM、真实token/s/SSH wire流量证据未取得，明确展示UNKNOWN而非伪造；须由Codex接下去实测补采样/测试/CI。GPU2 Review/Primary跨角色借用需后续独立统一原子capacity lease PR，不可只改route。
- **验收状态重要更正（证据优先）**：`main` 中 `docs/reports/v398-engine-cutover-20261010/acceptance/state.json` 08:24的RUNNING已过期。PR#25分支的 `docs/reports/v398-network-optimization-20261010/acceptance-aborted.json`、`acceptance-abort-checkpoint.json` 是原监控副本，证实 **2026-10-10 08:34:00.270+08 原24h验收ABORTED_SAFETY_FAILURE / LOCAL_TP_GATE_NOT_CLOSED**，本地TP14/15 missing1，private15.952s，Production0。后来本地TP缓存17/17不等于所有当前仓位新鲜签名验证，原验收**不可恢复、续算或判PASS**。仍不得为了dashboard/模型利用率而先重启安全保护Engine；先只读验证最新TP身份和当前新attempt。
- 网络并行开放PR [#25](https://github.com/3684993/ZDJMITS/pull/25) Demo WS routing、[#27](https://github.com/3684993/ZDJMITS/pull/27) REST recvWindow/weights、[#29](https://github.com/3684993/ZDJMITS/pull/29) scoped mark feeds；各自CI已通过但未merge/deploy。本轮不要误把这些来源当前main；HTTP451及地理限制不等于代理BUG，禁止绕过。
- 接下来由Codex独立worktree修复本分支所有TS/Vue/类型/样例不足，单测/full verify/S00/CI、物理bus19/bus22→PID/8083/8084 mapping30–60m真实任务基线、Windows GPU sampler/数据合同/模型任务归因，再分独立G1原子lease、R2 TP SHADOW小PR。所有报告、测试记录、脱敏截图都必须在GitHub `docs/reports/v398-performance-dashboard-20261010/`，不能只放本机；原始秘钥/私有订单/数据库例外严禁上传。NO_SEPARATE_ADD、Primary唯一Entry、HUMAN_MANAGED、TP、Production0依旧优先。


---

## 2026-10-10 新聊天入口：v3.9.8仪表盘性能优化（GPU2利用率及统一驾驶舱）

- **主新ChatGPT提示词**：[CHATGPT_V398_PERFORMANCE_DASHBOARD_GPU_NEXT_CHAT_20261010](./prompts/CHATGPT_V398_PERFORMANCE_DASHBOARD_GPU_NEXT_CHAT_20261010.md)。
- **完整实施计划**：[V398_DASHBOARD_GPU_OBSERVABILITY_AND_PERFORMANCE_PLAN_20261010](./plans/V398_DASHBOARD_GPU_OBSERVABILITY_AND_PERFORMANCE_PLAN_20261010.md)。
- **Codex任务**：[Issue #30](https://github.com/3684993/ZDJMITS/issues/30)，关联Issue #26 (双RX7900XTX 27B物理负载与统一原子lease)、#28 (持仓/挂单/TP Review SHADOW)、#24 (Binance REST/WS/SOCKS)、#23 (ENA“补仓一次”原始订单身份)。
- **实际源码已核实：** Dashboard Vue3 + Pinia + ECharts5 + Vue Router；现有Overview/Operations/Brain及EquityChart、/brain/resources、/brain/runs、/diagnostics/binance-governance、/diagnostics/market-stream-traffic、/diagnostics/private-sync、/observability/entry等可复用。当前缺真实物理PCI↔模型PID8083/8084↔GPU利用率与主机内存的已验证绑定、统一历史曲线数据合同和跨代理/LLM/交易时间轴；须先只读证实而非以模拟指标掩盖。
- **功能**：新增中文“性能监控”页面（/performance），CPU/内存/EngineRSS、B580+双RX7900XTX VRAM与GPU、Scout/Primary/Review的请求状态与tokens/s/queueP95、代理SSH/SOCKS/HTTP状态/451与private freshness、REST/WS、真实Primary→Intent→Order→Fill→TP→Exit漏斗、持仓时间/Review/退出、手续费/资金费/realized与unrealized盈亏、UNKNOWN账务，交互图表和15m至7d窗口。直接使用ECharts5，低开销read-only采样与同实例时间戳，不引入浏览器到交易所私有直连。
- **优先级**：D0数据字典/物理PCI进程映射和真实30–60分钟自然任务基线；D1本机受限Windows CPU/RAM/GPU/模型指标sidecar采样且与Engine只读诊断统一；D2真实可用新视图；D3两27B原子capacity lease、空闲借用和挂单/持仓Review，TP目标仅SHADOW；D4专项回归/完整verify/CI。必须提交实码/测试/PR，不能永远只交审计文档。
- **部署边界**：截至原回执Engine3.9.8-bb45c11 PID23688，24h T0 2026-10-10 08:16:49.685+08，原定结束10-11 08:16:49.685+08，最新验收状态需只读回读；未确认PASS不得声称成功。**此GitHub文档任务不修改现网Engine、模型、代理或TP、不重启/部署、不改Settings253**；真实改运行需用户另行授权并遵守验收重新计时。硬约束TESTNET、Production0、严格NO_ADD禁止补仓、Primary唯一Entry、HUMAN_MANAGED、签名TP身份和UNKNOWN fail-closed。历史451不无证据重标代理故障，更不能轮换地区出口规避。

## 2026-10-10 持仓/挂单管理与第二个27B Review职责优化

源码实查方案：[V398_GPU2_POSITION_PENDING_TP_REVIEW_OPTIMIZATION_20261010](https://github.com/3684993/ZDJMITS/blob/main/docs/plans/V398_GPU2_POSITION_PENDING_TP_REVIEW_OPTIMIZATION_20261010.md)；执行任务：[Issue #28](https://github.com/3684993/ZDJMITS/issues/28)，与[双GPU容量调度Issue #26](https://github.com/3684993/ZDJMITS/issues/26)以及[网络Issue #24](https://github.com/3684993/ZDJMITS/issues/24)共同实施。

结论：当前Engine负责全部仓位/挂单事实、持仓FIRST_FILL时间与管理deadline、5s TP Guardian/15s reconciliation、Entry pending外层2s tick。默认nearMarket TTL90s/改价5s/最多6次，但实际Settings253未独立核实；27B Review8083的pending第一次调用>=15s/以后间隔>=30s，提出KEEP/CANCEL/REPLAN，后两者精确查旧双ID再撤单，不自动新开仓。持仓Review15s tick但有plan/owner/minInterval/预算限额，PositionReviewV396仅HOLD/REDUCE_PROPOSAL/EXIT_PROPOSAL/HANDOFF，**不允许模型给任意新止盈价或数量**。TP Guardian发现WORKING且数量/方向匹配时直接保留现价，不进行常态化动态调整；只有创建/修复进入价格选择与严格原订单撤销/替换。AI Exit代码默认为OFF，实际需查Settings。

R0只读GPU2 utilization/task/no-plan/owner/queue原因与真实持仓、挂单age; R1离线同origin单action lease及模型任务deadline；R2独立TP_TARGET_REVIEW_DRY_RUN只从合法冻结目标ID选择，先SHADOW，**不能写交易所或取消原TP**；R3与Issue26统一单GPU maxConcurrency=1原子容量租约，角色保持Primary独立Entry；R4专项TP/NO_ADD/UNKNOWN/partial fill/HUMAN_MANAGED测试和完整CI独立PR。严格禁止补仓；ENAUI“补仓1次”身份仍待Issue23核对。**当前24h验收期不部署、不改Settings/代理/模型/TP，不重启Engine**，如将来获批变更则完整重新计时。
## 2026-10-10 双27B GPU占用失衡专项（静态审计/离线优化，未部署）

方案：[V398_DUAL_27B_GPU_UTILIZATION_AND_DUTY_SCHEDULING_20261010](https://github.com/3684993/ZDJMITS/blob/main/docs/plans/V398_DUAL_27B_GPU_UTILIZATION_AND_DUTY_SCHEDULING_20261010.md)。Codex任务：[Issue #26](https://github.com/3684993/ZDJMITS/issues/26)。默认Settings固定8084/27B为ENTRY_PRIMARY，8083/27B为POSITION_REVIEW/PENDING_ENTRY_REVIEW，各maxConcurrency1，当前不是真正两卡负载均衡。实际物理PCI bus19/bus22→8083/8084进程必须先只读核对，不能猜。源码aiFabric.dutyResources只会返回每职责已配置资源；choose不能跨角色借用；queueReview用reviewActive而Primary run另用load.active，**不能直接加候选路由形成超额GPU并发**。按G0现场指标与模型hash/ctx等价性、G1离线统一perGPU原子lease和overdue Review保护、G2离线压测/CI后独立PR，只有另行获用户授权才部署；不得干扰当前24h验收、Engine/两个模型/代理、Primary唯一Entry、禁补仓、HUMAN_MANAGED、TP保护和Production0。

## 2026-10-10 新任务：Binance REST/WS/SOCKS通信专项审计与离线优化

完整审计实施方案：https://github.com/3684993/ZDJMITS/blob/main/docs/plans/V398_BINANCE_NETWORK_COMMUNICATION_AUDIT_AND_OPTIMIZATION_20261010.md
Codex执行提示：https://github.com/3684993/ZDJMITS/blob/main/docs/prompts/CODEX_V398_BINANCE_NETWORK_COMMUNICATION_OPTIMIZATION_20261010.md
任务登记：https://github.com/3684993/ZDJMITS/issues/24

已静态核实：全部Binance的PUBLIC行情/PRIVATE签名REST与PUBLIC/MARKET用户WS经统一SOCKS5H代理，并非公共API直连；三个本机GPU模型不经交易所代理。BinanceMarketStream当前订阅全市场!bookTicker、!ticker@arr、!markPrice@arr@1s及按币种depth/kline/aggTrade，可能带来SSH流量冗余；实际需取/api/v3/diagnostics/market-stream-traffic 60s decoded bytes、proxy TCP backlog证明，未取得实时wire bytes，不得估算节省。

2026-10-09官方USD-M WS路由迁移文档明确/public、/market、/private；官方Demo WS根=demo-fstream.binance.com。当前config默认仍为stream.binancefuture.com/ws，BinanceTransport会将market/public改写至fstream.binancefuture.com，而BinanceUserDataStream默认使用未路由的/ws/listenKey。必须首先离线核实PRIVATE实际协议可用性，签名REST为权威、订单双ID、TP和60s TTL不削弱。请求budget已有priority/429/418控制、深度recover与WS仅请求非ACK的订阅状态也要专项测试。ExternalTradeAdapter签名recvWindow表达式疑似固定60s，须离线契约核查。

只读N0/N1、离线独立PR N2/N3；**目前不要部署或重启PID23688，不改VPN服务器/出口地区/Engine授权/Settings**，保持已开始的24h验收。历史HTTP451未在发布20次有界GET中复现，不可自动当作代理脚本故障或通过更换出口规避；任何实际351/451/429/418/502/503按来源分层。严格禁止补仓、Primary Entry、HUMAN_MANAGED、Production0规则不变。
## 2026-10-10 代理451与正式发布经验 — 文档补充

已核实最新 Engine 23688 / build 3.9.8-bb45c11，单次受控切换，身份6/6，20次有界GET均200，发布时签名TP12/12、后续本地缓存13/13、Production0。24h验收于08:16:49.685+08开始，目前RUNNING而非PASS。

详细经验：[网络代理/451/发布收尾报告](./reports/v398-engine-cutover-20261010/NETWORK_PROXY_451_RELEASE_LESSONS_20261010.md)。Windows本机SOCKS5H:20091经SSH:22091到Ubuntu出口；本次未修改代理脚本、未切换出口。公共GET 200、签名账户canTrade和实际地区资格各有不同证明力。历史451未在本次20次GET复现，不可预设所有451为SOCKS脚本故障；按TCP/SSH/SOCKS/TLS/HTTP/PRIVATE逐段调查，禁止绕开交易所地区限制。

ENAUSDC在08:21起的原订单PARTIALLY_FILLED期间，界面显示累计补仓1次。源代码positionLifecycleTracker在仓位数量增加时addCount++、前端cycleMoments将lastAddAt标为“最近补仓”，故可能只是同一初始订单分笔成交而非第二独立Entry。实际订单双ID仍须只读复核：[Issue #23](https://github.com/3684993/ZDJMITS/issues/23)。严格禁止补仓依旧，不因界面标记未经核实而重启保护Engine；PR19旧90分钟与当前新24h证据隔离。
## Actual TESTNET deployment and new 24h — 2026-10-10 08:24+08

DEPLOYED / RESTARTED / IDENTITY_CLOSED_6_OF_6 / ACCEPTANCE_24H_RUNNING, not PASS. Latest user instruction accepted existing Singapore proxy access as OPERATOR_ATTESTED release basis; independent official eligibility is not claimed and any future451 retains its actual response meaning. One formal Engine-only stop18100/start23688 (host26576), no retry/policy bypass. Frozen release D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd contains latest fetched main362355e runtime code; source9d9f1d0/artifactbb45c11/build3.9.8-bb45c11acbe9819a3456 and Settings253 match actual running identity. Fresh signed baseline12/12 exact TP, V2 canTrade=true, private7.016s, Production0; later08:23 local verified cache13/13 reflects natural activity, not a new signed13/13 claim. Twenty bounded exchange GETs all200/no451/502; no manual orders or forced model calls. Models/proxy unchanged, new hidden observer24540, reboot action updated without running it. Full local verification251/2157 and exact main362355e CI38003230433 SUCCESS already passed; actual build/staging and immediate verified SQLite rollback backup completed.

New T0 2026-10-10 08:16:49.685+08; deadline2026-10-11 08:16:49.685+08. Hidden read-only task samples every60s; updated heartbeat zdjmits-v398-24 follows every30min and syncs GitHub hourly/milestone/failure/end. Baseline is immutable, checkpoints append; user STOP or safety failure aborts attempt without stopping protective Engine. Repair/redeploy requires a complete new24h. Final signed safety and eligible-candidate/Primary funnel review required before PASS. Four dependency advisories/intermittent transport reliability remain open. Full receipt: docs/reports/v398-engine-cutover-20261010/DEPLOYMENT_RECEIPT.md; evolving canonical state: docs/reports/v398-engine-cutover-20261010/acceptance/state.json. All preceding STAGED/NO_GO/NOT_STARTED and old PID entries are timestamped historical evidence superseded by this actual execution.

# 项目维护记忆

## Issue22 actual staged release — 2026-10-10 07:10+08

STAGED_READY / NO_GO; sole externally missing fact is official actual-account/region Futures Demo eligibility (source/time/scope). Frozen release D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd: locked install and full build exit0, artifactbb45c11 exactly reproduced, source9d9f1d0 (one CRLF/LF difference vs prior04af474; normalized source identical).1923 per-file hashes verified/sealed, Git clean. Independent identity approval prepared/inactive, old approval unchanged; SQLite online backup1,034,747,904 bytes/quick_checkok and private rollback snapshots complete. Native formal-host probes PASS; no lifecycle/policy bypass, not proof of future action-time approval. Old Engine18100 remains;07:10 local private age3673ms, local TP12/12, Production0. Earlier signed13/13 is historical. No repeated tests/exchange probe loop or24h start. [Preparation receipt](./reports/v398-restart-execution-20261010/issue22-preparation/PREPARATION_RECEIPT.md) and cutover plan have precise paths/hashes/rollback requirements.

## Latest immediate restart execution — 2026-10-10 06:21+08

Fetched exact main d41c9df; exact-main CI37997259184 SUCCESS. Six fresh bounded TESTNET GETs all HTTP200; signed exact TP13/13, private age610ms, Production0. New SOCKS/TLS/public response succeeds1.303s; previous06:02 timeout remains historical unresolved intermittent counter-evidence. Old Engine18100/build6cd926 remains; no lifecycle attempted, no fresh policy denial, no new deployment or24h T0. Actual-account/region lawful eligibility still UNKNOWN; Chrome connector failed, official confirmation requested without re-requesting restart authorization. Existing old artifact approval cannot authorize candidatebb45c11. [New execution receipt](./reports/v398-restart-execution-20261010/EXECUTION_RECEIPT.md) contains actual results, sanitized host/TP evidence and remaining formal gates. Earlier latest-status entries below are preserved timestamped history.

## Current continuation PR21 / 24h pre-start — 2026-10-10

Latest06:02 bounded refresh failed at first public time GET after8.016s; prior05:47 signed TP13/13 is preserved as a historical sample, not a current release pass. No retry/lifecycle. Eligibility remains UNKNOWN; 24h NOT_STARTED/T0=null. PR21 merged by normal fast-forward at 8cd63a0; exact push/PR CI37996114153/37996120547 SUCCESS. Final local verify251/2157 and four Engine shards216/1966 PASS; dependency audit11→4 unresolved ECharts/Vitest advisories. Actual old host receipt and source/artifact hashes match Engine18100, but new candidate buildbb45c11 is not deployed. See new report for current vs historical policy evidence.



PR20 is merged at fetched main57c42dc. PR21 plus fix source `8cd63a0f13f3260b3faa986b89959cfb090d6844` passes local locked install/full verify (251 files/2157 tests). Hidden reboot recognition is strict; new CI is read-only and runs full verify without the legacy migration. Exact CI/merge readback: [receipt](./reports/v398-controlled-release-24h-20261010/EXECUTION_RECEIPT.md).

Live old Engine18100/build6cd926 remains. Private sync recovered; fresh signed GET exact TP13/13 passes dual IDs/side/reduceOnly/remaining quantity/local price. Production0, audit exchange/lifecycle/Settings writes0; observer17772 and silent tasks intact. Official actual-account/region eligibility remains UNKNOWN; a new identity-bound release approval and current formal action checks are still required. **NOT_DEPLOYED; ACCEPTANCE_24H=NOT_STARTED; T0=null.** New user24h/abort/full-reset rules replace the previous90min duration. Historical entries below are time-specific.


## 2026-10-09 V3.9.8 本机 P0 接力

权威回执：[LOCAL_EXECUTION_RECEIPT_20261009](./reports/v398-proxy-network-p0-20261009/LOCAL_EXECUTION_RECEIPT_20261009.md)。修复源 `0399eff5e601723c249ff6f6b70c59a23cb8dd22`；最终全量验证以同目录 `local-20261009/verify-green-result.json` 为准，PR/CI 必须查询最新 SHA。

Windows 已识别的周期弹窗源是两个 Interactive 5min Node task。8个 ZDJ task 仅更新 Action 为隐藏 WScript launcher；保留原 XML、命令/触发器/principal/disabled 状态，永久目录 `D:\MITS-OPERATIONS\silent-tasks-20261009`。Launcher 必须一行 Shell.Run、独立一行 WScript.Quit，wait=true且传播退出码；测试证明无可见 child console，实际定时观察+被动审计均继续成功。不要停安全监控来消除窗口。

现场 Engine 仍旧 build/PID18100；私有事实过期、SOCKS deadline失败。TP本地13/13不是当前exchange signed证明。代理账户 `MaxSessions=0` 禁止 shell；不能据此改ssh配置或冒充本轮Linux样本。451资格UNKNOWN必须官方确认。未部署、未重启、90min新版验收NOT_STARTED；旧观察器的build白名单必须在正规发布后更新。禁止绕policy、地区限制、独立补仓、Production、风险/TP/freshness减弱。

主机根目录 `D:\MITS` dirty且保留；本轮用隔离 worktree。原PR20资源说明断言失败已修复，PUBLIC/MARKET计数使用一次快照时间；decoded bytes不是SSH wire，也不含PRIVATE/REST。所有可发布回执/日志/任务备份在GitHub，钥匙、DB、账户原始事件及dumps留本机。
