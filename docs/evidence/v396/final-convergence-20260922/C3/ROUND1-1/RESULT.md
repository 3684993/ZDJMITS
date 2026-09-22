# C3 Round 1.1 验证结果

输入 e1ed854。红测 33 项中 4 失败：既有 rearm 回归 1、新增精确 HUMAN 价格 1、真实 ManualPositionService 两条 TP 路径 2。非失败项验证无历史 revoke 重开持久性、非法价格不改价、直接漂移拒绝、FULL_REMAINING。

修复：Guardian 优先使用 HUMAN durable mandate 的原价格并校验 tick/方向/经济性；manual TP 在提交前写 HUMAN mandate，传真实 stepSize/tickSize；移除 manual TP 第二套 clientOrderId；contracts 可如实记录 HUMAN 目标来源。AI exit 未开启。

定向 33/33、Engine 全仓 962/962 PASS；contracts/core build PASS；类型检查初次发现 quote 可选字段类型不兼容，显式 Number 转换后 PASS（缺字段转换 NaN 后由 TP 边界拒绝）。S00 T01–T06 PASS，108 入口，0 blockers；diff check PASS。

全仓中的关联测试：
- c2ReservationAtomicityHostile.test.ts: 23 PASS
- reservationConvergence.test.ts: 13 PASS
- c3RuntimeWiringHostile.test.ts: 33 PASS
- s03ExitCostPolicy.test.ts: 21 PASS
- s04ExitCoordination.test.ts: 11 PASS

本结论仅覆盖 Round1.1。全绿不代表 S06–S10 已完成，也不替代后续并发/恢复审查。现网未启停、未部署、未修改 Settings/DB、未交易写入。
