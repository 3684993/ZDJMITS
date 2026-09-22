# J1 退出真源、持续收敛、真实成本与 JIT

输入基线 `cf2e9a2`。执行令：`docs/plans/v396/CODEX-FINAL-CLOSEOUT-20260922.md` §2；补充清单：`docs/plans/v396/FINAL-REMAINING-IMPLEMENTATION-20260922.md` J1。机器可读结果：[manifest.json](manifest.json)。

## 先红后修

| 红测 | 结论 |
|---|---|
| `convergeRecoveredTasks` 只在启动跑一次，运行中真实终局的订单 claim 永久卡 WORKING | 新增 `convergenceDue/convergePeriodically`，周期与批量取自 settings，in-flight 去重、每单尝试窗口 `max(60s, interval/2)`，只读不发单 |
| 本地把 `SUBMITTING` 直接标 `CANCELED` 就释放数量 | `transition()` 拒绝非 PREPARED 的本地终局跳转；只有校验过的交易所 `observe()` 事实能终局化 |
| 旧 TP 行缺 clientOrderId/交易所证据仍能发新单，事后再补账 | `adoptRemoteExit` + `TpGuardian.place` 在 prepare 之前阻断，返回 `TP_EXIT_ADOPTION_REQUIRED`，且不留下 PREPARED 任务 |
| FIRST_FILL 期限被后续成交/重启改写 | `fixManagementDeadline` 一次写入；`appRuntime.fixCycleDeadline` 在 `POSITION_OPENED` 同一事件轮内落库，`fixFirstFillDeadlines()` 作为重启兜底 |
| 人工 `prepareManual` 会合法建立 HUMAN owner，AI 门却报 UNTRACKED | 拆成 `AI_EXIT_OWNER_UNTRACKED` 与 `AI_EXIT_OWNER_NOT_AI:<state>`，二者都不是 AI 权限 |
| 同额两次判决生成两个 clientOrderId | AI 的 requestKey 固定为 `verdict.decisionHash`，判决绑定 owner.deadline；重放得到 `IDEMPOTENCY_KEY_ALREADY_PREPARED` |
| S03 判决可由 synthetic MANUAL/TP 复用 | `AiExitVerdict.provenance` 进入 `decisionHash`；`prepareAiExit` 只接受 `MODEL_COST_MODEL` |
| 缺 book depth / 费用 / 资金费事实仍可 ALLOW | `assembleExitCostFacts` 产出 UNKNOWN 与 blocker，policy 侧只能 BLOCKED_FACTS |

## 交付

- **持续收敛**：`v396ExitRuntime.ts` 的有界精确查询 + `appRuntime` 5s tick 消费，确证事实才发 `EXIT_TASK_CONVERGED`。
- **保守占用**：`adoptRemoteExit/adoptedUnits/settleAdoptedExit`，`blockers` 记录缺哪一项身份；`terminal=false` 绝不释放。
- **管理期限**：`positionManagement.humanHandoffAfterMinutes` 现在有真实消费者；无 durable plan 的周期记为 `HANDOFF_PENDING`，旧 `AUTO_MANAGED` 标签不等于 AI 权限。
- **AI 权限门**：`AiExitAuthoritySchema` OFF/SHADOW/ENFORCE，默认 OFF；`AiExitAuthorityService` + `V396AiExitRunner` 是唯一生产消费者；`s03ExitCostFacts.ts` 绑定 record/fills/fee/funding/FX/depth/quote/tick/step/minNotional/settings 版本。
- **JIT**：`jitBeforeSubmit` 插在 TP 与人工平仓最后一道 await 之后、发单之前。
- **边界测试**：`s03ExitCostPolicy` 的“S03 无消费者”断言改为具名白名单，并新增 runner 的 OFF 早退断言；没有删除任何安全断言。

## 门禁（仓库根目录执行）

Engine 997/997（143 文件，基线 975/142）；core 46/46；dashboard 17/17；contracts 0 用例（exit 0，不计为契约覆盖）；contracts/core/engine/dashboard build 均 exit 0；engine/dashboard typecheck exit 0；S00 T01–T06 PASS、108 入口、0 blockers、143 测试文件全部隔离、0 仓库 dataDir 引用；`git diff --check` exit 0。

## 已知未闭合（不伪造）

1. `appRuntime` 的 plan 端口恒为 null，故现网即使把 authority 设为 ENFORCE 也只会得到 `AI_PLAN_UNPROVEN`；真实 TradePlan 读取在 J3 接入。Runner 单测用注入计划证明“计划齐备 → 一次且仅一次 reduce-only 限价发单”。
2. 市场层只有 top-of-book Quote，没有 book depth 事实，AI 退出恒被 `EXIT_DEPTH_INSUFFICIENT` 拒绝。
3. 现网 `aiExitAuthority` 仍为 OFF，本轮未触碰任何 live Settings。

## 实际边界

只在隔离 worktree 内以 `':memory:'`/临时 SQLite + mock adapter 运行；没有启动/停止/重启/热重载 Engine，没有部署，没有交易所写接口调用，没有修改现网 Settings/DB/dist，没有访问真实 Testnet 写路径。
