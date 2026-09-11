# Stage 10：故障、安全与可观测性

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

建立fail-closed矩阵，覆盖GPU offline/timeout、JSON错误、行情stale、Binance限频、代理DNS/TLS、DB/disk、WS断线、进程重启。完成structured logs、metrics、health/readiness、密钥脱敏、日志轮转、备份、进程守护。故障注入必须证明不会在事实不确定时新建Entry。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。
