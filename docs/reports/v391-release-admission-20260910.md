# V3.9.x 发布复验与实盘准入报告

日期：2026-09-10（上海）。结论：Testnet 已发布并恢复运行；Production NOT_READY，不提交 Canary。

## 已完成
- 按本轮明确授权停止旧 PID 27420，使用 scripts/start-zdj-lan.ps1 手动启动 PID 27612；buildId 3.9.0-a6741fc37060b92a86c7。版本标签仍3.9.0，不能将标签当作新旧构建证据。无自启动或重启守护。
- 全量326项测试（Engine275/Core39/Dashboard12）、typecheck、Engine与Dashboard分目录构建通过；构建完成后才替换部署目录。
- SQLite通过官方online backup完成一致性备份，旧构建保留于 data-backups/v391-before-manual-deploy-20260910。
- V4资产研究覆盖129个资产，54个通过原有质量标准；Settings由v94更新v95目录，maxPositions50、风险门不变。约100是目标，不是降低质量门的理由。
- 修复TP幽灵UNKNOWN：交易所明确HTTP400/-2022拒绝未被持久化为REJECTED。新增严格分类和关键事件持久化；匹配既有合法TP不重复提交。网络超时/重复ID/单独-2013仍不得判定确定拒绝。
- 三条历史记录在Engine停止后，凭prepared→明确拒绝审计及精确订单GET证据完成本地迁移；未修改交易所订单、仓位或TP。

## 在线事实
采样时间：2026-09-09T22:17:40.058Z。
- /health READY，Private READY，WS LIVE；LAN根页和/brain HTTP200（约4ms/3ms）。这不是完整浏览器性能验收。
- Pool20/20；真实持仓24，TP24/24；drift=0，unresolved=0；五项P0全部0。
- HTTP服务统计P95约18.5ms；事件循环历史最大约2401ms，仍需持续观察。
- Hot严格闭合边界17/20：HEMIUSDT、DASHUSDT、ARBUSDC的5m/15m落后一根；全局显示FRESH不能替代Hot验收。
- 27B已有6次在线运行、该统计失败0；9B已有3次成功且失败4，不能据此宣称高质量全通过。IDLE/WAITING_NEW_FACTS符合去重原则。
- 30分钟63次Primary、58次PLACE、1次intent（窗口包含旧实例）；必须按run逐笔归因，不能单凭聚合数宣称未执行或守恒通过。

## 仍未完成及下一步
1. **软件与供给P0**：appRuntime.bootstrap仍串行等待全市场批量刷新，并可能因加载数不足再全量刷新；marketDataHub.refresh批量完成后才提交，且完整技术采集范围仍过大。先使市场水合/必要维护不受慢资产阻塞，再实现Approved轻量数据、Hot及持仓/活动订单完整数据的独立预算与优先队列；失败标的局部退避，不反复全市场重扫。
2. **新鲜度P0**：primaryReadyReasons使用宽年龄容忍，hotFreshnessDiagnostics使用闭合边界，出现READY但落后一根。统一闭合定义与grace，Hot按缺失周期定向补齐；失败仅隔离该候选并补位，不伪造K线、不降低质量门。回归覆盖跨边界、未来时间、缺帧、补齐失败、队列饥饿及持仓维护优先。连续Hot闭合新鲜率≥99%且样本分母明确才PASS。
3. **执行守恒**：复核新实例全部PLACE→有效授权→Intent→订单/拒绝/过期链；持仓、方向预算、位置、TTL等具体原因必须在Brain详情可查。禁止强制PLACE、盲目重试或绕过风险门。
4. **运行时间**：24h/100自然生命周期及成交、LONG/SHORT、完整退出数量继续按既有正式计划验收，不能合成样本或拼接旧build窗口。只读有限观察器PID 1428，起点2026-09-09T22:17:26.502Z；最早窗口成熟2026-09-10T22:17:26.502Z，仅到期不代表PASS。观察器无Engine启停能力，预热旧样本单独保留。
5. **Production硬门槛**：独立生产只读凭据缺失，Private Read-Only BLOCKED。公共GET通过是单次连通证据；时钟偏差约+1.30秒需签名校正验证。补齐账户/环境/权限、仓位模式、合约规格、费用、保证金、退出规则与错误恢复证据。未经全部PASS及明确Canary账户和资金/杠杆/日损失预算，Production写入继续锁定。

## 发布与回滚规则
任何后续源码发布须先隔离测试与构建，再取得特定Engine生命周期指令；不自动重启。运行SQLite已有新事实，禁止直接覆盖旧数据库；回滚应用须验证结构兼容并以交易所订单/仓位对账为准。故障保留TP和已有订单管理，停止新增风险须按既有风险边界处理。

## 交付定义
DONE：本轮新构建部署、TP确定拒绝修复及三条证据迁移、V4目录上线、当前HTTP/私有链恢复。
PENDING：上述行情供应/边界一致性、9B错误归因、逐笔执行归因、24h/100生命周期。
BLOCKED：Production独立只读凭据及Canary明确额度未提供；因此今天不能据现有证据认证可实盘。

证据：v391-tests-20260910.log、v391-typecheck-20260910.log、v391-tp-legacy-proof-20260910.json、v391-tp-ledger-migration-20260910.json、v391-v4-review-20260910.json、v391-directory-migration-20260910.json、v391-online-current-20260910.json、v391-continuous-observation-20260910.json、v391-production-public-readonly-20260910.json（均在docs/reports）。
