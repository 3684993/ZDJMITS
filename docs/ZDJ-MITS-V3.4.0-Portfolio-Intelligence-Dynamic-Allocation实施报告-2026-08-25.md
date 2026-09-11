# ZDJ-MITS V3.4.0 Portfolio Intelligence & Dynamic Allocation 实施报告

日期：2026-08-25  
范围：Portfolio Intelligence、Dynamic Allocation、Underlying Resolver、USDT/USDC 合约路由、风险层级、方向策略、Entry Location Score、动态保证金/杠杆、组合暴露预算、设置与前端验收。

## 1. 执行结论

V3.4.0 已完成代码实施、测试、生产构建、重启、浏览器验收和 60 分钟 Testnet 只读专项验收。最终生产服务：

- Engine：`V3.4.0`，`READY`
- Market Stream：`LIVE`
- Private Data：`READY`
- Testnet：`TESTNET_ENABLED`
- 现有持仓：33 个；专项监测期间始终为 33 个，未被自动修改
- 60 分钟专项监测：通过；约每 30 秒读取 health、snapshot、universe、settings，未执行下单、撤单或仓位修改

## 2. 本轮实施内容

### 2.1 核心策略层

- 新增 `packages/contracts/src/portfolio.ts`，定义 QuoteAsset、Underlying Exposure、Risk Tier、Direction Policy、Margin Mode、Portfolio Exposure、AllocationPlan 等协议。
- 新增 `packages/core/src/portfolio.ts`：
  - Underlying Resolver：`ETHUSDT`、`ETHUSDC` 统一为 `ETH`。
  - Quote Asset Resolver 与 Contract Router。
  - AUTO 模式优先选择有可用保证金的合格 USDT/USDC 合约。
  - CORE、LIQUID_ALT、SPECULATIVE、NEW_LISTING、RESTRICTED 风险层级。
  - LONG/SHORT/BIASED/ONLY/DISABLED 方向策略。
  - 15m EMA、BB、ATR、Impulse、Volume 组合计算 Entry Location Score。
  - 动态保证金、最小可执行保证金、权益比例上限、风险层级系数。
  - 动态杠杆与风险层级最大杠杆。
  - ISOLATED/CROSS/AUTO Margin Mode 策略字段。
  - 同一 Underlying 暴露检查、同方向重复阻断、组合 LONG/SHORT/Speculative 暴露预算。
  - `AllocationPlan` 贯穿 Candidate → EIP → Entry；AI 不能绕过硬约束。

### 2.2 Engine 接入

- Universe Coordinator 在选币后执行 Underlying 去重和合约路由。
- Entry Coordinator 在 AI 决策后、下单前生成并保存 AllocationPlan；拒绝结果写入审计事件，不直接下单。
- Entry 数量由 AllocationPlan 的 `notionalUsd` 计算，不再直接使用固定 `portfolio.entryMarginUsd * global leverage`。
- EIP 增加风险层级、方向策略、位置分数、建议保证金、建议杠杆、Margin Mode、组合暴露和 admission 信息。
- Dashboard Snapshot 增加组合 LONG/SHORT/Speculative 暴露、USDT/USDC 可用保证金、风险层级/方向分布和 AllocationPlan 计数。
- Runtime 持久化 AllocationPlan，重启后可恢复。

### 2.3 设置与 UI

- `config/settings.default.json` 增加 Portfolio Intelligence 默认配置。
- Settings 增加 Quote Asset、Underlying Policy、Global Direction、Margin Mode、动态保证金/杠杆、位置保护、暴露上限和风险参数。
- Dashboard 驾驶舱增加 Portfolio Intelligence 面板。
- Smart Selection 展示 Underlying、最终合约、Quote、Tier、Direction、Location、Margin、Leverage。
- 生产标识统一为 `ZDJ-MITS V3.4.0 PORTFOLIO INTELLIGENCE`。

## 3. 最终运行快照

采样时间：2026-08-25 18:44 左右。

| 项目 | 结果 |
|---|---:|
| Market snapshots | 82 |
| Active positions | 33 |
| 去重后唯一 Underlying | 27 |
| 新候选 eligible | 31 |
| USDT 可用保证金 | 0 |
| USDC 可用保证金 | 2993.77491234 |
| LONG exposure | 518.37% |
| SHORT exposure | 55.55% |
| Speculative exposure | 0% |
| Allocation plans | 4 |

LONG/SHORT 暴露百分比按当前账户权益计算；当前既有持仓组合已经超过新仓暴露预算，因此新 Entry 会受到组合硬约束影响，既有仓位不会被自动平仓或重配。

### 3.1 既有持仓 Underlying 事实层

33 个既有仓位折合 27 个唯一 Underlying。历史重复 Underlying 为：

`BTC`、`DOGE`、`ETH`、`ETHFI`、`ORDI`、`PENGU`。

这些是启动时从交易所同步的既有持仓事实，本轮没有修改它们；新的 Universe 资格层在 60 分钟监测中重复 Underlying 组始终为 0。

### 3.2 合约路由、风险和方向分布

- 当前合格候选 Quote：USDT 27、USDC 4。
- 当前账户 USDT 可用为 0、USDC 可用约 2993.77；USDC 合约仍能进入合格候选，证明 AUTO 路由不会把 USDT 余额不足误判成全局不可交易。
- Risk Tier：CORE 5、LIQUID_ALT 26；动态窗口内曾观察到 SPECULATIVE 候选。
- Direction Policy：BOTH 31。
- 当前杠杆分布：9x 1、10x 1、11x 2、12x 22、13x 1、16x 2、17x 1、18x 1。
- 当前动态保证金区间：`<0.4 USD` 3、`0.4–1 USD` 20、`>=10 USD` 8；实际值受合约最小名义、价格、ATR、流动性、置信度和位置质量共同影响，不再统一 200 USD。

## 4. 交易活动与硬约束

最终快照中的近 30 分钟活动：

- Primary：1702
- PLACE：188
- REJECT：1514
- Submit：111
- Fill：0
- Pending Entries：0

Fill 为 0 是当前 Testnet/运行态观察结果；本轮只读专项监测没有人为制造新订单或新成交。已有仓位的 TP 保护保持完整。
此前 TradeRecord 清洗产生的 `PARTIAL` 是历史成交事实分类，不是本轮未处理的 Entry/Pending 队列；本轮未篡改这些历史记录。

重点硬约束结果：

1. 同一 Underlying 的新候选不会无脑重复同方向建仓。
2. USDT 可用保证金为 0 时，合格 USDC 合约仍可被路由。
3. 新 Entry 使用动态保证金和杠杆，不再固定 200 USD/全局杠杆。
4. 高风险和高波动候选的保证金、杠杆会降低。
5. Entry Location Score 低于阈值时拒绝或等待，不把高位 LONG、低位 SHORT 直接交给执行层。
6. 组合暴露预算会影响新 Entry；当前 LONG 集中度已经明显超过预算，因此不会继续无条件扩大风险。
7. AI 只提供分析和方向，不能绕过 AllocationPlan admission。
8. 未重新启用原来的 global maxPositions 建仓死门；当前既有持仓 33 个而配置 maxPositions 为 12，组合层只约束新 Entry。

## 5. 验证结果

全部通过：

- `npm run typecheck`
- `npm run test`：Contracts 0 个测试文件通过，Core 19/19，Dashboard 5/5，Engine 39/39
- `npm run build`
- Engine 重启后 health READY
- 浏览器 Dashboard 通过
- 浏览器 Smart Selection 通过
- 浏览器 Settings 通过
- EIP/AI Detail 数据链保持可用
- 60 分钟 Testnet 只读专项验收通过

专项监测脚本：

`D:\MITS\scripts\run-v340-portfolio-smoke.ps1`

该脚本只读取 health、snapshot、universe、settings，不调用交易写接口。

## 6. 交付状态

当前服务已重启并运行新构建版本，工作目录为 `D:\MITS`。本报告即为 V3.4.0 实施和验收记录；后续如果调整风险阈值，应通过 Settings 保存并重新执行 typecheck/test/build 与短时运行态验收。
