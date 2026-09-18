# ZDJ-MITS V3.9.4 Stage7 报告：最小 Testnet 写 Canary

日期：2026-09-19
代码 HEAD：`226397e`（Stage7 运行时的工作树；引擎 `sourceHash` 与该 HEAD 源码一致，其后仅有运维脚本/文档变更）
CI：`V3.9.x Verify` 对该 exact HEAD = success（attempt 1）
证据目录：`data/reports/v394-stage7-testnet-20260919-033246`
编排日志：`data/rollout/v394-stage7-9/evidence-20260919-033240/Stage7.log`

## 1. 结果

```
STAGE7_PASS_ENGINE_REMAINS_PAUSED=TRUE
schema=V3.9.4-STAGE7-CANARY-1  pass=true  status=PASS
symbol=ETHUSDT  entryStatus=FILLED  filled=true  tpProtected=true
http429Delta=0  http418Delta=0
```

终态实测（Stage7 收尾后）：

```
trading=PAUSED_MANUAL   positions=1   capacity.used=1/1
takeProfit.status=READY  required=1  protected=1
ETHUSDT LONG qty=0.032 entry=2629.31 mark=2638.67 uPnL=+0.300
managementStatus=AUTO_MANAGED   tpStatus=PROTECTED
```

即：仓位由 TP Guardian **自动管理**（与治理前的 6 笔 `HUMAN_MANAGED` 形成对照），引擎按计划在取证后保持暂停。

## 2. 真实自主链（毫秒级事件时间线）

| 时刻(UTC) | 事件 | 含义 |
|---|---|---|
| 19:37:14.580 | `ENTRY_INTENT_CREATED` | AI 授权被冻结为 intent |
| 19:37:16.998 | `ENTRY_SUBMIT_ATTEMPTED` | 进入提交 |
| — | `ENTRY_ORDER_CREATED` | `exchangeOrderId=16798046797`，LONG 0.032 @ 2629.31 |
| 19:37:27.739 | `ORDER_FILL_RECONCILED` | 交易所成交与本地对账一致 |
| 19:37:27.742 | `ENTRY_FILLED` | 成交成立 |
| 19:37:27.961 / 30.263 | `EXCHANGE_FILL_ATTRIBUTED` ×2 | 成交归属到该订单 |
| 19:37:30.267 | `ENTRY_ORDER_FILL_ATTRIBUTION_REVISED` | 归属修订 |
| 19:37:57.226 | `TP_SUBMISSION_PREPARED` | TP Guardian 建立退出保护 |
| 19:37:58.440 | `TP_PROTECTED` | 保护成立 |

**决策→成交 13.2 秒，决策→TP 保护 43.9 秒。** 全程由 AI 自然产生，未伪造方向/数量/价格，无强制下单。

## 3. 授权完整性审计（`scripts/audit-v394-entry-authorization.mjs`）

对该窗口内全部 3 张 intent、1 张订单做逐笔断言：

```
AI quantityUnits=32  →  intent quantityUnits=32  →  order quantity=0.032
   （32 × stepSize 0.001，精确物化，无 clamp、无 confidence 二次缩仓）
AI acceptablePriceRange=[2628.5, 2630.5]
   → Maker 成交价 2629.31 落在区间内
AI side LONG → intent LONG → order LONG
violations: sideMismatch=0 quantityMismatch=0 rangeMismatch=0 policyLeak=0 nonAiTp=0
AUDIT verdict violations_total=0 entries=3 aiRuns=4
```

`policyLeak=0` 的判据是显式的：不存在 `ENTRY_DIRECTION_POLICY_BLOCKED` 事件，也不存在 reason 为 `DIRECTION_NOT_ALLOWED` / `SPECULATIVE_LONG_EXCEPTION_EVIDENCE_REQUIRED` 的事件。这把 §12.2 的离线证明延伸到了真实 Testnet 链路上。

## 4. 限频与出口

- `http429Delta = 0`、`http418Delta = 0`（canary 窗口内增量口径，非生命周期累计）
- 固定出口 `172.104.186.174`，`egress=VERIFIED`，路由身份未变，无 `REST_HOST_VIOLATION`
- `REQUEST_WEIGHT` 处于极低水位（Stage6 后观测约 119/6000）

## 5. 本阶段发现并修复的两个真实缺陷

### 5.1 Stage7 在引擎重启后永远无法 arming（`run-v394-local-rollout.ps1`）

出口真相存放在 `BinanceTransport` 的**进程内** `egressTruthByRoute` Map（`BinanceTransport.ts:27,42-44`），新进程一律 `UNVERIFIED`，只有 `verifyEgressIp()` 会转为 `VERIFIED`；而 `entryBlockReason()` / `assertTestnetExchangeWrite()` 在配置 `expectedStaticEgressIp` 时对非 VERIFIED **fail-closed**。Stage7 在 `StopEngine → StartEngine` 之后立即 `AssertGovernance`，因此必然 `STATIC_EGRESS_NOT_VERIFIED:UNVERIFIED`。

修复：把 Stage6 已有的代理探针纳入 Stage7（3 次重试仅容忍瞬时抖动），**判据不变**（仍要求 VERIFIED 且 expected==verified）。本次运行日志出现 `STAGE7_PROXY_EGRESS_VERIFIED=172.104.186.174`。

### 5.2 Stage7 的抢跑 pause 杀死了自己的 canary（同文件）

第一次尝试的毫秒级证据：

```
19:08:01.604 ENTRY_EXECUTION_WAITING  UNREACHABLE_MAKER (正确保留 AI 授权、不追价)
19:08:03.922 PAUSE "first canary entry observed; lock new entries"
19:08:06.136 ENTRY_EXECUTION_WAIT_TERMINATED EXECUTION_PERMISSION_CHANGED
             entryOrderCreated=true  exchangeOrderId=null      ← 从未到达交易所
```

引擎在管线已暂停时拒绝提交是**正确**的（`entryCoordinator.ts:157/348` 的权限检查）；错误的是编排器在刚观察到在途单时就暂停它。单入场约束本就由 `maxPositions=1` + `maxPendingEntries=1` 结构性保证（本次 `used=1/1` 再次证实），故移除该抢跑 pause，保留取证后的 pause。

> 注意：第一次尝试**不是**交易所拒单。若只看 `entryStatus=REJECTED` 很容易误判为交易所侧问题并去改价格/数量策略——那将是错误的修复方向。

### 5.3 编排器仍会挂死（`run-v394-stage7-to-stage9.ps1`，影响取证不影响 Stage7 本身）

`Start-Process -Wait` 除等待进程退场外还会排空重定向流，而 Stage 子脚本拉起的常驻 Engine 继承了这些文件句柄，导致 `-Wait` 永不返回、PASS 无法写入 checkpoint。改为只等进程句柄并显式断言退出码可观测。**本次 Stage7 的 PASS 判定不依赖该修复**：`summary.json` 与 `STAGE7_PASS` 标记均已落盘，7 项推导检查全真后回填 checkpoint（`data/rollout/v394-stage7-9/backfill-stage7-pass.mjs`）。

回填的必要性：Stage7 的前置门禁要求 flat，而它自己的 canary 仓位现在占满 `maxPositions=1`，因此**重跑 Stage7 会自锁**。跳过已 PASS 阶段是验收计划 §8 的明确要求。

## 6. 结论与下一步

Stage7 目标 `STAGE7_PASS_ENGINE_REMAINS_PAUSED=TRUE` **达成**，且授权完整性、限频、出口三项硬指标同时为 0 违例。下一步 Stage8：恢复常规 Testnet 参数、`ResumeEntries`，要求 `RUNNING + AUTO_RUNNING + Account READY + WS LIVE + Reconciliation SETTLED + egress VERIFIED`。

遗留给 12H/24H 观察的真实负载项：10 笔历史 `UNKNOWN` 每 60 秒触发一轮 `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` 复核（10 符号 × 私有 REST），是限频预算中的长期背景成本；它们不占风险，但值得在 V3.9.5 评估退避策略。
