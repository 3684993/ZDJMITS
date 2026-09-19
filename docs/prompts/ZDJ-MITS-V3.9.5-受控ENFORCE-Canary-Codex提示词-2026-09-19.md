# ZDJ-MITS V3.9.5｜受控 ENFORCE Canary 实施提示词

你现在继续执行 ZDJ-MITS V3.9.5 下一轮：**受控 ENFORCE Canary**。

## 当前已确认状态

- 正式分支：`v395-economics-human-managed-20260919`
- 当前代码内容已包含：V3.9.5 economics / reachability / HUMAN_MANAGED、silent clamp 修复、startup egress 自动验证、expected egress IP 变化时旧证明失效、legacy TP isolation、durable UNKNOWN claim starvation 修复、CI-only 20s test timeout。
- 开发分支与正式分支 CI 已全绿。
- live 已部署 V3.9.5 SHADOW。
- live 当前：SHADOW / CUSTOM / `minNetProfitUsd=1` / `minHistoricalReachProbability=0.50` / HUMAN caps `4 / 0.20`。
- historical UNKNOWN 保留 15，active durable claims 已收敛到 0。
- 429/418 无新增，startup egress 自动 VERIFIED ≈2.8 s，旧仓/TP 无损。
- 当前 HUMAN_MANAGED notional/equity 约 91%，所以直接全局切 ENFORCE 会被 HUMAN cap 全量冻结。

## 本轮目标

验证 **ENFORCE economics + reachability + AI plan + execution + TP** 链路本身真实可执行，而不是放宽正式安全标准。

## 硬边界

禁止：
- 全局长期关闭 HUMAN_MANAGED cap；
- 修改 HUMAN cap 数值或 notional→margin 语义；
- 自动平 HUMAN_MANAGED；
- 修改 `minNetProfitUsd=1`；
- 修改 `minHistoricalReachProbability=0.50`；
- 修改 AI 的 side / quantityUnits / acceptablePriceRange 自主权；
- 修改唯一退出链；
- 删除 historical UNKNOWN；
- 修改 Binance request governance；
- 人工指定 LONG/SHORT；
- 为通过 Canary 人工修改 AI target/quantity；
- 进入生产环境。

必须保持：Binance Demo/Testnet、`productionWrites=0`、static egress、Maker Entry、quantity 禁止 clamp、HUMAN_MANAGED 仍为人工扛单。

## Stage 1｜证明 Canary 隔离能力

先调查现有 Stage7 / Canary 机制，确认能做到：
1. 只允许 Canary scope 产生新的 Entry；
2. 普通自动 Entry 暂停；
3. Position / TP / reconciliation / account / WS 继续运行；
4. Canary 结束后可原样恢复；
5. 不新建第二套交易路径。

优先复用已有 entry-only pause / CanaryMarginUsd / maxPositions / maxPendingEntries / dynamicMarginEnabled / canary filtering。

**如果不能证明普通 Entry 已完全隔离，本轮停止，不得临时 `caps=false`。**

## Stage 2｜Canary 临时配置

只有隔离成立才继续：
- `tradeEconomics.admissionMode = ENFORCE`
- `minNetProfitUsd = 1`
- `minHistoricalReachProbability = 0.50`
- `parameterProfile = CUSTOM`
- `dynamicMarginEnabled = false`
- Canary margin = 5 USDT
- `maxPositions = 1`
- `maxPendingEntries = 1`

由于历史 HUMAN 账本本身已超过 20%，Canary 窗口内仅允许在“普通 Entry 已完全隔离”的前提下，临时：

`humanManagedAdmissionCapsEnabled = false`

用途仅为验证 economics + reachability + AI plan + execution + TP，不代表正式参数调整。

Canary 结束后必须恢复：
- `humanManagedAdmissionCapsEnabled = true`
- `maxHumanManagedPositions = 4`
- `maxHumanManagedNotionalPctEquity = 0.20`

数值不得改变。

## Stage 3｜选择 Canary 标的

选择一个：无持仓、无 pending entry、无 active durable claim、无 unresolved risk、市场数据 READY、历史 UNKNOWN 不再占 scope、流动性/交易规则正常、AI 可自然分析的单一 underlying。

优先从 SHADOW 中“忽略 HUMAN cap 后”曾通过 economics + reachability 的标的中选。

最终 side、quantityUnits、acceptablePriceRange、targetPrice 必须由 Primary AI 自主决定。

## Stage 4｜启动前快照

记录：exact HEAD、buildId/PID/instanceId、相关 Settings、account/equity/available/uPnL、positions、TP orderId/price、HUMAN/AUTO 数量、historicalUnknownCount、activeDurableUnknownClaimCount、releasedUnknownClaims、429/418、egress、request governor、Canary 标的现有订单/持仓/claim。

## Stage 5｜进入受控 ENFORCE Canary

顺序：
1. 暂停普通新 Entry；
2. 保持持仓/TP/reconciliation 正常；
3. 临时关闭 `humanManagedAdmissionCapsEnabled`；
4. 将 `admissionMode` 切到 `ENFORCE`；
5. 只开放 Canary scope；
6. 不重启模型服务；
7. 如无需 Engine 重启则不要重启；
8. 如 Settings 必须重启才生效，只允许一次受控重启并重新验证 egress。

## Stage 6｜Canary 成功门槛

目标不是“必须成交”，而是证明 ENFORCE 链路真实工作。

至少看到一条真实：

`ENTRY_ECONOMIC_ADMISSION_EVALUATED{mode:ENFORCE}`

并确认：
- `passed=false`：确实不创建 EntryIntent / 不提交订单；blocker 与事实一致；
- `passed=true`：才允许创建 EntryIntent；AI side 不改；quantityUnits 不 clamp；acceptablePriceRange 不改；JIT economics 再验证正常；Maker 路径正常；新 clientOrderId / durable task identity 正确；无 stale durable claim 阻塞。

如自然 `passed=true` 且订单形成 Position，再验证：
- Position 持久化 V3.9.5 ENFORCE `economicAdmission`；
- TP Guardian 可用 V3.9.5 economic-validated AI TP 规则；
- 不强制 legacy 1.2% floor；
- TP 符合 AI target/range + economics；
- 旧仓 legacy TP 不受影响。

## Stage 7｜禁止为了“成功”绕过 blocker

若 ENFORCE 真实拒绝 `TP_REACH_PROBABILITY_UNMET` / `TP_HISTORICAL_REACHABILITY_UNMET` / `ECONOMIC_MIN_NET_PROFIT_UNMET`，这是有效 Canary 结果。

禁止调低 0.50、调低 $1、移动 AI target、增加 quantity/leverage、更换方向、重复请求强行通过。

## Stage 8｜Canary 结束后立即恢复

无论 PASS / BLOCK / ORDER / FILL，都恢复：
- `admissionMode = SHADOW`
- `humanManagedAdmissionCapsEnabled = true`
- `maxHumanManagedPositions = 4`
- `maxHumanManagedNotionalPctEquity = 0.20`
- `minNetProfitUsd = 1`
- `minHistoricalReachProbability = 0.50`
- 恢复普通 Entry 调度

然后核对 Health READY、WS LIVE、reconciliation SETTLED、Account READY、egress VERIFIED、productionWrites=0、429/418 无异常增长、旧仓 TP 全 PROTECTED、historical UNKNOWN 保留、active durable claims 正常、无旧 intent 重放。

## Stage 9｜Canary PASS 标准

必须全部成立：
1. Canary 隔离有效；
2. ENFORCE evaluation 真实发生；
3. passed=false 时 fail-closed；
4. passed=true 时才允许执行；
5. AI side/quantity/range 未被覆盖；
6. quantity 无 clamp；
7. durable claim 修复正常；
8. egress 自动验证正常；
9. 旧仓/旧 TP 完全隔离；
10. 结束后恢复 SHADOW + HUMAN cap 原值；
11. 429/418 无持续新增；
12. 无生产写入。

**不要求 Canary 一定成交。**

## 最终报告

只输出：
A. Canary 隔离机制；
B. Canary 标的与依据；
C. 启动前 Settings；
D. ENFORCE evaluation 数量；
E. passed/blocked 与 blocker；
F. 若 passed：AI side/quantityUnits/range/target；
G. 是否创建 EntryIntent；
H. 是否提交/建单/成交；
I. JIT economics 是否一致；
J. 若形成 Position：economicAdmission 是否持久化；
K. TP 是否按 V3.9.5 ENFORCE 规则处理；
L. durable claim 是否正常；
M. 旧仓 TP 是否零影响；
N. 429/418 前后；
O. egress 状态；
P. 结束后是否已恢复 SHADOW + HUMAN cap；
Q. 当前是否具备进入“正式 ENFORCE 参数决策”的技术条件。

报告保存：

`docs/reports/v395-controlled-enforce-canary-20260919.md`

提交 GitHub。

完成后停止。

最后执行：

`D:\MITS\scripts\notify.ps1`
