"""Read-only exact versioned TP history; never alters live SQLite or orders."""
import datetime, json, pathlib, re, sqlite3, sys
CID = 'v396x8419a8beaceabdc09e207493241b89'
con = sqlite3.connect('file:D:/MITS/data/v396-ownership.sqlite?mode=ro', uri=True, timeout=5)
con.execute('PRAGMA query_only=ON')
rows = con.execute("SELECT payload FROM v396_exit_tasks WHERE scope=? AND cycle_id=?", ('["TESTNET","binance-primary","NEARUSDC","LONG"]','cycle_entry_intent_muyt1rih_y188q0jb')).fetchall()
tasks = [json.loads(row[0]) for row in rows if json.loads(row[0]).get('clientOrderId') == CID]
result = {'at':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'mode':'READ_ONLY_EXACT_VERSIONED_SQLITE', 'clientOrderId':CID, 'tasks':tasks,'versions':[]}
for task in tasks:
    for version in range(1, task['version']+1):
        key = json.dumps([task['scope'],task['cycleId'],task['taskId'],version], separators=(',',':'), ensure_ascii=False)
        saved = con.execute('SELECT payload FROM v396_outbox WHERE id=?',(key,)).fetchone()
        result['versions'].append({'id':key,'found':bool(saved),'event':json.loads(saved[0]) if saved else None})
con.close()
label = sys.argv[1] if len(sys.argv)>1 else 'actual-near-tp-version-history'
if not re.fullmatch('[a-z0-9-]+', label): raise SystemExit('Invalid evidence label')
out = pathlib.Path(__file__).with_name(label+'.json')
if out.exists(): raise SystemExit('Refusing to overwrite prior exact-history evidence')
out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'tasks':len(tasks),'versions':len(result['versions']),'path':str(out)}))
