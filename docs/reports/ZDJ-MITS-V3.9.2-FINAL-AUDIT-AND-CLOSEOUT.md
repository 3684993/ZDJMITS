# ZDJ-MITS V3.9.2 收尾实施报告（2026-09-11）

状态：CONTINUE-OBSERVING。工程修复已验证并加载；新构建自然2h尚未完成，收益质量PENDING，Production Canary未授权。旧报告中“无软件根因”和“collector已开始正式120分钟”的结论不再适用。

## 本轮结果

|项目|证据及结论|
|---|---|
|运行身份|PID19536 / instance003cd90c-a833-4ba1-bac8-d14bc84a6ed9 / build3.9.2-f63f52dd4b5c141a5b66。启动阶段Private READY、WS LIVE；Engine READY须以末尾检查点为准|
|长期不建仓|旧实例曾连续1081次私有同步失败；本轮初读已恢复。另有NO_DIRECTION_EDGE、SHORT容量不足和总敞口限制；不删除风险门或提高PLACE倾向|
|闭合数据根因|旧WS只订阅1m且仅1m hydrate；5m/15m依赖REST，封禁期间停更。这是已复现的软件依赖缺陷；触发IP封禁的全部请求来源尚未证明|
|市场修复|同一WS补5m/15m，周期缓存隔离；REST历史与WS闭合事实合并、防乱序及闭合降级；闭合数据充足时复用WS，减少REST回补；按周期解除技术阻断|
|限流提醒|保留退避与快速失败，新增418/429计数、最近限流、解禁时间和驾驶舱提示；同分钟weight不被较旧响应下调。无网络绕禁|
|用户止盈|原0.45%价格幅度、0.01 USD/0.15%净收益门已有UI。新增可选STRUCTURE_15M，取闭合15m已观测摆动高低点，支持提前缓冲与最小/最大距离。不是预测保证；无有效结构回退固定目标；原费用门继续生效|
|止盈生效范围|当前默认仍PRICE_MOVE_PERCENT，未擅自提高收益/风险偏好。用户保存结构模式后新建TP使用；已有有效TP不撤改。更远目标可能等待更久或无法成交|
|验证|npm run verify PASS：Core42、Dashboard15、Engine299；另collector轨迹测试PASS。覆盖多周期REST故障推进、乱序、双向结构/过期/超界回退等|
|备份|data/backups/v392-profit-market-2026-09-10T22-27-58-762Z；SQLite online backup完成且quick_check=ok，包含config/旧身份/日志。未覆盖或删除真实DB|
|意外退出|部署前旧PID22980已消失、HTTP拒绝连接；本轮未执行停止命令，stderr无明确原因。UNKNOWN，不把此前运行认定为连续24h通过|
|新采样|collector PID11936；data/reports/v392-natural-acceptance-20260911-063121。连续60秒健康后开始完整120分钟；PRE_READY排除，后续DEGRADED保留。逐symbol保留actual/expected close、quote/book、健康、REST、entry原始证据|
|gap统计|按采样转换生成duration/P50/P95/max，标明30秒采样精度；离池及窗口末未恢复标为censored。不能冒充交易所事件级精确恢复耗时|

## 验收界限

旧20:14窗口的1m/5m/15m严格新鲜率68.23%/69.82%/84.32%，277次Primary、35 PLACE→26 Intent→21 Order→15远端ID→8首Fill→7完整Fill，仅属旧build证据。新build自然分布和漏斗须独立计算，不能合并宣称PASS。

本轮初读旧build的归档包含212 NO_DIRECTION_EDGE、11 LONG、3 SHORT、1未完成；后续还观察到DIRECTION_CAPACITY_UNAVAILABLE及GROSS_EXPOSURE_LIMIT。无同版本稳定必拒的充分证据，不实施P1-A/P1-B。

实际新build Fill不足且历史部分平仓记录缺出场/费用，提前退出概率、收益提升及1/5/15分钟MAE/MFE均PENDING。不得用金额小推断应放宽建仓或扩大杠杆。TP/交易归因/UNKNOWN占用/完整自然安全不以隔离测试替代。

执行计划：docs/plans/ZDJ-MITS-V3.9.2-Profit-And-Market-Final-Implementation-Plan.md。只读原始检查：data/reports/v392-profit-market-health.json、closeout.json、pipeline.json；测试日志：data/reports/v392-profit-market-verify.log。

Binance将429/418定义为限流/封禁，本轮保留退避；恢复不等于根因已全部消除。参见[官方说明](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info)。

后续仅重算当前build自然窗口并裁决；未通过不关闭工程自然验收，24h仅后续soak，不再扩策略/架构。

## 加载后确认（北京时间06:37:14）

Engine READY、Private READY、WS LIVE；TP6/6、missing0，reconciliation drift/unresolved0/0，Production writes0。新实例418/429均0、REST队列0（瞬时值不代替长期PASS）；793个WS订阅。同一symbol的1m/5m/15m实际闭合时间已与预期对齐，5m收到06:35闭合事实。当前设置仍PRICE_MOVE_PERCENT，结构选项及三个可调参数已通过真实snapshot验证加载。

证据：data/reports/v392-profit-market-loaded-evidence.json。正式2h collector继续运行；未满窗不宣称收益提升或最终验收通过。

正式窗口已于北京时间06:38:53开始，预计08:38:53结束；期间任何DEGRADED均保留。06:37:23曾出现TP修复/已校正drift瞬态，因此稳定计时重置后才进入FORMAL，不能把该瞬态隐藏为连续TP PASS。
