# GPU2 TP_TARGET_REVIEW_DRY_RUN — isolated SHADOW protocol
独立于D0/D2和G1，从main b55f427建立 codex/v398-gpu2-tp-shadow。新增可执行 TpTargetShadow 服务与4组单测；默认不接入生产调度或模型请求，不更改任何 existing TP。

## Implemented boundary
输入由确定性facts provider提供：scope hash/cycle/冻结plan/version/ownerVersion、<=60s签名仓位与TP双ID哈希/覆盖、授权range、tick/economics合格的冻结候选。模型接口仅收到候选ID/证据引用和envelopeHash；输出strict schema仅KEEP/SELECT_CANDIDATE/HANDOFF、候选ID、事实引用、摘要。任何自由price/quantity、未知ID、无事实引用均拒绝。Before/after envelope hash必须完全相同，owner/plan/order identity变化、过期/未保护/undercoverage/费用未达标拒绝。HUMAN_MANAGED不调用Review。
同facts dedupe，最多16个active/720个completedfacts；失败不改变原TP。结果always modeSHADOW/exchangeWrites0/entryPermissionfalse/protectionChangedfalse；无ExchangeAdapter、Settings、owner transfer或Entry capability。目标差值只作离线比较；HANDOFF也是建议，不执行owner转移。

## Actual validation and limits
shadow-npm-ci.log；shadow-verify-ci.log：完整verify脚本/S00/typecheck/build/全workspaces测试。单测真实运行：合法候选零写入/不变事实，freeprice/quantity/ID/evidence拒绝，HUMAN/stale/undercoverage/economics拒绝，并发dedupe与lateowner拒绝。
该阶段是可测SHADOW协议服务，没有生产signed provider、自动候选生成、GPU2调度接线。未声称当前真实任务运行。未来facts provider必须从原冻结TradePlan、价格tick、实际手续费/收益floor、已签名订单身份推导合法候选，不能把caller布尔当权威；目前生产默认不可调用。挂单Review事实版本/TTL/action lease竞争优化尚未实施，留在Issue28，不扩大本PR。现有挂单cancel/replan/TP修改逻辑未改，不能当零现网写入宣称。

## Release gates
未部署/未Engine重启/未修改Settings/未真实TP改价/补仓。原24h 08:34 ABORTED，签名TP 02:10Z的25/25仅历史样本；正式发布仍需所有新鲜门禁及新24h。SHADOW protocol tests/CI均不是release approval。
