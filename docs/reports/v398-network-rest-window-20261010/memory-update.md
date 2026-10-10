
## 2026-10-10 N3 independent REST timing/weight repair — offline only

分支codex/v398-network-n3-recvwindow独立基于main3cb72de，未依赖N1 PR25。实际签名查询回归复现recvWindow恒60000：17项中10fail/7pass；修复为遵守合法配置，非法值在clock/network/write boundary前拒绝，5s默认不再被静默放宽。官方USD-M leverageBracket=1、commissionRate=20，而代码都30；weight回归2fail/4pass后仅修正两个估算，保持预算上限/并发/PRIVATE/TP reserve/响应头权威和429/418约束。451/429/418/502/503 unknown/SOCKS8000ms均为内存mock单次POST失败，无真实交易所/数据库操作、无盲重试/出口fallback。

最终本分支npm ci/full verify PASS253files/2180tests，专项4files/54tests，S00/VPN回环PASS；精确PR CI待独立核验。原失败、timing-only完整pass与最后完整日志全部保留。报告docs/reports/v398-network-rest-window-20261010/REST_TIMING_REPORT.md。原24h已08:34因TP gate中止，未恢复或重启，N1样本17/17是本地缓存而非新签名证明；现网/代理/授权/TP保护及禁补仓全不变。N2实际降噪/真实负载A/B及余下N3 ACK/depth/private-event/socket共享仍待下一独立阶段，不能宣称整个网络优化完成。