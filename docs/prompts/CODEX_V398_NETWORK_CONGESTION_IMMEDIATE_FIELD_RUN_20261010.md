# Codex 现场立即执行｜v3.9.8 网络拥堵修复、真实部署与服务恢复（2026-10-10）

> **执行而非建议。** 操作者已授权在本仓库对应的 Windows / Ubuntu TESTNET 环境完成必要代码修复、PR/CI/合并、发布、按需重启、私有核验和 30 分钟 + 90 分钟自然负载验收。此文件是新增执行入口；原计划、安全约束及主执行书优先共同生效。不能调用未来或未授权权限；平台明确拒绝即留痕并报告 BLOCKED，不得改用隐蔽渠道绕过。

## 0. 立即同步（Codex 在有 Windows 终端与 GitHub 权限的执行环境中亲自运行）

仓库 `3684993/ZDJMITS`，Windows 常用目录 `D:\MITS`。先运行（不要改动现有 dirty 工作树）：

```powershell
Set-Location 'D:\MITS'
git remote -v
git status --porcelain=v1
git fetch origin main 'chatgpt/v398-network-congestion-codex-field-20261010' 'chatgpt/v398-ws-retained-stream-congestion-p0-20261010' 'codex/v398-proxy-lifecycle-20261010'
git rev-parse origin/main
git show origin/chatgpt/v398-network-congestion-codex-field-20261010:docs/prompts/CODEX_V398_NETWORK_CONGESTION_IMMEDIATE_FIELD_RUN_20261010.md
git show origin/main:docs/plans/V398_NETWORK_CONGESTION_ENGINE_ISOLATION_RECOVERY_20261010.md
git show origin/main:docs/prompts/CODEX_V398_NETWORK_CONGESTION_EXECUTE_20261010.md
git show origin/main:docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md
git show origin/main:docs/project-memory.md
```

如本地 git 与 GitHub 不一致先辨识原因，保留现场 D:\MITS 下未提交数据、Settings、运行 SQLite、密钥。代码工作限用独立 worktree / branch；禁止 reset --hard、clean、覆盖 live 数据。GitHub 计划此前记录 main `ef00780c`，2026-10-10 22:12+08 本轮读到新的 main `0962181c43eb09e007d4b5695193e62dfce92447`（新增网络计划等文档）；启动前**必须再刷新**，不要假设该 SHA 永久最新。

## 1. 首轮必须核对的历史事实

- Engine ON 时 Binance Demo public/time 0/8、SOCKS CONNECT 超时，Ubuntu sshd Send-Q 约 2.7 MB；Engine OFF 而相同 Windows ssh.exe PID12212 保留时，public/time 4/4 HTTP 200，远端 12 次 Send-Q 采样有 11 次 0、一次 4496B。这是高度相关、非单变量因果证明。
- 60s WS 应用解码数据：MARKET 3.974 MiB / PUBLIC 0.586 MiB；全市场 ticker 1861.1 KiB + mark 1829.9 KiB，占 decoded payload 约 81%，**不是 SSH/TCP wire bytes**。
- 历史 Engine PID13476 / release `D:\MITS-RELEASES\ZDJMITS-v398-cockpit-e3dc48b` 已在隔离实验前确认 OFF；不要向过期 PID 下发停止。实时 Engine/host/observer、proxy PID、Ubuntu ssh session 和模型进程须重新只读扫描，不能假定 PID12212 仍在。
- PR #42 `c9cd14c572851dda581cc84d66a3ddbfd4d0ed9d`（Draft，尚未合并），exact-head Actions #38057726621 为 SUCCESS；PR #41 `f1f5d9c7863d6be3f6aef1a451a4cb90a556ea1d`（尚未合并，GitHub 报 mergeable=false），exact-head Actions #38055343428/#38055340946 SUCCESS。当前 main #38058318629 本轮读取时仍 IN_PROGRESS。Codex 须刷新 PR 状态、HEAD、冲突、CI 以及 main HEAD，避免凭旧状态合并。
- 真实 TESTNET 账户/仓位/openOrders/openAlgoOrders、TP 双 ID 与最新签名覆盖仍 **UNKNOWN**；public GET 成功绝不视为 PRIVATE READY。

## 2. 现场检查→修复→合并，立即实施（不要停留在文档）

A. **PR #42 优先**：检视 `BinanceMarketStream.ts` 单 symbol `@ticker` / `@markPrice@1s` 事件格式、LIST/SUBSCRIBE 回执 ACK、订阅成功证据、断线重订、缩容、冷启动、恢复节流，PUBLIC 与 MARKET **各自每连接 <=1024 streams**，安全处理 160/191/239+ cohort 的界限，保证持仓、待成交、挂单、BTC/ETH 基准与候选的必要标的。quote `bid/ask/mark/last` 各字段真实 freshness，不得仅通过收到消息更新时间假冒全字段新鲜。验证发现路径独立 REST `/fapi/v1/ticker/24hr` 单飞/60s缓存与真实 request weight，避免每 symbol 额外 REST 放大；不牺牲候选召回。不以本地 WS 丢包代替真正上游取消全市场订阅。若当前 Draft 未达到安全条件，修复测试/实现后再次 exact-head CI、审查再改 Ready/合并。

B. **PR #41**：逐项检查 GUI 配置保存/本地 SOCKS listening/真实 SOCKS CONNECT + TLS/延时排队四种不同证据状态。检查周期健康探测是否拥塞时洪泛、guardian Restart 后是否恢复、锁/身份校验/鉴权/审计/脚本路径、PowerShell 5.1 UTF-8 BOM/ASCII 兼容以及和 #42/main 的冲突。保持无直连 fallback；有冲突先 rebase 或 merge base 安全解决并重新测试 exact HEAD，不因为此前绿 CI 忽略新 HEAD。

C. 若减负后仍有 MB 级 Send-Q：以**同一业务窗口**先度量并再评审 PUBLIC `!bookTicker` 改按保留 symbol `@bookTicker`；REST admission/class/lane/capacity/failurePhase、SOCKS greeting/CONNECT/TLS/FIRST_BYTE、SSH Send-Q/notsent/RTT/retrans、代理 guardian/连接复用、Background KLINE/backfill vs private/TP 优先级。修可证实故障：并发硬上限、队列 age、私有优先、背景低优先和退让、single-flight、带抖动有界 backoff，禁止 UNKNOWN POST 直接重试、不得强行拉长私有 TTL 或简单延长超时掩盖故障。先削流验证，不能未经证据修改 Ubuntu `sshd` 配置、出口 IP/地区、SSH key、安全策略；若验证同 SSH TCP 的 HOL 确属瓶颈，另行审计同一授权出口的隔离代理方案，不自动切生产。

D. 源码必须有 focused/regression/负载与故障恢复测试；运行 `npm ci`、`npm run verify:ci`、S00、PowerShell 语法回归与确切 GitHub HEAD 的全部必需 Actions。按变更独立 commit/PR；审查通过后合并到 main，再以**已合并 exact SHA**构建发布。不能把 docs/CI 绿灯当 deployed。

## 3. 真实部署、重启和校验：必须由 Codex 操作并提交回执

- 先只读验证现场身份（PID+creation time+可执行路径+command line+port owner+instanceId）、`:8080`、本地 SOCKS `:20091`/Ubuntu `:22091`、Qwen Scout `:8081` / Review `:8083` / Primary `:8084`、已有 guardian、observer、计划任务与签名 TP。保存脱敏 preflight、设置/DB 一致性备份及 hash、release/source identity、回滚计划。**确保没有第二个 Engine 同时交易**。
- 若 Engine 仍离线，安全前提满足时从新封存发布包**实际启动**（不是仅给命令）；若已运行旧版本，则核实真实 PID/身份并首先尝试受控 SIGINT / Ctrl+C（旧 graceful helper exit1 必须复盘）；持有真实订单保护且无法证明可安全退出时不可无条件 `Stop-Process -Force`。只有对已验证不管理订单的 Qwen/旁路组件，在正常停止失败、确认进程身份并留回执后才可按必要性强制终止该**单个**进程并重启，禁止误杀其他 GPU 模型/Engine。
- 三 Qwen 各自查询真实可执行 PID、独立监听、GPU Vulkan0/1/2 映射、HTTP 推理 smoke、模型标识和可完成一次受限测试请求。**任何一个 OFFLINE/ERROR/身份错误/无实际推理，必须针对这一组件用仓库原始受控启动器修复/重启并复测**，直至全数 READY 或遭明确外部阻断；健康且无需重新加载的组件不无故重启。验证模型心跳不能取代真实 tokens 输出。
- 代理进程如果仅端口 LISTEN 而 Binance Demo CONNECT/TLS 不通，视为网络未恢复；检查守护进程和 Ubuntu 绑定同一连接。必要时应用脚本修复并受控重启代理，记录原/新 PID、创建时间、路由同一性。观察器和守护若绑定旧 Engine PID/旧 release，修正后受控重启；只在确实需要时重启 Ubuntu 网络配置服务。
- Engine 启动恢复区分 **ANALYSIS_ONLY/NO_NEW_ENTRY** 与正常 TESTNET Entry。先恢复公共行情和安全只读私有同步；在最新签名账户、持仓、openOrders/openAlgoOrders 的双 ID、qty、side、reduceOnly、TP价格、全部在仓完整保护、真实私有 freshness 尚 UNKNOWN 时，**不得恢复自动建仓、撤改 TP 或交易写入**。若不能证明安全无交易模式，就不要启动具有自主交易权限的实例。只有严格私有门禁 PASS 才恢复原有依法授权的 TESTNET Entry。
- 保留 TESTNET ONLY / Production writes=0；Primary 唯一 Entry；绝不允许补仓、平均成本加仓、同向第二独立 Entry；HUMAN_MANAGED 不可擅自操作；TP Exchange verified、订单双 ID 幂等、UNKNOWN fail-closed。网络恢复不等于私有事实恢复。不得切直连或轮换出口绕过限制。不要开启新的 24h 验收。
- 本轮不是一次成功即收工：每次修复后必须走 source -> tests -> exact-head CI -> merge -> isolated build -> runtime deploy -> service health -> signed private/TP -> measurements。若再拥堵，收集分层 failurePhase / SSH queue 证据，继续调整可控软件，再走完整流程，不准仅重启；同一组件同故障阶段最多2次有冷却重启，然后回到诊断/代码修复，绝不自动无限重启。

## 4. 可验收定义（必须在自然正常 Engine 业务流量下）

- 第一阶段连续 **至少30分钟**：>=30 个自然/有界 public API 连接观察窗口、样本足够时成功率 >=99%、public p95 <8s、关键 SOCKS 连续失败0、服务/私有/TP 维持新鲜，SSH Send-Q 不得持续 >1 MiB 超过30s且 p95 明显低于原2.7 MB；REST 关键队列无反复 age-out，MARKET/PUBLIC WS 分类 decoded 60s 窗口及 retention 和行情 per-field freshness 完整，候选发现不退化；Engine/8080/Dashboard和三模型真实推理正常。
- 第二阶段再做 **90分钟只读自然业务观察**，连续记录 public/private 成功率、REST failurePhase/queue p95/p99、SSH Send-Q/notsent/RTT/retrans、WS subscription ACK/reconnect/quote TTL、TP signed 双 ID覆盖、仓位一致性、交易禁止补仓和 Production0。不得人为强制 Primary 下单或冲刷市场流量造样本。任何需重部署的重要变更须重新开始连续观察窗口。
- 只有 CODE_FIXED/CI_GREEN/MERGED_MAIN/HOST_DEPLOYED/PUBLIC_REST_OK/PRIVATE_RECONCILED/TP_EXCHANGE_VERIFIED/SUSTAINED_STABLE 全部有**实际新鲜证据**，才标 PASS；否则 UNKNOWN、NO_GO、BLOCKED。不得仅凭 CI、HTTP200 或进程存活标 PASS。

## 5. GitHub 强制持久化与继续执行

**Codex 产生的任何代码、脚本、计划、测试、报告、执行回执、无敏感内容的证据摘要，都必须 commit/push 到 GitHub**，不能只留在本地。主报告目录：
`docs/reports/v398-network-congestion-recovery-20261010/`，至少：

- `BASELINE_AND_CAUSALITY.md`
- `IMPLEMENTATION_AND_CI.md`
- `HOST_CUTOVER_RECEIPT.md`
- `STABILITY_30M_AND_90M.md`
- `FAILURE_PHASE_AND_NEXT_ACTION.md`（仍有失败时写精确阻断）

更新 `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` 最顶部、`docs/project-memory.md` 与本次计划，逐项记录 old/new SHA、PR链接、CI run IDs、DEPLOYED build、PID/creation/start time、proxy与Qwen健康、签名TP结果、负载前后对照、证据缺口、下一步。所有文件在当前独立分支/PR后上传并审查合并；上游暂不可达则本地可恢复持久化，说明未push的明确原因，连接恢复后优先push。绝不提交 API key、私钥、token、生产凭据、真实订单ID、未经脱敏私有响应、运行 DB、Windows用户隐私或原始SSH日志。

**行动模式**：现在开始首轮 preflight + PR42/41 review + 修复 + exact-head CI + merge + 发版 + 必要服务恢复；遇到可控失败继续下一轮故障修复而不是提前停在文档阶段。只有外部权限或交易安全门禁真实阻断时停止不安全操作，保留全部证据并明确列出阻断，继续其余安全的代码工作。不保证无条件永不终止的无限循环，不允许伪造稳定或绕过安全。