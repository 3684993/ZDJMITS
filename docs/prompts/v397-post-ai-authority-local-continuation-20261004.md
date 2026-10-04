# V3.9.7 本地实例续跑与最终闭环指令（2026-10-04）

## 任务性质

这是线上 GitHub 已完成 Entry 执行架构收敛后的**本地实例续跑任务**。不要重新设计已经合入 `main` 的 Entry 权威模型，不要恢复任何已经删除/降级的 post-Primary 策略门禁。

线上权威基线包含 PR #11：`V3.9.7 collapse post-Primary vetoes and make frozen PLACE authoritative`。

执行前必须先：

1. `git fetch origin`
2. 将本地工作树同步到 GitHub 当前 `main`
3. 审计并理解 PR #11 及其相关提交，再继续此前暂停的
   `docs/prompts/v397-entry-analysis-stall-final-closeout-20261004.md`
4. 若本地存在未推送工作，先审计差异；不得用旧代码覆盖线上新架构。

## 已确定的线上原则，不得反向修改

TESTNET Entry 的目标合同为：

- **确定性可执行性只在 Primary 之前证明一次。**
- Primary 只能在已冻结、已证明可执行的候选中做最终选择。
- Primary 返回有效 `PLACE_LONG` / `PLACE_SHORT` 并选中合法 frozen candidate 后，该 PLACE 即为最终策略权威。
- Primary 之后不得再由 Economics、Portfolio Risk、Gross、Direction、Cluster、Human exposure、历史 UNKNOWN、pending risk、market drift、evidence refs、统计概率、AI authorization age 等重新进行策略审判并取消这次 PLACE。
- post-Primary 发生的新风险/行情/证据变化只能记录为 observation，不得成为二次策略 veto。
- TradePlan 必须忠实持久化 Primary 选中的 frozen candidate，不得重新 sizing、改方向、改 target、换 candidate。
- `PLAN_EVIDENCE_UNRESOLVED` 等证据引用问题只能进入审计，不得阻止已合法 PLACE。
- 后置 economics 不得重新使用另一套 entry price / worst-case price 产生 `ECONOMIC_MIN_NET_PROFIT_UNMET`、`TP_TARGET_WRONG_SIDE` 等“先允许、后否决”。
- TESTNET funds-only 下风险计算保留为观察事实，不得重新获得 Entry veto 权限。

仍允许阻止真实 exchange wire call 的只有**物理执行事实**：

- 当前真实可用 quote 资金/保证金已经不足；
- Binance 硬性 filters、数量/价格精度、最小数量/最小成交额等真实交易所合法性；
- frozen candidate / identity / idempotency / durable persistence 本身损坏或无法证明；
- TESTNET 写入权限、Engine AUTO/RUNNING 状态真实失效；
- 私有账户事实无法证明到足以安全提交；
- 交易所 egress / set leverage / submit 本身真实失败或提交结果 UNKNOWN。

不得把上述“物理阻断”扩展成新的策略风险门禁。

## 本地必须完成的工作

### 1. 同步并加载线上代码

- 同步当前 GitHub `main`。
- 完整 build / typecheck / verify。
- 执行 S00、storage coverage、schema roundtrip、diff check。
- 允许并要求按需要 stop/start/restart 当前 TESTNET Engine。
- 当前本地实例必须最终加载最新 `main` build。
- Production writes 必须保持 0。

### 2. 恢复当前本机 AI 与行情链

以当前实例事实为准检查：

- Engine 8080；
- 9B / Primary / Review 的本机 endpoints（当前配置中的 8081 / 8083 / 8084 等）；
- GPU 模型实际在线状态；
- Binance websocket / REST 行情；
- quote / bookTicker / 1m / 5m / 15m / 1h / 4h / 1d 数据新鲜度；
- candidate universe → executable candidate → Primary dispatch 的真实转化。

禁止沿用旧电脑、另一实例或旧报告中的数量作为当前事实。

### 3. 验证新的 PLACE→Submit 权威链

必须主动寻找或构造当前实例可执行候选，并验证至少以下链路：

`pre-AI frozen executable candidate → Primary PLACE → frozen candidate materialize → TradePlan persist → reservation → intent → exchange submit`

重点证明：

- Primary PLACE 之后不会再出现
  - `ECONOMIC_MIN_NET_PROFIT_UNMET`
  - `TP_TARGET_WRONG_SIDE`
  - `QUOTE_USD_MISSING`
  - `PLAN_EVIDENCE_UNRESOLVED`
  - risk/gross/direction/cluster/history/pending 等
  作为 post-Primary veto。
- 若这些事实仍存在，只能作为 pre-AI refusal 或 post-AI audit observation。
- 若 PLACE 没有 submit，必须把**第一且唯一的真实物理阻断原因**指出来，并直接修复可修复的本地/代码问题。

不要以“等待自然样本”为工程问题的结束条件。可通过确定性 replay、fixture、当前真实输入回放证明的必须主动证明；只有真实交易所自然成交结果才可以明确标记为等待真实事件。

### 4. 继续上一轮尚未闭合的问题

继续审计并修复：

- Candidate=0 / AI 长时间不分析的当前实例根因；
- market-data stale / backfill / websocket 恢复；
- 本地历史 in-flight / UNKNOWN / claim 是否仍错误排除当前 candidate；
- Primary/Review endpoint 健康与 failure budget；
- Review `due → reserved → completed`；
- 当前交易所 Entry / TP / Position 与本地投影一致性；
- 历史 UNKNOWN 不得冒充当前 exchange open order；
- Dashboard “未挂单原因”必须优先显示人类可读第一原因，内部错误码放详细审计；
- AI Brain 必须能一眼看到最近 PLACE 数、Submit 数、PLACE→Submit 转化率及原因聚合。

### 5. 不得回退线上架构

如果本地调试发现需要代码修复，可以修改、测试、commit、push `main`，但：

- 不得恢复 post-Primary economics/risk/evidence/freshness veto；
- 不得用新 gate 替代旧 gate；
- 不得通过增加审核层解决 AI 决策质量；
- AI 决策质量问题应通过输入、模型、提示词、候选设计、训练/经验反馈改善，而不是在 AI 决策后拒绝；
- 必须区分“模型做了坏决定”和“系统没有执行模型决定”，二者不得混为一谈。

## 最终验收

完成后必须一次性给出：

1. 最终 GitHub `main` SHA；
2. 当前本地运行 build / PID / instance id；
3. identity closure 6/6；
4. TESTNET / Production writes=0；
5. AI endpoints 当前状态；
6. market-data 当前状态；
7. 最近 Primary PLACE→TradePlan→Reservation→Intent→Submit 的逐层计数；
8. 所有未提交 PLACE 的唯一第一原因及其分类（物理阻断 / 模型协议错误），禁止笼统“门禁”；
9. 是否仍存在任何 post-Primary 策略 veto；若存在必须继续修复，不得结束；
10. 当前 exchange Entry / TP / Position 与本地 readback；
11. full verify / build / S00 / storage / schema 结果；
12. 尚无法通过当前真实事实证明的项目。

最终报告写入：

`docs/reports/v397-post-ai-authority-local-closeout-20261004/FINAL_RESULT.md`

全部完成后 commit 并 push `main`。不要逐阶段询问我是否继续；允许按需要重启当前 TESTNET 实例。
