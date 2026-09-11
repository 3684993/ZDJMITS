# Stage 11：24h/72h验收

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

执行24h真实行情+真实AI Shadow和72h测试网。收集候选周转、Pool利用率、决策频率、REJECT、tokens/latency、双7900利用、Maker可达率/成交时间/Reprice/TTL、TP repair、reconciliation drift、DB/log增长、crash/restart。只有硬原则自动化证据全部通过、P0/P1清零才Go。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。
