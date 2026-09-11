# Stage 9：Dashboard生产化

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

让Vue 9页全部由真实/api/v3和WS驱动。补projection与脱敏的AI Run输入输出；EIP、GPU、TTL/reachability、TP、Experience一致。设置保存必须server round-trip。WS断线显式degraded且REST恢复。保持金融SaaS视觉，不把业务规则复制到前端。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。
