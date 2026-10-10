"""Compute descriptive statistics from archived, sanitized natural counters. No live calls."""
import json, pathlib, math, collections, datetime
out=pathlib.Path(__file__).resolve().parent
rows=json.loads((out/'natural-gpu-baseline.json').read_text(encoding='utf-8'))
def stats(values):
 values=sorted(v for v in values if isinstance(v,(int,float)) and math.isfinite(v))
 return {'n':len(values),'p50':values[math.ceil(len(values)*.5)-1] if values else None,'p95':values[math.ceil(len(values)*.95)-1] if values else None,'max':values[-1] if values else None}
start,end=rows[0]['asOf'],rows[-1]['asOf']
report={'scope':'NATURAL READONLY PRE-DEPLOYMENT OBSERVATION','sampleCount':len(rows),'coveredFrom':start,'coveredTo':end,'minutes':(end-start)/60000,'source':'WINDOWS_WDDM_PROCESS_COUNTERS + existing Engine projection','collectionMs':stats([r.get('collectionMs') for r in rows]),'intervalMs':stats([b['asOf']-a['asOf'] for a,b in zip(rows,rows[1:])]),'sourceErrors':dict(collections.Counter(e for r in rows for e in r.get('errors',[]))),'services':[],'resourceCounters':[]}
for port in [8081,8083,8084]:
 samples=[s for r in rows for s in r['services'] if s['port']==port];values=[s['utilizationPct'] for s in samples if s.get('measureStatus')=='MEASURED']
 report['services'].append({'port':port,'pids':sorted(set(s['pid'] for s in samples if s['pid'])),'measureStatusCount':dict(collections.Counter(s['measureStatus'] for s in samples)),'rawCounterUtilizationPct':stats(values),'rawOutOfRangeCount':sum(v<0 or v>100 for v in values),'missingSampleCount':len(rows)-len(samples),'utilizationPct':stats([v for v in values if 0<=v<=100]),'sampleFractionAbove1Pct':sum(v>1 for v in values)/len(values) if values else None,'dedicatedBytes':stats([s.get('dedicatedBytes') for s in samples]),'sharedBytes':stats([s.get('sharedBytes') for s in samples]),'physicalMapping':'SEPARATE STRONG_EVIDENCE; NEVER INFER FROM LUID ENUMERATION'})
for id in sorted(set(s['id'] for r in rows for s in r['resources'])):
 samples=[s for r in rows for s in r['resources'] if s['id']==id]
 delta=lambda k:samples[-1][k]-samples[0][k] if isinstance(samples[-1].get(k),(int,float)) and isinstance(samples[0].get(k),(int,float)) else None
 report['resourceCounters'].append({'resourceId':id,'sampleCount':len(samples),'observedTotalRunsDelta':delta('totalRuns'),'observedFailureDelta':delta('failures'),'historicalFailureCountAtStart':samples[0].get('failures'),'active':stats([s.get('active') for s in samples]),'queueDepth':stats([s.get('queueDepth') for s in samples]),'sampledIdleReasons':dict(collections.Counter(s.get('idleReason') for s in samples))})
runs=json.loads((out/'natural-run-timing.json').read_text(encoding='utf-8'))
report['latest100ObservedAt']=runs['observedAt'];report['runTimingScope']='latest100 filtered to window; incomplete population, percentiles descriptive subset only';report['observedRunTiming']=[]
for role in ['SCOUT','PRIMARY_BRAIN','REVIEW_BRAIN']:
 samples=[r for r in runs['items'] if r.get('role')==role and start<=r.get('startedAt',0)<=end and isinstance(r.get('completedAt'),(int,float)) and r['completedAt']<=end]
 report['observedRunTiming'].append({'role':role,'completedSubset':len(samples),'failedSubset':sum(r['status']=='FAILED' for r in samples),'latencyMs':stats([r.get('latencyMs') for r in samples]),'queueMs':stats([(r.get('timing') or {}).get('queueMs') for r in samples])})
report['tokensPerSecond']=None;report['sshWireBytes']=None;report['completeQueueP95']=None;report['liveOptimizationComparison']='UNKNOWN: candidate not deployed'
if len(rows)<121 or report['minutes']<30:raise SystemExit('BASELINE_BELOW_30_MINUTES')
(out/'natural-baseline-summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
