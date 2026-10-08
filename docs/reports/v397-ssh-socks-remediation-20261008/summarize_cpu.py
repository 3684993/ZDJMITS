"""Archive operator-created CPU evidence and count inclusive path samples; no live access."""
import collections, gzip, hashlib, json, pathlib, sys

source=pathlib.Path(sys.argv[1]).resolve()
raw=source.read_bytes()
profile=json.loads(raw)
nodes={row['id']:row for row in profile['nodes']}
parents={child:row['id'] for row in profile['nodes'] for child in row.get('children',[])}
functions=collections.Counter()
native_parents=collections.Counter()
for sample in profile.get('samples',[]):
    node=nodes[sample]
    if node['callFrame']['functionName']=='run' and not node['callFrame'].get('url'):
        parent=nodes.get(parents.get(sample),{}).get('callFrame',{})
        native_parents[parent.get('functionName','UNKNOWN')]+=1
    cursor=sample
    seen=set()
    while cursor is not None:
        frame=nodes[cursor]['callFrame']
        seen.add((frame.get('functionName',''),frame.get('url','')))
        cursor=parents.get(cursor)
    functions.update(seen)
n=len(profile.get('samples',[]))
result={'totalSamples':n,'interpretation':'Inclusive CPU sample attribution overlaps. Not wall-clock durations or a request census.',
        'inclusivePaths':[{'function':function,'url':url,'samples':count,'percent':round(100*count/n,4) if n else None}
                          for (function,url),count in functions.most_common()],
        'nativeRunParents':dict(native_parents)}
archive=source.with_name(source.name+'.gz')
archive.write_bytes(gzip.compress(raw,mtime=0))
if gzip.decompress(archive.read_bytes())!=raw: raise SystemExit('LOSSLESS_ARCHIVE_MISMATCH')
source.with_name('cpu-evidence-hashes.json').write_text(json.dumps({'rawSha256':hashlib.sha256(raw).hexdigest(),'gzipSha256':hashlib.sha256(archive.read_bytes()).hexdigest()},indent=2),encoding='utf-8')
source.with_name('cpu-path-summary-reproducible.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({'totalSamples':n,'topInclusivePaths':result['inclusivePaths'][:12],'nativeRunParents':result['nativeRunParents']}))
