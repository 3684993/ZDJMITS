# V3 基础包实现状态

## 已完整实现（Mock / 本地可运行语义）

- 系统设置 schema 与持久化 JSON；
- 五种智能选币模式；
- 默认综合主流流动性偏置；
- Universe Top N、Eligibility、六维评分；
- Dynamic Pool Target/Max、补池、池尾替换；
- 1m/5m/15m/4h/1d/1w 技术指标；
- MACD 12/26/9、EMA、BB、ATR、Swing、Volume Z；
- EIP 3.0；
- BTC/ETH Global Regime；
- Portfolio / Experience 证据；
- B580 Scout 角色；
- 双 7900 PRIMARY_BRAIN 调度与选择性复核；
- OpenAI-compatible model client；
- mock AI client；
- read-only evidence request 机制；
- PLACE_LONG / PLACE_SHORT / REJECT_CANDIDATE；
- AI ideal price / acceptable band / 1–5m horizon；
- Entry Manager Maker 定价；
- stepSize/minQty/minNotional 基础数量规则；
- Pending Entry、Reprice、Range invalidation、60m TTL；
- Mock Exchange fill；
- Position lifecycle；
- TP Guardian；
- Trade Outcome / Experience；
- Reconciliation drift skeleton；
- REST `/api/v3`；
- WebSocket `/ws`；
- Vue Finance Dashboard 9 页面；
- 全量系统设置 UI；
- Windows install/start/verify scripts。

## 已有接口/基础适配，但生产必须继续完成

1. `ExternalTradeAdapter`：真实交易所写实现；
2. `BinancePublicMarketDataProvider`：可做公共 REST 功能验证，生产需换集中 WS Hub；
3. Reconciliation：接真实交易所持仓/订单/fill事实；
4. 数据库：基础包使用运行内存 + settings JSON，生产需持久化；
5. Secret Provider：生产密钥管理；
6. AI 模型服务：需要对8081/8082/8083真实端点完成协议和性能验收；
7. 生产审计命令、idempotency、持仓模式与交易所错误分类；
8. 生产 TP 参数、资金分配、币种规则缓存的最终校准。

任何生产阶段都不得绕过 V3 contracts、状态机和 Entry Intent -> Entry Manager 的权限边界。
