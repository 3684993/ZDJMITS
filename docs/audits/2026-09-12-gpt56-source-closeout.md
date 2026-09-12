# ZDJ-MITS V3.9.2 源码收尾审计（2026-09-12）

基线：`audit-live-20260912` / `f747d959663d77cb3956a4d485bcd56b756653e1`

修复分支：`gpt56-closeout-20260912`

## 本轮边界

本轮只做源码静态收尾，不启动 Engine，不访问真实 Binance/Testnet，不启动本地 AI，不执行自动建仓。故障基线保持只读。

## 已完成的启动前阻断修复

1. Binance REST 调度从“请求次数”改为 endpoint `REQUEST_WEIGHT` 预估 + 响应头观测双重治理。
2. Testnet 与 Production Public Research 使用独立 RequestBudget，禁止 Production 研究污染 Testnet 本地预算状态。
3. 本地保护阈值：public soft=1000、background soft=1800、hard=2200；保留 Binance 2400/min 之前的安全余量。
4. 418/429 的 `blockedUntil` 持久化到 `data/rate-limit/binance-*.json`。
5. 418/429 到期后进入 RECOVERING：一次只允许一个探针，连续 3 次成功后才恢复正常并发，避免多个 timer 同时惊群。
6. 已为 `/openOrders`、`/income`、`/account`、`/positionRisk`、`/klines`、`/depth`、`/ticker/24hr`、`/premiumIndex`、`/userTrades`、`/allOrders` 等建立保守权重估算。
7. 保留 Private/订单请求优先级，但它们同样受 hard weight 约束，不能再无限绕过 public throttle。
8. 增补静态单元测试：endpoint weight、Production/Testnet 隔离、weight precharge、ban 后 sequential recovery。
9. Dashboard/Entry Observation 对 `NO_DIRECTION_EDGE`、`RESELECT_SYMBOL`、`DATA_ERROR`、`AI_OUTPUT_INVALID` 不再展示强制 schema 产生的伪 LONG/SHORT；只有 PLACE/WAIT 保留方向语义。

## 已审计但不作为首次启动阻断项

- Entry 决策真实主链是 Candidate -> Primary 27B；9B 当前主要是外部研究，不是每个候选的前置 Entry 模型。UI/文档应按真实职责理解。
- Prompt 本身已明确 15m=方向、1m/5m=时机、4h=背景；PLACE 仍受 direction permission、15m direction、maker reachability、reservation、risk envelope 等确定性门控。
- TP Guardian 仍依赖 reconciliation 维持交易所事实一致性；首次启动验证必须专门核对本地 `PROTECTED` 与 Binance open order 的一一对应。
- SQLite 历史表 retention/compaction 属于长期运行治理项，不阻断首次受控 Testnet 启动，但必须在长稳验收前处理。

## 首次启动前人工条件

- 不直接运行 `audit-live-20260912`。
- 本地工作树必须同步到 `gpt56-closeout-20260912` 对应提交。
- 启动时确认历史 418 ban 已自然到期；若 Binance 再返回 418/429，立即验证 RequestBudget 是否进入 RATE_LIMITED/RECOVERING，禁止人工反复重启绕过退避。
- 首次启动只允许 Testnet，Production write boundary 必须保持 0。

## Codex 启动后验证重点（后续，不属于本轮）

1. typecheck/build/tests。
2. Engine 启动后 10 分钟只读观察：`restBudget`、418/429、used/estimated weight、Private Sync、Reconciliation、WS。
3. 确认 Production asset research 不改变 Testnet budget。
4. 确认 ban recovery 同时最多一个 Binance REST probe。
5. Private READY 后核对持仓、open orders、TP 保护事实。
6. 再开启 Entry，并验证 Candidate -> Primary -> Intent -> Maker -> Binance -> Fill 全链；禁止跳过前述观察直接自动建仓。

## 当前源码结论

本分支已消除本次审计中最危险的“错误预算模型 + Production/Testnet 交叉污染 + 解禁惊群”三项结构性问题。是否进入正式长稳运行，必须由后续启动后的 Testnet 事实验证决定。
