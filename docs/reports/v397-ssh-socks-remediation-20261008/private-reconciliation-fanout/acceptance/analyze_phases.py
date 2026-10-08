import json,pathlib,collections,statistics
root=pathlib.Path(__file__).resolve().parent
rows=[json.loads(s) for s in (root/'samples.jsonl').read_text(encoding='utf-8').splitlines()]
first,last=rows[0]['capturedAtMs'],rows[-1]['capturedAtMs']; cycles={}
for r in rows:
 t=r.get('endpoints',{}).get('closeout',{}).get('data',{}).get('pipeline',{}).get('reconciliation',{}).get('phaseTiming',{})
 for c in t.get('recent',[]):
  if c.get('startedAt',0)>=first and c.get('endedAt',last+1)<=last:cycles[c['id']]=c
phases=collections.defaultdict(list); counts=collections.defaultdict(list)
for c in cycles.values():
 for k,p in c['phases'].items():phases[k].append(p['totalMs'])
 for k,n in c['counts'].items():counts[k].append(n)
def stats(a):
 a=sorted(a);return {'n':len(a),'min':min(a),'max':max(a),'mean':statistics.mean(a),'p95':a[int((len(a)-1)*.95)]}
result={'first':first,'last':last,'completeCycles':len(cycles),'phases':{k:stats(v) for k,v in phases.items()},'counts':{k:{**stats(v),'sum':sum(v)} for k,v in counts.items()},'caveat':'Inclusive wall time, not additive/exclusive CPU. Bounded64 cycles; absent natural behavior UNKNOWN.'}
(root/'reconciliation-phase-summary.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
(root/'reconciliation-cycles.json').write_text(json.dumps(list(cycles.values()),indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
