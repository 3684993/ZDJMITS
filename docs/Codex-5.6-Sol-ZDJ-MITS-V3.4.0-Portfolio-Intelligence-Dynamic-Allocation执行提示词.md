# Codex 5.6 Sol — ZDJ-MITS V3.4.0 Portfolio Intelligence & Dynamic Allocation 执行提示词

继续 `D:\MITS` 当前 ZDJ-MITS。

读取并执行：

`ZDJ-MITS-V3.4.0-Portfolio-Intelligence-Dynamic-Allocation实施计划.md`

本轮目标不是增加建仓数量，而是一次性解决：

- USDT/USDC 资金路由
- 同 Underlying 重复仓位
- 固定 200U 保证金
- 所有币近似同杠杆
- 山寨币风险无分层
- 高位追 LONG / 低位追 SHORT
- LONG/SHORT 组合暴露失控

不要重构已稳定的 Market / Pool / Scout / Primary / Entry / TP 主链。

先基于当前代码、SQLite、Settings、Binance Testnet 当前持仓与真实 available margin 独立调查。

1. 新增 Underlying Resolver：
   ETHUSDT/ETHUSDC→ETH，BTCUSDT/BTCUSDC→BTC 等。
   Universe 先按 Underlying 合并，再选具体 Contract。
   同一 Pool 默认不允许同 Underlying 的多个 quote 合约同时进入。

2. 新增 Underlying Exposure Policy：
   BLOCK_ALL / BLOCK_SAME_DIRECTION / ALLOW_HEDGE。
   已有 ETHUSDT SHORT 时，ETHUSDC 是否允许再开仓必须经过该策略，而不是只检查 symbol。

3. 新增 Quote Asset Policy：
   AUTO / USDT_ONLY / USDC_ONLY。
   AUTO 根据 available margin、spread、depth、volume、OI、funding、freshness、minNotional、reachability 选择 USDT 或 USDC。
   若 USDT available=0、USDC>0 且同 underlying USDC 合约合格，必须能 route 到 USDC。

4. 新增 AssetRiskTier：
   CORE / LIQUID_ALT / SPECULATIVE / NEW_LISTING / RESTRICTED。
   使用 volume、spread、depth、OI、funding、ATR、listing age、price impact、data quality 等客观事实，不用“空气币”主观硬编码。
   支持 AUTO + MANUAL_OVERRIDE。

5. 新增 Direction Policy：
   BOTH / LONG_BIASED / SHORT_BIASED / LONG_ONLY / SHORT_ONLY / DISABLED。
   优先级 Symbol > Tier > Global。
   BIASED 只提高/降低 evidence、confidence、location 门槛，不是强制方向。

6. 新增 EntryLocationScore 0~100。
   15m 继续决定方向，但不代表当前位置可以立即入场。
   至少结合 EMA21/ATR 距离、BB位置、支撑阻力、recent impulse、1m/5m pullback、volume exhaustion、funding crowding、orderbook、reachable range。
   高位 LONG → LONG_OVEREXTENDED；
   低位 SHORT → SHORT_OVEREXTENDED。
   优先给更好 idealPrice/acceptablePriceRange；1~5m不可达则 REJECT。

7. 废除所有币固定 200U。
   新增 DynamicMarginAllocator：
   targetMargin = baseMargin × riskTier × liquidity × volatility × confidence × location × portfolioExposure factors。
   最终 clamp 到 minExecutableMargin 与 maxMargin。
   minExecutableMargin 必须由真实 minQty/stepSize/minNotional/price/leverage 计算。

8. 新增 DynamicLeveragePolicy。
   风险越高/波动越大/流动性越差 → leverage越低。
   支持 Global/Tier/Symbol override。

9. 新增 MarginModePolicy：
   ISOLATED / CROSS / AUTO。
   新仓默认优先 ISOLATED 作为保守候选，但必须可配置。
   现有持仓禁止批量自动切换。

10. 新增 Portfolio Exposure Budget：
    same underlying、LONG/SHORT gross exposure、speculative exposure、quote asset margin usage、total margin usage。
    不允许重新引入 global maxPositions 死门。
    LONG暴露过高时只对新的LONG做 reduced size / higher threshold / block，AI其它方向仍工作。

11. 生成 AllocationPlan：
    underlying、symbol、quoteAsset、riskTier、directionPolicy、direction、locationScore、marginMode、leverage、marginUsd、notionalUsd、exposureBefore/After、policySource。
    Primary PLACE + AllocationPlan 才允许 Entry。
    AI不得覆盖硬策略。

12. Settings 增加“组合与建仓策略”：
    Quote Asset、Underlying Policy、Dynamic Margin、Dynamic Leverage、Margin Mode、Risk Tier、Direction Policy、Entry Location Protection、Portfolio Exposure、Symbol Override。
    支持 Global → Tier → Symbol 三级覆盖。

13. 智能选币增加：
    Underlying、Selected Contract、Risk Tier、Direction Policy、Location Score、Recommended Margin、Leverage、Quote Asset、Existing Underlying Exposure。

14. 驾驶舱增加 Portfolio Intelligence：
    LONG/SHORT exposure、CORE/Speculative exposure、USDT/USDC margin usage、duplicate blocks、location blocks。

15. 当前已有持仓只纳入 exposure 计算，禁止自动改 margin mode/leverage、批量平仓或批量改TP。新策略只作用于新Entry。

16. 补齐 Unit + Integration：
    Underlying、Contract Router、USDT=0/USDC>0、Risk Tier、Direction Policy、LONG/SHORT overextended、Dynamic Margin、Dynamic Leverage、Margin Mode、Exposure Budget、AllocationPlan、Settings migration。
    完整链：
    Universe→Underlying→Tier→Policy→Exposure→Location→Contract→Allocation→Scout→Primary→AllocationPlan→Entry。

17. 完成：
    npm run typecheck
    npm run test
    npm run build
    全部PASS后 restart。

18. 浏览器验证：
    Dashboard / Smart Selection / Settings / AI Detail / Entry Audit。

19. 至少60分钟 Testnet 专项验收，统计：
    underlying candidates、duplicate blocks、USDT/USDC routed、tier distribution、direction policy、location blocks、dynamic margin/leverage、LONG/SHORT exposure、speculative exposure、PLACE/REJECT、Submit/Fill。

必须证明：
- 同Underlying不再重复同方向堆仓；
- USDT不足时能route到合格USDC；
- 不再固定200U；
- 高风险币margin/leverage更低；
- 高位LONG/低位SHORT被location gate控制；
- 组合LONG集中度影响新仓；
- AI无法绕过硬约束；
- existing positions未自动修改；
- 无global maxPositions死门。

普通 TODO/PARTIAL/PENDING 未清零前禁止 checkpoint 停止。

全部完成后才允许最终回复。

现在直接调查并实施，不先写新计划。
