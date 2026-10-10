# Codex 指令 · 24小时交易盈亏、退出来源冲突、受控版本集成和重启（2026-10-10）

## 权威 GitHub 与用户最新授权

Repo `3684993/ZDJMITS`. 先完整读 `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`、`docs/project-memory.md`、`docs/reports/v398-engine-cutover-20261010/acceptance/state.json`、`docs/reports/v398-engine-cutover-20261010/ACCEPTANCE_ABORT_RECEIPT_20261010.md`，再读本指令。与 Issues #30/#23/#26/#28 以及 PR #31/#32/#33 的最新精确 HEAD/CI 核对。

用户**明确授权**：结束现有24h验收尝试、在满足安全门禁时整合代码并执行**一次受控 Engine-only 重启**，重启后开启全新24h验收。用户不希望继续重复生成审计报告却不交付代码。**这不是允许绕过实时TP/签名账户/环境/身份等门禁的授权**，不得为图表性能冒险撤保护单，不能自行把 UNKNOWN 解释成 PASS。

目前权威 GitHub `main` 的原24h `state.json` 已是 2026-10-10 **08:34:00.270 +08 ABORTED_SAFETY_FAILURE / LOCAL_TP_GATE_NOT_CLOSED**，不是RUNNING。原 observer 已终止该 attempt，**不要再次“停止”保护性 Engine 来中止早已终止的监控**。确认本机是否另有新 attempt，若有则安全地先终止**observer/checkpoints**、保存历史证据、使既有真实保护路径继续运行；禁止擦除旧失败记录或重复使用 T0。

## A. 先拿到 ChatGPT 已提交的真实经济修复代码

独立干净工作树（保留原 `D:\MITS` 所有 dirty 文件）：
```powershell
git fetch origin
git worktree add D:\MITS-WORKTREES\v398-trade24h origin/chatgpt/v398-trade24h-provenance-and-release-20261010
cd D:\MITS-WORKTREES\v398-trade24h
git switch -c codex/v398-trade24h-final
npm ci
npx vitest run apps/engine/src/services/trade24hReadModel.test.ts apps/engine/src/services/exitProvenanceConflictReasons.test.ts apps/engine/src/services/tradeRecordReadModel.test.ts apps/dashboard/src/views/tradeClosePresentation.test.ts
npm run verify:ci
```
（如项目实际workspace调用不同，以 `package.json` 现有脚本为准；不删S00、不放宽 guard。）

本分支**实码**：
- `apps/engine/src/services/trade24hReadModel.ts` / tests：滚动24h按 **settled CLOSED closedAt** 算合法本地唯一 physical-cycle，逐 USDT/USDC 显示已实现不含 funding 收益的盈利合计、负亏损合计、净额、费用、赢家/输家/持平；正式全口径单独 gating。多币不混，不计算美元1:1，部分成交不重复记交易；只看当前保留事实，不能把 syncERROR 解释为零交易。未明交易的净值为null/UNKNOWN。
- `apps/engine/src/api/router.ts` 新只读 `GET /api/v3/trade-records/24h`，不能发交易所请求、不能自动修复账本；
- `apps/dashboard/src/api/client.ts`、`views/TradeRecordsView.vue`：过去24h分USDT/USDC盈亏，手续费、覆盖/同步状态；保留老V3.9.3 formal eligibility 不降门槛；
- `apps/engine/src/services/exitProvenance.ts` / regression：真实来源冲突提供 `conflictReasons`、`provenanceEvidenceStatus`，从不凭 exit TP价格/taker或 UI 标签猜测TP；
- `apps/dashboard/src/views/tradeClosePresentation.ts`：详情/tooltip 显示原因，区别完整性 conflict0 与退出身份冲突。

已知需要 Codex 复审与改进之处：API每30s随 TradeRecords UI 刷新（不能阻塞 Engine）；`lastSyncSuccessAt` 是否真实完成24h覆盖（目前仅做警示，不得承诺100%）；所需 history/refraction 时间窗口一致；UI响应式与时间边界、0 vs UNKNOWN；精确 schema/资金口径，避免 24h 数据遗漏或重复。修复后做真实 TypeScript/Verify/CI和脱敏浏览器截图，不是仅更改README。

## B. 修复“来源冲突”的事实根因，而不是把红标签掩盖

用户展示 2026-10-10 **12:03 WLDUSDT LONG、11:28 USELESSUSDT SHORT、11:28 BRUSDT SHORT、11:18 POLUSDT SHORT、11:05 GRASSUSDT LONG、10:39 AVAXUSDC LONG**：均显示 `COMPLETE / CLOSED`，但 `closeProvenance=CONFLICT`。这些是 UI 截面，并非必然同一 identity 真冲突。顶部“重复/冲突/无效 0”是 `TradeRecordIntegrityService` 的 `classification` 口径；表格“来源冲突”是 `projectExitProvenance` 的 `identityConflict/quantityConflict` 口径。

在本机 TESTNET **只读**查询 `GET /api/v3/trade-records?category=COMPLETE` 和上述 6 个 exact record IDs 的详情，追 `exitIdentityEvidence` / `proofCoverage` / `conflictReasons`：按环境+账户+symbol、physical cycle、每笔 `exchangeTradeId` 去重，逐 `clientOrderId/exchangeOrderId` 和 `orderProvenanceRegistry`、TP/manual/exit 历史匹配、verified reduceOnly /成交qty/逐笔executionTime。仅最小脱敏哈希上报 GitHub，不上传真正订单号与 SQLite。
- 同一 fill identity 被两个冲突角色声明 → 保留CONFLICT，追真正 writer 证据并给可重放测试；
- 不同独立 exact order identity 的 TP+人工组成退出 → 显示 `MIXED_TP_MANUAL`，不能判 identity conflict；要求 terminal-finalizer/quantity 全覆盖；
- 未知来源、provenance 缺失 → 保持 `UNKNOWN`，不可猜TP；禁止历史回填成假事实；
- 多份乱序/重复 fill 不能多算成交与净收益；不同 cycle 重复应完整隔离。
若发现真实错误请补代码与 fixture/regression；不要直接在线执行 `/trade-records/sync/apply` 或改写真实 DB，除非单独走已授权事实修复、备份、双ID和 preview 核对。

## C. 集成 PR31 / PR33 / PR32 + 本PR，先 CI 再正式发布

PR31 final `ae39b390e8d1900c91c76582d3c7ad9166df3386` (Actions 38022877309 success), PR33 final `402b850f73fd10018fb03db0b5deaeda493dd499` (38018026331 success), PR32 final `6ac46f8a93c096b5764bc05508ba47aa015bf381` (38018034694 success)。**三者各自CI绿不代表合并代码绿**。先复核PR HEAD未变、独立 worktrees、依次在集成分支合并，解决 `router.ts`、`client.ts`、docs memory/handoff 冲突，保持三方代码，不用 force/reset/squash 破坏证据；集成后再 `npm ci`、`npm run verify:ci`、S00、release build/feature smoke、综合GitHub CI。保留所有原PR内容与精确HEAD关联；不得直接部署任一还未通过整合CI的工作树。

PR33 原子容量统一租约只部署其**默认借用关闭**安全模式：双27B reasoning/output-limit不等价、无准入的借用policy，不可开启跨物理GPU Primary routing；Primary唯一建仓授权不改。PR32只部署无交易执行能力的TP_SHADOW协议，**不接真实TP撤改单**。PR25/#27/#29网络变更保持独立待审（除非有额外经验证的发布链），不可静默改 Demo WS host/settings 或绕HTTP451区域禁限。

## D. Release go/no-go，用户已授权单次满足门禁的Engine重启

先在运行主机安全只读确认：旧验收ABORTED且不存在新未中止attempt；当前Engine PID/instance/build/Settings/generation，Testnet环境与账户签名权限、Production写入0、无production尝试、所有非零真实持仓的**新鲜签名** reduceOnly TP (数量/side/价格/exchange+client双身份与pos cycle) 全覆盖，订单/私有事实同步<60s、配置和回滚identity/备份/冷启动不间断保护，HUMAN_MANAGED无误，NO_SEPARATE_ADD_V398未退化、SOCKS/SSH/REST/WS路由符合合法约束。已知上一次 02:10Z signed25/25 只是历史样本，不可替代 restart-action-time 验证。

任何指标 UNKNOWN、TP缺口、Production非0、口径冲突、CI缺、未经许可的地区限制或签名授权不合格：**STOP/NO_GO，不停止有保护意义的Engine、不强重启，不让候选PR生效**，保存GitHub脱敏阻断报告；可以继续离线代码工作。不得用“几个小时已暴露大部分问题”取代完整24h。

全门禁真实PASS以后，在唯一、明确签名的候选tag/commit上完成 GitHub main 规范合并、staged release build hash/rollback/durable DB备份、**最多一次**受控 Engine-only stop/start（模型/代理/PID/端口不动），确认新build实际运行身份 6/6、新鲜签名TP/订单/私有同步/Production0、read-only `/api/v3/trade-records/24h`/Dashboard真实数据与错误状态、API延迟/资源开销；如异常正规回滚并恢复保护。不为刷新UI撤销/修改任何交易所TP，不产生额外独立Entry。成功后从**新 T0**启动新的完整24h observer；旧2026-10-10 08:16 T0 到08:34 abort的历史不得续算。保证 observer 正常stop不停止Engine。**不得声称完成重启，除非现场有真正 stop/start + PID/build/6of6/TP 证据。**

## E. 完成时必须上 GitHub 的真实产物

在本次**交易修复与集成独立PR/工作分支**下归档：
- `docs/reports/v398-trade24h-release-20261010/TRADE24H_FORMULAS_AND_COVERAGE.md`
- `docs/reports/v398-trade24h-release-20261010/EXIT_PROVENANCE_SIX_CYCLES_EVIDENCE.md`（仅 anonymized）
- `docs/reports/v398-trade24h-release-20261010/INTEGRATION_TEST_CI.md` 和CI job logs/source hashes
- `docs/reports/v398-trade24h-release-20261010/CONTROLLED_DEPLOY_RECEIPT.md` **或** `NO_GO_STOPLINE.md`（禁止虚构）
- 更新 `docs/project-memory.md`、`docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`，Issue#30及新经济统计 Issue，链接所有 PR/heads、CI、实际部署身份/新24h T0或不部署原因。

报告文件必须保存到 GitHub，不只写到本地。秘密/原始私有订单/数据库不允许发公共仓库；仅上传可复核的 hash/最小分组统计。用户已经授权必要的单次受控重启，门禁合格不需再重复请示；门禁不合格绝对不绕开。

**第一轮执行顺序：代码验证修复 → 6笔来源冲突只读查证 → 集成CI → 发布实时门禁 → 单次受控重启和新24h（仅PASS）。按顺序实际执行，不要只给计划。**
