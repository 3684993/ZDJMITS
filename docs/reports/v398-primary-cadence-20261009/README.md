# V3.9.8 Primary 调度低频诊断与离线修复

关联 [Issue #18](https://github.com/3684993/ZDJMITS/issues/18)。完整读取的交接源是分支 `codex/v398-primary-cadence-p0-20261009` 的 [交接文件](https://github.com/3684993/ZDJMITS/blob/codex/v398-primary-cadence-p0-20261009/docs/prompts/V398_PRIMARY_ANALYSIS_CADENCE_HANDOFF_20261009.md)。实现分支从 `origin/main` 的 `7c9c94e9807c8c8ab1a9e0c8b205e391974493ec` 创建，独立于交接分支及未部署的 PR #16。

## 结论与证据边界

**PROVEN：采样 90 分钟内派发 1 次 Primary，完成有效决策 0 次；174 条当前实例调度心跳仍在推进。** 这是派发前资格被过滤及一次模型协议失败，不是已证明的 Engine 停转或 GPU 饥饿。

运行实例 `65185f71-b336-4f6f-8149-cafe90f5e160`，Engine PID `18100`，构建 `3.9.8-6cd926abca3eec24392e`，实际入口 `D:/MITS-RELEASES/ZDJMITS-v398-ai-entry-cb0de7b/apps/engine/dist/main.js`。启动目录名不是构建身份的替代证据。只读 `/health` 为 READY。Primary 8084、Review 8083、Scout 8081 是独立资源；采样中 Primary 队列等待约 1.2–1.6 秒、推理约一分钟，Review 有完成记录。**没有证据支持资源争用是这次近两小时停派的主因。**

运行日志、SQLite 只读查询和少量本机 GET 的原始捕获保留在本工作树忽略目录 `data-test/cadence-private/`，未提交私有账户数据、凭据、SQLite、原始全量 prompt 或订单。公开的 [历史投影](historical-projection.json) 保留源 SHA-256、Run ID、必要数值、分段计数和 blocker。查询上限未触发：事件 11683、Run 76；扩展三小时 Primary 样本 17 次（15 COMPLETED、2 schema FAILED）。COMPLETED 是协议结果，不等于盈利或成功建仓。

## 90 分钟、每五分钟吞吐漏斗

北京时间 **2026-10-09 17:12:40.905–18:42:40.905**，各段左闭右开。[完整 CSV](funnel-90min.csv) 包含心跳、资本预筛和 downstream 计数。Supply 的 poolReady 是供给层口径，不能当作冻结可执行候选数。Scout 按 Run 开始、完成/失败按终结时间计数。

| 北京时间窗口 | Supply poolReady | 资本预筛 | 心跳 | 派发 / Scout / Primary | 有效完成 / 失败 | Intent / Order |
|---|---:|---:|---:|---:|---:|---:|
|17:12–17:17|16–20|16–32|10|0 / 0 / 0|0 / 0|0 / 0|
|17:17–17:22|16–20|16–27|9|0 / 0 / 0|0 / 0|0 / 0|
|17:22–17:27|18–20|18–30|10|0 / 0 / 0|0 / 0|0 / 0|
|17:27–17:32|20|22–29|10|0 / 0 / 0|0 / 0|0 / 0|
|17:32–17:37|20|22–28|9|0 / 0 / 0|0 / 0|0 / 0|
|17:37–17:42|20|20–29|10|0 / 0 / 0|0 / 0|0 / 0|
|17:42–17:47|20|23–30|10|0 / 0 / 0|0 / 0|0 / 0|
|17:47–17:52|20|22–30|9|0 / 0 / 0|0 / 0|0 / 0|
|17:52–17:57|20|25–32|10|0 / 0 / 0|0 / 0|0 / 0|
|17:57–18:02|20|22–31|10|0 / 0 / 0|0 / 0|0 / 0|
|18:02–18:07|20|21–30|9|0 / 0 / 0|0 / 0|0 / 0|
|18:07–18:12|20|23–29|10|0 / 0 / 0|0 / 0|0 / 0|
|18:12–18:17|20|24–30|10|0 / 0 / 0|0 / 0|0 / 0|
|18:17–18:22|20|23–29|9|0 / 0 / 0|0 / 0|0 / 0|
|18:22–18:27|20|22–31|10|0 / 0 / 0|0 / 0|0 / 0|
|18:27–18:32|17–20|17–30|10|1 / 1 / 1|0 / 1|0 / 0|
|18:32–18:37|18–20|17–29|9|0 / 0 / 0|0 / 0|0 / 0|
|18:37–18:42|20|26–33|10|0 / 0 / 0|0 / 0|0 / 0|

上次有效完成为 16:44:39.795，至采样末相隔约 118 分钟。全链条历史资格数 **UNKNOWN_UNRECORDED**：旧日志没有持久化每个 symbol 的最新已收盘 K 线、双侧 envelope、生命周期、资源和候选集合的同时刻判定。不能把页面 107/26/32 READY 倒填为每五分钟真正合格数，也不能推断一直存在可以下单的机会。

## 真实低频原因

1. **PROVEN：READY 口径脱节。** `processPool()` 在供给 READY 后再次做 objective envelope、EIP、occupancy、cooldown、lifecycle 过滤，全部失败时仍显示 WAITING_CANDIDATE。页面的 capitalExecutableCount 不是最终可执行资格；`authoritativeBlocker=PLANNED_NOTIONAL` 也不能解释各币种的实际首因。
2. **STRONG_EVIDENCE：当前候选被真实占用/缺事实过滤。** 24 个捕获 resident 中，19 个两侧均被持仓、origin 或待确认订单阻止。其余 LDOUSDT、ENAUSDC、RENDERUSDT、JTOUSDT 双侧无 no-add 阻止，ARBUSDC 仅 LONG 无阻止；这五个均缺 committed margin 数据集档位，原 envelope 因 `EXCHANGE_LEVERAGE_UNPROVEN_OR_BELOW_10` 拒绝。对应 market-intelligence reasons=[]，因此这五个的当前可见首因是杠杆事实证明，不是笼统“市场没机会”。并不证明它们每分钟都具有合法完整冻结菜单。
3. **PROVEN 源码缺陷 + STRONG_EVIDENCE 运行投影：Entry 日志漂移。** 35 条活动 origin 的 exact clientOrderId 对照中，21 条 task 与 runtime entity 的终结/累计成交字段不同。Review 撤单及部分 exact TTL 路径只更新 runtime state，未同步 Entry journal；origin 释放从 journal 取事实，旧 UNKNOWN/ABSENT 会继续占用。ADA 等数量不守恒样本不能因为 terminal=CANCELED 就释放。此次新增终结事实的 journal 持久化；**没有批量修复现有数据库、没有宣称21条都能释放。** 历史漂移在部署前需要独立、逐 identity、守恒证明的恢复审计。
4. **保留的真实保护：** 捕获池相关 93 个 EXPIRED/UNKNOWN 订单记录仍缺有效 no-active-risk proof。它们不是“交易所93个活动挂单”，也不能因页面活动建仓=0被删除。unknown-risk 与同向 origin 禁止独立补仓继续有效。
5. **源码风险：** 失败 cooldown 到期仍可能因旧 decisionContextKey 不变而无法重试；已经合法但无 edge 的决策去重必须保留，失败与有效无边际等待不能共用释放条件。高分 WAITING resident 也可能掩盖低分合法候选，故 pool 需要消费真正的 preflight READY 集。
6. **行情/生命周期证据限制：** 最新已收盘 K 线仍由 `primaryReadyReasons`、EIP 和已有 freshness 门控检查，本轮没有放宽。当前五个标的的 market reasons=[]；缺少逐窗口旧 trace，不能排除历史某些时段 K 线缺失或 lifecycle 同上下文去重。不要把它们当作已证明的90分钟唯一根因。EIP GET 可能返回缓存包，旧包年龄不能作为当前行情健康证明；非原子 snapshot 的 blocker 回放参考时刻是 entities 捕获完成约18:48:18，不能倒推 BNB18:30资格。

## BNBUSDC 精确失败

`airun_mv0tqcnh_qqb6z1hm`：18:30:00.845 开始，18:31:03.374 失败，queue=1263ms，latency=62529ms，SCHEMA_VALIDATION / AI_SCHEMA_INVALID。

- frozen SHORT id `cand_35aa79aef83b10a3ed635ed1`，qtyUnits=135，leverage=10，TP=741.6、目标区间741.44–741.6、horizon=15min。
- tick=0.01；冻结 entryReferencePrice=743.0018763157，执行区间 `[743.001876315681,743.218123684319]`。旧候选包含非 tick 边界。
- AI `idealPrice=743.0`，小于 min 约0.001876。目标字段/id没有造成这条 schema 错误。**原输出继续拒绝，没有订单。**

修复在冻结之前向内对齐：可报价区间 `[743.01,743.21]`；SHORT 使用743.01、LONG使用743.21作为各自保守 sizing/TP参考。无合法tick直接拒绝。新 TESTNET funds-only 协议 `FROZEN_CANDIDATE_ID_V1` 只让模型选择 side、candidateId、candidateSetHash，以及独立市场理由；系统取该行完整执行数值。错 side/id/hash、过期、额外价格/数量字段、非tick候选均失败，不能回退换候选。旧非法输出不进入这个版本化物化路径。

数量上限在两侧均按允许区间最高价证明名义金额与保证金，SHORT收益下界仍按区间最低价计算；两种边界分开，避免合法区间内换价突破原资本上限。

原文字还存在质量风险：把“即将收盘”作为 timing、SHORT 的失效条件叙述为跌破支撑。新增 prompt 明确 confirmed candle 与 adverse invalidation 逻辑。跨周期多空冲突本身不能证明选错方向；本轮没有用确定性趋势替模型翻方向，也不把 prompt 改善当作实测成功率改善。

## 实际实现与离线改进效果

- 每tick一次双侧 preflight 判定，pool补充/READY消费同一结果；每30秒记录 `PRIMARY_DISPATCH_FUNNEL`，包含 ranked/preflight/pool 数和 symbol 双侧首因；UI诊断可区分 NO_ELIGIBLE_CANDIDATE 与真正 capital exhaustion。
- 缺杠杆事实在新代码部署后可通过已有 adapter **signed GET** 恢复：仅 TESTNET funds-only、每批最多3 symbol、并发1、每分钟退避、账户/环境/时间/完整性校验、10分钟缓存TTL、128条上限。失败保持未知，不改Settings或 committed portfolio authority；本轮没有调用它访问交易所。
- 失败单币冷却到期可以重试，lease 释放后不阻塞下一合法币种。正常有效同上下文去重保留；no-edge只按真实新事实或明确TTL释放。
- Review及exact终结路径先 journal.save 再释放预约。原 origin 释放契约、完整账户扫描、成交守恒检查未变。
- 有效计数排除 schema失败、DATA_ERROR、AI_OUTPUT_INVALID、冻结候选不一致 PLACE；合法 NO_DIRECTION_EDGE/WAIT/REJECT 也可算完成市场分析，不要求PLACE。不是统计GPU调用量或下单次数。诊断提供60分钟5分钟分箱、完成间隔P90、连续preflight机会5/10分钟告警，明确 full eligibility SLO=UNKNOWN，不能冒充验收。

离线实际效果：原 BNB schema失败被复现且仍拒绝；仅改变候选生成/协议的历史数值投影能合法物化743.01并保留原TP；未调用模型，因此这是**机械协议成功证明**，不是原失败Run变成成功或模型实测成功率。调度测试证明失败后下一币种派发、合法上下文不重复、撤单先持久化、LONG/SHORT候选tick合法。原“非法价位被clamp后提交”测试改为断言零Intent/零Order，统计也标记FROZEN_CHOICE_INVALID。完整校验结果见 [validation.json](validation.json)。

另外对17次真实归档Run的完整历史packet和原始模型content做本机parser回放（不使用保存的`__zdjParsedDecision`代替原文）：15次接受、ADA和BNB两次仍拒绝。[逐Run结果及输入/输出hash](archive-parser-replay.json) 可审计；原始私有packet不公开。没有将旧非法输出转换为成功，也没有为回放发出模型或交易请求。

复现：`npx tsx scripts/v398-primary-cadence-replay.ts`（仅读取仓库历史投影，零网络、零live state写、零模型调用）。[脚本](../../../scripts/v398-primary-cadence-replay.ts) 与历史投影均在PR内。新杠杆缓存最初引用组合风险快照触发S05边界测试，已移除该依赖，未放宽架构测试。

完整校验也发现新增解释文字使旧提示词超过31000字符断言，已将新协议说明限定到新wire并压缩文字；保留原prompt budget门限，未扩大上下文预算。

## 执行链条精简建议

当前 `Market → Underlying → Capital Admission → Policy → Exposure → Location → Allocation → AI → Entry` 不应把每个显示层都变成重复的串行阻断。

建议实时关键路径：**Market已收盘事实 → 一次Exchange/资金/同向占用资格 → 冻结合法候选集合 → Primary选择 → JIT身份/幂等/TP/最终Exchange过滤 → Entry**。

可以删除/合并：重复的 objective envelope 计算、供给READY后再隐式过滤却没有首因、模型重填系统已冻结的价格/数量/TP、把Scout串行作为Primary前置、失败时全局等待该币种。当前Scout已经非阻塞，本轮不重复“移除一个本来不存在的串行步骤”。Location应交给Primary解释市场时机；Allocation生成合法候选而非预先指定方向。

Underlying合约去重、资本下限/可用资金、真实杠杆/交易所过滤、持仓/订单UNKNOWN占用、origin独立补仓禁止、幂等、TP保护和JIT复核必须保留。TESTNET_FUNDS_ONLY_ENTRY中Policy/Exposure应是既有授权规定的观察面，不再叠加重复战略门；传统ENFORCE路径保持原风险权限，不能全局删除。Review继续保护已有仓位及挂单，使用专用8083，不挤占Primary预算。

## 上线与运行验收方案（本轮未部署）

1. **2026-10-10 16:16:04北京时间之前不主动重启任何Engine/模型/代理。** 完成既有24小时验收及证据封存后，由用户另外授权部署窗口。当前READY不等于24小时验收通过。
2. 部署前审阅PR、记录原runtime/build/source、复核21条journal漂移。现有terminal数据只能经exact identity、完整flat scan、成交/close-cycle守恒证明恢复；UNKNOWN和数量冲突不释放。新代码不自动修复旧origin，必须把这项限制计入首小时验收。
3. 独立release目录构建并绑定提交/工件身份。授权范围内执行一次受控Engine切换，模型和代理不因本PR被重启；禁止自动重试生命周期。部署后核对PID、实例、构建hash、`/health`、相关closeout和保护事实，不能只看监听端口。
4. 自然观察至少90分钟，每5分钟保存供给、preflight、frozen候选、Primary请求/终结/有效、失败分类、lease/next symbol、Intent/Order、freshness和资源等待。统计 eligible 分母需连续、新鲜、完整 frozen-menu 证明；缺 trace=UNKNOWN，不填零。preflight计数只能提示风险，不能作为最终SLO分母。
5. 在有真实连续资格的观察段，目标平均有效完成间隔≤5分钟（3–5分钟目标范围；更快不是强迫交易），P90/最大间隔同时报告，连续10分钟无有效完成必查首因。至少有连续资格及足够自然样本才可PASS；资格为0或覆盖不足=INSUFFICIENT_EVIDENCE。schema失败率按自然sample报告，不能用本地物化测试代替新模型wire实测。
6. 拒绝fakePLACE、扩大freshness、删UNKNOWN、取消TP、重复同向origin、改Settings。新signedGET要观察预算超时/队列，失败回到failclosed；异常先保留证据，在单独授权范围回退原构建，不以自动重启掩盖问题。

**本轮交付为只读诊断、已实现并离线验证的独立PR。实际3–5分钟运行达标仍是UNKNOWN_NOT_DEPLOYED。**
