# V3.9.6 SHADOW 高级审计与状态裁决

审计基线：`11dd643b4977ca42722f3c1b9275eb02a4f15480`；2026-09-23，北京时间。状态：`READY_FOR_REVIEW`，不自签 ACCEPTED。证据：[机器索引](../evidence/v396/shadow-advanced-audit-20260923/evidence-index.json)。本报告替代上一轮“只需等待自然候选”的阶段判断。

## 1. 总裁决

**当前应标记 `READ_ONLY_OBSERVATION / VALIDATION_INCOMPLETE`。可以继续保持既有 TESTNET + READ_ONLY + SHADOW；不能签发 SHADOW_STABLE，也未达到 READY_FOR_LIMITED_TESTNET_WRITE_WHEN_NATURAL_CANDIDATE_EXISTS。**

最重要的新事实：12:27 资本可执行候选为 0，12:33 已自然恢复为 **2**，AI 仍为 0。源码明确在 READ_ONLY 下跳过启动与定时 `processPool()`。因此，当前 AI 静默不能完全归因于没有候选，更不能据此认定模型故障。自然资本候选不等于已完成 PortfolioRiskAdmission、TradePlan 和写前验收。

未发现要求立即中止当前只读观察的新 P0；P1 集中在阶段就绪、风险事实映射与驾驶舱语义。既有交易所 TP 仍保护持仓，但 READ_ONLY 也限制需要交易所写入的维护，不能承诺自动修复缺失 TP。若保护失配，必须提示人工干预；本裁决不授权启停、切模式或发单。

## 2. 身份、保护与证据边界

| 核验 | 当前证据 |
|---|---|
| 源码 | 已 fetch；`18a1765` 是 `11dd643b` 祖先，两者 apps/packages 无差异 |
| 实际运行 | PID 26896；instance `6ff3daa3-8bff-4254-8966-7fb136797a02`；build `3.9.6-e8b14777527e28bd3b80` |
| 启动 | 09-23 11:57:37.818；12:33:19 health uptime 35.71 分钟；日志检查延伸至约 12:36:30 |
| 配置 | settingsVersion 190；READ_ONLY；aiExitAuthority SHADOW；positionReviewEnabled false；tradeEconomics SHADOW |
| 所有权 | 27 行、27 个 cycle；25 HUMAN_MANAGED + 2 HANDOFF_PENDING；AI_ACTIVE 0；integrity_check=ok |
| 权限残留 | quantity claims / mandates / exit tasks 均 0；outbox 52/52 delivered |
| 保护 | 27 持仓 = 27 WORKING TP；逐仓匹配 positionId、数量、相反方向均通过；缺失/错向/重复/数量错配均 0 |
| UNKNOWN | 46 历史 UNKNOWN；46 VERIFIED_NO_ACTIVE_RISK；activeRiskUnresolved 0；当前对账 drift 0 |
| 写边界 | 本次读取计数 testnetWrites / productionWrites / blockedProductionWriteAttempts 均 0 |
| 连续性 | 同实例日志 fatal 0；行情与对账持续；不把历史 restartCount=168 当成本窗口重启次数 |

以上是只读时点与保留日志证据，不是完整 24h、自然下单、AI 决策质量或盈利验收。API 顺序采样并非原子快照；下述风险算式均取同一个 capital 评估对象，不拼接异步权益。生产 checkout 与运行 convergence checkout 均未改动；所有报告工作在独立审计 worktree。

## 3. AI 静默：当前根因树

1. **PROVEN，实际首先生效：READ_ONLY 不进入自动分析派发。** `apps/engine/src/runtime/appRuntime.ts:687`、`:742` 仅 TESTNET_ENABLED 才调用 `processPool()`。`runtimeControlService.ts:32` 的 canDispatch 不含 executionMode，故页面 scheduler=RUNNING 不能证明派发器实际运行。READ_ONLY 的零分析是当前权限设计结果；错误在于页面和阶段报告未表达此边界。
2. **PROVEN，并存但会变化：旧资本预检容量。** 12:27 六候选均被 gross 阻断；12:33 PENGUUSDC、TIAUSDC 的 LONG 自然达到资本可执行，每个上限仅 $10.4158。不是 AI 认可的交易，也不是可同时用两遍的共享额度。
3. **PROVEN，后置结构阻断，尚未实际执行：PortfolioRiskAdmission。** `entryCoordinator.ts:354–382` 在 AI PLACE 后才调用 admit，再生成 TradePlan。当前 configured=false，保证金档位/相关性/压力场景版本未提供；即便资本有余量，该配置也不能产生有效风险票据。不可把它写成“本轮已拒绝 N 个候选”。
4. **未证实为根因：TradePlan、模型预算/冷却、ownership。** 当前没有 AI 请求，自然没有新 TradePlan；review 开关关闭、AI_ACTIVE=0，不能拿 review budget 解释建仓 PRIMARY 静默。所有权完整，历史 UNKNOWN 已被证明无活动风险，没有证据表明它们锁死本次资本额度。
5. **短暂并存：私有事实超时。** 本实例有一次 PRIVATE_SYNC_FAILED，15s timeout，约 18.8s 后恢复；另有两次后台交易同步失败。两次 API 采样账户 READY、连续失败 0；这不解释整个静默窗口。

模型健康探测 ONLINE、队列/运行中/失败/冷却均 0，仅证明连接与当前资源状态；没有本实例真实推理成功样本。审计不通过补发模型请求制造证据。

### 调度链证据

| 层 | 本实例观测 | 解释 |
|---|---|---|
| 市场/供应 | targeted refresh 68；ranking/universe/pool 各 70 次 | 持续工作 |
| 资本预检 | CAPITAL_ROUTE_EVALUATED 866 次 | 持续工作，不能等同于 PortfolioRiskAdmission |
| 私有账户/对账 | private completed 150；reconciliation 121 次 | 持续工作，曾短暂超时 |
| 最近遥测桶 | 上述主要层 12:36:22.427 | 30s 聚合桶时间，不是每个事件精确时间 |
| dispatch intent / AI request / terminal | 当前实例日志无派发/请求/终态；归档 started_at>=实例启动的行数 0 | 符合 READ_ONLY 跳过自动派发 |
| 最后历史 PRIMARY | 04:55:28.216 开始，04:56:27.333 完成 | 来自前实例；不能冒充当前实例的最后成功 |

未形成独立持久的 scheduler lastTick/lastAttempt、可派发持续时长、每层首次阻断事件。现有事实足够解释**本轮**，不足以在所有未来情形下排除调度停滞。PRIMARY health 的 WAITING_CANDIDATE 白名单甚至能在有候选时继续掩盖 idle，应以新鲜可派发事实和派发心跳裁决。

## 4. 候选漏斗和风险预算

| 层 | 12:27 附近 | 12:33 附近 |
|---|---:|---:|
| 在线市场 snapshot | 66 | 68 |
| ranked / resident | 20 / 20 | 19 / 19 |
| potential ready / eligibility | 6 | 2 |
| 资本预检可执行 | 0 | 2 |
| PRIMARY 实际请求 | 0 | 0 |
| PortfolioRiskAdmission / TradePlan 实际处理 | 0（未到达） | 0（未到达） |

第一采样六个候选：UNIUSDT、PENGUUSDT、TIAUSDC、HBARUSDT、TUTUSDT、APTUSDT，LONG 均 gross 阻断，SHORT 均另命中 direction。新采样两候选是 PENGUUSDC、TIAUSDC；quote route/市场排名会动态变化，不是固定样本队列。

**漏斗不能伪造闭合分母。** supply API 报 cohort NOT_ESTABLISHED、memberCount=null；事件却把 68 个在线 snapshot 标作 activeCohortCount，语义明确是 CURRENT_ONLINE_SNAPSHOT_SET。它不是经过验证的 cohort 成员清单。最新供应事件还记录 3 个 zombie snapshot。37→40 governanceBlocked、27 occupied underlying 与上述层有交叠，不能相加。方向/结构每层互斥剔除数量、真实 cohort 和 risk admission 分组拒绝数尚缺完整 trace。机器索引保留原始口径。

### 资本算式（USD 名义金额，不乘第二遍杠杆）

| 指标 | 12:27:48 capital | 12:33:18 capital |
|---|---:|---:|
| 权益 / gross 上限（100%） | 10488.6379 | 10504.7287 |
| gross | 10499.7308 | 10494.3129 |
| gross 可用 | 0（超 11.0929） | 10.4158 |
| LONG / SHORT | 4397.6697 / 6102.0611 | 4402.5226 / 6091.7903 |
| 单方向上限（50%） | 5244.3189 | 5252.3643 |
| LONG / SHORT 剩余 | 846.6492 / 0 | 849.8418 / 0 |
| 仓位数 / 上限 | 27 / 50 | 27 / 50 |
| pending risk / reserved / inFlight | 0 / 0 / 0 | 0 / 0 / 0 |

独立逐仓复算 `sum(abs(quantity*markPrice))` 与第二采样一致；27 个 cycle、27 个 underlying，无本次重复计数证据。人工仓仍占账户敞口是合理安全边界；移交不是风险消失。100% gross/50% direction 是当前配置，不能仅因拦单就判过度保守，亦无依据为了 E 段提高它们。

第二采样旧 cluster 上限 $3676.6550：BTC $3701.1341、OTHER:AVAX $4475.2209 已超过各自 cluster 上限；MEME $532.6864、AI $31.2542、DEFI $25.9506、EXCHANGE $47.8709、ETH_L1 $27.8326。其他逐 underlying 数值见索引。它们不是 PENGU/TIA 的第一阻断，因为 OTHER 按 underlying 分组；也不应把旧枚举分组称为完成了 V3.9.6 相关性压力测试，新 correlationVersion 仍空。

人工仓名义额 $10471.5571（约权益 99.68%），待接管 $22.7558。旧人工上限 4 笔/20% 权益已超，但 `preAiExecutionEnvelope.ts:53` 只在 tradeEconomics ENFORCE 下把它作为硬门；当前 SHADOW 不能声称是它挡住此次 PRIMARY。新风险 profile 的 human limits 全零且未 configured，尚无可用压力/接管容量结论。

保证金币种事实：27/27 position.marginAsset=null，maintenanceMarginUsd=null。按**合约后缀**汇总 USDT $10396.8796、USDC $97.4332，仅是名义合约分布，不是已验证保证金归属。`portfolioRiskLedger.ts:112` 把未知 marginAsset 默认 USDT；`:94` 把未兑换 availableBalance 当 availableMarginUsd（实测 BTC 0.01，usdValue 约 870.915）。这构成后续写前 P1 事实/单位缺口，当前未执行 admit，不能宣称已发生错误建仓。

## 5. 网络与稳定性

当前真实 proxy budget AVAILABLE，queue=0、blockedUntil=0；第一采样保守 observed weight 230/6000（3.83%），不是限流证据。418=3、429=17 两次相同，lastLimitedAt 早于本实例，不能误报本轮遭封禁。weight observationTrust=INCONSISTENT，限制了精确用量归因；不能称“网络完全健康”。

当前 WS LIVE、reconnects/gaps=0；采样 subscriptions 333→353、cumulative 343→373。只能说观测点最大 353，不能称全窗口峰值。后台 queue timeout/transport timeout、旧 observer manifest mismatch 仍需保留为观测缺口，不把非致命错误洗成全绿。

24h 必须绑定当前实例、build、settings 与重建后账本；最早连续性锚点为 **09-23 11:57:37.818**。此前崩溃/旧账本窗口不拼接；只有覆盖完整、身份无变更的证据才允许以该锚点计算。当前并未启动经授权的 24h 采集任务，不能回填“已完成正式 soak”。health.shadow 仍带旧 startAt、约 6.25 天 elapsed、数十万 samples，**不能作为本次 V3.9.6 合格时长**。

SHADOW_STABLE 缺少持续时间、当前构建完整证据覆盖以及自然 AI/TradePlan/退出观察。有限写还缺 profile、保证金/现金流等事实闭合和独立审批。时间流逝、READY、自然资本候选任一单项均不充分。

## 6. 驾驶舱状态裁决与最小修复边界

根源：`runtimeControlService.ts:128` 将无资本候选压成 NO_EXECUTABLE_CONTRACT 文案；`aiResourceHealth.ts` 把不可派发长期 idle 返回 READY；`appRuntime.ts:1889` 用 canDispatch/ready 推导 scheduler RUNNING；OverviewView.vue:146 直接展示 reasonText。资本 summary.reasonCounts 第一采样还保留 EXECUTABLE=6，虽实际 count=0，是前后预检层口径未对齐。

**30 分钟是必须展示并进一步分类的阈值，不是统一 AI_OFFLINE 告警。** 同时显示运行权限、全局/本实例最后分析、静默时间、第一阻断层及并存原因、freshness、资本可执行数、候选/派发心跳和模型 probe 时间。无需新增模型调用。

主状态按下列顺序选一，次要阻断保留列表；安全告警可覆盖主状态：

| 状态 | 条件与等级 |
|---|---|
| CRITICAL_SAFETY | 裸仓/TP失配、非授权写、事实矛盾已危及执行；CRITICAL，立即人工处理 |
| POLICY_DISABLED | READ_ONLY/显式暂停禁止自动分析；INFO，并明确“已 X 分钟未分析”；不得伪称持续 AI 扫描 |
| FACTS_BLOCKED | 私有事实过期/关键身份或账务不完整；DEGRADED；明确 fail-closed |
| MODEL_UNREACHABLE | 新鲜健康探测失败且需要工作；DEGRADED，不与无候选混淆 |
| BUDGET_OR_COOLDOWN | 明确预算/队列/冷却约束，显示恢复条件；短期 INFO，超过期限 WARNING |
| NO_SUPPLY / RULE_FILTERED | 供应心跳新鲜，无候选/均被确定规则过滤；INFO，30 分钟后必须解释 |
| CAPACITY_BLOCKED | 候选存在但组合预算无余量；WARNING，显示额度与占用，不提示降低阈值 |
| DISPATCH_STALLED | 权限允许、事实新鲜、可派发持续存在，但缺调度进展；DEGRADED |
| SILENCE_UNKNOWN | 关键心跳缺失，不能证明任何前述原因；DEGRADED，不能回落 READY |

当前主状态应为 POLICY_DISABLED；第一采样并列 CAPACITY_BLOCKED，第二采样改为“资本预检 2，最终写入资格未验证”。模型 ONLINE 是单独维度。

## 7. 缺陷与后续顺序（本轮不实施）

| 优先级 | 裁决及最小边界 | 验收证据 |
|---|---|---|
| P0 | 本窗口未发现新增 P0；不等于所有执行路径验收通过 | 保持逐仓保护、未知风险和写边界观测 |
| P1-1 | 驾驶舱/阶段报告遗漏 READ_ONLY 分析门，错误继承“只等候选” | 同权限、资本 0→正的反例，状态仍明确禁用分析；新鲜派发心跳才能证明调度活着 |
| P1-2 | 风险 profile 未配置，有限写条件不成立；属于部署前置未完成 | 显式审批参数与场景/相关性/保证金档位版本；现金流覆盖、事实 TTL、risk ticket 均可验证；不得填默认凑通过 |
| P1-3 | 风险事实未知币种默认 USDT、availableMarginUsd 单位不成立 | 保留 UNKNOWN；真实币种/兑换率/时间戳与维持保证金可追溯；USDC、BTC 夹具反证；审计独立复算 |
| P1-4 | 验收计时和层级计数混用历史/current、pre/post gate | 实例/build/settings/账本版本绑定；旧 shadow 计数隔离；candidate trace 与首因一致 |
| P2 | cohort/retention API缺口、3 zombie、budget trust不一致、observer失效 | 明确实测范围；同代成员清单及订阅/retention核对；独立区分网络超时与限流 |
| P2 | aiExitAllowSmallLoss=false 与此前用户“论点失效可平0–10小亏”目标不同 | 设置有效性对照与人工确认，未激活功能前不改变线上开关 |

下一步顺序：先修正只读观测与验收语义 → 修风险事实/单位并补受控测试 → 完成经审批 profile 与覆盖事实 → 在明确授权范围内验证分析/TradePlan，自然候选不是强制成交 → 证据充分后单独申请有限 Testnet 写 → 完整运行/经济样本后再评估 ENFORCE。不得把 READ_ONLY 直接改成 TESTNET_ENABLED 当作“修 AI 静默”。

本轮仅阅读 GitHub/source、本机 GET、日志与只读 SQLite；未运行产品测试/构建、未调用 Engine 生命周期、未改 live Settings/DB/code、未切 ENFORCE、未由审计发出交易所写请求。仅新增本报告及证据索引；通知通过用户指定脚本执行。
