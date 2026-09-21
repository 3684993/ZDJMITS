# V3.9.6 收尾复验（第 2 批，总设计）

日期：2026-09-21。输入：`codex/v396-design-completion-20260921` 分支 `b9e9625` 加其未提交工作树改动（A01–A12 修复与 `ownershipJournal.ts`）。
工作地点：同一独立 worktree。现网 `D:\MITS`、Engine 生命周期、Settings、数据库、交易所与部署全部未触碰。

## 对上一批声明的独立复验

| 声明 | 复验结果 |
|---|---|
| 定向测试通过 | 部分成立但有重大遗漏，见下面 G01 |
| `npm run build -w @zdj/contracts`、`-w @zdj/core`、`typecheck -w @zdj/engine` 通过 | 成立（本批重跑仍通过） |
| S00 静态复核通过、入口规则未放宽 | 成立：`node scripts/v396-s00-static-check.mjs` 退出 0，107 条推导记录不变，未新增放宽 |
| 全仓产品验证未运行 | 成立，且本批补跑了整棵 Engine 测试：130 文件 / 755 项全部通过，退出码 0 |
| `executionScope` 回退到旧持久键、`lossHandoff` 撤掉伪 CAS 投影 | 两个回退方向正确，已按事实保留；本批另加护栏见 G03 |
| 80 天 freshness guard 是临时保守限制而非方案 | 同意；仍属 S01 缺口（本地连续归档不存在） |

一次自身的误判一并记录：第一次全仓运行我导出了 `ZDJ_DATA_DIR`/`ZDJ_PORT`，导致 21 个文件失败（`D:\config\settings.default.json` 找不到、Windows 临时库 `EBUSY`）。那是我的环境错误，不是代码缺陷；去掉覆盖后同一棵树全绿。列在这里是为了让「谁在什么条件下看到什么失败」可追溯。

## 本批发现并修复的三处缺口

### G01 收紧的覆盖契约没有测试锚点，且已打破既有 UNKNOWN 释放用例

`noActiveRiskEvidence` 现在要求 `coverageComplete === true` 且 `coverageStart <= 请求起点`、`coverageEnd >= 审计时刻`。生产适配器把请求区间原样回显，因此线上路径成立；但既有 `reconciliationUnknownRisk.test.ts` 的桩只返回 `{fills,income,orders}`，于是 4 个既有用例在本批接手前实际失败（同子系统 4 失败 / 40 通过）。上一批的 `tests.json` 是自选的定向集合（204 项），其中不包含该文件，所以「定向全通过」与仓库现状并存并不矛盾，但也没有覆盖到它。

处理：把桩改为按请求区间回显（与生产一致），断言一字未改；另新增 `reconciliationCoverageContract.test.ts` 六例，把新契约钉住——缺覆盖窗口、覆盖早停、自报不完整、起点晚于请求、读取抛错（含预算耗尽）五种情形必须保持占用且不释放 reservation，只有证明覆盖到审计时刻才允许释放。

### G02 分窗读取把一次证明的成本放大了 14–200 倍，且没有共享预算

A06 之后，一次跨 80 天的无风险证明需要约 14 个 6 天子窗 × 2 个读取端 ≈ 28 次请求，最坏可到每次读取 200 次；而 `fullOrderScanDue` 在存在任何 UNKNOWN 时每 60 秒触发一次，逐单串行审计。按 R15 的实测口径（历史 UNKNOWN 在 27 个量级），这足以再次制造请求风暴并把账户打进 429/418，进而拖累 TP 维护与入场准入——这正是 R15 已经治理过一次的问题。

处理：新增 `createHistoryReadBudget`（滚动窗口共享配额）并只接入 `source === 'ORDER_VERIFICATION'` 的逐单风险证明路径：单次读取上限 24 个子窗、全局 45 次/分钟，耗尽即抛 `HISTORY_REQUEST_BUDGET_EXCEEDED`（上游按事实保留 UNKNOWN，绝不返回半截结果）。每轮一次的账户 trade audit 刻意不受该预算约束，由既有的 20/100 符号线性测试与新增的「未消耗预算」断言共同保证。新增 `historyBudgetMetrics()` 供验收期取证。

### G03 `executionScope` 接受任意第四元素，打错字就会新造一把 claim 身份

恢复旧键（A01）方向正确，但函数原本对 `side` 不加校验：`'entry'`、`'BUY'`、`undefined` 都会静默生成一个新键，使既有持久占用永远匹配不上——即 I02 的失效形态。

处理：只允许持久词表 `ENTRY|LONG|SHORT|BOTH`，其余抛 `EXECUTION_SCOPE_SIDE_UNSUPPORTED`；并新增用例证明 `ENTRY ≠ BOTH`（旧占用不被吞掉）、`canonicalScope` 与 `executionScope` 在 `LONG/SHORT/BOTH` 上逐字节相等（未来迁移是 1:1 而非重新哈希），`canonicalScope` 拒绝 `'ENTRY'`。

## 仍然没有完成的事（不因本批改变）

`OwnershipJournal` 只有隔离测试在创建它：**没有任何生产迁移，也没有接进实际下单/撤单/重试路径**。因此 S02/S04 仍是 PARTIAL，不得据此启用 AI 新退出权限。S01 的资金费持久归属与历史归档、S03 的 JIT 成本再验与价格边界、S05 的全账户压力与人工容量、S06 的 TradePlan 数据链、S07 的真实 token 台账与记忆消费、S08 的设置回读、S09 的无泄漏回放与统计、S10 的 Testnet 验收均未完成。上一批的矩阵结论保持有效。

## 发布闸门结论

`NOT_READY`。工程面：本批之后全仓 Engine 测试 130 文件 / 755 项通过、typecheck 与 S00 门禁通过，三处 fail-closed 缺口已补测试锚点。发布面：无生产迁移与接线（S02/S04）、无样本外经济证据（S09/S10）、SHADOW→Testnet→实盘是三道独立权限（H-AUTHORITY），且 V3.9.5 的 R16 冻结与 24 小时 soak 仍在计时、7 天悬崖 P1 在 2026-09-24 06:40 到期。因此本批只提交离线代码与证据，未推送、未部署、未启停 Engine、未发单、未改现网 Settings 或数据库。
