# Codex：V3.9.6 gross 风险额度可见化 + 分析恢复回归 + AI Run 详情 UX 一轮修补

目标分支：`codex/v396-final-convergence-20260922`。执行前先 fetch，并仅 `merge --ff-only` 到最新远端 HEAD。禁止 rebase / squash / force；PR #9 不动。

本轮是**离线代码/测试修补**。当前正在运行的 V3.9.6 Testnet 主实例保持不动：禁止 stop/start/restart/hot reload，禁止修改 live Settings/DB，禁止切 `TESTNET_ENABLED`/`ENFORCE`，禁止任何交易所写请求。完成后只 fast-forward push 代码和证据，等待后续部署授权。

## 0. 已确认事实，禁止重新发明语义

1. `riskGovernance.maxGrossExposurePct` 已经是正式后端真字段，不得新建第二套 gross quota。当前契约：`z.number().positive().max(20).default(1)`，即存储值为 ratio，`1.0 = 100% equity`，技术上限 `20 = 2000% equity`。这是 schema 技术上界，不代表建议值；本轮不得自动提高当前设置。
2. `riskGovernance.maxDirectionExposurePct` 同样已存在，默认 `.5 = 50% equity`。仓位槽位 `portfolio.maxPositions` 与 gross/direction exposure 是独立门：`27/50` 只说明 slot 未满，不说明仍有新增风险额度。
3. 当前 `SettingsView.vue` 有“最大持仓数量”输入，但没有 `maxGrossExposurePct` 对应控件；治理面板目前只筛 `riskGovernance.exitCoordination.*`，所以关键 exposure gate 对操作员不可见。
4. 用户刚刚手工平掉数个持仓后，系统无需重启即从 `CAPACITY_BLOCKED` 恢复到：`RUNNING ANALYSIS_ONLY`、资本候选 10、最近分析成功/最近调度均继续前进。这是正确行为，必须锁成回归测试。
5. `BrainView.vue` 的 AI Run 详情当前是长 `audit-drawer`，唯一“关闭”按钮在内容最底部；用户必须滚动很久才能关闭。

## 1. Gross / Direction 风险额度：只暴露现有真字段，不改风险算法

### 1.1 系统设置

在现有“策略与执行”风险参数区域增加一个清晰的“组合暴露上限”小组，至少暴露：

- `riskGovernance.maxGrossExposurePct`：文案“组合总名义敞口上限（占权益 %）”；
- `riskGovernance.maxDirectionExposurePct`：文案“单方向名义敞口上限（占权益 %）”。

UI 用百分数给人看和编辑，例如后端 `1` 显示 `100%`、`.5` 显示 `50%`；保存时精确除以 100 回到 ratio。不得发生 100 倍单位误写。字段范围必须服从 contracts 真 schema；不要为了 UI 另造一个更宽的 server contract，也不要改默认值/当前 live 值。

说明文字必须明确：

- 此额度只限制**新增 Entry 风险**；
- 不会强平已有仓位，不撤已有 TP/保护；
- 最大持仓数与 gross exposure 是两条独立限制；
- 即使 `positions < maxPositions`，gross/direction 任一耗尽仍可 `CAPACITY_BLOCKED`。

如果现有全量 `saveSettings` 已能持久化并回读这两个字段，就复用它，不增加第二套 API；如果已有治理写入边界对这两个字段有 authoritative metadata，则接入现有边界。任何提高额度的操作都必须是操作员显式编辑并保存，严禁代码自动提高、按持仓数量推导或为“恢复交易”放宽。

不要把这两个字段加入 `tradingParameterProfiles` 的保守/默认/激进模板，除非现有产品设计已经有一一对应的权威值；当前文件没有这些值，本轮禁止猜测。

### 1.2 驾驶舱可见性

在“新建仓执行权限”或“Portfolio Intelligence”中把两类容量分开显示，数据必须来自 Engine 已计算/投影的单一真源，不在 Vue 中另算第二份风险账：

- 仓位槽位：`used / maxPositions`；
- Gross exposure：当前 gross USD / 动态上限 USD / 占用百分比 / 剩余 USD；
- Direction exposure：LONG、SHORT 当前值 / 各自动态上限 / 剩余；
- 当前首个容量 blocker（gross / long direction / short direction / position capacity / 其它已存在 blocker）。

动态 gross 上限语义为 `equityUsd * maxGrossExposurePct`。如 Engine 当前 capital summary 已有这些值，直接投影；若缺少某个展示字段，只在 Engine projection 增加**由当前同一风险计算结果派生的只读字段**，不要在 dashboard 重新实现公式。

当已有 eligible/pipeline-ready 候选却被风险额度挡住时，页面不能再写“WAITING_CANDIDATE / 等待新候选”作为主解释；应显示类似 `CAPACITY_BLOCKED · Gross $x / $limit` 或对应方向首因。无候选时才显示 NO_SUPPLY/WAITING_CANDIDATE。

### 1.3 红测/回归

至少覆盖：

- equity=10,000、`maxGrossExposurePct=1` → gross limit=10,000；
- `maxGrossExposurePct=2` → limit=20,000；
- UI 100% → persisted 1.0 → GET/readback 仍显示 100%，不得出现 100/10000 倍误差；
- positions 27/50 但 gross 已满 → `CAPACITY_BLOCKED`；
- 手工减少已有仓位后，在**不重启、不改变 READ_ONLY、不改变阈值**情况下，gross headroom 恢复，`capitalExecutableCount` 可从 0 变正，下一次分析 tick 能继续 PRIMARY；
- 上述恢复期间 `placeEntry/cancelEntry/setLeverage` 仍 0 次，exchange writes 仍 0；
- 修改 gross 设置只影响未来新增风险 admission，不改变已有持仓 ownership/TP/exit/protection。

不要把用户刚观察到的 `AI_RESOURCE_BUSY` 当 bug；资本候选恢复后 AI 忙碌/运行是正确现象。

## 2. AI Run 完整审计详情：关闭体验修补

目标文件首先检查 `apps/dashboard/src/views/BrainView.vue`。当前 `audit-drawer` 内容很长，唯一关闭按钮在最底部。

必须实现：

1. 详情打开后顶部立即可见一个“关闭”按钮，不需要滚动；长内容滚动时顶部关闭区保持可见（sticky/fixed header 均可，但不得遮住审计内容）。
2. 把关闭逻辑收敛为一个 `closeDetail()`，清理 `detail/detailError/detailId`，必要时取消正在进行的 detail request，避免关闭后迟到响应又把抽屉打开。
3. “丢失焦点即关闭”：详情容器获得可管理焦点；当焦点从详情内部移动到详情外的应用 UI 时关闭。内部按钮、pre、重试等焦点迁移不得误关。不要把单纯的子元素 focusout 当成整个详情失焦。
4. 同时支持 `Escape` 关闭；若已有 overlay/backdrop 语义，点击详情外部区域也关闭。不要因为滚动、文本选择或详情内部点击而关闭。
5. 关闭后焦点尽量回到触发该详情的“查看决策/未执行原因”按钮/行，避免键盘用户丢失位置；若当前测试基础设施不便完整恢复，至少保证不把焦点留在已销毁节点。
6. 底部“关闭”可以保留作为长页末端便利入口，但顶部入口必须始终存在。

必须补 dashboard 测试，至少证明：顶部关闭可见并关闭；Escape 关闭；焦点移到 drawer 外关闭；drawer 内部焦点切换不关闭；关闭时迟到 `brainRun()` 响应不会重新打开；长内容/滚动不影响顶部关闭入口。

## 3. 不允许顺手做的事

- 不提高 `maxGrossExposurePct` / `maxDirectionExposurePct` 当前值；
- 不改变 `portfolio.maxPositions=50`；
- 不为了让候选更多而放宽风险算法、删除 blocker、把 UNKNOWN 当 0；
- 不配置目前仍 `configured=false` 的 V3.9.6 PortfolioRiskProfile；那是后续独立人工风险审批；
- 不切执行模式，不开放 Testnet 写，不切 AI exit ENFORCE；
- 不启停当前 Engine，不部署本轮构建。

## 4. 验收门禁

先红测再修。完成后从仓库根目录逐项运行并核验真实 exit code：

- 新增/相关 Engine targeted tests；
- Dashboard targeted tests（尤其 Settings + BrainView/Audit Drawer）；
- `npm run verify`；
- Engine/core/dashboard/contracts 对应 typecheck/build/test；
- `node scripts/v396-s00-static-check.mjs`；
- `node scripts/v396-storage-coverage.mjs --check`；
- `git diff --check`。

不得通过删断言、放宽测试或 shell 管道假绿。

证据放 `docs/evidence/v396/gross-risk-ai-run-ux-patch-20260923/`，至少有 `RESULT.md` 和关键测试输出。完成后独立 commit，只允许 fast-forward push 到 convergence 分支。

最终汇报仅需：HEAD；实际改动文件；现有 gross 字段当前语义/技术范围及 UI 暴露位置；红→绿缺陷；“手工减仓后自动恢复分析且写仍锁定”的测试结果；AI Run 关闭 UX 测试；全仓门禁；是否存在 blocker。不要启停 Engine，不要自签整版 ACCEPTED。