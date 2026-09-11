# Stage 4：EIP证据质量

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

逐项独立校验EMA/MACD12-26-9/BB20-2/ATR/Swing/Volume、六周期、盘口、OI/Funding/Taker、BTC/ETH、Portfolio、Experience。EIP不得用看似专业但实际替代计算的字段。随机20个symbol与独立计算对账。测token预算、freshness和missing evidence，stale时fail closed。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。
