# ZDJ-MITS V3.9.2 实施检查点

日期：2026-09-11  
唯一方案：`docs/plans/ZDJ-MITS-V3.9.2-Candidate-Supply-And-Exit-Final-Plan.md`  
状态：**PHASE A/B SOURCE IMPLEMENTED / TESTS NOT RUN / NEXT PHASE C**

> 本文件只记录实施断点，不替代 canonical plan。中断恢复时读取 canonical plan、本文件和 main 最新提交即可。

## Phase A — 可观测性与语义拆分

源码已实施：

- `53985b903a962facefcbb53ef7886f992413c2d9` — candidate supply observability
- `0dd78d7a6c5d7e1f95378df820be5a949f3e9b8f` — ready=0 blocker 分类

实现：ActiveCohort（当前暂以 online snapshot set 表达）、Resident、PipelineReady、ExecutionReady、Consumed、ZombieSnapshot 独立统计；Dashboard snapshot 暴露 `candidateSupply`；blocker 分类为 `SUPPLY/CAPITAL/CAPACITY/RISK/MARKET/GOVERNANCE/AI`；`POOL_SUPPLY_HEALTH` 不再把 poolCount 当作 ready supply。

测试：**NOT_RUN**。已增加 targeted unit tests，最终执行交给 Codex。

## Phase B — Pool/Route 饥饿修复

源码已实施：

- `b9e585169c4d96e7a8c0ec41aef0ef7fc1be7005` — decouple ready supply from waiting residents

实现：WAITING resident 不再占用 execution-ready target；READY 可在 poolMax 已满时替换 WAITING；删除 previous capital route 对 Universe pipeline eligibility 的反馈；迁移旧 `WAITING_CAPITAL_ROUTE`；capital generation 改为独立递增版本并记录 selection generation 仅作观测。

测试：**NOT_RUN**。已增加 `20 WAITING + 10 READY` targeted test，最终执行交给 Codex。

## 下一步

严格进入 **Phase C — Asset Directory 失败与过期语义**：区分 `SOURCE_FAILED` 与明确撤销；单资产 LKG + 有期限 grace；CAS 防异步 review 覆盖人工设置；不得提前进入 Phase D/E/F/P1/P2。
