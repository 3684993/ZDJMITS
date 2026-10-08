import pathlib,json,sqlite3,urllib.request,time,datetime,gzip,hashlib,collections
p=pathlib.Path(__file__).resolve().parent
load=lambda n:json.loads((p/n).read_text(encoding='utf-8'))
s=load('live-snapshot.json')['data'];tr=load('trade-records-bounded.json');entities=load('durable-entities.json');since=s['ts']-7*86400000;recent=[r for r in tr if (r.get('closedAt') or 0)>=since];details={}
for pos in s['positions']:
 try:
  v=json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/v3/positions/'+pos['id'],timeout=6));details[pos['id']]={'capturedAtMs':int(time.time()*1000),'data':v}
 except Exception as e:details[pos['id']]={'error':str(e)}
(p/'position-details.json').write_text(json.dumps(details,ensure_ascii=False,indent=2),encoding='utf-8')
c=sqlite3.connect('file:D:/MITS/data/zdj-settings.sqlite?mode=ro',uri=True,timeout=4);c.execute('PRAGMA query_only=ON');runIds=set(r.get('entryRunId') for r in recent if r.get('entryRunId'));runIds.update(i.get('brainRunId') for i in entities['entryIntents'] if i.get('planCycleId') in {pos.get('cycleId') for pos in s['positions']});runs={}
for rid in runIds:
 r=c.execute('SELECT payload FROM ai_runs_archive WHERE run_id=?',(rid,)).fetchone();runs[rid]=json.loads(r[0]) if r else None
(p/'linked-primary-runs.json').write_text(json.dumps(runs,ensure_ascii=False,indent=2),encoding='utf-8');c.close()
c=sqlite3.connect('file:D:/MITS/data/trading-quality.sqlite?mode=ro',uri=True,timeout=4);c.execute('PRAGMA query_only=ON');scope=c.execute('SELECT scope FROM tq_marks LIMIT 1').fetchone()[0];intents={r.get('entryIntentId') for r in recent if r.get('entryIntentId')};intents.update(i['id'] for i in entities['entryIntents'] if i.get('planCycleId') in {pos.get('cycleId') for pos in s['positions']});episodes={}
for iid in intents:
 r=c.execute('SELECT payload,updated_at FROM tq_episodes WHERE scope=? AND intent_id=?',(scope,iid)).fetchone();episodes[iid]={'updatedAt':r[1],'data':json.loads(r[0])} if r else None
(p/'linked-tq-episodes.json').write_text(json.dumps(episodes,ensure_ascii=False,indent=2),encoding='utf-8');symbols={r['symbol'] for r in recent}|{r['symbol'] for r in s['positions']};coverage={};(p/'mark-paths').mkdir(exist_ok=True)
for symbol in sorted(symbols):
 started=time.monotonic();deadline=started+8;c.set_progress_handler(lambda:1 if time.monotonic()>deadline else 0,10000)
 try:
  rows=c.execute('SELECT ts,mark,bid,ask,received_at FROM tq_marks WHERE scope=? AND symbol=? AND ts>=? AND ts<=? ORDER BY ts DESC LIMIT 50001',(scope,symbol,since,s['ts'])).fetchall();raw=json.dumps(rows,separators=(',',':')).encode();blob=gzip.compress(raw,mtime=0);(p/'mark-paths'/f'{symbol}.json.gz').write_bytes(blob);coverage[symbol]={'rows':len(rows),'truncated':len(rows)==50001,'first':rows[-1][0] if rows else None,'last':rows[0][0] if rows else None,'selectedRawSha256':hashlib.sha256(raw).hexdigest(),'gzipSha256':hashlib.sha256(blob).hexdigest(),'querySeconds':time.monotonic()-started}
 except Exception as e:coverage[symbol]={'error':str(e),'querySeconds':time.monotonic()-started}
 print(symbol,coverage[symbol]['rows'] if 'rows' in coverage[symbol] else 'ERROR',flush=True)
c.close();(p/'path-coverage.json').write_text(json.dumps({'scope':scope,'since':since,'until':s['ts'],'limitPerSymbol':50001,'coverage':coverage},indent=2),encoding='utf-8');print('runs',len(runs),'episodes',len(episodes),'details',len(details))
