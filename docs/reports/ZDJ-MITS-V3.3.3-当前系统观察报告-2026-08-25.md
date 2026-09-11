# ZDJ-MITS V3.3.3 当前系统观察报告

日期：2026-08-25（UTC+8）
观察方式：独立只读观察 —— 项目文档/配置 + 运行中引擎的实时 API（`/health`、`/api/v3/snapshot`、`/api/v3/operations/health`）+ 最新日志尾部 + 进程/端口状态。
说明：本报告为对“当前系统状态”的独立观察与综合，不重复既有验收报告的结论，而是把文档、配置与实时运行事实放在一起，给出观察、风险判断与建议。所有数字均来自本次实时抓取或仓库内证据文件。

---

## 一、系统概览

**定位**：智多金多币种智能交易系统 V3（ZDJ-MITS V3），一套“动态机会竞争 + 专业证据包 + 双主脑并行决策 + 确定性 Maker 执行 + 持仓隔离 + TP 守护”的多币种合约智能交易系统。

**架构分层（monorepo，npm workspaces）**：

| 层 | 目录 | 职责 |
|---|---|---|
| 契约 | `packages/contracts` | V3 contracts / zod schemas（单一事实源） |
| 纯逻辑 | `packages/core` | 指标 / 选币 / 池 / EIP / 定价 / TP 纯逻辑 |
| 引擎 | `apps/engine` | Engine API、WS、runtime、Market/AI/Execution/TP/Reconciliation 服务 |
| 前端 | `apps/dashboard` | Vue Finance Dashboard（9 页面） |
| 配置 | `config` | 默认设置与 AI 资源 |
| 文档 | `docs` | 架构、实现状态、基础设施、生产计划、各版本验收报告 |
| 脚本 | `scripts` | Windows 安装/启动/验证、冒烟、3h 耐力、验收采集 |

**核心决策链**：
`Market Data Hub → Universe Selector(Top N) → Eligibility Gate → Opportunity Scoring → Dynamic Pool → B580 Scout → Entry Intelligence Packet → 7900-A/B Brain Pool → PLACE_LONG | PLACE_SHORT | REJECT → Entry Manager(Maker 定价) → PENDING_ENTRY → POSITION → TP Guardian → CLOSED → re-eligible`

**AI 拓扑（默认）**：
- `scout-b580`：SCOUT，`qwen3.5:9b` @ `127.0.0.1:8081`（Intel Arc B580 12GB）—— 证据整理/缺失检查/摘要，无建仓权限。
- `brain-7900-primary`：PRIMARY_BRAIN，`qwen/qwen3.8-27b` @ `127.0.0.1:8084`（AMD RX 7900 XTX 24GB）—— 方向与可接受价格区间决策。
- 第二主脑复核：默认 `OFF`。

**版本演进（docs/reports）**：V3.0 基础包 → V3.1 TP 守护/持仓隔离/Dashboard → V3.2 Binance Testnet 实盘 + 双主脑 + 手续费感知 TP → V3.3 TradeRecord 闭环 → V3.3.1 持仓控制台 → V3.3.2 双主脑并行 → **V3.3.3 TradeRecord 闭环 + 手续费感知 TP 优化（当前）**。

---

## 二、当前运行状态（实时观测，2026-08-25）

**进程与端口**：引擎 PID 16336 监听 `:8080`；Dashboard `:5173`；AI `:8081`/`:8084`；SOCKS5H 代理 `:20081`。全部在线。

**引擎总状态**：`V3.3.3 / READY / LIVE / private READY`。

**七大健康门（snapshot.health）**：

| 门 | 状态 | 关键事实 |
|---|---|---|
| Trading Network Gate | HEALTHY | Testnet 写仍受凭据与私有就绪门控 |
| Market Data Hub | HEALTHY | 75/75 快照新鲜；stream LIVE；155 订阅；0 重连；0 gap；0 backfill |
| Dynamic Trading Pool | HEALTHY | 8/8 active |
| AI Fabric | HEALTHY | 2 资源在线 |
| Reconciliation | HEALTHY | drift=1 |
| TP Guardian | HEALTHY | required 31 / protected 31 / missing 0 / orphan 0 / duplicate 0 |
| Persistence / Audit | HEALTHY | integrity=true；auditEvents=10000 |

**账户（BINANCE_TESTNET_ACCOUNT）**：
- 权益 equity ≈ **$11,427.84**；可用 available ≈ **$540.34**；钱包 wallet ≈ **$13,709.49**。
- 未实现盈亏 unrealized ≈ **-$2,281.65**；24h 已实现 ≈ **+$1,068.20**。
- 资产：BTC 0.01（≈$802.72）、USDT 7274.45、USDC 5632.32。
- 活跃持仓 **31**；待入场 **3**；活跃入场单 **3**；活跃 TP 单 **31**。

**交易闭环（V3.3.3 口径）**：
- 完整 TradeRecord（CLOSED+COMPLETE）**8** 条；净收益 **$133.65**；毛收益 $146.48；总手续费 $12.83。
- Experience **8** 条，全部 WIN（按净收益判定）。

**近 30 分钟决策活动（tradeActivity）**：
- primary 运行 **1191**；PLACE **121**；REJECT **1070**；entry intent **106**；submit **92**；**fill 0**。
- 连续拒绝 consecutiveRejects=1；近 30m 唯一候选币种 20。

**配置口径（实时 settings，settingsVersion=15）**：
- `executionMode = TESTNET_ENABLED`；`marketDataMode = BINANCE`；`aiMode = OPENAI_COMPATIBLE`。
- 注意：仓库默认 `config/settings.default.json` 为 `executionMode = READ_ONLY`，而运行实例已演进到 v15 的 `TESTNET_ENABLED` —— 运行配置与出厂默认已分叉。

---

## 三、关键观察与发现

### 3.1 正面观察（系统健康、闭环成立）

1. **全链路在线且自洽**：7 大健康门全 HEALTHY，READY/LIVE/private READY 三者一致，无“假就绪”。
2. **行情层非常稳健**：75/75 新鲜、0 重连、0 gap、155 订阅、0 backfill —— 集中 WS Hub + 序列缺口 REST 回填的设计在实盘下表现良好。
3. **TP 守护零缺口**：31/31 持仓全部 PROTECTED，0 missing / 0 orphan / 0 duplicate / 0 qtyMismatch —— “每个持仓必须有 TP”的不变量成立。
4. **TradeRecord 闭环已修复并验证**：从“仅依赖理想事件回调”升级为“WS + 对账 + 可重启生命周期 + 一次性交易所事实修复”，8 条完整记录全部按净收益口径生成，无“毛正净负误判 WIN”。
5. **手续费感知 TP 生效**：新建 TP 前计算 break-even / 最低盈利价 / 预期净收益，不允许低于成本安全线；TradeRecords 展示建仓费/平仓费/总手续费/毛/净/Net ROI。
6. **决策吞吐高**：30 分钟 1191 次 primary 运行，AI 双资源稳定出决策（含完整证据引用与矛盾标注）。
7. **持久化与审计可靠**：integrity=true，10000 条脱敏审计事件，WAL + 版本化 + 备份/重启恢复均有测试覆盖。

### 3.2 风险与关注点（需要人工关注）

1. **拒绝率极高（约 90%）**：30m 内 REJECT 1070 vs PLACE 121。这是 fail-closed 设计的预期结果，但也意味着“大量决策 → 少量入场”的漏斗非常保守；需确认这是策略意图而非证据/门槛过严导致的“空转”。
2. **近 30 分钟 fill=0**：submit 92 但 fill 0。Maker 挂单未成交（价格未回落到可成交带）是可能原因，但结合高拒绝率，系统当前“决策多、成交少”，实际敞口增长有限。
3. **未实现亏损较大**：账户 unrealized ≈ **-$2,281.65**，且个别持仓亏损极端（如 ZECUSDT -1568%、ETHUSDC -699%，均为 20x 杠杆的导入持仓）。这是当前最大的资金风险点。
4. **无自动止损（设计边界）**：自动执行链中不存在自动止损，止损保留人工处理。在 20x 杠杆 + 较大未实现亏损的组合下，这一边界意味着**亏损敞口完全依赖人工盯盘**，是系统性风险。
5. **TP_LOW_NET 状态普遍**：多个持仓（如 PNUTUSDT、ZECUSDT、ETHUSDC）TP 经济学状态为 `TP_LOW_NET`（预期净收益低于 requiredNetProfit=$5）。这是“现有 Binance open order 的审计事实”，不代表新建违规，但说明**部分存量 TP 目标在扣费后并不够盈利**。
6. **可用资金偏低**：available ≈ $540.34，而 wallet ≈ $13,709 —— 大部分资金已压在持仓保证金中，新增入场/抗波动空间有限。
7. **对账 drift=1**：存在 1 处漂移（unmanagedOrders=1）。量级很小，但应持续观察是否收敛。
8. **运行配置与出厂默认分叉**：默认 `READ_ONLY` vs 运行 `TESTNET_ENABLED`（settingsVersion 15）。交付目录不含 Git metadata，配置演进仅靠 SQLite 版本化记录，**可追溯性依赖本地 DB**，跨机器/交付时需注意一致性。

---

## 四、已知问题与边界（来自文档，非本次新发现）

- **生产写适配器仍为外部门控**：`ExternalTradeAdapter` 真实交易所写、集中 WS Hub、真实 Reconciliation、生产持久化、Secret Provider、AI 真实端点协议/性能验收、生产审计/idempotency/错误分类、TP 参数/资金分配/币种规则最终校准 —— 均标注为“生产必须继续完成”。
- **DPAPI CurrentUser 凭据门**：本机执行 profile 未加载导致 CurrentUser Protect 被拒，凭据门为外部 gate。
- **不批量修改现有 TP**：V3.3.3 遵守“只审计、不批量改现有 Binance TP”的边界，故存量 `TP_LOW_NET` 保留。
- **外部/人工成交不自动归因**：12 条未关联成交不进入系统闭环，避免伪造归因。
- **手续费未知不置零**：commission 无可靠 income 对应时标为不完整，不进入主收益与 Experience。

---

## 五、建议（按优先级）

1. **优先处理未实现亏损敞口**：对极端亏损的 20x 导入持仓（ZECUSDT、ETHUSDC 等）做人工复核 —— 是否补 TP、减仓、或明确接受为人工持仓；鉴于无自动止损，建议建立“人工止损触发线”的书面规则。
2. **复核高拒绝率是否为策略意图**：拉取近 30m 的 REJECT 原因分布（证据缺失 / 门槛 / 方向矛盾 / 价格不可达），确认是“保守过滤”还是“门槛过严导致空转”。
3. **关注 fill=0 的持续性**：若长期 submit 多而 fill 少，评估 Maker 偏移/可成交带/入场价区间是否过于理想化。
4. **收敛 TP_LOW_NET 存量**：在“不批量改现有 TP”边界内，对新建仓位确保 TP 经济学达标；对存量给出“保留/调整/人工接管”的明确处置。
5. **配置一致性**：将运行实例的 settingsVersion=15 关键项（executionMode、TP 经济学、资金分配）回写/归档到交付文档，避免“出厂默认 vs 运行实际”分叉造成误判。
6. **持续观察 drift**：确认 drift=1 在后续对账中收敛为 0。

---

## 六、证据索引

- 实时快照：`http://127.0.0.1:8080/api/v3/snapshot`（本次抓取，ts=1787633432125）
- 实时健康：`http://127.0.0.1:8080/api/v3/operations/health`
- 最新日志：`data/logs/v3-20260825-111729.out.log`（尾部为 POSITION_LIFECYCLE / IMPORTED_OPEN_POSITION / RECONCILIATION_COMPLETED）
- 出厂默认配置：`config/settings.default.json`、`config/ai-resources.default.json`
- 实现状态：`docs/01-implementation-status.md`、`docs/implementation-progress.md`
- 最新验收：`docs/reports/ZDJ-MITS-V3.3.3-TradeRecord闭环-手续费感知TP优化实施验收报告-2026-08-25.md`
- 5h 成交审计：`docs/reports/ZDJ-MITS-V3.3.3-最近5小时成交与TradeRecord缺失审计报告-2026-08-25.md`
- 机器可读总结：`data/acceptance-v333-traderecord/20260825-115438/final-summary.json`

> 本报告为只读观察产物，未对系统做任何写操作、未下单、未修改任何 TP 或配置。
