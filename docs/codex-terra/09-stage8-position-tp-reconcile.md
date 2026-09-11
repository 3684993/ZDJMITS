# Stage 8：持仓、TP与对账

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

把真实exchange positions/orders/fills变成可恢复事实。TP必须server-verified exists/qty/side/price；缺失自动repair且不重复。position opened立即排除候选，closed重新获得资格。模拟删除TP、断网、重启、外部人工操作并验证reconciliation收敛。扫描自动止损执行路径必须为0。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。
