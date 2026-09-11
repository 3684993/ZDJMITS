# ZDJ-MITS V3.9.2 源码级最终审计方案

日期：2026-09-11  
基线：`3684993/ZDJMITS` / `main`  
审计性质：**源码只读审计优先；先证明问题，再提出最小收尾修改。**  
运行边界：遵守 `AGENTS.md`，审计过程中不启动、停止、重启或热加载交易 Engine；不执行 Production 写入；不改变真实持仓和既有 TP。

## 1. 审计目标

本轮不是继续扩架构，而是对 V3.9.2 做收尾级源码审计，回答四个核心问题：

1. **建仓链路是否臃肿/重复/互相阻断**：从 Universe → Pool → EIP → Scout → Primary → Entry → Exchange 的完整路径，识别重复 gate、重复事实构造、状态往返、非必要 AI/REST/DB 调用、隐藏串行化和失败放大点。
2. **智能选币为什么经常“无币可交易”**：区分市场确实无机会、候选供应不足、资格门过严、池容量/持仓方向容量阻断、数据 freshness 阻断、AI NO_DIRECTION_EDGE、黑名单/冷却/重选逻辑以及调度公平性问题。
3. **持仓退出是否过早、固定、无法最大化趋势收益**：审计 TP、人工退出、结构止盈、持仓状态、费用门、15m 趋势/结构利用情况，确认是否存在固定百分比导致的机械退出、过早兑现、盈利趋势未延续、退出证据不足等问题。
4. **AI 推理能力是否只用于入场而没有用于持仓/退出**：确认当前 AI 的权限边界、Position/TP 是否完全确定性；评估引入“AI 只读持仓评估/退出建议”是否能提高收益质量，同时保持最终退出执行可验证、可回滚、可审计。

最终目标不是单纯提高 PLACE 次数，而是提高：**有效候选供给率、决策吞吐、Maker 成交效率、趋势方向质量、盈利持仓延续能力和单位风险收益质量。**

## 2. 审计原则

- **源码事实 > 旧设计文档 > 历史报告**。文档与源码冲突时，以当前 `main` 源码为准，并在报告中指出偏差。
- 不把 `NO_DIRECTION_EDGE` 自动判定为模型保守；必须追到产生它的输入、规则和调用链。
- 不通过删除风险门、扩大杠杆、强制 PLACE、取消 Maker 约束来“提高频率”。
- 不以固定 TP 更远/更近直接代表收益最大化；必须区分趋势延续、回撤、费用、可实现价格与退出延迟。
- AI 可以用于**评估与建议**，但任何自动退出能力必须有明确状态机、硬风险边界、最小持仓/费用/流动性约束、幂等执行和回放测试；审计阶段不直接授权 AI 平仓。
- 不大改框架；优先删冗余、合并职责、减少状态转换和重复 gate。

## 3. 审计范围

### A. 候选供应与智能选币

重点文件/模块：

- `packages/core/src/selection.ts`
- `packages/core/src/pool.ts`
- `packages/core/src/assetAdmission.ts`
- `packages/core/src/marketQuality.ts`
- `apps/engine/src/services/universeCoordinator.ts`
- `apps/engine/src/services/candidateLifecycleDeriver.ts`
- `apps/engine/src/services/marketDataReadiness.ts`
- Settings/blacklist/portfolio/capital admission 相关实现

核查：Universe Top-N 来源、打分归一化、流动性权重、动态补位、候选淘汰/回池、持仓与挂单排除、方向容量、总敞口、freshness、黑名单、冷却、重复 symbol、池目标/最大容量、调度饥饿。

输出：一张 **Universe → Eligible → Pool → AI-ready** 漏斗图和每层阻断原因表。

### B. 建仓全链路复杂度

重点文件/模块：

- `apps/engine/src/services/exchangeLoop.ts`
- `apps/engine/src/services/entryCoordinator.ts`
- `apps/engine/src/services/entryFacts.ts`
- `apps/engine/src/services/entryObservation.ts`
- `apps/engine/src/services/decisionContext.ts`
- `apps/engine/src/services/aiFabric.ts`
- `apps/engine/src/services/aiProtocolNormalizer.ts`
- `apps/engine/src/services/p0EntryIntegrity.ts`
- `apps/engine/src/services/executionLifecycle.ts`
- `packages/core/src/eip.ts`
- `packages/core/src/aiPrompts.ts`
- `packages/core/src/makerPricing.ts`

核查：一次候选从入池到交易所订单经过多少 gate、函数、状态和持久化点；哪些 gate 重复；哪些属于事实准备、AI 决策、风险授权、执行校验，应否归并；Scout 与 Primary 是否产生重复推理；Prompt/EIP 是否超载；同步/串行点是否限制吞吐；失败是否导致整条链重新开始。

输出：

- 当前链路时序图。
- 冗余/必要 gate 分类表。
- 建议的最小目标链路，不改变关键安全边界。

### C. AI 决策质量与 NO_DIRECTION_EDGE

重点：

- 15m 方向证据与 1m/5m timing 的实际代码关系。
- Primary 输入中是否存在互相矛盾或过多低价值字段。
- Scout 是否对 Primary 形成信息损失、重复摘要或过度门控。
- `NO_DIRECTION_EDGE / WAIT_FOR_PRICE / RESELECT_SYMBOL / DATA_TECHNICAL_BLOCK / AI_PROTOCOL_FAILURE` 的真实产生位置和互斥关系。
- AI 是否被硬规则提前替代，从而“有模型但没有推理空间”。

输出：**AI 权限/规则权限矩阵**，明确哪些判断应属于 AI、哪些必须保持确定性。

### D. Entry / Maker 成交效率

核查：AI price band → near-market price → Maker pricing → quantity/capital → intent/order → repricing/TTL/partial fill/recovery；确认是否因价格过远、过期、等待、重价、状态锁或方向容量造成大量有效机会损失。

输出：PLACE → Intent → Order → RemoteId → FirstFill → FullFill 的源码责任链和可观测指标建议。

### E. 持仓、TP 与提前平仓/收益延续

重点文件/模块：

- `apps/engine/src/services/positionService.ts`
- `apps/engine/src/services/positionLifecycleTracker.ts`
- `apps/engine/src/services/tpGuardian.ts`
- `apps/engine/src/services/tpSubmissionOutcome.ts`
- `apps/engine/src/services/manualPositionService.ts`
- `apps/engine/src/services/reconciliationService.ts`
- `packages/core/src/tp.ts`
- Position/TP settings/contracts/dashboard

核查：

- 默认 `PRICE_MOVE_PERCENT` 与 `STRUCTURE_15M` 的真实执行边界。
- 固定 TP 是否对所有币、波动率、趋势强度一刀切。
- TP 是否忽略 ATR/波动率、15m 趋势延续、结构突破、订单簿/流动性和 MFE。
- 是否存在提前平仓路径、隐式 reduce、测试网清理或 reconciliation 误触发。
- 盈利持仓是否具备“让利润奔跑”的机制；是否只有一次性固定退出目标。
- 已有 TP 的修改、撤换、幂等和交易所真相如何保证。

输出：当前退出状态机 + 过早退出风险点 + 收益延续方案候选。

### F. AI 持仓推理 / 智能退出可行性

本轮只审计和设计，不直接赋予 AI 无约束平仓权。

评估三层方案：

1. **AI Position Observer**：AI 只读评估继续持有 / 收紧保护 / 建议退出，不执行。
2. **AI Exit Intent + Deterministic Guard**：AI 给出退出意图、理由、失效条件；确定性 Guard 校验最小持仓周期、净收益/亏损、趋势反转、成交可行性、幂等后才允许执行。
3. **Hybrid Dynamic TP**：确定性保护底线 + AI/结构/波动率决定盈利目标是否延展，避免固定百分比一到即走。

必须比较收益潜力、过度交易风险、延迟、模型失败、重启恢复和可审计性。

## 4. 实施阶段

### Phase 0 — 冻结基线

记录当前 Git commit、版本、关键配置默认值和 `AGENTS.md` 运行边界。审计不修改 Engine 运行状态。

### Phase 1 — 静态源码追踪

逐文件建立四条调用链：候选供应、Entry、Position/TP、AI。所有结论给出文件/函数级证据，不只引用历史报告。

### Phase 2 — 复杂度与阻断审计

为每条链统计：

- 状态数/转换数
- gate 数量
- AI 调用数
- DB/REST/WS 依赖
- 可重试点
- fail-closed 点
- 重复校验
- 可删除/可合并/必须保留项

### Phase 3 — 交易质量审计

重点裁决：

- “无币可交易”究竟发生在 Selection、Eligibility、Pool、AI 还是 Risk/Capacity。
- 高频目标与高质量目标在哪些 gate 上冲突。
- 固定 TP / Structure TP 是否能解释提前退出。
- 当前架构是否缺少对盈利持仓的持续推理能力。

### Phase 4 — 最小收尾方案

给出 P0/P1/P2：

- **P0：正确性/明显阻断/重复链路**，必须修。
- **P1：吞吐与交易质量**，有证据再修。
- **P2：AI Position Intelligence / Dynamic Exit**，先影子评估再授权。

每项必须注明：修改文件、删除/保留边界、预期收益、风险、测试、回滚。

### Phase 5 — Codex 最终验证包

如需要改代码或动态测试，交给 Codex 执行隔离验证。验证至少包括：

- `npm run verify`
- Selection/Pool deterministic replay
- Entry funnel replay
- Maker price/band/TTL/partial-fill regression
- Position/TP/reconciliation regression
- AI Position Observer shadow replay（若采纳）
- 退出策略 A/B replay：Fixed TP vs Structure TP vs Hybrid Dynamic TP
- 不启动/停止真实 Engine；需要 Testnet 生命周期操作时再次由用户明确授权

Codex 只验证审计结论和明确修改，不重新设计系统。

## 5. 最终交付物

审计完成后在 GitHub `docs/reports/` 生成：

`ZDJ-MITS-V3.9.2-SOURCE-FINAL-AUDIT-2026-09-11.md`

报告必须包括：

1. Executive Verdict
2. 当前真实调用链图
3. 智能选币/候选供应根因
4. 建仓链路复杂度与冗余项
5. AI 决策空间审计
6. PLACE→Fill 执行效率审计
7. Position/TP/提前退出审计
8. 收益最大化缺口
9. AI 持仓/退出推理可行方案
10. P0/P1/P2 最小修改清单
11. 删除/合并/保留清单
12. Codex 隔离测试与 Testnet 验收清单
13. 最终 GO / CONDITIONAL GO / NO-GO

## 6. 本轮不做的事

- 不因为“建仓少”直接强制 AI PLACE。
- 不取消风险/资本/方向容量边界。
- 不擅自提高杠杆或资金利用率。
- 不直接让 AI 获得无保护平仓权限。
- 不重构整个架构。
- 不用历史 Mock/旧 build 样本冒充当前 V3.9.2 自然表现。
- 不在审计中启动、停止或重启现有 Engine。

## 7. 审计成功标准

只有满足以下条件才算源码最终审计完成：

- “无币可交易”能定位到具体源码层和条件，而不是归因于“AI保守”。
- Entry 链每个 gate 都能说明存在理由；重复 gate 有明确删除/合并建议。
- 提前退出是否存在、由谁触发、为何固定，能从源码证明。
- 收益延续缺口能转化成可测试方案，而不是主观调远 TP。
- AI 在 Entry/Position/Exit 中的合理权限边界被明确划分。
- 所有建议都能由 Codex 通过隔离测试/回放验证，不依赖 Production 试错。
