# CODEX V3.9.6 — GitHub 接管后的本地验收、测试与受控运行

日期：2026-09-26  
仓库：`3684993/ZDJMITS`  
分支：`codex/v396-final-convergence-20260922`  
PR #9：**禁止触碰**

## 0. 角色边界（最高优先级）

本轮产品实现由 ChatGPT 直接在 GitHub convergence 分支完成。Codex 的职责被严格限定为：

1. 拉取 GitHub 最新 convergence；
2. 核对 GitHub 实现是否已经落地；
3. 在本地运行静态检查、单元/集成/契约测试和正式 build；
4. 全门禁绿色后，执行一次受控 `stop -> MANUAL_START`；
5. 验证本地运行实例确实来自刚拉取的 GitHub HEAD；
6. 做只读/必要 Testnet 在线验收，收集可审计证据；
7. 回传验收报告。

**Codex 不负责重新设计产品逻辑，也不得在本地私自修产品源码来“让测试变绿”。**

如果 GitHub 最新 HEAD 尚未包含本文件定义的任一目标，或测试揭示需要产品代码修复：

- 停止该目标的本地实施；
- 不自行打产品补丁；
- 明确报告 `GITHUB_IMPLEMENTATION_NOT_PRESENT` 或具体 defect；
- 给出文件、测试、日志、复现证据，交回 ChatGPT 在 GitHub 修复。

允许本地产生的内容仅包括测试输出、日志、临时验收证据及由仓库既有构建流程产生的产物。除非后续收到新的明确授权，不要提交本地产品源码修改。

---

## 1. Git 拉取协议

本文件创建前确认的远端基线为：

`6f726a13a2c0aa2439f749aaf0880e42f5aa5b10`

这只是**交接前基线**，不是需要 checkout 的最终目标。Codex 执行时必须拉取本分支的**最新远端 HEAD**，其中应包含本文件以及 ChatGPT 后续直接提交的产品实现。

在仓库根目录按下列原则执行：

```powershell
git status --porcelain
git fetch origin codex/v396-final-convergence-20260922
git switch codex/v396-final-convergence-20260922
git merge --ff-only origin/codex/v396-final-convergence-20260922
git rev-parse HEAD
git log -1 --oneline
git status --porcelain
```

规则：

- 如果初始工作区不干净：**停止并报告**，不要 `reset --hard`、不要覆盖证据、不要擅自 stash；
- 只允许 fast-forward；
- 禁止 rebase；
- 禁止 squash；
- 禁止 force push；
- 禁止切换/修改 PR #9；
- 本地验收不得反向覆盖 GitHub 最新实现。

最终报告必须记录：

- 拉取前 HEAD；
- 拉取后 HEAD；
- 最新 commit subject；
- 工作区是否 clean；
- GitHub HEAD 与本地 HEAD 是否一致。

---

## 2. 本轮四个产品目标

### G1 — Direction 单一硬权威

目标：Entry 的方向容量硬限制只有一套权威：

- `riskGovernance.maxDirectionExposurePct`
- `exposureCapacityPolicy.direction`

要求：

- `portfolioIntelligence.maxLongExposurePct/maxShortExposurePct` 不得作为第二套独立硬 veto；
- 当方向策略为 `OBSERVE` 时，它只能产生观测/诊断，不能拒绝 Entry；
- 当方向策略为 `ENFORCE` 时，才可按权威规则拒绝；
- 不修改现有数值上限来让测试通过；
- 不绕过总敞口、方向敞口、cluster、available margin、stress、human potential 等真实风险门。

本地验收至少要证明：

1. OBSERVE 场景不会被旧的 0.5 intelligence 阈值二次 veto；
2. ENFORCE 场景仍可由权威方向规则拒绝；
3. 现有风险数值未被放宽。

### G2 — AI 合法数量完整区间

目标：模型在决策前看到完整、确定性的合法数量边界，而不是只看到上限。

pre-AI/TradePlan 输入应具有可审计的：

- `minQuantityUnits`
- `maxQuantityUnits`
- `minimumLegalNotionalUsd`

要求：

- Primary 只能在合法整数数量区间内选择；
- 确定性层继续验证上下界；
- 低于最小合法数量、低于最小合法 notional、超过最大数量都应明确拒绝；
- 禁止 silent clamp；
- 禁止为了成交而修改 exchange filters 或风险预算。

本地验收至少证明：

1. pre-AI envelope 中三项边界真实存在且来自确定性计算；
2. 合法边界内数量可继续；
3. 上下界外数量都被确定性拒绝；
4. 不存在静默改写模型数量后继续下单的路径。

### G3 — 单 symbol 行情异常只隔离该 symbol

目标：`MARKET_KLINE_SEQUENCE_INVALID:<symbol>` 这类单 symbol 数据错误只隔离受影响 symbol。

要求：

- 某一个 symbol kline sequence 无效时，不得自动把整个 Entry pipeline 置为 `PAUSED_MARKET_DATA_UNAVAILABLE`；
- 如果仍有健康、合法、可执行的 USDT/USDC candidate，pipeline 应继续对健康 candidate 工作；
- 只有系统级行情源故障，或所有可执行 candidate 都因行情事实失效时，才允许全局 market-data pause；
- 失败 symbol 必须保留明确的隔离/诊断事实，不能吞掉异常。

本地验收至少证明：

1. one-bad + one-good candidate => bad 被隔离、good 仍可进入后续 pipeline；
2. all-bad/systemic failure => 全局 pause；
3. 不产生额外模型调用来掩盖坏数据。

### G4 — 驾驶舱/运行时唯一首因

目标：对同一 pipeline cycle，Engine 暴露一套权威的“当前首因 + next action”。

要求：

- 不再同时把 `ENTRY_BACKPRESSURE` 和真实首因 `MARKET_KLINE_SEQUENCE_INVALID` 等互相矛盾的状态都呈现成“用户下一步应解决的原因”；
- lower-level diagnostic 可保留，但必须与 authoritative blocker/next action 分层；
- dashboard/API/runtime evidence 应能明确指出唯一权威首因；
- UI 不得自己重新推导另一套优先级覆盖 Engine 真源。

本地验收至少证明：

1. 单 cycle 只有一个 authoritative blocker；
2. next action 与该 blocker 对应；
3. secondary diagnostics 不会被呈现为第二个同级首因。

---

## 3. 明确不得“顺手修掉”的硬事实

以下不是本轮可以通过放宽策略解决的东西：

### `ACCOUNT_ASSET_UNVERIFIED:BTC`

保持账户偿付/抵押品风险语义与 Entry funding 语义分离。不得简单删除 BTC 事实、猜测资产价值、或为了 Entry 放行而把 UNKNOWN 当 0。

### `HUMAN_POTENTIAL_NOTIONAL_LIMIT`

继续作为真实金融/容量约束。不得提升 gross/direction/cluster/maxPositions/human notional 等限制来制造新 Entry。

另外必须继续保持：

- 10 USDT 仅是 AI realized net-loss exit permission threshold，不是账户总损失上限；
- UNKNOWN 不得自动转成 0/VERIFIED；
- 不得伪造 probability；
- 不得以 confidence 代替经济概率；
- 不得放宽 `0.15`、`aiExitLossLimitUsd`、TP、reachability、经济性、JIT/freshness/egress 门；
- `aiExitAuthority` 继续保持 `SHADOW`；
- Production 保持锁定。

---

## 4. 本地测试与门禁

先验证 GitHub 实现，再运行仓库**已有、受支持**的门禁；不要发明临时生产路径，不要以 live 数据跑 watch/dev server。

至少覆盖与本轮修改相关的：

- Engine targeted tests；
- Engine full tests；
- TypeScript typecheck；
- core/contracts 相关 gates（若仓库现有脚本适用）；
- dependency/script verification；
- S00/storage/diff/check 等仓库现有收敛门禁（若适用）；
- 正式 production build。

要求：

- 测试必须使用隔离数据/端口；
- ordinary test 阶段不得产生 exchange writes；
- 不得运行 `npm run dev` / `tsx watch` 对 live data；
- 不得通过删测试、skip、降低断言、扩大 tolerance 来变绿；
- 若某门禁不是当前仓库可执行脚本，记录 `NOT_APPLICABLE` 和原因，而不是伪造 PASS。

报告每个命令的：命令、exit code、测试数/失败数（若有）、关键结果。

---

## 5. 运行前证据快照

只有所有必须门禁和正式 build 绿色后才进入 lifecycle。

在 stop 前记录：

- 本地 Git HEAD；
- product/buildId；
- PID / instance identity；
- `startReason`；
- `settingsVersion`；
- `executionMode`；
- Entry Safety；
- `aiExitAuthority`；
- 当前持仓数量与 symbol/side 摘要；
- TP/protection 覆盖；
- ownership 摘要；
- Testnet write counter；
- Production write counter；
- 当前 authoritative pipeline blocker / next action（若存在）。

不得为了验收清仓、删除人工持仓、删除历史 UNKNOWN、重建数据库或修改真实风险限制。

---

## 6. 本轮 lifecycle 授权

在第 4 节所有必须门禁和正式 build 绿色后，本文件授权 **一次**受控 lifecycle transition：

1. 使用仓库脚本 `scripts/stop-zdj-lan.ps1`；
2. 明确证明旧 PID 已退出，且服务端口（当前约定 8080）已释放；
3. 使用：

```powershell
scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall
```

4. 验证新实例健康；
5. 验证新实例 build provenance 与刚拉取的 GitHub HEAD 对应。

约束：

- 本轮最多 **1 次 stop + 1 次 MANUAL_START**；
- 禁止第二次 restart；
- 禁止 hot reload；
- 禁止 watchdog/autostart 替代人工启动；
- 若 stop/start/health/build identity 任一步失败，停止并报告，**不得自动 kill/restart 再试**；
- read-only monitor 不得偷偷恢复 Engine；
- 必须保留现有 positions/TP/ownership。

如果测试未绿，不得消费本轮 lifecycle 授权。

---

## 7. 启动后在线验收

### 7.1 身份闭环

必须证明：

`remote latest HEAD == local HEAD == formal build provenance == running instance build identity`

若任一不一致，结论为失败，不得用“代码看起来已经更新”代替 identity 证据。

### 7.2 四目标运行时验收

对 G1-G4 使用现有诊断、API、日志或安全的只读/isolated test evidence 验证。

不得为了制造证据：

- 构造假 Binance fill；
- 伪造自然 PLACE；
- 临时关闭风险 gate；
- 人工改数据库使状态看起来健康；
- 增加额外模型调用；
- 把真实 blocker 改名隐藏。

若自然运行周期出现 `PLACE`，允许按当前 Testnet 权限走既有真实链路，但必须逐笔归因并继续保持 Production writes = 0。

若没有自然 PLACE，只要四项目标和真实 blocker 被正确证明，也不要强迫成交。

### 7.3 风险和写入边界

启动后必须再次核对：

- execution environment 仍被锁在预期 Testnet/安全模式；
- `aiExitAuthority=SHADOW`；
- Production writes = 0；
- 所有 Testnet write 都有明确触发源、domain、side、qty 与幂等身份；
- positions/TP/protection/ownership 无非预期丢失。

---

## 8. Codex 最终回传格式

最终报告必须逐项回答：

1. **Git**
   - pull-before HEAD
   - pull-after HEAD
   - remote HEAD
   - worktree clean/dirty
   - latest commit subject
2. **GitHub 实现存在性**
   - G1/G2/G3/G4 各自对应源码文件/测试文件
   - 若缺失，明确 `GITHUB_IMPLEMENTATION_NOT_PRESENT:<Gx>`
3. **测试/门禁**
   - 每个命令、exit code、测试数、失败数
   - formal build 结果
4. **Lifecycle**
   - stop 次数
   - MANUAL_START 次数
   - old PID/new PID
   - port release 证据
   - startReason
5. **运行身份**
   - buildId
   - running commit/provenance
   - 是否与 local/remote HEAD 闭环
6. **G1 验收**
   - OBSERVE / ENFORCE 证据
   - 是否存在第二套 intelligence hard veto
7. **G2 验收**
   - min/max quantity + min legal notional 证据
   - below-min / in-range / above-max 结果
   - silent clamp 是否为 0
8. **G3 验收**
   - one-bad-one-good 结果
   - all-bad/systemic 结果
   - 是否错误触发 global pause
9. **G4 验收**
   - authoritative blocker
   - next action
   - secondary diagnostics
   - 是否仍有同级冲突首因
10. **风险事实**
   - `ACCOUNT_ASSET_UNVERIFIED:BTC` 是否被保留并正确分层
   - `HUMAN_POTENTIAL_NOTIONAL_LIMIT` 是否仍保持硬约束
11. **写入边界**
   - Testnet writes before/after/delta，逐笔解释 delta
   - Production writes before/after/delta，必须为 0
12. **资产/保护**
   - positions before/after
   - TP/protection before/after
   - ownership before/after
13. **结论**
   - 全绿时：`V396_LOCAL_ACCEPTANCE_TAKEOVER_GREEN`
   - GitHub 实现缺失时：`GITHUB_IMPLEMENTATION_NOT_PRESENT`
   - 本地/运行异常时：给出唯一首因，不要私自修复后掩盖。

---

## 9. Codex 执行原则（一句话）

**你是这一轮 GitHub 接管实现的本地验收员和受控运行员，不是产品代码作者：永远验证 GitHub 真源，绝不在本地偷偷改变风险语义来换取绿色结果。**
