# V3.9.2 AI Decision Contract 最终验收记录

日期：2026-09-13。状态：**修复后Canary样本不足（INCONCLUSIVE，非PASS）；已完成一次授权停止/启动，无再次生命周期操作。**


## 最新：修复后受控启动与Canary（18:25—18:38）

本节为最新结论；后续“原始包”及旧窗口分析保留为修复前历史证据。

- 用户明确授权的一次操作已完成：停止旧PID3420，使用 `scripts/start-zdj-lan.ps1 -SkipFirewall` 启动新PID40156。
- 新实例startedAt=1789295117672（18:25:17.672），startReason=MANUAL_START；buildId=`3.9.2-f1fa98e6e401fba89620`，artifactHash=`f1fa98e6e401fba89620b61acd3a29872b51075958b7084c3b9a15056e99f861`。
- 复用 `D:\MITS\data`，没有清空或重置数据；未改变交易参数、Prompt策略、reasoning、9B职责、风险或TP策略。
- READY后Primary 27B `qwen/qwen3.8-27b` ONLINE/READY；Private为BINANCE_TESTNET_ACCOUNT/READY，executionMode=TESTNET_ENABLED，WS=LIVE。
- Reconciliation持续DEGRADED、unresolvedDriftCount=1、lastError=null；这是修复前已有状态，不能报告为“全部正常”。TP始终READY、17/17保护。

|修复后指标|结果|
|---|---|
|观察窗口1|18:28:01.303—18:33:01.303，5分钟|
|观察窗口2|18:33:14.831—18:38:14.845，5.00023分钟|
|有效总观察时长|10.00023分钟；两窗口间13.528秒不计入分母|
|健康样本|20/20 READY；20/20 TP READY；WS LIVE、Private READY|
|实际Primary calls/hour|0/h，0次调用；不能解释为100%优化收益|
|preflight阻断|37次，均RISK_HEADROOM_EXHAUSTED；涉及既有方向/相关资产暴露限制|
|economics.entry schema失败|0次/0次推理，在线修复效果尚未验证；离线7/7修复证据继续有效|
|非法TP范围|没有线上新样本；此前严格拒绝回归测试PASS，不改变TP策略|
|NO_EDGE / 复用 / TTL|NO_EDGE=0；未观测复用或TTL触发；NO_EDGE复审机制尚缺真实运行样本验证|
|triggerReason|没有实际Primary，无法验证新推理记录的triggerReason；离线机制测试PASS|
|PLACE / Intent / Order / Fill|0 / 0 / 0 / 0（两窗口新事件）|
|新decision episode记录|0；不能将其解释为0个独立市场机会|
|calls / market opportunity episode|UNKNOWN，无有效独立机会分母|
|新runtime/schema/protocol regression|未观察到新增AI失败；因0次推理，不能证明无协议回归|
|既有异常|FETUSDT EXACT_QUERY_NOT_FOUND持续出现；停止前窗口已存在143次同类FET事件，不扩大调查|
|结论|INCONCLUSIVE，非PASS；不能作为新的稳定基线|

证据目录：`data/reports/v392-ai-contract-postfix-1789295281303/`、`data/reports/v392-ai-contract-postfix-1789295594831/`，均含ai-contract-metrics.json、samples.jsonl、evidence.json。采集器 `scripts/observe-v392-ai-contract-canary.mjs` 仅GET和只读SQLite，无生命周期操作或交易写入。

以上记录是AI Contract阶段的历史验收材料，不代表最终收敛工作区的完整验证通过。最终收敛轮唯一一次完整 `npm run verify` 为 exit 1；后续兼容性修复的 targeted tests、typecheck、build 通过，未再次运行完整 verify。最终状态以风险Headroom收敛记录为准，**不得写成完整 verify PASS**。不得将旧#101 SUCCESS称为本轮修改的CI验收。

下一步只能等待自然出现可执行风险空间和模型样本后，再做只读Canary；不放宽限制、不强制交易、不为制造NO_EDGE改Prompt。无需因本次零样本再次重启Engine。

## 修复前证据与范围

当前分支 `gpt56-optimize-v392-20260912`，运行基线 HEAD `40cc66ce382c4ed6a35a94132ff86b87aba00a89`。GitHub Final Verify #101 SUCCESS、本地此前PASS为接管时基线信息。本次未修改Engine生命周期、生产数据库、风险、杠杆、TP策略或启用额外模型。

原始包：`V392-ai-contract-canary-20260913-174648.zip`，SHA256 `71DF18C2A1E6CCCA65A31E14A72324CDE19F4165F742E7052EA9534BD12779A9`。
窗口：2026-09-13 17:48:11.808—18:03:13.041（Asia/Shanghai），15.02055分钟。以包内 `ai-contract-metrics.json` 的截止状态为准，不能把稍后完成的run倒灌到窗口。

Engine health-final READY=true，但自然验收15个样本全为PRE_READY，formalStartedAt=null，正式稳定样本0。样本存在 unresolvedDriftCount=1；TP快照13/13保护、READY。该结果不等于停机，也不构成稳定性验收PASS；本轮不重新调查Reconciliation。

## 核心指标

|指标|结果|
|---|---|
|旧活跃 Primary calls/hour|158.2/h|
|新观察 Primary calls/hour|79.89055/h（20次/15.02055分钟）|
|下降|78.30945/h，49.50028%|
|Primary状态（截止时）|11 COMPLETED，8 FAILED，1 RUNNING|
|调度PRIMARY_START|28；其中8次在preflight风险headroom检查被阻断，不能计作模型调用|
|calls / market opportunity episode|UNKNOWN：尚无独立机会生命周期分母|
|decision_episodes|11条，均为成功Primary run证据；不是11次独立机会|
|NO_EDGE及复用次数|NO_EDGE=0；无可复用拒绝样本，复用率不可评估，不能声称节省来自复用|
|release trigger分类|持久化triggerReason缺失；28个调度start均未提供，20个实际run无法完整归因|
|TTL触发次数|窗口未观察到NO_EDGE_TTL_EXPIRED（0）；NO_EDGE样本为0，不能证明机制安全|
|schema/protocol failure|8：7 economics.entry白名单遗漏，1 TP范围min/max颠倒|
|原NO_EDGE + TP=0|未发生；本轮无NO_EDGE，运行覆盖不足|
|PLACE / Intent / Order / Fill|11 / 8 / 6 / 2（窗口事件数）|
|修复后在线指标|尚无，新构建尚未手动加载|

调用率下降不是受控A/B，也不能当作成功优化收益；失败、持仓/容量阻断、候选构成均影响分母。截止时仍RUNNING的INJ run稍后变为相同引用错误，不纳入窗口8次失败。

## 十项判断

1. Primary调用率下降49.50%，尚不能归因于NO_EDGE复用。
2. 本轮没有NO_EDGE，无法验证是否真正复用旧决策。
3. 每次重新Primary的真实triggerReason没有完整保存。下表只列能找到的前序READY事件，不能把它追认为真实解除原因；已补齐后续run的触发来源观测。
4. 本轮无法证明不存在仅由1m/5m边界驱动的再推理。代码仍有普通decisionContext中的bar5/bar15；NO_EDGE特殊分支排除时间戳但EVENT文本分支只比bar1，存在待证风险。
5. NO_EDGE解除及时性未覆盖。WAIT事件1次：XPLUSDT旧WAIT因MATERIAL_STATE_CHANGE唤醒；不能据此证明其及时完成新的Primary。代码中同context提前返回还可能压住特殊解除，需要有对应运行证据再修改。
6. schema failure未消除。7次模型引用真实economics.entry，但该ID缺于validFactIds，属于确定性P0缺陷；最小修复已完成。剩余1次TP反向范围继续拒绝，不伪造合法价格或交换范围。
7. 本窗口成功结果全为PLACE，无非PLACE样本；非PLACE tradeSide=null/profitTakePlan=null的不变量有离线测试，尚不能称本轮运行验证稳定。
8. 9次PLACE_SHORT的direction/tradeSide/structureDirection均SHORT，15m为DOWN。2次PLACE_LONG（TAO/LTC）的15m trend为RANGE、模型structureDirection为LONG。字段表示模型结构判断，不能误写为确定性15m trend派生值；现合同允许RANGE中的模型判断，未擅自修改方向原则，二者在报告中分列。
9. 原实现只在AI_RUN_TERMINAL写成功run，8次失败没有episode。已补失败证据并标明PRIMARY_INFERENCE_RUN，marketOpportunityEpisodeId=null。仍未实现独立market opportunity生命周期；不能把修复说成机会分组完成。本轮无拒绝生命周期样本，不凭空重构。
10. 存在实际完整链：ENAUSDC与BTCUSDT各有本轮Order→Fill。11 PLACE中3次被DIRECTION_CAPACITY_UNAVAILABLE阻断；8 Intent中1次执行等待因MARKET_QUALITY_NOT_ADMITTED终止，1次提交超时，6次Order、2次Fill。引用合同缺陷造成新的Primary→Intent阻断，不能声称链路无新阻断；不重审既有传输基础设施。

## NO_EDGE TTL专项结论

源码仍为 retryCooldownSeconds=25 → review TTL约100秒；noEdgeReleaseReason首先检查过期并返回NO_EDGE_TTL_EXPIRED。另有空间整数bps任一变化即触发、releaseCondition包含大写EVENT且bar1变化即称事件完成的风险。**当前没有NO_EDGE运行样本，无法统计这些风险的实际占比，也无法认定正确目标已经实现。**

未把100秒改成更长固定时间。后续验收必须覆盖同拒绝条件跨多个bar与TTL、真实15m结构/权限/经济阈值解除、模型指定completed timing event及WAIT价格触发，明确记录检查、复用、解除和实际Primary开始的时间与条件。必要异常恢复应与正常市场重审分开。

## 已实施修复与验证

先更新实施文件，再做最小修改：
- compactFactIds补上已提供的economics.entry，未知引用继续拒绝；未放宽Prompt或PLACE条件。
- READY触发来源经过队列保留，并附于真实AI_RUN_STARTED/归档，避免用调度事件冒充调用。
- AI_RUN_FAILED也写推理证据，记录status、failure、triggerReason、PRIMARY_INFERENCE_RUN及空机会ID。

AI Contract阶段Targeted 3文件46测试PASS；包含真实解析路径经济引用成功/未知引用失败/颠倒TP范围失败、触发来源保留与更新、独立临时数据库失败记录回归。该阶段记录不覆盖后续最终收敛轮的完整验证结果。
最终收敛轮唯一一次完整 `npm run verify` exit 1；后续兼容性修复 targeted tests、typecheck、build 通过，未重跑完整 verify。`git diff --check` PASS；不得将完整 verify 标为PASS。

冻结本轮失败原始输入/输出经新构建解析器重放：7/7 economics引用错误消除，TP颠倒1/1继续拒绝。该回放只证明解析机制，不代表7个订单或成交，也不是修复后在线Canary。
可复现脚本：`scripts/analyze-v392-ai-contract-final.mjs`；明细：`data/reports/v392-ai-contract-final-details.json`。

## 每次实际Primary的观测边界

前序READY不等于真实release trigger；缺失保留UNKNOWN，不伪造分类。

|runId|symbol|截止状态|窗口中最近READY原因（仅上下文）|真实triggerReason|
|---|---|---|---|---|
|airun_mtzmvu6r_2wh8pjg9|ENAUSDT|COMPLETED|未记录|UNKNOWN|
|airun_mtzmwna4_ma3y57zs|BTCUSDT|COMPLETED|未记录|UNKNOWN|
|airun_mtzmxeay_vi7ge2od|HYPEUSDT|COMPLETED|未记录|UNKNOWN|
|airun_mtzmy1gt_ea7f71t0|XRPUSDC|COMPLETED|未记录|UNKNOWN|
|airun_mtzmzjnl_112ss7fv|ENAUSDC|COMPLETED|未记录|UNKNOWN|
|airun_mtzn0vv4_7jnmvjuo|ADAUSDT|FAILED|未记录|UNKNOWN|
|airun_mtzn1h7l_2bftubvg|BTCUSDT|COMPLETED|未记录|UNKNOWN|
|airun_mtzn2jwf_7yktalyd|ADAUSDT|FAILED|DECISION_CONTEXT_CHANGED|UNKNOWN|
|airun_mtzn38va_9gmylws3|DOTUSDT|FAILED|未记录|UNKNOWN|
|airun_mtzn4bjj_y7v8w9um|DOTUSDT|FAILED|DECISION_CONTEXT_CHANGED|UNKNOWN|
|airun_mtzn5e7o_6uiirnwz|DOTUSDT|COMPLETED|DECISION_CONTEXT_CHANGED|UNKNOWN|
|airun_mtzn61iq_cjruv428|LINKUSDT|FAILED|未记录|UNKNOWN|
|airun_mtzn6op3_9b14sybw|TAOUSDT|COMPLETED|未记录|UNKNOWN|
|airun_mtzn7fq9_0y8qef80|DASHUSDT|FAILED|未记录|UNKNOWN|
|airun_mtzn82x6_4zvgjmxi|BTCUSDT|COMPLETED|未记录|UNKNOWN|
|airun_mtzn8w0k_c1hqcmrw|ADAUSDT|FAILED|DECISION_CONTEXT_CHANGED|UNKNOWN|
|airun_mtzn9h4w_136hpjyg|LTCUSDT|COMPLETED|未记录|UNKNOWN|
|airun_mtzn9ym5_035hst1u|XMRUSDT|FAILED|未记录|UNKNOWN|
|airun_mtznahy3_a1jrbfdu|HYPEUSDT|COMPLETED|DECISION_CONTEXT_CHANGED|UNKNOWN|
|airun_mtznb57v_noxvhc7q|INJUSDT|RUNNING|未记录|UNKNOWN|

## 最终裁决及待办

- 是否发现机会漏检：发现真实模型PLACE输出被错误的引用白名单拒绝；是否成为可成交独立机会UNKNOWN。NO_EDGE解除漏检未覆盖，不能声称没有漏检。
- 是否继续修改Prompt：本轮不建议放宽或做P2策略优化；优先完成P0/P1在线验证。TP反向范围保持严格失败。
- 9B：REDESIGN，当前KEEP_DISABLED（Entry角色保持不接入）。
- 第三27B：NO；reasoning保持不启用。
- 新稳定基线：NO。
- 当前Engine PID3420仍为原17:46:49启动实例；未停止、启动、重启或热加载。
- 尚待：用户明确手动加载本次已验证构建 → 只读短Testnet Canary → 前后比较（必须诚实保留NO_EDGE覆盖缺口）→ commit + push → GitHub V3.9.2 Final Verify SUCCESS。
- 根据根目录AGENTS.md，Engine生命周期动作必须单独明确授权；不能为了完成Canary自动重启。代码和报告保留工作区待验收状态，不提前commit/push来绕过用户要求的顺序。
