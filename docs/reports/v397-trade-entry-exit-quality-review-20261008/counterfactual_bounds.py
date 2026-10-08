import json,pathlib,gzip,statistics,collections
p=pathlib.Path('docs/reports/v397-trade-entry-exit-quality-review-20261008');q=json.loads((p/'quality-summary.json').read_text());r=json.loads((p/'recent-cycle-quality-metrics.json').read_text());R=json.loads((p/'linked-primary-runs.json').read_text(encoding='utf-8'));raw=json.loads((p/'offline-projected-records.json').read_text(encoding='utf-8'));raw={x['tradeId']:x for x in raw};E=json.loads((p/'analysis-entities-slim.json').read_text(encoding='utf-8'));paths={f.name.split('.')[0]:sorted(json.loads(gzip.decompress(f.read_bytes()))) for f in (p/'mark-paths').glob('*.gz')};policies=[]
for policy in ('HALF_ORIGINAL_TP_MOVE','ONE_ENTRY_ATR15M','ORIGINAL_TP_AT_ORIGINAL_HORIZON'):
 evidence=[]
 for x in r:
  t=raw[x['tradeId']];run=R.get(x['entryRunId']);
  if not x['exFundingDiagnosticEligibleNoProvenanceConflict'] or x['entryLots']!=1 or not run or not x['targetHorizonMinutes'] or not x['target']:continue
  try:packet=json.loads(run['inputPreview'])['packet']
  except:continue
  entry=t['entryAveragePrice'];qty=t['entryQty'];sign=1 if t['direction']=='LONG' else -1;distance=abs(x['target']-entry);atr=packet.get('market',{}).get('technical',{}).get('15m',{}).get('atr14')
  if policy=='HALF_ORIGINAL_TP_MOVE':target=entry+sign*distance*.5
  elif policy=='ONE_ENTRY_ATR15M':
   if not isinstance(atr,(int,float)) or atr<=0:continue
   target=entry+sign*atr
  else:target=x['target']
  expected=qty*target*.0004;payoff=sign*(target-entry)*qty-t['entryFee']-expected;horizon=t['openedAt']+x['targetHorizonMinutes']*60000;rows=[z for z in paths.get(t['symbol'],[]) if t['openedAt']<=z[0]<=min(t['closedAt'],horizon) and 0<=z[4]-z[0]<=5000];hits=[z for z in rows if z[2 if sign==1 else 3] is not None and sign*(z[2 if sign==1 else 3]-target)>=0];evidence.append({'tradeId':x['tradeId'],'target':target,'entryFeeKnown':t['entryFee'],'exitFeeScenario':expected,'conditionalPayoffExFunding':payoff,'costFeasible':payoff>0,'sampledExecutableTouch':bool(hits),'firstTouchMinutes':(min(z[0] for z in hits)-t['openedAt'])/60000 if hits else None,'completeExecutablePath':False,'actualExitProvenance':x['closeProvenance'],'funding':'UNKNOWN','futureFillGuarantee':False})
 feasible=[x for x in evidence if x['costFeasible']];hits=[x for x in feasible if x['sampledExecutableTouch']];policies.append({'policy':policy,'eligibleSingleLotKnownRun':len(evidence),'costFeasible':len(feasible),'observedExecutableTouchesWithinHorizon':len(hits),'conditionalPayoffAtObservedTouchExFundingQuoteSum':sum(x['conditionalPayoffExFunding'] for x in hits),'observedTimeToTouchMinutesMedian':statistics.median(x['firstTouchMinutes'] for x in hits) if hits else None,'additionalActualTpHitRate':'UNKNOWN_SPARSE_PATH_AND_QUEUE_FILL_PROBABILITY','expectedNetPnl':'UNKNOWN_NO_NONTOUCH_LOSS_AND_FUNDING_DISTRIBUTION','downsidePrematureExitCost':'UNKNOWN','capitalTurnover':'UNKNOWN','manualInterventionReduction':'UNKNOWN','robustness':'UNKNOWN_TOO_SMALL_AND_SELECTED_COHORT','evidence':evidence,'status':'EXPLORATORY_TOUCH_BOUND_ONLY_NOT_EXIT_POLICY_BACKTEST'})
(p/'policy-counterfactual-bounds.json').write_text(json.dumps(policies,indent=2),encoding='utf-8');print([{k:v for k,v in x.items() if k!='evidence'} for x in policies]);print('modelnames',collections.Counter(x.get('model') for x in R.values() if x));print('currentmodelclosed',[(x['symbol'],x['exFundingNet'],x['closeProvenance']) for x in r if x['runPresent'] and x['exFundingDiagnosticEligibleNoProvenanceConflict']][:10])
