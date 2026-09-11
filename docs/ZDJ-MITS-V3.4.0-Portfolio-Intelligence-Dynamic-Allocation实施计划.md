# ZDJ-MITS V3.4.0
## Portfolio Intelligence & Dynamic Allocation 全量实施计划

> 项目目录：`D:\MITS`
> 基线：当前最新稳定 V3.3.x
> 本轮定位：组合智能、Underlying 去重、USDT/USDC 自动路由、动态保证金、动态杠杆、风险分层、方向策略、禁止追高追低、组合暴露控制。
> 原则：不重构已稳定的 Market / Pool / Scout / Primary / Entry / TP 主链，只在候选进入 AI 和 Entry 前增加组合级策略层。

---

## 1. 最终目标

把当前：

`Symbol Ranking → AI → Entry`

升级为：

`Market → Symbol Universe → Underlying Resolver → Risk Tier → Direction Policy → Portfolio Exposure Check → Entry Location Quality → Contract Router → Dynamic Margin/Leverage → Scout → Primary → AllocationPlan → Entry`

目标不是提高 PLACE 数量，而是降低重复风险、追高/追低、固定仓位和资金路由失衡。

---

## 2. Underlying 一级实体

新增：

- underlyingAsset
- quoteAsset
- contractSymbol

例如：

- ETHUSDT / ETHUSDC → ETH
- BTCUSDT / BTCUSDC → BTC
- XRPUSDT / XRPUSDC → XRP

同一轮 Pool 默认不得同时放入同 Underlying 的多个 quote 合约。

---

## 3. Underlying Exposure Policy

Settings 支持：

- BLOCK_ALL
- BLOCK_SAME_DIRECTION
- ALLOW_HEDGE

优先级由配置决定，不硬编码。

已有 ETHUSDT SHORT 时，ETHUSDC 是否允许再开仓必须经过 Underlying Policy，而不是只看 symbol 是否相同。

---

## 4. USDT / USDC Contract Router

新增：

Quote Asset Policy：

- AUTO
- USDT_ONLY
- USDC_ONLY

AUTO 根据：

- available margin
- spread
- depth
- 24h volume
- OI
- funding
- freshness
- minNotional
- execution reachability
- quote asset margin pressure

选择最终合约。

若 USDT available=0、USDC available>0，且同 underlying 的 USDC 合约质量合格，则优先 route 到 USDC；无合格 USDC 时跳过，不强制交易。

---

## 5. 同 Underlying 只产生一个最终 Candidate

旧：

ETHUSDT rank #5
ETHUSDC rank #8

新：

Underlying Candidate = ETH

内部包含可选 contracts，最终 Contract Router 只选一个 contract 进入 Scout / Primary。

---

## 6. 风险分层

新增 AssetRiskTier：

- CORE
- LIQUID_ALT
- SPECULATIVE
- NEW_LISTING
- RESTRICTED

UI 中文：

- 核心资产
- 高流动性山寨
- 高风险投机
- 新上市
- 禁止交易

禁止在代码内使用“空气币”作为主观硬标签。

---

## 7. Risk Tier 数据来源

至少基于：

- 24h quote volume
- spread
- depth
- OI
- funding
- ATR / volatility
- listing age
- price impact
- turnover
- data quality
- execution reachability

支持：

- AUTO
- MANUAL_OVERRIDE

---

## 8. Direction Policy

支持：

- BOTH
- LONG_BIASED
- SHORT_BIASED
- LONG_ONLY
- SHORT_ONLY
- DISABLED

优先级：

`Symbol Override > Risk Tier Override > Global Default`

BIASED 不是强制方向，只是调整 evidence/confidence/location 门槛。

---

## 9. Entry Location Quality

新增：

`EntryLocationScore = 0~100`

15m 继续决定主方向，但方向不等于“当前位置可以立即下单”。

至少结合：

- distanceToEMA21 / ATR
- BB percentile
- distanceToSupportResistance
- recentImpulse / ATR
- 1m / 5m pullback
- volume exhaustion
- funding crowding
- orderbook imbalance
- reachable price range

---

## 10. LONG 追高保护

若：

- 15m LONG
- price far above EMA21
- BB upper extreme
- recent impulse excessive
- near resistance
- 1m/5m 无回踩
- reachable pullback 不理想

则输出：

`LONG_OVEREXTENDED`

行为：

- 优先给更低 idealPrice / acceptablePriceRange；
- 若未来1~5m不可达 → REJECT_CANDIDATE；
- 禁止当前价硬追 LONG。

---

## 11. SHORT 追低保护

完全对称：

`SHORT_OVEREXTENDED`

若价格已严重偏离 EMA、接近下轨/支撑、下跌 impulse 过大，则不得低位追空。

---

## 12. Dynamic Margin Allocator

废除所有币固定 200U。

新增统一：

`DynamicMarginAllocator`

概念公式：

`targetMargin = baseMargin × riskTierFactor × liquidityFactor × volatilityFactor × confidenceFactor × locationFactor × portfolioExposureFactor`

最后：

`clamp(targetMargin, minExecutableMargin, maxMarginPerPosition)`

---

## 13. 最低可执行保证金

必须从交易所真实约束计算：

- minQty
- stepSize
- price
- minNotional
- leverage

计算：

`minExecutableMargin ≈ minExecutableNotional / leverage`

并增加合理 buffer。

---

## 14. Dynamic Leverage

新增：

`DynamicLeveragePolicy`

原则：

- 风险越高 → leverage 越低
- 波动越大 → leverage 越低
- 流动性越差 → leverage 越低

支持 Global / Tier / Symbol override。

---

## 15. Margin Mode Policy

支持：

- ISOLATED
- CROSS
- AUTO

新仓默认优先 ISOLATED 作为保守候选，但最终由 Settings 决定。

已有仓位禁止自动批量切换 margin mode。

---

## 16. Portfolio Exposure Budget

禁止重新引入简单 global maxPositions。

新增组合暴露约束：

- same underlying exposure
- LONG gross exposure
- SHORT gross exposure
- speculative exposure
- quote asset margin usage
- total margin usage

当 LONG 暴露过高时，新 LONG 可以：

- 降低 margin
- 提高 evidence threshold
- block

但不能让整个 AI 停止工作。

---

## 17. 高风险币集中度

新增：

- maxSpeculativeExposurePct
- maxSpeculativePositions

高风险币同方向暴露过高时，只限制同类新仓，不影响 CORE 或相反方向候选继续分析。

---

## 18. Portfolio Admission Decision

新增：

- ALLOW
- ALLOW_REDUCED_SIZE
- REJECT_DUPLICATE_UNDERLYING
- REJECT_EXPOSURE_LIMIT
- REJECT_QUOTE_MARGIN
- REJECT_RISK_TIER
- REJECT_LOCATION

必须进入 AI Audit / Dashboard。

---

## 19. AllocationPlan

最终 Entry 前生成：

- underlying
- symbol
- quoteAsset
- riskTier
- directionPolicy
- direction
- locationScore
- marginMode
- leverage
- marginUsd
- notionalUsd
- exposureBefore
- exposureAfter
- policySource

Primary PLACE + AllocationPlan 才允许 Entry。

AI 不得绕过硬约束。

---

## 20. Primary 输入增加 Portfolio Intelligence

EIP 增加：

- underlying
- selectedContract
- riskTier
- directionPolicy
- locationScore
- sameUnderlyingPosition
- quoteAssetAvailability
- recommendedMargin
- recommendedLeverage
- marginMode
- portfolioExposure

Primary 输出仍保持：

- direction = LONG | SHORT
- decision = PLACE_LONG | PLACE_SHORT | REJECT_CANDIDATE

---

## 21. Settings：组合与建仓策略

新增/扩展分组：

### Quote Asset
- AUTO
- USDT
- USDC

### Underlying Policy
- BLOCK_ALL
- BLOCK_SAME_DIRECTION
- ALLOW_HEDGE

### Dynamic Margin
- Enabled
- Base Margin
- Min Margin
- Max Margin
- Max Equity %
- Liquidity Weight
- Volatility Weight
- Confidence Weight
- Location Weight

### Dynamic Leverage
- Enabled
- CORE max
- LIQUID_ALT max
- SPECULATIVE max
- NEW_LISTING max

### Margin Mode
- Global
- Tier Override
- Symbol Override

### Direction Policy
- Global
- Tier
- Symbol Override

### Entry Location Protection
- Enabled
- Min Location Score
- Max EMA21 Distance ATR
- Max BB Percentile LONG
- Min BB Percentile SHORT
- Max Impulse ATR

### Portfolio Exposure
- Max Same Underlying
- Max LONG Exposure %
- Max SHORT Exposure %
- Max Speculative Exposure %
- Max Quote Asset Margin Usage %

---

## 22. Symbol Override

支持 Add / Edit / Delete。

例如：

BTC：
- tier CORE
- policy BOTH
- maxMargin 500
- maxLeverage 10

高风险币：
- policy SHORT_ONLY / SHORT_BIASED
- maxMargin 50
- maxLeverage 3

---

## 23. 智能选币页面升级

增加：

- Underlying
- Selected Contract
- Risk Tier
- Direction Policy
- Location Score
- Recommended Margin
- Recommended Leverage
- Quote Asset
- Existing Underlying Exposure

候选详情必须解释：

- 为什么选 USDT / USDC
- 为什么使用这个 margin
- 为什么这个 leverage
- 为什么被标记某 Tier
- 为什么 LONG/SHORT biased
- 为什么被 overextension gate 拦截

---

## 24. 驾驶舱 Portfolio Intelligence

增加：

- LONG exposure
- SHORT exposure
- CORE exposure
- Speculative exposure
- USDT margin usage
- USDC margin usage
- duplicate underlying blocks
- location blocks

报警：

- LONG 集中度过高
- 高风险币暴露过高
- USDT 保证金耗尽
- 同 Underlying 重复暴露
- 高位追多/低位追空阻断

报警不自动平仓。

---

## 25. Existing Positions

当前已有 33+ Position：

只用于 Exposure 计算。

禁止自动：

- 改 margin mode
- 改 leverage
- 批量平仓
- 批量改 TP

新规则只作用于新 Entry。

---

## 26. USDT available = 0 的行为

Contract Router：

1. 检查同 underlying USDC 合约；
2. 评估质量；
3. 检查 USDC available；
4. 合格则 route；
5. 不合格则 skip。

不得因为 USDT=0 全局停止所有新 Entry。

---

## 27. 测试

必须新增：

### Underlying
- ETHUSDT / ETHUSDC → ETH
- BLOCK_ALL
- BLOCK_SAME_DIRECTION
- ALLOW_HEDGE

### Contract Router
- USDT=0 / USDC>0
- both available
- one contract stale
- poor spread/depth
- no eligible contract

### Risk Tier
- CORE
- LIQUID_ALT
- SPECULATIVE
- NEW_LISTING
- manual override

### Direction
- BOTH
- LONG_BIASED
- SHORT_ONLY
- DISABLED

### Location
- LONG overextended
- SHORT overextended
- normal pullback
- missing data

### Allocation
- min executable margin
- risk factor
- volatility
- max margin
- equity cap
- leverage by tier
- exposure reduced size

---

## 28. 集成链

验证：

`Universe → Underlying collapse → Risk Tier → Direction Policy → Portfolio Gate → Location → Contract Router → Dynamic Allocation → Scout → Primary → AllocationPlan → Entry`

---

## 29. 迁移与兼容

新增 Settings 必须：

- versioned migration
- restart safe
- existing settings preserved
- explicit defaults

不得破坏旧用户配置。

---

## 30. 验收

完成：

- `npm run typecheck`
- `npm run test`
- `npm run build`

全部 PASS。

Restart 后浏览器验证：

- Dashboard
- Smart Selection
- Settings
- AI Detail
- Entry Audit

然后至少 60 分钟 Testnet 专项验收。

统计：

- underlying candidates
- duplicate blocks
- USDT routed
- USDC routed
- risk tier distribution
- direction policy distribution
- location blocks
- dynamic margin distribution
- leverage distribution
- LONG/SHORT exposure
- speculative exposure
- PLACE/REJECT
- Submit/Fill

---

## 31. 最终必须证明

1. 同一 Underlying 不再无脑重复同方向建仓；
2. USDT margin 不足时能选择合格 USDC；
3. 不再所有币固定 200U；
4. 高风险币 margin/leverage 更低；
5. 高位 LONG 能被阻断或等待回调；
6. 低位 SHORT 同理；
7. Portfolio LONG concentration 会影响新仓；
8. AI 无法绕过硬约束；
9. Existing positions 未被自动修改；
10. 不重新引入 global maxPositions 死门。

---

## 32. 最终报告

必须给出：

- 当前持仓按 Underlying 去重后的数量
- 重复 Underlying 列表
- USDT/USDC 可用保证金
- 自动合约路由样本
- Risk Tier 分布
- Direction Policy 分布
- Dynamic Margin 分布
- Leverage 分布
- overextension blocks
- exposure blocks
- PLACE/REJECT 前后变化
- 如果样本足够，新仓初始浮亏/位置质量变化

---

## 33. 退出条件

只有以下全部完成：

- Underlying Resolver
- Contract Router
- USDT/USDC AUTO
- Risk Tier
- Direction Policy
- Entry Location Score
- Dynamic Margin
- Dynamic Leverage
- Margin Mode Policy
- Portfolio Exposure Budget
- AllocationPlan
- Settings
- Smart Selection UI
- Dashboard Portfolio Intelligence
- AI Audit
- typecheck PASS
- tests PASS
- build PASS
- browser PASS
- 60m Testnet PASS
- 普通 TODO/PARTIAL/PENDING=0

才允许最终回复。

完成后版本：

# ZDJ-MITS V3.4.0
## Portfolio Intelligence & Dynamic Allocation
