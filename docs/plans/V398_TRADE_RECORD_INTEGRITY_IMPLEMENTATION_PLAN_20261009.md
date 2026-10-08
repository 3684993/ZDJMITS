# V3.9.8 交易记录完整性实施计划

Phase C执行状态（先行计划不回溯改写）：Phase B c7cf6b8/52blob门禁后按下述范围离线完成，完整verify244files/2086tests PASS。实施报告记录具体差异与UNKNOWN；线上迁移、采集器、部署与生命周期仍未执行。当前health不再READY，不依据原现场快照宣称运行。GitHub收据见同目录evidence/REMOTE_C.json与交付记录。

本计划由855362e源码及真实Phase A证据决定。事实报告：docs/reports/v398-trade-record-integrity-20261009/FACT_AUDIT_REPORT.md。必须先GitHub commit/push、独立fetch/HEAD及manifest逐blob核验，再修改下面业务源码。

## 可实施的最小范围

1. tradeRecordSyncService.ts：兼容当前v396e/v396x身份，**仅当exact持久订单、symbol、side、clientOrderId、exchangeOrderId及唯一cycle owner一致**才列system。仅扩正则不够；未知或矛盾仍external/unclosable，原legacy路径不改变。复用当前exactCycleRecord，保留账户/环境既有隔离、资金费与canonical所有门禁。固定真实证据只调用preview，不调用apply；合法模拟小样本可隔离apply验证守恒/idempotency，不连真实DB。
2. tradeRecordReadModel.ts及独立纯diagnostics helper：新增只读生命周期/数量诊断，包括recordedOpenedAt、retained earliest entry fill、observed closure与exact结算区别、lotQty/entryQty/exitQty/remaining差异、quote asset。历史极值明确UNKNOWN/null/覆盖原因，不映射decision MFE/MAE为持仓PNL。原record/status/classification/金额/P0资格不修改，错配side/cycle不得借用另一个生命周期。
3. router.ts/TradeRecordsView.vue及纯filter helper：新增ALL分类作为默认，保留全部既有tabs、分页、sort/search/symbol/direction/outcome与新status筛选；默认显示历史诊断而非掩埋PARTIAL。列表/详情明确账本状态、观察到零仓但待对账、原始时间与数量不一致、极值UNKNOWN和资产单位。观察关闭时间不作为真实平仓成交时间。前端不自动POST同步。
4. EipService、纯existingPositionContext helper、compactEntry.ts：追加有界CURRENT_POSITION_CONTEXT（最多8条同symbol、两方向都呈现），as-of/source/freshness、side/cycle/owner/qty/time来源。精确同cycle/side、正数量、执行时间合法的ENTRY填单与原openedAt匹配才提供有证据的起点/年龄，资格标PARTIAL/UNKNOWN，不冒充连续历史验证；unknown/stale/future/conflict年龄为null。呈现no-add policy元数据。prompt说明事实不是方向信号：同向仍不可独立增加，反向仍须真实合法候选及Primary授权；不额外调用AI、不修改过滤/冻结时机/no-add ledger。

## 明确不实施/阻塞范围

不修改live数据库、fills/order/cycle历史、owner或TP；不运行修复apply/账户写/部署/停止/重启。AVAX旧288/1074/1263与退出欠账保留，报告证明轨迹和缺口，源码交付不意味着旧历史已迁移。完整1000+峰值/连续PNL采集/永久raw档案NEEDS_EVIDENCE；不新增任意采集器/表，不补零。formal风险倍率、F04/F10/F11、Reactivity、模型/Settings均不改。

## 验证与接受条件

基线固定AVAX preview268 system/49 external/0 repairable，本轮变更后量化精确身份匹配的增量；若仍有原始cycle/lot缺口要报告，不必须达到COMPLETE。source state与真实gzip证据hash不变。测试当前身份已知/未知/错side/不同quote/冲突client/exchangeIDs/重放、partial fills/TP+manual及canonical UNKNOWN。读模型和页面验证ALL/category/status/page、HUMAN与归档、两个方向、观察关闭与结算区分、未知费用/extrema、quantity anomalies。AI测试含真实UNI固定事实及纯synthetic同向拒绝/反向候选允许、partial/add不重置origin、flat-reopen不同cycle、UNKNOWN ACK、HUMAN、stale/invalid/future；实际prompt事实可解析，不声明模型已理解。

运行targeted，再完整npm run verify（含deps/scripts/release/S00/typecheck/build/workspace tests），S00新工具entrypoint inventory机械更新，不放宽规则。发布代码/实施报告/全部成功失败日志，Actions读API，remote manifest核验、本地/远端相等。保持3.9.8版本（专项修正、未部署），明确SOURCE_DELIVERED / NOT_DEPLOYED / NO_LIVE_MIGRATION。后续部署或历史迁移必须独立授权与门禁，不依本计划自动执行。

## 风险、兼容与回滚

新增JSON读模型和packet字段是可选/加法；不改TradeRecord持久schema、canonical净值、旧API字段或原数据。ALL影响默认可见集，分页仍有界，旧显式category兼容。新client身份只增加已证明系统owner的记录，拒绝伪装prefix与多owner；回滚只需撤回该源码提交及页面默认值，不反向迁移数据。纯上下文不向模型传账户、密钥或私有prompt，market vs execution隔离保留。部署后自然acceptance与永久历史重建均未授权，最终保留UNKNOWN。
