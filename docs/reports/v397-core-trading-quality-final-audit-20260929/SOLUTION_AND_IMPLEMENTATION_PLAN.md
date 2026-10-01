# SOLUTION_AND_IMPLEMENTATION_PLAN

状态：READY_FOR_REVIEW。本文件是后续交易质量改进方案；本轮只实施 ROOT_CAUSE_REPORT 所列上一轮 P1–P7 收尾补丁，没有上线下述新 sizing、方向或退出策略。

## 1. 决策依据与反驳

1. **不把保证金 200 自动改译为每单 notional 200。** 当前两个 200 分别是建仓保证金、动态保证金基准；新合同必须分开表达 minimum order notional、target allocation 和 maximum affordable amount。建议 TESTNET 新订单最低名义金额为 200 quote units，作为明确新业务设置交付审核；USDC 不在未知汇率下冒充 USD。
2. **不再机械放大所有订单，也不把 confidence 直接线性映射为金额。** 自然样本中模型已经自主输出最小 quantityUnits，执行链没有缩量。问题是缺少可审计的资本配置目标；放大同样不佳的入场只会放大盈亏。
3. **不靠拉远 TP 凑 1 美元，也不统一拉近所有 TP。** 小名义金额乘正常价格移动本来只能得到几美分；旧仓还保留此前远目标。要共同设计规模、目标、期限和退出成本，并保留授权来源。
4. **不因近期方向命中偏低就翻转 LONG/SHORT。** 当前未成交样本及长窗口覆盖不足，置信度样本分布集中，无法证明反向模型有优势。先补完整、无成交选择偏差的基准和对照。
5. **不重新引入 Gross/Direction/Cluster/slot/Human/UNKNOWN 门禁。** 这些数据仅审计。真实可用余额、交易所规则、私有事实真实性、授权身份、幂等和环境隔离继续有效。

## 2. 单一交易经济合同

在 `packages/contracts/src` 新增版本化 `EntryEconomicMandate`，挂在 packet / decision / TradePlan / intent，版本不可混用：

- identity：environment/account、settingsVersion、mandateId、runId、packetId、symbol、quoteAsset、observedAt、expiresAt。
- 规模：`minimumOrderNotionalQuote`、`targetNotionalQuote`、`selectedNotionalQuote`、`selectedQuantityUnits`、stepSize、`authorizedPriceRange`、`requiredInitialMarginQuote`、leverage、资金/filters 事实版本。
- 可用余额：exchange available、仍未提交本地承诺、当前分析 earmark，分别列出；不得再次扣除已反映在交易所 availableBalance 中的历史 UNKNOWN/持仓。
- 经济目标：原模型目标价和范围、target horizon、费用假设、funding/FX/depth coverage、目标条件净收益、目标触达统计、未知项。将“到目标时净收益”和“无条件期望收益”严格分开。
- 选择理由：size rationale、比较过的合法规模/目标组合、与用户 minimum/target 的关系；confidence 只是特征，不是收益概率或自动放大系数。
- 变更证据：original choice、normalized choice、final execution facts、first divergence stage、原因、是否需要新授权。

推荐新增 TESTNET 设置 `entry.minimumOrderNotionalByQuote = {USDT: 200, USDC: 200}`，明确这是新业务政策，**不是从旧 200 字段迁移推断出来的事实**。旧 `entryMarginUsd/baseMarginUsd` 保留兼容读取，UI 改为清楚的保证金目标说明；旧数据 mandateVersion=LEGACY_UNKNOWN，不能伪填新合同。

`minimumOrderNotionalQuote` 是单笔原始订单金额要求，不是最小已成交金额；交易所部分成交后取消可以小于 200，不能补单制造达标。ADD 是独立新授权，不能用当前持仓总额替代本次订单金额。

## 3. 建仓数量与资金配置实施

涉及 `preAiExecutionEnvelope.ts`、`aiQuantityAllocation.ts`、`entryCoordinator.ts`、`quantityHorizonCandidates.ts`、`tradePlanService.ts`、`packages/core/src/compactEntry.ts`、资金承诺和 Adapter。

1. 先以权威 filters、价格范围、真实 available funds 算出合法数量区间。业务 minimum 与交易所 minimum 分列；最小数量以授权价格范围内最不利的最低 notional 校验价计算，精确 decimal/integer units，避免浮点使合法下限差 1 unit。
2. 将保证金基准作为资本配置上下文，而不是偷偷改写模型数量的第二权威。展示可选规模的资金占用、费用、目标条件净收益、可达性和期限；候选规模必须覆盖 minimum 到真实可负担范围，不能只给最小合法值。
3. Primary 必须同时选择方向、quantityUnits、目标及期限，并说明规模依据。未形成明确配置理由时保留决策失败/等待事实，不能后台填入 $5 默认单。
4. 模型回包后只有校验与物化；不以 confidence、Gross、方向比例、历史 claim、数量槽位重新缩量或翻转方向。协议错误明确归因，不伪装为无资金。
5. TradePlan → Reservation → Intent → JIT → Adapter 使用同一个冻结数量。资金不足时明确拒绝/等待；不自动缩成 minimum。价格重定价导致 notional 不满足业务 minimum、资金或 exchange filters 时，记录原授权已不可执行，需新的模型授权；不在旧 identity 下改变 payload。
6. 最终 submit 记录真实请求 quantity/price/orderType/timeInForce/clientOrderId（禁止记录 key/signature），及响应 origQty/price/cumQty；本次审计中只能由 Adapter 代码与远端返回间接覆盖的 wire 字节断点在此补全。
7. 对 USDC 的 quote 名义金额使用 USDC；若产品要真正执行“USD 200”，必须提供时间戳明确的 FX 换算与缺失行为，不默认 1:1。

## 4. TP 经济性及持仓生命周期

涉及 `tpTargetContract.ts`、`tpGuardian.ts`、TradePlan、`positionReviewRunner.ts`、`v396AiExitRunner.ts`、`s04ExitCoordinator.ts`。

- 新仓仍执行有效且授权的目标。可达性不足、目标利润过低应进入显式经济评价和计划选择，不能通过 Guardian 后置推远价格凑利润。
- `SHADOW` 全链只记录经济不满足；`ENFORCE` 只按已声明的经济合同执行。UI 同时显示模式和实际执行阶段，禁止上游 SHADOW、下游暗中强制。
- 存储 original target/range、selected target、rounded exchange target、fallback target 和原因。价格合法对齐的偏移需可量化；无有效目标时采用显式 fallback，不能伪称 AI 目标。
- 老仓已有 TP 不因 migration 批量取消或重挂；逐周期提供原目标、当前距离、年龄、owner、可证明的成本和建议，走既有授权通道。
- 将 entry authorization TTL（目前模型多为 1 分钟）与持仓目标期限、Review 期限拆开。分析时延不应被当成入场有效期；新鲜事实复核失败需要新的独立决策，不能延长旧授权造单。
- 在 TESTNET 先启用 `positionReviewEnabled` 的自然 SHADOW 运行，验证资源分配、每周期 budget、超时、过期结果 discard、HOLD/REDUCE/EXIT/HANDOFF 落盘；观察样本充足且事实可证明后，按已审核策略将 AI_EXIT 从 SHADOW 切换到 ENFORCE。
- Exit ENFORCE 必须保留已有成本、身份、quantity claim 和 owner 权限边界；历史 HUMAN/HANDOFF 不被迁移成 AI_ACTIVE。funding/FX/深度未知不能伪造为 0，也不能反向禁止 Entry。
- 生命周期到期必须形成明确 outcome：继续持有及下次 Review、缩减/退出、或需要人工处理。目标过期不是无限期无声持有；不能以强制成交作为验收。

## 5. 方向质量与成交选择偏差

涉及 AI archive、`TradingQualityCollector`、decision episodes、mark retention、Analytics API。

1. 对所有具备明确方向的 Primary 决策记录观察计划，包含未下单、等待、拒绝、超时、撤单、部分成交与成交；无方向决定单独列出，不强配 LONG/SHORT。
2. 统一五个基准时刻：input quote、model completion、submit、first fill、complete fill。分别计算 15m/1h/4h/12h/24h signed return、MFE/MAE 和报价/成交成本，输出分母、成熟度、gap、删失状态。
3. 行情保留应覆盖最长 24h outcome + 补算缓冲；当前仅有短窗口完整观察不能被读成模型没有亏损。存储容量规划与压缩聚合需保留每桶 high/low/coverage，不能用稀疏 close 假称完整 MFE。
4. 按 symbol、quote、LONG/SHORT、regime、confidence bucket、model/prompt/build、filled/unfilled 分层；使用同时间段匹配组，禁止把强市 LONG 与弱市 SHORT 混比。
5. 原始回包和 normalized 必须分别保留 side、qty、目标和理由。Scout 的方向/证据与 Primary 独立存档，报告冲突频率及各组结果；不能仅根据 `scoutHandoff=false` 判断没有 Scout。
6. 校准要用时间隔离的训练/验证窗口、相关样本按 symbol/time cluster 去重、置信区间和基准策略。建议观察至少 7 个完整自然日且每个关键组有可用成熟样本；不足继续 UNKNOWN，不为凑数量下单。
7. 只有证据显示输入滞后、模型偏差、maker adverse selection 或 schema 改写中的哪一层有问题，才针对那一层迭代 prompt/模型/有效期/执行方式。禁止直接逆转方向、延长所有 TTL 或扩大资金。

## 6. API / Dashboard / 审计

- Entry 行并列显示 Qty、Price、Order Notional（quote单位）、Initial Margin、Leverage、Min order notional、AI target allocation，杜绝把保证金 200 标成最低订单 200。
- 每个 Intent 提供经济链 readback：input → raw → normalized → plan → reservation → JIT → request → remote order/fill；所有数值有 identity 和事实时间。
- TP 卡分开“远端挂单覆盖”与“经济性/期限/可达性”，低净收益和远目标都可见。不能用 100% coverage 表示高质量退出。
- Entry/Exit 用唯一 order、唯一 exchange tradeId、唯一 physical cycle 分别统计，fill count 不是 cycle 关闭率；给出右删失持仓年龄及同批入场的关闭比例。
- UNKNOWN 分为资金读数、提交身份、历史审计；只有真实未提交承诺参与可用资金扣减。Dashboard 与最终 permit 使用同一投影定义。
- 增加 first-divergence、授权过期、模型用时、submit/fill 延迟、模型选 minimum 比例、按 quote 的资本占用和小仓固定服务成本。

### 6.1 执行时钟和期限服务

把 quoteAt、packetAt、modelStart/modelEnd、intentAt、wireStart/ACK、firstFill、cancelRequested/cancelConfirmed 分开记录。入场 horizon 从哪个时间锚定必须写进授权，不通过延长旧授权掩盖迟到成交。`reviewPending` 应先处理接近到期的真实活单，再以有界批次查询历史 UNKNOWN；测试大量旧查询超时不会使新单 TTL 饿死。过期前发起 cancel 不等于保证不会有竞态成交，仍须 exact order / fill 终态收敛。

保留 originalLimitPrice、每次 reprice、最终 fillVWAP 三个独立事实，Dashboard 不再以同一个 price 字段混用下单金额与成交金额。出口校验拒绝属于本地未发送，必须与响应丢失后的 UNKNOWN 分开；不能把两次查询不到当作远端终态证明。

## 7. 迁移与历史兼容

迁移前停止 TESTNET 并复制 SQLite 主文件及 WAL/SHM、实例身份和只读摘要。事务式、可重复执行、带 schema version；保留旧记录与新 projection 的映射，禁止物理删除历史订单/成交。

- 不把旧 margin=200 回填为旧订单 minimum=200。
- 不将旧 TP 的 $1 推导范围改写成模型原始授权范围；只有仍存 raw archive 并有 exact run/plan identity 时才能生成附加证据。
- 不把缺失 funding/FX、旧 cycle 零边界、未记录 wire request、未成交行情补为 0 或“已验证”。
- 所有 runtime checkpoint 与 execution journal/trade_records 副本都做恢复顺序测试，防止本轮遇到的“先恢复、后被旧副本覆盖”。
- schema round-trip、二次 open、崩溃恢复、同一填单重放、跨账户同 incomeId、历史枚举/零剩余 TP 必须在真实 SQLite 隔离副本验收。

## 8. 一次性实施顺序与验收

按以下顺序完整交付，不把仅有 primitives 或单测通过称为完成：

1. 固定 main SHA，保存当前 Settings/readback/DB 基线，建立隔离工作树。
2. 完成合同、设置单位和兼容 schema；同时实现 API 和数据持久化。
3. 接通模型上下文、预算选择与 frozen sizing，完成最低金额和价格边界校验。
4. 接通 submit/remote request parity 及经济链 readback；测试 side 不变、数量不变、margin 正确、无重复 wire。
5. TP 来源/范围/费用/期限统一，明确 SHADOW 与 ENFORCE，补 Review 和退出 outcome 全链。
6. 完成所有决策的独立方向观察、存储覆盖和分层统计。
7. 完成 UI、迁移、故障恢复和不确定性展示；检查 TESTNET funds-only 无新增风险 veto。
8. 跑 targeted tests、全 workspace tests、typecheck、正式 build、`npm run verify`、S00、storage、schema round-trip、diff check；失败先修复，不跳过。
9. commit + 普通 fast-forward push main；加载已推送代码，完成 READY、source/artifact/runtime 六项 identity、SQLite/readback、Settings version 和 Production boundary 验证。
10. 至少 20 个新 build 自然 Entry 逐层证明 min/qty/side/price/margin 与 wire/remote 一致，另外保留不能执行的自然样本及第一拒绝原因。不得强制生成订单或成交。提供 1h/6h/24h 和后续成熟方向窗口，样本不足明确未完成的统计项。

Definition of Done：合同从 UI 到 remote order 单一一致；合法且有真实资金的模型选择不被非资金风险 veto；最低订单金额在最终价格上生效；没有隐性放大/缩量/翻转；TP原授权和 fallback 可追溯；Review/Exit 的真实运行事实与配置一致；新周期 ledger 守恒、资金费未知不伪装已知；方向观察包含未成交且覆盖明示；主分支、运行 build、报告、证据一致。

## 9. 授权、回退与边界

**后续实施模型可按工程需要随时 stop/start/restart 当前 TESTNET 系统，不需要逐次申请重启授权。** 使用现有 `scripts/stop-zdj-lan.ps1` 和 `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`；不安装 autostart/watchdog，不用 dev/watch 指向 live data。发现健康探测失败先查进程/事件/事实，不用无条件自动重启循环替代诊断。

仍禁止任何 Production 写入、Production credentials/transport/data path 混用。不得为了验收制造订单或成交。新策略实施以本计划审核后的授权为前提；本轮补丁不替代新策略审核。

回退采用新提交 revert 并普通 push，禁止 force/rebase 改写 main。停止 TESTNET，保存失败实例和最新库后部署已验证代码；数据 schema 必须前后兼容或执行经过验证的逆迁移，不能直接把旧备份盖回活库而丢失期间真实成交。Settings 版本回退和代码回退分开记录；保持已有仓位与 TP 的事实及后续维护。
