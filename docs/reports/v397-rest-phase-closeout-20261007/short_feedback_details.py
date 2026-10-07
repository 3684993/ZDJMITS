"""Read retained localhost samples only; deduplicate bounded route evidence."""
import collections, json, pathlib
ROOT=pathlib.Path(__file__).resolve().parent
rows=[json.loads(s) for s in (ROOT/'stability-samples.jsonl').read_text(encoding='utf-8').splitlines()]
failures={}; dispatches={}; queues=[]; memory=[]; markets=[]; private=[]
def walk(value):
    if isinstance(value,dict):
        if value.get('failurePhase') and value.get('requestId'):
            failures[value['requestId']]=value
        if value.get('requestId') and 'queuedAt' in value:
            dispatches[value['requestId']]=value
        for item in value.values(): walk(item)
    elif isinstance(value,list):
        for item in value: walk(item)
for row in rows:
    e=row['endpoints']; g=e.get('governance',{}).get('data',{}); walk(g)
    def pressure(value):
        if isinstance(value,dict):
            if 'queuePressure' in value: queues.append({'at':row['capturedAt'],'scope':value.get('scope'),**value['queuePressure'],'queued':value.get('queued')})
            for v in value.values(): pressure(v)
        elif isinstance(value,list):
            for v in value: pressure(v)
    pressure(g)
    p=e.get('closeout',{}).get('data',{}).get('pipeline',{})
    private.append({'at':row['capturedAt'],**p.get('binancePrivate',{})})
    markets.append({'at':row['capturedAt'],'freshMarkets':p.get('freshMarkets'),'marketDataDetail':p.get('marketDataDetail'),'takeProfit':p.get('takeProfit'),'blocker':p.get('authoritativeBlocker',{}).get('code')})
    memory.append({'at':row['capturedAt'],**row.get('engineMemory',{})})
admitted=[d for d in dispatches.values() if d.get('source')=='PRIVATE_STATE' and d.get('admittedAt') is not None]
result={'sampleCount':len(rows),'actualSpanMinutes':(rows[-1]['capturedAtMs']-rows[0]['capturedAtMs'])/60000,'runtimeVerdict':'NOT_HEALTHY' if any(p.get('status')=='UNAVAILABLE' for p in private) else 'REQUIRES_AUDIT','boundedDistinctFailurePhases':dict(collections.Counter(f.get('failurePhase') for f in failures.values())),'boundedDistinctFailures':list(failures.values()),'privateAdmittedQueueAgesMs':[d.get('queueAgeMs') for d in admitted],'privateAdmittedDispatches':admitted,'queuePressureSamples':queues,'privateSamples':private,'marketAndTpSamples':markets,'memorySamples':memory,'limits':'Retained ledgers and sampled endpoints are not a complete wire census; local TP READY is not fresh private or exchange proof. No natural lost-ACK terminal sample is implied.'}
(ROOT/'short-feedback-details.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:result[k] for k in ('sampleCount','actualSpanMinutes','runtimeVerdict','boundedDistinctFailurePhases','privateAdmittedQueueAgesMs')},ensure_ascii=True))
