"""Separate derived exchange reconstruction; never rewrites live/archived TradeRecords."""
import pathlib,json,gzip,csv,collections,datetime,statistics,math
root=pathlib.Path(__file__).resolve().parents[1];out=root/'docs/reports/v398-entry-sizing-quality-review/evidence-20261008'
read=lambda n:json.loads((out/n).read_text(encoding='utf-8'))
history=read('eth-avax-bounded-history.json');entities=json.loads(gzip.decompress((out/'bounded-entities.json.gz').read_bytes()));cases=read('eth-avax-case-facts.json')
save=lambda n,v:(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
rows=[];summary=[]
for case in cases:
 p=case['position'];symbol=p['symbol'];side=p['side'];by_order=collections.defaultdict(list)
 for w in history['windows']:
  if w['symbol']!=symbol or not isinstance(w.get('fills'),list):continue
  for fill in w['fills']:
   if fill['positionSide']==side and fill['side']==('BUY' if side=='LONG' else 'SELL') and fill['time']>=p['openedAt']:
    if not any(f['id']==fill['id'] for f in by_order[str(fill['orderId'])]):by_order[str(fill['orderId'])].append(fill)
 for index,(order_id,fills) in enumerate(sorted(by_order.items(),key=lambda pair:min(f['time'] for f in pair[1]))):
  local=next((o for o in entities['entryOrders'] if o['symbol']==symbol and o.get('exchangeOrderId')==order_id),None)
  intent=next((i for i in entities['entryIntents'] if i['id']==(local or {}).get('intentId')),None)
  qty=sum(float(f['qty']) for f in fills);cost=sum(float(f['quoteQty']) for f in fills)
  rows.append({'symbol':symbol,'side':side,'physicalCycleId':p['cycleId'],'orderIndex':index,'exchangeOrderId':order_id,'localOrderId':(local or {}).get('id'),'intentId':(intent or {}).get('id'),'runId':(intent or {}).get('brainRunId'),'firstFillAt':min(f['time'] for f in fills),'lastFillAt':max(f['time'] for f in fills),'fillCount':len(fills),'quantity':qty,'entryPrice':cost/qty,'entryCostNative':cost,'nativeCommission':sum(float(f['commission']) for f in fills),'commissionAssets':','.join(sorted({f['commissionAsset'] for f in fills})),'originalAuthorizedQuantity':(local or {}).get('quantity'),'intentLeverage':(intent or {}).get('leverage'),'planId':(intent or {}).get('planId'),'recordedHumanHandoffAt':p.get('humanManagedAt'),'filledAfterRecordedHumanHandoff':bool(p.get('humanManagedAt') and min(f['time'] for f in fills)>p['humanManagedAt']),'primaryArchiveComplete':False,'noAddRetainedActualQty':qty if index==0 else 0})
 grouped=[r for r in rows if r['symbol']==symbol];total=sum(r['quantity'] for r in grouped)
 summary.append({'symbol':symbol,'side':side,'independentEntryOrders':len(grouped),'separateAddOrders':len(grouped)-1,'displayAddCount':p['addCount'],'nativeEntryQuantity':total,'freshOrPersistedPositionQuantity':p['quantity'],'quantityConserved':abs(total-p['quantity'])<1e-8,'ordersMatchedLocalIntent':sum(r['intentId'] is not None for r in grouped),'distinctRunReferences':len({r['runId'] for r in grouped if r['runId']}),'independentOrdersAfterHumanHandoff':sum(r['filledAfterRecordedHumanHandoff'] for r in grouped),'authorityCompletedRunProof':'UNKNOWN','localRecordEntryQty':case['record']['entryQty'],'localRecordLotSum':sum(l['quantity'] for l in case['record']['entryLots']),'derivedOnly':True})
save('exchange-cycle-reconstruction.json',{'historyUntil':history['until'],'summary':summary,'lots':rows,'coverage':'Fixed 6-day windows, <1000 results each; no exits in target side; native sum agrees with position; retrospective REST observation does not prove prior WS continuity or Primary model approval'})
with (out/'exchange-lots-by-cycle.csv').open('w',newline='',encoding='utf-8') as f:
 w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
current=read('testnet-signed-readback.json');features=[]
for p in current['positions']:
 symbol=p['symbol'];rows_by_tf={}
 for tf in ['1w','1d','4h','1h','15m']:
  file=out/f'bars-{symbol}-{tf}.json';rows_by_tf[tf]=read(file.name)['rows'] if file.exists() else []
 weekly=rows_by_tf['1w']; w=weekly[-52:];loc=None;atr=None;vol=None
 if len(w)==52:
  lo=min(float(r[3]) for r in w);hi=max(float(r[2]) for r in w);loc=(float(w[-1][4])-lo)/(hi-lo) if hi>lo else None
 if len(weekly)>=15:
  trs=[max(float(weekly[i][2])-float(weekly[i][3]),abs(float(weekly[i][2])-float(weekly[i-1][4])),abs(float(weekly[i][3])-float(weekly[i-1][4]))) for i in range(len(weekly)-14,len(weekly))];atr=statistics.mean(trs)
 d=rows_by_tf['1d'][-31:]
 if len(d)==31:vol=statistics.stdev([math.log(float(d[i][4])/float(d[i-1][4])) for i in range(1,len(d))])
 features.append({'symbol':symbol,'side':p['positionSide'],'asset':p['marginAsset'],'mark':float(p['markPrice']),'quantity':abs(float(p['positionAmt'])),'reportedUnrealizedPnl':float(p['unRealizedProfit']),'currentClosedWeekly52RangeLocation':loc,'weeklyAtr14Sma':atr,'daily30LogReturnVol':vol,'barCounts':{k:len(v) for k,v in rows_by_tf.items()},'asOfBarClose':weekly[-1][6] if weekly else None,'featureMeaning':'CURRENT_CLOSED_BAR_DESCRIPTION_NOT_HISTORICAL_DECISION_OR_LIVE_SIZE_AUTHORITY','decisionTimeLocation':'UNKNOWN','sourceObservedAt':current['capturedAt']})
save('current-position-feature-strata.json',features)
print(json.dumps(summary))
