# ZDJ-MITS V3.9.5｜本地 CI 替代门禁→K线修复部署验收｜Codex 提示词

## 用户明确授权

GitHub Actions 当前账户预算为 0，Product Actions = Stop usage Yes，因此 runner 无法启动。

用户明确授权：

**本轮不再要求 GitHub Actions 远端 CI 全绿。**

仅本轮将部署前门禁替换为：

**本地全新 worktree + exact HEAD + 与 CI 同步序全流程验证。**

这不是删除、关闭或降低 GitHub Actions 标准；远端 workflow 保留不动。以后账户额度恢复后仍可恢复远端 CI 门禁。

---

## 当前部署候选

正式分支：

`v395-economics-human-managed-20260919`

正式分支 tip：

`def5d294410bec6ac8aa0c6c2b95722b6a21afa4`

应用代码修复链：

- `1df815a`：1m K线 continuity / targeted repair 核心修复
- `1b9134a`：流与恢复测试
- `cf7437b`：仅清除提示词 Markdown 行尾空格
- `def5d29`：docs 报告提交

必须先证明：

`git diff cf7437b..def5d29 -- apps packages`

为空。

live 当前仍是旧构建：

`3.9.5-57b2843729dff7a298a9`

尚未部署 K 线修复。

---

# Stage 1｜本地 CI 替代门禁

禁止直接在当前可能有缓存/依赖残留的工作目录上宣布 PASS。

必须创建一个**全新 worktree**，checkout exact：

`def5d294410bec6ac8aa0c6c2b95722b6a21afa4`

要求：

- 工作树初始 clean；
- 不复制旧 node_modules；
- 使用仓库锁文件；
- 不修改源码以迁就本地测试。

按远端 CI 同顺序执行：

1. diff / whitespace gate
2. `npm ci`
3. contracts/core prerequisites
4. `verify:scripts`
5. typecheck
6. full tests
7. build
8. `npm run verify`（如果该命令会重复前面步骤也仍执行一次作为最终聚合门禁）

记录：

- Node/npm 版本
- exact HEAD
- 每一步 exit code
- test files 数
- tests 数
- build result
- 最终 worktree 是否仍 clean

### 本地门禁 PASS 条件

必须全部满足：

- diff check CLEAN
- npm ci exit 0
- verify:scripts exit 0
- typecheck exit 0
- full tests 100% pass
- build exit 0
- npm run verify exit 0
- 无新增未跟踪源码
- 无测试 skip/retry/断言削弱
- 无临时 patch

任何一步失败：

**停止部署，修真实问题。**

不要因为“之前跑过一次”而跳过本轮 exact HEAD 的验证。

---

# Stage 2｜应用身份与 dist 闭环

确认：

- repository HEAD = def5d29
- apps/packages code identity = cf7437b 对应应用代码
- 本地 build dist hash
- 待部署 dist hash

部署后必须再次重算 live dist hash，并与本地 build 一致。

docs-only HEAD 不得被误当成应用代码身份。

---

# Stage 3｜部署前 live 快照

记录：

- buildId
- PID
- instanceId
- restartCount
- settingsVersion
- admissionMode
- HUMAN cap
- selection mode/customSymbols
- account/equity
- positions
- TP：symbol/side/quantity/tpStatus/tpOrderId/tpPrice
- historicalUnknownCount
- activeClaims/activeUnknownClaims/releasedUnknownClaims
- reconciliation
- WS metrics
- `1m closed candle gap` 当前累计与最近时间
- `gapsByType.kline`
- klineFreshRatio
- freshMarkets
- eligibility.count
- pipelineState / noEntryReason
- 429 / 418
- request governor
- egress

保持：

- SHADOW
- HUMAN cap=true
- 原 Settings
- Testnet only

---

# Stage 4｜一次受控部署

允许一次 Engine restart，仅用于加载新 build。

不要停止：

- 8081
- 8084
- SOCKS5/HTTP proxy

不要：

- 人工全量 backfill
- 手工清 candle cache
- 把“restart 后暂时变好”当成修复成功

部署顺序：

1. entry-only 安全暂停（如现有标准流程需要）
2. graceful stop Engine
3. 备份旧 dist
4. 部署新 dist
5. 重算 hash
6. 启动 Engine
7. startup egress 自动 VERIFIED
8. 恢复正常 SHADOW 运行

---

# Stage 5｜live K线自愈验收

重点观察新逻辑：

- `MARKET_KLINE_SEQUENCE_REPAIRED`
- `MARKET_KLINE_SEQUENCE_REPAIR_FAILED`
- `MARKET_KLINE_SEQUENCE_INVALID`
- `MARKET_TECHNICAL_STALE`
- `gapsByType.kline`
- `lastKlineGap`
- targeted REST klines
- full snapshot recovery 次数
- request governor

### 必须证明

1. gap 能被检测；
2. gap 后 targeted repair 自动触发；
3. 同一 symbol/timeframe 不 REST storm；
4. continuity validator PASS 后 technical card 重建；
5. blocked 状态清除；
6. 后续 candles 正常继续；
7. 不需要人工 restart/backfill；
8. 不退化为全量 getSnapshot 风暴。

---

# Stage 6｜数据恢复验收

不固定等待几小时。

达到以下事实即可：

- 新增 `1m closed candle gap` 速率显著下降并接近 0；
- klineFreshRatio 明显回升；
- freshMarkets = RECOVERING/FRESH；
- eligibility.count >= 1 且不再周期性归零；
- pipelineState = RUNNING；
- 不再长期 `PAUSED_MARKET_DATA_UNAVAILABLE`。

如果窗口内恰好发生新的 WS reconnect：

把它作为最佳真实自愈验收：

- gapsByType.kline 增长；
- lastKlineGap 更新；
- targeted repair 自动发生；
- technical readiness 恢复；
- 无人工干预。

---

# Stage 7｜请求治理

比较前后：

- 429
- 418
- usedWeight1m
- estimatedWeight1m
- queued
- blocked
- queueTimeout
- repair request count

要求：

- 无持续新增 429/418；
- 无请求队列失控；
- 每 symbol/timeframe repair 有界；
- 不提高 Binance 请求预算掩盖问题。

若出现 REST storm：

停止扩散并保持 fail-closed。

---

# Stage 8｜旧仓安全

逐仓对比部署前后：

- symbol
- side
- quantity
- managementStatus
- tpStatus
- tpOrderId
- tpPrice
- target/range

必须：

- 旧仓 TP 无损；
- HUMAN_MANAGED 不自动亏损退出；
- historical UNKNOWN 不删除；
- durable claims 正常；
- reconciliation drift = 0；
- productionWrites = 0。

自然 TP 成交按交易所事实归因。

---

# Stage 9｜本轮停止点

如果 K 线自愈 live 验收 PASS：

**本轮停止。**

不要同一轮重跑 ENFORCE Canary。

保持：

- SHADOW
- HUMAN cap=true
- 原 Settings

下一轮再重新运行 ENFORCE 正向 Canary。

---

# 最终报告

只输出：

A. 本地 CI 替代门禁 exact HEAD  
B. Node/npm 版本  
C. diff check / npm ci / verify:scripts / typecheck / tests / build / npm verify 逐项结果  
D. test files / tests 数量  
E. 最终 worktree 是否 clean  
F. 应用代码 identity / dist hash  
G. 是否部署 live  
H. 新 buildId / PID / instanceId  
I. startup egress VERIFIED 用时  
J. 1m gap rate 前后  
K. gapsByType.kline / lastKlineGap  
L. targeted repair success/failure  
M. 每 symbol/timeframe REST repair 上界实测  
N. 是否出现 full snapshot storm  
O. klineFreshRatio / freshMarkets 前后  
P. eligibility / pipelineState 前后  
Q. 429/418 / request governor 前后  
R. positions / TP 是否无损  
S. historical UNKNOWN / durable claims  
T. 是否在新 WS gap 后无需人工干预完成自愈  
U. 是否恢复到可以重新进行 ENFORCE 正向 Canary 的市场数据条件  
V. Codex 对修复实现的反驳/补充

报告保存：

`docs/reports/v395-1m-kline-gap-live-deployment-acceptance-20260919.md`

提交 GitHub。

注意：GitHub Actions 当前不可用，因此**不要把报告提交后出现的 Actions failure 当成代码失败**，也不要继续 rerun。

完成后执行：

`D:\MITS\scripts\notify.ps1`

然后停止。
