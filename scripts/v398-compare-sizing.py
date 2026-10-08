"""Reproducible diagnostic comparison. No fitted/live parameters, no exchange calls."""
import json, gzip, pathlib, csv, math, statistics, datetime, hashlib, subprocess
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'docs/reports/v398-entry-sizing-quality-review/evidence-20261008'
read=lambda name:json.loads((out/name).read_text(encoding='utf-8'))
cases=read('eth-avax-case-facts.json')
signed=read('testnet-signed-readback.json')
policies=['Uniform haircut','Linear location','Nonlinear location','Volatility targeting','Stress-loss budget','Cycle cumulative budget','Portfolio directional/factor budget','Hybrid min of bounds']
def save(name,obj):(out/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
lotrows=[]; exposure=[]; comparisons=[]; studies=[]
for case in cases:
    p=case['position'];record=case['record'];lots=sorted(record['entryLots'],key=lambda l:l['filledAt']); origin=lots[0]
    current=next((r for r in signed.get('positions',[]) if r['symbol']==p['symbol'] and r['positionSide']==p['side']),None)
    sign=1 if p['side']=='LONG' else -1
    mark=float(current['markPrice']) if current else None
    qty=0;cost=0
    for index,lot in enumerate(lots):
        line=next((l for l in case['lineage']['lots'] if l['lotId']==lot['lotId']),{})
        qty+=lot['quantity'];cost+=lot['quantity']*lot['averagePrice']
        lotrows.append({'symbol':p['symbol'],'side':p['side'],'cycleId':p['cycleId'],'lotIndex':index,'lotId':lot['lotId'],'intentId':lot.get('intentId'),'exchangeOrderId':lot.get('exchangeOrderId'),'filledAt':lot['filledAt'],'quantity':lot['quantity'],'price':lot['averagePrice'],'runId':line.get('runId'),'runCompletedAt':line.get('runCompletedAt'),'lineageStatus':line.get('status'),'ownerAtLot':'HUMAN_MANAGED_AFTER_RECORDED_HANDOFF' if p.get('humanManagedAt') and lot['filledAt']>=p['humanManagedAt'] else 'UNKNOWN_BEFORE_HANDOFF','noAddRetainedQuantity':lot['quantity'] if index==0 else 0})
        exposure.append({'cycleId':p['cycleId'],'symbol':p['symbol'],'lotAt':lot['filledAt'],'knownLotCumulativeQty':qty,'knownLotCumulativeEntryCostQuote':cost,'cycleOnlyNotPortfolio':True,'portfolioExposureAsOf':'UNKNOWN','availableMarginAsOf':'UNKNOWN','pendingReservationsAsOf':'UNKNOWN'})
    origin_qty=origin['quantity'];origin_price=origin['averagePrice']
    diagnostic_pnl=None if mark is None else sign*(mark-origin_price)*origin_qty
    weekly=read(f'bars-{p["symbol"]}-1w.json') if (out/f'bars-{p["symbol"]}-1w.json').exists() else {'rows':[]}
    # Fill-time anchor is explicitly different from missing Primary decision cutoff.
    closed=[r for r in weekly['rows'] if r[6]<origin['filledAt']]
    w52=closed[-52:]; w26=closed[-26:]
    loc=None
    if len(w52)==52:
        low=min(float(r[3]) for r in w52);high=max(float(r[2]) for r in w52)
        loc=(float(w52[-1][4])-low)/(high-low) if high>low else None
    adverse=None if loc is None else loc if sign==1 else 1-loc
    arms=[]
    for policy in policies:
        # Illustrative responses pre-specified here, never chosen using resulting PnL.
        fraction=0.5 if policy=='Uniform haircut' else 1-0.5*adverse if policy=='Linear location' and adverse is not None else 1-0.75*adverse**2 if policy=='Nonlinear location' and adverse is not None else None
        row={'symbol':p['symbol'],'policy':policy,'formalStatus':'INSUFFICIENT_EVIDENCE','formalOriginAuthorizedQuantity':None,'formalNetPnl':None,'formalMAE':None,'ES_CVaR':None,'fillAnchorScenarioOnly':True,'illustrativeFraction':fraction,'scaledActualOriginLotQuantity':None if fraction is None else origin_qty*fraction,'staticMarkExFundingPnl':None if fraction is None or diagnostic_pnl is None else diagnostic_pnl*fraction,'reason':'PRIMARY decision cutoff/complete fill lineage and historical available funds missing; illustrative scaled fill is not simulated executable fill'}
        comparisons.append(row);arms.append(row)
    studies.append({'symbol':p['symbol'],'side':p['side'],'openedAt':p['openedAt'],'displayAddCount':p['addCount'],'retainedLotCount':len(lots),'retainedIndependentFilledOrders':len(case['independentFilledOrderIdentities']),'recordEntryQty':record['entryQty'],'sumLotQty':qty,'persistedPositionQty':p['quantity'],'freshPositionQty':abs(float(current['positionAmt'])) if current else None,'originLotQty':origin_qty,'originPrice':origin_price,'freshMark':mark,'freshReportedUpnl':float(current['unRealizedProfit']) if current else None,'staticNoAddOriginOnlyUpnlExFunding':diagnostic_pnl,'staticNoAddOriginNotionalAtMark':origin_qty*mark if mark else None,'quantityReductionFraction':1-origin_qty/p['quantity'],'formalNoAddCounterfactualStatus':'INSUFFICIENT_EVIDENCE','rightCensored':True,'funding':'UNKNOWN','weeklyBarsClosedAtFirstFill':len(closed),'weekly26Coverage':len(w26),'weekly52Coverage':len(w52),'fillAnchorWeeklyRangeLocation':loc,'decisionTimeLocation':'UNKNOWN','limitations':['TradeRecord lots preserve historical facts; fills/authority not fully proven','No-add static inventory arithmetic holds observed mark fixed; changes TP, fees, execution and future fills remain unknown','No real peak-loss/continuous path or exact historic portfolio replay','No leverage multiplication in PnL']})
save('case-study-calculations.json',studies)
save('policy-comparison.json',comparisons)
for name,rows in [('lots-by-cycle.csv',lotrows),('historical-exposure-asof.csv',exposure),('policy-comparison.csv',comparisons)]:
    with (out/name).open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
positions=signed.get('positions',[]);by_asset={}
for p in positions:
    asset=p['marginAsset'];b=by_asset.setdefault(asset,{'longNotional':0,'shortNotional':0,'grossNotional':0,'netNotional':0,'unrealizedPnl':0,'initialMargin':0,'maintenanceMargin':0})
    n=abs(float(p['notional']));b['longNotional' if p['positionSide']=='LONG' else 'shortNotional']+=n;b['grossNotional']+=n;b['netNotional']+=n*(1 if p['positionSide']=='LONG' else -1);b['unrealizedPnl']+=float(p['unRealizedProfit']);b['initialMargin']+=float(p['initialMargin']);b['maintenanceMargin']+=float(p['maintMargin'])
save('portfolio-native-asset-summary.json',{'capturedAt':signed['capturedAt'],'assets':by_asset,'crossAssetAggregation':'FX_UNPROVEN','physicalMargin':'EXCHANGE_REPORTED_NOT_ALLOCATION_TO_INDIVIDUAL_CYCLE','stressLossGuarantee':False})
missing={'calibration':'INSUFFICIENT_EVIDENCE','noAddExactHistoricalCounterfactual':'INSUFFICIENT_EVIDENCE','criticalHistoricalOwnerOrderQuantityChains':'UNPROVEN','cases':[{k:s[k] for k in ['symbol','recordEntryQty','sumLotQty','persistedPositionQty','formalNoAddCounterfactualStatus','decisionTimeLocation']} for s in studies],'historicalPortfolioInventory':'UNKNOWN','fundingNetQualification':'UNKNOWN','continuousPeakDrawdown':'UNKNOWN','purgedWalkForwardAndBlockBootstrap':'NOT_RUN_UNQUALIFIED_DATA','requiredEvidence':['complete original/partial order fill identities','point-in-time owner history and pending reservations','exact Primary completed run/packet/candidate cutoff','native funding continuous coverage and allocation','closed-bar observation time and gap-free executable path']}
save('missing-facts.json',missing)
print(json.dumps(studies,ensure_ascii=False))
