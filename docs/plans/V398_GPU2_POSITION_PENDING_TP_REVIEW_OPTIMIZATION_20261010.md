# V3.9.8 持仓、挂单与 GPU2 Review Brain 专项审计及优化方案

日期：2026-10-10。证据范围为 GitHub main 源码静态审查、已提交的实际部署回执及用户反馈；未查询本机实时进程或真实账户。不等于已实施代码变更。已部署Engine 3.9.8-bb45c11 / PID23688 为历史回执，运行身份须以新鲜现场数据为准。现有24小时验收2026-10-10 08:16:49.685–2026-10-11 08:16:49.685（北京时间）继续运行，不因本计划停止或重启。

## 1. 当前各组件谁负责什么

| 任务 | 当前实际代码链 | 触发与权限 |
| --- | --- | --- |
| 持仓成交、数量、开仓时间 | Binance私有UserData WS及REST -> PositionService -> PositionLifecycleTracker -> appRuntime/SQLite | WS实时变化、15s签名私有同步与15s reconciliation。只有交易所与持久事实可确立首次成交和终态 |
| 持续持仓计时 | PositionLifecycleTracker.observe + applyCycleFacts + Dashboard holdingDuration | 物理cycle首次有效fill为 openedAt。追加的部分成交、部分平仓不重置；没有成交证据的首次观察只能显示至少持有 |
| AI管理权限/期限 | appRuntime.fixCycleDeadline -> V396ExitRuntime + Ownership | FIRST_FILL锁定管理截止；positionManagement.humanHandoffAfterMinutes默认1440，现网Settings253未本次独立回读。HUMAN_MANAGED不可被模型恢复下单权限 |
| TP自动保护 | TpGuardian.ensure/sweep -> V396ExitRuntime claims -> ExternalTradeAdapter.placeTakeProfit/cancelTakeProfit | Engine约5s sweep；已有WORKING、数量和方向吻合的TP通常保持原价直接返回。目标选择仅在首次建单/修复时进行；动态TP改价尚未构成独立自动功能 |
| 活动Entry挂单时间/改价 | EntryCoordinator.reviewPending -> ExternalTradeAdapter.replaceEntry (native PUT /fapi/v1/order) | Engine外层2s tick，内部策略限频；nearMarket默认TTL90s、reprice间隔5s、最多6次；其他Entry有硬上限1h，现网取实际Settings |
| Entry过期及取消 | EntryCoordinator.reviewPending -> findEntryByClientOrderId -> cancelEntry (DELETE后签名GET) | 只对仍活动的原订单剩余量；UNKNOWN保留占用，远端查询ABSENT不等于终态 |
| 挂单AI建议 | EntryCoordinator.schedulePendingEntryReview -> AiFabric.reviewPendingEntry -> 8083 | dedicated GPU2:首次挂单age>=15s，同订单review至少30s一次；KEEP无动作；CANCEL/REPLAN必须在动作前精确核对再取消；REPLAN不直接提交新单 |
| 持仓AI建议 | PositionReviewRunner.tick -> PositionReviewScheduler -> AiFabric.review -> 8083 | Engine15s周期但必须有原durable TradePlan、所有者资格、计划预算、事实变化；输出仅HOLD/REDUCE_PROPOSAL/EXIT_PROPOSAL/HANDOFF，无改价/新qty权限 |
| AI主动退出 | V396AiExitRunner -> AiExitAuthorityService -> V396ExitRuntime -> ExchangeAdapter | Engine5s tick；代码缺省AI Exit OFF。实际Settings可能不同。只有ENFORCE、真实失效/成本/owner/JIT/减少风险证明齐备才能写交易所 |

注：默认 config/settings.default.json 8084是 ENTRY_PRIMARY 27B，8083是 POSITION_REVIEW/PENDING_ENTRY_REVIEW 27B，各maxConcurrency=1；两个模型进程不独立拥有交易所API写入权限，执行仍通过Engine。PCI bus19/bus22到8083/8084的物理映射未在仓库回执独立证明。

## 2. 精确定位的现状和不应误解的行为

1. **时间管理并不等于仓位自动平仓。** 持仓物理cycle时间和原TradePlan目标周期/AI所有权截止是三条独立时钟。期满应由既有owner/handoff处理；不能延长模型权限来增加Review次数。参考 appRuntime.ts 1255–1277及 tradePlanService.ts。
2. **TpGuardian并不是不断调整止盈价格。** tpGuardian.ts 194–207对已存在且方向/数量匹配的WORKING TP保留后直接return；后续 216–250 的结构/原Primary目标/固定利润候选和费用检验只在需要新建/修复时参与选择。新旧TP替换需确认旧身份终态，失败为UNKNOWN/人工核查，不能先随意撤保护。
3. **当前GPU2 Position Review不能给出TP目标价。** positionReviewPrompt.ts的协议明确禁止自由的price/qty/side；只有HOLD、REDUCE_PROPOSAL、EXIT_PROPOSAL、HANDOFF。EXIT_PROPOSAL也必须有计划失效谓词与事实引用，再由独立AI_EXIT权限和确定性成本验证决定是否真的执行，HUMAN_MANAGED只能回读。
4. **GPU2闲置可能是计划/权限/预算过滤而非显卡异常。** PositionReviewRunner跳过无durable plan、AI所有权过期和不具备资格的cycle；PositionReviewScheduler按同事实去重、minInterval、每计划次数、失败预算控制；配置专用GPU Review时正常预算>=4、最短间隔不长于120s、更新30min，但不应机械定时推理。挂单仅短暂活跃且90s内完成时，可能Review需求天然较少。
5. **挂单改价与Review目前异步交错。** EntryCoordinator.reviewPending对ACTIVE订单逐单检查，到期先精确查、必要时cancel；可自动native PUT改价；schedulePendingEntryReview fire-and-forget，同时Review建议CANCEL/REPLAN要在动作边界再查原订单身份。需要针对并发TTL/部分成交/改价/Review响应竞争补专项测试，而不是直接调高Review频率。
6. ENAUSDC页面“补仓一次”可能是相同原始订单分批成交被生命周期INCREASE计数误标；真实订单身份仍见Issue #23。**未来禁止任何后续独立Entry/add-on**；REPLAN不得成为已经部分成交持仓的新授权绕过口子。

## 3. 优化方案（先可观测、离线实验，再讨论新功能）

### R0：GPU2任务为何空闲——无人工注入、只读30–60分钟

对当前实际Engine、两模型端口8083/8084、GPU PCI bus19/bus22，采集自然业务周期。逐条汇总：
- 物理GPU<->server PID<->port<->model sha/quant/context/props身份；
- 每个duty的可处理eligible数、Review运行次数、被跳过原因（缺Plan/owner到期/事实不变/预算/endpoint离线）、queueDepth/queueMs/p95、LLM input/output token与处理速率；
- 挂单存活时间、首次Review响应、CANCEL/REPLAN数量、改价次数、TTL剩余、部分成交比例、每单唯一origin；
- 仓位openedAt/AI管理deadline、Review覆盖、上次/下次到期、TP签名完整性和不同symbol风险触发数量。
只读限流不影响现在的交易进程；不上传私有SQLite、密钥、明文order IDs。交付 GPU2_REVIEW_BASELINE.md / sanitized JSON / source callgraph。GPU2空闲不等于故障。

### R1：优化挂单Review的决策时效，不能引发新单

对比当前15秒首次、30秒再审与合理的事件触发：首次挂单长时间未成交、确认过期原Primary执行时限、盘口/价差/可达性改变、闭合bar结构失效、预期净利和交易成本质量变差。仅在事实版本变化且距离到期足够时调用模型；不能每2秒推理。过期队列任务丢弃，模型超时不阻断确定性TTL。

增加 per-origin action lease；在CANCEL/REPLAN/PUT/TTL动作前重读原client+exchange双ID、已成交/未成交、原计划/所有者版本/TTL，状态未证实为UNKNOWN并禁止重下。REPLAN先确保旧身份终态、交回Primary新独立机会；若原单已部分成交而形成仓位则必须受NO_SEPARATE_ADD策略拦截，不能借REPLAN创建新加仓。

### R2：增加GPU2 TP目标审查能力，但只能先SHADOW

当前没有GPU2自动提出或执行TP改价的协议。新增独立 TP_TARGET_REVIEW_DRY_RUN，输出仅KEEP/选择合法候选ID/HANDOFF、事实引用及摘要，不允许自由价格/数量/开仓方向/直接交易所调用。候选由Engine从原冻结TradePlan的授权范围、tick、成交对价、手续费、盈利下限、真实仓位/owner生成，有权决定的不是Review模型。即便模型选中候选，默认仅shadow对比原价、覆盖率、成交可能性、成本与后悔值，不能撤销现有TP。

可结合已收盘15m结构/原计划有效性、估计reachability变动、剩余目标horizon、价格极端变化等触发Review，而不是每一秒重新评估。保留HUMAN_MANAGED只读建议，缺失可靠报价/当前TP身份/签名持仓则UNKNOWN。

将来若确需允许自动TP价格调整，须另行取得独立ENFORCE授权并证明exchange原身份安全改价或无保护真空的严格替换流程；必须同scope/ownerVersion/planVersion/真实剩余仓位/当前TP client+exchangeID绑定，数量守恒、不增风险、减少方向正确、手续费/收益不违反原授权。若必须先撤保护且不能保证及时恢复，就不自动执行，维持现有有效TP。不得让AI自由设新TP价。

### R3：跨GPU职责借用，与Issue #26的统一容量租约对齐

专用8083优先真实Pending和Position Review，8084优先Entry Primary；Review任务不多时可借8083处理合法Primary分析**同一Primary角色/同一独立Entry权限与审计**，不是给Review模型建仓权。物理resource每个maxConcurrency=1且lease原子共享；当前aiFabric的reviewActive/load.active并不一致，不能只是给ENTRY_PRIMARY多加一个resourceId。优先级随deadline/TP风险和候选有效期确定，保证老持仓review不饿死新Entry，或反之。任何模型故障fail-closed，不让重试构成重复原始Intent或新的独立补仓。

### R4：验证、CI与上线门禁

使用人工构造/离线重放覆盖：
- PARTIALLY_FILLED->REVIEW CANCEL->TTL触发->WS晚到； native PUT超时UNKNOWN后仅按原身份恢复；
- Review REPLAN不重下已部分成交仓位；订单过期后台不会因为GPU忙延长；
- TP保护存在时shadow只有建议零交易所写入；权限/owner/HUMAN_MANAGED变化后立即作废；
- Review可用且候选够多时任务延迟降低，但不会让处理数和GPU利用率成为不必要下单动机。
每个小阶段独立PR + npm run verify + GitHub Actions、完整现网不碰、证据和前后指标；**不改在运行的Engine/Settings253/私有DB/8083/8084/代理、不中断当前24小时验收**。如用户另外要求部署且当前24h未结束，按正式流程中止并重新计时；全量签名仓位TP核验、6/6身份、Production0和现有权限规则都必须通过。

## 4. 需由Codex精准复核的源码

- apps/engine/src/runtime/appRuntime.ts (注册各服务、调度、Review任务和管理期限)
- apps/engine/src/services/positionLifecycleTracker.ts、positionService.ts、tradePlanService.ts
- apps/dashboard/src/utils/holdingDuration.ts
- apps/engine/src/services/entryCoordinator.ts (尤其reviewPending、schedulePendingEntryReview)
- apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts (PUT、GET、DELETE、TP reduceOnly)
- apps/engine/src/services/tpGuardian.ts、tpTargetContract.ts、positionReviewPrompt.ts、positionReviewRunner.ts、positionReviewScheduler.ts、aiExitAuthority.ts、v396AiExitRunner.ts、v396ExitRuntime.ts、ownershipRuntime.ts、lossHandoff.ts
- config/settings.default.json、正式Settings253回读（不要把defaults当现网有效值）
- 关联计划 docs/plans/V398_DUAL_27B_GPU_UTILIZATION_AND_DUTY_SCHEDULING_20261010.md 与 Issue #26，网络优化Issue #24及NO_ADD审计Issue #23

**定义：优化目标是更及时地管理已有持仓和真实挂单、增强Review解释性与TP策略建议质量，在所有不变量不降级条件下提高27B有效利用率，而非把GPU2拉满或让AI持续修改TP。**
