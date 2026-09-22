# J5 治理字段矩阵、AI 独立经济许可线、durable 账本备份与迁移闭环

输入基线 `a5dcf27`（J4）。执行令：`docs/plans/v396/CODEX-FINAL-CLOSEOUT-20260922.md` §6；机器可读结果：[manifest.json](manifest.json)、[storage-coverage.json](storage-coverage.json)。

## 之前的事实

`PUT /api/v3/settings` 的“允许清单”其实是一个**反**清单：只固定 `connections.exchange`、`connections.proxy`、`aiResources` 三块，其余一切原样写库。于是任何治理数字都可以被页面改掉，而没人能说出它是什么单位、什么时候生效、有没有代码读它。`aiExitMinNetProfitUsd` 自 J1 起就只存在于契约和一个测试里——AI 平仓实际用的仍是 TP 的经济地板，也就是**把 TP 地板借来当 AI 权限**，正是执行令点名禁止的事。`v396-ownership.sqlite` 被 `scripts/maintain-storage.mjs:11` 与部署前预检完全忽略，S02 因此把它登记为 release blocker。`OwnershipJournal` 只有 `CREATE TABLE IF NOT EXISTS`，没有任何版本概念：更旧的构建打开更新的账本会照着补表继续写。

## 现在的事实

- **字段矩阵**（`governanceSettingsMatrix.ts`）：66 行、83 条 `file#symbol` 消费者引用，覆盖 `riskGovernance.*`（含 exitCoordination 全部 14 个叶子与 portfolioRisk 限额）、`positionManagement.*`、`takeProfit` 经济字段、`tradeEconomics.*`。每行带单位、区间、默认值、生效时点（`NEXT_MODEL_DECISION` / `NEXT_ENTRY_CYCLE` / `NEXT_TICK` / `NEXT_EXIT_ATTEMPT`）与一句人话含义。门禁**逐条验证消费者文件存在且源码里真的出现该标识符**，所以矩阵不会腐化成愿望清单。
- **AI 有了自己的利润许可线**：`decideAiExit` 的 `policy.minNetProfitUsd` 与计划地板同时生效、取更高者，verdict 上回报 `profitFloorUsd` 与 `profitFloorSource`（`AI_PERMISSION|PLAN_FLOOR|BOTH|NONE`）。未配置或非法 ⇒ `POLICY_CONFIG_INVALID_AI_MIN_NET_PROFIT`，不会悄悄回落到 TP 地板。该值进入 `decisionHash`，抬高它不能被说成“同一份授权”。R5 身份测试覆盖。
- **0.15 仍然是 0.15%**：`tradingCost.ts` 里除以 100 的算式被断言锁住，矩阵单位标为 `PERCENT_OF_MARGIN`；新值恰为当前值 100 倍时写入被拒（`GOVERNANCE_UNIT_REQUIRES_CONFIRMATION`），必须显式 `ack=PERCENT_UNIT_INTENDED`。0.15→0.3 这类正常编辑不受影响。
- **权限写入要确认**：`aiExitAuthority→ENFORCE` 需要 `AI_EXIT_ENFORCE_AUTHORITY`，`portfolioRisk.configured→true` 需要 `PORTFOLIO_RISK_PROFILE_ENABLED`；而 `OFF↔SHADOW`（都不提交任何订单）仍是普通编辑——要求每次点击都确认，只会训练操作者不看内容就勾。
- **边界执行**：`PUT /settings` 现在对治理命名空间做差分，未列入矩阵/只读/需 ack 的改动一律 400 并回显 `blockedPaths`，且**不消耗 settingsVersion**；`PATCH /settings/governance` 全有或全无，成功响应是服务端**存储后的回读**，不是调用方送回来的值。
- **面板**：新增“AI 退出与复核”页签。它不自己发明单位或换算：值、单位、只读原因、`ackOnlyFor` 全部来自服务端回读；面板逻辑抽到 `governancePanel.ts` 并单测，页面不能提交被服务端标为只读的字段。
- **备份/还原/保留真正覆盖了账本**：`scripts/durable-storage-inventory.mjs` 是唯一清单来源，部署前预检逐文件 `sqliteBackup` + `integrity_check` + **逐表行数指纹比对**（不一致即 `BACKUP_FINGERPRINT_MISMATCH`），保留由 `prune-zdj-backups.mjs` 的通用 `*.sqlite` 扫描覆盖。`storage-coverage.json` 改为脚本从仓库内容**推导**（`--verify-backup` 会真跑一遍备份自测），gate 从 `S02_..._OPEN` 变为 `S08_STORAGE_COVERAGE_PASS`；S02 的历史证据文件保持原样不改写。
- **账本 schema fail-closed**：`OwnershipJournal` 在建表**之前**读 `PRAGMA user_version`：高于本构建 ⇒ `OWNERSHIP_SCHEMA_NEWER_THAN_RUNTIME`；已盖章但表缺失 ⇒ `OWNERSHIP_SCHEMA_TABLES_MISSING`；空库/旧库盖为 v1。测试断言拒绝发生在 DDL 之前（比较源码里读章与建表的先后）。
- **迁移闭环（临时库）**：`preview`（只读，验证未写入）→ `apply` → 读回 → `backup` → `verify`（逐周期 + outbox 计数）→ 再 `apply` 必须 0 新建。人工持有的周期迁移后仍是 `HUMAN_MANAGED`，preview 永不落写。
- **`humanHandoffAfterMinutes` 可编辑的前提成立**：J1 已把它接到 FIRST_FILL 的 durable deadline；本轮矩阵消费者断言 + 测试锁住 `deadline = firstFillAt + minutes*60_000`，并证明后续调用不能拉长已确定的期限。

## 本轮新发现的“看似可配置、实际无效”

`riskGovernance.requirePostAiVerification` 与 `takeProfit.tpEconomicsEnabled` 在 engine 生产代码里**没有任何读取点**（全仓检索只命中页面与 `config/settings.default.json`）。已把两行改为 `editable:false` 并写明原因，且加了一条矩阵不变式：**消费者为 0 的字段不得可编辑**。不删设置项（保持兼容），但页面不再对它作出会落库的承诺。

## 红测→修复（P1 级）

第一次全仓 `npm test` 出 16 个红：`s04ExitCoordination.test.ts` 与 `c3RuntimeWiringHostile.test.ts` 用 `as PolicyInput` 绕过了类型检查，AI 利润地板成为必填后它们静默退化为 `BLOCKED_FACTS`，表现为 `VERDICT_NOT_ALLOW`。补 `minNetProfitUsd` 后复跑全绿——修的是夹具缺失的必填事实，不是放宽任何断言。另有一次 `expect(verified).toMatchObject({outbox:3})` 判错：一个人工持有周期会先记录初始行、再记录接管转移，实为 4；按事实更正并注明原因，而不是改代码凑数。

## 门禁（仓库根目录执行）

Engine 1113/1113（148 文件，J4 基线 1086/147）；core 46/46；dashboard 25/25（9 文件）；contracts 0 用例（exit 0，不计为契约覆盖）；`npm run typecheck` exit 0；`npm run build` exit 0；`npm run verify:scripts` exit 0（含预检自测对 durable 覆盖与账本行数保真的新断言）；S00 exit 0、入口 110（新增 2 个脚本，逐条复核后由构建器重生成）、0 blockers、148 测试文件全部隔离、0 仓库 dataDir 引用、0 生产端口引用、`exchangeWrites:0`、`network:NOT_USED`、`engineLifecycle:NOT_USED`、`settingsModified:false`；`node scripts/v396-storage-coverage.mjs --check` ⇒ `S08_STORAGE_COVERAGE_PASS`；`git diff --check` exit 0。

## 运行期观察（未干预）

期间 `scripts/v394-stage6-preflight.mjs` 的 CLI 分支报 `ENGINE_MUST_BE_OFF: port 8080 is listening`，说明本机 Engine 正在运行。该拒绝正是预检的设计行为；本轮未启动、停止、重启或以任何方式干预它。这个信号也暴露过一次真实缺陷：coverage 脚本原本 `import` 了预检模块，导致**导入即执行**部署前检查——已改为从独立清单模块读取。

## 未关闭项（不阻塞 J6）

- 人工操作后的完整“禁止前端乐观标 FILLED”交互回归、以及 owner/plan/budget/mandate/handoff ack 的完整仪表盘面，属运行期验收，随 J6 授权清单一起出。
- 两个无消费者开关的最终处置（接消费者或删除）需要先证明无必要事实，本轮只做只读锁定。

## 边界

隔离 worktree、临时 SQLite（OS 临时目录）、mock adapter、事件级夹具、静态源码派生检查。未启动/停止/重启 Engine，未部署，未修改 live Settings / live DB / 生产文件，未执行真实迁移，未调用交易所写接口。
