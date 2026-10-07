"""Bounded read-only census and inclusive CPU evidence; no trading/state writes."""
import collections, gzip, json, pathlib, sqlite3, time
root = pathlib.Path(__file__).resolve().parent
profile = json.loads(gzip.decompress((root/'live-cpu.cpuprofile.gz').read_bytes()))
nodes = {n['id']: n for n in profile['nodes']}
parents = {c:n['id'] for n in profile['nodes'] for c in n.get('children', [])}
counts = collections.Counter()
for sample in profile.get('samples', []):
    seen = set()
    while sample in nodes:
        frame = nodes[sample]['callFrame']
        key = (frame.get('functionName'), frame.get('url'), frame.get('lineNumber'))
        if key not in seen: counts[key] += 1; seen.add(key)
        sample = parents.get(sample)
result = {'totalSamples':len(profile.get('samples', [])), 'inclusive':[
    {'function':k[0], 'url':k[1], 'line':k[2], 'samples':v, 'fraction':v/len(profile['samples'])}
    for k,v in counts.most_common(40)]}
(root/'cpu-inclusive.json').write_text(json.dumps(result,indent=2))
census = {}
for file, table, kinds in [
    ('zdj-settings.sqlite','runtime_entities',['executionFills','entryOrders','entryIntents','tradeRecords','aiRuns']),
    ('trading-quality.sqlite','tq_facts',['fills','orders','intents','events'])]:
    db = sqlite3.connect('file:D:/MITS/data/'+file+'?mode=ro', uri=True, timeout=1)
    scope = db.execute('SELECT scope FROM tq_facts LIMIT 1').fetchone()[0] if table=='tq_facts' else None
    for kind in kinds:
        deadline = time.monotonic()+2
        db.set_progress_handler(lambda: int(time.monotonic()>deadline),1000)
        try:
            sql = 'SELECT COUNT(*) FROM '+table+' WHERE kind=?'+(' AND scope=?' if scope else '')
            census[file+':'+kind] = db.execute(sql,(kind,scope) if scope else (kind,)).fetchone()[0]
        except sqlite3.Error as exc: census[file+':'+kind] = {'error':str(exc)}
    db.close()
(root/'durable-index-census.json').write_text(json.dumps(census,indent=2))
print(json.dumps({'inclusive':result['inclusive'][:15],'census':census},indent=2))
