# V3.9.8 交易记录完整性专项实施交付

SOURCE_IMPLEMENTED / NOT_DEPLOYED / NO_LIVE_MIGRATION。版本保持3.9.8。本报告记录离线结果；当前现场运行接受不成立。2026-10-09 07:38+08 completion GET全部UNAVAILABLE，PID8524已不在进程清单、8080未发现监听，停止原因UNKNOWN。本任务没有任何部署、启动、停止、重启、Settings或账户写入；不依旧报告宣布实例仍运行。

## 先证据与计划、后源码

从最新main `855362ecd42acb820dc88807b09575a4becf605c` 建立隔离worktree；该基线Actions SUCCESS。用户指定37853581957/head5fe95a8的SUCCESS亦通过API复核。Phase B报告/计划先提交757a5c1，因忽略的14个log导致首次remote readback失败，完整失败收据保留。补归档后的 `c7cf6b82bbdf29c86fc97634f37be0a8f86cde92` 于2026-10-08T23:11:20Z独立fetch/52个blob SHA256全部通过，随后才开始业务源码修改。REMOTE_B.json保存通过收据，REMOTE_B_FIRST_FAILURE.json保存失败。Phase B Actions37858001179在S00 identity/isolation失败，jobs API已证明步骤，原始job日志请求HTTPError，不能推测未取得的日志内容；Phase C机械更新entrypoint inventory而不放宽门禁。

事实报告和文件级计划分别为FACT_AUDIT_REPORT.md与docs/plans/V398_TRADE_RECORD_INTEGRITY_IMPLEMENTATION_PLAN_20261009.md；本实施遵守先行范围，无live数据迁移。

## 经证实的问题与最小修改

1. Sync当前wire识别：原legacy regex未识别v396e/v396x。新增当前prefix兼容仅在唯一持久订单、symbol、positionSide、双订单身份及唯一cycle owner一致时成立；无owner、错side/quote、CID或exchangeOrderId冲突、多持久订单都保持external。相同精确规则同时用于preview与offline apply的source/classification；当前TP角色需exact持久TP订单，避免仍标EXTERNAL/MANUAL。原legacy行为、canonical/funding/owner/finalizer资格保留，canonical:true记录标记不等于canonicalPnlEligible，UNKNOWN funding继续拒绝收益学习。
2. 交易记录默认ALL；保留原分类、分页/排序/search/symbol/side，新增status筛选。页面分别显示账本状态、观察零仓待对账、原累计Entry与lot数量差异、资产单位、极值UNKNOWN。没有自动同步POST。read model附加diagnostics，不修改原record/status/classification/金额；缺数量不补零，观察时间不伪装为成交结算时间。
3. EIP与实际Primary compact INPUT附加CURRENT_POSITION_CONTEXT，最多8条同symbol两方向事实；严格schema保留可选字段，范围/来源/as-of/freshness/owner/cycle明确。精确当前cycle/side的留存ENTRY成交与原openedAt一致才提供PARTIAL起点及年龄；缺失、过期、未来、错cycle/side/quantity为UNKNOWN/null。部分追加、HUMAN与最近updatedAt不重置origin。完整生命周期证明仍不足，不称verified earliest history。
4. Prompt说明持仓事实不代替方向判断；同向独立补仓继续在pre-AI冻结候选前拦截，反向不会仅因另一侧库存被拒绝，Primary仍唯一选择合法冻结候选。compact输入保留entryAuthorizationPolicy。旧packet缺上下文时呈现UNKNOWN，不等于无仓位；没有新增AI调用或Review veto。

反向完整调用链源码：entryPermissionModel.ts:89–93在TESTNET_FUNDS_ONLY下不会因held进行symbol级SKIP；entryCoordinator.ts:260–266的primaryOccupancyBlock在该模式返回null；preAiExecutionEnvelope先按side的no-add事实生成合法候选；Primary输入及strict packet的实际渲染由primaryPositionContext.test.ts验证；entryCoordinator.ts:276及:430在执行与最终提交前再次按side校验no-add。资金、模式、订单合法性和冻结菜单继续生效。真实TESTNET hedge mode已证实；实际新反向交易/模型理解/跨重启自然接受仍UNKNOWN，未制造订单。

## 固定真实证据回放与历史限制

固定sanitized证据preview：system fills **268→301**、external **49→16**、repairable PARTIAL cycles **0→3**；没有调用真实apply，原TradeRecord字节投影未变。3个可修复预览全部为其他AVAX LONG周期。9/20原SHORT与另一个9/28 SHORT仍UNCLOSABLE：分别119条留存entry/1条exit与17条entry/0条exit，原物理连续仓位拆分的本地cycle及保留期缺口没有自动合并。离线合成小样本apply只用临时测试state验证数量守恒、幂等、funding UNKNOWN，不写live SQLite。

AVAX当前native无仓位/无open orders；18个独立Entry/17次独立追加，累计1263与TP退出1263守恒。退出订单540405465、trade67893172在2026-10-08 **23:12:42.824+08**成交，真实reduceOnly BUY/SHORT、exact持久TP来源；不是本地boot观察到零仓的07:28时间。最初9/20历史仍在PARTIAL账本而默认COMPLETE隐藏。10/5当日结束已有14orders/13adds，与随后18/17、lifecycle addCount25数量变化口径不同；用户原始统计时刻仍UNKNOWN。timeline CSV保留逐订单时间及数量。

全记录固定分母768：242 lotQty不等entryQty、51负remaining、并集285；这些是原记录差异，未批量写回。新增native-fee-asset-diagnostics.json证明本次768条原feeBreakdown中quote不一致0，不证明全局外汇折算或全生命周期资金费齐全。763 funding UNKNOWN继续不能补零或获得canonical/学习资格。

历史1000+浮亏是用户观察，精确峰值、最差时刻与当时动态库存/成本路径UNKNOWN；价格retention不覆盖9/20起完整周期，也无同步inventory轨迹。新增pnlExtrema全为UNKNOWN/null及覆盖原因，不用decision MAE/MFE、今日数量或插值冒充生命周期PNL。持续采集、历史迁移、永久归档方案与live修复apply继续IMPLEMENTATION_BLOCKED/需另行证据及授权。

## 验证

完整 `npm run verify` PASS，最终源码UTC23:43:04–23:45:12：deps/scripts/release/S00/typecheck/build/workspace tests；**244文件 / 2086测试**（contracts1/2、core8/59、dashboard25/126、engine210/1899）。targeted实际UI/jsdom、Express GET只读、strict EIP/actual Primary INPUT、current wire identity/collision/side/quote/幂等、UNKNOWN/future/stale/partial/HUMAN与反向候选测试通过。合成Express fixture的SQLite total_changes和state保持零变更，不等于live历史接受。

所有失败保留：主机commit内存不足/native OOM、384MB V8 heap OOM；继承proxy环境与jitless Undici冲突；初次targeted cwd错误；两个typecheck泛型/fixture错误；两次完整验证因原prompt预算31000超界失败。收紧上下文文字后通过，未扩大预算。离线子进程暂用NODE_USE_ENV_PROXY=0及1024MB heap，仅本次命令环境；没有修改全局代理、运行实例环境/Settings/模型。正常编译最终成功。full-verify-first/second/third以及最终成功日志与结果全部保留。第一次PASS归档为full-verify-first-pass；交付审阅发现preview/apply源分类和当前TP标签需统一，在f6b8243之后补齐并加固现有10项identity测试断言，重新完整verify，不把前一次PASS冒充最终源码验证。

noSeparateAdd、origin ledger、EntryCoordinator、PositionService、PositionReviewRunner、Settings默认与TP Guardian共7个受保护文件与855362e一致。SOURCE_DELIVERED与现场部署、数据迁移独立；本轮均未授权后两者。

## 现场边界复核与交付收据

Phase A于23:00Z实际READY/PID8524；completion23:38Z八个GET失败，原PID已不存在且无8080监听，原因UNKNOWN。Settings250→253/digest变化，settings_audit显示CAS更新、summary结构message/maxPositions；执行者及停止原因不据此推定。runtime-preservation.json保留差异，不声称Settings或当前health不变。首次preservation脚本strip误去dirty行前空格，造成假差异；first收据保留，修正后canonical六项dirty和HEAD确实一致。运行源码worktree HEAD仍5fe95a8，本轮未修改其源码/dist或生命周期，live DB允许其他实际actor/Engine自身变动，不宣称全库字节冻结。

全部本轮必要JSON/CSV/脱敏gzip/log/源码/测试/计划与SHA256 manifest上传GitHub。MANIFEST排除自引用REMOTE收据；REMOTE_C及最终verify-only核对所有列出blob。代码commit/Actions与最终FF/equality在交付收据中记录；未获得的证据不补造。旧私有backup仍保留，没有重试删除。

最终业务源码 `feef65926f521af7b69e4d84308a828b2b09a08c`，Actions **37861262495 SUCCESS**（2026-10-08T23:54:59Z完成，run/head/jobs逐项API复核，github-source-final.json）；其212个远端blob SHA256通过。首次源码f6b8243的CI被后继提交的既有concurrency取消，未冒充SUCCESS。最终收据提交仅文档/JSON/log/manifest，不改apps/packages/package.json或脚本；最终main CI由GitHub自动触发并按实际final SHA另行只读核对，避免自引用收据无限追加提交。23:56:37Z再次8个GET全部UNAVAILABLE，不能宣称现场已恢复。最终部署、Engine lifecycle、真实账户/历史写仍0。
