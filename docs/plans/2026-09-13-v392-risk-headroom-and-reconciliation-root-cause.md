# V3.9.2 Runtime Capital Route → Preflight Risk Headroom

## 修改前只读证据及裁决

来源：两个 postfix 包 data/reports/v392-ai-contract-postfix-1789295281303、data/reports/v392-ai-contract-postfix-1789295594831，分别10/27次；两段各5分钟，中间有13.528秒空隙，不冒充连续窗口。SQLite以readOnly打开。完整74个原始riskHeadroom、每次capitalFacts、持仓/候选统计、FET事件链见 data/reports/v392-risk-headroom/audit.json。

**裁决 B+C，另有D：cluster-direction配置未接入。** Route遗漏cluster/risk-sizing，并用max(account equity,sum(asset usdValue))；Preflight采用account equity，因而同一capitalVersion并不代表相同计算。第一条equity=10551.4825457225，route公式=10611.8299305725。34个SHORT在方向限额处先拒绝；37个LONG及3个SHORT被cluster拒绝。不能说74个方向全被cluster拒绝。

方向检查统计：{"REJECT_GROSS_EXPOSURE":0,"REJECT_DIRECTION_EXPOSURE":34,"REJECT_CORRELATED_CLUSTER":40,"REJECT_RISK_PER_TRADE":0,"OTHER":0}。按候选计：37个有cluster拒绝，其中34个同时有direction拒绝，3个仅cluster。gross/risk-per-trade/其它均0。

clusterFor使用前缀/子串匹配；OTHER为剩余所有资产，没有相关性证据或资产身份区分，却被合并到同一个35%限额。不据此宣称这些资产统计上无相关性；代码缺陷是把“未分类”当作“已证实同一簇”。应保留35%并以unknown underlying为独立集中度组，同underlying跨quote仍聚合；已知组用精确资产匹配，避免子串误分类。

17持仓（首条）：

```json
{
  "BTC": {
    "count": 1,
    "notional": 821.2570358387339,
    "symbols": [
      "BTCUSDT"
    ]
  },
  "ETH_L1": {
    "count": 1,
    "notional": 1633.3560611936002,
    "symbols": [
      "ETHUSDC"
    ]
  },
  "MEME": {
    "count": 1,
    "notional": 687.25476225,
    "symbols": [
      "DOGEUSDT"
    ]
  },
  "AI": {
    "count": 2,
    "notional": 452.05182748467,
    "symbols": [
      "TAOUSDT",
      "WLDUSDC"
    ]
  },
  "DEFI": {
    "count": 1,
    "notional": 341.1250876,
    "symbols": [
      "UNIUSDC"
    ]
  },
  "EXCHANGE": {
    "count": 1,
    "notional": 272.0655016586,
    "symbols": [
      "BNBUSDC"
    ]
  },
  "OTHER": {
    "count": 10,
    "notional": 3641.4404719154,
    "symbols": [
      "ARBUSDT",
      "AVAXUSDT",
      "BCHUSDT",
      "ENAUSDC",
      "HBARUSDT",
      "HEMIUSDT",
      "NEARUSDT",
      "PROMUSDT",
      "SOLUSDT",
      "ZECUSDT"
    ]
  }
}
```

37候选为重复事件数，非独立机会数。候选全部OTHER，名义价值为两个互斥方向的reported final（计划额下界），不能相加当作实际风险：

```json
{
  "BTC": {
    "count": 0,
    "longPlanned": 0,
    "shortPlanned": 0
  },
  "ETH_L1": {
    "count": 0,
    "longPlanned": 0,
    "shortPlanned": 0
  },
  "MEME": {
    "count": 0,
    "longPlanned": 0,
    "shortPlanned": 0
  },
  "AI": {
    "count": 0,
    "longPlanned": 0,
    "shortPlanned": 0
  },
  "DEFI": {
    "count": 0,
    "longPlanned": 0,
    "shortPlanned": 0
  },
  "EXCHANGE": {
    "count": 0,
    "longPlanned": 0,
    "shortPlanned": 0
  },
  "OTHER": {
    "count": 37,
    "longPlanned": 10153.687076703009,
    "shortPlanned": 12254.59185841726
  }
}
```

## 每条候选

15m方向未在事件/采样持久化，不用当前行情替代历史。route feasible列为最近前序采样值（非事件精确值，时间及完整route见JSON）；executable true/true可由两侧已执行riskHeadroom确认。planned原值未持久化，无法从final唯一反推：旧拒绝分支会跳过RISK_SIZING_CLAMP原因，故未记录clamp不能证明未缩量。表中notional仅为reported final及planned下界；clusterPct也仅为下界；旧REJECT的final仍为非零计划值，不代表可下单，实际feasible两侧均0。风险limit全为gross=1、direction=.5、cluster=.35、cluster-direction=.35（旧实现未用）、risk-per-trade=.01。

|#|symbol|15m|route L/S executable|前序route feasible L/S|preflight reported final / planned下界 L/S|equity|gross/long/short|cluster/clusterNow|clusterPct L/S|最终方向拒绝 L/S|
|---|---|---|---|---|---|---|---|---|---|---|
|1|XRPUSDC|UNKNOWN|true/true|321.1266/352.8940|321.0917/352.7137|10551.4825|7848.5507/2895.3495/4953.2013|OTHER/3641.4405|0.3755/0.3785|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|2|XRPUSDC|UNKNOWN|true/true|321.0694/352.3008|321.0897/352.1537|10551.0139|7849.1252/2895.3639/4953.7613|OTHER/3642.3118|0.3756/0.3786|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|3|XRPUSDC|UNKNOWN|true/true|321.7632/351.9463|321.7946/351.8064|10550.6242|7849.7488/2895.6581/4954.0907|OTHER/3642.8702|0.3758/0.3786|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|4|ADAUSDC|UNKNOWN|true/true|undefined/undefined|256.3114/325.4615|10550.3388|7850.3548/2895.1995/4955.1554|OTHER/3643.1437|0.3696/0.3762|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|5|XRPUSDC|UNKNOWN|true/true|321.8893/351.3675|321.8063/350.7710|10550.3388|7850.7036/2895.5542/4955.1494|OTHER/3643.5137|0.3758/0.3786|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|6|ADAUSDC|UNKNOWN|true/true|256.3492/325.4615|256.3610/325.4614|10549.5872|7849.5042/2894.7329/4954.7713|OTHER/3642.6549|0.3696/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|7|ADAUSDC|UNKNOWN|true/true|256.3492/325.4615|256.2436/325.4615|10550.7067|7850.7685/2895.8537/4954.9149|OTHER/3643.5654|0.3696/0.3762|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|8|SUIUSDT|UNKNOWN|true/true|undefined/undefined|251.5966/319.5221|10550.5050|7850.6982/2895.5742/4955.1240|OTHER/3643.4522|0.3692/0.3756|REJECT_CORRELATED_CLUSTER/REJECT_CORRELATED_CLUSTER|
|9|ADAUSDT|UNKNOWN|true/true|undefined/undefined|255.8588/324.9365|10550.5050|7850.6234/2895.5849/4955.0384|OTHER/3643.5347|0.3696/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|10|XRPUSDC|UNKNOWN|true/true|321.7641/351.0364|321.8000/350.9606|10550.5050|7850.5755/2895.5849/4954.9906|OTHER/3643.4897|0.3758/0.3786|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|11|SUIUSDT|UNKNOWN|true/true|251.5695/319.5221|251.5982/319.5240|10550.6147|7851.1326/2895.5637/4955.5689|OTHER/3643.7485|0.3692/0.3756|REJECT_CORRELATED_CLUSTER/REJECT_CORRELATED_CLUSTER|
|12|ADAUSDT|UNKNOWN|true/true|255.7979/324.8926|255.8074/324.8926|10550.0908|7851.5126/2895.7347/4955.7779|OTHER/3643.8223|0.3696/0.3762|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|13|XRPUSDC|UNKNOWN|true/true|321.7526/351.1169|321.7589/350.0663|10550.0908|7851.6456/2895.7770/4955.8686|OTHER/3643.8277|0.3759/0.3786|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|14|ADAUSDC|UNKNOWN|true/true|256.2436/325.4615|256.2741/325.4615|10549.8836|7852.8742/2895.5581/4957.3161|OTHER/3643.8847|0.3697/0.3762|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|15|ADAUSDC|UNKNOWN|true/true|256.3024/325.4614|256.3268/325.4614|10549.9212|7851.9026/2895.0957/4956.8069|OTHER/3642.8538|0.3696/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|16|SUIUSDT|UNKNOWN|true/true|251.6801/319.5297|251.6937/319.5371|10550.0591|7851.5024/2894.7812/4956.7213|OTHER/3642.0847|0.3691/0.3755|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|17|XRPUSDC|UNKNOWN|true/true|321.8829/348.9340|321.9028/349.4553|10549.9237|7851.2478/2894.7069/4956.5409|OTHER/3641.9119|0.3757/0.3783|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|18|ADAUSDC|UNKNOWN|true/true|256.3523/325.4615|256.3634/325.4615|10549.9237|7851.3421/2894.7517/4956.5904|OTHER/3641.9798|0.3695/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|19|SUIUSDT|UNKNOWN|true/true|251.6687/319.5371|251.6764/319.5435|10549.5334|7851.5679/2894.9948/4956.5731|OTHER/3641.9786|0.3691/0.3755|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|20|XRPUSDC|UNKNOWN|true/true|321.8608/349.4815|321.8634/348.9108|10549.5334|7852.0869/2895.0015/4957.0854|OTHER/3642.4703|0.3758/0.3783|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|21|ADAUSDC|UNKNOWN|true/true|256.3347/325.4614|256.3387/325.4614|10549.4621|7851.9532/2894.9837/4956.9695|OTHER/3642.3392|0.3696/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|22|ADAUSDC|UNKNOWN|true/true|256.3430/325.4615|256.3348/325.4615|10549.6001|7851.9569/2895.0229/4956.9340|OTHER/3642.3177|0.3696/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|23|ADAUSDC|UNKNOWN|true/true|256.3430/325.4615|256.2942/325.4614|10548.8665|7852.7907/2895.4045/4957.3862|OTHER/3642.9851|0.3696/0.3762|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|24|ADAUSDC|UNKNOWN|true/true|256.2942/325.4614|256.2490/325.4614|10549.0438|7852.8888/2895.8297/4957.0591|OTHER/3642.9967|0.3696/0.3762|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|25|LTCUSDT|UNKNOWN|true/true|undefined/undefined|255.7655/324.8256|10549.5839|7852.4544/2895.6707/4956.7837|OTHER/3642.6615|0.3695/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|26|SUIUSDT|UNKNOWN|true/true|251.5983/319.5577|251.6286/319.5577|10549.5839|7852.4583/2895.5648/4956.8935|OTHER/3642.7434|0.3691/0.3756|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|27|XRPUSDC|UNKNOWN|true/true|321.7501/348.9001|321.8019/349.0898|10549.7472|7852.3820/2895.4669/4956.9151|OTHER/3642.7726|0.3758/0.3784|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|28|ADAUSDC|UNKNOWN|true/true|256.2466/325.4614|256.3304/325.4614|10549.7472|7851.5227/2895.0668/4956.4560|OTHER/3641.9292|0.3695/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|29|LTCUSDT|UNKNOWN|true/true|255.8493/324.8380|255.8496/324.8380|10549.5467|7851.2929/2894.9700/4956.3228|OTHER/3641.8426|0.3695/0.3760|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|30|SUIUSDT|UNKNOWN|true/true|251.7039/319.5748|251.7419/319.5816|10549.5467|7851.0687/2894.6607/4956.4080|OTHER/3641.6576|0.3691/0.3755|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|31|XRPUSDC|UNKNOWN|true/true|321.8679/349.6136|321.8720/349.5968|10549.5467|7851.3503/2894.9422/4956.4081|OTHER/3641.9280|0.3757/0.3784|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|32|ADAUSDC|UNKNOWN|true/true|256.3403/325.4614|256.3297/325.4614|10549.9338|7851.8050/2895.0732/4956.7318|OTHER/3642.3871|0.3695/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|33|LTCUSDT|UNKNOWN|true/true|255.8493/324.8380|255.8454/324.8431|10549.4314|7851.6981/2895.0602/4956.6378|OTHER/3642.5883|0.3695/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|34|SUIUSDT|UNKNOWN|true/true|251.7039/319.5748|251.6969/319.5870|10549.4314|7851.8242/2895.1446/4956.6797|OTHER/3642.6893|0.3692/0.3756|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|35|XRPUSDC|UNKNOWN|true/true|321.8480/349.3486|321.8819/349.4943|10549.4314|7851.4327/2894.8986/4956.5340|OTHER/3642.4577|0.3758/0.3784|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|
|36|XMRUSDT|UNKNOWN|true/true|undefined/undefined|242.1414/307.3857|10549.5445|7850.6671/2894.6086/4956.0585|OTHER/3642.1795|0.3682/0.3744|REJECT_CORRELATED_CLUSTER/REJECT_CORRELATED_CLUSTER|
|37|ADAUSDC|UNKNOWN|true/true|256.3235/325.4614|256.3665/325.4615|10549.5445|7850.8440/2894.7398/4956.1043|OTHER/3642.4676|0.3696/0.3761|REJECT_CORRELATED_CLUSTER/REJECT_DIRECTION_EXPOSURE|

## Reconciliation 独立审计

确认长期FETUSDT EXACT_QUERY_NOT_FOUND。order=entry_intent_mtzfwb88_vv5x1mzv；clientOrderId=ml_2bea8360957d6fcef228d429a5a8；exchangeOrderId=null；createdAt=1789281324794 (2026-09-13T06:35:24.794Z)；status=UNKNOWN；quantity=1696；price=0.1688；reservationId=reserve_1789281315800_4ll8td；当前reservation={"id":"reserve_1789281315800_4ll8td","underlying":"FET","quoteAsset":"USDT","marginUsd":35.79686840569343,"notionalUsd":286.37494724554745,"planId":"alloc_mtzfwb87_r8ccmxdw","intentId":"intent_mtzfwb88_vv5x1mzv","createdAt":1789281315800,"expiresAt":1789281615800,"status":"RELEASED"}。本地fill/position不等于Binance完整事实。现有exact适配器把-2013/-2011映射null，reconciler缺失exact时保持UNKNOWN；不能只凭不存在open/position或本地无fill判定从未成交。补查交易所多源只读事实后再裁决，不删记录、不强制状态、不释放身份。

## 实施计划（生产代码修改前写入）

1. 单一computeExecutableRiskHeadroom纯函数：统一account equity，扣gross/direction/cluster/cluster-direction，ATR per-trade sizing，quote余量；暴露每项notional及具体blocker。
2. Runtime route与Preflight共用；route按实际剩余可执行额，Preflight JIT复核。buildRiskEnvelope最终约束复用同一函数，并保持对超限计划拒绝。
3. OTHER保持展示分类，但风险key按underlying隔离；已知组精确匹配。保持所有配置值、方向/杠杆/资金/TP/模型参数不变。
4. targeted tests覆盖真实错配、部分剩余簇、同underlying跨quote、cluster-direction、risk-sizing、JIT变化和fail-closed；随后仅一次npm run verify。
5. 本轮无生命周期操作；新构建离线验证完成后报告待加载/在线验证项，不等待Primary。Reconciliation仅证据充分时可收敛。

## 精确错配举例和历史观测边界

第一条：SHORT已有4953.20126272；账户equity对应方向剩余322.54001014，旧route资产估值总和对应352.71370257，后者与被拒SHORT reported final完全吻合。OTHER剩余51.57841909。它们说明B，无需等待新Primary，也不能解释为正常gross全耗尽。

历史37条完整保存的riskHeadroom只有status/finalNotional/reasons，已逐侧原样保留。没有历史ATR/精确planned/route全部输入和15m方向，不能声称重建不存在的事实。新Preflight事件补全trend15m、route、planned、equity、各暴露/limit/remaining和全部具体blockers。旧表中的前序route仅上下文。当前SQLite审计时已18持仓（多CRVUSDC），与指定窗口17持仓分开保存在JSON currentPositions，不倒灌历史。

## Binance只读多源事实与Reconciliation裁决

查询时点 2026-09-13T11:18:17.012Z；来源 data/reports/v392-risk-headroom/fet-binance-facts.json。使用现有配置的BinanceTransport和TESTNET凭证，只发GET，不构造Engine、不改凭证或数据库。

- openOrders(symbol=FETUSDT)：[]。
- exact(origClientOrderId=ml_2bea8360957d6fcef228d429a5a8)：-2013 ORDER_NOT_EXIST。
- userTrades/allOrders：从创建前60秒1789281264794至1789298297012，limit=1000，均[]；未触及分页上限。
- positionRisk：LONG=0、SHORT=0，mark=0.16500490；最近position updateTime分别1789005500184/1788956693563，均早于本单。

多源一致支持“查询时无活动FET风险”，但没有身份可归属的交易所终态；尤其不能把-2013转换成FILLED/CANCELED。**本轮保留UNKNOWN记录和clientOrderId，未修改reconciliation状态机或数据库。** 本地reservation已RELEASED是原有事实，UNKNOWN订单仍占在途容量；没有再次释放、重复下单或降低unresolved验收定义。后续若设计无活动风险证明终态，需要单独的带来源/覆盖窗口/身份墓碑持久化语义，不能伪造Binance状态。

## 已实施

computeExecutableRiskHeadroom作为纯函数统一gross/direction/cluster/cluster-direction/risk-sizing/quote容量；Runtime route与Preflight都使用account.equityUsd，保留既有quote .995安全系数并扣有效reservation margin。buildRiskEnvelope共享容量源，在最终验证中继续拒绝超限计划。OTHER展示分类不变，风险key使用OTHER:underlying；跨USDT/USDC及1000乘数合约归一，已知类别用精确资产成员。

Preflight按剩余量缩量至可执行额，低于交易所minimum时输出具体原因；保留全部方向blockers、市场代际/事实版本/私有数据/容量检查。没有修改15m方向决策、资金配置、杠杆、TP、Prompt、reasoning、9B或第三27B。

Targeted：6文件57测试PASS。初次有1个旧测试只改wallet、不更新account equity，按新的权威equity约定补齐账户事实后通过；没有回退为资产总和来满足测试。

### verify发现兼容性回归后的最小补充计划（修改前）

一次verify中typecheck/build和contracts/core测试通过，Engine 418/419通过，riskPauseOverride测试失败：人工日内复核的physical检查依赖route executable，形成日内blocker自锁。拟仅在复核预览的物理容量判定中区分“只有日内blocker”和“实际容量不足”；实际route executable、Preflight风险检查不放宽，保留人工复核原语义。补跑受影响测试及typecheck/build，不再重复npm run verify。

## 最终验证状态与交接

- targeted首轮修正fixture后：6文件57测试PASS。
- 仅一次 npm run verify：exit 1。依赖/脚本检查、typecheck、build、contracts 8文件、core 7文件PASS；Engine 418/419通过，唯一失败为上述人工复核physical自锁。日志：data/reports/v392-risk-headroom/verify.log。**不宣称整套verify PASS。**
- 修复兼容性后：4文件25测试PASS，Engine typecheck和build exit 0；随后补齐route.reason及容量诊断的具体blocker，受影响2文件13测试和Engine build再次PASS。
- route dispatch仍受日内blocker约束；仅人工复核预览将“唯独日内阻断”识别为物理容量存在，其他风险/资金/数据blocker仍不满足物理条件。
- 新审计脚本语法检查、git diff --check通过。未运行Engine生命周期脚本，无启动/停止/重启/热加载，无交易所写入、DB更新、参数修改或commit/push；保留原工作区已有AI Contract变更。

待用户决定加载后验证：同一capitalVersion下route/Preflight的equity、clusterKey及remaining一致；真实15m方向字段和具体blocker完整；低于minimum的候选不得进入Primary；可执行候选的JIT重新验证和最终订单约束一致；TP维护和Exactly-once不回退。旧economics.entry的在线验证仍以真实Primary为准，本轮未等待新Primary、也未冒称完成在线验证。Reconciliation保持UNKNOWN等待可审计终态语义或身份匹配的正面事实，不以drift=0为目的删除数据。
