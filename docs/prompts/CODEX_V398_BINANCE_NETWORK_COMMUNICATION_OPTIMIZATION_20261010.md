# Codex 执行提示：V3.9.8 Binance 网络通信优化（先审计，再离线修复）

首先阅读并以此为主任务书：
docs/plans/V398_BINANCE_NETWORK_COMMUNICATION_AUDIT_AND_OPTIMIZATION_20261010.md

再读取：docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md、docs/reports/v398-engine-cutover-20261010/DEPLOYMENT_RECEIPT.md、docs/reports/v398-engine-cutover-20261010/acceptance/state.json、docs/reports/v398-engine-cutover-20261010/NETWORK_PROXY_451_RELEASE_LESSONS_20261010.md、Issue #23；对照最新GitHub main确认已部署runtime代码版本与后续docs-only提交。不要让我再提供历史聊天或重新提问已经回答过的约束。

## 本轮实际工作

1. **N0 仅只读现场基线**：调查PID23688/build3.9.8-bb45c11、代理20091、PUBLIC/MARKET/PRIVATE WS实际接入情况；读取/api/v3/diagnostics/market-stream-traffic、binance-governance、private-sync、closeout、24h acceptance窗口（只读、有限次数、不泄露账户数据），可经授权的管理宿主读取SSH队列与转发指标。区分解码WS消息/字节和真实SSH wire bytes，不推断未取到的数字。准确标注timestamp/route/hash/实例。
2. **N1 P0协议审计+离线测试修复**：config/settings.default.json 的旧Demo WS地址、BinanceTransport的testnet/production WS resolver以及 PUBLIC/MARKET/PRIVATE私有listenKey路由，必须按2026-10-09官方更新核验：Demo REST=demo-fapi.binance.com、官方Demo WS=demo-fstream.binance.com；包括现有动态配置优先级、测试网连接有效性与禁止跨环境写入、不能误把pong当私有订单事件。不要通过出口/域名切换绕过任何451限制，区别新官方路由兼容迁移和更换受限制地理出口。
3. **N2 P0带宽分析与离线降噪**：查 BinanceMarketStream.desired() 的 !bookTicker、!ticker@arr、!markPrice@arr@1s 全市场流。通过60s窗分类型decoded WS bytes、候选数、聚合消息速率、quotes字段新鲜度、K线连贯度、Primary candidate supply+有仓位symbol来证明是否有净冗余。按需缩小广播到symbol-scoped订阅、保留持仓/挂单与fallback；缓存+单飞的REST保留，绝不能以降吞吐造成TP/行情UNKNOWN被视为READY。
4. **N3 P1健壮性**：区分partial depth与diff book连续性、subscribe pending/ACK、WS断流重连、私有用户事件去重、listenKey生命周期、REST重试/fail-closed与真实请求权重、共享budget/agent内socket reuse。ExternalTradeAdapter的recvWindow表达式要按官方timing安全合同离线验证。注入HTTP451/429/418/502/503、SOCKS 8s timeout、代理队列/backlog和重复订单回执；任何POST unknown结果先精确查身份，不能盲重下。不能削弱60s TTL、TP或禁补仓。
5. 分成独立小型 PR（优先 WS route契约 → 带宽优化 → 失败恢复/监控），每个PR有具体可复现的失败原样证据、最少安全修复、基线前后指标、focused tests、全量npm run verify、S00、CI、代码/文档hash；保留旧失败证据，缺少真实负载样本就标“待验证”。
6. 把工作结果、网络指标、实验对照、被动安全检查结论和未完成项同步 docs/reports/v398-network-optimization-20261010/ 及该计划/交接文件；任何故障先报告真实状态，不能声称“已修复451”除非已明确复现、定位并用同一路由回归验证。

## 不能违反的边界

- 当前24小时TESTNET验收T0北京时间2026-10-10 08:16:49.685，deadline 2026-10-11 08:16:49.685，状态以最新GitHub checkpoint为准。**本轮只读现场+独立工作树离线代码PR；禁止部署、停止/重启Engine PID23688、代理、GPU模型、任务/observer；禁止改live Settings、审批、私有数据库或SSH服务器配置。**
- 不运行真实下单/强制Primary和模拟交易所写入；不用最新GitHub docs提交冒充已部署新版；不触碰现有TP保护订单。若真实安全事故或用户中止验收，根据已有授权正式处理，并将此次24h标记ABORTED，修复上线后完整新计时。
- **严格禁止补仓**，Primary独立Entry、HUMAN_MANAGED以及仓位/订单保护权均保留；历史HTTP451必须保留实际原因，不能无证据归类为代理脚本BUG、更不允许跨区出口轮换、代理伪装或失败时静默直连。
- 原主机转发用户MaxSessions0不因诊断开shell；所有私人原始密钥、API secret、私有SQLite、原始交易标识不得上传GitHub；只发hash、计数、状态和时间。
- 如优化涉及授权路由迁移，先提供官方文档依据和Demo实测“仅GET/订阅”兼容结果，不能基于生产WS URL擅自改到另一个主机。任何现网发布均需用户单独指令，不作为本次Codex阶段默认步骤。

## 完成判据

交付N0 baseline报告 + 已确认/未确认风险对照、N1/N2/N3分阶段独立PR/测试证据（能力许可范围内逐步实施），明确网络流量前后对比、WS用户私有事件受支持的证据、REST权重与恢复预算对照、HTTP451/503/UNKNOWN订单测试、全量CI；不虚报部署，不改变正在进行的24h验收。若全部无法在一轮完成，先完成最优先且有证据的N0/N1并更新下一步任务锚点，不停留在无输出审计循环。

## 2026-10-10 N3 independent REST timing/weight repair — offline only

分支codex/v398-network-n3-recvwindow独立基于main3cb72de，未依赖N1 PR25。实际签名查询回归复现recvWindow恒60000：17项中10fail/7pass；修复为遵守合法配置，非法值在clock/network/write boundary前拒绝，5s默认不再被静默放宽。官方USD-M leverageBracket=1、commissionRate=20，而代码都30；weight回归2fail/4pass后仅修正两个估算，保持预算上限/并发/PRIVATE/TP reserve/响应头权威和429/418约束。451/429/418/502/503 unknown/SOCKS8000ms均为内存mock单次POST失败，无真实交易所/数据库操作、无盲重试/出口fallback。

最终本分支npm ci/full verify PASS253files/2180tests，专项4files/54tests，S00/VPN回环PASS；精确PR CI待独立核验。原失败、timing-only完整pass与最后完整日志全部保留。报告docs/reports/v398-network-rest-window-20261010/REST_TIMING_REPORT.md。原24h已08:34因TP gate中止，未恢复或重启，N1样本17/17是本地缓存而非新签名证明；现网/代理/授权/TP保护及禁补仓全不变。N2实际降噪/真实负载A/B及余下N3 ACK/depth/private-event/socket共享仍待下一独立阶段，不能宣称整个网络优化完成。