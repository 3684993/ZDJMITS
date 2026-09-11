# Stage 5：三GPU真实AI

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

连接8081 B580 9B、8082/8083两块7900 27B。先实测OpenAI-compatible协议、模型名、JSON、context和超时。实现健康、队列、least-loaded dispatch、并行不同symbol、selective review、malformed output fail closed、tokens/latency/tok-s。真实trace必须证明9B无建仓授权且27B是Final Authority。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。
