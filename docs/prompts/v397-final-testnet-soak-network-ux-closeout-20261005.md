# ZDJ-MITS V3.9.7 最终 TESTNET Soak Readiness / 网络与交易所错误 UX 收口执行提示词

日期：2026-10-05  
仓库：`3684993/ZDJMITS`  
执行对象：Codex GPT-6 Sol  
目标：这是 **V3.9.7 上实盘前最后一次代码级收口**。完成后不再继续改核心 Entry/Primary/solver 架构，而是启动同一 build 的 24 小时 TESTNET soak；24 小时通过后再由用户决定是否进入小资金 Production canary。

---

## 0. 执行方式、授权与不可突破边界

你必须一次性执行本文件，不要逐阶段向用户请求确认。

允许：
- `git fetch --all --prune`、同步当前最新 `origin/main`；
- 审计并保护本地未推送 worktree/branch，再从最新 main 开始；
- 修改代码、测试、文档、脚本；
- stop/start/restart 当前 TESTNET Engine、Dashboard、8081/8083/8084 AI 服务；
- 对当前 TESTNET 做 GET/签名 GET 事实读取；
- 为部署前后做数据库/配置备份；
- 在 **明确证明是 TESTNET** 的前提下，为建立 24h soak 干净基线而安全处理 TESTNET 持仓、Entry、TP、人工委托或测试资金状态，但必须遵循第 9 节的决策规则；
- 根据当前实例真实证据对本提示词列出的实现选择作工程判断，不需要向用户二次确认。

禁止：
- 切换到 Production；
- 使用 Production 凭据进行任何写操作；
- 任何 Production order/account write；
- 为了“变绿”删除历史 UNKNOWN、cycle/funding 证据、订单历史或数据库事实；
- 把缺失事实当作 0；
- 为了解决 VPN/网络偶发问题去改 Entry 策略、降低安全门槛或绕开 Binance 错误；
- 为了提高 PLACE→Submit 率重新引入 post-Primary 策略 veto 或重新计算 frozen candidate；
- 修改已经闭合的 100 USDT/USDC 最低初始保证金、10–20x frozen leverage/quantity/TP solver 原则；
- 在本轮启用 Production canary。

**本轮 Production writes 必须始终为 0。**

本轮正式版本继续保持 **V3.9.7**。不要仅因为这次 observability/UX/soak closeout 再制造 V3.9.8 语义分叉；buildId/source hash 正常随代码变化。

---

## 1. GitHub 基线与既有已闭合事实

开始时先确认最新 `origin/main`。本提示词创建前已知 main 为：

- `6e79e7d5fdde650227140047caa95e70ae482a7e`
- message: `docs(v397): record final post-publication runtime readback`

既有最终报告：
- `docs/reports/v397-entry-sizing-primary-authority-version-closeout-20261004/FINAL_RESULT.md`

既有核心实现：
- `5784ad44b48c4fff84400542946925d5416381b6`
- V3.9.7 正式版本统一；
- 100 USDT/USDC minimum initial margin；
- 10–20x frozen candidate solver；
- Primary 用 `selectedCandidateId` 选择冻结可执行候选；
- PR #11 后 Primary PLACE authority 基本收口；
- TESTNET real Entry 已经过 `PLACE → TradePlan → Reservation → Intent → Submit → Fill`；
- Position Review / Pending Entry Review 已有真实结构化结果；
- 6/6 runtime identity 闭合；
- Production writes = 0。

GitHub Actions：
- #437 / run `37207432004`，第一次 Vitest worker 通信超时，第二次 rerun 最终 `success`。
- 不要把一次不可复现的 CI worker IPC timeout 当作交易系统产品 bug；但本轮最终 Actions 必须成功。

开始工作前必须：
1. `git status --porcelain=v2 --branch`
2. `git fetch --all --prune`
3. 保护所有本地未推送提交、untracked 文件、旧 worktree；
4. 用最新 `origin/main` 建立干净工作树；
5. 不要用旧分支整体覆盖 main；
6. 所有最终实现从当前最新 main 向前演进。

---

## 2. 用户提供的当前驾驶舱事实：必须作为本轮 live-audit 起点

以下是用户在 2026-10-05 驾驶舱看到的当前实例快照。数值会变化，所以你必须重新从运行实例和 Binance TESTNET 读取事实，但这些矛盾/现象必须逐项解释或修复。

### 2.1 账户 / 持仓 / TP

用户看到：

- 总资产估值：`$4,846.65`
- 浮动盈亏：`-$742.76`
- 当前持仓：`17`
- 已实现交易收益（不含资金费）：`$269.11`
- “正式净收益”：`$0.00`
- `233` 个完整周期
- `221` 笔资金费未确认
- remote/local positions：17 / 17
- required/working TP：17 / 17
- 交易所确认 Entry：0
- 本地未决 UNKNOWN：2

资产表：

- USDT wallet `5589.41084296`
- USDT available `1190.75620851`
- USDT USD valuation `$5,589.41`
- USDC wallet `4987.3517077`
- USDC available `4907.97286301`
- USDC USD valuation `$4,987.35`
- BTC 0.01，但当前 UI USD valuation 为 `—`

Entry funding 区显示：

- USDT executable margin `$1,190.76`
- USDC executable margin `$4,907.97`
- Total Entry Trading Capital `$6,098.73`

**必须审计：**
`$4,846.65` 的“总资产估值”与资产明细、可用资金、浮盈亏明显不在一个直观口径。不要猜。必须用 Binance TESTNET 当前 signed account/balance/position facts 找出每个数字的来源与公式，并修复 UI/Engine 语义。

### 2.2 最近执行与漏斗

最近 1 小时：

- Entry fills 201
- Exit fills 2
- Closed trades 0
- Net PnL `$0.00`
- External / unlinked fills 0
- fill proof:
  - DURABLE_ORDER_TABLE 142
  - ORDER_REGISTRY 2
  - UNPROVEN 59

30m funnel：

- Primary 完成 7
- PLACE 7
- Authorized Primary PLACE 7
- “风险准入通过” 0
- TradePlan 7
- Reservation 6
- Intent 6
- Submit 4
- Fill 1
- PLACE→TradePlan 100%
- TradePlan→Submit 57.1%
- Authorized PLACE→Submit 57.1%
- Submit→Fill 25%

已授权但未提交首因：

- 提交结果未知，等待身份查询 1
- 执行链事实未证明 1
- 私有账户数据无法证明 1

最大流失：

`ORDER · BINANCE_REQUEST_QUEUE_TIMEOUT|requestId=adc671dc-b2b2-4a7d-a410-2996e70b016f|endpoint=/fapi/v1/leverage|method=POST|source=UNKNOWN|purpose=BINANCE_HTTP|routeIdentity=proxy-a087cc91667b`

这条是本轮 **P0 检查项**：已知 Binance endpoint `POST /fapi/v1/leverage` 绝不能以 `source=UNKNOWN` 进入 request budget。它属于新 Entry 的执行关键控制步骤，必须获得执行优先级/正确 TTL/正确 purpose，不能误进 MARKET_PUBLIC 默认 lane。

### 2.3 行情 / 网络

当前：

- pipeline: `PAUSED_MARKET_DATA_UNAVAILABLE`
- system reason: `MARKET_QUOTES_STALE`
- 12/12 symbol 被隔离
- healthy candidate = 0
- `NO_EXECUTABLE_CANDIDATE`
- AUTO_RUNNING 保持，但停止模型调用
- market stream 显示 LIVE
- reconnects 135
- gaps 1552
  - websocketConnection 135
  - depthSequence 3
  - kline 1549
- backfills 3

12 个 symbol 同时出现 QUOTE_STALE / ORDER_BOOK_STALE / 1m/5m stale/missing/sequence invalid。

用户明确要求：

> VPN/网络问题不需要 Codex 证明“闭合”或证明节点永不掉线。系统只需要安全 fail-closed、自动恢复，并把错误以清晰红色警告告诉用户；用户自行检查/更换可正常访问且符合交易所规则的 VPN/网络出口。

因此：
- 不把“VPN 24h 永不抖动”作为 release gate；
- 但“网络坏时是否安全、是否能正确分类、是否自动恢复、是否告诉用户正确原因”必须作为 gate。

### 2.4 其它驾驶舱语义

执行真相：

- order terminal parity UI = HEALTHY
- “不一致订单 0”
- detail 同时显示 `drift=11; unresolved=210`

cycle accounting：

- DEGRADED
- inconsistent 46
- unconserved 76
- conserved 493
- unproven 6

funding：

- PARTIAL
- exact 14
- unknown 607
- income rows 374
- UI 同时显示 `coverage=COMPLETE`

Review：

- HEALTHY
- active cycle 1
- due 0
- exhausted 15
- failureBlocked 3

Gross exposure：

- Gross `$44,406.55`
- UI 对比上限 `$4,846.65`
- 916.2%
- LONG `$30,635.76`
- SHORT `$13,770.78`
- TESTNET Gross/Direction/Cluster 都是 OBSERVE，不允许恢复成新 Entry veto。

这些历史 accounting debt 本轮 **不要求修复成绿色**；只要求真实、清楚、不会误导用户，不再获得 TESTNET Entry 的 strategy-veto 权力。

---

# 3. 本轮总目标

完成以下四个收口：

1. **统一网络/VPN/交易所错误为用户可理解的产品级 incident 模型，并在 Web 全局红色显示；**
2. **修复驾驶舱事实语义冲突与可证明的显示/分类 bug；**
3. **修复已知 Binance request source/lane 分类缺陷，尤其是 POST leverage = UNKNOWN；**
4. **部署后建立一个可重复、可审计的 24h TESTNET soak baseline，并明确判断是否需要重置/清理 TESTNET 账户状态。**

不要再重构核心 Strategy/Primary/solver。

---

# 4. P0：统一 Operational Incident / 用户错误模型

## 4.1 单一权威错误投影

在 Engine/contracts 中建立一个稳定的用户层 incident 数据结构。名字可由你决定，例如：

- `OperationalIncident`
- `UserFacingOperationalError`

但必须至少包含：

- `incidentId`
- `active`
- `category`
- `severity`
- `publicCode`
- `titleZh`
- `messageZh`
- `remediationZh`
- `subsystem`
- `blockingScopes`（例如 MARKET_DATA / NEW_ENTRY / EXCHANGE_WRITE / PRIVATE_DATA）
- `sourceCode`
- `sourceMessage`
- `firstSeenAt`
- `lastSeenAt`
- `recoveredAt`
- 可选：
  - `requestId`
  - `endpoint`
  - `method`
  - `routeIdentity`
  - `httpStatus`
  - `binanceCode`
  - `expectedEgressIp`
  - `observedEgressIp`
  - `retryAfter`
  - `blockedUntil`
  - `rawDetail`

**Dashboard 不再自己正则猜错误类型。Engine 统一分类并投影。**

raw detail 必须保留在 audit drawer / details 中，但主页只显示人类可理解信息。

## 4.2 必须支持的稳定用户错误码

至少实现：

### NETWORK / VPN

**NET-001 — VPN_OR_NETWORK_UNAVAILABLE**
- SOCKS proxy 建连失败
- DNS failure
- `ECONNRESET`
- `ECONNREFUSED`
- `ENETUNREACH`
- `EAI_AGAIN`
- proxy/socket connect failure
- 可归因到外部网络的 `BINANCE_TRANSPORT_BLOCKED`

用户文案示例：

**VPN或网络错误 · NET-001**  
无法连接 Binance。自动交易相关写入已安全暂停。请检查 VPN/代理/网络，并切换到可正常访问且符合交易所规则的网络出口。

### NET-002 — VPN_OR_NETWORK_TIMEOUT
- Binance REST/WS transport timeout
- 只有当 request budget 事实证明并非真实限频/内部 saturated，且有 transport latency/timeout 证据时，才把 queue timeout 归入 NET-002；
- 不允许把所有 `BINANCE_REQUEST_QUEUE_TIMEOUT` 无脑写成 VPN。

文案：

**VPN或网络延迟过高 · NET-002**  
Binance 请求持续超时。请检查网络质量或更换低延迟网络节点。系统已暂停依赖该事实的新建仓操作。

### NET-003 — EGRESS_UNVERIFIED
- `BINANCE_EGRESS_UNAVAILABLE`
- `TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE`

文案：

**出口网络无法验证 · NET-003**  
系统无法确认当前出口 IP，交易写入已安全暂停。请检查 VPN/代理连接后重新检测。

### NET-004 — EGRESS_MISMATCH
- `BINANCE_EGRESS_MISMATCH`
- `TESTNET_WRITE_EGRESS_NOT_VERIFIED:MISMATCH`

文案：

**出口 IP 与配置不一致 · NET-004**  
当前出口与预期出口不一致，交易写入已安全暂停。请切换到正确且允许访问交易所的网络出口，或按系统配置流程更新预期出口。

### EXCHANGE HTTP

**EX-HTTP-451**
- Binance HTTP 451
- 不要写成内部策略错误。

文案：

**交易所拒绝当前网络出口 · EX-HTTP-451**  
Binance 拒绝当前网络访问。请检查当前网络出口、区域/账户访问条件，并使用符合交易所规则的可访问网络。

### EX-HTTP-429
文案明确：
- Binance rate limit；
- 系统根据 `Retry-After` / budget 自动等待；
- 不要鼓励用户不断刷新或加大请求。

### EX-HTTP-418
文案明确：
- Binance 暂时封禁当前出口；
- 显示 `blockedUntil`；
- 系统停止相关请求并等待恢复。

### Binance JSON business code

保留 Binance 原始 `code` / `msg`，用户码可使用：
- `EX-BINANCE-<normalized-code>`

必须有：
- 中文解释；
- 可操作解决建议；
- raw code/msg；
- unknown code fallback，不允许吞掉原始代码。

对于代码库已有或 live TESTNET 实际遇到的 Binance codes 建立确定映射。可包含经过测试/事实验证的常见类别，例如：
- timestamp / clock skew
- credential / permission / IP restriction
- insufficient margin
- quantity/price precision
- min qty / notional / filter
- invalid leverage / symbol state

不要凭印象硬编码错误含义；以 Binance 返回 payload 和现有测试事实为准。

### EX-SUBMIT-UNKNOWN

Submit/ACK transport unknown 必须单独显示：

**订单提交结果未知 · EX-SUBMIT-UNKNOWN**  
系统正在使用原始 clientOrderId 查询订单身份。在结果确认前禁止重复提交。

它既不是普通 NETWORK error，也不是 strategy reject。

## 4.3 Incident 生命周期

必须：
- dedupe 相同根因，不能每个 REST request 都弹一个红条；
- active incident 更新 `lastSeenAt/count`；
- 恢复后设置 `recoveredAt` 并从 active banner 移除；
- 恢复事件仍保留审计历史；
- 一个根因可以影响多个 scope；
- incident 不能污染 Primary strategy rejection metrics；
- 不能把历史 incident 永久当当前 blocker。

---

# 5. P0：Dashboard 全局红色告警 UX

当前 `AppShell.vue` 只有普通 `store.error` banner，`system.ts` 的 attention 主要把 health detail 原样拼接。

改成：

## 5.1 全局 active incident banner

在 Web 桌面/移动端顶部都能看到。

对于 severity=ERROR/CRITICAL：
- **红色**
- 显示：
  - 中文标题
  - publicCode
  - 一句原因
  - 一句用户动作
  - 最近发生时间
  - 影响范围
- 支持“查看详情”
- active 时可以折叠，但不能被永久 dismiss 后完全看不见；
- recovered 后自动消失。

例如：

> VPN或网络错误 · NET-001  
> Binance 请求连续超时，依赖交易所实时事实的新建仓已安全暂停。请检查 VPN/网络或切换可正常访问的网络出口。  
> 最近错误 05:18:32 · 影响：行情 / 新建仓 · [查看详情]

## 5.2 详情

详情至少显示：
- raw source code/message
- requestId
- endpoint/method
- routeIdentity
- expected/observed IP（如适用）
- retryAfter / blockedUntil
- firstSeen/lastSeen/count

敏感数据必须 redact。

## 5.3 行情隔离与全局错误的区别

- 单 symbol stale：继续 symbol isolation，最多 amber/warn，不升级成全局网络红条；
- 只要还有 healthy executable candidate，就不因为其它 symbol stale 暂停全系统；
- **全部候选都 stale 且 transport evidence 指向 VPN/network**：显示全局红色 network incident；
- 全部候选 stale 但没有 transport 根因证据：显示 MARKET_DATA incident，不要伪装成 VPN；
- 恢复后自动继续，不要求用户重启 Engine。

---

# 6. P0：修复 Binance request source / lane / purpose 分类

当前 main 的 `BinanceTransport.ts` 中已知：

- `POST /fapi/v1/leverage`
- live funnel 最大流失里显示 `source=UNKNOWN`
- UNKNOWN 最终会落到默认 MARKET_PUBLIC lane/较短 TTL 语义

这是错误。

## 6.1 要求

逐个审计所有已注册 Binance endpoints 的：

- HTTP method
- endpoint
- source
- purpose
- budget lane
- priority
- queue TTL
- retry/recovery semantics

**任何代码库已知 endpoint 不应出现 `source=UNKNOWN`。**

尤其：

### POST /fapi/v1/leverage
属于 Entry exchange execution 的关键控制步骤：
- source 必须是 `EXECUTION_CRITICAL` 或等价的 execution control lane；
- priority 必须与 Entry submit 所需物理执行链一致；
- TTL 不能误用 MARKET_PUBLIC 5s 默认；
- purpose 使用明确值，例如 `SET_ENTRY_LEVERAGE`；
- 其失败仍是 physical execution failure，不是 strategy reject；
- 不允许因为提高 lane 优先级而突破真实 Binance rate limit/418/429。

同时审计：
- POST/PUT/DELETE listenKey
- order submit/cancel/query
- leverageBracket
- position/account/balance
- openOrders/allOrders/userTrades/income
- exchangeInfo/time
- market REST endpoints

建立 table-driven regression test，保证 endpoint/method → source/lane/purpose 不回退 UNKNOWN。

---

# 7. P0：账户权益 / 资产估值口径必须闭合

用户驾驶舱当前最明显的语义风险：

- 总资产估值：4846.65
- USDT wallet valuation：5589.41
- USDC wallet valuation：4987.35
- unrealized PnL：-742.76
- executable margin：6098.73

这几项如果来自不同 Binance 字段，UI 必须明确；如果是计算错误，必须修。

## 7.1 Live audit

从当前 TESTNET signed account facts 读取并保存 evidence：

- Binance authoritative account totals
- assets[]：
  - walletBalance
  - availableBalance
  - crossWalletBalance（如有）
  - unrealizedProfit（如有）
  - marginAvailable / marginBalance 相关字段（如有）
- positions
- multi-assets mode / margin mode（如果 endpoint 提供）
- USDT/USDC conversion/valuation source
- current `state.account` 的：
  - equityUsd
  - walletBalanceUsd
  - unrealizedPnlUsd
  - availableUsd
- Dashboard 各卡片取值路径

## 7.2 UI/contract 语义

不要用一个模糊的“总资产估值”混合多种概念。

至少明确区分：
- **交易所账户权益**
- **钱包余额 / 钱包 USD 估值**
- **浮动盈亏**
- **可用于新 Entry 的可执行保证金**
- **资产明细估值合计**

由 Binance 权威字段决定真实公式，不要先假定 “USDT + USDC - 浮亏” 就必然等于某字段。

如果不同口径不能数学 reconcile：
- 投影 `ACCOUNT_VALUATION_INCONSISTENT`
- UI 红/黄警告；
- 不允许静默显示互相矛盾的数字。

建立 deterministic reconciliation invariant：
- 同一 authoritative snapshot/generation；
- conversion source 可追溯；
- tolerance 有明确定义；
- 多资产案例测试覆盖 USDT + USDC；
- BTC 没有可靠 USD 估值时保持 UNKNOWN/`—`，不要用 0。

---

# 8. P1：修复驾驶舱“事实正确但文案误导”问题

## 8.1 正式净收益：UNKNOWN 不能显示 $0.00

当前：
- 233 complete cycles
- 221 funding 未确认
- “正式净收益 $0.00”

如果正式净收益必须等待 funding exact 才能证明，那么：
- contract 应返回 `null/UNKNOWN/PARTIAL`；
- UI 显示：
  - `未证明`
  - 或 `待资金费确认`
- **不能把未知资金费当 0 后显示正式净收益 $0.00。**

只有正面证明为 0 时才能显示 0。

历史 funding UNKNOWN 本轮不需要修复成 exact；只修正事实语义。

## 8.2 funding `coverage=COMPLETE` 的含义

当前同时显示：
- status PARTIAL
- exact 14
- unknown 607
- `coverage=COMPLETE`

若 COMPLETE 只表示“交易所 income 查询时间窗口已经完整查询”，请重命名/重标：
- “交易所资金费流水查询窗口：完整”
而不是让用户理解为“资金费归因/覆盖已经完整”。

至少区分：
- exchange income query coverage
- cycle attribution coverage
- exact / unknown count

## 8.3 order terminal parity

当前：
- status HEALTHY
- active mismatch = 0
- detail: `drift=11; unresolved=210`

审计这两个字段到底是：
- 历史累计观察？
- 本轮扫描对象？
- active unresolved？
- 旧证据债务？

HEALTHY 只能表示**当前 actionable terminal parity 没有不一致**。

如果 11/210 是历史累计：
- 改字段名和 UI 文案；
- 不要叫当前 unresolved。

如果是当前尚未解决：
- HEALTHY 就是错的，必须降级。

## 8.4 当前 Exchange Entry 数量必须只有一个口径

驾驶舱一处显示：
- 交易所确认建仓委托 = 0

另一处 execution chain 显示：
- “交易所活动建仓 READY 1”

审计 snapshot generation 和定义。

要求：
- fresh Binance openOrders/exact order 的 current remote open Entry count 是唯一权威当前值；
- 如果另一个 1 表示 recent activity、in-flight local intent、历史 working identity 或 readiness，必须改标签；
- 不允许两个区域都让用户以为“当前交易所活动 Entry”，却显示不同数字。

## 8.5 TESTNET risk admission = NOT_APPLICABLE 不应显示“通过 0”

TESTNET funds-only 下 Gross/Direction/Cluster 是 OBSERVE，risk admission 当前明确是 `NOT_APPLICABLE`。

漏斗不能把：

- Authorized PLACE 7
- “风险准入通过 0”
- TradePlan 7

显示成好像 7 个 PLACE 全部在风险准入阶段掉光，然后又神奇出现 7 个 TradePlan。

改为 tri-state / semantic stage，例如：

- Risk admission: `N/A — TESTNET funds/exchange authority`
- 或 `PASS / N/A / BLOCKED` 分列

N/A 不计为 conversion dropout。

漏斗仍必须保持：
`Authorized PLACE → TradePlan → Reservation → Intent → Submit → Fill`

每个 Authorized PLACE 未 submit 仍有且只有一个 first cause。

## 8.6 Fill proof / UNPROVEN 文案

最近 1h Entry fills 201，同时 proof source 含 59 UNPROVEN。

检查“Entry fills”卡片的定义：
- 如果它只是 Binance fill 方向/角色分类总数，明确标注 proof split；
- 如果文案声称“系统归因 Entry fills”，则 UNPROVEN 不能被伪装成已证明 system fill。

不要删除 59 UNPROVEN，只修正口径与呈现。

---

# 9. 当前 TESTNET 是否重置：由实时事实决定，不机械执行

用户倾向“重置一下资金再跑 24 小时”，但授权你根据当前实例选择。

本轮部署完成后，先建立 **PRE-SOAK DECISION**。

## 9.1 优先采用“干净 soak baseline”的条件

如果以下任一情况成立，优先建立干净 TESTNET baseline：

- 当前账户权益/资产估值仍有口径不一致；
- 17 个旧仓位 + 高 gross exposure 会让新 build 的 24h 新增 cycle/fill/accounting 很难区分；
- 存在 current remote/local 订单或持仓无法收敛；
- current submit UNKNOWN 仍未 exact recovery；
- 当前实例来自多轮 patch/restart，运行窗口混有大量旧状态；
- 用户当前 demo account 能被安全恢复到一个可重复的 TESTNET 资金基线。

## 9.2 如果需要清理/重置

必须先：

1. 保存当前 main/runtime identity；
2. 保存 signed GET account/position/openOrders；
3. stopped DB backup；
4. 保存 current 17 positions / 17 TP / local UNKNOWN / cycle/funding 快照；
5. 标记 `PRE_SOAK_BASELINE_BEFORE_RESET`。

然后只允许采用下面的安全方式之一：

### A. 已有、已验证的 TESTNET-only reset/cleanup 机制
如果仓库/交易所已有可靠 TESTNET-only 清理能力：
- 明确确认 host/environment=TESTNET；
- 清理 Entry/manual orders；
- 对持仓使用安全 reduce-only / 已有退出机制；
- 保证不存在 orphan TP；
- 最终 exchange open orders / positions / local projection 收敛。

### B. Binance Demo/Testnet 官方账户重置
只有当当前工具/接口能明确证明操作目标是 TESTNET，并且你能在 reset 后重新完成 private account reconciliation 时才可用。

### C. 不执行账户重置
如果没有可靠程序化 reset，不要临时造危险脚本去“清库”。

此时：
- 保留交易所当前账户；
- 用一个新的 `soakEpochId / soakStartedAt` 建立逻辑基线；
- 所有 24h 指标从 baseline timestamp/instance/build 之后计算；
- 历史 cycle/funding debt 继续保留。

**绝对禁止删除 SQLite 历史或手工把 UNKNOWN 改成 terminal 来伪造干净环境。**

## 9.3 当前 17 个仓位不是自动失败

如果：
- remote/local 17/17；
- TP 17/17；
- open Entry 0；
- 当前账户 valuation 已闭合；
- current order identities 都可解释；

你可以选择不清仓，而用新 soak epoch 起算。

但必须在 FINAL_RESULT 中写清为什么“保留仓位”比“重置账户”更适合本轮 soak。

---

# 10. 24 小时 TESTNET soak 不是本轮立即伪造的 PASS

本轮任务可以：
- 完成代码；
- 部署；
- 启动 soak；
- 记录 `SOAK_START`；
- 提供重复采样脚本/命令；
- 做部署后短时 readback。

**不要在 24 小时尚未经过时写 “24H_SOAK_PASS”。**

如果代码在 soak 中再次修改：
- build/source identity 改变；
- 24h 窗口从新 build 重新起算。

## 10.1 Soak 必须固定记录

创建本轮报告目录，例如：

`docs/reports/v397-final-soak-readiness-network-ux-20261005/`

至少包含：
- `FINAL_RESULT.md`
- `SOAK_START.json`
- `pre-deploy-readback.json`
- `post-deploy-readback.json`
- `incident-readback.json`
- `account-valuation-reconciliation.json`
- `binance-route-classification.json`
- 必要测试/Actions 证据链接

可新增一个只读脚本，例如：
- `scripts/v397-soak-readback.mjs`

它必须只读取当前 runtime / API / TESTNET signed GET，不产生交易所写。

## 10.2 24h 后的建议验收条件

写入报告，供用户 24h 后复核：

### 身份
- 同一 commit/source/artifact/build 连续运行；
- 若发生计划内重启，必须重新闭合 6/6；
- 无 source/artifact drift。

### 安全
- Production writes = 0；
- 无 duplicate clientOrderId / duplicate wire submit；
- Submit UNKNOWN 最终使用 exact clientOrderId recovery；
- stale private fact 不得授权新 Entry；
- physical failure 不得伪装 strategy reject。

### 行情 / 网络
- VPN/网络故障允许出现；
- 故障必须产生正确 active incident；
- Entry 在依赖事实缺失时安全停；
- 恢复后无需改代码、无需伪造数据即可自动恢复；
- 单 symbol stale 不拖死健康 symbol；
- 不要求 VPN 24h 无抖动。

### Binance request governance
- 已知 endpoint source 不能为 UNKNOWN；
- `POST /leverage` 必须走 execution lane；
- 418/429 遵守 backoff；
- queue 不应因错误 lane 分类造成 execution starvation。

### 账户/订单
- account valuation invariant 持续可解释；
- remote/local positions eventually converge；
- current remote open Entry authoritative count 一致；
- TP coverage 保持 100%，或缺失进入正常 repair 且不超过既有 SLA；
- orphan/duplicate TP 不增长。

### Funnel
- Authorized PLACE→TradePlan 语义正确；
- Risk N/A 不作为漏斗损失；
- 每个 Authorized PLACE no-submit 只有一个 first cause；
- Submit 与 Fill 分开计数；
- network/physical failures 不计 strategy rejection。

### AI
- 8081/8083/8084 health 可读；
- candidate=0 时不浪费 Primary；
- candidate 恢复后可重新 dispatch；
- Primary/Review 不因错误 network 分类产生伪成功。

### Accounting
历史 debt：
- cycle/funding UNKNOWN 可以继续存在，不是 soak 自动失败；
- 但 **soak baseline 后新产生** 的订单/fill/cycle 不应制造新的无解释 duplicate/unconserved/inconsistent；
- 新 funding 在尚未成熟/查询到前可以 UNKNOWN，但不能显示成 0。

---

# 11. 测试要求

至少补齐以下 regression tests。

## 11.1 Error taxonomy

- transport timeout → NET-002
- ECONNRESET/proxy unavailable → NET-001
- egress UNAVAILABLE → NET-003
- egress MISMATCH → NET-004
- HTTP 451 → EX-HTTP-451
- 429 → EX-HTTP-429 + retry metadata
- 418 → EX-HTTP-418 + blockedUntil
- Binance JSON code → preserved source code/msg + user remediation
- submit ACK unknown → EX-SUBMIT-UNKNOWN
- recovered incident leaves active list but remains history
- repeated same root cause dedupes

## 11.2 Binance endpoint routing

table-driven：
- `POST /fapi/v1/leverage` ≠ UNKNOWN
- Entry leverage uses execution lane/priority/TTL
- known order/private/control/market endpoints all classified
- unknown *truly unknown* endpoint still fail-visible，不静默当正常

## 11.3 Account valuation

fixtures：
- USDT only
- USDT + USDC
- nonzero unrealized PnL
- unknown asset conversion
- mismatch produces `ACCOUNT_VALUATION_INCONSISTENT`
- unknown BTC valuation renders `—` / UNKNOWN，not 0

## 11.4 Dashboard semantics

- official net profit UNKNOWN does not render `$0.00`
- funding query coverage COMPLETE does not imply attribution exact
- risk admission N/A does not render “pass 0” or create funnel dropout
- current remote Entry count comes from one authoritative fact
- order parity HEALTHY cannot coexist with active unresolved mismatches
- global incident banner is red for ERROR/CRITICAL and shows code/remediation
- recovered incident no longer occupies active banner

## 11.5 Existing critical regression battery

仍必须通过：
- 100 minimum initial margin
- leverage 10–20
- frozen candidate identity
- PR #11 post-Primary authority
- physical-only post-PLACE blockers
- exact submit recovery
- TP protection
- private account freshness
- market symbol isolation
- current open-order projection
- Production write lock
- runtime identity

---

# 12. 不要误修这些东西

以下不是本轮“继续优化”的借口：

1. **Gross 916%**
   - TESTNET 当前 Gross/Direction/Cluster 是 OBSERVE；
   - 不重新启用为 post-Primary veto；
   - 可以在 UI 继续红/黄显示高暴露；
   - 不代表可以在未来 Production 无风险上限运行。Production canary 是下一阶段独立配置，本轮不启用。

2. **历史 cycle/funding debt**
   - 保留 DEGRADED/PARTIAL；
   - 不删除、不伪造；
   - 不阻断 TESTNET Entry；
   - 修正文案即可。

3. **VPN 波动**
   - 不要求 Codex “修好互联网”；
   - 不要求证明节点永久稳定；
   - 只要求正确分类、安全停、清楚报警、自动恢复。

4. **单个 GitHub Actions Vitest worker timeout**
   - 如果无法复现且 rerun 成功，不需要重构整个 test runner；
   - 最终 CI 必须成功即可。

---

# 13. 本轮部署和 live 验证

实现完成后：

1. `npm ci`
2. targeted tests
3. `npm run verify`
4. typecheck/build/full engine/dashboard tests
5. `git diff --check`
6. commit
7. push `main`
8. 等待新的 GitHub Actions 成功
9. backup 当前 TESTNET 数据
10. fast-forward 部署 checkout 到最终 main
11. 根据需要 restart 当前 TESTNET Engine/Dashboard/AI
12. 重新做 6/6 identity
13. 实时 readback：
    - Web 200
    - health READY
    - pipeline state
    - account/private readiness
    - market source
    - candidates
    - 8081/8083/8084
    - positions/open Entry/TP
    - request budget
    - active incidents
    - account valuation reconciliation
    - Production writes 0

然后按第 9 节做 PRE-SOAK DECISION：
- 保留当前 TESTNET 状态；
- 或安全建立干净账户 baseline。

最后写 `SOAK_START.json`，开始 24h 计时。

---

# 14. 最终报告必须回答的决策

`FINAL_RESULT.md` 必须明确回答：

1. 最终 main SHA 是什么？
2. runtime build/source/artifact 是什么？
3. identity 6/6 是否通过？
4. GitHub Actions 是否成功？
5. Production writes 是否始终为 0？
6. `POST /leverage` 是否已经不再 source=UNKNOWN？
7. 网络/VPN/交易所错误是否已经统一成用户层错误码？
8. Web 是否已有 active 红色告警和恢复行为？
9. HTTP 451/418/429/Binance business code/submit unknown 如何显示？
10. 用户当前的 `$4,846.65` 总资产与 USDT/USDC 资产明细到底为什么不同？最终是否闭合？
11. 正式净收益在 funding UNKNOWN 时是否还会错误显示 `$0.00`？
12. funding `coverage=COMPLETE` 是否已明确为“查询窗口覆盖”而非“归因 exact”？
13. order parity 的 drift/unresolved 语义是什么？HEALTHY 是否真实？
14. remote open Entry 0 vs execution chain 1 的冲突如何解释/修复？
15. TESTNET risk NOT_APPLICABLE 是否已从漏斗中正确显示为 N/A？
16. UNPROVEN fills 是否仍被明确标识？
17. 当前 12/12 stale 是网络 incident、market-data incident，还是两者组合？依据是什么？
18. 当前账户最终选择：
    - 保留 17 个仓位进入 soak；
    - 还是建立干净 TESTNET baseline？
    - 为什么？
19. `SOAK_START` 的时间、commit、build、instance、账户、positions、Entry、TP 是什么？
20. 24h soak 目前只能标为 `STARTED` / `NOT_YET_COMPLETE`，不得提前写 PASS。
21. 24h 通过后是否建议进入“小资金 Production canary”；如果当前不能建议，缺的唯一/少数关键条件是什么？

---

# 15. Definition of Done

本轮只有同时满足以下条件才算代码 closeout：

- [ ] main 从本提示词后的最新基线实现并 push；
- [ ] V3.9.7 身份仍统一；
- [ ] Production writes = 0；
- [ ] 现有 100 margin / 10–20x solver / PR #11 authority 不回退；
- [ ] `POST /fapi/v1/leverage` 不再 source=UNKNOWN；
- [ ] 所有 known Binance endpoint 有可解释 source/lane/purpose；
- [ ] 网络/VPN/交易所错误有统一 server-side incident taxonomy；
- [ ] Dashboard 有全局红色 active incident banner；
- [ ] incident 有稳定 public code + 中文原因 + 用户处置建议；
- [ ] raw request/exchange details 可审计但不污染主页；
- [ ] network incident 恢复后自动清除 active 状态；
- [ ] 单 symbol stale 与全局 network outage 区分正确；
- [ ] 账户权益/钱包/浮盈亏/Entry capital 数字口径可证明；
- [ ] UNKNOWN funding 不再伪装成正式净收益 0；
- [ ] funding query coverage 与 attribution coverage 分开；
- [ ] order parity HEALTHY 语义与 active mismatch 一致；
- [ ] current remote Entry count 只有一个权威当前事实；
- [ ] TESTNET risk N/A 不再显示成“0 pass”的漏斗流失；
- [ ] historical cycle/funding debt 保留，不重新成为 Entry veto；
- [ ] full tests / verify / Actions 成功；
- [ ] 当前 TESTNET 部署 readback 完成；
- [ ] runtime identity 6/6；
- [ ] PRE-SOAK DECISION 有明确结论；
- [ ] `SOAK_START.json` 已记录；
- [ ] 24h soak 只标 STARTED，不提前伪造 PASS。

完成后：
- commit + push `main`
- 提交本轮 `FINAL_RESULT.md`
- 保持 TESTNET 运行，进入 24h soak。
