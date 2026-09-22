# J4 有限复核调度器、token 用量台账与交易记忆

输入基线 `26e64c1`（J3）。执行令：`docs/plans/v396/CODEX-FINAL-CLOSEOUT-20260922.md` §5；规格：`docs/plans/v396/07-model-review-memory-budget.md`。机器可读结果：[manifest.json](manifest.json)。

## 之前的事实

S07 在仓库里是一组「有原语、没有消费者」的形状：`v396OfflineStages.ts` 里有离线台账/复核类型但只被测试调用；`AiFabric` 的 `run()` 类型签名允许 `REVIEW_BRAIN`，但全仓没有任何调用路径使用它；没有任何地方记录失败的模型请求、没有预算、没有复核去重、没有交易记忆检索与人工接管归因。所谓「有限复核」在实现上不存在：既没有花预算的地方，也没有拒绝的地方。

## 现在的事实

- **调度器**（`positionReviewScheduler.ts`）：trigger key 覆盖 plan/owner/position/settings/riskGeneration/snapshotHash/evidence/memory 八个版本维度；**在同一不换手步骤内检查并扣除预算**（`s07ConsumerBoundary.test.ts` 直接断言 `reserve` 体内不存在 `await`/`async`，两个事件不可能在同 tick 都被授予）。`HUMAN_MANAGED`/`HANDOFF_PENDING` ⇒ `OWNER_NOT_AI:<state>` 且 `zeroRoutineCall:true`，任何预算规模都不给例行调用开口（S07-T01）。
- **迟到回答**（S07-T02）：`accept()` 一律**重新从 ownership journal 读 owner**，不采信调用方自报的 owner 状态或版本——自报版本等于让回调声明“我希望它仍然成立”。owner 已非 AI、版本漂移、授权窗口关闭、期限到期四类结果全部 `usable:false` + `archived:true`，用量行照写；真实回答即使迟到也**不退还**预算。
- **失败预算与断网**（S07-T09）：未抵达模型的失败退还一次例行名额并释放 trigger（否则端点抖动会饿死后续应做的复核），但计入独立的 `reviewFailureBudget`（默认 2）；用尽后 `REVIEW_FAILURE_BUDGET_EXHAUSTED` 只停推理——deadline、TP 扫描、对账、交接收发一律不受影响，测试逐字节比对失败前后的 owner `deadline` 未变，事件固定 `engineRestartTriggered:false, orderSent:false`。
- **用量台账**（`aiUsageLedger.ts`）：`ENTRY/SCOUT/REVIEW/EXTERNAL_RESEARCH` 每次请求、重试、失败、timeout 都落行；服务端未报 usage ⇒ `usageStatus:'UNKNOWN'`、token 为 `null`（**禁止写 0**），只要有一行 UNKNOWN 或被裁剪，`computable:false` 且 `totalTokens:null`。`EXTERNAL_RESEARCH` 端点根本不报 usage，因此这类行永远以 UNKNOWN 存在——这正是它不能被拿去证明“省了 token”的原因。
- **一次请求一行**：预约即写 `RUNNING` 行（id 由 `triggerKey`+复核序号导出），回调在同一 `eventId` 上定稿；进程中途死掉的请求留下一条未回答的行而不是消失。事件桥**显式跳过 `REVIEW_BRAIN`**（复核行归调度器写，带 `budgetKey`），因此绝不双计。
- **重试可见**：`OpenAiCompatibleClient` 现在回报 `transportAttempts`；未回报时是 `null`，合计只有在全部行都证明时才给出。
- **窗口不是档案**：台账默认 5000 行，超限淘汰最旧的已定稿行并累加 `state.aiUsageDroppedRows`（随 serialize/restore 持久化）；`droppedRows>0 ⇒ computable:false`。任何汇总都必须声明自己描述的是一个窗口。
- **token 对照**：`tokenSavingRatio` 只在两侧同一冻结事件集（`aiUsageEventSetHash`）、无裁剪、usage 全 EXACT 时才给 PASS/FAIL，否则分别落到 `EVENT_SET_NOT_FROZEN / EVENT_SET_TRUNCATED / USAGE_UNREPORTED / BASELINE_HAS_NO_TOKENS` 的 `NOT_MEASURED`。本轮结论是 **NOT_MEASURED**（见下）。
- **复核大脑接通**：`AiFabric.review()` 把此前只活在类型里的 `REVIEW_BRAIN` 变成真实调用路径（`runKind/recordKind=POSITION_REVIEW_RUN`，`AiRunSchema.requestSource` 枚举新增 `'REVIEW'`），复核失败不再污染 ENTRY 侧熔断。`positionReviewPrompt.ts` 明确「无下单权限、无规模权限、无权改变归属/期限/风险/计划」；`parsePositionReview` 对夹带 `tradeSide/quantityUnits/idealPrice/profitTakePlan/...` 的输出直接 `REVIEW_OUTPUT_CARRIES_ENTRY_AUTHORITY`，无证据引用的 `EXIT_PROPOSAL` 直接 `REVIEW_EVIDENCE_MISSING`（S07-T08）。
- **退出侧只读一条通道**：`PositionReviewRunner` 是唯一消费者，`tick()` 只扫 `AI_ACTIVE` 且存在非 WAIT 计划的周期；`positionReviewEnabled=false`（出厂默认）时一次读取都不做。可用回答只经 `planFactsWithReview` 变成退出证据，且**只有 `EXIT_PROPOSAL` 能使 thesis 失效**——`HANDOFF` 是请求托管，不是平仓指令；上一版计划的回答不作为新版证据。
- **交易记忆**（`tradeMemoryRetriever.ts` + `tradeMemoryService.ts`）：只有**已平仓**且 funding `EXACT`、fees `COMPLETE` 的周期进入已实现分母；未平仓（哪怕深亏）= `CENSORED_OPEN` 且 `netPnlUsd=null`，闭合但账目不全 = `UNKNOWN_NET`，两者都按计数与原因显式列出（`RIGHT_CENSORED_EXCLUDED:n` / `UNKNOWN_NET_EXCLUDED:n`），既不入分母也不从周期列表消失（S07-T05）。Top-3 必须含反例：全赢家 ⇒ `NO_COUNTER_EXAMPLE`；凑不满 ⇒ `INSUFFICIENT_SAMPLES`，绝不用重复行或浮盈填充（S07-T06）。
- **人工接管归因**（S07-T07）：三数桥——AI 归因止于交接点位、人工增量 = 终点 − 点位、周期总额 = 终点；无人工接手 ⇒ `NO_HANDOFF_AI_OWNED_WHOLE_CYCLE`；点位或最终净值缺证明 ⇒ `computable:false`，一个拆分数字都不给。因此「人工接手后大亏」不会洗白成 AI 没亏，也不会把人工的亏损算到 AI 头上。
- **持久化**：`RuntimeState` 新增 `aiUsage`/`positionReviews`/`reviewBudgets`/`aiUsageDroppedRows` 并进入 serialize/restore；`aiUsage` 列入 `settingsStore` 的 `runtime_entities` tuple 集；复核预算每次 tick 回写 state，重启不退还已花掉的复核（有专门红测）。

## 为什么 token 指标不是 PASS

`FINAL-REMAINING-IMPLEMENTATION` 要求「同一冻结事件集比较 token，≥30% 降低；未跑前只写 NOT_MEASURED」。本轮是离线实现轮：不存在两侧 usage 完整、事件集相同的真实对照运行（离线也没有可信的基线侧请求集合）。因此交付的是**测量工具与其诚实出口**，指标写 `NOT_MEASURED`，对照运行清单留给 J6 的授权项。没有靠换口径、剔行或把 UNKNOWN 记 0 造出一个百分比。

## 红测（S07-T01–T09）

`j4ReviewMemoryHostile.test.ts` 50 项 + `s07ConsumerBoundary.test.ts` 7 项（消费者白名单：调度器只允许 runner 使用、runner 只由 appRuntime 装配、记忆只经 tradeMemoryService、写路径模块不得 import 复核/记忆/台账；并断言复核回答不得触达任何下单接口）。全部先复现再修，清单见 manifest 的 `redTests`。

## 门禁（仓库根目录执行）

Engine 1086/1086（147 文件，J3 基线 1029/145）；core 46/46、dashboard 17/17、contracts 0 用例（exit 0，不计为契约覆盖）；`npm run typecheck` exit 0；`npm run build` exit 0（contracts/core/engine/dashboard）；S00 静态门禁 exit 0、108 入口、0 blockers、147 测试文件全部隔离、0 仓库 dataDir 引用、0 生产端口引用、`exchangeWrites:0`、`network:NOT_USED`、`engineLifecycle:NOT_USED`、`settingsModified:false`；`git diff --check` exit 0。

门禁纪律上有一处必须记录：第一次跑 typecheck 时用了 `tsc | head` 并按管道尾部的退出码判断，得到“绿”，改成无管道的 `npm run typecheck; echo $?` 后暴露出 5 个真实测试类型错误（正是执行令点名的“假绿”形状）。已修复并复跑。

## 未关闭项（不阻塞 J5）

- `tokenSavingRatio` 需要授权后的对照运行才有结论；`reviewLatencyAndCost` = `INSUFFICIENT_EVIDENCE`。
- 六个复核参数的 schema→default→持久化→API→UI→消费者→生效时点→回读矩阵属 J5。
- 记忆的 shape/volatility/liquidity 分桶：账目记录里没有**入场时点**的这些事实，用今日快照回填会造出描述另一个市场的假样本，故保持 UNKNOWN。
- 复核证据的可读时限目前复用 `reviewMinIntervalMs`（下一次复核应发生的时点），未偷加新字段。

## 边界

隔离 worktree、临时 SQLite、mock adapter、事件级夹具。未启动/停止/重启 Engine，未部署，未修改 live Settings/DB/生产文件，未执行真实迁移，未调用交易所写接口，未运行需要真实 Testnet 写入的步骤。
