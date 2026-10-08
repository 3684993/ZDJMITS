"""Offline audit of the actual new window; background is not a critical failure."""
import pathlib,json,collections,gzip,hashlib,datetime
root=pathlib.Path(__file__).resolve().parent
raw=(root/'samples.jsonl').read_bytes();rows=[json.loads(s) for s in raw.splitlines()]
first,last=rows[0]['capturedAtMs'],rows[-1]['capturedAtMs']
def stats(values):
    v=sorted(x for x in values if isinstance(x,(int,float)))
    return {'n':len(v),'max':v[-1] if v else None,'p95':v[min(len(v)-1,int((len(v)-1)*.95))] if v else None,'min':v[0] if v else None}
def lane(source,purpose='',endpoint=''):
    if source=='EXECUTION_CRITICAL':return 'EXECUTION'
    if source in ('ORDER_VERIFICATION','PRIVATE_STATE','USER_DATA_STREAM','RECONCILIATION'):return 'PRIVATE'
    if source in ('BACKGROUND','BACKGROUND_AUDIT','RESEARCH_AUDIT','HISTORICAL_REPAIR','PORTFOLIO_RISK_CASH_FLOW'):return 'BACKGROUND_AUDIT'
    if source in ('CLOCK','HEALTH_PROBE','RATE_LIMIT_CONTROL'):return 'CONTROL'
    if source=='MARKET_DATA' and (purpose.startswith('QUOTE_') or endpoint in ('/fapi/v1/klines','/fapi/v1/depth','/fapi/v1/ticker/bookTicker','/fapi/v1/ticker/24hr')):return 'REQUIRED_MARKET'
    return 'OTHER_PUBLIC_UNKNOWN_REQUIREMENT'
private=collections.Counter();incidents=collections.Counter();tp=collections.Counter();errors=collections.Counter();fresh=collections.Counter();ids=set();timeouts={};failures={};dispatches={};ages=[];consecutive=[];production=[];locked=[];hot=[];http=[];memory=[];queue=[];lane_observations=[]
for r in rows:
    ep=r['endpoints'];c=ep.get('closeout',{}).get('data',{});p=c.get('pipeline',{});sync=p.get('binancePrivate',{})
    private[sync.get('status','OBSERVATION_UNAVAILABLE')]+=1;ages.append(sync.get('snapshotAgeMs'));consecutive.append(sync.get('consecutiveFailures'))
    ids.add((ep.get('health',{}).get('data',{}).get('pid'),ep.get('health',{}).get('data',{}).get('runtime',{}).get('instanceId')))
    for k,v in ep.items():
        if 'error' in v:errors[k]+=1
    for k in ('httpMetrics','storage'):
        if 'error' in r.get(k,{}):errors[k]+=1
    for i in ep.get('incidents',{}).get('data',{}).get('active',[]):incidents[i.get('publicCode')]+=1
    for k in ('missing','unverifiedTp','duplicateTp','qtyMismatch','wrongSide','orphanTp','positionFactUnresolved'):
        if p.get('takeProfit',{}).get(k):tp[k]+=1
    fresh[p.get('freshMarkets',{}).get('status','OBSERVATION_UNAVAILABLE')]+=1
    b=c.get('productionWriteBoundary',{});production.append(b.get('productionWrites'));locked.append(b.get('lockedToTestnet'))
    hot.extend([{**x,'sampleAt':r['capturedAt']} for x in c.get('hot',[])])
    http.append(r.get('httpMetrics',{}).get('data',{}));memory.append(r.get('hostMemory',{}))
    for route in ep.get('governance',{}).get('data',{}).get('routes',[]):
        budget=route.get('requestBudget',{});queue.append(budget.get('queued'));lane_observations.append({'at':r['capturedAt'],'laneStats':budget.get('laneStats')})
        for d in budget.get('recentDispatches',[]):
            if first<=int(d.get('completedAt') or 0)<=last:
                dispatches[d['requestId']]=d
                if d.get('decision')=='TIMEOUT':timeouts[d['requestId']]={**d,'acceptanceLane':lane(d.get('source'),d.get('purpose',''),d.get('endpoint',''))}
        for f in route.get('recentFailures',[]):
            if first<=int(f.get('completedAt') or 0)<=last:failures[f['requestId']]={**f,'acceptanceLane':lane(f.get('source'),f.get('purpose',''),f.get('endpoint',''))}
counts=collections.Counter(x['acceptanceLane'] for x in timeouts.values())
profile=json.loads((root/'cpu-path-summary-reproducible.json').read_text(encoding='utf-8')) if (root/'cpu-path-summary-reproducible.json').exists() else {}
paths=[x for x in profile.get('inclusivePaths',[]) if x['function'] in ('persistRuntime','persistRuntimeCore','captureState','tick','materialize','(garbage collector)')]
loop=json.loads((root/'fresh-profile-interval.json').read_text(encoding='utf-8')) if (root/'fresh-profile-interval.json').exists() else None
summary={'actualFirst':rows[0]['capturedAt'],'actualLast':rows[-1]['capturedAt'],'actualMinutes':(last-first)/60000,'samples':len(rows),'identities':[{'pid':p,'instanceId':i} for p,i in ids],'privateStates':dict(private),'privateAgeMs':stats(ages),'consecutivePrivateFailures':stats(consecutive),'httpReadErrors':dict(errors),'criticalQueueTimeouts':{k:counts[k] for k in ('PRIVATE','EXECUTION','REQUIRED_MARKET')},'otherQueueTimeouts':{k:v for k,v in counts.items() if k not in ('PRIVATE','EXECUTION','REQUIRED_MARKET')},'observedDispatches':len(dispatches),'sampledQueueDepth':stats(queue),'marketStates':dict(fresh),'hotQuoteAgeMs':stats([h.get('quoteAgeMs') for h in hot]),'hotBookAgeMs':stats([h.get('bookAgeMs') for h in hot]),'hotReasons':dict(collections.Counter(reason for h in hot for reason in h.get('reasons',[]))),'tpIssueSamples':dict(tp),'activeIncidentSamples':dict(incidents),'productionWrites':{'nonzero':sum(isinstance(v,(int,float)) and v>0 for v in production),'unknown':sum(v is None for v in production)},'testnetLock':dict(collections.Counter(map(str,locked))),'lifetimeHttpHistogram':{'maxAcrossSamples':stats([h.get('eventLoopDelayMs',{}).get('max') for h in http]),'p95AcrossSamples':stats([h.get('eventLoopDelayMs',{}).get('p95') for h in http]),'includesStartup':True},'freshInterval':loop,'rssBytes':stats([h.get('memory',{}).get('rss') for h in http]),'heapUsedBytes':stats([h.get('memory',{}).get('heapUsed') for h in http]),'hostCommitHeadroomBytes':stats([m.get('CommitLimit',0)-m.get('CommitTotal',0) for m in memory if 'CommitLimit' in m]),'cpuInclusivePaths':paths,'coverage':'15-second sampled endpoints and deduplicated currently retained request ledgers. Not a complete wire census; missing values are unknown. Independent fresh histogram spans its explicitly recorded interval. Candidate hot facts include boundary/continuity failures, not just quote/book age.'}
archive=gzip.compress(raw,mtime=0)
assert gzip.decompress(archive)==raw
(root/'samples.jsonl.gz').write_bytes(archive)
(root/'samples-hashes.json').write_text(json.dumps({'rawSha256':hashlib.sha256(raw).hexdigest(),'gzipSha256':hashlib.sha256(archive).hexdigest()},indent=2),encoding='utf-8')
(root/'audited-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
(root/'deduplicated-request-evidence.json').write_text(json.dumps({'queueTimeouts':list(timeouts.values()),'failures':list(failures.values()),'dispatches':list(dispatches.values()),'laneObservations':lane_observations},indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=True))
