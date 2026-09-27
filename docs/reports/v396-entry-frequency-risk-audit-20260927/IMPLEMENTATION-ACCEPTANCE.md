# V3.9.6 minimum-sufficient risk-chain implementation acceptance

## Result

`V396_MINIMUM_SUFFICIENT_RISK_CHAIN_IMPLEMENTED_LOCAL_PASS`

本轮基于 Phase 0 当前时点 replay 与架构报告实施最小充分风险链。没有新增风险审批层，没有调整已批准的风险限额，也没有为产生订单放宽门槛。Phase 0 的 active UNKNOWN/P0/closeout 数量仍存在来源不一致，风险运行时身份与本地源/SQLite 的完整对应关系也未证明；这些限制继续标记为未解决，本报告不声称 runtime accepted。

## 实施结论

- `HUMAN_ACK_OVERDUE` 保留为 handoff 数量和最旧时长遥测，不再作为无关新 Entry 的全局否决；ownership、TP/exit 和完整持仓风险仍保留。
- `MAX_GROSS_NOTIONAL` 是聚合名义主限额。人管名义限额在其等于或宽于 gross 时不重复否决；cluster cap 在其不小于 gross cap 时不可能形成更紧上限，真实更紧 cluster 仍独立生效。pending/claim 暴露继续计入 canonical gross 风险账本。
- blocker 诊断以候选影响量作单位换算：名义用候选 notional、margin 用候选 margin、stress 用候选增量损失；size-independent blocker 不伪造美元 shortfall。
- pre-AI、容量投影及最终路径共用 timestamped admission 容量结果。执行模式下缺失、抛错或格式无效的结果以 `UNAVAILABLE` 显示并 fail-closed；数字零仍是独立的有效容量状态。READ_ONLY/Testnet analysis-only 仍按既有只读语义工作。
- 候选上限根据 verified leverage、quote-asset margin 和压力损失逐候选计算，再与方向、gross、cluster、资本及其它执行事实交集。没有在 AI 授权后静默缩小计划数量；若现有账本已超过 gross 上限，新增风险容量仍为零。

## 本地门禁结果

所有门禁均在隔离工作树本地运行，没有 GitHub Actions。

- `npm run verify`: PASS。
- `verify:deps`, `verify:scripts`, 全 workspace typecheck、全 workspace formal build: PASS。
- 全量测试：Engine 173 个文件 / 1,417 项通过；core 8 个文件 / 58 项通过；dashboard 14 个文件 / 60 项通过；contracts 配置为零测试文件并按 `--passWithNoTests` 成功。
- S00 T01–T06: PASS；重新从当前树生成入口审查 evidence，共 139 项（127 `FORBIDDEN_OR_NOT_RUN`、11 `CONDITIONAL_NOT_RUN`、1 `ALLOWED_STATIC`）。测试隔离检查为 173 个 Engine 测试文件、16 个 store-opening 测试均隔离、未发现仓库 data directory 或生产端口引用。
- storage coverage: `S08_STORAGE_COVERAGE_PASS`。
- 关键风险链定向回归：19/19；受影响的 admission/Entry 集成测试：215/215。
- `git diff --check`: PASS。

## 边界

本地测试与构建不证明运行时已加载本次源码。未部署、未启动、未停止、未重启或热加载 Engine，未写交易所，未调用 GitHub Actions。状态：`DEPLOYMENT_NOT_AUTHORIZED`、`RUNTIME_ACCEPTANCE_NOT_RUN`、`GITHUB_ACTIONS_NOT_RUN_BILLING_LIMIT`。Phase 0 的 reconciliation conflict 仍需独立解决后才能声称完整 authoritative replay 或 runtime acceptance。

对应机器可读结果见 [`local-gate-results.json`](./local-gate-results.json)，Phase 0 证据见 [`PHASE0-CURRENT-RISK-REPLAY.md`](./PHASE0-CURRENT-RISK-REPLAY.md) 与同目录 JSON/CSV 文件。
