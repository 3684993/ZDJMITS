## 2026-10-10 网络 N0/N1 离线交付（未部署）

独立分支 codex/v398-network-n1，基线main3cb72de。已完整读取网络任务书/方案及Issue23；N0两组60s窗口证明全市场BBO/mark/ticker类别占decoded载荷79.49%/79.89%，不是节省率或SSH wire字节；SSH积压及私有typed-event现场证明UNKNOWN。N1更新官方Demo默认及PUBLIC/MARKET/PRIVATE显式路由，跨环境/非官方/携密钥配置fail-closed，旧主机必须显式迁移而非451后静默切换；pong与账户订单事件指标分离。原代理两次15s Demo只读订阅各有bookTicker24/markPrice13事件，私有Demo真实兼容仍待正规授权验证。

本轮 npm ci/full npm run verify PASS252files/2180tests，focused74；S00首次因默认值身份变化停止已保留，更新当前hash后PASS，历史快照未改。N2量化/设计及N3故障预算风险与recvWindow恒60000缺陷已记录，下一独立PR按保护保留集/ACK及REST签名mock展开，不能宣称所有优化结束或451根因修复。详见 docs/reports/v398-network-optimization-20261010/NETWORK_BASELINE.md / VALIDATION.json。

重要现场纠正：原24h已于08:34:00.270+08 LOCAL_TP_GATE_NOT_CLOSED中止，local14/15；08:41:50 local15/16，08:43:55 local17/17恢复、private9.129s、Production0。恢复缓存不能恢复验收或替代签名TP。原PID23688/buildbb45保护运行，Engine/代理/模型/observer/任务/授权/Settings/数据库/SSH配置均未改。Issue22已同步中止。禁止补仓、UNKNOWN/60sTTL/Primary及TP均保留；Issue23真实订单origin归因仍未在网络任务完成。全部部署须新指令及正规准入，新验收完整重计。

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
