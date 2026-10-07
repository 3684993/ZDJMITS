"""Summarize an actual collector window and read-only runtime log evidence.
It writes reports plus lossless compressed sample bytes; never calls trading APIs.
"""
import argparse, collections, gzip, hashlib, json, pathlib, statistics
from collect_stability import summarize, redact

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--samples',type=pathlib.Path,required=True);parser.add_argument('--label',required=True);parser.add_argument('--logs',type=pathlib.Path,default=pathlib.Path('D:/MITS/data/runtime-logs'));args=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parent;raw=args.samples.read_bytes();rows=[];bad=0
    for line in raw.splitlines():
        try: rows.append(json.loads(line))
        except (json.JSONDecodeError,UnicodeDecodeError): bad+=1
    if not rows: raise SystemExit('No complete actual samples')
    summary=summarize(rows);summary['malformedSampleRows']=bad
    # Distinguish endpoint observation gaps from an explicit Engine state.
    healthStates=collections.Counter();privateStates=collections.Counter();tpKnown=0
    for row in rows:
        e=row['endpoints'];h=e.get('health',{}).get('data',{});pipeline=e.get('closeout',{}).get('data',{}).get('pipeline',{})
        healthStates[str(h.get('status','OBSERVATION_UNAVAILABLE'))]+=1
        privateStates[str(pipeline.get('binancePrivate',{}).get('status','OBSERVATION_UNAVAILABLE'))]+=1
        tpKnown+=isinstance(pipeline.get('takeProfit'),dict)
    summary['healthSampleStates']=dict(healthStates);summary['privateSampleStates']=dict(privateStates)
    summary['tpObservationSamples']={'known':tpKnown,'unknown':len(rows)-tpKnown}
    summary['interpretation']+=' OBSERVATION_UNAVAILABLE is a missing endpoint value, not proven private UNAVAILABLE. The original running collector progress uses the older conflated default; use this audited analyzer for acceptance.'

    first,last=rows[0]['capturedAtMs'],rows[-1]['capturedAtMs'];steps=[b['capturedAtMs']-a['capturedAtMs'] for a,b in zip(rows,rows[1:])]
    summary['samplingGaps']={'maxMs':max(steps) if steps else None,'above90s':sum(step>90_000 for step in steps),'endpointValuesAreNotAtomic':True}
    rss=[row['engineMemory']['workingSetBytes'] for row in rows if 'workingSetBytes' in row.get('engineMemory',{})];summary['workingSetBytes']={'min':min(rss) if rss else None,'max':max(rss) if rss else None,'last':rss[-1] if rss else None}
    requests={};routes={};privateFailures=set();fieldStale=collections.Counter();tp=collections.Counter()
    for row in rows:
        e=row['endpoints'];stream=e.get('health',{}).get('data',{}).get('checks',{}).get('marketStream',{})
        for field,count in stream.get('quoteFactFreshness',{}).get('staleByField',{}).items():
            if count: fieldStale[field]+=1
        sync=e.get('private',{}).get('data',{}).get('sync',{})
        if sync.get('lastFailureAt') and first<=sync['lastFailureAt']<=last: privateFailures.add(sync['lastFailureAt'])
        for route in e.get('governance',{}).get('data',{}).get('routes',[]):
            key=route.get('rest',{}).get('routeIdentity','UNKNOWN');budget=route.get('requestBudget',{});routes.setdefault(key,{'first':budget.get('decisions',{}),'last':{}})['last']=budget.get('decisions',{})
            for request in budget.get('recentDispatches',[]):
                if request.get('requestId'): requests[request['requestId']]=request
    summary['distinctPrivateFailureTimestampsSeen']=len(privateFailures);summary['staleQuoteFieldSampleCounts']=dict(fieldStale)
    summary['routeDecisionDeltas']={k:{metric:r['last'].get(metric,0)-r['first'].get(metric,0) for metric in r['last']} for k,r in routes.items()}
    completed=[r for r in requests.values() if first<=int(r.get('completedAt') or 0)<=last];phase=collections.Counter();queue=[];wire=[]
    for request in completed:
        if request.get('queueAgeMs') is not None: queue.append(request['queueAgeMs'])
        timing=request.get('networkTiming',{})
        if timing.get('failurePhase'): phase[timing['failurePhase']]+=1
        if timing.get('startedAt') and timing.get('completedAt'): wire.append(timing['completedAt']-timing['startedAt'])
    def distribution(values):
        values=sorted(values);return {'n':len(values),'median':statistics.median(values) if values else None,'p95':values[min(len(values)-1,int(len(values)*.95))] if values else None,'max':max(values) if values else None}
    summary['boundedRequestEvidence']={'distinctIdsSeen':len(requests),'completedInWindowSeen':len(completed),'queueAgeMs':distribution(queue),'admittedNetworkMs':distribution(wire),'failurePhases':dict(phase),'coverage':'Bounded recent ledgers sampled once/minute; not a full request census. Admission counters provide separate aggregate deltas.'}
    identities={i['instanceId'] for i in summary['identities'] if i['instanceId']};eventCounts=collections.Counter();recoveryCounts=collections.Counter();activatedCounts=collections.Counter();historicalIds=set();selected=[];files=[]
    for instance in identities:
        for file in sorted(args.logs.glob('*'+instance+'*.jsonl')):
            files.append(str(file))
            with file.open(encoding='utf-8') as source:
                for line in source:
                    try: event=json.loads(line)
                    except json.JSONDecodeError: continue
                    at=event.get('timestamp',event.get('ts',0))
                    if not isinstance(at,(int,float)) or not first<=at<=last: continue
                    name=event.get('event','UNKNOWN');eventCounts[name]+=1;p=event.get('payload',{})
                    if name=='OPERATIONAL_INCIDENT_RECOVERED': recoveryCounts[p.get('incidentId','UNKNOWN')]+=1
                    if name=='OPERATIONAL_INCIDENT_ACTIVATED': activatedCounts[p.get('incidentId','UNKNOWN')]+=1
                    if name=='ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED' and p.get('orderId'): historicalIds.add(p['orderId'])
                    if name=='TP_ORDER_RECOVERED_BY_CLIENT_ID': tp[str(p.get('status'))]+=1
                    if name.startswith(('PRIVATE_SYNC_','OPERATIONAL_INCIDENT_','TP_ORDER_RECOVERED_')) or name=='ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED': selected.append(redact(event))
    summary['durableEvents']={'files':files,'counts':dict(eventCounts),'recoveryByIncidentId':dict(recoveryCounts),'activationByIncidentId':dict(activatedCounts),'distinctUnverifiedEntryIds':len(historicalIds),'terminalTpExactRecoveryEvents':dict(tp),'coverage':'Only retained matching-instance JSONL files, within first/last actual sample timestamps. No natural terminal event means UNKNOWN, not a live PASS.'}
    if summary['elapsedHours']<6: summary['acceptance']='SHORT_WINDOW_NOT_ACCEPTED'
    else: summary['acceptance']='REQUIRES_EVIDENCE_REVIEW'
    bundle=root/(args.label+'-samples.jsonl.gz')
    with gzip.GzipFile(filename=str(bundle),mode='wb',mtime=0) as output: output.write(raw)
    summary['evidence']={'rawSha256':hashlib.sha256(raw).hexdigest(),'gzipSha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'compressedFile':bundle.name}
    (root/(args.label+'-summary.json')).write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/(args.label+'-events.jsonl')).write_text(''.join(json.dumps(event,ensure_ascii=False)+'\n' for event in selected),encoding='utf-8')
    print(json.dumps({'elapsedHours':summary['elapsedHours'],'sampleCount':len(rows),'acceptance':summary['acceptance'],'privateStates':summary['privateSampleStates'],'incidentSamples':summary['activeIncidentSampleCounts'],'distinctEntryIds':len(historicalIds)},ensure_ascii=False))

if __name__=='__main__': main()
