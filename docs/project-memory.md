## 2026-10-10 网络 N0/N1 离线交付（未部署）

独立分支 codex/v398-network-n1，基线main3cb72de。已完整读取网络任务书/方案及Issue23；N0两组60s窗口证明全市场BBO/mark/ticker类别占decoded载荷79.49%/79.89%，不是节省率或SSH wire字节；SSH积压及私有typed-event现场证明UNKNOWN。N1更新官方Demo默认及PUBLIC/MARKET/PRIVATE显式路由，跨环境/非官方/携密钥配置fail-closed，旧主机必须显式迁移而非451后静默切换；pong与账户订单事件指标分离。原代理两次15s Demo只读订阅各有bookTicker24/markPrice13事件，私有Demo真实兼容仍待正规授权验证。

本轮 npm ci/full npm run verify PASS252files/2180tests，focused74；S00首次因默认值身份变化停止已保留，更新当前hash后PASS，历史快照未改。N2量化/设计及N3故障预算风险与recvWindow恒60000缺陷已记录，下一独立PR按保护保留集/ACK及REST签名mock展开，不能宣称所有优化结束或451根因修复。详见 docs/reports/v398-network-optimization-20261010/NETWORK_BASELINE.md / VALIDATION.json。

重要现场纠正：原24h已于08:34:00.270+08 LOCAL_TP_GATE_NOT_CLOSED中止，local14/15；08:41:50 local15/16，08:43:55 local17/17恢复、private9.129s、Production0。恢复缓存不能恢复验收或替代签名TP。原PID23688/buildbb45保护运行，Engine/代理/模型/observer/任务/授权/Settings/数据库/SSH配置均未改。Issue22已同步中止。禁止补仓、UNKNOWN/60sTTL/Primary及TP均保留；Issue23真实订单origin归因仍未在网络任务完成。全部部署须新指令及正规准入，新验收完整重计。

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
