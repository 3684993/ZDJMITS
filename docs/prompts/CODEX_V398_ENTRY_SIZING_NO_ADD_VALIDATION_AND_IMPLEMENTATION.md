# Codex 执行提示词 — V3.9.8 建仓质量验证 / 禁止补仓 / 风险预算设计与分阶段实施

> 项目：`3684993/ZDJMITS`；专题：**v3.9.8建仓质量优化**；任务授权：**先本地只读验证真实代码、真实 TESTNET 交易/持仓/行情，再把完整复盘和实施计划提交 GitHub，完成远端回读后，按已证实的方案实施离线源代码与测试；不自动部署、重启或执行交易。**
>
> **此提示词是本轮 Codex 的执行入口。** 从 GitHub 最新 `main` 拉取，禁止仅依靠本提示词写出的历史数值替代最新事实。它覆盖旧讨论中“可能允许有限 scale-in”的假设：**最新用户策略原则为禁止补仓**。

## 0. 立即开始：GitHub 是完整上下文，不询问用户复述历史

工作目录 Windows `D:\MITS`，但它可能有脏文件；必须先只读检查 `git status`、当前分支、`origin/main`、远端最近提交、GitHub Actions、证据保存与数据可用性。优先创建**隔离工作树**，不 stash/reset/clean 用户的 `D:\MITS`，不覆盖他人提交。每阶段执行前 `git fetch` 并比较远端最新 `main`；普通 fast-forward / PR 流程，不 force push，不擅自 rebase 他人的工作。

**按顺序完整读取下列文件及其引用：**

1. `docs/prompts/CHATGPT_V398_ENTRY_QUALITY_OPTIMIZATION_START.md`
2. `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`
3. `docs/reports/v397-trade-entry-exit-quality-review-20261008/TRADE_ENTRY_EXIT_QUALITY_REVIEW.md`
4. `docs/plans/V397_ENTRY_EXIT_TP_QUALITY_OPTIMIZATION_PLAN_20261008.md`
5. `docs/reports/v397-trade-learning-p0-20261008/P0_FACT_LAYER_IMPLEMENTATION.md` 及 P0 原始证据/manifest
6. `docs/reports/v398-entry-sizing-quality-review/ENTRY_SIZING_QUALITY_REVIEW.md`
7. `docs/plans/V398_ENTRY_SIZING_RISK_BUDGET_PLAN.md`
8. 相关代码、测试、合约、Settings 与 CI workflow

参考起始状态（**仅供校验，不是永久 HEAD**）：2026-10-08 的 `main=5cd9a9af1f053cd0990508840f671898492c243d`，之前 P0 事实层 `42334c4` 与证据收尾 `cf7007a` 已在 main。P0 代码**未部署**，本地历史 237 files / 2047 tests 通过不等于最新托管 GitHub Actions 成功；之前 8080 未监听，不可将旧健康快照冒充当前运行事实。P0 冻结 165 closed cycles：canonical 0、funding UNKNOWN 165、lot lineage EXACT 33/UNCERTAIN 132；这些是**历史冻结样本**，不是现在的实时账户数字。

**先给出一个简短阶段性状态摘要并写入证据文件**：远端 HEAD、具体工作树及已有 dirty inventory、最新 Actions run ID/conclusion/url、当前 Engine 8080/TESTNET read-only 可用性、实际可读 SQLite 与订单/成交事实范围、明确 UNKNOWN。不能因 Engine 停止而擅自重启，也不能假装拿到了 fresh TESTNET 数据。

## 1. 用户的核心问题和最终目标

系统可能在周线/大周期极高位置大仓位 LONG，在周线/大周期极低位置大仓位 SHORT；在错误方向大量持仓时，风险可急剧放大。**目标不是禁止这些方向，也不是简单统一减仓、统一减杠杆或修改 TP；而是把高周期位置、方向质量、波动、损失尾部、现有仓位和组合相关性转化为适当的可执行 quantity / notional。**

必须严格区分 `quantity`、`notional`、`leverage`、`initial/maintenance margin`、`liquidation risk`、`stress loss`、`gross/net directional exposure`、`quote-asset utilization`；降低 leverage 不等于降低相同 notional 的方向价格风险。历史 HUMAN_MANAGED 仓位不可被自动增加风险、自动退出或自动 TP 越权。

**最新强约束：禁止补仓 / 禁止摊低成本 / 禁止后续独立加仓授权（所有 symbol 和 LONG/SHORT，盈利后 scale-in 也默认禁止）。**

- 新 cycle 允许 Primary 决定一次初始建仓的最大**累计授权 quantity**；同一原始订单多个 partial fills 不等于补仓；网络重试只允许 exact identity 与原授权剩余数量范围的幂等恢复。
- 已有 cycle 的任何新独立 ENTRY/add order、额外 plan/run 或人工管理后自动增仓，都必须在实施设计中予以阻止，并在真实调用链上证明阻止点及无竞态。
- 在冻结 candidate / 初始授权**之前**表达这条确定性策略边界；不能在 Primary 合法 PLACE 后再引入主观 Direction/Cluster/Stress/Historical 模糊 veto。
- 禁止补仓**不等于禁止 TP 改价**；允许评估有权限的 TP 价格调整，必须维持同一受保护库存、exact order identity、durability、owner-version、quantity conservation，不通过改价增加数量。
- 历史 ETH/AVAX 的补仓不得抹掉/修正，原样保存用于复盘、证明哪条路径允许了 add。

## 2. 必须逐源码证明：真实 sizing、allocation、ADD 与 authority 路径

不能仅凭类型字段或旧文档猜测系统决策链。使用 `rg` 定位及追踪确切函数、调用方和测试，以 **file:line + commit** 表格解释：

1. market/symbol/side candidate、Primary packet、model input/output、Primary PLACE 和授权版本。
2. `v397FrozenSizing.ts` 中 `minimumQuantityForTarget` 的 minimum 100 quote initial margin、10–20 leverage 约束、minimum notional、target absolute min-profit，何时为满足利润 floor **主动放大 quantity**。
3. `quantityHorizonCandidates.ts` 的 quantity ladder、target/horizon、quote asset、funds envelope、candidate hash、冻结 executable candidate，风险字段 `capitalAtRiskUsd/grossNotionalAfterUsd/longNotionalAfterUsd/shortNotionalAfterUsd/clusterNotionalAfterUsd` 在哪里计算、何处真的有约束力、哪些旧 veto 已取消。
4. allocation plans、capital reservation、entry intents/orders、entry submit/admission、trade plan、order retry/idempotency、partial fill、trade-record cycle 和 TP/protection。
5. 任何 ADD/averaging/manual/position review/HUMAN_MANAGED 转移后的独立入口：实际权限、ownerVersion、可能导致增仓的路径；检查同时发起的 ENTRY、pending orders、cancel/replace、lost ACK、重复 submit。
6. TESTNET available balance、per-asset margin、leverage、liquidation/bankruptcy、market freshness/JIT、public/private WS truth、REST exact recovery；区分物理事实与风险建模估计。
7. `entryLineage.ts` 的 intent→entryOrder→fill→TradePlan→completed PRIMARY run 逐 lot 证明；不能用最后 VWAP/最终持仓量回填过往。

输出可机械审计的 `architecture-callgraph.md`、`sizing-authority-audit.json`（使用当前仓库实际代码，不伪造行号），以及明确“尚未证实”的调用链清单。重点查证：**是单次 floor 推大 origin 数量、每次 add 拿到新完整 budget、还是现有 gross/exposure 限制未进入最终候选？** 所有归因必须对应交易记录与源码。

## 3. 只读收集 TESTNET / SQLite / 历史事实（先于任何算法）

自动利用本机已有项目脚本和安全只读能力，优先复用已提交的只读采集路径；先审计脚本是否有隐含下单、状态写入或无界历史读取，再使用。**禁止删/reset/迁移 live SQLite、禁止修改 Settings、禁止触发交易、禁止把 PROD 账户或秘密带入证据。** 如需 SQLite 副本，使用能保持 WAL 一致性的官方只读/backup 方法，不用 `immutable` 忽略尚未 checkpoint 的 WAL 后谎称完整；所有查询有明确时间/数量/行数上限，避免主线程全历史扫描或加重 6.14s Reactivity 问题。

收集字段至少：

- 当前 TESTNET 全部持仓：environment/account/symbol/side/native quote asset、owner、origin first-fill、hold age/target horizon、quantity、origin/current VWAP、leverage、mark/executable quote 与源时间、notional、margin 已证/估计、realized/unrealized PnL、funding UNKNOWN/fees、每次 add 和 TP/protection、open orders/UNKNOWN submit。
- 保留每笔 TradeRecord、entry intent/order/execution fill、allocation/trade plan、PRIMARY/ENTRY run、decision time/contextCreatedAt、candidate qty、实际 fill qty、局部订单身份、plan/owner/TP 版本及所有状态变更；缺失用 UNKNOWN，不猜。
- 周线、日线、4h、1h、15m **已收盘** K 线、必要历史高低/趋势/ATR/波动/订单可执行性；每个历史决定时间点只允许使用当时已 closed 且可观测的数据。周线边界、exchange clock、bar closeTime、feature cutoff、run finishedAt、order fill timestamp 显式。
- 对每个历史 lot 的当时组合资产/同方向名义量、其他未决订单 reservation、available margin、同一因子相关性与资产 USDT/USDC 对应范围；不能用今天的组合回填。
- MFE/MAE、max intra-cycle and portfolio adverse PnL、stress tail、funding proof status、right-censored open positions、历史低频/gapped price path。

**特别要求追查两个真实案例：**

- ETHUSDT LONG：2026-10-05 14:57:18 首次成交，历史共 5 次补仓；用户先前观察约 -261.65 USDT / -65.76%。
- AVAXUSDT SHORT：2026-09-20 00:10:45 首次成交，历史共 25 次补仓；用户先前观察最大约 -1000 USDT，后约 -298.59。

上述浮亏是**用户过去的观察**，不是实时读数，也不是已验证的精确 historical max；逐笔重建 origin 和每一个 add 的时间、数量、价格、side、当时 Primary run/authority、前后 risk budget、owner 和 Portfolio exposures。解释 **为什么实际允许 5 / 25 次 add**，能证明多少解释多少；不能把“多笔成交 = 多次独立新补仓”未经订单身份核对直接成立。

另外复盘全部当前/近期仓位并按周线位置、趋势、方向、quote asset、canonical 资格、周期年龄、浮亏和组合暴露分层。若 8080 离线、远端数据不可达或历史缺字段，继续研究离线现存证据，写明完整性，并产出安全的补证脚本和文件，不假称完整，不能启动 Engine 绕过阻塞。

## 4. 研究 `HigherTimeframeLocationScore` 和 `DirectionalExtremityRisk`

不要简单用 RSI>70 veto LONG、RSI<30 veto SHORT。仅研究 closed-bar point-in-time 的：

- weekly 26w/52w rolling high-low price location/percentile、EMA20/50 extension、weekly ATR-normalized distance、weekly robust return z-score、recent high drawdown/low rally；
- daily/4h trend slope、ADX/directional persistence、volatility regime、swing / breakout/retest、均值回归与趋势延续的区分；
- LONG 高位 / SHORT 低位的位置相关风险，以及 **高位 + 强趋势**、**高位 + 衰减**、**低位 + 强下跌趋势**、**低位 + 衰减**、震荡上下沿的二维划分；
- time cutoff、lookback 数据覆盖/质量、source freshness 和 missing-window。窗口不足或 stale 不得猜“中间分位/正常风险”。

位置决定 **size/risk sensitivity** 而不是方向真假；趋势/Setup/Primary 仍决定 Entry 机会及方向。把特征分成 deterministic size evidence / model-context evidence / experiment-only，禁止无证据升级为后置 Entry veto。

## 5. 必须公平比较的候选 sizing 政策

以**当前策略**为基线，在相同 origin 时刻、相同预冻结机会与相同可观测数据上比较至少以下 8 组；可以增加但不要用未经验证的网格搜索偷选最佳参数：

| Candidate | 应验证的机制 |
| --- | --- |
| Uniform haircut | 所有初始仓位等比例减小，简单对照 |
| Linear location scaling | 按方向不利高周期位置线性缩量 |
| Nonlinear / sigmoid / convex location | 极端位置非线性缩量，区分强趋势与衰减 |
| Volatility targeting | realized vol / daily+weekly ATR 归一 |
| Stress-loss budget | 按 side-specific adverse-move 分位、expected shortfall/regime 控制最大**估计压力损失**，不是没有止损却声称绝对最大损失 |
| Cycle cumulative budget | 初次 Entry 冻结物理周期风险账；历史多 lot 反事实核对，**未来 separate adds 固定禁止** |
| Portfolio directional + correlation-adjusted exposure budget | 同方向 gross/net、共同 crypto beta/factor、quote asset、相关集群的增量损失上界 |
| Hybrid | 独立资金/交易所/物理 cycle / scenario stress / portfolio 上界取交集；位置/趋势/波动可做合理软预算映射，谨防重复惩罚 |

**不要直接实施** `BaseSize × Location × Vol × Cycle × Portfolio × DataConfidence`；先比较直接相乘与 **`Qmax = min(Qfunds, Qcycle, Qstress, Qportfolio, Qfactor)`** 加软 preference 的方案，证明谁会重复计算同一尾部事件。Correlation 样本稀疏/市场极端相关性突升，要以保守共同 shock scenario 替代过度乐观的点估计。USDT 和 USDC 不经确证 FX 不相加。

**最重要的潜在实现冲突：** 如果新的风险 `Qmax` 小于现有 `minimumQuantityForTarget` 所求出的最小盈利/保证金/交易所数量，不能自动把 quantity 放大到清除 profit floor；报告 `NO_FEASIBLE_EXECUTABLE_QUANTITY` 的确切原因，区分 exchange/funds legal 与 strategy economic/quantity risk，保证 Primary 仍是 Entry authority，不能通过更高杠杆掩盖 notional 风险。

## 6. 逐 lot 的反事实与科学评估

对 ETH / AVAX 至少进行：

A. **no-add-only counterfactual**：独立后续加仓授权数量为 0；同一 origin order 的真实 partial fills/合法幂等恢复保留；维持策略当时执行现实、资金占用和历史时间切分。
B. **no-add + initial sizing variants**：origin quantity 经各方案缩量，用新数量重新计算当时资金、notional、margin、压力风险、后续实际可行性；不能把真实下单后会受影响的 future fills 当作必然相同。
C. 与真实历史原始策略对比的 `max adverse / current historical PnL`、浮亏路径、portfolio risk、opportunity loss；将价格路径“静态历史环境 replay”与真正影响市场/执行流动性的未知分开，TP 成交 touch ≠ guaranteed fill。

分析所有周期时 **每个 cycle 是主要统计独立单位**，不要把 AVAX 25 个 add 算作 25 个独立赢家/输家。报告 net PnL（需 formal fee+funding 资格）、noncanonical stress/PnL（明确标注）、worst 1%/5%、ES/CVaR、max drawdown/MAE、underwater time、initial & final notional、margin usage、liquidation risk、turnover、human management、winning-trade size contraction、losing-trade loss reduction、long/short、regime、symbol、asset、missingness。open positions 应标 right-censored，不删除“没有结束的亏损”。

Chronological purged walk-forward、embargo、按 cycle/day/regime block bootstrap、固定 out-of-sample holdout；所有特征及参数拟合只能用每段训练截止之前可见资料，不将 2026-10-08 结果倒灌 2026-09-20 决策。一个完整周线 K 线必须在当时决策前已收盘。 funding UNKNOWN 不补 0、不喂 Qwen 正式净收益训练；P0 的 `EXACT/UNCERTAIN` 及覆盖缺口保持原语义。若样本不够，写 `INSUFFICIENT_EVIDENCE` 而不是给武断最佳阈值。

## 7. 严格执行阶段门禁：先验证并提交计划，再实施离线代码

### Phase R0 — 只读基线与系统权限审计
检查最新 main/CI/current data/worktree dirty 状态；生成 `README_EVIDENCE.md`、`main-ci-runtime-baseline.json`、`architecture-callgraph.md` 与真实来源清单。禁止改 live 策略或交易。

### Phase R1 — 有界事实采集 / ETH AVAX lot 验证
真实只读收集；输出 `positions-asof.json`、`lots-by-cycle.csv`、`entry-quantity-lineage.jsonl[.gz]`、`historical-exposure-asof.csv`、`market-bars-coverage.json`、`eth-avax-case-study.md`、`missing-facts.json`（文件名可按真实内容调整；含来源、覆盖、时间戳和脱敏情况）。任何文件不含 API keys/private tokens/user secrets。保留查询界限、校验计数、哈希清单、读写计数。

### Phase R2 — 算法复盘与实施计划（**必须先远端提交并读回**）
至少更新两份现有文档，明确当前 HEAD、方法、定量实验结果及无法计算的 UNKNOWN：

- `docs/reports/v398-entry-sizing-quality-review/ENTRY_SIZING_QUALITY_REVIEW.md`
- `docs/plans/V398_ENTRY_SIZING_RISK_BUDGET_PLAN.md`

新增 `docs/reports/v398-entry-sizing-quality-review/` 的可复算数据、代码调用图、指标 CSV/JSON、图表如有、测试脚本、logs、manifest 与 SHA256。Plan 要包含：每个文件/函数拟修改点、authority 正确性、data prerequisites、no-add 语义、freeze timing、补偿流程/竞态、风险优先级、数据完整性 gate、回滚/验证准则、何种政策为 shadow-only，以及 **哪些参数还不能确定**。**普通 Git commit/push 到 GitHub，再 fetch/readback 严格验证提交 SHA 与所有关键 hash；计划在远端完成之前不允许动生产策略源文件。** 远端基线变化先比较/合并，不覆盖他人工作。

### Phase I1 — 离线实施（本任务授权在计划与证据闭合后继续）
完成 R2 并满足实现所需事实 gates 后，按照经审计的最小化设计 **在隔离 worktree 实施代码与单测**，不改变现有运行实例。优先：
1. 在初始授权前规范 `no separate add orders` 的确定性原则；保障已有持仓、同 symbol/side、并发 pending、partial fills、idempotent recovery、owner/handoff 竞态。禁止人工持仓被自动加仓；不要从平仓保护流程衍生开仓。
2. 设计确定性风险数量上界和审计输出；只在 frozen candidate 形成前接入，避免后置主观否决；完整覆盖 quantity floor 冲突/stepSize/minNotional/TP economic floor/available funds。
3. 仅对已充分验证的 `HigherTimeframeLocationScore / DirectionalExtremityRisk / stress / portfolio` 特征做可复算结构或 **shadow-only** 实现；没有时间戳/覆盖率/真实样本，就不启用新 live sizing multiplier 或捏造默认数字。
4. TP 价格优化是独立候选，严守 owner/protected TP 状态，不得成为补仓/解除 TP 授权的旁路。不得顺手启动之前 P1/P2/P3、F04/F10/F11 或 Reactivity 工作。

所有改动必须先有 targeted tests；必要时执行仓库认可的隔离 full verify（先遵守 S00/权限隔离，不跑用户未批准的 lifecycle/exchange entrypoints），保存完整 `stdout/stderr` 与结果；必要 GitHub Actions 只读检查直至有实际状态。属性测试覆盖：初始 quantity 不超 min of bounds；加大同向暴露不得凭空放宽最大 qty；unknown 保守且审计；资金/asset 归属；周线 PIT/lookahead；部分成交与重复提交；多线程并发二次 add；重启/恢复与未确认订单；HUMAN_MANAGED；TP cancel/replace 无数量增加；环境 TESTNET only / Production writes 0。无授权不得重启 Engine、改变参数或对 TESTNET 发任何订单；offline code push 不等于部署。

### Phase I2 — 代码交付与验收（无自动部署）
提交源代码、单元/集成验证、真实测试证据、更新的报告/计划与 `IMPLEMENTATION_REPORT.md`。以 reviewable commits 和普通 FF/PR 整合到 GitHub，核对最新 main 无他人提交被丢失。CI 未完成或失败写明，不宣称成功。最终报告列出 source SHA、证据目录与 hash、回归结果、no-add 防护证明、shadow/实盘开关状态、遗留 UNKNOWN、对下次授权上线的具体 gate。**停止在“源代码完成、未部署”**，等待用户单独批准 TESTNET lifecycle/deployment/实际订单行为变化。

### 必须停止代码变更的 blockers
真实持仓/历史证据与代码入口身份不一致、关键 owner/quantity/order chain 不可证明、工作树/他人提交冲突、canonical 资格被错误放宽、CI 健康不足、S00 violation、无法建立 TESTNET-only 和 zero exchange-write 边界、缺少风控特征覆盖或参数校准。此时应完整提交只读发现、缺口与后续补证脚本，注明 `IMPLEMENTATION_BLOCKED`，不为赶进度硬上线。

## 8. 维护证据 / 输出文件 / 安全规则

- 长输出**绝不要求用户粘贴控制台**；所有 stdout + stderr `*.log`，统计 `*.json`/`*.csv`，生成在版本化证据目录并提交；生成本地命令也保存为 `scripts/` 下脚本及实际执行日志。终端仅短摘要与绝对文件路径；若必须用户操作，提供短命令执行保存到文件并只要求上传文件。
- 把含可识别账户 ID、凭据、Cookie、OAuth token、私钥、密钥、完整私有 prompt 的字段做脱敏/排除；提交前用已有 secret scanner + 检查 manifest。不能把用户本地环境变量、数据库凭据、机器机密、币安 token 推到 GitHub。对数据导出在不影响可复算性的前提下去敏，保留本地私有 hash/ref。
- 不删除/reset SQLite/TradeRecord/history；不更改 `D:\MITS` unrelated dirty entries；不 stash 强制清理；不重写既有真实交易历史；不用未来持仓规模回填。
- User Data WS order truth / Public WS quote truth 优先；REST exact order 仅恢复，UNKNOWN 不 duplicate submit；TESTNET-only，Production writes 为零的**目标与读数**必须分开，不证明当前读数不得填 0；不恢复 NET-003/004 static egress-IP authorization。
- Primary 仍是 Entry authority；REVIEW_BRAIN 不是第二 Entry veto；资金/交易所合法性/订单 identity/授权与环境边界严格 fail-closed；HUMAN_MANAGED 不自动增仓/退出；F04/F10/F11 和 6.14s Reactivity 问题暂停。
- 本地测试/Engine/模型资源不得无授权停止、启动或替换。不得改 SSH/SOCKS / model resources / strategy Settings / margin leverage profile 来绕过风险。
- **全程至少两个明确的 GitHub 发布检查点：R2 计划及研究证据提交与远端 readback；I2 代码、测试与实施报告提交与远端 readback。** 完整审计每个提交/当前 main 与远端、文件 hash，所有重要维护证据都在 GitHub，不能只留在聊天或本地临时文件。

## 9. 向用户最终汇报的简洁格式

在 R2 完成时报告：`main SHA / CI / Engine status`；真实支持的 architecture 调用链；ETH/AVAX 有据可核的逐 lot 根因和 UNKNOWN；八策略对比中可/不可量化的结果；推荐的 **no-add + stress-cycle-portfolio hybrid** 或被事实推翻的替代方案；正式 Plan URL/commit 与实施 gate。接着按 Phase I1/I2 离线实施。最终报告：代码 SHA、实际修改、tests/Actions 状态、所有证据的 GitHub 链接、明确**未部署/未重启/未交易**以及剩余阻塞。不得把计划、已开发、已部署混成同一完成状态。

**立即执行 R0：先从 `origin/main` 获取所有上述文件、审计本地状态和证据可用性，然后 R1→R2，远端确认后才准开始 I1→I2；不要先给一个凭直觉选出的仓位比例，也不要请用户重复历史。**
