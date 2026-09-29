# V3.9.7 核心交易质量审计补充指令

本文件与 `docs/prompts/v397-core-trading-quality-final-audit-20260929.md` 一起执行；若两者有冲突，以本文件为准。

## 1. 先审计并收尾上一轮 IMPLEMENTATION_RESULT

完整审计：

`docs/reports/v396-trading-loop-full-implementation-20260929/IMPLEMENTATION_RESULT.md`

不要把报告中的“已完成”直接当事实。用当前 `main`、当前 schema/migrations、tests、Settings、SQLite 和当前 TESTNET runtime/readback 逐项验真上一轮 P1–P7。

重点确认：Exit convergence、positionCycle/lot/Closed Trade、submission identity、Entry permission/capacity、TP provenance/economics、funding/FX/depth/Review facts、holding duration/execution truth 是否仍真实成立。

报告中列出的已知限制也必须逐项重新分类：

- 属于上一轮未完成/回归的工程问题；
- 属于历史事实无法安全恢复；
- 属于明确策略开关；
- 属于本轮核心交易质量问题；
- 或仅为观察项。

凡属于上一轮 P1–P7 范围内且当前仍未完成、已回归、接线错误、migration/schema/readback 不完整、测试与真实运行不一致的问题，由你自行找根因并补齐，不要逐项向用户请求继续授权。

## 2. 合并上一轮遗留分支

枚举仓库当前相关 `codex/*`、trading-quality 等分支，比较 ancestry/diff。

至少检查当前已存在的相关历史分支，例如：

- `codex/trade-record-cycle-accounting-final`
- `codex/v396-entry-frequency-risk-audit-20260927`
- `codex/v396-final-convergence-20260922`
- `codex/v396-design-completion-20260921`
- `codex/v396-astra-handoff-20260922`

不要机械合并所有旧分支。确认某分支属于上一轮且含有 `main` 尚未包含、仍然有效的提交后，再合并或择取；已被 `main` 吸收或已经过时的，在最终报告说明原因。

## 3. TESTNET stop/start/restart 授权更新

此前任何“本轮禁止重启 Engine”“每次重启都需要用户再次批准”的约束，在本轮和本轮生成的后续实施计划中取消。

本轮允许根据工程验证需要 stop/start/restart 当前 **TESTNET** Engine，不需要逐次征求用户确认。可以为 migration、build、runtime identity、自然链路验证多次重启。

最终必须让当前 TESTNET 系统运行在本轮最新、已经 commit + push 的代码上，并重新完成 source/artifact/runtime identity closure 与 readback 验证。

仍然禁止任何 Production 写入；不得把 Production credentials/transport/data path 用于 TESTNET；无法证明的数据保持 UNKNOWN，不得通过删历史数据制造通过结果。

## 4. 上一轮收尾验证

完成必要的上一轮补丁与分支收尾后，执行：

- targeted tests；
- full tests；
- typecheck；
- build；
- `npm run verify`；
- S00；
- storage；
- diff check；
- commit + push `main`；
- restart TESTNET；
- identity/readback 验证。

如果重启后发现新的部署级缺陷，继续修复并再次验证，直到上一轮 P1–P7 范围真正闭合。

## 5. 再执行原提示词中的核心交易质量审计

上一轮收尾并加载最新 TESTNET build 后，再执行原提示词中的四个核心问题审计：

1. 建仓数量/建仓总价值是否不科学，尤其大量约 5 USDT notional；
2. 所谓最低 200 USDT 交易设置是否真实存在、定义是什么、为何没有反映到最终订单；
3. 止盈收益为何低、平仓率为何低、持仓为何过久；
4. AI 入场 LONG/SHORT 方向质量是否低，或模型决策是否被执行链改变。

本阶段先审计、验真、找根因、形成解决方案与实施计划，不要把未经审计证明的新 sizing/TP/方向策略直接上线。

风险问题不要再加码。除非既有 Gross/Direction/Cluster/slot/Human cap 等机制被证明正在偷偷改变 qty/notional/direction，否则不要把新增风险门禁作为本轮解决方向。

## 6. 本轮必须形成解决方案和实施计划

最终必须提交：

`docs/reports/v397-core-trading-quality-final-audit-20260929/ROOT_CAUSE_REPORT.md`

以及：

`docs/reports/v397-core-trading-quality-final-audit-20260929/SOLUTION_AND_IMPLEMENTATION_PLAN.md`

`ROOT_CAUSE_REPORT.md` 至少包含：

- 上一轮 `IMPLEMENTATION_RESULT.md` 的逐项完成度审计；
- 自动补完了哪些上一轮问题；
- 合并了哪些分支、哪些未合并以及原因；
- 最终 TESTNET restart/build/identity/readback；
- 约 5 USDT sizing 是否成立及根因；
- 200 USDT 设置的真实定义与执行状态；
- AI sizing → final order 的决策保真；
- TP 低收益根因；
- 平仓率/持仓时间根因；
- AI LONG/SHORT 方向质量结论；
- 用户假设中哪些被证实、证伪或证据不足。

`SOLUTION_AND_IMPLEMENTATION_PLAN.md` 必须由你根据审计证据独立形成，并覆盖：

- 建仓数量/notional/capital allocation；
- 最低交易金额的权威契约；
- AI sizing 决策保真；
- TP 经济性；
- 平仓率与持仓生命周期；
- AI 入场方向质量；
- 必要的数据模型/API/Dashboard/observability；
- migration/historical compatibility；
- tests/build/TESTNET runtime validation；
- 一次性完整实施顺序；
- Definition of Done；
- 回退与证据保全。

实施计划必须明确：后续实施模型可按需要随时 stop/start/restart 当前 TESTNET 系统，不需要逐次申请重启授权；仍然禁止 Production 写入。

全部完成后 commit + push `main`，一次性汇报最终 SHA、上一轮收尾结果、本轮四个核心根因和两份报告路径。
