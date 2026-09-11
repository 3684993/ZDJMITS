# ZDJ-MITS V3.5.0 Decision Integrity / Risk Governance 实施报告

日期：2026-08-26  
项目：`D:\MITS` 当前 ZDJ-MITS  
执行依据：本地《ZDJ-MITS-2026-08-25-建仓决策质量审计报告.md》与 Google Drive 中《ZDJ-MITS-V3.5.0-Decision-Integrity-Risk-Hard-Gates-Full-Chain-Traceability实施计划.md》全文。执行提示词与实施计划均作为任务约束读取；本报告只记录真实代码和运行结果。

## 1. 交付结论

本轮已完成可安全落地的 V3.5.0 第一批硬闸门、资金预留、Underlying 原子锁、长期审计留痕、决策链 API、回放 API、前端治理配置和重启验收。

自动新建仓没有恢复，当前保持：

- `mode=PAUSED_MANUAL`
- `entrySafetyMode=SAFETY_REVIEW_PAUSED`
- `autoResume=false`
- 活动资金预留：0
- 活动 Underlying 锁：0

这不是故障，而是按执行提示词的安全要求保留的生产保护状态。未完成至少 7 天 Testnet shadow/replay 前置条件，也未获得本轮新的显式 AUTO 恢复确认，因此没有自动恢复。

当前已有持仓、已有订单、历史成交和人工控制台未被本轮修改或强制平仓。

## 2. 24 项当前代码分类

分类含义：`ALREADY_FIXED` 已具备并经本轮验证；`STILL_BROKEN` 仍未满足目标；`PARTIAL` 已有部分能力但链路或覆盖不完整；`IMPLEMENTATION_CONFLICT` 现实现与本轮目标冲突。

| # | 审计项 | 当前分类 | 本轮结论 |
|---:|---|---|---|
| 1 | 行情时间戳新鲜度 | ALREADY_FIXED | 运行后行情 LIVE，freshness 为 FRESH/READY。 |
| 2 | Testnet 市场真实性、单位与异常值识别 | STILL_BROKEN | 尚未完成跨源、量纲、重复档位和分位数异常检测。 |
| 3 | 衍生品关键字段完整性 | PARTIAL | EIP 有字段容器，但缺失数据仍需更完整的语义质量门。 |
| 4 | Underlying 解析 | ALREADY_FIXED | 现有 USDT/USDC/BUSD 解析保留。 |
| 5 | 跨 Quote 的 Underlying 原子锁 | ALREADY_FIXED | 新增内存锁、租约、持久化状态和释放路径，锁键为大写 Underlying。 |
| 6 | Capital Admission 预门 | PARTIAL | 现有资金路由保留，并新增 Entry 级资金预留；多进程/跨实例原子事务仍未实现。 |
| 7 | Exposure 超限硬拒绝 | ALREADY_FIXED | 删除零 room 仍强制 `minMargin` 的逻辑；room 小于最小可执行保证金时返回 `REJECT_EXPOSURE_LIMIT`，Quote room 不足时返回 `REJECT_QUOTE_MARGIN`。 |
| 8 | 最大持仓数硬门 | ALREADY_FIXED | Plan 与 reservation 同时计入 positions + working orders + reserved intents。 |
| 9 | 最大同 Underlying 持仓数 | ALREADY_FIXED | Plan 对同 Underlying 数量做拒绝，reservation 对并发 Underlying 做原子锁。 |
| 10 | Gross Notional / Equity 总风险 | PARTIAL | 方向敞口和 Quote margin 已进入 Plan；相关簇、清算缓冲和全局 gross envelope 仍需补齐。 |
| 11 | 方向集中风险 | PARTIAL | LONG/SHORT exposure hard gate 已存在并继续生效；相关性簇与组合级压力测试尚未完成。 |
| 12 | Location Protection | ALREADY_FIXED | 原有 location score hard reject 保留。 |
| 13 | 风险预算驱动的动态 sizing | PARTIAL | 已有动态保证金、波动率、置信度和 location 因子；尚未形成完整的 ATR/最大亏损金额 sizing。 |
| 14 | 杠杆与可承受不利波动联动 | PARTIAL | Tier/global leverage cap 已存在；机器止损和清算缓冲尚未闭环。 |
| 15 | entryInvalidation 机器执行 | STILL_BROKEN | 当前仍有自由文本失效条件，尚未生成并执行 Stop/Invalidation 订单。 |
| 16 | Entry Protection Policy | PARTIAL | 新增 `OFF/SHADOW/REQUIRED` 与 `SAFETY_REVIEW_PAUSED/SHADOW/AUTO` 配置；SHADOW/REQUIRED 的审计门已接入，但保护性退出本身仍需实现。 |
| 17 | Post-AI deterministic verification | ALREADY_FIXED | 新增价格范围、方向一致性和完整性确定性复核；失败时 fail-closed。 |
| 18 | 缺失证据 / AI 失败 fail-closed | ALREADY_FIXED | EIP 证据不足、Scout 失败、AI 失败均不再绕过进入下单链。 |
| 19 | High-Risk Review | PARTIAL | 现有 Second Brain 能力保留，新增 REQUIRED protection 条件；尚未将全部高风险事实强制路由到独立 reviewer。 |
| 20 | append-only Decision Chain | PARTIAL | 新增 SQLite `decision_chains`、事件追加和查询 API；历史交易链尚未全部反查补链，且跨进程写入仍需进一步加强。 |
| 21 | AI Run 至少 90 天查询 | PARTIAL | 新增 `ai_runs_archive` 并默认查询 90 天；本次重启前的旧 200 条没有伪造回填，后续新 Run 会持续归档。 |
| 22 | Runtime Event 长期留存 | ALREADY_FIXED | 移除 10,000 条全局 FIFO 删除，旧事件不再因固定上限被静默覆盖。 |
| 23 | TradeRecord → AI / Plan / Order / Fill 全链 | PARTIAL | 系统成交现有 entryRun/intent/order 关联会继续保存；尚缺统一 allocationPlanId、chainId、exchange order/fill 的历史全量回填。 |
| 24 | Replay / 后验 / 7 天 shadow | PARTIAL | 已新增只读 `/api/v3/audit/replay`，但当前仍在安全冻结，尚未经过 7 天时间门槛，不能声称已完成生产恢复验收。 |

## 3. 已实施的代码与数据变更

### 3.1 Contracts / settings

- 新增 `packages/contracts/src/riskGovernance.ts`。
- `SystemSettings` 新增风险治理配置：
  - `entrySafetyMode`，默认 `SAFETY_REVIEW_PAUSED`；
  - `protectionMode`，默认 `SHADOW`；
  - 缺失证据 fail-closed；
  - Post-AI 确定性复核；
  - 资金预留数量、租约、日内 circuit-breaker 配置。
- `PortfolioAdmission` 新增 `REJECT_MAX_POSITIONS`、`REJECT_DATA_QUALITY`、`REJECT_PROTECTION_REQUIRED`。
- EntryIntent、EntryOrder、ExecutionFill 增加可选 reservation/chain/plan 关联字段。

### 3.2 Core / Entry

- `buildAllocationPlan` 新增 working order/reserved intent 上下文。
- 修复 `Math.max(minMargin, room)` 零空间绕过；不可满足最小执行保证金时硬拒绝。
- 增加最大持仓、最大同 Underlying、Quote margin room 约束。
- Entry Coordinator 在 AI 后执行确定性复核；证据不足和 Scout 失败 fail-closed。
- 增加资金预留与 Underlying 锁；挂单取消、过期、提交失败、成交、对账终态均有释放/提交路径。
- 运行控制新增日内损失 circuit-breaker 逻辑，但默认日损阈值为 0（关闭阈值，不改变当前账户风险设置）。

### 3.3 SQLite / API

- schema migration 3 已执行，新增：
  - `ai_runs_archive`
  - `decision_chains`
- Runtime Event 不再删除旧事件。
- 新增 API：
  - `GET /api/v3/decision-chains`
  - `GET /api/v3/decision-chains/:id`
  - `GET /api/v3/audit/replay`
- `GET /api/v3/brain/runs` 默认从 90 天归档读取，归档为空时兼容当前内存事实。
- `/api/v3/runtime/trading-control` 返回安全模式、风险治理配置、活动 reservation/lock。

### 3.4 前端

系统设置 → 策略与执行已新增：建仓安全模式、入场保护策略、证据最低完整度、最大并发资金预留、缺失证据 fail-closed、AI 后确定性复核。默认安全模式在页面可见且为 `SAFETY_REVIEW_PAUSED`。

## 4. 数据库备份与运行状态

修改前一致性备份：

`D:\MITS\data\backups\v350-pre-hard-gates-20260826-230529.sqlite`

重启后实测：

- SQLite integrity：`true`
- schema migrations：`1, 2, 3`
- runtime events：最终采样 `11,971`，已超过原 10,000 上限而未被截断
- `0.0.0.0:8080` LISTEN
- `http://127.0.0.1:8080/health`：READY
- `http://192.168.1.50:8080/health`：READY
- Market stream：LIVE
- Private data：READY
- Reconciliation：无错误，既有 drift 计数保持真实值
- 活动 entry order：0
- 活动 reservation：0
- 活动 Underlying lock：0

## 5. 验证记录

命令验证：

- `npm run verify` 通过。
- contracts/core/dashboard/engine 类型检查通过。
- 20 个测试文件、45 个测试通过。
- dashboard Vite build 通过。
- engine TypeScript build 通过。

浏览器只读验收：

- 驾驶舱加载成功，运行控制显示 `PAUSED_MANUAL` 和安全冻结原因。
- 系统设置加载成功，V3.5.0 风险治理字段和默认值可见。
- 390×844 移动视口加载成功，移动应用栏、底部导航、驾驶舱内容正常。
- 浏览器控制台 error 数量为 0。
- 验收完成后已恢复浏览器默认视口。

## 6. 尚不能声称完成的事项

本次没有伪造以下结果：

1. 未将历史 8 月 25 日交易强行回填为不存在的 AI Run、Snapshot、AllocationPlan 或 Fill 关联。
2. 未声称已经完成 7 天 Testnet shadow/replay，因为当前时间门槛尚未经过。
3. 未声称 Stop/Invalidation 保护订单已经存在，因为当前实现仍未完成该机器执行闭环。
4. 未恢复 AUTO，也未调用 resume 接口。

后续只有在完整决策链可查询、保护性退出闭环完成、7 天 shadow/replay 无越权并获得用户明确确认后，才可以考虑把 `entrySafetyMode` 从 `SAFETY_REVIEW_PAUSED` 改为允许自动运行的模式。
