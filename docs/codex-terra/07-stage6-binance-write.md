# Stage 6：Binance测试网交易写Adapter

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

查最新Binance USDⓈ-M私有API后实现ExternalTradeAdapter。包括SecretProvider、签名/time sync、exchangeInfo规则、position mode、leverage、LIMIT Post-Only/GTX、query/cancel/replace、TP、positions/orders/fills/account、error taxonomy、retry/idempotency/audit。只在测试网验证，未通过不得启用生产。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。
