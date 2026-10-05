# ZDJ-MITS V3.9.7 最终续跑：账户总资产、本地收益、订单核验与出口 IP 解绑定收口提示词

日期：2026-10-05  
仓库：`3684993/ZDJMITS`  
执行对象：Codex GPT-6 Sol  
执行性质：**接续上一轮因额度中断的本地 worktree；只做事实口径与运行安全收口，不再改核心 Entry/Primary/solver。**

---

## 0. 当前线上基线

开始前必须先 `git fetch --all --prune` 并核对：

- 当前 GitHub `main` 已知 HEAD：
  `d5473e684f4229f808cde6e7e92b2ed4af9a027d`
- message:
  `Suppress expected missing-order checks from active incidents`
- GitHub Actions #442 / run `37241478759` 已成功。

上一轮关键提交：
- `82aca05b72e79311de1b84c96695fd7f73cf8103` — incident/dashboard fact semantics
- `5c3465b02caa2a267f5c0e39fb8c9eabcf1d14ef`
- `4c8578f48a4878e5d3847ec7a8dbdeb0fd0455c8` — Binance business failures as incidents
- `d5473e684f4229f808cde6e7e92b2ed4af9a027d` — suppress expected missing-order checks

不要退回更旧基线。

---

# 1. 第一优先级：保护 Codex 当前本地未提交工作

由于上一轮额度中断时 UI 显示“已编辑 15 个文件”，开始时必须：

1. `git status --porcelain=v2 --branch`
2. `git log --oneline --decorate -10`
3. `git diff --stat`
4. `git diff`
5. `git diff --cached`
6. 列出 untracked files
7. 比较：
   `git log --left-right --cherry-pick origin/main...HEAD`

如果 HEAD 已经是 `d5473e6`，但还有未提交修改：
- 先建立 rescue branch/tag；
- 保存 patch，例如：
  `git diff > .../pre-resume-working-tree.patch`
- 逐项审计这些修改是否仍有效；
- 不要 reset/checkout 丢掉它们；
- 不要机械全部提交。

如果本地 worktree 已干净：
- 直接从最新 `origin/main` 开始。

---

# 2. 本轮新增用户决定：彻底取消“固定出口 IP 证明”要求

用户明确决定：

> 系统禁止把预期出口 IP 绑定作为安全要求，也不需要主动探测公网出口 IP。VPN/代理只要能够正常访问 Binance 即可。网络异常由系统显示错误，让用户自行更换网络节点。

## 2.1 必须保留的安全边界

仍必须：
- Binance REST/WS 必须通过配置代理；
- proxy disabled / agent missing => fail-closed；
- TESTNET write 仍必须校验：
  - environment=TESTNET
  - executionMode=TESTNET_ENABLED
  - host 在 TESTNET allowlist
- Production writes 始终为 0；
- Binance 418/429/451/transport failures 继续按真实错误处理。

## 2.2 必须删除/停用的机制

以下机制不再具有任何交易权限作用：

- `expectedStaticEgressIp`
- `BINANCE_EGRESS_UNVERIFIED`
- `BINANCE_EGRESS_MISMATCH`
- `BINANCE_EGRESS_UNAVAILABLE`
- `TESTNET_WRITE_EGRESS_NOT_VERIFIED:*`
- `verifyEgressIp()` 对 `checkip.amazonaws.com` 的主动探测
- `verifyBinanceTransportEgress()` 的固定出口证明
- Dashboard active incident 中的 NET-003 / NET-004

兼容旧 Settings 时：
- 可以暂时保留 `expectedStaticEgressIp` 字段读取，避免旧 settings parse 失败；
- 但必须标记 DEPRECATED/IGNORED；
- 不参与 route identity；
- 不参与 health；
- 不参与 write authorization；
- 不产生 active incident；
- 不要求用户更新。

最终 Dashboard：
- 不再显示“预期出口 / 实测出口”作为安全状态；
- 可以显示当前代理 routeIdentity / proxy URL 是否启用；
- 不主动显示公网出口 IP。

## 2.3 新网络安全定义

合法的 TESTNET write 前提只包括：
- TESTNET environment；
- TESTNET_ALLOWED_HOST；
- proxy enabled and actual SOCKS agent present；
- private credentials/current account facts；
- exchange filter/precision/idempotency；
- current transport available；
- request budget/rate limit 合法。

**固定公网 IP 不再是权限事实。**

补 tests：
- configured expectedStaticEgressIp 不得阻断写；
- egress probe failure 不得阻断写；
- no request to checkip.amazonaws.com in health；
- proxy missing 仍阻断；
- wrong Binance host 仍阻断；
- Production 仍阻断。

---

# 3. -2013 / -2011：预期查无订单只保留审计，不报红

当前用户仍看到了：

`EX-BINANCE-2013 · Order does not exist`

已知提交 `d5473e6` 已尝试：
- GET `/fapi/v1/order` + -2013 => 不进入 active incident
- DELETE `/fapi/v1/order` + -2011 => 不进入 active incident

本轮必须在最终部署实例真实验证：

### 3.1 必须抑制 active alert

以下属于**预期核验结果**：

- exact order query GET `/fapi/v1/order`
  - Binance code -2013
  - 表示该 identity 当前不存在
- cancel already-absent order DELETE `/fapi/v1/order`
  - Binance code -2011
  - 表示取消对象已经不存在

它们必须：
- 保留 raw audit/event；
- 可以作为 exact-order recovery 的负面事实；
- 参与 current remote order absence proof；
- **不能产生全局红色 incident**；
- 不能显示“交易所拒绝请求，请人工处理”。

### 3.2 不能过度抑制

同样 code 在其它不符合预期的 method/context 下仍应可见。

例如：
- POST order 出现异常 code 不能被吞；
- DELETE -2013 是否正常由实际调用语义决定，不要通配全部 -2013。

部署后自然观察一次 current exact-order reconciliation，证明不会再弹红色 -2013。

---

# 4. “总资产”新权威口径：只统计 USDT + USDC，不含 BTC

用户明确要求：

> 总资产必须包含 USDC，不包含 BTC。总资产就是 USDC + USDT 的总和，必须与交易所事实一致；如果 Binance 有直接可读的对应总资产字段就优先读，否则由同一 signed account snapshot 中 USDT/USDC 权威资产字段确定性相加。

## 4.1 Binance 单资产模式语义

当前 live readback 已证明：
- `multiAssetsMargin=false`

在 Binance USDⓈ-M 单资产模式：
- top-level `totalWalletBalance`
- `totalUnrealizedProfit`
- `totalMarginBalance`
只表示 USDT 口径；
- **不能把它们叫“总资产”**；
- USDC 必须从 `assets[]` 单独读取。

因此当前 UI：

> 交易所 USDT 保证金权益 $4,940.22

虽然字段本身可能正确，但不满足用户要求的“USDT+USDC 总资产”。

## 4.2 新账户投影

在 account valuation 中新增清晰字段，名称可调整但语义固定：

- `usdtMarginEquityUsd`
- `usdcMarginEquityUsd`
- `combinedStablecoinMarginEquityUsd`
- `usdtWalletUsd`
- `usdcWalletUsd`
- `usdtAvailableUsd`
- `usdcAvailableUsd`
- `combinedStablecoinWalletUsd`
- `combinedStablecoinAvailableUsd`
- `excludedAssets`（BTC 等）

### 组合保证金权益公式

优先使用 asset row 自身的 `marginBalance`，如果当前 adapter 没有保存该字段，则：
- 同一 signed snapshot 内：
  `asset walletBalance + asset unrealizedProfit`
作为该 asset 的 margin equity；
- 只能在该字段语义与 Binance signed account payload 一致时使用；
- 不能跨不同采样时间相加。

总资产：
`USDT margin equity + USDC margin equity`

只包含：
- USDT
- USDC

明确排除：
- BTC
- BUSD（除非用户以后单独要求）
- 其它 token

### BTC
BTC 可以继续显示在资产表，但：
- 不进入“总资产”；
- 未证明 USD 估值显示 `—`；
- 不能显示为 0 后加入总资产。

## 4.3 Dashboard

第一张 KPI 改成：

**USDT + USDC 总资产**

显示：
`combinedStablecoinMarginEquityUsd`

副标题示例：

> 同一 Binance signed account 快照；仅 USDT + USDC，不含 BTC。

另外可显示：
- USDT 保证金权益
- USDC 保证金权益
- USDT/USDC 可用余额
- Entry 可执行保证金

不要再把 `totalMarginBalance` 单独放在“总资产”位置。

## 4.4 对账 invariant

同一 snapshot 必须满足：
- combined = usdt + usdc
- 所有项来自相同 `account.asOf`
- 允许小数 tolerance
- 如果 USDT 或 USDC 任一关键字段缺失：
  - combined 为 UNKNOWN
  - 不用另一个资产顶替
  - 产生非阻断性的 ACCOUNT_VALUATION_PARTIAL/UNKNOWN 提示

测试：
- USDT only
- USDC only
- USDT + USDC
- 两边都有 unrealized PnL
- BTC 不计入
- missing USDC fact => UNKNOWN，不静默只显示 USDT
- single-assets mode top-level totalMarginBalance 不得冒充 combined total

---

# 5. 收益权威：只统计“本地已证明交易收益”，不要让 GPU2 AI 改账

用户要求：

> 确保总收益准确。只统计本地的总收益即可。

## 5.1 核心原则

**AI 不得成为会计权威。**

GPU2 Review 可以：
- 审计异常记录；
- 提示疑似错配；
- 输出 evidence-only review；
- 帮助人工定位 cycle/fill/funding 缺口。

GPU2 Review 不得：
- 修改 realized PnL；
- 猜 funding；
- 猜手续费；
- 把 UNKNOWN 改成 0；
- 把 UNPROVEN fill 强行归到某 cycle；
- 创建/修改 canonical TradeRecord；
- 覆盖 deterministic ledger。

因此不要把 Position Review 模型扩展成“算账模型”。

如确实需要 GPU2 辅助，可新增独立的 **ACCOUNTING_AUDIT_ONLY** prompt/run：
- 只读；
- 无写权限；
- 输出 anomaly classification；
- 只用于审计 drawer；
- 不进入权威收益。

本轮不是必须项，除非现有 Review infrastructure 可极低成本复用。

---

# 6. 新增“本地收益”明确口径

当前页面已有：

- 已实现交易收益（不含资金费）
- 正式净收益（funding UNKNOWN 时未证明）

用户现在要求只看本地收益。

必须新增或重命名为以下语义。

## 6.1 本地已实现交易净收益（不含资金费）

定义：

只统计本地 canonical / system-owned / locally linked 的 **已闭合完整 cycle**：

必须满足：
- canonical=true
- status=CLOSED
- duplicateOf=null
- ledger closed complete
- Entry/Exit fill 已归因到本地 system lifecycle
- fee facts complete
- `tradingNetPnlExFunding` finite

排除：
- EXTERNAL
- DUPLICATE
- noncanonical
- UNPROVEN-only cycle
- 未闭合 cycle
- ledger inconsistent/unconserved/unproven
- funding 是否 exact **不影响这一个“不含资金费”指标**

公式：
`sum(tradingNetPnlExFunding)`

这个数字可以作为当前驾驶舱主收益数字。

标签：

**本地已实现净收益（不含资金费）**

副标题：
- 完整本地周期 N
- funding unknown M
- excluded/unproven X（如有）

## 6.2 本地已确认资金费

只统计：
- 已能绑定到本地 canonical cycle
- fundingAttributionStatus=EXACT
- ledger source 已证明

公式：
`sum(exact funding)`

单独显示：
**本地已确认资金费**

## 6.3 本地已确认全口径净收益

只对 funding exact 的本地 closed complete cycles 求和：
- trading net ex funding
- + exact funding

名称：

**本地已确认全口径净收益**

但如果还有 funding UNKNOWN：
- 不要把这个数字叫“全部历史总收益”；
- 应标明：
  - “仅覆盖 funding 已确认的 X/Y 个本地完整周期”

## 6.4 用户希望的主显示

建议驾驶舱顶部：

1. **USDT + USDC 总资产**
2. **USDT + USDC 浮动盈亏**（见第 7 节）
3. **当前持仓**
4. **本地已实现净收益（不含资金费）**
5. 活动委托

在第 4 个 KPI 的小字：
- 本地完整周期 N
- 本地已确认资金费 xxx
- funding 未确认 M
- 已确认全口径净收益 xxx（覆盖 X/Y）

不要再把 funding UNKNOWN 导致的 formal net “未证明”作为用户唯一可见的收益。

---

# 7. 浮动盈亏也必须从 USDT+USDC 统一口径

当前 UI 是：

**USDT 浮动盈亏**

用户要求总资产包含 USDT+USDC，因此主浮盈亏也应统一：

**USDT + USDC 浮动盈亏**

定义：
- 同一 signed account snapshot
- USDT asset unrealizedProfit
- + USDC asset unrealizedProfit

如果 USDC 当前没有持仓：
- 值自然为 0；
- 不是 UNKNOWN。

如果某 asset row 缺失：
- 按 Binance account payload 是否明确 zero 来判断；
- 不得因为“没找到”就擅自填 0，除非 adapter 能证明该 asset row不存在=余额/持仓为零。

保留可展开明细：
- USDT uPnL
- USDC uPnL

---

# 8. UNKNOWN / UNPROVEN 信息如何“全部统计出来”

用户当前看到：

- 本地未决 UNKNOWN 3
- funding unknown 196
- fill provenance 中历史有 UNPROVEN
- cycle accounting 仍有 inconsistent/unconserved/unproven

这几类不能混成一个“未确认”。

必须在 Dashboard/Trade Records 提供一个 **Accounting Coverage** 小卡片：

至少分开：

### A. Current order identity UNKNOWN
- 当前 entry/tp/manual 本地未决 identity
- 不等于收益未知
- 不等于交易所当前挂单

### B. Fill attribution UNPROVEN
- 有 exchange fill，但系统不能证明属于哪个本地 cycle/order
- 不计入“本地已实现净收益”
- 保留数量与金额（金额如果可确定）

### C. Cycle conservation debt
- inconsistent
- unconserved
- unproven

### D. Funding attribution UNKNOWN
- cycle 已闭合、交易净收益可算
- funding 尚不能精确归因
- 只影响“全口径收益”，不影响“不含资金费收益”

### E. Fee fact missing
- 若存在，单独统计
- 这种 cycle 不进入本地已实现净收益

每类要显示：
- count
- affected local cycles
- 是否影响：
  - 当前持仓
  - 当前订单
  - trading net ex funding
  - all-in net

这样用户能直接看到“为什么正式全口径收益还不能完全确认”。

---

# 9. 收益修复：只允许确定性 backfill / repair

可以继续利用现有：
- `TradeRecordSyncService`
- exchange fill audit
- durable order registry
- order provenance
- funding income ledger

但规则：

## 9.1 可以自动修
只有存在确定性证据：
- exact clientOrderId / exchangeOrderId
- durable order provenance
- exact cycleId
- quantity conservation
- exact commission
- exact funding income 与 cycle/time/symbol 关联规则已经证明

才能：
- repair partial local record
- 补 fee
- 补 exact funding
- 更新 canonical local summary

## 9.2 不允许自动修
- symbol + 时间接近 猜 cycle
- GPU2 猜归属
- side/qty 大概匹配
- history API 查不到就当 0
- -2013 直接当“已终结完整收益”
- UNKNOWN 强制 terminal

## 9.3 提供 preview / apply
如果现有同步服务支持：
- preview
- deterministic apply

本轮可在 TESTNET 执行 deterministic repair，但：
- 先 backup DB
- 保存 before/after summary
- 不删除历史 evidence
- 输出 repaired / skipped / unclosable / conflict 数量

---

# 10. 当前 Position Review / GPU2 的边界不要破坏

现有 `PositionReviewRunner` 是 position/plan review：
- HOLD
- REDUCE_PROPOSAL
- EXIT_PROPOSAL
- HANDOFF

不要把“收益归因”塞进去。

如果增加 Accounting Audit：
- 独立 duty / prompt
- GPU2 第二模型可使用
- evidence-only
- 无 order authority
- 无 ledger mutation authority
- 无 TradeRecord write authority
- 无 funding mutation authority

默认不需要新增，优先 deterministic accounting。

---

# 11. 网络 incident 新要求

保留：

- NET-001 网络不可用
- NET-002 网络 timeout
- MARKET-DATA-001
- EX-HTTP-451
- EX-HTTP-429
- EX-HTTP-418
- Binance business reject
- EX-SUBMIT-UNKNOWN

删除 active：

- NET-003
- NET-004

UI 详情中删除：
- 预期出口
- 实测出口

route 仍显示：
- proxy routeIdentity
- endpoint
- requestId
- method
- retryAfter / blockedUntil

---

# 12. 实时错误映射继续完善

已知正常缺失订单：
- GET order -2013 => audit-only
- DELETE order -2011 => audit-only

已知真实业务错误：
- -5022 maker-only reject => active exchange incident
- -2019 margin insufficient => active
- -1111 precision => active
- -1013 filter => active
- -1021 clock => active
- -2015 credential/permission => active
- -4024/-4025 price band => active

未知 Binance code：
- 仍显示原始 code/msg；
- 不要用“交易所拒绝该请求”作为唯一信息；
- title 可为 `Binance 业务错误 -XXXX`
- raw msg 保留；
- remediation 使用通用说明。

---

# 13. 需要新增/修改的 tests

至少：

## account valuation
- USDT + USDC combined margin equity
- BTC excluded
- top-level totalMarginBalance only USDT in single-assets fixture
- combined total does not use BTC
- USDT+USDC uPnL combined
- missing USDC fact => UNKNOWN/partial
- same-snapshot invariant

## local PnL
- external record excluded
- duplicate excluded
- noncanonical excluded
- open cycle excluded
- funding unknown cycle INCLUDED in ex-funding local net
- funding unknown cycle EXCLUDED from confirmed all-in
- exact funding included
- fee missing excluded from ex-funding authoritative sum
- deterministic local repair can move eligible counts

## incidents
- egress unavailable/mismatch do not create active incident
- no NET-003/NET-004 active
- -2013 GET exact query audit-only
- -2011 DELETE audit-only
- -5022 remains active
- proxy transport failure remains NET-001/002

## transport
- health does not contact checkip
- TESTNET write ignores expectedStaticEgressIp
- proxy missing blocks
- wrong host blocks
- Production blocks
- request source routing still passes, especially POST leverage execution lane

## dashboard
- top asset KPI = combined USDT+USDC
- BTC excluded
- top uPnL = combined USDT+USDC
- local ex-funding net visible even if funding unknown
- formal/confirmed all-in coverage text accurate
- accounting coverage categories separate

---

# 14. 部署与运行验证

完成代码后：

1. `npm ci`
2. targeted tests
3. typecheck
4. build
5. `npm run verify`
6. full tests
7. `git diff --check`
8. commit + push main
9. 等 GitHub Actions success
10. backup current TESTNET DB
11. fast-forward deploy checkout
12. 允许 restart 当前 TESTNET Engine/Dashboard/AI
13. 6/6 identity
14. Production writes = 0

live readback 必须验证：

### account
- current multiAssetsMargin
- USDT row
- USDC row
- combined USDT+USDC margin equity
- combined uPnL
- combined available
- BTC excluded
- Dashboard top KPI 与 Engine projection 一致

### PnL
- local ex-funding net
- local complete closed count
- funding exact count
- funding unknown count
- confirmed all-in coverage
- excluded external/unproven/duplicate counts

### incidents
- 不再出现 NET-003/NET-004
- 不再访问 checkip service
- 当前代理/Binance 正常时无 egress proof requirement
- 自然 exact-order -2013 不弹红
- 真实 business error 仍弹红

### execution
- POST /leverage source/lane/purpose 仍正确
- Entry/Primary/TP/Review 不回退
- open Entry/current positions/current TP 继续由 remote facts 投影

---

# 15. Soak 规则

上一轮尚未完成 24h soak。

本轮如果最终 build 再变化：
- soak 起点从本轮最终 build 重新计时。

VPN 节点变化/网络 timeout：
- 不自动判 soak fail；
- 要求安全暂停、明确告警、自动恢复。

固定出口 IP 不再是任何 soak 条件。

---

# 16. 最终报告

更新/创建：

`docs/reports/v397-local-accounting-total-assets-egress-closeout-20261005/FINAL_RESULT.md`

至少回答：

1. 最终 main SHA
2. GitHub Actions
3. runtime build / instance
4. identity 6/6
5. Production writes 0
6. 是否彻底取消 expected static egress IP 安全门槛
7. 是否停止 checkip 外部探测
8. -2013/-2011 是否只保留 audit
9. USDT+USDC 总资产公式与当前实时数值
10. BTC 是否确认排除
11. USDT+USDC combined uPnL
12. 本地已实现净收益（不含 funding）
13. 本地已确认 funding
14. 本地已确认全口径净收益覆盖 X/Y
15. funding UNKNOWN 数
16. UNPROVEN fill 数
17. cycle inconsistent/unconserved/unproven 数
18. current order UNKNOWN 数
19. 是否进行了 deterministic repair；修复多少，跳过多少，冲突多少
20. GPU2 是否保持 evidence-only，没有获得会计写权限
21. 当前 positions / Entry / TP
22. soak 新起点

---

# 17. Definition of Done

- [ ] 本地未提交工作已保护并审计
- [ ] 最新 main 不回退
- [ ] expectedStaticEgressIp 不再参与任何权限
- [ ] 不再调用公网 IP 探测作为 health/write gate
- [ ] NET-003/004 不再 active
- [ ] proxy-only fail-closed 仍保留
- [ ] -2013 GET order / -2011 cancel absent 不弹红
- [ ] USDT+USDC combined total 成为驾驶舱主“总资产”
- [ ] BTC 不计入总资产
- [ ] USDT+USDC combined uPnL 正确
- [ ] 本地 realized ex-funding net 只统计确定性本地完整 cycle
- [ ] funding UNKNOWN 不影响 ex-funding net
- [ ] funding UNKNOWN 不被当 0
- [ ] exact funding 独立汇总
- [ ] external/duplicate/noncanonical/unproven 不进入本地收益
- [ ] GPU2 不具备账本修改权限
- [ ] Accounting Coverage 分类清晰
- [ ] full verify/tests/Actions 成功
- [ ] TESTNET 部署通过
- [ ] identity 6/6
- [ ] Production writes=0
- [ ] 新 soak 起点已记录

完成后直接 commit + push `main`，无需逐阶段向用户确认。
