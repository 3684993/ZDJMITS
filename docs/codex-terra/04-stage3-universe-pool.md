# Stage 3：真实智能选币与交易池

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

用真实行情验证五种Selection Mode、Top100、Eligibility、六维percentile评分、综合模式Liquidity=35%偏置、Pool Target/Max、selectionGeneration、事件补池和池尾替换。任何持仓或活动Entry交易对不得出现在Pool。设置切换要有可解释排名变化和自动化测试。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。
