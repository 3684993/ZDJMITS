# ZDJ-MITS V3.9.5｜R16 最终安全收尾 + 24 小时正式稳定运行验收（egress 双层 fail-closed → 代码冻结 → soak → 稳定基线）

- 提示词：`docs/prompts/ZDJ-MITS-V3.9.5-R16最终安全收尾与24小时正式验收-Codex提示词-2026-09-20.md`（branch `docs/v395-r16-final-safety-24h-20260920`，commit `d43b229`）
- 分支：`v395-economics-human-managed-20260919`
- 冻结候选 HEAD：`e70e33e23c6c114853391e757eefdd0c3e9e17fb`（egress 修复 `2a7a9ab` + `diff --check` 尾空行修正 `e70e33e`）
- 部署后运行构建：`3.9.5-8b7cc98ccaaa6c06456c`（PID 10540，2026-09-20 11:48:11 启动，`restartCount` 164 → 165，本轮唯一一次受控 restart）
- soak：`V395_24H_SOAK_BASELINE` 冻结于 **2026-09-20 11:59:00**，计划连续 24 h（至 **2026-09-21 11:59**）
- 模式：全程 `SHADOW` + HUMAN cap 开启 + Testnet only；交易未暂停；未改任何限额、预算或 Settings

---

## A. R16 egress 根因裁决（Stage 0：不依赖任何旧报告，逐条查写路径）

R15 报告曾断言"出口 IP 未证明时不会阻止下单"。本轮先按代码把每一条写入路径钉死，再用运行时事件交叉验证，**结论与 R15 相反，R15 已提交勘误（`19fe575`、`9e4f2b6`）**。

### A-1 写入路径全表（源码级）

| # | 上层动作 | 入口 | 是否落到 `signed(method!=='GET')` | 是否经 `assertTestnetExchangeWrite()` |
|---|---|---|---|---|
| 1 | 新开仓 | `ExternalTradeAdapter.placeEntry` → `POST /fapi/v1/order`（purpose `NEW_ENTRY`） | 是 | **是** |
| 2 | 改价 | `replaceEntry` → `PUT /fapi/v1/order` | 是 | **是** |
| 3 | 撤单 | `cancelEntry` → `DELETE /fapi/v1/order` | 是 | **是** |
| 4 | TP 创建/替换 | `placeTakeProfit` → `POST /fapi/v1/order` | 是 | **是** |
| 5 | TP 撤销 | `cancelTakeProfit` / `cancelSymbolOrders` → `DELETE /fapi/v1/order` | 是 | **是** |
| 6 | 人工减仓 / 手动单 | `placeManualOrder` → `POST /fapi/v1/order`（`reduceOnly` 由请求决定） | 是 | **是** |
| 7 | 设杠杆 | `setLeverage` → `POST /fapi/v1/leverage` | 是 | **是** |
| 8 | 用户数据流 keepalive | `BinanceUserDataStream.listenKey` → `POST/PUT /fapi/v1/listenKey`（直接 `transport.json`） | 否（非 `signed`） | **否（有意保留，见 A-4）** |

`ExternalTradeAdapter.signed()` 的第一句就是 `if(write){this.transport.assertTestnetExchangeWrite(); …}`，因此**所有真实交易所写入都已在 Layer B 被出口证明门住**；`assertTestnetExchangeWrite()` 的判据是 `expectedEgressIp` 已配置且 `status!=='VERIFIED'` ⇒ 抛 `TESTNET_WRITE_EGRESS_NOT_VERIFIED:<status>`。

### A-2 运行时交叉验证（当天真实事件，非推断）

| 时刻 | 事件 | reason / stage |
|---|---|---|
| 03:45:25 | `TP_REPAIR_FAILED`（INJUSDT） | `submissionOutcome=NOT_ATTEMPTED`，`message=TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE` |
| 03:47:49 | `ENTRY_ORDER_BLOCKED` | 同上，`stage=SET_LEVERAGE` |
| 10:09:33 | `ENTRY_EXECUTION_WAIT_RETRY_FAILED` | 同上，`stage=SET_LEVERAGE` |
| 10:11:58 / 10:14:49 / 10:18:30 | `ENTRY_ORDER_BLOCKED` ×3 | 同上，`stage=SET_LEVERAGE` |

对应窗口内 `productionWriteBoundary`：`productionWrites=0`、`testnetWrites` 不增、`blockedProductionWriteAttempts` 自启动累计 **4** ⇒ 与 4 条拒写一一对应。这两段失效期都是第三方回显探针自然超时（`checkip.amazonaws.com`，5 s abort），一个 15 min 周期后自证恢复，全程未人工干预网络。

### A-3 裁决

**`EARLY_ENTRY_ADMISSION_EGRESS_GATE_MISSING`**，不是 `TESTNET_WRITE_EGRESS_FAULT_BROKEN`：

- Layer B（transport 写边界）本来就 fail-closed，且有运行时证据；
- 缺的是 Layer A：`EntryCoordinator.processPool()`（`entryCoordinator.ts:51`）与 `executionHardBlock()`（`:155`）只调用 `binanceEntryBlockReason(environment)`，**不含出口证明**，于是在出口未证明时仍然照跑 AI 推理、创建 intent、占 reservation、发 `SET_LEVERAGE`，最后一步才被 transport 挡掉；副作用是浪费一轮 GPU 与预算、把候选推进 `TECHNICAL_COOLDOWN` 且 reason 失真（事件里可见 `CANDIDATE_LIFECYCLE_CHANGED reason=TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE`）。
- 另外 `BinanceTransport.entryBlockReason()`（本来就该是 Layer A 的判据）在修复前**全仓库零调用方**，属"写了但没接线"。

### A-4 现有写边界的一刀切取舍（提示词要求单独说明）

`assertTestnetExchangeWrite()` 对**所有**非 GET 请求一律要求出口已证明，因此：

- **保护性写入也会被挡**：03:45 那条 `TP_REPAIR_FAILED` 就是证据 —— 出口探针超时期间，一个裸仓的 TP 补挂被拒（该仓随后在下一个 15 min 周期由 TP 修复轮成功补挂，实测 `TP_PROTECTED`，窗口内 `TP required=protected` 未出现缺口）；
- 人工减仓（`placeManualOrder reduceOnly`）同样会被挡；只读路径（reconciliation / 持仓与订单读 / `findEntryByClientOrderId`）完全不受影响；
- `listenKey` 有意不经该闸：它是用户数据流 keepalive，若一起挡掉会**切断实时成交与风险事实通道**（E 节里"迟到成交实时性"依赖它），反而降低安全性；
- 本轮**不重构**这套写入分级（提示词："不能在本轮未经测试重构成大体系"）。把"按写入风险方向分级放行（risk-increasing 严格挡、protection-preserving 允许）"列入 backlog V 节，需独立设计与门禁。

## B. egress 修复（Stage 1 + Stage 2，只补 Layer A）

统一真源，禁止复制判断（`adapters/binance/requestBudget.ts`）：

```ts
/** Single source of truth for the configured static egress proof: absent proof is not permission. */
export function binanceEgressState(egress:{expectedEgressIp?:string|null;status?:string|null}|null|undefined){
  const expected=String(egress?.expectedEgressIp??'').trim()||null,status=String(egress?.status??'UNVERIFIED');
  return {expected,status,verified:!expected||status==='VERIFIED'};
}
export function binanceEgressEntryBlockReason(egress){const state=binanceEgressState(egress);
  return state.verified?null:`BINANCE_EGRESS_${state.status}`;}
```

- `BinanceTransport.entryBlockReason()` 与 `assertTestnetExchangeWrite()` 改为**共用**该真源；错误字符串逐字不变（既有断言与运行时 reason 兼容）；`entryBlockReason` 继续携带**实际承载写入的那条路由**的 `routeIdentity`（不再只看 environment 聚合）。
- `ExternalTradeAdapter.entryAdmissionBlockReason()` 暴露 transport 判定；`types.ts` 增加可选接口方法。
- `EntryCoordinator`：

```ts
private writeAdmissionBlock(){return this.exchange.entryAdmissionBlockReason?.()
  ?? binanceEntryBlockReason(this.state.settings.connections?.exchange?.environment);}
private noteWriteAdmission(reason:string|null){
  if(reason===this.admissionBlockReason)return;                      // 只在状态跃迁时发事件
  const previous=this.admissionBlockReason;this.admissionBlockReason=reason;
  this.events.publish(reason?'ENTRY_ADMISSION_BLOCKED':'ENTRY_ADMISSION_RESUMED',
    {reason,previousReason:previous,poolSize:this.state.pool.list().length,at:Date.now()});
}
async processPool(){const admissionBlock=this.writeAdmissionBlock();
  if(admissionBlock){this.noteWriteAdmission(admissionBlock);return;}
  this.noteWriteAdmission(null); …}
```

`executionHardBlock()` 同步改用 `writeAdmissionBlock()`，因此 reason 会以 `BINANCE_EGRESS_UNVERIFIED|UNAVAILABLE|MISMATCH` 明确出现在既有 `ENTRY_ORDER_BLOCKED` 事件里。Mock adapter（测试与离线运行时）没有 transport ⇒ 退回原有环境判据，行为不变。

**边界不外溢**：闸只在 Entry 准入与执行硬阻断两处；只读 reconciliation、订单状态审计（`reviewPending`）、TP 维护、持仓事实读取都不引用它（Stage 3 第 12/13/14 项有测试锁死）。恢复不需要重启：`verifyEgressIp()` 每 15 min 重跑，`egressStatus()` 是活读，测试项 6/7 覆盖。

## C. 双层 fail-closed 证明

| 层 | 位置 | 触发条件 | 证据 |
|---|---|---|---|
| Layer A 早期准入 | `entryCoordinator.processPool()` / `executionHardBlock()` | `expectedEgressIp` 已配置且 `status!=='VERIFIED'` | 新增测试：阻断时 AI 完全不被调用、状态零变化、只发 1 条 `ENTRY_ADMISSION_BLOCKED`；恢复时发 `ENTRY_ADMISSION_RESUMED`；把 `processPool` 改回旧实现后这 3 个用例失败 |
| Layer B 写边界 | `signed()` → `assertTestnetExchangeWrite()` | 同一真源 | 当天 6 次真实拒写事件（A-2）；新增测试证明 `cancelEntry` 在 `testnetWrites=0`、`transport.json` 未被调用的情况下被拒（先拒后开 socket） |
| 真源唯一 | `binanceEgressState()` | 两处共用 | 两处判定都调用同一函数；`entryBlockReason`/`assertTestnetExchangeWrite` 字符串契约由既有 17 条 transport 测试保护 |
| live 部署 | `3.9.5-8b7cc98ccaaa6c06456c` | egress 启动即 `VERIFIED`（11:48:14） | 启动后 `ENTRY_ADMISSION_*` 事件 **0 条** ⇒ 健康状态不误伤；`testnetWrites=0 / productionWrites=0 / blockedProductionWriteAttempts=0` |

## D. 测试（Stage 3 十五条）

新增 `apps/engine/src/services/egressFailClosed.test.ts`，11 个用例（`node:https` 被桩化，可控注入 VERIFIED / MISMATCH / UNAVAILABLE，不动真实网络）：

| Stage 3 项 | 覆盖 |
|---|---|
| 1 VERIFIED 可继续 | 纯判据用例 + "admits again on the same instance after a successful re-verification" |
| 2/3/4 UNVERIFIED / UNAVAILABLE / MISMATCH 阻断 | 纯判据用例（三种 status 逐一断言）+ "blocks both Entry admission and the write boundary…"（UNAVAILABLE）+ "reports MISMATCH…" |
| 5 预期 IP 变更后旧证明失效 | "invalidates a carried proof when the expected static egress IP changes on the same route"（同 `routeIdentity`，`reconfigure` 后回 UNVERIFIED） |
| 6/7 证明恢复即放行、无需重启 | "admits again on the same instance…"（同一 transport 实例，先失败后成功） |
| 8/9 不新建 Entry 提交、不产生交易所写入 | Layer A 用例（AI 未调用 + 状态零变化）+ Layer B 用例（`transport.json` 未调用、`testnetWrites=0`） |
| 10 写边界二次保护 | 同上（`assertTestnetExchangeWrite` 抛错 + 计数器） |
| 11 `setLeverage` 不先于准入 | `executionHardBlock` 用例（`stage=SET_LEVERAGE` 在真实事件里曾是首个拒写点，现由准入先行拦下） |
| 12/13/14 不误伤只读复核、不破坏既有 TP、持仓事实不变 | "leaves order-state auditing and read-only recovery paths running…" + 阻断用例对 `tpOrders/positions/entryOrders/reservations/candidateLifecycle` 逐项 size 前后相等 |
| 15 429/418 与预算语义不变 | "keeps the existing budget semantics in front of Entry…"（`BINANCE_BUDGET_SATURATED` 仍作为 reason 生效）+ 部署后 `http429/418` 恒 17/3 |

可失败性已证明：临时把 `processPool` 改回旧实现 ⇒ 3 个用例失败（其余 transport 用例仍过，说明它们锁的是既有行为）；恢复后 11/11 通过。

全量：`npm test` ⇒ **121 files / 682 tests 全绿，skipped 0**（R15 为 120 / 671，本轮 +1 文件 / +11 用例）。

## E. 本地 exact-HEAD 门禁（Stage 4）

GitHub Actions 仍 budget=0，未触发未 rerun；按已授权的本地替代门禁执行。全新 worktree `D:\MITS-WORKTREES\v395-localci-r16b`（`git worktree add --detach … e70e33e`，建立时 `dirty=0`、`node_modules=0`）：

```
diff_check 0  npm_ci 0  build_contracts 0  build_core 0  verify_scripts 0
typecheck  0  test    0  build          0  verify      0
ALL_STEPS_PASSED   final_untracked_or_dirty_lines=0
Test Files 121 passed (121)   Tests 682 passed (682)   # skipped 0
```

第一次门禁在**第 1 步**就失败：`git diff --check` 报 `requestBudget.ts:106: new blank line at EOF`（我在追加函数时留下了尾部空行，且文件是 CRLF，第一次按 `\n` 剥离无效）。以 `e70e33e` 在字节层修正后**另起全新 worktree** 重跑，9 步全绿。未跳过、未放宽任何步骤。

## F. final build identity（Stage 5 部署与闭环）

- 门禁 worktree 内四棵 dist 树 `contentTreeHash = 8b7cc98ccaaa6c06456cb7d06e7ff3254ae9fabd99fdaaa43a537fc128e219c0` ⇒ 预期 `buildId = 3.9.5-8b7cc98ccaaa6c06456c`（`sourceHash = 64f6e56b0aa35b0137d7e33e130bcd9479100a423e46f5ba8bbb0a4ea1623f45`）；
- 部署前校验：`capacity.inFlight=0`、`pendingEntries.count=0`、`TP 33/33`、`missing=0`、`repairing=0`、`egress=VERIFIED`；
- `stop-zdj-lan.ps1`（三重身份校验，旧 PID 24448）→ 备份 `D:\MITS-WORKTREES\backup-live-dist-r16-20260920\20260920-114734`（844 文件 / 3,870,299 B）→ 安装门禁 dist（708 + 72 + 45 + 22 = 847 文件，逐树计数一致）→ 装入后在 `D:\MITS` 重算得 `8b7cc98…` ⇒ `MATCHES_GATE=true`；
- `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` ⇒ PID 10540、`restartCount 164 → 165`、`buildId` 与预期一致、`egress VERIFIED @11:48:14`、`TP 33/33`、33 个旧仓无损、未重启 8081 / 8084 / proxy；
- 冻结时刻 `git rev-parse HEAD = e70e33e`（此后仅有 `docs/reports/` 的文档提交，`git diff e70e33e..HEAD --name-only` 全部落在 `docs/` 内 ⇒ 运行构建与冻结代码一致）。

---

## G–X：24 小时 soak 结果（待窗口结束填写）

采集器 `r16-soak.py` 以分离进程独立运行（每 10 min 快照、每小时 durable aggregate、P0/P1 实时落盘），只读 HTTP + `mode=ro` SQLite，不触碰 Engine 生命周期。证据文件位于 `D:\MITS-WORKTREES\dryrun\r16\`：`soak-baseline.json`、`soak-samples.jsonl`、`soak-hourly.jsonl`、`soak-alerts.md`、`soak-progress.json`、`soak-summary.json`。

G_PLACEHOLDER V395_24H_SOAK_BASELINE
H_PLACEHOLDER 24h 精确起止与采样密度
I_PLACEHOLDER restart count / crash / uptime
J_PLACEHOLDER 行情与 K 线自愈
K_PLACEHOLDER egress 跃迁与双层闸的 live 表现
L_PLACEHOLDER 429/418 与请求治理
M_PLACEHOLDER Entry 漏斗
N_PLACEHOLDER UNKNOWN 与 durable claims
O_PLACEHOLDER reconciliation
P_PLACEHOLDER 持仓
Q_PLACEHOLDER TP 安全
R_PLACEHOLDER HUMAN 语义
S_PLACEHOLDER AI 健康
T_PLACEHOLDER 存储 / 数据库
U_PLACEHOLDER P0/P1 事件
V_PLACEHOLDER P2/P3 backlog
W_PLACEHOLDER 24h PASS / FAIL
X_PLACEHOLDER 是否冻结为 V3.9.5_STABLE_BASELINE
