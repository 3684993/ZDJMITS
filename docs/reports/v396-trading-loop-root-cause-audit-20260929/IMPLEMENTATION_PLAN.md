# V3.9.6 交易闭环后续实施计划

状态：**供审核，未实施**。依据同目录 [ROOT_CAUSE_REPORT.md](ROOT_CAUSE_REPORT.md)，审计基准 `1e39fc8283c4618c46e4e3d0e5cce421e10d3f9c`。

本计划由当前代码、运行事件、两份SQLite和驾驶舱readback独立推导；不把提示中的怀疑或上一轮修复声明当验收结论。实施者必须再次确认基准、当前实例、数据与用户授权；本轮授权不包含未来改代码、改配置、修数据库或重启。

## 1. 建议与优先级

先修**退出终态收敛与账本守恒**，同时修**残留跨Intent Entry veto**；再统一事实投影、TP决策契约与AI复核。直接更换模型、缩短TP、放开AI_EXIT_ENFORCE都不能解决已证实的旧claim和cycle错误。

| 阶段 | 目标 | 对应根因 | 前置 / 建议优先级 |
|---|---|---|---|
| P0 | 固定可重放基线与验收口径 | 全部 | 首先 / 必须 |
| P1 | Exit终态单一入口＋公平收敛，恢复可靠TP维护 | R3 | P0 / 高 |
| P2 | 聚合positionCycle与Entry lots分离，修复退出归因/Closed Trade | R4/R5 | P0；与P1共享身份契约 / 高 |
| P3 | 拆开新Entry身份幂等与历史scope风险排他 | R6 | P0 / 高，可独立交付 |
| P4 | 统一Entry admission与容量投影，lease按承诺计量 | R8/R9/R10 | P3；P2身份确定 / 中 |
| P5 | 建立一致的TP/亏损退出/人工接管职责契约 | R1/R2 | P1/P2；策略另审 / 高但不可抢先激活 |
| P6 | 补齐funding/FX/depth事实，再验证持仓复核资源保障 | R7/R1 | P1/P2/P5；启用另审 |
| P7 | 生命周期时长、健康与审计UI，完成受控回归/上线 | R8/R11 | 事实契约确定；UI可并行但不能先自造真相 |

不按“Entry多/Exit少”强行要求固定成交比率。订单是否成交由市场决定；工程验收应以事实传播有界、授权清晰、维护可达、无重复单、账本守恒为标准。

## 2. 永久保留的边界

1. TESTNET_FUNDS_ONLY只对精确 `environment=TESTNET && executionMode=TESTNET_ENABLED` 生效。Production仍保持独立凭据/环境/transport写锁与原授权；不得为了测试改线上环境。
2. 真实可用资金/保证金及未提交真实承诺原子核验；symbol filters、tick/step/minQty/minNotional、合法杠杆、exchange reject不能绕过。
3. 私有账户/持仓及必要市场事实的来源、身份、新鲜度、覆盖必须可验证。UNKNOWN不应变成伪造0、伪造成功或伪造不存在。
4. 同一个决定/Intent/clientOrderId的未知提交必须查询原身份，不重复下单。**跨Intent历史风险排他与同单幂等不是一个控制**。
5. Exit必须证明只减仓，包含hedge/one-way语义、fresh reduction proof、任务身份/数量预算；不得以修复R3为由释放所有未知Exit claims。
6. 不擅自接管HUMAN/HANDOFF仓。AI权限、允许小亏/最大管理时长/SL类型属于显式策略决策，不隐藏在bugfix中。
7. 不延长旧授权、不放大冻结量、不改价格带、不伪造fills、不删除不守恒记录让统计“变好”。

## 3. P0：可重放审计基线

实施工作在干净隔离worktree，记录source SHA、Settings版本/hash、source/artifact identity、环境、时间窗口、两库schema版本。用正式备份或只读事务制作脱敏fixture，不直接复制secrets到仓库。运行数据修复与业务发布分成两个独立的可审核命令。

至少固定五组真实形状：

- BRUSDT / NEARUSDT / WLDUSDT：本地TP FILLED、durable task WORKING、claim ACTIVE；保存原始client/exchange/trade ID与每层updatedAt。
- 多笔同symbol/side加仓、一个聚合全仓TP；以及完全归零后再次Entry的新cycle。
- INJ `airun_mulvpfnw_7fuwyerd`：新reserve有效、journal撞旧scope、错误包装RESERVATION_INVALID。
- NOT_APPLICABLE风险ceiling=0而真实route容量>0、slot>max且OBSERVE、Human cap误报。
- maker不可达→60s授权过期；模型前lease约全quote资金、实际订单约$5。

数据验证包括查询覆盖、排序/去重规则、窗口边界；把无事实和事实为零分开。将逐次修复的受影响键、前后hash、审计事件写入独立变更记录。拒绝全表“状态改成已关闭”。

## 4. P1：Exit任务终态传播与公平收敛

主要文件：`services/v396ExitRuntime.ts`、`s04ExitCoordinator.ts`、`reconciliationService.ts`、`tpGuardian.ts`、`positionService.ts`、`runtime/appRuntime.ts`。

### 设计

- 统一 `VerifiedExitOrderFact` 输入：environment/account/symbol/positionSide、clientOrderId/exchangeOrderId、originalQty/executedQty、原始exchange status、event ID/sequence、source、observedAt和覆盖证明。
- WS、exact-order查询、普通reconciliation、startup recovery、TP cancel/replace都送同一个幂等fact reducer；订单投影与durable task/claim终态使用可靠事务/outbox连接。不能仅在 `TpGuardian.place/cancel` 成功时更新coordinator。
- 满足严格identity和终态证明后才能释放剩余claim；部分成交更新剩余量，终态乱序不得从FILLED退回WORKING。旧cycle任务的终态可以独立收敛，不要求当前position仍存在。
- `convergePeriodically` 用lastAttemptAt/nextEligibleAt公平优先队列或持久轮转游标，禁止每轮固定slice前8。长时间WORKING也必须轮转；失败指数退避不阻塞其它任务；queue容量/未轮询最久年龄进入readback。
- 建议未失败任务最大服务间隔由 `ceil(N/batchLimit)×interval + 请求预算余量` 推导并公开；不是固定“所有任务2分钟内”这种在51项/8项配置下无法成立的承诺。终态WS路径应在正常flush时限内推进。
- 不把quantity预算放松为“按cycle忽略其它scope订单”：确有另一周期未终态订单时仍可能减少当前物理仓，必须先证明其状态。

### 数据修复

提供preview：列出local-terminal/durable-open差异、精确身份匹配、证据引用、预计claim变化、可能受影响的新周期。不确定远端状态必须精确查询后再apply；“本地FILLED”本身不自动具备完整修复权。apply要求显式授权、幂等key、事务/outbox、审计记录；失败可停止并重新preview，不能回滚成伪WORKING而掩盖真实终态。

### 验收

- ≥51个open任务，前8一直WORKING；尾部FILLED必须在一轮完整轮转内获得查询，且claim变RELEASED。
- 两种position mode、partial-fill后cancel、lost ACK、重复/乱序WS、重启、ABSENT不可证明、查询超时、旧cycle与新仓重开。
- 三个真实形状的旧claim有证据收敛后，新仓TP可prepare；仍未知的老单不可重复发。
- 零净加仓Exit、零重复client identity、零无证据claim释放。保护缺口归零并非唯一标准，须验证量/side/identity都匹配。

## 5. P2：生命周期、加仓lot与成交归因

主要文件：`positionLifecycleTracker.ts`、`positionService.ts`、`cycleAccounting.ts`、`entryCoordinator.ts`、TradePlan/ExecutedPlan模型、`tradeRecordSyncService.ts`、`api/projections.ts`。

### 推荐模型

**物理positionCycle**表示同环境/账户/symbol/side连续非零区间；**Entry lot / execution plan**表示每次独立入场授权。加仓产生新lot/plan，不必产生新的物理持仓周期；只有经可信事实证明归零后重开才换positionCycle。所有表显式存两个键，避免一个cycleId承担两种语义。

- 新加仓Intent保持独立幂等identity与不可变TradePlan；在实际fill时依据已有positionCycle进行lot归属。并发首次fill、先WS后order ACK、重启恢复都必须原子绑定。
- 聚合TP按物理仓减少真实数量；退出fills通过确定性、预先定义的lot分配规则（建议FIFO用于会计分摊，策略归因另存）关联各Entry lot。必须保留实际exchange fill一份，分摊明细不能复制它为多个“真实成交”。
- 整体守恒：累计Entry - 累计Exit = 远端剩余量（允许symbol step tolerance）；lot费用与收益分摊和不得改变原始账户总额。
- `recordExchangeFill.systemProven` 从统一durable order registry证明系统来源，不能仅靠v396x前缀放行。registry与scope/cycle冲突时UNRESOLVED；symbol/orderId须联合使用。
- CLOSED trade与canonical net-with-funding eligibility分离：数量闭合可以CLOSED但net unknown；不因funding未知假填0，也不因unknown funding伪造未退出。
- `PARTIALLY_CLOSED`剩余负数应标LEDGER_INCONSISTENT及原因，不当成正常“还有负仓位”。

### 历史修复

按环境/账户/symbol/side、exchange tradeId和position归零边界重建，不能按symbol全历史一锅合并。无法证明的边界留下显式coverage缺口。保留原record为superseded且有旧新mapping，不物理删除；展示默认canonical行，审计可追原始行。现有HUMAN归属/mandate不可因重新建账被重置为AI_ACTIVE。

### 验收

- 6+6+6 Entry，整仓18 Exit；2+2+2→6；10+…→41。最终物理cycle闭合、lot各自数量守恒、手续费/PnL和保持不变。
- 部分平仓→加仓→再平、完全归零→重开、双向持仓、两个quote合约、外部加仓、晚到历史fill、重复导入。
- 每个系统v396x订单有exact provenance；随机伪v396x不得被认作系统单。
- Dashboard Exit fill原始数量与registry归因/closed统计分别解释；closed不再因多lot单cycle误连而丢失。

## 6. P3：修掉残留 Entry veto，保留真正幂等

主要文件：`config/settingsStore.ts:claimEntryExecution`及schema/migrations、`services/entryCoordinator.ts:submitExactlyOnce`、execution scope/helpers、相关recovery与claim tests。

- 划分 `SubmissionIdentity`（env/account/intentId/clientOrderId/payloadHash）与 `PortfolioScopeObservation`（underlying/方向/旧订单风险）。funds-only的新Intent获取提交权不能因另一个Intent的历史UNKNOWN/proof过期被拒绝。
- 同Intent已有SUBMITTING/UNKNOWN仍只允许exact-query恢复；same key不同payload必须拒绝；两个进程并发同Intent只允许一个wire submit。已释放旧identity禁止重新提交。
- 唯一索引与claim事务必须随契约迁移；仅在调用层增加一个if而保留scope unique index不能满足要求。Production legacy排他策略必须显式scope/模式化，不能无意全局移除。
- 若实际政策需要“同underlying仅一单”，必须命名为独立策略并另获确认；不能伪装为幂等暗中恢复用户已禁止的历史风险veto。
- 所有剩余未提交承诺仍从资金ledger扣除；交易所已接受订单以fresh availableBalance为资金事实，不把未知历史风险重复扣款。
- claim拒绝返回typed原因/冲突identity（安全投影），不得删除新order后统一叫SUBMISSION_UNKNOWN并在下一tick变成RESERVATION_INVALID。确定未发的新Intent应有 `NOT_SUBMITTED` 终态和原始cause链。

验收矩阵：当前funds-only + denied risk/missing profile/旧UNKNOWN/active历史claim/不同quote同underlying/旧proof过期 → 新Intent资金充足可进入submit；sameIntent重放、同client不同payload、跨进程竞争 → wire最多一次；资金不足/private stale/filters非法 →仍拒绝。**测试必须注入真实SettingsStore与SQLite unique index，不只mock journal**。使用隔离DB和mock adapter，禁止真实下单作为单测。

## 7. P4：Entry权限与资金投影简化

### 三种结果类型替代混合“risk”

1. `CandidateAnalysisEligibility`：市场选择、行情/模型/调度可用性；可等待、拒绝或可分析，不是订单提交权。
2. `EntryExecutionPermit`：模式/私有事实/资金承诺/合法filters/模型授权/身份/存储；含evaluatedAt、expiresAt、fact versions、当前策略模式。
3. `PortfolioRiskObservation`：Gross/Direction/Cluster/Human/Stress/history，明确 `enforced=false`，绝不被前两者通过零ceiling或旧fallback重新消费。

共享纯函数规范输入/结果，避免Capital Admission、Risk、Readiness、Reservation、Final Submit各自发明字段。**仍保留reservation事务和submit前JIT重新读取**；共享规则不等于共享过期pass。E09资本版本拆成资金事实版本、市场filters版本和portfolio观察版本，后者在funds-only不使许可失效。

### 资金与lease

- 统一每asset的exchange available、未提交真实reservation、analysis earmark、available-for-new-reservation；明确当前Intent排除自身lease/reserve的规则。
- 推荐分析阶段发布可承担的上界但不独占全余额；模型返回后以原子reservation裁定真实数量。若为保证模型输出可执行而需要lease，按候选资金预算/分配额度承诺，并明确上界不构成实际订单规模。选择方案需用并发试验衡量冲突重分析成本，而不是自动加大仓位。
- 对analysis lease保留owner、created/expires/lastTouch、释放原因，one owner/one debit；new permit不得默默延长授权以等待余额。
- 原有route余额与即时余额不得混用同一个“可用”标签；readback响应携带统一asOf或显式多源时间。

### UI/漏斗

- NOT_APPLICABLE的风险ceiling必须null/absent，不是0；UI取entryCapacity真实资金上界。`PLANNED_NOTIONAL`显示“计划量为限制因素”，不要称“阻断”。
- slot/count/Human caps在funds-only明确OBSERVE，移除假 `newEntryBlockedByCaps` 权威表述。原始计数不删。
- 风险与经济shadow观察独立于必经漏斗；stage用NOT_REQUIRED/OBSERVED，不伪造allowed通过。漏斗以run/intent/order的稳定identity去重，标窗口/留存/未闭合。
- 错误链保留primary cause、surface reason、stage与retryability；RESERVATION_INVALID不能覆盖journal冲突。
- 逐候选折叠状态、空数组、无route、加载失败分别显示。不得为填表假造候选。

### 授权时序

记录packet事实时刻、scout/primary排队与耗时、decision完成、intent创建、lease/reserve期限、第一次WAIT、首次submit。只在新模型授权或明确规则下重新授权；禁止简单把60s改成很长掩盖价格漂移。优化prompt/推理延迟和决策时盘口新鲜度，验证授权带与maker trade evidence的一致性；不可取消后者来追求转化率。

验收：E01–E30与D1–D3逐项表驱动；同一事实在各阶段相同理由，事实变更后JIT拒绝；在风险观测为NaN/UNKNOWN而资金facts可靠时，不能影响T Entry。UI测试使用真实Engine投影fixture而非手写预期形状。

## 8. P5：TP与持仓退出职责的独立方案

### 不建议的快捷做法

- **不建议为达到$1利润而强制放大仓位**：会改变模型授权与资金占用，且不能证明目标可达。
- **不建议把所有TP统一拉近/追价**：部分仓有人工mandate、旧亏损仓与新小仓原因不同，盲改可能覆盖已授权策略。
- **不建议直接打开AI Exit / smallLoss**：R7事实未就绪、R3/R4未闭环，打开也无法可靠退出；且HUMAN仓没有自动接管权。
- **不建议恢复Gross/slot作为退出修复的替代**：限制Entry数量不能修好已成交claim或Closed Trade；如要建立仓位增长策略，应另提策略方案而非重引入隐性risk veto。

### 推荐职责契约

- TradePlan明确市场目标、目标有效期、最晚复核/管理deadline、资金费/费用估计状态、自动与人工退出authority、TP mandate与risk-reduction权限。持仓累计时长不是止损承诺。
- TP目标优先来源必须明确可追溯；取消硬编码canary1.2%需作为显式策略版本变更评审，而非隐藏的工程重构。Entry经济性与Exit TP使用同一契约，避免Entry SHADOW接受$5计划、Guardian随后用强制$1重写成20%目标。
- 建议将“期望净利润目标”与“合法减仓权限”分开：市场结构/波动决定可解释的目标区间；费用模型报告在实际数量下的可得净利。小仓目标净利不足$1时如仍按当前funds-only策略入场，就记录经济警示并执行获授权目标，不应偷偷把目标推到不可验证远处。是否启用经济筛选属于策略决策，不能默认变成新组合风险门。
- 原AI horizon到期触发重新评估/明确HOLD/HANDOFF，不隐式无限延期。定义三种退出：获利TP、thesis失效减仓、超时/人工接管；各自authority和费用/亏损边界不同。
- 对HUMAN/HANDOFF仓保留减仓预览、保护状态、待处理年龄和责任人，未经明确交接不能自动退出。自动SL/Market fallback若需要，必须单独规格/授权，不把现有lossLimit误称为SL。

### 量化验证

离线重放当前55仓和已闭合周期：各size bucket的TP距离、相对ATR/历史reachable quantile、预期/实际净利、time-to-target、持有时长、max adverse/favorable excursion。保留不可观察和右删失（仍持仓）样本，不只统计赢家。分辨旧大亏仓与新小仓，不直接比较Entry/Exit counts推收益。

接受目标：TP没有未公开hardcoded覆盖；每次fallback含原目标/实际目标/原因/参数版本；long-running仓有按职责到期的复核或人工事件；有效保护无故丢失为0。盈利率/平仓频率只能作为实验结果，不能当工程保证。

## 9. P6：Exit facts与Review保障

- funding建立真实income ledger：account/environment/asset/收入ID、完整分页和时间覆盖、正负资金费、零发生的覆盖证明、cycle/lot分配。无法exact时保留UNKNOWN，避免把192个周期误称192条资金费。旧record修复按preview/apply且可重复运行。
- Exit depth从真实orderBook按方向、price bound和quantity计算可执行深度，携带ts/序列/覆盖；不要读取不存在的quote.depthNotionalUsd，亦不要填常数通过门禁。
- quoteAsset取实际仓/合约资产；USDC需要可验证FX或明确本位资产核算契约，禁止fx:null且一律USDT。
- 分离已实现结算PnL、预估退出净额、保护/减少风险的权限。可评审采用有证据的保守成本区间支持特定reduce策略，**不能把unknown资金费填0**；在未获策略批准前保留当前事实拒绝。
- Review启用前：只有合法AI_ACTIVE周期可调度；同Primary资源加入有界优先/预约份额与aging，Entry不能永远抢占；保留单模型最大并发，TP/reconciliation不等待AI。
- Review授权TTL从实际benchmark推导，ticket reserve时机和模型结果适用窗口分开；结果回来必须重核owner/deadline/事实版本，不以延长ticket永久授权。
- 管理deadline和计划复核budget持久化；关闭/失败/无数据均有可观察reason。每个周期显示最近复核时刻、下一次到期、失败次数和为何不再调用。

验收：完整生产形状端到端fixture（真实market schema，禁止只给quote手填depth）；USDT/USDC；funding exact/unknown/duplicate/pages missing；模型延迟/timeout、Entry持续队列、owner在调用中移交、人管零例行调用。先shadow观察再提启用申请；本计划不赋予执行权限。

## 10. P7：持有时长与健康展示

- Position/Human列表、移动卡片、详情统一展示 `连续持有 1天6小时`；以可信物理positionCycle.openedAt计算，定时更新而非只有刷新时变化。
- 加仓不重置，部分平仓不重置，确认归零重开重置；并列显示最后加仓/复核/人工接管时刻。导入或断线边界不确定时显示“至少…（首次观察）/未知”，不能伪称首笔成交。
- 同symbol不同side、账户、环境、重开周期必须有独立key；前端排序、展开行和缓存不能仅symbol。
- 健康拆成exchange ingestion、order terminal parity、exit claim convergence、position coverage、fill-cycle conservation、funding coverage；不能用一个SETTLED/HEALTHY遮住跨库漂移。
- “活动委托”明确列出remote-confirmed Entry、TP、manual、local unresolved；不要把UNKNOWN历史风险行与真实openOrders混算成交易所活跃单。
- 时长UI可在P2迁移前先展示来源可信度，但最终准确性依赖P2，不自创第二个cycle算法。

## 11. 回归、发布与运行验收

每阶段提交只包含对应功能和回归证据，不能混入Settings或数据修复。建议依序：

1. 离线针对性回归 → workspace typecheck → full verify/formal build → S00 → storage/backup测试 → diff/secret范围检查。
2. 回放同一fixture生成前后对照：claim、lot守恒、funding、veto、UI必须分别对账；差异有migration原因而非直接覆盖原事实。
3. Testnet/Production矩阵：funds-only只在T；P仍锁写；read-only不产生reservation/intent/order；mock错误（stale private/insufficient margin/invalid filters）均拒绝。
4. 生命周期操作需新一轮明确授权，使用现有manual start规则；不安装watch/guardian/autostart，不因health失败自动重启。
5. 数据修复preview先交审，再按授权apply；部署和修数据不是同一个批准。两库一致性和outbox恢复分别验证。
6. 加载后核对source/artifact/runtime identity，观察至少完整Exit公平轮转周期与若干真实自然Entry链。无需制造成交；已有事实重放可证明确定性路径，真实观察证明新实例接线。
7. 运行验收必须同时报告：最老未查询Exit任务年龄、终态未释放claim数、无保护仓/数量、cycle守恒差异、系统fill身份缺口、funding覆盖、Review权限/频率、Entry原因链与队列延迟。不要只报告RUNNING或测试通过。

回退：保留兼容读取与schema迁移策略；停用新入口需显式手动操作但继续既有TP/对账职责。不得回滚交易所已发生的事实、重新激活终态claim、重复发旧身份订单；数据修复失败则保持UNKNOWN与证据，不制造一致。

## 12. 审核需决定的产品事项

工程P1/P2/P3/P4与UI事实修复的目标明确；以下策略事项必须独立选择，不由实施模型私自定值：

- $1净利是软目标、经济筛选条件还是特定size适用目标；不建议全仓无条件用它反推远TP。
- 是否启用持仓复核与AI主动退出，允许哪些小亏/超时策略，HUMAN仓如何显式移交。
- TP/SL/limit/market fallback的权限范围；现有系统并无自动止损保证。
- lot分配规则及回溯可证范围；无法恢复的数据如何展示不确定性。

更换模型仅应在上述账本/事实/权限闭环后，通过固定数据集和执行仿真比较。否则模型得到不完整成本、无Exit权限或错误生命周期，模型再好也无法修复执行层问题。
