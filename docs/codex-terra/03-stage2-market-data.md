# Stage 2：生产行情底座

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

把MarketDataProvider生产实现升级成集中Market Data Hub。先核验Binance USDⓈ-M最新官方接口、目标代理和DNS/TLS。实现WS主流+REST bootstrap/backfill、100个候选共享连接、K线/盘口/mark/ticker/derivatives缓存、freshness/completeness、断线恢复和限频。禁止每symbol各自建立重复WS或回补。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。
