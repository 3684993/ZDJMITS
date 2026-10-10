## 2026-10-10 网络 N0/N1 离线交付（未部署）

独立分支 codex/v398-network-n1，基线main3cb72de。已完整读取网络任务书/方案及Issue23；N0两组60s窗口证明全市场BBO/mark/ticker类别占decoded载荷79.49%/79.89%，不是节省率或SSH wire字节；SSH积压及私有typed-event现场证明UNKNOWN。N1更新官方Demo默认及PUBLIC/MARKET/PRIVATE显式路由，跨环境/非官方/携密钥配置fail-closed，旧主机必须显式迁移而非451后静默切换；pong与账户订单事件指标分离。原代理两次15s Demo只读订阅各有bookTicker24/markPrice13事件，私有Demo真实兼容仍待正规授权验证。

本轮 npm ci/full npm run verify PASS252files/2180tests，focused74；S00首次因默认值身份变化停止已保留，更新当前hash后PASS，历史快照未改。N2量化/设计及N3故障预算风险与recvWindow恒60000缺陷已记录，下一独立PR按保护保留集/ACK及REST签名mock展开，不能宣称所有优化结束或451根因修复。详见 docs/reports/v398-network-optimization-20261010/NETWORK_BASELINE.md / VALIDATION.json。

重要现场纠正：原24h已于08:34:00.270+08 LOCAL_TP_GATE_NOT_CLOSED中止，local14/15；08:41:50 local15/16，08:43:55 local17/17恢复、private9.129s、Production0。恢复缓存不能恢复验收或替代签名TP。原PID23688/buildbb45保护运行，Engine/代理/模型/observer/任务/授权/Settings/数据库/SSH配置均未改。Issue22已同步中止。禁止补仓、UNKNOWN/60sTTL/Primary及TP均保留；Issue23真实订单origin归因仍未在网络任务完成。全部部署须新指令及正规准入，新验收完整重计。
