# ZDJ-MITS V3.9.5｜GitHub Actions 恢复后 CI→部署→K线自愈验收｜Codex 提示词

你现在继续执行 ZDJ-MITS V3.9.5 下一轮。

## 当前事实

- 正式分支：`v395-economics-human-managed-20260919`
- 行情缺口修复代码已完成并推送：
  - `1df815a`：核心修复
  - `1b9134a`：流/回归测试
  - `cf7437b24080d381a85c5dfe721e2867bdcf80e8`：仅删除提示词 Markdown 行尾空格
- 报告：
  `docs/reports/v395-1m-kline-gap-recovery-20260919.md`
- 报告提交：
  `def5d294410bec6ac8aa0c6c2b95722b6a21afa4`
- 本地等价 CI 已在全新 worktree 全绿：
  - diff check CLEAN
  - npm ci
  - verify:scripts
  - typecheck
  - 117 files / 639 tests PASS
  - build PASS
- 远端 GitHub Actions 当前不是代码失败，而是 runner 未启动：
  “The job was not started because recent account payments have failed or your spending limit needs to be increased”
- live 尚未部署修复，仍是旧 build。
- 本轮禁止直接跳过远端 CI 门禁。

## 最高原则

先验证 GitHub Actions 计费/额度阻断是否已由人工解除。

如果仍是 billing/spending limit 问题：

**立即停止，不做部署，不重复提交无意义 commit，不反复 rerun。**

如果 Actions 已恢复，继续下面流程。

---

## Stage 1｜恢复远端 CI

优先检查现有 run：

`35448243237`

确认：
- workflow 是当前 V3.9.x Verify；
- head 属于包含 `cf7437b` 修复链的提交；
- 失败原因确实只是 runner 未启动，而不是代码 step failure。

如果该 run 可 rerun，执行 rerun-failed-jobs。

如果 run 不再适合作为当前 exact HEAD 的 CI 证据，则对当前正式分支最新 HEAD 触发一次新的 workflow。

禁止：
- 修改测试断言；
- skip tests；
- 关闭 diff/whitespace gate；
- 降低 CI 标准；
- 为了“变绿”再改业务代码，除非出现新的真实逻辑失败。

验收要求：
- Diff check PASS
- Verify scripts PASS
- Typecheck PASS
- Test PASS
- Build PASS
- workflow conclusion = success

记录：
- run id
- attempt
- exact head SHA
- 每个 step 结果

远端 CI 不绿，不进入部署。

---

## Stage 2｜确认部署源代码身份

正式分支最新 HEAD 可能包含 docs-only 提交。

部署前必须证明：

`git diff cf7437b..HEAD -- apps packages`

为空，或者明确列出差异并解释为什么部署代码仍与已验证修复一致。

记录：
- repository HEAD
- application code identity
- buildId
- dist hash

不得把 docs-only HEAD 与真正应用代码身份混为一谈。

---

## Stage 3｜部署前 live 快照

记录：

- buildId
- PID / instanceId
- settingsVersion
- account/equity
- positions
- TP orderId/price/status
- historicalUnknownCount
- durable claims
- reconciliation
- WS metrics
- current 1m gap error rate
- `gapsByType.kline`
- klineFreshRatio
- freshMarkets
- eligibility.count
- pipelineState/noEntryReason
- 429/418
- request governor
- egress

保持：
- SHADOW
- HUMAN cap=true
- 原 Settings
- Testnet only

---

## Stage 4｜一次受控部署

只有 CI PASS 后执行。

允许一次 Engine restart，仅因为部署新 build。

不要停止：
- 8081
- 8084
- SOCKS/HTTP proxy

不要把“重启后缓存被清空”当作修复成功。

启动后必须：
- startup egress 自动 VERIFIED；
- 不人工调用全量 backfill；
- 不人工清 candle cache；
- 不马上运行 ENFORCE Canary。

---

## Stage 5｜K线 targeted repair live 验收

重点观察新逻辑是否自己工作：

### 必须观察的事件/指标

- `MARKET_KLINE_SEQUENCE_REPAIRED`
- `MARKET_KLINE_SEQUENCE_REPAIR_FAILED`
- `gapsByType.kline`
- `lastKlineGap`
- `MARKET_KLINE_SEQUENCE_INVALID`
- `MARKET_TECHNICAL_STALE`
- targeted REST klines 数量
- request governor

### 成功标准

1. 新出现的 1m gap 能被主动识别；
2. 同一 symbol/timeframe 不发生 REST storm；
3. targeted repair 使用 1 次或受控少量 klines；
4. 修复后 continuity validator PASS；
5. technical card 同轮重建；
6. blocked reason 被清除；
7. 后续新 candle 正常追加；
8. 不退回完整 getSnapshot 风暴。

---

## Stage 6｜市场数据恢复门槛

不要固定等待几小时。

用事实判断：

- `1m closed candle gap` 新增速率明显下降，并在修复完成后接近 0；
- `klineFreshRatio` 显著高于部署前；
- `freshMarkets` 达到 RECOVERING/FRESH；
- `eligibility.count >= 1` 且不再周期性塌成 0；
- `pipelineState=RUNNING`；
- 不再因 kline sequence 问题长期 `PAUSED_MARKET_DATA_UNAVAILABLE`。

如果市场随后发生新的 WS reconnect：

优先把它当成一次真实 live 自愈测试。

必须确认：
- gap 被检测；
- targeted repair 自动完成；
- 不需要人工 restart/backfill；
- eligibility 能恢复。

这比单纯“部署后立即健康”更有价值。

---

## Stage 7｜请求治理门禁

修复不能以 REST 风暴为代价。

比较部署前后：

- 429
- 418
- estimatedWeight1m
- usedWeight1m
- blocked
- queueTimeout
- queued
- recovery request 数量

若 429/418 持续新增、队列异常增长或 repair 不受控：

立即停止进一步恢复扩散，保持 fail-closed，并报告。

禁止调高 Binance 请求预算来掩盖问题。

---

## Stage 8｜仓位/TP/UNKNOWN 安全

逐仓对比部署前后：

- quantity
- side
- managementStatus
- tpStatus
- tpOrderId
- tpPrice
- target/range

必须：
- 所有旧仓 TP 无损；
- HUMAN_MANAGED 不自动亏损退出；
- historical UNKNOWN 不删除；
- durable claim 修复不回归；
- reconciliation 无 drift；
- productionWrites=0。

自然 TP 成交必须按交易所成交事实归因，不算异常。

---

## Stage 9｜本轮停止点

如果市场数据恢复验收 PASS：

**本轮停止。**

不要在同一轮继续 ENFORCE Canary。

保留：
- SHADOW
- HUMAN cap=true
- 原 Settings

下一轮再重新执行正向 ENFORCE Canary。

如果 market repair 未达到 PASS：
- 不运行 Canary；
- 给出剩余真实根因；
- 不用重启/全量 backfill掩盖问题。

---

## 最终汇报

只输出：

A. GitHub Actions billing 阻断是否解除  
B. CI run id / exact HEAD / 最终结果  
C. 应用代码 exact identity / buildId  
D. 是否部署 live  
E. 新 PID / instanceId  
F. startup egress 自动 VERIFIED 用时  
G. 1m gap rate 部署前后  
H. `gapsByType.kline` / lastKlineGap  
I. targeted repair 成功/失败数量  
J. 每 symbol/timeframe REST repair 请求上界实测  
K. 是否出现 full snapshot recovery storm  
L. klineFreshRatio / freshMarkets 前后  
M. eligibility / pipelineState 前后  
N. 429/418 / request governor 前后  
O. positions / TP 是否无损  
P. historical UNKNOWN / durable claims 是否正常  
Q. 是否在一次新的 WS gap 后无需人工干预自动恢复  
R. 是否已经恢复到可以重新进行 ENFORCE 正向 Canary 的市场数据条件  
S. Codex 对现有修复设计的反驳/补充

更新报告：

`docs/reports/v395-1m-kline-gap-recovery-20260919.md`

或追加：

`docs/reports/v395-1m-kline-gap-live-deployment-acceptance-20260919.md`

提交 GitHub。

完成后停止，并执行：

`D:\MITS\scripts\notify.ps1`
