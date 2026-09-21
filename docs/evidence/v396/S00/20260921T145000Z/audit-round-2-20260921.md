# S00 总设计复审（第 2 轮，2026-09-21）

审计对象：`codex/v396-project-plan-20260921` 分支 `7164f5ab47429a006ddc17a83fa53d3176c3d224` 上的 S00 证据与 `scripts/v396-s00-static-check.mjs`。
工作地点：独立 worktree `D:\MITS-WORKTREES\v396-s00-audit-20260921`，分支 `codex/v396-s00-audit-20260921`。原 worktree 与现网均未修改。

## 已复核为真实的证据

- 5 个身份 hash 与声明文件一致；`package-lock.json`、`config/settings.default.json` 的 hash 在两棵 worktree 中均可复现。
- 默认配置白名单逐项复算为真：`settingsVersion 20`、`TESTNET`、`READ_ONLY`、`protectionMode SHADOW`、`admissionMode SHADOW`、`secondBrainReview OFF`、`humanHandoffAfterMinutes 1440`、`lossHandoffBars 4`、`minNetProfitUsd 1`、`minNetProfitRoiPct 0.15`。
- 写路径清单里的源码行号引用逐条复算命中（`entryCoordinator.ts:170,211,220,227`、`manualPositionService.ts:83,95`、`tpGuardian.ts:89`、`appRuntime.ts:241,330-335,551`、`ExternalTradeAdapter.ts:26,41,42`、`MockExchangeAdapter.ts:6,10,11`）。第 1 轮在这一点上没有虚报。
- 校验器复跑退出 0；它确实不 import 进程与网络能力，写调用点确实只在 OS 临时目录下。

## 发现与处置

### F1 验收权限（治理缺陷，未放宽任何规则）

`58b7888` 把状态从 `READY_FOR_REVIEW` 改成 `ACCEPTED`，审查者写的是 terra。README 第 5 节规定 `ACCEPTED` 只能由总设计或指定审查者作出，运行规则第 6 节要求实施者「不自签 ACCEPTED」；而 terra 正是 S00 表上的主实施角色，属于实施侧。另外 `conclusion.md` 仍写着 `READY_FOR_REVIEW`，同一交付包内状态自相矛盾。

还有一处证据质量问题：`58b7888` 写入的审计正文描述的是**已被否决**的机制（「递归扫描…命中明确排除规则」的 39 条候选，正是第 1 轮审计明令禁止的通配排除口径），到 `7164f5a` 才把条目数改成 99。也就是说，验收记录描述的并不是它验收的那份产物。

处置：状态回退为 `READY_FOR_REVIEW`；`terra-audit.md` 保留原文并追加不采纳说明；验收权回到总设计。这一条不改任何风险规则，只恢复流程约束。

### F2 隔离分类不可信（P1，实质风险）

第 1 轮的 99 条记录解决了「覆盖率」，但 `sideEffects`/`status` 是自由文本，校验器只查路径集合与字段存在性。结果 19 条被判为「补齐边界后可运行」，其中 12 条副作用列表为空，包括：

- `scripts/windows/start-engine.ps1`（转调 `start-zdj-lan.ps1`，即 AGENTS 里只能手动、需逐次授权的那把 Engine 启动入口）；
- `scripts/windows/start-dev.ps1`（`npm run dev`）、`start-dashboard.ps1`（`npm run dev:dashboard`）；
- `scripts/windows/verify.ps1`（root 聚合 `verify`，而 `entrypoint-index.json` 自己把 `npm run verify` 列为 NOT_RUN）；
- `scripts/run-acceptance.ps1`（串起 acceptance 与 3h endurance，带数据目录与端口）；
- `scripts/v393-fix-entry-wiring.mjs`、`scripts/v393-contract-cleanup.mjs`（就地改写 `apps/` 与 `packages/` 下的受版本控制源文件，而同族脚本 `v393-apply-autonomous-entry-patch.mjs` 却是 FORBIDDEN，口径互相矛盾）；
- `scripts/windows/credential-manager.ps1`（P/Invoke 读写主机凭据库）、`scripts/audit-node-runtime.ps1`（枚举宿主进程并写 `data/runtime` 下的输出）。

后果不是纸面的：S01 起工程师要按这张白名单决定「哪些命令能跑」。一个把 Engine 启动脚本、acceptance 运行器和源文件改写脚本标成「补齐边界即可运行」的清单，等于把 AGENTS 的手动启动约束和 I10 交给下一位读者的判断力。

处置：副作用与状态改为按当前文件内容机械推导（含一跳间接引用），任何一项命中进程、网络、交换写、宿主改写、源码改写或聚合验证即 `FORBIDDEN_OR_NOT_RUN`；生命周期命名的入口按名字直接禁止。重生成后 107 条：98 禁止、8 边界可用、1 执行。没有一条向宽松方向移动。规则见 `isolation-boundary.md`。

### F3 校验器自证与 T03 口径（测试真实性）

- 第 1 轮把自己那条记录标成 `ALLOWED_STATIC` 且副作用含 `process-lifecycle` 与 `network-or-exchange`，而同一份脚本又断言自身没有这些能力——两个产物互相打脸。现在改为：该条只保留真实发生的临时目录写，并由 import 白名单、禁用能力 token 扫描和写调用点检查直接证明。
- `S00-T03` 声明覆盖「夹具或配置」一字节漂移，实际只对夹具做了。现在 5 个身份 hash 都绑定到 `identityHashSources` 里的具体文件并逐一复算，配置或契约文件漂移会使旧实验身份失效。
- 复验时新增 5 项篡改反证（见 `test-results.md`），全部按预期失败后回滚。

### F4 基线身份在 worktree 之间不稳定（可复现性）

同一提交里的 `docs/plans/v396/00-baseline-and-specification.md` 在两棵 worktree 中字节不同（3944 与 3991，差 47 个 CR），因此按工作树原始字节声明的 hash 不可跨检出复现。处置：身份 hash 统一定义为「CRLF 归一为 LF 后再 SHA-256」，并在 manifest 里写明该规则；归一化后 S00 规格文件 hash 与第 1 轮声明值 `586597e7…` 完全一致，说明差异纯粹来自换行符。原始值保留在 `auditRound2.supersededIdentityHashes` 里可追溯。

### F5 契约对齐缺口（遗漏）

- 夹具完全没有 `cycleId`，而 `PlanIdentity`（CONTRACTS 第 3 节）要求它，I04 的「按原周期累计 10 USDT」也无从验证。已为全部用例补 `cycleId`，并新增 `second-small-loss-exit-same-cycle`（同一周期内第二次小亏退出，带累计亏损与剩余额度字段）。
- `legacy-auto-no-plan` 使用了契约外的 `ownerState: AUTO_LEGACY`。契约第 4 节枚举只有 `AI_ACTIVE/HANDOFF_PENDING/HUMAN_MANAGED/CLOSED`。已改为 `ownerState: null` + `legacy: true` + `legacyOwnerRecord: AUTO`，并在 T04 加了枚举断言。
- `FactStatus` 四态只覆盖 `EXACT/UNKNOWN`，`CONSERVATIVE_BOUND` 与 `CONFLICT` 无夹具，而第 2 节的「UNKNOWN 不默认 0、CONFLICT 不挑有利值」正是 S01 要消费的。已各补一条（`conservative-bound-valuation`、`conflicting-order-facts`，后者列出冲突来源 id）。
- I10 的 `contractSection` 指向 CONTRACTS 第 6 节，但该节没有 Engine 生命周期条款；已补 `authoritySource` 指向 README 第 1 节第 7 条与 AGENTS.md，并加了「章节号必须真实存在」的断言。
- `executionScope` 与三条写路径的 claim key 事实（第 1 轮 S00-T05 只用夹具示例判 PASS，没读实现）已写入 `write-path-inventory.md`。

## 残余事项（不构成 G0 阻断，进入 S01 时须知）

1. 运行期身份来源未采集（Engine HTTP 未读）。这是 S00 允许的取舍，但 OP2 需要它，S08 前应确定 `RELEASE_LABEL`/构建身份的读取入口。
2. 机械推导是保守过近似，会把只含 `credentialRef` 之类字样的纯读脚本也标到边界可用或禁止；方向是安全的，但 S01 若发现某条被过度收紧，应改**规则表**而不是改单条标签，改后必须重跑并复述失败原因。
3. `data` 目录与端口隔离目前由「7 个开库测试全部使用临时目录或内存库」这一实测保证；`apps/engine/vitest.config.ts` 本身仍不钉住 `ZDJ_DATA_DIR`/`ZDJ_PORT`。是否在 S01 引入全局 setup 属 terra 的实施决策，本阶段不代为改动共享集成文件。
4. 交付归属只能到分支与提交，不能到人：三条 S00 提交的 git 作者都是同一个仓库身份（`3684993`），`luna`/`terra` 只存在于文本中。后续如需按工程师归属审计，应在提交信息或 trailer 里显式记录，否则「luna 的实际提交」这类判断不可证。
