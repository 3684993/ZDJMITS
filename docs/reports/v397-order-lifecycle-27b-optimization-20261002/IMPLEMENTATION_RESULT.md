# v397 Order Lifecycle + 27B Optimization — Implementation Result

**Date:** 2026-10-02  
**Repository:** `3684993/ZDJMITS`  
**Implementation source commit:** `ab75431d1f1b792c7b74901939af0fe99971998e`  
**Runtime build:** `3.9.6-feeda074d7c07d4a307c`  
**Runtime:** TESTNET, PID 9548, instance `60a0f6b3-0e38-4d98-a5b2-131c726d50fe`

## 实施内容

- Contracts 与默认 Settings 增加四种 AI duty route：`SCOUT_RESEARCH`、`ENTRY_PRIMARY`、`PENDING_ENTRY_REVIEW`、`POSITION_REVIEW`。Settings migration 从现有资源和 entry margin 语义回填路由及 quote policy，不覆盖已经存在的用户设置；当前在线 Settings version 为 243。
- AI 资源与逻辑职责分离。资源 CRUD、模型探测、负载与队列状态、职责路由读写均接入 API/Dashboard；资源页改为资源列表、详情和职责路由。GPU2 Review 资源并发为 1，Position Review 优先于 Pending Entry Review；Review 资源故障不会转移/阻塞 Entry Primary。
- GPU2 Position Review 使用不含入场 sizing/capacity authority 的市场事实和原 TradePlan。上线读回发现原实现复用 Entry EIP 压缩器、在模型调用前因缺 Entry execution envelope 而失败；已改为 Review 专用、带来源 ID 的市场/Plan facts 并新增回归测试。
- Pending Entry Review 只输出 `KEEP/CANCEL/REPLAN`，Position Review 只输出 `HOLD/REDUCE_PROPOSAL/EXIT_PROPOSAL/HANDOFF`。取消、改价及退出仍由确定性 coordinator 和原有 authority 检查执行。
- USDT/USDC 新订单 notional 下限在 contracts 与执行层至少为 100 quote units；当前两个 quote policy 均沿用现有用户设置 `portfolio.entryMarginUsd=200`，故实际下限为 USDT 200 / USDC 200。BTCUSDT/BTCUSDC 硬下限为 200。交易所 filter minimum 只可提高门槛；可执行额度不足时拒绝，不再 fallback 到 exchange-minimum 微小单。最低初始保证金语义独立保留：当前 USDT/USDC 各 1，来源为现有 `portfolioIntelligence.minMarginUsd`。
- Entry mandate 将 notional、initial margin、fee、funding/FX 已知状态、最低净收益、TP 目标/期限与一小时可达性一并冻结并校验。现有低收益历史仓不会因设置变更而被重新定价或伪装成新的经济 mandate。
- 自动 Entry 期限不超过 1 小时，Near Market TTL 可更短；期限到达后重新 exact lookup，确认远端活动身份后由 coordinator 撤单并确认，远端查询不确定时 fail closed。历史 UNKNOWN 在普通订单页只呈现 24 小时窗口；旧 UNKNOWN 单列为历史，不作为远端活动委托。
- Human-managed 仓可以进入证据型 Position Review；模型不能改变所有权、quantity、side 或直接发交易指令。Review 失败预算与生命周期仍保持持久化，不在 restart 时重置。

## GPU 资源与实际职责路由

物理设备以操作系统 LUID/SUBSYS 和监听 endpoint 标识，不从逻辑资源名推断 GPU 序号：

| Resource | Endpoint / model | Device identity | Duties | 状态 |
|---|---|---|---|---|
| Scout `scout-b580` | `127.0.0.1:8081/v1` / `qwen3.5:9b` | Intel Arc B580 | SCOUT_RESEARCH | ONLINE |
| GPU1 Primary `brain-7900-primary` | `127.0.0.1:8084/v1` / `qwen/qwen3.8-27b` | Radeon RX 7900 XTX, LUID `00000000_0000EDFE`, SUBSYS `78911ED3` | ENTRY_PRIMARY | ONLINE；保持原配置 |
| GPU2 Review `review-7900-gpu2` | `127.0.0.1:8083/v1` / `qwen/qwen3.8-27b` | Radeon RX 7900 XTX, LUID `00000000_00011D3B`, SUBSYS `79011EAE` | PENDING_ENTRY_REVIEW, POSITION_REVIEW | ONLINE；并发 1 |

GPU2 endpoint 由本机进程/设备枚举发现，`/v1/models` 返回精确 model id `qwen/qwen3.8-27b`；运行中的 Engine resource test 返回 `HEALTHY`、`modelConfigured=true`。在线 routes readback 将两项 Review duty 指向 `review-7900-gpu2`，Entry Primary 仍唯一指向 8084。

## 运行验证与限制

- 全量本地 `npm run verify`：**通过**。Contracts、Core、Dashboard、Engine build/typecheck；**191 个 test files、1,665 tests 通过**。`git diff --check` 通过。新增/调整覆盖最低 quote floors、无 exchange-minimum fallback、职责路由隔离与队列优先级、重启/订单 exact lookup、Review-only ownership 和 Review facts contract。
- 最终源码部署后从 `D:\MITS` 本地 `npm run build` 成功；脚本 `scripts/v396-g1-g4-identity-closure.mjs` 返回 **`IDENTITY_CLOSED`，6/6 checks 为 true**：本地/远端 HEAD 相等、source/artifact hash 对上运行实例、buildId 一致、Runtime API/identity file 一致、hashed source tree clean。最终报告提交后会再次确认 remote HEAD 相等；report-only commit 不改变 runtime hashed source/artifact。
- Health 最终读回曾达到 `READY`；后续总体状态为 `DEGRADED`，但 `ready=true`，市场 `LIVE`、账户 `READY`、Exchange order reconciliation `READY`。降级事实包括 191 unresolved drift、175 historical/occupying-risk Entry UNKNOWN 和 1 manual UNKNOWN；这些旧 UNKNOWN 未被清除、伪造成已核实事实或用于新 Entry sizing/veto。审计覆盖/远端历史事实仍有限。
- TESTNET closeout：`lockedToTestnet=true`，`productionWrites=0`，`testnetWrites=0`，`blockedProductionWriteAttempts=0`。
- 订单 readback：远端 exact open Entry order snapshot `READY`, **15** 项；历史 UNKNOWN 24h 页面窗口 **2** 项，窗口外隐藏 **173** 项。15 项均为重启后 exchange exact snapshot 得到的真实远端开放委托；投影中的身份是 `exchange-recovered`、缺少可证明的原自动 Entry intent，因此没有把旧 UNKNOWN 当成自动订单盲目取消。不能据此证明这 15 个旧委托原始授权/所有权。
- Pending Entry Review/Position Review 的 API route、资源健康及职责隔离已读回，但最终实例**没有成功 Review 模型请求**：GPU2 runtime `totalRuns=0`。Position Review 当前周期读回 `enabled=true, considered=17, scheduledDue=2, reserved=0, completed=0, failed=0, failureBlocked=15`；由于没有实际可成功调用的自然触发，本轮不伪造请求或花费预算。最初部署曾观测到 Review 调用被 Entry-only envelope 检查拒绝，该根因已修正并由测试覆盖；修复后的线上真实推理/结构化 verdict 仍为 **UNKNOWN**。Pending Entry Review 的自然模型 verdict 也未观测。
- 远端自然 Entry/TP/Exit：运行订单快照及市场、账户流保持在线；本轮没有把任何远端订单/仓位改造成验收样本。新代码的真实订单提交、TP 成交、Review 决策后 Reduce/Exit/Handoff 及 1 小时自动单终止均未在最终观察窗里自然发生，故这些闭环的实际 TESTNET 结果仍为 **UNKNOWN**。确定性逻辑与测试通过不能替代交易所自然成交验证。
- Hosted CI 未运行；本轮依照请求只执行本机 full verify/build 和 TESTNET readback，没有 Production 写入。

## 最终 Git 与 Runtime 身份

`main` 已 fast-forward 推送至实现源码 commit。最终结果文档随后单独提交；部署运行源码仍由 `ab75431d1f1b792c7b74901939af0fe99971998e` 标识。Identity closure：`IDENTITY_CLOSED`，6/6 true；Runtime build `3.9.6-feeda074d7c07d4a307c`，artifact hash `feeda074d7c07d4a307c4a0c41bbeeeee8e8634e2f1e6e8d1dfb4de4415a5f10`，source hash `cce7913d8b376337126b650537e29325919120664f07e99a32c6e71827fc89d2`，PID 9548、instance `60a0f6b3-0e38-4d98-a5b2-131c726d50fe`、restart count 222。Report-only commit 不改变 runtime hashed source/artifact；提交后再次执行 closure 以确认 `main` HEAD 与 remote HEAD 相等。
