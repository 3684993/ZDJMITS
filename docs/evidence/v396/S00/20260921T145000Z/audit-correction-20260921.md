# S00 审计更正（2026-09-21）

审计对象是该 worktree 中未提交的 S00 证据和 `scripts/v396-s00-static-check.mjs`。`git log --all --author=luna` 没有记录，且这些文件均为 untracked；因此不能将其归因于 luna 的已提交交付。

原 S00-T01 将 39 个候选脚本以宽泛 `excludedPatterns` 排除后写作“已分类”，这不是逐项隔离证明；原 S00-T02 仅检查脱敏声明而没有检查实际证据内容。审计已补充：验证器自身的静态能力约束、聚合命令的明确 NOT_RUN、证据文件的 credential-shaped 内容扫描、fixture 文件与声明 hash 的一致性验证，以及 I01-I12 的契约章节与计划测试阶段映射。

复验命令为 `node --check scripts/v396-s00-static-check.mjs` 和 `node scripts/v396-s00-static-check.mjs`。结果：S00-T02--T06 PASS；S00-T01 INSUFFICIENT_EVIDENCE。没有 Engine 生命周期动作、网络请求、交易所写、Settings 或 live data 修改。

G0 阻断：在不执行这些命令的前提下，为每个候选 startup/test/verification entry 保存源代码定位、潜在副作用、允许/禁止状态、以及若允许时所需的临时 data、loopback port、mock/no-network/no-write 断言。不得使用路径通配排除来替代审查。完成后应以可归属的独立提交交付并重新审计。
