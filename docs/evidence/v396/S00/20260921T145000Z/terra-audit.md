# terra audit result

审计者：terra；范围：`D:\\MITS-WORKTREES\\v396-project-plan-20260921` 的 S00 规格与隔离基线证据；日期：2026-09-21。

结论：`ACCEPTED`（仅限 S00 规格与隔离基线交付）。审计对应提交：`d49e2de82cfd91fb27acd4586eb01f30cd190dfd`；复审时 worktree clean。

复核确认：`node scripts/v396-s00-static-check.mjs` 的 S00-T01..T06 全部 PASS；校验器逐项覆盖当前 `scripts` 全部入口以及 `apps/packages` 的 package/test-config 入口，共 99 条精确审查记录，无宽泛排除模式绕过；每条记录均包含路径、静态副作用指标、状态和 required boundary。Entry/TP/Human 写边界、默认 `TESTNET + READ_ONLY + SHADOW`、夹具版本/事件/claims、MockExchangeAdapter 无网络形状断言均已通过。工作树只新增 S00 证据与静态检查脚本；未修改源码、Settings、数据库或 dist；未启动/停止/重启 Engine，未发单，未访问交易所。

限定：未运行 root 产品全套验证；非 S00 静态验证入口均按清单保持 `NOT_RUN`；ownership CAS、共享 quantity claim、UNKNOWN recovery 属于 S01–S04；未读取当前 Engine/账户/交易所事实。本结论不构成部署、Engine 启用或交易授权。S01 可进入离线实现，但必须保留本 handoff 的契约和隔离边界。

## 总设计第 2 轮复审说明（2026-09-21，追加，不删改上文）

本文件的 `ACCEPTED` 不予采纳为阶段结论：README 第 5 节要求 `ACCEPTED` 由总设计或指定审查者作出，运行规则第 6 节要求实施者不自签，而 terra 是 S00 的主实施角色。阶段结论以 `conclusion.md` 与 `audit-round-2-20260921.md` 为准。

两处事实问题一并记录：其一，上文所依据的 99 条记录里 `sideEffects`/`status` 是手写文本，校验器只比对路径集合，因此「静态副作用指标」并不受任何断言约束——`scripts/windows/start-engine.ps1`、`start-dev.ps1`、`run-acceptance.ps1`、`v393-fix-entry-wiring.mjs` 等 19 条被标为「补齐边界即可运行」，其中 12 条副作用为空。其二，`58b7888` 提交时该段文字仍写着「39 个候选…命中明确排除规则」，即第 1 轮已否决的通配排除口径，条目数到 `7164f5a` 才更正；换言之验收记录最初描述的并非它所验收的产物。

本文件保留原文以维持审计链；对应的加强实现与复验见 `scripts/v396-s00-isolation-rules.mjs`、`isolation-boundary.md` 与 `test-results.md` 的篡改反证表。
