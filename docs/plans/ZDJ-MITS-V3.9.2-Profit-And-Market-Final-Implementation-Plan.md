# V3.9.2 最后实施计划（2026-09-11）

## 已核实基线与范围

当前 PID 22980 / instance b3480c0c-6df3-487f-98ac-b2c2b2a46bc6 / build d464001658c1014c4d82。本轮首次读取：Engine/Private READY、WS LIVE、TP 6/6、reconciliation 0/0、Production write 0。昨夜Private曾被封禁至1789070933388，现已恢复；恢复不等于根因已消除。

TP当前为0.45%价格变化、100%覆盖，最低净收益0.01 USD/保证金ROI0.15%；这些参数已有UI，不能声称不可配置。新build后平仓记录有缺失费用/出场成交的PARTIAL样本，不能据此证明提前平仓概率或保证收益最大化。Primary当前归档212 NO_DIRECTION_EDGE、14 PLACE，不以提高PLACE比例为目标。

## 实施清单（每项均最小范围）

|优先级|现状证据 → 根因|最小修改|验证方法 / PASS|回滚|
|---|---|---|---|---|
|P0|BinanceMarketStream仅订阅kline_1m；hydrateLiveTechnical只刷新1m；5m/15m依赖REST；封禁时它们停更|同一WS补5m/15m、按周期隔离缓存、REST历史与WS闭合更新合并；坏序列不污染quote/其他周期|离线多周期/乱序/闭合/断流回归，完整verify；加载后观察5m/15m自然推进及REST压力，不能只凭WS LIVE算PASS|回退相关provider/stream文件；旧build备份|
|P0|封禁恢复不等于限流解决；现预算仅有累计状态|保留退避，暴露418/429次数、封禁时间及驾驶舱提示；不绕禁、不改网络|模拟限流、出队、解封；提示可见且不更改权限/资金门|回退告警显示和诊断字段|
|P1|固定0.45%缺少结构目标选项|新增用户可选“闭合15m支撑/阻力”TP，以已观测摆动高低点为依据、提前缓冲、最小/最大距离；无有效结构回退固定目标；保留费用净收益门。现有有效TP不自动撤改，保存后新建TP使用|LONG/SHORT、过期/缺结构、错误方向、超界/费用、已有TP不变回归；默认继续固定模式|切回PRICE_MOVE_PERCENT，无需迁移交易事实|
|P1|旧collector固定启动截止、过滤DEGRADED、错误close字段，使120分钟和恢复统计不可信|修正只读collector：连续稳定后开始完整120分钟，后续退化计入分母；保留逐symbol实际/预期close与健康原始证据、删选样禁令|短离线轨迹回放含warmup、退化、symbol离池、边界、缺样；自然满窗前PENDING|保留旧raw证据，停collector不影响Engine|

## 执行边界与接续

不改Prompt、Primary调度、P1-A/P1-B、Maker、资金/杠杆/风险、Production权限；不加模型/框架/自动止损。用户已授权必要重启：仅验证和一致性备份后加载Testnet；不触碰防火墙。结构止盈可配置但本轮不擅自选择用户资金收益偏好；默认固定策略兼容，UI写明适用范围。

顺序：计划落盘 → 市场修复/止盈配置/提醒/collector → 回归/verify → 一致性备份与加载 → 确认运行身份/TP/私有/行情 → 启动只读自然证据 → 更新最终报告。未满2h不关闭自然验收；24h仅后续soak。收益金额、提前退出概率及MAE/MFE缺真实采样保持UNKNOWN/PENDING。

状态：IMPLEMENTED / NATURAL-PENDING。

## 2026-09-11实施检查点

四项已实现。verify PASS（Core42/Dashboard15/Engine299，collector离线轨迹1测试另PASS）。Engine19536，instance003cd90c-a833-4ba1-bac8-d14bc84a6ed9，build3.9.2-f63f52dd4b5c141a5b66。SQLite online backup于data/backups/v392-profit-market-2026-09-10T22-27-58-762Z，quick_check=ok。

旧PID22980部署前已退出，未观察到明确退出原因，不能认定24h连续性PASS。已按既有授权启动新build（SkipFirewall）。结构TP已可选，默认固定模式未改、已有有效TP未撤改。

collector11936，data/reports/v392-natural-acceptance-20260911-063121；PRE_READY仅warmup，稳定60秒后完整120分钟；后续DEGRADED计入分母，按30秒轨迹统计恢复，离池不算恢复。启动阶段不得拿6/6本地TP快照冒充远端最新验证，等待完整READY及reconciliation.lastRun后判定。

06:37:14已确认：Engine/Private READY、WS LIVE、TP6/6、reconciliation0/0、Production0、新实例418/429=0。实际5m/15m闭合时间对齐，snapshot包含结构TP新配置且原固定模式不变。

剩余：仅重算自然120分钟及收益质量，不得为补样本放宽规则。最终MD/JSON已替换旧混杂报告，报告自然状态CONTINUE-OBSERVING。

06:39:23已确认collector进入FORMAL并持续写入。其余未完成项均为自然观察，不再追加策略开发。
