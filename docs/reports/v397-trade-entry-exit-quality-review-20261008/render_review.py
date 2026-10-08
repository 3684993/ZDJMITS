import json,pathlib,datetime,csv
p=pathlib.Path('docs/reports/v397-trade-entry-exit-quality-review-20261008')
def load(n):return json.loads((p/n).read_text(encoding='utf-8'))
def fmt(v,n=4):return 'UNKNOWN' if v is None else f'{v:.{n}f}'
def dt(v):return datetime.datetime.fromtimestamp(v/1000,datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds') if v else 'UNKNOWN'
def table(headers,rows):return '| '+' | '.join(headers)+' |\n|'+'|'.join(['---']*len(headers))+'|\n'+'\n'.join('| '+' | '.join(str(v).replace('|','/') for v in row)+' |' for row in rows)+'\n'
a=load('position-quality-metrics.json');recent=load('recent-cycle-quality-metrics.json');summary=load('quality-summary.json')
# Quality attribution addendum: later model run cannot be the origin Entry decision.
bad=[x for x in recent if x['firstFillFromDecisionMs'] is not None and x['firstFillFromDecisionMs']<0]
valid=[x for x in recent if x['runPresent'] and x['firstFillFromDecisionMs'] is not None and x['firstFillFromDecisionMs']>=0]
clean=[x for x in valid if x['exFundingDiagnosticEligibleNoProvenanceConflict']]
(p/'model-attribution-addendum.json').write_text(json.dumps({'originRunInvalid':bad,'validOriginLinkedCount':len(valid),'diagnosticEligibleCount':len(clean),'wins':sum(x['exFundingNet']>0 for x in clean),'exFundingQuoteSum':sum(x['exFundingNet'] for x in clean),'warning':'Original quality-summary firstFillDelayMs includes a negative origin/run link. Exclude it, do not clamp to zero. Model latency itself measures the linked call, not proof of origin authority.'},ensure_ascii=False,indent=2),encoding='utf-8')
# Full per-fill identity table, using exact case correlation.
identity=[]
for symbol in ['AAVEUSDT','ETHFIUSDC']:
 c=load('case-'+symbol+'.json')
 for e in c['identityEvidence']:
  f=e['fill']; identity.append({'symbol':symbol,'cycleId':f.get('cycleId'),'fillId':f['fillId'],'exchangeOrderId':f['orderId'],'clientOrderId':f['clientOrderId'],'qty':f['qty'],'price':f['price'],'source':f['source'],'roles':','.join(sorted(set(r['role'] for r in e['registryMatches']))),'manualMatches':str(e.get('manualMatches',e.get('manual',[]))),'tpMatches':str(e.get('tpMatches',e.get('tp',[])))})
with (p/'case-exit-identities.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(identity[0]));w.writeheader();w.writerows(identity)
# Keep all metrics readable without replacing richer JSON.
current_table=table(['symbol / side','持仓 h / horizon min','entry / qty / leverage','fresh mark / executable','TP价 / qty / status / 来源','entry距% / 剩余距%','entry距ATR15 / 剩余ATR15','管理投影'],[[x['symbol']+' '+x['side'],fmt(x['heldHours'],2)+' / '+str(x['targetHorizonMinutes']),fmt(x['entry'],6)+' / '+str(x['qty'])+' / '+str(x['leverage']),fmt(x['mark'],6)+' / '+fmt(x['executableExitPrice'],6),str(x['tpPrice'])+' / '+str(x['tpQty'])+' / '+str(x['tpStatus'])+' / '+str(x['tpSource']),fmt(x['tpDistanceEntryPct'],3)+' / '+fmt(x['remainingTpDistancePct'],3),fmt(x['tpDistanceAtr15m'],2)+' / '+fmt(x.get('remainingTpDistanceAtr15m'),2),x['managementStatus']] for x in a])
cost_table=table(['symbol / side','openedAt +08','entry notional / notional÷L*','快照 uPnL / 显示ROI%*','TP gross / 已记录entry fee* / 假设exit fee*','说明'],[[x['symbol']+' '+x['side'],dt(x['openedAt']),fmt(x['entryNotionalQuote'],2)+' / '+fmt(x['entryNotionalOverCurrentLeverageDiagnostic'],2),fmt(x['privateSnapshotUnrealizedPnl'],2)+' / '+fmt(x['privateSnapshotRoiDisplayed'],2),fmt(x['tpGrossQuote'],3)+' / '+fmt(x['knownEntryFeeQuote'],3)+' / '+fmt(x['expectedExitFeeQuote'],3),'funding/net UNKNOWN; '+str(x['addCount'])+' adds'] for x in a])
path_table=table(['symbol / side','sampled MFE% / MAE%*','到样本最高点 min*','观察 above / below min*','未观察 min','ATR1m / 5m / 15m'],[[x['symbol']+' '+x['side'],fmt(x['path'].get('sampledMfePct'),3)+' / '+fmt(x['path'].get('sampledMaePct'),3),fmt(x['path'].get('timeToSampledMfeMinutes'),2),fmt(x['path'].get('observedAboveEntryMinutes'),2)+' / '+fmt(x['path'].get('observedBelowEntryMinutes'),2),fmt(x['path'].get('unobservedMinutes'),2),' / '.join(fmt(x['volatility'].get(t,{}).get('atr'),6) for t in ['1m','5m','15m'])] for x in a])
tp_table=table(['symbol / side','local TP / exchange / client','保护状态 / 来源 / 最后验证 +08'],[[x['symbol']+' '+x['side'],str(x['tpId'])+' / '+str(x['tpExchangeId'])+' / '+str(x['tpClientId']),str(x['tpPositionStatus'])+' / '+str(x['tpCoverageSource'])+' / '+dt(x['tpLastVerifiedAt'])] for x in a])
report='''# V3.9.7 Trade Entry / Exit / TP Quality Review — 2026-10-08

状态：Phase A CLOSED；Phase B ANALYSIS_COMPLETE；策略实施 NOT_STARTED。事实基线 main85eed50，正式 closeout9eabbc4；运行代码4cd57a99af028189ca213b7aee3ed27ed1e362c4。本轮仅本地 GET、SQLite `mode=ro/query_only`、离线纯投影和文档/证据写入。

## 1. 结论与证据分层

**最强结论是持仓与目标 horizon 明显脱节，不能据此直接认定所有原始 TP 过远。** 21 笔开放持仓中19笔超过原始目标 horizon，最长450.31小时。原始/当前成本到TP距离中位0.4502%，但8笔具备独立字段新鲜度证明的持仓，当前 executable 到TP的剩余距离中位5.5159%。损失累积使剩余目标越来越远；统一降低一个固定百分比不能修复方向错误、加仓成本变化或人工接管后的长期库存。

AAVE 的保留路径几乎没有正向空间，优先指向 Entry 方向/时机问题。ETHFI 初始60分钟路径也不支持“好Entry”，约5.9小时后才有TP部分成交，又有三次后续加仓，最终人工退出。它确实存在迟到的利润机会与回吐，但不能用最终加权均价和未来持仓量反推最初Entry表现。

已确认的数据/语义问题先于参数优化：ETHFI两个明确订单角色被周期聚合标成CONFLICT；概率加权收益的非触达分支使用假设profit floor而非实测亏损，`VERIFIED`易误解为校准EV；资金费UNKNOWN、稀疏早期路径和旧周期关联晚run限制了学习样本。

| 层级 | 发现 | 影响 / 优先级 |
|---|---|---|
| PROVEN | ETHFI TP+MANUAL是两个不同身份；周期roles union返回CONFLICT | P0：来源展示/学习资格污染，不能抹掉真实身份冲突 |
| PROVEN | 165近期闭合记录资金费均UNKNOWN，canonical eligible=0 | P0：不能提供正式净胜率/EV或直接训练收益标签 |
| PROVEN | expectedNetAtHorizon非触达payoff是负profit floor；historical touch概率未包含实际执行/亏损分布 | P0：经济证据语义过强；不是证明所有Entry失效 |
| PROVEN | 19/21 horizon超期；16/21快照HUMAN_MANAGED | P1/P3：Entry目标与接管后库存生命周期不同 |
| STRONG_EVIDENCE | AAVE早期负向、样本MFE不足费用；ETHFI初期负向、晚TP部分后人工亏损 | Entry/Exit分解，不能声称缺口中不存在更好价格 |
| STRONG_EVIDENCE | 41关联PRIMARY调用约97秒，完成时输入quote约105秒旧 | P1/P2：决策上下文延迟；不是证明JIT下单用了旧quote |
| UNKNOWN | 真正全路径MAE/MFE、未命中政策收益、精确TP命中概率、人工退出避免的后续亏损 | 不填0、不制造反事实 |

## 2. Phase A 正式收尾

先完整读取指定prompt、handoff及上一轮验收报告；fetch后main从a5e21b2推进85eed50，active worktree无遗留fan-out修改。正式closeout已单独提交9eabbc4并普通FF推送。历史样本/CPU原始与gzip、timing、identity、request artifacts存在，lossless配对验证通过；见[PHASE_A_CLOSEOUT.json](PHASE_A_CLOSEOUT.json)。只读核对既有[GitHub Actions Verify #697 SUCCESS](https://github.com/3684993/ZDJMITS/actions/runs/37759949272)，未手动触发或重跑Actions。

Fan-out修复**COMPLETE且有效**：entry journal calls2622→1–4，manual141→4，claim stats457–523ms→0.12–6.92ms，completion1460–1885ms→520–638ms。整体Engine Reactivity仍**FAIL**：loopmax约6140ms/p95约35.55ms、REQUIRED_MARKET四个timeout identities、market非持续fresh；6.14秒stall唯一调用链**UNKNOWN**。后续Reactivity **PAUSED等待独立专项**，本轮没有扩展修复/verify/重启/长观察。

## 3. 数据锚、覆盖与计算

开放持仓锚：2026-10-08 18:29:05.489+08，snapshot.ts1791455345489；account READY/asOf1791455341199。逐symbol详情约18:34独立采集，21次中BNBUSDC_SHORT自然返回404，其余20数量一致。HTTP、settings读事务、ownership读事务不是原子快照。后续exact owner查找是另一个时间点；16HUMAN/5AUTO快照与后来的17HUMAN/4HANDOFF_PENDING不被当作同刻矛盾。

quote freshness按当前代码取last/mark/bid/ask独立字段最小时间戳，<=5000ms才使用当前价格；8笔FRESH，13笔stale/missing为UNKNOWN。ATR为最新连续已闭合20根bar的SMA true range，分别核对1m/5m/15m收盘边界；不是Wilder ATR，也不是未来命中概率。私有快照uPnL保留原字段，市场旧字段不插值。

取755个留存TradeRecord（上限5000未截断）、最近滚动周165闭合；5000留存executionFills并对两案例所有linkedFillIds逐一证明存在。183个exact linked run IDs、184个TQ episode IDs有界查询；仅54个run有非空归档payload。分symbol、scope、ts索引读取最多50001 mark rows，所有查询未达到上限。原始marks仅约2日retention，所有已获取TQ早期5m路径SPARSE；两案例最大间隙约11分钟。**没有完整早期路径、不是连续交易所tick、不是回测**。

价格路径只使用receivedAt−ts在0–5000ms的记录。MAE/MFE按方向及固定锚计算；有加仓时固定锚指标不等于当时库存PnL。above/below只累计相邻<=5秒的观察区间，剩余时间明确unknown；禁止跨缺口连线。MFE/MAE是被观察的幅度下界，“time to MFE”仅到样本最高点，MFE=0时不能解读为真实盈利峰值时间。

固定数量毛PnL=(exit−entry)×qty×side，不再次乘杠杆。margin≈notional/leverage仅诊断，不能当cross allocated margin；手续费按fill真实资产/数量，funding独立UNKNOWN。参照[Binance PnL说明](https://www.binance.com/en-ZA/support/faq/detail/3a55a23768cb416fb404f06ffedde4b2)、[手续费说明](https://www.binance.com/en-NZ/support/faq/detail/98488a516eb84e3eb34605683dffd554)及[独立income/funding ledger](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#get-income-history)。USDT与USDC分别汇总，不证明两者任何时刻严格1:1。

## 4. AAVEUSDT 精确 reconstruction

cycle `cycle_entry_intent_muyy90ez_iu1tjkcq`；intent `intent_muyy90ez_iu1tjkcq`；Entry run `airun_muyy6vcx_v6rixmfo`。11:01:07.719→17:07:03.479，6.098822h，11.4@175.79→172.79。gross−34.2；entry fee0.4008012、exit fee0.7879224；**ex-funding −35.3887236 USDT**对应显示−35.39。funding UNKNOWN，formal net未成立。22entry+1exit，23个linked fills全部留存。

| fill | exchange / client | scoped registry / resolve | manual match | TP match | final |
|---|---|---|---|---|---|
| exchange_AAVEUSDT_66483538，11.4@172.79，USER_DATA_WS | 427802880 / v396x46ede71601c21ed2414ad1bff0c243 | TESTNET/binance-primary/AAVEUSDT；MANUAL / SYSTEM_PROVEN | manual_order_manual_intent_muzbbkji_dbsxhsy2 | 无 | SYSTEM_MANUAL |

fillRole=EXIT表示成交阶段，不是registry EXIT provenance。原TP exchange427712900、176.18、0fill后CANCELED；局部存在同一TP身份的重复恢复对象，但未匹配到人工身份。17:07附近状态更新时间在人工fill约5.083秒前，不把local updatedAt当作交易所取消回执。具体close事件及所有identity见[case-AAVEUSDT.json](case-AAVEUSDT.json)、[close-events-AAVEUSDT.json](close-events-AAVEUSDT.json)。

PRIMARY：LONG TREND_RESUMPTION / TREND、confidence.72，target176.18、**targetHorizon15min**。entry horizon1min是授权TTL。15m/5m顺势、1m负向回调；prose给174.80/173.73失效条件，但durable TradePlan为NO_PREDICATE。model run98.345秒；输入quote在完成时106.015秒旧，firstfill再晚11.677秒。候选cand_13d027b258c56e21a02b726e被冻结，raw/normalized/actualTP176.18一致，fillToIdeal+4.553bps；execution loss不能直接归因网络或模型。

4257 fresh mark samples：observed MFE0.005066%，MAE2.434661%；样本峰值175.79890589在1.169min，最低171.51010969，maxgap11.239min。前5/15/60min的(MFE,MAE)%约(0.0051,0.4722)/(0.0051,1.0907)/(0.0051,1.5462)，窗口末分别−0.2473/−1.0772/−1.5373%。被观察正向幅度不足实际fee约0.0593%；没有观察到target touch不代表间隙内从未touch。

标签：BAD_ENTRY / DIRECTION_WRONG_EARLY **STRONG_EVIDENCE**；HOLD_TOO_LONG（约24.4×目标horizon）**PROVEN描述事实**；MANUAL_RESCUE动作**PROVEN**、避免的未来亏损UNKNOWN；GOOD_ENTRY_BAD_EXIT、PROFIT_GIVEBACK缺少支持。缩短盈利TP不会在现有保留路径中把这笔坏Entry变成好交易。人工操作动机仅用户陈述，无独立结构化reason。

## 5. ETHFIUSDC 精确 reconstruction

cycle `cycle_entry_intent_muyvhnis_rlba6wa6`；intent `intent_muyvhnis_rlba6wa6`；run `airun_muyvfk33_j0jtiyxu`。09:43:54.172→17:06:17.211，7.373066h。总entry3611.6，最终entryVWAP0.7285578247867989、exitVWAP0.7240821741056598；gross−16.16426，entry fees0、exit fee0.42981198；**ex-funding −16.59407198 USDC**对应−16.59，funding UNKNOWN。316entry+17exit=333linked fills全部留存。

| fills（逐fill明细在CSV） | exchange / client | registry / resolve | manual match | TP match | cycle聚合 |
|---|---|---|---|---|---|
| exchange_ETHFIUSDC_63972354…63972369，16笔、118.5@.7324，15:37:40.143–49.399 | 158623772 / v396x2ebcc6d12582486e6360b9b163b251 | TP / SYSTEM_PROVEN | 无 | tp_muyvit6u_defoppbl | TP |
| exchange_ETHFIUSDC_63982896，3493.1@.7238，17:06:17.211 | 158727542 / v396xf4237e9d3ccb02bd6caf8865518183 | MANUAL / SYSTEM_PROVEN | manual_order_manual_intent_muzbar0g_odj7vrih | 无 | MANUAL |

16TP exits占3.2811%，最后manual96.7189%。TP realized+.22515；manual−16.38941。**两个不同identity角色相加，router.tradeCloseProvenance roles.size>1→CONFLICT**。逐身份没有dual-role、不存在staleTP falsely matching manual、重复manual registry或maker推断。实际末次平仓为人工、整个周期是mixed TP/manual；CONFLICT是过粗的聚合语义，不是证实身份collision。最小安全更正仅列计划：分开finalizer、exit composition、identity conflict，不能简单改字符串或默认人工。

原TP最终CANCELED/filled118.5，最后留存qty1252.1的原始/剩余语义不足，不能据此指控早期覆盖不足。人工前剩余TP tp_muzaaodz_c7vj2h06 /158720894，target.7353/qty3493.1/0fill，local取消更新约早2.560秒；其间target .7324→.7357→.7358→.7353及rejection/reprice见完整关联对象。

四个entry lots（不能用最终成本回填之前路径）：

| lot fillAt +08 | qty | entry |
|---|---|---|
| 09:43:54.172 | 1370.6 | .7305 |
| 15:42:09.672 | 308.2 | .7343 |
| 16:20:29.199 | 801.2 | .7313 |
| 16:35:29.750 | 1131.6 | .7227 |

原模型TREND_RESUMPTION但regime RANGE，confidence.65，15m/1m上行、5mMACD偏空，target.7324/60min；prose失效.7275/.7251，durable NO_PREDICATE。run96.212秒，完成时quote100.589秒旧。

5030fresh samples/maxgap11.151min。用**origin .7305**，前5/15/60min (MFE,MAE)%约(.0378,.2190)/(.0378,.6845)/(.0378,.7652)，窗口末−.2190/−.5719/−.3706%。fullhold样本峰.73589051在356.848min，**早于第二lot**；origin MFE.737921%，最低.70013991；首次观察到bid达到原TP在354.442min，远超60min。最终VWAP算法得到MFE1.00646%仅为固定成本锚，不适合原Entry归因或乘未来3611.6计算早期峰值PnL。

标签：初期方向/时机不足 STRONG_EVIDENCE；不能直接标GOOD_ENTRY_BAD_EXIT。HOLD_TOO_LONG/人工finalizer PROVEN；迟到盈利机会后最终ex-funding亏损支持PROFIT_GIVEBACK，但完整峰值捕获比例、逐lot edge及加仓决策因果UNKNOWN。MANUAL_RESCUE动作成立，收益增益未知。身份细节与原/投影record、fills、plans、events均见[case-ETHFIUSDC.json](case-ETHFIUSDC.json)、[case-exit-identities.csv](case-exit-identities.csv)。

## 6. 全部当前持仓 TP 表

表中mark/executable来自独立fresh detail；UNKNOWN包含stale和自然404。LONG executable=bid，SHORT=ask。TP distance以方向计算。表及后续附表共同覆盖所有21笔；全字段可复算JSON/CSV，不用静态百分比得出统一结论。

'''+current_table+'''
9 FIXED_PROFITABLE、10 AI、2 STRUCTURE_15M；来源说明原TP不是全部由当前Qwen决定。当前entry距离range.2064–2.0211%；fresh剩余range.1547–11.4899%。SOL/BCH/XLM/DOT/BTC long的剩余ATR倍数与原目标horizon严重不匹配，属于**需重新评估**库存，而不是统计证明其未来必不命中。绝对命中概率/期望time-to-hit全部UNKNOWN：ATR不是扩散模型，样本缺口/加仓/未充分regime校准不允许报伪精确概率。

### 6.1 成本、保证金与收益

'''+cost_table+'''
*notional÷L/显示ROI仅诊断；精确cross allocated margin与精确return-on-margin UNKNOWN。毛TP假设当前全部inventory恰在target成交；已记录entryfee可能只覆盖origin/部分cycle，不代表所有adds。exit fee采用Settings TAKER.0004情景，USDC实际maker可能0，不是实际未来费用；funding均UNKNOWN。因此全成本netTP均UNKNOWN，JSON中的knownCostsTpPayoffExFunding只是说明性gross−部分已知fee−假设exitfee。

私有快照USDT uPnL−1820.2826，USDC−227.3638；account另一个asOf总数略不同，不强行闭合。可用USDT119.1586、USDC3744.1180反映分资产利用不平衡，不能将组合暴露变成未经授权的第二Entry硬否决，也不能断言这是Qwen本身造成。

### 6.2 MAE/MFE、持仓路径和波动

'''+path_table+'''
*全部路径SPARSE，数值为样本锚指标；多lot用固定锚，不是完整positionPnL；0MFE的time仅最高已观察样本。早期old positions早于2日保留窗口，巨大unobserved不算零波动。不能用上表训练全路径BAD_ENTRY/GOOD_ENTRY_BAD_EXIT。无fresh闭合1m bar就不报ATR1m。spread保留于JSON；大额整仓可执行深度/滑点UNKNOWN，best bid/ask不保证全部成交。

### 6.3 TP身份和保护证据

'''+tp_table+'''
这些是快照lastVerifiedAt/open-order事实，不能证明全过程保护连续或自然lost-ACK终态恢复。完整identity、coverage status及各字段采集时点保留在[position-quality-metrics.json](position-quality-metrics.json)。BNBUSDC_SHORT随后自然不存在，不以404宣告TP故障。19/21超horizon与保留TP、HUMAN/HANDOFF流程并不矛盾；lossHandoff四个连续15m亏损bar接管，24h management deadline也不是Entry盈利horizon。

## 7. 最近 TradeRecord 的分布与选择偏差

滚动周2026-10-01 18:29:05.489→10-08 18:29:05.489，165closed；62COMPLETE、103PARTIAL；provenance66TP/3SYSTEM_MANUAL/1CONFLICT/95UNKNOWN。**165资金费UNKNOWN，正式canonical样本0**。正式胜率、净EV、TP真实概率全部UNKNOWN。

另列非canonical、**ex-funding诊断**：61 ledger-complete且无provenance conflict，59盈利2亏损（96.7213%），59TP/2manual；USDT45笔(43wins/2loss)，+117.89584631；USDC16笔全赢，+110.44517608。跨资产数值和228.3410仅quote单位情景，非经FX核实组合净利润。manual两笔exfund总−87.3095676；第三BTC manual为PARTIAL，34.5216h，−1.09753不进入该组。ETHFI mixed虽ledgercomplete单列；纳入ledger诊断62笔总211.74695041仍不变canonical资格。

61诊断持仓median.8511h/mean5.4643h/p9510.5159h/max195.9115h；59winner median.8204h/mean5.5304h；2loser median/mean3.5134h。**这里不能声称loser平均更久，赢家长尾反而使平均更大。** 34/61超targethorizon，51/61保留样本观察到mark正向达到已知fee，但不是完整执行/资金费覆盖；早期5m/15m完整样本均0。59/61TP是closed selected cohort中退出构成，**不是所有Entry的prospective TP-hit概率**；未关闭大亏库存必须右删失同时纳入。

| regime（保留诊断标签，不是因果结论） | n / wins | ex-funding quote sum | median / mean hold h |
|---|---|---|---|
| LOW_VOLATILITY | 32 / 30 | 46.6860 | .6457 / 8.2282 |
| RISK_OFF | 21 / 21 | 135.8540 | 1.0353 / 2.0660 |
| MIXED | 6 / 6 | 38.6536 | 1.9524 / 3.3385 |
| RISK_ON | 2 / 2 | 7.1474 | 3.3013 / 3.3013 |

symbol分布、每cycle gross/fees/funding/entry/exit/horizon/reprice/slippage/path/标签见[recent-cycle-quality-metrics.csv](recent-cycle-quality-metrics.csv)与JSON；小样本分组不排序当优化指南。uncertainty103PARTIAL+1mixed共104单独列，不使用其表面胜率学习。closed小赢与当前开放亏损不能直接算同一期间策略总PnL，但足以说明96.7%闭合诊断胜率不代表整体book质量。

## 8. PRIMARY/Qwen Entry 分解

实际PRIMARY resource `brain-7900-primary`，enabled，8084/v1，alias **qwen/qwen3.8-27b**，GPU7900XTX24GB/maxConcurrency1；服务器/v1/models自报27,320,697,856参数、Q4_K - Medium、context65536、llamacpp。case modelIdentity GGUF `Qwen3.8-27B-Q4_K_M.gguf`与runtime一致；这是configured/server-reported确认，不是对训练来源做认证。REVIEW8083亦27b、SCOUT8081 qwen3.5:9b，无任何资源变更。

41 recentclosed关联run有非空payload，全为此alias；其中旧UNI周期 `trade_cycle_UNIUSDT_LONG_5651fce1-552b-4789-a08e-5e6d565f6a32`关联run比origin fill晚693802077ms。**不得把该run当原始Entry、不得把负delay截成0**。剔除后40个时序有效origin关联、39个ex-funding诊断(38wins/1loss，总142.12114919 quote情景)；仍非canonical，也不代表active model总体绩效。见[model-attribution-addendum.json](model-attribution-addendum.json)。原quality-summary firstFillDelay聚合含该异常，明确不采用。

41关联调用latency median96.972秒/p95102.503秒；完成时输入quote age median105.132秒/p95111.130秒。统计的是关联调用本身，其中一条不能代表origin。JIT/执行前fresh事实另有确定性检查，不将模型输入延迟等同非法下单。未来应记录decision-context age、feature窗口、firstfill时fresh facts和side-normalizedslippage，避免靠resource BUSY推断原因。

| 候选失效机制 | 本轮判定 |
|---|---|
| 追涨/ENTRY_LATE | AAVE/ETHFI具备较长决策耗时，但完整前置执行路径不足；UNKNOWN因果 |
| 方向与时机错误 | 两案例最初5–60min样本负向，AAVE尤其强；STRONG_EVIDENCE |
| regime不一致 | ETHFI RANGE + TREND_RESUMPTION +5m偏空 PROVEN输入/输出混合，效果因果未校准 |
| 波动/流动性选择 | 当前ATR可核实，历史实际深度与逐lot输入不足；UNKNOWN |
| reward-to-cost | 确定性费用边界可用；触达概率及未触达EV“VERIFIED”语义过强 PROVEN |
| 乐观horizon | AAVE15min/ETHFI60min远早于持仓结束，PROVEN脱节；不能强制horizon即平仓 |
| mean-reversion vs momentum | 模型setup/多frame理由不够形成校准类别；需typed对照与样本 |
| 已拥挤quote exposure | 当前USDT/USDC可用/库存不均衡；不可因果归咎这两run，不新增portfolio硬veto |
| Entry vs执行 | fillToIdeal signed指标需side归一与lot分开，原整体median−6.134bps不直接解释为好滑点 |
| Entry vsTP/Exit | AAVE像badEntry；ETHFI为坏早期+迟到TPpartial+adds+manual，不能统一badExit |

148/165 durable NO_PREDICATE、15CLOSED_BAR_BREAKS_LEVEL、2missing。自由文本失效条件并未转成机器谓词；这是语义落差，不建议regex任意转成自动平仓。aiFabric把reason复制到多个frame的normalized解释不代表模型独立给出1d/1w推理。Entry horizon1–5min是authorization TTL，TP targetHorizon是盈利目标，ownership deadline是安全生命周期，三者不可混同。

source `quantityHorizonCandidates.ts` 的p×expectedNetProfit+(1−p)×−requiredNetProfit不包含non-touch真实损失分布；`historicalTpReachability.ts`以历史anchor close与未来high/low触达计算，重叠65/68窗口非独立prospectivefill。AAVE p.9231/ETHFI p.8824可当描述性历史touch估计，不是可信命中率或无条件EV；confidence不是authority也不默认硬veto。

## 9. Exit/TP 假设与成本反事实

33个单lot、无冲突ledgercomplete、有原run/target/horizon的保留样本，用horizon内fresh bid/ask touch与actual entryfee、exitTaker.0004情景做**探索性机会下界**，不模拟fill queue/funding。

| policy | 可行成本样本 | observed executable touch /33 | conditional touch payoff ex-funding sum | observed touch median min |
|---|---|---|---|---|
| 原TP / 原horizon | 33 | 2 | 3.0385 | 12.0844 |
| 原TP move的一半（诊断benchmark） | 33 | 13 | 14.0869 | 10.0300 |
| entry ATR15m一倍 | 33 | 0 | 0 | UNKNOWN |

13比2多11个已观察机会，**不是提高11/33实际TP命中率**。没有完整non-touch收益、premature exit后续机会、触达深度/排队/手续费/资金费；0observed ATRtouch也不证明真实0。AAVE半move target175.985仍未观察触达，印证不能靠缩TP治疗badEntry。详见[policy-counterfactual-bounds.json](policy-counterfactual-bounds.json)。

所有以下政策的额外实际TP hit-rate、全成本EV、提前退出损失、平均hold、capitalturnover、manual减少与跨regime稳健增益均**UNKNOWN**，不是不做分析，而是现有数据不能识别这些量：

| 候选 | 可检验机制 / 主要风险 |
|---|---|
| volatility-normalized | 同entry时点closedATR+成本floor比较；bar range不是first-passage概率 |
| regime-aware | momentum vsrange分层，避免对小样本过拟合 |
| horizon-aware / max-hold review | 超目标后调用既有review，不能把TTL改成exit或HUMAN自动执行 |
| time-decay / dynamic edge tightening | versioned剩余edge与成本，用shadow检验退出收益/错失再涨 |
| break-even / profit protection | 足够可执行MFE且全成本证明后才候选，震荡手续费/重复修改风险 |
| trailing | 独立完整路径、峰值水位与重启durability，否则尖峰触达不保证收益 |
| staged exit | ETHFI自然partial表明部分成交存在，但主动分档需证明qty守恒/TP覆盖/ownership和交易所约束 |

关键反驳：先全局降低固定TP或自动到点平仓并无科学证据，会混淆坏Entry与坏Exit，并可能侵犯HUMAN authority。更好的顺序是P0净收益/provenance→P1完整有界路径→P2compact反馈→P3versionedExitreview→P4shadow/walk-forward；实施前事实层需单独验收。现有Exit review已存在，不新增重复模型，更不使REVIEW成为第二Entryveto。

## 10. 运行边界与复现限制

初始/最终boundary保持TESTNET_ENABLED/lockedToTestnet、Production writes=0；Engine PID43308未变化，model和SOCKS监听未操作，Settings版本247；自然Engine testnetWrites变化是服务继续运行，不是本轮下单。本轮交换写/Settings写/生命周期动作/fullverify均0。最终一次boundary GET用于边界核对，不是稳定性观察或新Reactivity验收。详见[final-boundary.json](final-boundary.json)、[final-listeners.json](final-listeners.json)。

离线CLI首次路径错误与随后256MB heap加载198MB JSON OOM都保留log；失败仅诊断CLI，不是Engine崩溃，随后以17MBslim entities在同heap运行纯投影成功。没有因此调服务/模型/系统内存。

原始durable-entities.json约198MB本地保留，GitHub采用**lossless durable-entities.json.gz**及SHA256而非上传超过单文件限制；markpaths losslessgzip，其他JSON/CSV、采集/分析脚本和日志同行提交。gzip恢复出的JSON哈希见[durable-entities-hashes.json](durable-entities-hashes.json)。第一轮secret红线redactor也过宽屏蔽aiAuthorizationExpiresAt/token统计，非缺失事实；后续exactlinked run保留合法计数。没有发布凭据。

未关闭的独立工作：Reactivity仍FAIL、6.14s callerUNKNOWN；资金费完整性、真实自然lost-ACKTP恢复、历史缺口、model晚run归因原因均未解决。本轮不扩大工作；F04/F10/F11保持暂停。下一步仅是[优化实施计划](../../plans/V397_ENTRY_EXIT_TP_QUALITY_OPTIMIZATION_PLAN_20261008.md)的评审，非已批准上线。
'''
(p/'TRADE_ENTRY_EXIT_QUALITY_REVIEW.md').write_text(report,encoding='utf-8')
print('report bytes',len(report.encode()),'identity rows',len(identity),'valid Qwen',len(valid),len(clean))
