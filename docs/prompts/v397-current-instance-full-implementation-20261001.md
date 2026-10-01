# V3.9.7 当前旧电脑实例一次性完整实施指令

## 0. 任务性质

本轮不再重复做“问题是否存在”的总审计，而是基于已经完成的当前实例差异化审计与实施计划，一次性完成代码实施、schema/migration、Settings、新增测试、Dashboard/readback、TESTNET 部署、重启、运行验证和最终实施报告。

实施过程中不要逐阶段向用户询问是否继续。只有全部完成后统一提交最终结果供用户审核。

本轮只允许操作当前旧电脑的 TESTNET / TESTNET_ENABLED 实例。Production 写入必须始终为 0。

## 1. 必须先读，优先级从高到低

1. `docs/reports/v397-current-instance-differential-optimization-20260930/IMPLEMENTATION_PLAN.md`
2. `docs/reports/v397-core-trading-quality-final-audit-20260929/ROOT_CAUSE_REPORT.md`
3. `docs/reports/v397-core-trading-quality-final-audit-20260929/SOLUTION_AND_IMPLEMENTATION_PLAN.md`
4. `docs/reports/v397-high-quality-entry-sizing-replan-20260930/astra-reference/REFERENCE_SUMMARY.md`

其中第 1 份是当前旧电脑实例的权威实施依据。Astra 另一实例只能作为代码问题参考，绝不能把其余额、订单、持仓、AI 统计、Settings、生效 build、时间窗口或任何运行数字复制到当前实例。

若文档存在冲突，以“当前实例真实源码 + 当前实例 Settings/SQLite/AI archive/readback + 第 1 份实施计划”为准。

## 2. 当前产品口径

必须把以下概念彻底分开，不允许继续混用：

- 业务最低初始保证金 / 建仓保证金；
- 目标初始保证金 / 资本配置目标；
- 订单 notional；
- 交易所 minQty / minNotional。

用户当前要求的是“最低建仓保证金”这个业务概念，而不是把旧字段中的 `200` 自动翻译为最低订单 notional 200。

本轮必须建立新的、显式、版本化、可配置的最低初始保证金权威字段。不得继续让 legacy `entryMarginUsd/baseMarginUsd` 同时承担多个语义。当前 TESTNET 实际启用值必须来自该新权威 Settings 字段；不得由交易所 minimum、旧字段、Primary raw quantity 或 fallback 隐式替代。

不要把数值写死在代码中。Settings 必须支持后续由用户配置不同最低保证金档位；修改值不应要求改代码。

## 3. 一次性实施主线

严格按照当前实例 IMPLEMENTATION_PLAN 的依赖顺序完整实施，不因中间阶段通过而停止：

1. 证据留存、trace 与时钟闭环；
2. Scout/Primary 时延和对照能力；
3. schema/migration/readback；
4. 单一 `EntryEconomicMandate` / 等价经济合同；
5. 唯一 sizing authority 与最低初始保证金；
6. size / leverage / fee / target / horizon / 1h reachability 的同合同闭环；
7. 1D / 4H / 15m 方向事实与执行时效合同；
8. TP 经济性、目标期限与持仓生命周期；
9. Review / AI Exit 的计划所要求的 SHADOW/验证链；
10. TESTNET funds-only 下观察型 portfolio risk 不得重新成为 quantity/side veto；
11. Dashboard/API/readback；
12. 完整测试、build、migration、部署、重启、自然运行验证与最终报告。

## 4. 核心实施目标

最终系统必须能对每一笔新 Entry 回答并持久化：

- 为什么是 LONG / SHORT；
- 1D、4H、15m 各自支持/反对什么；
- 为什么是这个数量；
- 最低建仓保证金是多少、实际保证金是多少；
- notional、杠杆、quantity、价格如何相互推导；
- 为什么这个 TP/target 合理；
- 双边费用、滑点、funding/FX coverage 如何影响最低净收益；
- 目标在授权 horizon、尤其约 1h 内的可达性依据是什么；
- AI raw → normalized → mandate → TradePlan → reservation → intent → JIT → adapter → remote order 是否发生未授权的数量/方向/目标变化；
- 若不能形成经济上有意义且满足业务最低保证金的合法候选，为什么是 NO_TRADE，而不是退回交易所最小单。

禁止继续产生“合法但经济意义极低”的微小单作为自动 fallback。

## 5. 方向与时效

必须解决“方向判断”和“判断过时”混在一起的问题。

1D / 4H / 15m 必须形成可机读、可审计的多周期事实；不要仅靠一段自然语言理由。

Scout/Primary 的串行成本必须按当前实例重新验证。Astra 或旧窗口的延迟数值不能直接套用。

如果 Primary 完成后市场事实已经发生 material change，旧判断不能仅靠延长 TTL 继续提交。JIT 必须能区分执行事实仍合法与交易论点已经失效。

不要因为短期方向结果不好就机械反转 LONG/SHORT，也不要把 SHORT bias 重新升级为硬门禁。

## 6. 风险/门禁边界

本轮重点不是重新建立 portfolio 风险体系。

TESTNET funds-only 下 Gross / Direction / Cluster / Stress / Human / position count / historical UNKNOWN / historical claim 等观察事实不得重新成为 sizing authority、不得缩小 quantity、不得翻转 side、不得作为新 Entry 的隐性 veto。

继续保留执行正确性约束：

- TESTNET / Production 隔离；
- 真实可用资金/保证金；
- exchange filters / precision /合法价量；
- fresh private facts / market facts；
- 授权、identity、exactly-once、UNKNOWN submit recovery；
- reservation / durable storage；
- JIT 资金与冻结身份；
- Exit reduce-only / TP identity / position truth。

## 7. 数据与迁移

在修改 schema/Settings/持久化前，先停止 TESTNET Engine 并备份相关 SQLite、WAL/SHM、实例身份文件和必要只读摘要。

migration 必须可重复、可恢复、带 schema/version evidence；不得删除历史订单/成交来获得绿色结果；无法证明的历史事实保持 UNKNOWN。

不允许使用 Astra 另一实例的数据做 repair 或 backfill。

## 8. 测试与验证

至少完成：

- targeted tests；
- full workspace tests；
- typecheck；
- formal build；
- `npm run verify`；
- S00；
- storage coverage；
- durable schema roundtrip；
- migration/restart tests；
- diff/secret检查；
- identity closure。

必须新增针对以下失败形状的真实/隔离回归：

- 微小订单 fallback；
- business minimum 与 exchange minimum 混用；
- notional / margin / leverage 单位混淆；
- reprice 后跌破业务 minimum；
- AI raw quantity 与最终 remote order 不一致；
- 观察型 risk 改变 quantity/side；
- 1D/4H/15m 事实冲突与过时；
- economic mandate 成本版本不一致；
- TP 低净收益但被当正常新仓；
- restart 后 mandate/order identity 漂移。

## 9. 部署与重启授权

本轮明确允许 Codex/Luna 为完成当前 TESTNET 实施，按需要停止、启动和重启当前实例，不需要每次向用户申请。

但必须：

- 只操作 TESTNET；
- 使用项目现有人工 start/stop 生命周期；
- 不安装新的 watchdog/autostart/计划任务；
- 不产生 Production 写入；
- migration/repair 与 Engine 运行状态遵守脚本自身安全要求；
- 每次最终加载后核对 source/artifact/build/settings/schema/instance identity。

最终必须让正在运行的 TESTNET 实例加载本轮最新 push 的代码，而不是只停留在源码测试通过。

## 10. 自然运行验收

重启最新 build 后，使用当前实例自己的自然数据验收，不制造成交凑样本。

至少验证：

- pipeline/scheduler 正常；
- Production writes=0；
- Entry permit 只有执行正确性 blocker；
- 新 Entry 不出现旧的约 5 quote-unit 微小 fallback；
- 每笔新 Entry 均有 mandate/provenance；
- minimum initial margin、notional、leverage、quantity 可重算；
- raw→remote quantity/side/target 无未授权变化；
- TP protection 与 TP economics 分列；
- 方向/时效 trace 可解释；
- terminal claim / convergence / restart identity 正常。

对于需要更长时间才能证明的方向收益、1h hit-rate、Scout 增益或 AI Exit 效果，不得伪造 PASS；报告当前自然样本和 UNKNOWN 边界即可。

## 11. 最终交付

全部完成后统一：

1. commit + push `main`；
2. 重启并加载最终 TESTNET build；
3. 完成 identity closure；
4. 生成 `docs/reports/v397-current-instance-full-implementation-20261001/IMPLEMENTATION_RESULT.md`；
5. 报告起始 SHA、最终 SHA、代码提交链、Settings/schema 变更、测试、运行 build、自然 Entry/TP/Exit readback、Production writes、仍然 UNKNOWN 的事项；
6. 不在中途逐阶段征求用户是否继续。
