# S00 handoff

阶段/子 PR：S00-A/B/C/D；实施：luna（round 1，分支 `codex/v396-project-plan-20260921`）+ 总设计审计补全（round 2，分支 `codex/v396-s00-audit-20260921`）；状态：`ACCEPTED`（限 S00 规格与隔离基线，由总设计在第 2 轮复审中作出；round 1 由实施侧记录的 ACCEPTED 无效）。

## 1. 身份与范围

- 计划基线 `4473a6f…`；round 1 实际 base/head `d3f6d262f3bcc05dbd3d9b793f8a3f41da7e5fee`；round 2 审计基线 `7164f5ab47429a006ddc17a83fa53d3176c3d224`。
- round 2 worktree：`D:\MITS-WORKTREES\v396-s00-audit-20260921`，分支 `codex/v396-s00-audit-20260921`；原 worktree 与 `D:\MITS` 运行目录均未修改。
- 依赖 ACCEPTED 证据：无（S00 无前置）。
- 行为问题：把 V396 公共契约转为可复现基线、写路径清单、字段消费者、隔离边界和预注册骨架。
- round 2 改动文件：`scripts/v396-s00-isolation-rules.mjs`、`scripts/v396-s00-build-entry-review.mjs`（新增）、`scripts/v396-s00-static-check.mjs`（加强）、`docs/evidence/v396/S00/20260921T145000Z/` 下的清单、夹具、边界与结论文档。无产品源码、Settings、数据库或 dist 修改；无迁移。
- 未改风险路径：Entry/TP/人工共享所有权、UNKNOWN 终局、7 天回溯、实时观测缺口留待后续阶段，见 `write-path-inventory.md`。
- 真实网络/交换写/Settings 修改/生命周期动作：全部否。

## 2. 契约与设计

- CONTRACTS：`V396-C1`；涉及 I01–I12；测试 ID `S00-T01`–`S00-T06`。
- 新输入/输出：仅离线 fixture 和实验 manifest 形状；新功能状态 `OFF/SHADOW/TESTNET_ENFORCE` 只做规格，默认不接入。
- 偏差：当前 HEAD 与计划历史 SHA 漂移，已记录并未按旧行号修改；无语义变更。
- round 2 契约补全：夹具补 `cycleId`、限制 `ownerState` 为契约枚举、覆盖四种 `FactStatus`、新增同周期二次小亏退出用例；I10/I12 增补 CONTRACTS 之外的权威出处。`field-consumer-map.md` 记录 `minNetProfitRoiPct` 的单位歧义（实现按百分数除以 100，默认 0.15 即 0.15%），S03 必须先定口径。
- 缺失/部分成交/重启/旧数据：UNKNOWN 保留 claim，legacy AUTO/no-plan 人工审阅，不自动补授权。

## 3. 验证结果

| 测试 ID | 命令/fixtureHash | 实际结果 | 证据路径 |
|---|---|---|---|
| S00-T01 | `node scripts/v396-s00-static-check.mjs`; 107 条逐项机械推导（98/8/1） | PASS | `test-results.md`, `entrypoint-review.json`, `isolation-boundary.md`, `entrypoint-index.json` |
| S00-T02 | 同上; canonical fixture hash `295c949a0cf5b2c7c06db81db91e42fd6fd4437fe5a2f23143c09ac4a7fbab21` | PASS | `test-results.md`, `redaction-manifest.json` |
| S00-T03 | 同上; 5 个身份 hash 绑定文件并复算（LF 归一） | PASS | `test-results.md`, `baseline-manifest.json` |
| S00-T04..T06 | 同上; 文件 hash `9c2afe9bf75644f0705292ef708e3a4f7e1746d01ae92031b5644ea1f8a20332` | PASS (3/3) | `test-results.md`, `fixtures/s00-fixtures.json`, `invariant-consumer-map.json`, `write-path-inventory.md` |

- 测试数/失败/跳过：6 PASS / 0 FAIL / 0 skipped；另附 5 项篡改反证，全部按预期失败（`test-results.md`）。baseline failure：未运行产品全套，未宣称。
- 故障注入/状态序列：仅 fixture 级 legacy/no-plan、UNKNOWN、CONFLICT、CONSERVATIVE_BOUND、并发预算与同周期累计场景；未发起外部写。
- 账本/风险不变式：S00 只建立消费者映射与夹具，不声称实现通过；见 `invariant-consumer-map.json`。
- 经济证据：NOT_RUN；预注册中保持 `NOT_CONFIGURED`。

## 4. 迁移与回退

- 预览/备份/旧数据：0；无迁移。
- 关闭新功能：未接入新功能，旧 reader 不变。
- 在途订单/ownership：未触碰。
- round 2 回退面：全部为新增/文档化证据与被加强校验器；撤销只需回到 `7164f5a`。未删除 round 1 任何证据文件，`terra-audit.md` 与 `audit-correction-20260921.md` 原文保留。
- 未触碰现网证据：静态检查输出 `network: NOT_USED`, `exchangeWrites: 0`, `engineLifecycle: NOT_USED`, `settingsModified: false`。

## 5. 结论与下一阶段输入

- 已解决：隔离分类从自由文本变为内容推导；基线身份跨 worktree 可复现；夹具可被 S01 直接消费；写路径 claim key 事实入册。
- 尚未解决：V396 ownership CAS、保护维护权分离、共享数量 claim（含 TP 路径无 claim、`executionScope` 非契约 scope）、UNKNOWN 收敛与真实账户事实。
- S01 输入：fixture schema `V396-S00-fixtures-2`、`FactStatus`/UNKNOWN 规则、`entrypoint-index.json` 的命令白名单与 required boundary、`write-path-inventory.md` 的缺口清单。
- 请求总设计裁决：已由总设计第 2 轮复审作出，见 `audit-round-2-20260921.md` 与 `conclusion.md`。
- 可新增证据：OP2 与 ST1 具备重评材料但仍未评分；本轮未改总分。

审查者：总设计（round 2）；结论：`ACCEPTED`（限 S00 规格与隔离基线）；证据：`audit-round-2-20260921.md`、`test-results.md`、`entrypoint-review.json`；限定：不构成部署、Engine 启用或交易授权。
