"""Offline CPU call-chain and contiguous-sampling evidence, never runtime mutation."""
import json,collections,pathlib,sys
r=pathlib.Path(sys.argv[1]);p=json.loads((r/'live-cpu.cpuprofile').read_text());nodes={n['id']:n for n in p['nodes']};parents={c:n['id'] for n in p['nodes'] for c in n.get('children',[])};memo={}
def chain(k):
    if k not in memo:memo[k]=[k]+(chain(parents[k]) if k in parents else [])
    return memo[k]
counts=collections.Counter(p['samples']);out=[]
for k,n in counts.most_common(30):
    out.append({'samples':n,'percent':100*n/len(p['samples']),'chain':[{'function':nodes[q]['callFrame']['functionName'],'url':nodes[q]['callFrame']['url'],'lineNumber':nodes[q]['callFrame']['lineNumber']} for q in chain(k)]})
(r/'self-sample-calling-chains.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
out=[]
for n in p['nodes']:
    if not any(s in n['callFrame']['url'] for s in ('reconciliationService.js','runtimeWriteBuffer.js','tradingQualityCollector.js','settingsStore.js')):continue
    best=cur=count=0
    for i,k in enumerate(p.get('samples',[])):
        if n['id'] in chain(k):cur+=p['timeDeltas'][i];count+=1;best=max(best,cur)
        else:cur=0
    if count:out.append({'frame':n['callFrame'],'inclusiveSamples':count,'maxContiguousSamplingIntervalMs':best/1000})
out.sort(key=lambda x:x['maxContiguousSamplingIntervalMs'],reverse=True)
(r/'contiguous-path-intervals.json').write_text(json.dumps({'note':'Approximate contiguous sampled intervals; not an instrumented transaction duration or proof of unique stall cause.','paths':out},indent=2),encoding='utf-8')
print(json.dumps({'totalSamples':len(p['samples']),'profileIntervalUs':p['endTime']-p['startTime']}))
