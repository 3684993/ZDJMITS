"""Offline aggregation of captured read-only evidence. No runtime imports or writes."""
import collections, csv, datetime, decimal, json, pathlib, sqlite3

ROOT = pathlib.Path(__file__).resolve().parent
def read(name): return json.loads((ROOT / name).read_text(encoding='utf-8-sig'))
def save(name, obj):
    text = ('[\n' + ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',',':')) for row in obj) + '\n]\n') if name=='cohort-lineage.json' else json.dumps(obj, indent=2, ensure_ascii=False)
    (ROOT / name).write_text(text, encoding='utf-8')
window = read('coverage.json')
since, until = window['since'], window['now']
c = sqlite3.connect('file:D:/MITS/data/zdj-settings.sqlite?mode=ro', uri=True)
c.execute('PRAGMA query_only=ON')
c.execute('BEGIN')
ai = [dict(zip(['id','symbol','startedAt','status','role','decision'], row)) for row in c.execute('SELECT run_id,symbol,started_at,status,role,decision FROM ai_runs_archive WHERE started_at BETWEEN ? AND ?', (since, until))]
events = {}
def add(event, ts, payload, run=None, source=''):
    if not since <= ts <= until: return
    if not isinstance(payload,dict): payload={'unstructured':payload}
    if payload.get('auditTruncated'): payload = payload.get('summary', {})
    if not isinstance(payload,dict): payload={'unstructured':payload}
    run = payload.get('brainRunId') or payload.get('runId') or payload.get('decisionChainId') or run
    if not run: run = payload.get('intent', {}).get('brainRunId')
    # Match identical emitted events across durable chains, SQLite events and JSONL.
    key = (event, ts, run)
    if key not in events: events[key] = {'type':event,'ts':ts,'run':run,'payload':payload,'sources':[]}
    if source not in events[key]['sources']: events[key]['sources'].append(source)
for chain_json, in c.execute('SELECT payload FROM decision_chains WHERE updated_at>=?', (since,)):
    chain=json.loads(chain_json)
    for event in chain.get('events', []): add(event['type'],event['ts'],event.get('payload',{}),chain['chainId'],'decision_chains')
for typ, ts, payload in c.execute('SELECT type,ts,payload FROM runtime_events WHERE ts BETWEEN ? AND ?', (since,until)):
    add(typ,ts,json.loads(payload),source='runtime_events')
c.close()
for line in (ROOT/'chain-events-local.jsonl').open(encoding='utf-8'):
    e=json.loads(line);add(e['event'],e['timestamp'],e.get('payload',{}),e.get('traceId'),'jsonl')
primaries={x['id']:x for x in ai if x['role']=='PRIMARY_BRAIN'}
cohort=[e for e in events.values() if e['run'] in primaries]
stats={}
for hours in [72,24,12]:
    start=until-hours*3600000
    ids={k for k,v in primaries.items() if v['startedAt']>=start}
    rows=[e for e in cohort if e['run'] in ids]
    stages={t:len({e['run'] for e in rows if e['type']==t}) for t in sorted({e['type'] for e in rows})}
    admission=[e for e in rows if e['type']=='PORTFOLIO_RISK_ADMISSION_EVALUATED' and not e['payload'].get('analysisOnly')]
    # One decision per run; repeated locked re-evaluation is reported separately.
    per_run={e['run']:e for e in sorted(admission,key=lambda x:x['ts'])}
    ar=list(per_run.values()); deny=[e for e in ar if not e['payload'].get('allowed')]
    hit=collections.Counter();sole=collections.Counter();combinations=collections.Counter()
    for e in deny:
        reasons=sorted(set(e['payload'].get('reasons',[])))
        hit.update(reasons);combinations[' | '.join(reasons)]+=1
        if len(reasons)==1:sole.update(reasons)
    drops={}
    for typ in ['ENTRY_ANALYSIS_FAILED','ENTRY_DECISION_BLOCKED','ENTRY_ORDER_BLOCKED','ENTRY_EXECUTION_WAIT_TERMINATED','ENTRY_DATA_ERROR','CANDIDATE_REJECTED']:
        drops[typ]=dict(collections.Counter(str(e['payload'].get('reason') or e['payload'].get('message') or e['payload'].get('code') or next(iter(e['payload'].get('reasons',[])),'UNKNOWN')) for e in rows if e['type']==typ))
    family=collections.Counter()
    for e in deny:
        family.update({x if x.startswith('STRESS_LIMIT:') else x.split(':')[0] for x in e['payload'].get('reasons',[])})
    stats[str(hours)]={'primaryRuns':len(ids),'scoutRuns':sum(x['role']=='SCOUT' and x['startedAt']>=start for x in ai),'primaryStatus':dict(collections.Counter(primaries[x]['status'] for x in ids)),'decisions':dict(collections.Counter(str(primaries[x]['decision']) for x in ids)), 'stagesUniqueRuns':stages,'admission':{'eventCount':len(admission),'runs':len(ar),'allowed':len(ar)-len(deny),'denied':len(deny),'reasonHits':dict(hit),'soleReasonHits':dict(sole),'combinations':dict(combinations),'numericGateRows':sum(bool(e['payload'].get('gates')) for e in ar)},'drops':drops}
    stats[str(hours)]['admission']['familyHits']=dict(family)
save('quantified-chain.json',stats)
save('cohort-lineage.json',[{'run':k,'symbol':v['symbol'],'decision':v['decision'],'events':[{'type':e['type'],'ts':e['ts'],'sources':e['sources'],'reason':e['payload'].get('reason'),'reasons':e['payload'].get('reasons'),'allowed':e['payload'].get('allowed')} for e in cohort if e['run']==k]} for k,v in primaries.items()])
closeout=read('closeout-local.json');p=closeout['pipeline'];vis=p['capacityVisibility'];profile=p['portfolioRiskProfile']['values']
save('current-facts.json',{'asOf':p['asOf'],'runtime':{k:closeout['runtime'].get(k) for k in ['pid','instanceId','buildId','lastRestartAt','runtimeDataDir']},'writeBoundary':closeout.get('productionWriteBoundary'),'capacity':p['capacity'],'funding':vis['funding'],'exposure':vis['exposure'],'admission':vis['admission'],'profile':profile,'reconciliation':p['reconciliation'],'takeProfit':p['takeProfit'],'analysis':p['analysis'],'pool':p['pool'],'eligibility':p['eligibility']})
D=decimal.Decimal
route_rows=[]
for side in ['LONG','SHORT']:
    for row in vis['entryCapacity'][side]['candidates']:
        price=D(str(row['referencePrice']));ex=row['exchangeFilters'];step=D(str(ex['stepSize']))
        units=max((D(str(ex['minQty']))/step).to_integral_value(rounding=decimal.ROUND_CEILING),(D(str(ex['minNotional']))/(price*step)).to_integral_value(rounding=decimal.ROUND_CEILING))
        risk=row['risk']; ceiling=min(row['funding']['executableNotionalUsd'],risk['clusterRemainingUsd'],risk['clusterDirectionRemainingUsd'],risk['perTradeRiskRemainingUsd'])
        route_rows.append({'symbol':row['symbol'],'side':side,'referencePrice':str(price),'stepSize':str(step),'minQuantityUnits':int(units),'minQuantity':str(units*step),'minLegalNotional':str(units*step*price),'capacityWithoutPortfolioAdmission':ceiling,'maxUnitsWithoutPortfolioAdmission':int((D(str(ceiling))/(price*step)).to_integral_value(rounding=decimal.ROUND_FLOOR)),'admissionCeiling':risk['admissionCeilingUsd'],'finalExecutable':row['executable'],'primaryBlocker':row['firstBindingConstraint']})
with (ROOT/'legal-order-critical-values.csv').open('w',encoding='utf-8',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=list(route_rows[0]));writer.writeheader();writer.writerows(route_rows)
save('capture-manifest.json',{'windowStartUTC':datetime.datetime.fromtimestamp(since/1000,datetime.timezone.utc).isoformat(),'windowEndUTC':datetime.datetime.fromtimestamp(until/1000,datetime.timezone.utc).isoformat(),'sources':['SQLite mode=ro + query_only','decision_chains','runtime_events','runtime_entities','runtime JSONL','published snapshot GET','diagnostics/closeout GET'],'joinedEventCount':len(events),'primaryCohortEventCount':len(cohort),'uniquePrimaryRuns':len(primaries),'notAtomicAcrossSources':True})
print(json.dumps({k:{'primary':v['primaryRuns'],'scout':v['scoutRuns'],'decisions':v['decisions'],'admission':{q:v['admission'][q] for q in ['runs','allowed','denied','numericGateRows','familyHits']}} for k,v in stats.items()},indent=2))
