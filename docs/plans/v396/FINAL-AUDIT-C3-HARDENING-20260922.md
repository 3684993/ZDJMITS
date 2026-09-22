# 最终审计补充实施计划

输入 d77a62a；基于用户要求完成当前进度的审计、修复和验证。先红测再改源码；不改变 S03 权限规则，不启用 AI exit。生命周期、部署、live Settings/DB 和交易写仍不授权。

1. 同一 cycle 在不同 scope 的任务 ID 不得覆盖；clientOrderId 使用抗碰撞摘要，重试保留旧 ID；共享风险按整个 scope 汇总，包括其他周期和非 coordinator 的活动/UNKNOWN claim。
2. 在 capabilities/减仓证明异步返回后重新检查 durable owner/mandate 和证明时间；撤权不能被旧内存副本穿越；提交状态转移须单次且未过期。
3. TP 真实取消结果同步协调器；保留成交量，禁止“取消后永远占用”或无确证释放。已有 TP 的人工替换必须实际测通。
4. 拒绝 UNKNOWN→伪状态、FILLED 但不足量、错误订单身份及未来/回退事实。恢复只查询，不自动重发。
5. 用原始 d3f6d26 的 16 份计划逐阶段检查实际消费者、状态及缺口；离线缺失不能写成 NOT_RUN_EXTERNAL。全仓通过也不自动签发整体 ACCEPTED。

验证：新敌意红测与回归、C2/C3/S03/S04、Engine 全仓、contracts/core build、typecheck、S00 静态、diff check。证据写 C3/FINAL-HARDENING。整版结果另见最终验收报告及逐项矩阵。
