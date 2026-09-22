# J6 离线回放、压力、统计与发布材料（S09 + S10 可离线部分）

输入基线 `a7b022b`（J5）。执行令：`docs/plans/v396/CODEX-FINAL-CLOSEOUT-20260922.md` §7；规格：`docs/plans/v396/09-replay-stress-statistics.md`、`10-testnet-release-acceptance.md`。机器可读结果：[manifest.json](manifest.json)、[experiment-manifest.json](experiment-manifest.json)、[experiment-report.json](experiment-report.json)、[release-manifest.json](release-manifest.json)。

## 之前的事实

S09/S10 在仓库里没有任何可执行的东西：没有事件流回放器、没有成本与延迟建模、没有预注册清单、没有统计置信区间、没有发布清单，`historicalTpReachability` 之类只服务于单一指标。所谓“样本外验证”在实现层面不存在。

## 现在的事实（全部离线）

- **预注册清单**（`s09ExperimentManifest.ts`）：`experimentId` 由内容导出（含每组 `configHash`）。会把“事后可以调的东西”全部拒掉：切分顺序、embargo 必须覆盖最长评价窗、universe 必须按事件时点构建、未知数据不得静默丢周期、六个预注册组（A/B/C/D/E/E-minus-memory）缺一不可、风险预算必须来自 S05 准入档案、bootstrap 配方必须完整、成本模型不得缺资金费/滑点来源、模型延迟不得为 0、必须有复现命令与输入 hash。`formal` 只被会改变结论的警告阻断（门槛缺失、假设人工即时响应）；`NOT_MEASURED` 的 token 对照作为披露项，不用来判整场实验无效。
- **回放器**（`s09ReplayEngine.ts`）：事件只在自己的 `availableAt` 之后可见；重复/乱序投递**按投递顺序计数**后再按因果顺序处理（否则计数器恒为 0，报告就会声称“干净的 feed”）；部分成交、ACK 丢失（保持未确认、资本仍占用、绝不重发）、只能由交易所事实定稿、下架按最后可观测价加 taker 成本、清算记为保证金全损而非盯市价；同一根 K 线同时穿越目标与亏损线时给出**悲观值 + 乐观界**；未闭合周期 `netPnlUsd=null` 且 `holdingMs` 至少算到计划期限（资本占用与未平仓年龄都进分母）；funding 符号未知 ⇒ 不给净数，也不写 0。
- **统计**（`s09Statistics.ts`）：固定种子 stationary-block bootstrap（几何块长、百分位区间、95%）、配对优势、判定函数按 ENGINEERING_PASS / ECONOMIC_SUPPORTED / INSUFFICIENT_EVIDENCE / FAIL 四态；CI 跨 0、成本不全、样本不足、覆盖低于地板、任一预注册组未报告 ⇒ `INSUFFICIENT_EVIDENCE`；泄漏或硬不变式破坏 ⇒ `FAIL`；年化比率必须自带自相关/短窗/非独立采样三条声明，两个样本不给值。
- **结果生成器**（`scripts/v396-replay-report.mjs` + `v396-replay-bundle.mjs`）：跑满“每组 × 每个人工响应情景”，失败组保留；输入包字段与声明 hash 不一致即 `REPLAY_INPUT_HASH_MISMATCH`；**没有冻结事件流时写出 `runStatus=NOT_RUN` 的报告并以退出码 2 结束**，给出可复现命令，不产生任何数值。
- **发布清单**（`scripts/v396-release-manifest.mjs`）：package/release 身份统一到 **3.9.6**（`RELEASE_VERSION`、`API_VERSION` 与五个 `package.json` 必须全等，否则脚本直接报 `PACKAGE_RELEASE_IDENTITY_MISMATCH`，不允许只改版本号）；记录 commit/分支/工作树是否干净/基线祖先、settings 默认值 hash、34 个关键文件与证据 hash、封存后的实验身份、storage-coverage gate，以及 7 项需要运行授权条目的 `NOT_RUN/NOT_MEASURED/PENDING_WINDOW_INCOMPLETE` 状态；`claims` 四项全 false，`state=READY_FOR_TESTNET_AUTHORIZATION`。
- **运行清单**：`docs/plans/v396/RUNBOOK-S08-S10-OPERATIONS-20260922.md` 给出隔离迁移演练 7 步（preview 只读、逐文件备份指纹、apply 不造 AI 权限、逐周期 readback、镜像回退后只读打开、重跑幂等、新版本账本被旧构建拒绝）与生产迁移 / SHADOW / canary / Testnet 写回合 / 24h soak / 样本外回放 / 发布的判据和证据模板。

## 明确未做与不声称

- 样本外经济结论 `NOT_RUN`：本轮没有真实冻结事件流，报告里没有任何收益数字。
- `tokenSavingRatio` 保持 `NOT_MEASURED`：不存在同一冻结事件集两侧完整 usage（J4/J6 一致）。
- 当前封存的 experiment manifest `formal=false`，因为 `INPUT_DATA_NOT_HASHED`（无真实数据）——这是预期状态：接上真实数据后重跑预注册才会 `formal=true`。
- ADL/维护动作的精确撮合序列未建模；回放只用“保证金全损/下架可成交价”给出边界，因此不得据尾部结果声称尾部安全已完整覆盖。
- 本轮生成的 `release-manifest.json` 记 `worktreeClean=false`（生成时 J6 尚未提交）；最终整仓门禁会在干净工作树上重跑覆盖它。

## 红测（S09-T01–T08）

`s09ReplayStressHostile.test.ts` 22 项：方向不对称不得被合并胜率抹平；清算=保证金全损；成本上升必须能吃掉薄优势；无人接管保持右删失且资本仍占用；重复/乱序只成交一次；ACK 丢失不重发、只由事实定稿；下架按最后价；入口证据晚于决策时点 ⇒ `FUTURE_DATA_LEAKAGE`；评价窗跨切分 ⇒ `SPLIT_STRADDLE`；被删周期必须仍作为删失出现；缺组/embargo=0/预算来源不是 S05 ⇒ 预注册拒绝；改一个参数 ⇒ 新 `experimentId`；同输入重跑逐字节相同；CI 跨 0 与成本不全不得升格。

先复现后修的三项真实缺陷：censored 周期资本占用被算成 0（会抹掉深亏成本）、重复/乱序计数器恒为 0（排序后再计数）、`seal` 先评审后补 `configHash` 导致新清单永远不 formal。

## 门禁（仓库根目录执行）

Engine 1135/1135（149 文件，J5 基线 1113/148）；core 46/46；dashboard 25/25；contracts 0 用例（exit 0，不计为契约覆盖）；`npm run typecheck` exit 0；`npm run build` exit 0；`npm run verify:scripts` exit 0；S00 exit 0、入口 114（新增 4 个离线脚本，逐条复核）、0 blockers、149 测试文件全部隔离、0 仓库 dataDir 引用、0 生产端口引用、`exchangeWrites:0`、`network:NOT_USED`、`engineLifecycle:NOT_USED`、`settingsModified:false`；`git diff --check` exit 0。

## 边界

全部离线：临时目录、合成事件流、派生脚本。未启动/停止/重启 Engine，未部署，未执行真实迁移或 live DB 写入，未调用交易所写接口，未运行 canary/Testnet/soak。
