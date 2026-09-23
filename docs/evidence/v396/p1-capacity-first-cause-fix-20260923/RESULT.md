# P1 修复：容量首因不再把“单方向满”说成“额度已用尽”

离线红→绿一轮。计划来源：`docs/evidence/v396/deploy-d624b21-20260923/finding-p1-capacity-first-cause-overclaim.json`（部署轮发现的 P1）。基线 HEAD `c9fc3b2`，工作树在改动前 clean。
状态：`READY_FOR_REVIEW`，不自签 ACCEPTED。**本轮未部署、未启停 Engine**：运行实例仍是 PID 26784 / `buildId=3.9.6-2fb37e445af4d3d351da`（含 P1 文案），`apps/engine/dist`、`apps/dashboard/dist` 时间戳保持 17:12 不变；两个应用的构建产物写入 `build-check/` 临时目录后已删除。

## 1. 缺陷与根因

`entryCoordinator.processPool()` 用 `OCCUPIED_CAPACITY_BLOCKERS.includes(capacity.firstBlocker)` 判定“被容量挡住”。但 `firstBlocker` 只是**第一个已饱和的维度**，而 LONG 与 SHORT 是相互独立的两侧：一侧满不代表这本账没有新增风险额度。线上 17:24–17:25 的真实状态正是这样——SHORT 剩余 `$0.00`，Gross 与 LONG 各还有 `$708.70` / `$712.92`，资本预检有 1–3 个可执行候选，Primary 却报 `WAITING_EXECUTION_CAPACITY` 并写“新增风险额度已用尽”。同一时刻驾驶舱卡片（要求 `executableCandidateCount===0`）报的是 `ENTRY_BLOCKED`：两个界面对同一事实给出相反结论。

危害：向操作员伪造“该提高额度了”的压力，正撞在既有停止线（不得为恢复交易放宽 `maxGrossExposurePct`/`maxDirectionExposurePct`）上；同时把真实首因（同底层占用等单候选层）盖掉。

## 2. 修复方式（单一真源，不新增第二套判断）

- `portfolioCapacityVisibility` 除 `firstBlocker` 外，另外投影 `blockingDimensions`（全部已饱和维度）、`exhaustedReason`（`POSITION_CAPACITY | GROSS | BOTH_DIRECTIONS | null`）与 `exhaustedForNewRisk`。判定只用已经算好的预算与槽位：槽位满、或 gross 无余量、或 LONG 与 SHORT 同时无余量，才算“新增风险额度已用尽”；未评估周期（`evaluatedAt<=0`）永远不算。
- `processPool()` 的谓词改为 `demand && capital.executableCandidateCount === 0 && capacity.exhaustedForNewRisk`，即必须同时满足“有候选、资本预检认为没有一个可执行、投影判定额度确实用尽”。
- 文案与 code 一一对应：只有上述判定成立才写 `新增风险额度已用尽：<exhaustedReason>`（双向满时写 `LONG 与 SHORT 双向额度均满`）；无路由 → `当前无资本可执行路由`；有 ready → `等待新的候选事实`；其余 → `暂无可派发候选`。
- 驾驶舱不再自备枚举表：`OverviewView` 直接消费投影出的 `exhaustedForNewRisk`，并把“首个饱和维度”和“新增风险额度（已用尽 · 原因 / 仍有空间 · 剩余额度）”分成两行显示。这样“哪个界面猜错了”这一类错误从结构上消失。
- `OCCUPIED_CAPACITY_BLOCKERS` 已删除（它正是被误用成“无额度”的那个集合）。

未改：任何阈值、默认值、风险算法、准入顺序、契约 schema、`maxPositions`、参数档位模板。

## 3. 红→绿

红测（在 `c9fc3b2` 的旧实现上跑，`red-01-engine-live-case.txt`）：

```
× keeps a single saturated side from being reported as an exhausted book (the live t1/t2 case)
× reports an exhausted book only when a gate denies every new risk
× does not claim exhausted risk when only one side is full and a candidate is still executable
  → AssertionError: expected 'WAITING_EXECUTION_CAPACITY' not to be 'WAITING_EXECUTION_CAPACITY'
Tests  3 failed | 10 passed (13)
```

第三条就是线上反例本身。修复后：`green-01-engine-targeted.txt` 13/13；`green-02-dashboard-capacity.txt` 5/5（含新的“单侧满不得声称 CAPACITY_BLOCKED/已用尽”与“按投影数字与投影结论逐字渲染，不自行重算”两例）。

## 4. 门禁（真实 exit code）

| 门禁 | exit | 结果 |
|---|---|---|
| Engine `vitest run` 全仓 | 0 | 153 files / 1168 tests 全绿 |
| Engine typecheck / build(`--outDir build-check/engine`) | 0 / 0 | 未覆盖 `apps/engine/dist` |
| Dashboard `vitest run` 全仓 | 0 | 12 files / 40 tests 全绿 |
| Dashboard `vue-tsc --noEmit` / `vite build --outDir build-check/dashboard` | 0 / 0 | 未覆盖 `apps/dashboard/dist` |
| `@zdj/core` typecheck / test | 0 / 0 | 46 tests |
| `@zdj/contracts` typecheck / test | 0 / 0 | `--passWithNoTests`，仍 0 例，不声称契约层覆盖 |
| `npm run verify:deps` | 0 | |
| `npm run verify:scripts` | 0 | 16 个 node 测试 + 4 个 ps1 契约 |
| `node scripts/v396-s00-static-check.mjs` | 0 | S00_T01..T06 PASS，153 测试文件隔离，`blockers:[]` |
| `node scripts/v396-storage-coverage.mjs --check` | 0 | `STORAGE_COVERAGE_CHECK_PASS` |
| `git diff --check` | 0 | 干净 |

## 5. 运行实例的连带好消息（只读观察）

部署轮记录的出口暂停已自行恢复：`egress.status=VERIFIED`（`lastVerifiedAt=17:45:51`，`lastError=null`），分析派发重新进行（`lastAttemptAt=17:57:11`、`lastSuccessAt=17:57:08`、`active=1`），期间 `testnetWrites=0`、`productionWrites=0`、`lastWriteAt=null`，TP `14/14`，对账 `drift=0`。见 `live-instance-state-after-fix-round.json`。因此出口闸那条既有耦合（写侧 `writeAdmissionBlock()` 命中即 return，进而在 ANALYSIS_ONLY 下也停掉分析派发）本轮不再被现场触发，但代码路径未变，是否需要解耦仍待你裁决；未做改动。

## 6. 待办（不属于本轮授权范围）

1. 批准一次部署：把本轮修复构建上线（当前线上仍是含 P1 的 `2fb37e44` 构建，文案会继续在单侧满时误报“已用尽”）。
2. 裁决出口闸是否应与分析派发解耦。
3. 上一轮部署轮未完成的 AI Run 抽屉交互级线上核验（`NOT_OBSERVED_ON_LIVE`）随下一次部署一并补做。
