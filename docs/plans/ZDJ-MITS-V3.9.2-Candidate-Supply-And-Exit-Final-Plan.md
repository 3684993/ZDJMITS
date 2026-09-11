# V3.9.2 候选供应与退出调查/实施接续计划

2026-09-11；本轮先落盘后执行。当前2h collector独立运行，保持其build证据边界，源码修改及测试不等于自然运行PASS。

## 目标及约束

只处理候选不足、无意义建仓损耗、盈利退出归因。保留Entry freshness/风控/Maker/单Primary，不改Prompt、不强制PLACE、不写Production。结构TP仍为用户可选，未选择时不得宣称已解决提前退出。

用户提出扫描结果复用：先查当前定时全量重扫/重复取数，再以缓存、增量更新、机会/数据变化驱动补充；不把“80%成交”设为更新条件，因无信号/未成交标的可能永久锁死刷新。Core只保障批准资产进入扫描/排名，不授予Entry资格。

## 顺序与交付

1. 只读记录当前build/instance和collector状态；读取源码/API/SQLite，列出available→approved→market-quality→universe→pool→ready→Primary的数量、阈值、TOP原因、underlying和合约去重影响。缺证据UNKNOWN。
2. 对照代码定位至少三个可复现的前置损耗问题；优先核验每分钟全量回补、扫描/Entry质量混用、合约去重/持仓提前排除、刷新节拍及候选状态失真。只认已证实的问题，不凑数量。
3. 逐ID调查TP策略/价格/退出订单/真实fills，包括JUP/TAO/FET；不能凭时间相近或TradeRecord金额推断人为/策略原因。评估固定0.45%与结构模式，收益/MAE缺采样PENDING。
4. 根因证实后更新本文件：每项证据→根因→最小修改→测试→PASS→回滚；实施最小修复并运行targeted tests/verify。保留旧collector原始数据，不混合build。
5. 合并完整自然窗口（若已结束）与候选/收益调查，更新集中MD/JSON。若未满窗，报告已实施与自然PENDING分别标记；不因等待增加功能。

## 当前进度

- PLAN_WRITTEN。首次源码证据：UniverseView固定显示“Top N”配置；appRuntime每60秒在snapshots少于marketSymbolLimit时再次market.refresh全量，另有15分钟全量和10秒recoverStale。实际损耗待API/代码进一步确认。
- 下一步：universeCoordinator、Market Quality/Ranking/Pool实现与实时分层数量；TradeRecord及exit关联调查。
