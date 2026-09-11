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

- 已从 `D:\MITS\docs\plans\ZDJ-MITS-V3.9.2-Candidate-Supply-And-Exit-Final-Plan.md` 同步唯一检查点：A/B/C 已通过，D/E/F/P1/P2 在隔离验证中已实现但在提交前 Astra 审计发现十项需修正缺陷。
- 本轮只按该审计的 D → E → F → P1 → P2 顺序修复：retention/epoch/freshness，cohort bootstrap/backoff/rotation，Preflight，真实 TechnicalCard readiness，reconciliation/TP guard/loss handoff。不得启动真实 Engine 或写入真实交易所。
- 本文件仅作隔离工作区的同一计划镜像；不覆盖既有 A→P2 源码和根工作区用户未提交内容。

## GitHub 静态修复检查点（2026-09-12）

分支：`fix/v392-astra-final-fixes`。基线 WIP：`9532101eb09269fa28083bdd588f1f9e879505d1`。

已经从源码静态收敛的 Astra 缺口：

- Cohort 首次 bootstrap 不再依赖 executableCandidateCount；资本/容量/全局风险阻断与供应不足分离；消费成员退休、低频 stale rotation、no-new-result/partial hydrate backoff 已进入同一库存控制器。
- Cheap discovery 与 WS retention 已拆分；Provider 的 discovery 不再隐式启动或扩大订阅，`setLiveSymbols()` 成为 retained WS 集合的唯一入口。
- snapshot flight 以 `symbol + ownership epoch` 隔离；evict/rejoin 后旧生命周期请求不能作为新 lifecycle flight 复用。
- retained symbols 的 slow fields 使用独立刷新链；1h/4h/1d/1w、derivatives 与规则 freshness 已有单独事实路径，未恢复固定周期 full hydrate。
- stale derivatives 在 selection 与 Primary EIP 前降级/清空，不再作为当前有效衍生事实使用。
- reconciliation 已保留/恢复 `profitTakePlan`、`profitTakePlanSource` 与 `lossHandoff`，并绑定实际 system entry/position cycle。
- TP 选择链保持 `AI -> STRUCTURE_15M -> FIXED_PROFITABLE`；AI/结构目标不通过“抬价追成盈利”修补，合法 WORKING TP 不追价。
- loss handoff 只消费唯一连续 closed 15m bar；重复、倒序、缺口和开仓前 bar 不推算持续亏损。
- P1 readiness 已改用真实 TechnicalCard 的闭合 15m 字段，仅影响公平队列内排序，不新增 PLACE gate。

仍需本地 Codex 完成/验证：

1. `PreflightFeasibility` 仍需按当前余额、有效 reservations、risk headroom、capitalVersion/current fact consistency 做最终源码复核；不得削弱 AI 后 allocation/reservation 和 submit/retry guard。
2. 在 `D:\MITS-v392-isolated` 拉取本分支后执行 targeted tests、workspace tests、`npm run typecheck`、`npm run verify`；GitHub 静态修改不得写成测试 PASS。
3. 恢复/保留根工作区完整 canonical 计划正文后再形成最终交付 commit；本分支当前文档只是接续镜像，不能用它覆盖根工作区完整方案。
4. Production public 实网研究、真实历史 replay、真实 WS/REST retention 观察和 Testnet 自然验收继续 PENDING，必须单独授权且不得由本静态修复补证据。
