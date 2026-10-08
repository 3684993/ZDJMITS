"""Read-only retained current-instance events; no completeness claim beyond files."""
import collections, datetime, json, pathlib, re, sys
from collect_stability import redact
root=pathlib.Path(__file__).resolve().parent
label=sys.argv[1]
if not re.fullmatch('[a-z0-9-]+',label): raise SystemExit('Invalid evidence label')
identity=json.loads(pathlib.Path('D:/MITS/data/runtime/engine-instance.json').read_text(encoding='utf-8-sig'))
out=root/(label+'-events.jsonl'); summary=root/(label+'-event-counts.json')
if out.exists() or summary.exists(): raise SystemExit('Refusing to overwrite evidence')
counts=collections.Counter(); selected=[]; malformed=0
files=sorted(pathlib.Path('D:/MITS/data/runtime-logs').glob('*'+identity['instanceId']+'*.jsonl'))
for file in files:
    with file.open(encoding='utf-8') as stream:
        for line in stream:
            try: event=json.loads(line)
            except json.JSONDecodeError: malformed+=1; continue
            if event.get('instanceId')!=identity['instanceId']: continue
            name=event.get('event','UNKNOWN'); counts[name]+=1
            if name.startswith(('TP_','PRIVATE_SYNC_','MARKET_','OPERATIONAL_INCIDENT_')) or 'database is locked' in line:
                selected.append(redact(event))
out.write_text(''.join(json.dumps(e,ensure_ascii=False)+'\n' for e in selected),encoding='utf-8')
value={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'identity':identity,'files':[str(f) for f in files], 'counts':dict(counts),'malformedRows':malformed,'coverage':'Only currently retained matching-instance logs, including startup; not a complete wire census or acceptance window.'}
summary.write_text(json.dumps(value,indent=2),encoding='utf-8')
print(json.dumps({'instance':identity['instanceId'],'selected':len(selected),'tpEvents':{k:v for k,v in counts.items() if k.startswith('TP_')}}))
