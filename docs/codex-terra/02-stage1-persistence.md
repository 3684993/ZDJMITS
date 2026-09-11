# Stage 1：持久化与审计

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

在不改变领域状态机的前提下引入生产级持久化。先调查Node版本和现有依赖，选择可靠SQLite实现。orders/positions/TP/AI runs/EIP metadata/intents/outcomes/settings/audit必须事务化；WAL/完整性检查/备份恢复必须有测试。运行Map只能做缓存，不能成为重启后的唯一事实。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。
