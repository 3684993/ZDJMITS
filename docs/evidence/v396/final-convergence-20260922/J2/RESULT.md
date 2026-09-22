# J2 单一权威组合准入

输入基线 `5688478`。执行令：`docs/plans/v396/CODEX-FINAL-CLOSEOUT-20260922.md` §3；规格：`docs/plans/v396/05-portfolio-and-tail-risk.md`。机器可读结果：[manifest.json](manifest.json)。

## 之前的事实

`portfolioRiskSnapshot`、`portfolioStress`、`humanCapacityPolicy` 三个纯模块只有测试消费者；`RuntimeState.reserveEntry` 里 `riskBinding` 在没有门的时候可以**凭空合成**（用 capital generation 和一个非持仓 hash），`entryCoordinator` 又用 `candidate.selectionGeneration` 充当风险版本。审计结论「S05 没有生产消费者、G3 未实现」因此成立。

## 现在的事实

- `portfolioRiskLedger.ts` 是 S05 纯模块的**唯一**生产消费者：真实资产/持仓/订单/预留/durable ownership/现金流 → `buildPortfolioRiskSnapshot` → `evaluatePortfolioStress` + `evaluateHumanCapacity` → 决策与票据。
- `reserveEntryAtomic`：没有 `entryRiskGate` ⇒ `RISK_ADMISSION_UNPROVEN`；binding 必须是 `riskGeneration>0`、`snapshotHash` 形如 `v396r[0-9a-f]{32,}`、`profileVersion` 非空、`evaluatedAt≤now<expiresAt`，并与调用方声明的 generation 一致，然后与 reservation 行同一个 `BEGIN IMMEDIATE` 事务落库。
- 版本身份由**事实内容**决定：仅仅多评估一个候选不会作废别人的票据；一旦有真实预留/持仓/现金流变化，旧票据在 JIT 处得到 `RISK_SNAPSHOT_CHANGED`，这就是 S05-T03 的双花拒绝。
- 候选以「计划持仓」身份进快照，所以它自身的保证金档位与清算缓冲必须已被证明；`selectionGeneration` 冒充风险版本的路径已删除，并由边界测试禁止回归。
- 现金流：`fetchCashFlowFacts` 只读分页 TRANSFER；窗口未取全 ⇒ `complete=false` ⇒ `CASH_FLOW_COVERAGE_UNPROVIDED`，不把「没读到」当「没有入金」。60s tick 只在 `portfolioRisk.configured=true` 且私有账户新鲜时才尝试，未配置时不产生任何新请求。
- 重启：账本恢复只保留 generation 的单调序，`snapshotHash/expiresAt` 清空；必须重读事实才可能再次授权。

## 红测（S05 必测矩阵）

profile 未配置、缺 marginTier、缺现金流覆盖、账户不新鲜、FX 未折算、场景缺失；T01 转人工不降风险；T02 同 underlying/同 lineage 去重；T03 共用旧快照版本只一单获批；T04 更坏场景收紧且放宽预算不追认旧票；T05 保证金组成未证 ⇒ 拒绝；T06 人工积压爆满只停新仓、保护继续；T07 入金不掩盖回撤、未证实入金不当 0；T08 UNKNOWN 在途继续占额度；无门/畸形 binding/过期 binding/重启一律拒绝且不落 reservation。

## 门禁（仓库根目录执行）

Engine 1013/1013（144 文件，J1 后基线 997/143）；core 46/46；dashboard 17/17；contracts 0 用例（exit 0，不计为契约覆盖）；contracts/core/engine/dashboard build 均 exit 0；engine/dashboard typecheck exit 0；S00 T01–T06 PASS、108 入口、0 blockers、144 测试文件全部隔离、0 仓库 dataDir 引用；`git diff --check` exit 0。

## 被改变的既有测试语义（未删除任何安全断言）

1. `c2ReservationAtomicityHostile`：binding 的 riskGeneration 不再等于 capital generation（7），并显式断言二者不同——那正是本阶段废除的冒充。
2. `reservationConvergence`：删去「门为 null 也能预留」的旧语义，改为 `RISK_ADMISSION_UNPROVEN`，并补齐格式非法、缺 profileVersion、门拒绝、binding 过期四类断言。
3. `runtimeState/v370Contract/sideNeutral/tradingQuality`：这些用例不测组合准入，改用 `testing/deterministicRiskAdmission.ts` 显式声明替身门；替身不导入任何 S05 纯模块。

## 已知未闭合（不伪造）

1. 现网默认 `portfolioRisk.configured=false` ⇒ 新增风险一律拒绝（保护、平仓、人工路径不受影响）。要开始接纳新仓，必须由人工显式配置限额、单位、`marginTierVersion`、`maintenanceMarginRatePct`、相关性版本与压力场景——这是 J5 的编辑面与审核面。
2. `/fapi/v2/positionRisk` 若不提供维护保证金字段则保持 null，快照按 `MAINTENANCE_MARGIN_UNPROVEN` 拒绝；等档表事实需由人工配置档表提供。
3. 快照 generation/hash/factCoverage/限制原因的前端与 API 展示属 J5。

## 实际边界

只在隔离 worktree 内以临时 SQLite + mock adapter 运行；没有启动/停止/重启/热重载 Engine，没有部署，没有交易所写接口调用，没有修改现网 Settings/DB/dist。
