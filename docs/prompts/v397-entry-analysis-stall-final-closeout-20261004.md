# V3.9.7 当前实例：不分析 / 不建仓 + 历史 UNKNOWN 债务最终闭环

日期：2026-10-04  
仓库：`3684993/ZDJMITS`  
目标：只围绕当前实例已经暴露出来的“不再分析、不再建仓、候选为 0、AI 资源离线/降级、历史 UNKNOWN/claim 继续污染运行态”进行反驳式审计和直接实施。

> 本文件只定义问题、矛盾、必须回答的证据问题和最终验收目标。
> 不预设根因，不要求沿用上一轮设计，也不指定具体修法。
> Codex 必须根据当前源码、当前本机进程、Settings、SQLite、运行事件、AI archive、交易所 TESTNET、行情数据和实时 readback 自行证明、反驳、定位、修改并部署。

---

## 0. 当前证据只能作为快照，不能作为真相

用户在 2026-10-04 早晨看到的 Dashboard 主要事实：

- TESTNET / TESTNET_ENABLED；
- 总资产约 10,549.55；
- USDT 可执行保证金约 3,863.69；
- USDC 可执行保证金约 4,979.40；
- Total Entry Trading Capital 约 8,843.10；
- 当前持仓 10；
- 当前交易所确认 Entry 0；
- TP 10；
- 本地未决 UNKNOWN 3；
- Gross/Direction/Cluster 均为 OBSERVE；
- 自动执行模式 AUTO_RUNNING；
- Entry Safety=AUTO；
- 可执行候选 0；
- USDT / USDC 可路由标的都是 0；
- 最终 LONG/SHORT 新增名义容量均显示 0，首因 NO_CAPITAL_ROUTE；
- 系统给出的权威首因又是 NO_EXECUTABLE_CANDIDATE / MARKET_QUOTES_STALE；
- 19/19 候选被隔离；
- 市场流全局仍有新的 ticker / bookTicker message 时间；
- stream state 显示 CONNECTING；
- 263 subscriptions；
- 7 个 kline gap；
- backfills=0；
- Market Center READY；
- freshness DEGRADED；
- Universe READY=66；
- excluded symbols=45；
- pending Entry / in-flight 显示约 26，slot 显示 36/50（持仓10 + 在途26）；
- 但交易所活动 Entry=0；
- 最近一小时 Primary/PLACE/TradePlan/Submit/Fill 全为 0；
- Dashboard 显示“距最近分析成功约 523 分钟”；
- AI 大脑最后一批可见 Run 停留在 2026-10-03 21:22 左右；
- 当前 SCOUT / PRIMARY_BRAIN / REVIEW_BRAIN 都显示 DEGRADED；
- Primary 的下一步文案为“Entry Primary 模型离线”；
- Review enabled，但：
  - considered≈18；
  - due≈8；
  - reserved=0；
  - completed=0；
  - exhausted≈9；
  - failureBlocked≈1；
  - skippedReason=REVIEW_BUDGET_EXHAUSTED；
- cycle conservation 仍 DEGRADED；
- funding coverage 仍 PARTIAL；
- 历史 UNKNOWN / claim 债务上一轮并未闭合。

这些数字只是该时刻界面快照。

**执行本任务时必须重新采样。**
任何结论都要用任务执行时的当前事实证明。

---

# 1. P0：为什么系统有资金、有自动权限，却没有任何可执行候选

必须沿完整链路回答：

`Universe → exclusion → market facts → eligibility → capital route → AI dispatch → TradePlan → Entry`

逐层给出：

- 输入数量；
- 输出数量；
- 被剔除数量；
- 每一个剔除原因的计数；
- 哪一层第一次从“有标的”变成“0 个可执行候选”。

不要只引用最终 `NO_EXECUTABLE_CANDIDATE`。

必须证明：

1. 当前 Universe 中实际有多少交易对；
2. 为什么 excluded 数量如此高；
3. 现有持仓、真实活动 Entry、历史 UNKNOWN、历史 claim、pending intent、reservation、execution task、cooldown、quarantine、market blacklist 各自排除了多少 symbol；
4. 是否存在同一个 symbol 被多个原因重复计数；
5. 是否存在“交易所 Entry=0，但本地仍认为有 26 个 in-flight”的事实；
6. 如果存在，这 26 个到底是什么实体；
7. 这 26 个是否继续参与：
   - duplicate-symbol exclusion；
   - slot accounting；
   - candidate lifecycle；
   - capital routing；
   - analysis eligibility；
   - AI dispatch suppression；
8. TESTNET funds-only / OBSERVE 是否只取消了 risk veto，却仍然通过“in-flight / pending / claim / UNKNOWN 去重”间接阻止 Candidate 进入 AI；
9. 历史 claim 是否已经从“风险观察项”变成了事实上的隐藏 Entry gate；
10. Dashboard 的“持仓10 + 在途26 = 36槽位”是否与当前 exchange Entry=0 的真实状态一致。

如果旧历史状态仍在减少 Candidate supply，这一项必须作为真实运行阻断修复，而不是仅在 UI 上隐藏。

---

# 2. P0：为什么交易所 Entry=0，本地却仍有大量 pending / in-flight 语义

上一轮已经证明过历史 UNKNOWN 并不等于远端 open order。

本轮继续追：

1. 当前：
   - remote open Entry；
   - entryOrders；
   - entryIntents；
   - reservations；
   - execution tasks；
   - claims；
   - unknown rows；
   - active-entry projection；
   - candidate pending-underlying projection；
   分别是多少？
2. 哪些记录真正代表“未来仍可能向交易所提交”；
3. 哪些已经不可能提交；
4. 哪些只是审计历史；
5. 哪些仍被 runtime 当作 in-flight；
6. restart hydration 是否会把历史记录重新放回 pending 集合；
7. 一个已经远端 ABSENT 且超过 TTL 的 Entry identity 是否还会继续：
   - 占 slot；
   - 排除 underlying；
   - 阻止新 Candidate；
   - 被计入 pending Entry；
8. “active risk claim”和“active Entry execution”是否被错误复用成同一含义。

必须继续上一轮历史债务清理：

- 历史 UNKNOWN / claim 不能伪造成 terminal；
- 但也不能因为证据不足永久污染当前 Candidate、slot、analysis、health；
- 必须明确 operational state 与 historical audit debt 的边界。

---

# 3. P0：为什么行情全局在收消息，但 19/19 Candidate 全部 MARKET_QUOTES_STALE

这是本轮最关键的矛盾之一。

Dashboard 同时显示：

- global ticker/bookTicker 时间持续更新；
- subscriptions 很多；
- Market Center READY；
- 但 freshness DEGRADED；
- 19/19 Candidate 都存在 QUOTE_STALE / ORDER_BOOK_STALE；
- 大量 Candidate 还存在 TECHNICAL_1m_STALE / MISSING_LATEST_CLOSED；
- 部分 5m / 15m 也缺；
- kline gaps >0；
- backfills=0；
- pipeline 因 MARKET_QUOTES_STALE 暂停。

必须逐 symbol 验真：

1. global stream 收到的最新消息到底属于哪些 symbols；
2. 当前 19 个 Candidate 是否真的在 subscription set 中；
3. 是否发生 Universe/Candidate 动态变化后 subscription 没同步；
4. quote cache 是否收到这些 symbol 的 ticker/bookTicker；
5. exchange event time、receive time、local clock、freshness comparison 使用的是哪一个；
6. 是否存在时间单位或时钟源错误；
7. reconnect 后 stream state 为什么可能长期显示 CONNECTING；
8. reconnect 后旧 subscription 是否实际恢复；
9. ticker/bookTicker 最新消息与 per-symbol quote timestamps 是否一致；
10. depth/order book 是否因为 sequence gap 后永久失效；
11. kline gap 为什么没有 backfill；
12. `MISSING_LATEST_CLOSED` 是交易所真的没有、collector 漏取、bar-close 边界错误，还是 repair 未执行；
13. 1m / 5m / 15m / 4h / 1d 的 freshness policy 是否混用了错误时间窗口；
14. 是否存在“某个 symbol 缺 1m”导致其他本来健康的 facts 被整体判 stale；
15. market-data isolation 是否真的做到单 symbol 隔离，还是所有实际可选 symbol 恰好都被某个共同数据链故障击中；
16. 为什么当前 `backfills=0`，这是否符合设计。

不能只把 stale threshold 调大来制造健康。

必须找到数据为什么没有正确进入 Candidate facts，或 freshness 为什么错误判断。

---

# 4. P0：为什么 AI 在昨晚约 21:22 后不再正常运行

当前用户看到：

- AI audit 最后一批 Run 在 2026-10-03 21:22 左右；
- 当时 Primary 有 COMPLETED / FAILED；
- 之后长时间没有新的成功分析；
- 当前 9B、Primary 27B、Review 27B 都显示 DEGRADED；
- Primary 文案是模型离线；
- Dashboard 又曾显示“最近 Primary dispatch”更新到更晚时间。

必须建立完整时间线：

1. 21:22 后 8081、8083、8084 各发生了什么；
2. 是否进程退出；
3. 是否模型还在但 health probe 失败；
4. 是否 Engine 自己停止 dispatch；
5. 是否 network/VPN/localhost/proxy 逻辑错误影响了本地 AI endpoint；
6. 是否 Windows 虚拟内存 / GPU / llama-server 崩溃；
7. 是否同时出现多个 llama-server 进程异常退出；
8. 是否端口被占用或服务已重启到不同端口；
9. 是否 Engine 的 endpoint health cache 把一次失败永久/长期保留；
10. health probe 恢复后是否会自动恢复 duty；
11. Dashboard 的 DEGRADED 是否是真实连接失败、过期 health sample，还是 stale UI；
12. “最近 Primary dispatch”究竟表示：
    - 真正 HTTP 请求已发出；
    - 进入 queue；
    - scheduler 尝试；
    - 被 readiness 阻止；
    - 只是更新时间戳；
13. 为什么 AI archive 没有对应 Run；
14. current Primary/Review resource 的 `totalRuns`、active、queueDepth、lastCompletedAt、lastError 与 archive 是否一致。

本轮必须区分：

- Candidate=0 导致没有必要调用 AI；
- AI endpoint offline 导致无法调用 AI；
- 两者同时存在。

不能用其中一个掩盖另一个。

---

# 5. P0：为什么所有 AI 资源同时 DEGRADED

必须独立验证：

### 8081 9B

- 进程是否存在；
- /health；
- /v1/models；
- 实际模型；
- 真实最小推理；
- Engine probe；
- Settings readback。

### 8084 GPU1 Primary

同上。

### 8083 GPU2 Review

同上。

回答：

1. 三个资源为什么同时显示 DEGRADED；
2. 是三个服务都退出，还是 Engine health system 有共同故障；
3. localhost AI 是否不应该经过外部 VPN/Proxy；
4. Binance proxy/VPN 变化是否意外影响 localhost model routing；
5. AI endpoints 是否被 forced proxy；
6. 模型恢复后 Engine 是否无需重启就能重新变 ONLINE；
7. 当前 resource health state machine 是否能自动恢复；
8. Dashboard health 和真实 endpoint health 是否一致。

如果本机模型进程本身存在不稳定退出，要继续追到可证明的系统/脚本/资源原因；不能只手工启动一次就结束。

---

# 6. P0：Review 明明启用，为什么再次变成 reserved=0 / completed=0

上一轮已经获得过真实 GPU2 Position Review。

现在 UI 又显示：

- AI活跃周期 0；
- due 8；
- exhausted 9；
- failureBlocked 1；
- reserved 0；
- completed 0；
- skippedReason REVIEW_BUDGET_EXHAUSTED；
- lastVerdictAt=0。

必须反驳式审计：

1. 为什么上次真实 HOLD 之后现在 lastVerdictAt 又是 0；
2. 是当前 instance readback 不含历史 verdict，还是 verdict 恢复丢失；
3. review budget 的“exhausted”到底是：
   - 当前周期真实达到上限；
   - 旧错误调用遗留；
   - restart hydration；
   - budget window 没滚动；
   - failure counter 没释放；
4. 为什么 8 个 due 一个都不能 reserve；
5. 这些 budget 是否设计成永久生命周期预算；
6. 如果模型/代码 bug 已经修复，旧失败是否仍会永久阻止未来 review；
7. current failureBlocked 的 exact cycle 是谁、原因是什么；
8. scheduler fairness 是否让部分 cycle 永远没有 review；
9. Position Review 与 Pending Entry Review 是否互相抢占 GPU2；
10. GPU2 endpoint offline 与 budget exhausted 哪一个才是当前首因。

不能通过简单清零所有审计历史制造通过。

但已经被旧 bug 错误消耗的预算，也不能永久让新代码无法工作。

---

# 7. P0：NO_CAPITAL_ROUTE 是否真的是资金问题

当前：

- USDT 可执行保证金约 3,863；
- USDC 约 4,979；
- reserved 0；
- lease 0；
- Entry capital >8,800；
- Gross/Direction/Cluster OBSERVE；
- hard saturated dimension NONE；
- portfolio admission NOT_APPLICABLE；
- 但 LONG/SHORT final capacity 都显示 0；
- reason=NO_CAPITAL_ROUTE。

必须回答：

1. NO_CAPITAL_ROUTE 是因为“没有 candidate 可计算 route”，还是资金计算真的得到 0；
2. routeable symbol=0 是由 market data、pending identity、symbol exclusion、quote asset mapping、margin tier coverage 还是其他原因造成；
3. 在没有 Candidate 时显示 LONG/SHORT $0 是否误导；
4. 是否存在资金本身明明可用却被错误地投影成 capacity=0；
5. USDT/USDC quote routing 是否正确；
6. 200 notional / 1 initial margin / leverage / exchange minimum 是否造成所有 Candidate 被 route 拒绝；
7. margin-tier missing coverage 是否重新成为隐藏阻断；
8. risk OBSERVE 是否还有其他 path 写入最终 capacity 0。

不能简单删除 `NO_CAPITAL_ROUTE`。

要证明第一处让 route 变成 0 的真实事实。

---

# 8. P0：为什么 Candidate supply 只有 19，并且 19/19 全坏

当前可见：

- universe≈66；
- excluded≈45；
- candidate pool≈19；
- healthy candidate=0。

必须对 excluded 45 做 reason histogram。

特别检查：

- current positions；
- historical/pending Entry；
- same-underlying exclusion；
- blacklist；
- cooldown；
- quarantine；
- market quality；
- quote availability；
- listing age；
- depth；
- active lifecycle；
- stale historical reservations；
- claims；
- 24h history。

必须证明 45 个 excluded 中有没有大量本不该排除的 symbol。

不能只修 19 个 market stale，而留下候选供给被历史状态压缩的问题。

---

# 9. P1：Primary 大量 FAILED 的真实原因

AI audit 在最后一批 Run 中显示多个 Primary FAILED。

必须按最近一段可用历史统计：

- COMPLETED；
- FAILED；
- timeout；
- output truncated；
- schema invalid；
- JSON parse；
- model HTTP；
- model process reset；
- context/token；
- authorization expiry；
- market facts stale after inference；
- economic reject。

逐原因给数量和比例。

回答：

1. 为什么 Primary 约 60–73 秒运行中有大量 FAILED；
2. FAILED 是否与 27B context / memory / output token / llama-server instability 有关；
3. 23k input tokens 是否合理；
4. 是否存在明显重复/无用上下文导致模型慢和不稳定；
5. 在 60+ 秒分析完成后，原 market facts 是否已经过期；
6. COMPLETED PLACE 为什么仍常见 ECONOMIC_MIN_NET_PROFIT_UNMET；
7. Primary 是否在生成一个本来就无法满足当前 $200 notional / $1 net profit 的计划；
8. sizing/economic solver 与 Primary 的职责是否存在矛盾；
9. 不要把经济拒绝重新变成微小单 fallback。

这项重点是提高“可执行分析”的成功率，不是降低经济门槛来制造成交。

---

# 10. P1：历史 UNKNOWN / claim 最终清理继续进行

上一轮尚未完成的历史债务继续处理：

- historical UNKNOWN；
- active UNKNOWN Entry claims；
- reconciliation drift；
- cycle inconsistent；
- unconserved；
- unproven；
- funding attribution UNKNOWN。

必须重新统计当前真实数量。

重点回答：

1. 哪些 UNKNOWN 已有足够 remote evidence 可以释放 active-risk 语义；
2. 哪些必须继续 UNKNOWN；
3. 历史审计 UNKNOWN 是否仍污染：
   - candidate exclusion；
   - slot；
   - pending；
   - analysis；
   - current health；
4. drift 是否是当前运行故障还是历史账务债务；
5. operational health 是否被历史不可恢复记录永久拉成 DEGRADED；
6. funding unknown 是否继续阻止 AI Exit；
7. 46 inconsistent / 72 unconserved / 4 unproven 的最新数量和来源；
8. 能否用已有 fill/order/position/trade facts重新证明，而不是猜。

保留证据，不删账求绿。

---

# 11. P1：当前 Dashboard 的状态语义是否自相矛盾

必须核实这些 UI 文案是否准确：

- scheduler RUNNING 但 pipeline PAUSED；
- Market Center READY 但 freshness 0；
- executionReadiness READY/或 BLOCKED 的不同组件是否一致；
- authoritativeBlocker READY 但 system reason 又 BLOCKED；
- Primary dispatch 有新时间但 AI archive 无新 run；
- activity READY 但最近1h全部0；
- current active Entry 0 但 pending/inflight 26；
- NO_CAPITAL_ROUTE 但可执行资金 >8,800；
- Review HEALTHY 但 reserved/completed 0 且 budget exhausted；
- AI resources DEGRADED，但整体 /health 可能仍 READY。

要求 UI 每个状态只描述自己的事实。

如果是当前设计允许这种组合，必须把文案改到不误导；
如果是数据来源不一致，则修复 authoritative projection。

---

# 12. 实施要求

本轮不是只写报告。

Codex 必须：

1. 拉取当前 `main`；
2. 读取：
   - `docs/reports/v397-final-system-closeout-20261003/FINAL_CLOSEOUT_RESULT.md`
   - 最近 v397 implementation reports；
3. 对本文每个问题做当前实例实时验真；
4. 允许反驳用户和旧报告中的任何推断；
5. 找到根因后直接实施；
6. 可以修改：
   - Engine；
   - Dashboard；
   - contracts；
   - Settings/schema/migration；
   - SQLite repair/migration；
   - AI launcher / local runtime scripts；
   - market-data recovery；
   - resource health；
   - candidate lifecycle；
   - reconciliation；
7. 数据修改前必须备份；
8. 允许按需要 stop/start/restart 当前 TESTNET 实例；
9. 不需要逐阶段向用户申请继续；
10. 禁止 Production 写入。

不要重新把：

- Gross；
- Direction；
- Cluster；
- Human exposure；
- historical UNKNOWN；
- position count；

重新变成新的 Entry 风险 veto 来“解决”不建仓。

本轮目标是修复 **错误的事实供应、历史状态污染、模型不可用、候选供应中断、调度/生命周期错误**。

---

# 13. 不允许用“等待自然样本”结束的项目

以下工程问题必须主动验证：

- 8081/8083/8084 endpoint 是否真实在线；
- Engine resource health 是否能恢复；
- Candidate per-symbol market facts 是否更新；
- kline repair/backfill 是否运行；
- candidate exclusion histogram；
- historical in-flight 是否错误占用；
- Candidate>0 能否恢复；
- AI dispatch 是否真实发出；
- Primary archive 是否生成；
- Review scheduler 是否能 reserve；
- GPU2 Position Review 是否能再次真实完成；
- Dashboard 与 runtime facts 是否一致；
- exchange open Entry 与 local active projection 是否一致。

如果没有自然交易机会，不要求伪造真实成交。

但“AI 会不会分析”“行情会不会变新鲜”“scheduler 会不会调度”“历史状态是否错误阻断”不是未来市场事件，不能继续保持 UNKNOWN。

---

# 14. 最终验收

至少要求：

### Entry / Candidate

- 自动模式仍为 AUTO_RUNNING；
- 当前资金事实正确；
- risk OBSERVE 不作为 veto；
- healthy/routable Candidate 不再因为系统 bug 长期为0；
- 如果市场确实没有候选，必须能逐 symbol 证明真实原因；
- 不再存在 remote Entry=0 但大量 stale in-flight 隐藏阻断 Candidate 的情况；
- Primary 能在真实 Candidate 出现时被实际调用。

### Market

- per-symbol quote/book freshness 与真实 stream 一致；
- missing latest closed kline 有明确修复/恢复路径；
- reconnect 后 subscriptions 正常；
- backfill/repair 可观测；
- 不再出现“全局消息新鲜但全部 Candidate stale”而原因不明。

### AI

- 8081/8083/8084 当前真实状态与 Dashboard 一致；
- Primary 实际 Run 可生成 archive；
- Review 能再次完成真实 GPU2 run；
- health failure 可恢复；
- 本地 AI 不被外部 VPN/proxy 错误影响；
- 大量 Primary FAILED 的首因被修复或诚实量化。

### Historical debt

- historical UNKNOWN 与 current execution state 分离；
- active claim 只在仍有当前风险意义时占用运行态；
- old audit debt 不无依据阻断 Candidate/AI；
- current health 与 historical audit debt 分开展示。

### Deployment

- full verify；
- typecheck/build；
- S00；
- storage/schema roundtrip；
- git diff --check；
- TESTNET final runtime；
- identity 6/6；
- Production writes=0；
- local main == origin/main；
- clean worktree。

---

# 15. 最终报告

生成：

`docs/reports/v397-entry-analysis-stall-final-closeout-20261004/FINAL_RESULT.md`

报告必须逐项回答：

1. 为什么昨晚约21:22后不再正常分析；
2. 为什么当前三个 AI resource DEGRADED；
3. 为什么 19/19 Candidate 全部 market stale；
4. 为什么 global stream 有消息但 per-symbol facts stale；
5. 为什么 backfills=0；
6. 为什么 remote Entry=0 但系统曾显示 in-flight≈26；
7. 这些 stale in-flight 是否实际阻断 Candidate；
8. excluded 45 的 reason histogram；
9. Candidate 0 的第一真实根因；
10. NO_CAPITAL_ROUTE 的第一真实根因；
11. Primary FAILED 原因分布；
12. Review budget exhausted / failureBlocked 的根因；
13. historical UNKNOWN/claim 最新状态与当前运行影响；
14. 修复后 Candidate / AI / Review / market / orders 的真实 readback；
15. 最终 SHA；
16. runtime build / PID / instance；
17. tests / S00 / storage / schema；
18. identity 6/6；
19. Production writes=0；
20. 真正只能依赖未来市场成交才能验证的剩余 UNKNOWN。

完成所有可主动验证和修复的问题后，commit + push `main`。
