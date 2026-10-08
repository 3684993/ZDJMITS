"""Read only the already committed lossless archive; no live database or exchange access."""
import gzip, hashlib, json
from pathlib import Path

source = Path('docs/reports/v397-trade-entry-exit-quality-review-20261008')
target = Path('docs/reports/v397-trade-learning-p0-20261008')
archive = source / 'durable-entities.json.gz'
with gzip.open(archive, 'rt', encoding='utf-8') as stream:
    raw = json.load(stream)
recent = json.loads((source / 'recent-cycle-quality-metrics.json').read_text(encoding='utf-8'))
ids = {r['tradeId'] for r in recent}
records = [r for r in json.loads((source / 'trade-records-bounded.json').read_text(encoding='utf-8')) if r['tradeId'] in ids]
intent_ids = {i for r in records for i in [r.get('entryIntentId'), *(l.get('intentId') for l in r.get('entryLots', []))] if i}
order_ids = {i for r in records for i in [*r.get('entryOrderIds', []), *(l.get('orderId') for l in r.get('entryLots', [])), *(l.get('exchangeOrderId') for l in r.get('entryLots', []))] if i}
orders = [o for o in raw['entryOrders'] if o.get('id') in order_ids or o.get('exchangeOrderId') in order_ids]
intent_ids.update(o['intentId'] for o in orders if o.get('intentId'))
intents = [i for i in raw['entryIntents'] if i.get('id') in intent_ids]
plan_ids = {i['planId'] for i in intents if i.get('planId')}
plans = [p for p in raw['tradePlans'] if p.get('planId') in plan_ids]
subset = {'entryIntents': intents, 'entryOrders': orders, 'tradePlans': plans}
payload = (json.dumps(subset, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
target.mkdir(parents=True, exist_ok=True)
(target / 'lineage-authority-subset.json.gz').write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
manifest = {'source': str(archive), 'sourceSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'uncompressedSubsetSha256': hashlib.sha256(payload).hexdigest(), 'counts': {k: len(v) for k, v in subset.items()}, 'method': 'Exact identity bounded cohort subset; each retained row unchanged; missing rows remain unknown'}
(target / 'lineage-authority-subset-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps(manifest, indent=2))
