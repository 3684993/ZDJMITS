# V3.9.6 最终收敛证据索引

2026-09-22。HEAD 记录以 [release-manifest.json](J6/release-manifest.json) 的 `source.commit` 为准。状态：**`READY_FOR_TESTNET_AUTHORIZATION`**（离线实现与离线验收闭合，等待运行授权；不是 `ACCEPTED`）。

## 1. 输入与边界

| 项 | 值 |
|---|---|
| 仓库 / 分支 | `3684993/ZDJMITS` / `codex/v396-final-convergence-20260922`（唯一） |
| 基线祖先 | `51e7e1e5af06510a95bca3f075da94ececd2b06c`（`merge-base --is-ancestor` 退出 0） |
| 输入指令 | [CODEX-FINAL-CLOSEOUT-20260922.md](../../../plans/v396/CODEX-FINAL-CLOSEOUT-20260922.md) |
| PR #9 | `refs/pull/9/head = 2b502ec6a71a2079a273773a9b029f0ae24c9b42`，base/head/内容未改；无 rebase / squash / force / 历史重写 |
| Engine 生命周期 | 未启停、未热重载、未部署、未改 live Settings/DB、未执行真实迁移、未调用交易所写接口 |

## 2. 逐阶段证据

| 阶段 | commit | RESULT | manifest | 定向必测 |
|---|---|---|---|---|
| S00 基线 | （既有） | [S00](../S00/20260921T145000Z/) | [entrypoint-review.json](../S00/20260921T145000Z/entrypoint-review.json) | 静态复验 114 入口 / 0 blockers |
| C1–C3 | （既有） | [C1](C1/) [C2](C2/) [C3](C3/) | 同目录 | C2 原子预留、C3 接线与加固 |
| J1 退出真源 | `5688478` | [J1/RESULT.md](J1/RESULT.md) | [J1/manifest.json](J1/manifest.json) | `j1ExitTruthHostile`、`j1AiExitConsumer` |
| J2 组合准入 | `7448fbe` | [J2/RESULT.md](J2/RESULT.md) | [J2/manifest.json](J2/manifest.json) | `j2PortfolioAdmissionHostile`、`s05ConsumerBoundary` |
| J3 不可变计划 | `29878f3` + `26e64c1` | [J3/RESULT.md](J3/RESULT.md) | [J3/manifest.json](J3/manifest.json) | `j3TradePlanHostile`（S06-T01–T09） |
| J4 复核/台账/记忆 | `a5dcf27` | [J4/RESULT.md](J4/RESULT.md) | [J4/manifest.json](J4/manifest.json) | `j4ReviewMemoryHostile`（S07-T01–T09）、`s07ConsumerBoundary` |
| J5 设置/备份/迁移 | `a7b022b` | [J5/RESULT.md](J5/RESULT.md) | [J5/manifest.json](J5/manifest.json) | `j5SettingsGovernanceHostile`、`ownershipStorageCoverage`、`governancePanel`（dashboard） |
| J6 回放/统计/发布 | `1f2643e` | [J6/RESULT.md](J6/RESULT.md) | [J6/manifest.json](J6/manifest.json) | `s09ReplayStressHostile`（S09-T01–T08） |

派生材料：[storage-coverage.json](J5/storage-coverage.json)（由 `scripts/v396-storage-coverage.mjs` 推导，`S08_STORAGE_COVERAGE_PASS`）、[experiment-manifest.json](J6/experiment-manifest.json)、[experiment-report.json](J6/experiment-report.json)（`runStatus=NOT_RUN`）、[release-manifest.json](J6/release-manifest.json)。

整版裁决与重评：[v396-final-convergence-audit-20260922.md](../../../reports/v396-final-convergence-audit-20260922.md)；逐 J 剩余实施状态：[FINAL-REMAINING-IMPLEMENTATION-20260922.md](../../../plans/v396/FINAL-REMAINING-IMPLEMENTATION-20260922.md)；运行清单与证据模板：[RUNBOOK-S08-S10-OPERATIONS-20260922.md](../../../plans/v396/RUNBOOK-S08-S10-OPERATIONS-20260922.md)。

## 3. 阅读顺序与已知限制

1. 先看审计报告的 §2（门禁真实退出码）与 §4（六个硬门），再看 §3 的 20 项状态。
2. 一个已知的时间顺序事实：`release-manifest.json` 固定的是最后一个**代码**提交（`1f2643e`）且当时工作树干净；随后只更新文档（本报告、审计与剩余实施计划）的提交不会改变任何源码或证据哈希，因此哈希表按代码状态解释。
3. `contracts` 包仍为 0 用例：任何把契约覆盖当作已通过的说法都不成立，契约正确性目前只由引擎/核心侧的行为测试间接支撑。
4. 所有 `NOT_RUN` / `NOT_MEASURED` / `PENDING_WINDOW_INCOMPLETE` 都是**未执行**，不是“执行了但没问题”。
