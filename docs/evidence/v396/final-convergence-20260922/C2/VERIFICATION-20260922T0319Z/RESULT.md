# C2 独立验证（原子风险）— 红测与裁决

验证时间 2026-09-22T03:19Z。基线：分支 `codex/v396-astra-handoff-20260922`，HEAD `5b98e00`（父 `14b34e6`，即 Astra 的 C2 WIP 封存点）。
本轮按用户指示**只做本地验证、敌意红测与证据，不修改任何产品源码**，且**未提交、未推送**（失败测试不入库）。

## 判据来源说明

指定文件 `docs/plans/v396/CODEX-C2-VALIDATION-20260922.md` 在本仓所有分支与工作树中不存在（已用文件名、`git log --all --diff-filter=A` 双向确认）。
改用 `docs/plans/v396/FINAL-CONVERGENCE-20260922.md` 的 C2 行作为判据，其四条要求为：
① 版本、新鲜度、持久预留在同一事务；② 并发候选只允许额度内一个成功；③ UNKNOWN 不释放；④ 不以陈旧账户重新放行。
另注意 C2 目录此前只有 Astra 的 `red.json/targeted.json`（无 RESULT.md），本目录是独立复核，不构成 C2 通过结论。

## 结果

| 项 | 结果 |
|---|---|
| 敌意测试 | `apps/engine/src/state/c2ReservationAtomicityHostile.test.ts`：18 项，**6 通过 / 12 失败**（`red.json`、`red.log`） |
| 全仓 Engine | 917 项，905 通过 / 12 失败，失败全部且仅在本次新增文件内（`full.json`）⇒ 无连带破坏 |
| engine typecheck | 通过（含新测试文件） |
| contracts / core build | `tsc -p tsconfig.json` exit 0（本轮在封存基线上复跑） |
| S00 静态门禁 | T01–T06 全 PASS，blockers 0，139 测试文件、11 个开库测试全部隔离（`s00-static-gate.json`） |
| `git diff --check` | 通过；`git status` 仅 2 项未跟踪（新测试 + 本证据目录），产品源码零改动 |

结论：C2 的①②④三条判据**未达成**，③基本达成（仅未识别状态枚举一处例外，见 D6）。裁决 `NOT_READY_FOR_REVIEW`（本地验证不通过），交回实现方修复。

## 缺陷清单（输入 / 预期 / 实际 / 定级）

### D1 P1 风险快照没有进入 C2 事务
- 输入：按 appRuntime 的方式绑定 `entryReservationTransaction`（不绑 `entryRiskGate`），`reserveEntry({BTC,USDT,margin 60,notional 1000})`。
- 预期：获准的预留必须携带本次准入所依据的风险快照版本与新鲜度（判据①含“新鲜度”，C2 行明列“风险快照”）。
- 实际：`ok:true`，持久化预留的 `riskBinding` 为 `null`；源码扫描确认 `appRuntime.ts` 从不给 `entryRiskGate` 赋值（只有 `reserveEntry` 内部的可选调用点）。
- 定级理由：事务里只剩“版本 + 落盘”两件事，S05 预算与快照新鲜度对新增风险零约束；若后续把 `entryRiskGate` 当成已生效，就会得到一个“看起来有闸、实际无闸”的准入链。当前无资金后果（AI 入场链未接），但不修 C2 不能签。

### D2 P1 预留状态迁移绕过事务，revision 不前进 → 丢失更新（判据②的实质破口）
- 输入：车道 A `reserveEntry(BTC)`（revision 1，已落盘）→ 车道 B 此刻 `restore()`（同为 revision 1，合法当前版本）→ A 按 `entryCoordinator.ts:245/372/407` 的做法**直接** `entryReservations.set(id,{...status:'WORKING'})` 并 `persistRuntime`（revision 仍 1，`STALE_RESERVATION_CHECKPOINT` 判 `1>1` 为假而放行）→ B `reserveEntry(ETH)`，CAS 期望 1 == DB 1 通过并整体覆写 payload。
- 预期：持久层中 BTC 仍为 `WORKING`，或 B 以版本冲突被拒。
- 实际：B 成功；持久行退回 `RESERVED`，即“已有下单意图”的事实从磁盘消失。
- 机械佐证：全仓扫描“`state/runtimeState.ts` 之外直接写 `entryReservations`”得到 7 个点 —— `runtime/appRuntime.ts:170`、`services/entryCoordinator.ts:245,372,407`、`services/reconciliationService.ts:63,71,90`。
- 定级理由：一旦 WORKING 被回退成 RESERVED，过期清理就把它当作“从未提交”的预留释放，同 underlying 可再次预留/下单——正是判据②要禁止的双花。这是 C2 事务机制自身的有效性缺口，不是读端展示问题。

### D3 P1 重启后一段窗口内所有预留被拒，且原因被掩盖
- 输入：持久 payload revision=1 且内含一条已过期的 `RESERVED` → 新 `RuntimeState.restore(payload)`（appRuntime 在 `state.restore()` 之后才挂事务钩子）→ 挂上钩子后 `reserveEntry(ETH)`。
- 预期：仅因“重启时过期了一条预留”不得阻塞后续入场；revision 只能在事务内前进。
- 实际：`restore()` 内的 `cleanupReservations()` 走了无事务分支，内存 revision 变成 2 而 DB 仍 1（断言 `2 === 1` 失败），随后每次 CAS 都是 `RESERVATION_VERSION_CONFLICT`，对上层统一显示为 `RESERVATION_DURABILITY_FAILED`；同时这次释放本身没有落盘，崩溃重启会重复释放。要等到另一条链路写 checkpoint 才自愈。
- 定级理由：确定性的“重启后无入场”窗口，并且失败原因不可归因（v395 已发生过多轮因原因码掩盖而误判的复盘）。属实现层 P1，不需要现网验证即可复现。

### D4 P1 状态读路径开写事务，并可把存储异常抛给读端
- 输入：绑定事务钩子 + 一条过期预留 → `reservationSummary()`（即 `appRuntime.runtimeControlStatus()` 的读路径）；再把钩子替换为抛 `STORE_BUSY` 的函数，重复一次。
- 预期：容量/状态读不得消耗预留事务，也不得因预留持久化失败而抛出。
- 实际：一次读触发 1 次 `BEGIN IMMEDIATE`+COMMIT（计数 1→2）；钩子抛错时异常直接冒泡。（`entryCapacity()` 本身不调用 `cleanupReservations()`，不在此链上。）
- 定级理由：仪表盘轮询与状态查询变成写锁竞争者，且引擎最忙/DB 最紧的时候正是读路径先炸；这与 v395 R16 期间“抖动放大成无入场”是同一类风险面。

### D5 P2 被拒候选同样推进 revision 并各写一次事务
- 输入：余额 10，候选需要 margin 60 → `RESERVED_QUOTE_MARGIN`；再来一个 `underlying='   '` → `RESERVATION_FACTS_INVALID`。
- 预期：无任何事实变化 ⇒ revision 不变、零事务。
- 实际：revision 0→2，事务调用 2 次。
- 定级理由：不产生资金风险，但入场候选是批量评估的，每个被拒候选一次写事务会放大锁竞争与版本冲突概率（放大 D3/D4），并让 `WAITING_EXECUTION_CAPACITY` 的原因分布失真。

### D6 P2 未识别的预留状态不占用额度
- 输入：一条 `status='RESERVED_BUT_FORGOTTEN'` 的预留 + 余额 100 → `reserveEntry(ETH)`。
- 预期：无法识别的状态必须按“仍占用风险”处理（fail-closed）。
- 实际：第二条预留成功；`entryCapacity()` 也不计它（各过滤器只认 `RESERVED/WORKING`）。
- 定级理由：`restore()` 不校验状态枚举，需要被篡改/回滚版本的持久行才触发，故现网暂不可达；但一旦发生就是真实双花口，属纵深防御缺口。

### D7 P2（对 C2 判据为必需）预留不看账户新鲜度，判据④未达成
- 输入：① `account.status='NOT_CONFIGURED'、asOf=null`，余额 100_000；② `asOf=now-61_000`；③ `asOf=now+60_000`；④ `availableBalance=NaN`。
- 预期：`privateAccountFresh()` 为假即拒绝预留（判据④“不以陈旧账户重新放行”）。
- 实际：①②③ 均 `ok:true`，只有 ④ 被既有的 `Number.isFinite` 检查拒掉。
- 定级理由：现网仍有兜底（`entryCoordinator.ts:362` 提交前会因同一函数失败而释放并冷却），故资金面判 P2；但 C2 要求在预留事务内成立，因此判据④按“未达成”记录，而不是“已满足”。

## 通过侧（这些是 Astra C2 改动真实买到的东西，修复时不得回退）

1. `RESERVED` 与 `WORKING` 一并计入 quote 保证金占用（旧实现只算 `RESERVED`，是真实双花）。
2. 同 underlying 在租约到期但预留仍活时不能二次预留。
3. 过期预留若挂着 `UNKNOWN` 订单：既不自动释放，`releaseEntryReservation()` 也显式拒绝，保证金与锁保留。
4. 只有结构完整、身份 tombstone 匹配且未过期的 `VERIFIED_NO_ACTIVE_RISK` 证据才允许释放 UNKNOWN。
5. 在已活动的事务里再发起预留：失败关闭且内存映射/锁被回滚，之后仍可正常预留。
6. 持久 payload 不能把 revision 往回写（`STALE_RESERVATION_CHECKPOINT`），回滚尝试后 DB revision 不变。

## 建议的最小修复方向（不在本轮实施）

- 把所有预留迁移收敛到 `mutateReservations` 内（新增 `transitionReservation(id, status, reason)` 一类 API），并把 7 个直接写点改为调用它；`restore()` 内只做只读收敛，释放动作作为启动时的一次显式事务写入。
- 事务钩子绑定前先禁止 revision 递增（区分 `applyInTransaction` 与 `applyLocalOnly`），或对“无事实变化”的返回不落事务、不涨 revision。
- `reserveEntry` 在预留时即要求 `privateAccountFresh(account)` 且把所用 `account.asOf`/快照版本写进 `riskBinding`；`entryRiskGate` 必须由 appRuntime 绑定，未绑定即拒绝新增风险（而不是可选跳过）。
- 状态过滤器（capacity/summary/占用）改为“白名单外一律视为占用”。

## 边界声明

无 Engine 生命周期操作、无现网 Settings/DB 访问、无交易所调用、无部署；测试仅使用 `mkdtemp` 下的临时 SQLite（`S00 T01` 隔离度量已确认）。本轮不声称 C2 通过，也不为任何阶段自签 ACCEPTED。
