"""Read-only localhost stability collector. Never starts Engine or invokes exchange APIs.
Run with --hours 12 after the authorized 8080 restart; --once baseline records one sample.
Sampling is observational, and bounded HTTP ledgers are not a complete wire census.
"""
import argparse, collections, concurrent.futures, datetime, hashlib, json, pathlib, time, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent
PATHS = {'health':'/health','closeout':'/api/v3/diagnostics/closeout',
         'governance':'/api/v3/diagnostics/binance-governance',
         'private':'/api/v3/diagnostics/private-sync',
         'operations':'/api/v3/operations/health','incidents':'/api/v3/operational-incidents'}

def process_memory(pid):
    try:
        import ctypes
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_=[('cb',wintypes.DWORD),('PageFaultCount',wintypes.DWORD)]+[(name,ctypes.c_size_t) for name in ('PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage','QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage','PrivateUsage')]
        kernel=ctypes.windll.kernel32;kernel.OpenProcess.restype=ctypes.c_void_p;kernel.CloseHandle.argtypes=[ctypes.c_void_p]
        query=ctypes.windll.psapi.GetProcessMemoryInfo;query.argtypes=[ctypes.c_void_p,ctypes.POINTER(Counters),wintypes.DWORD]
        handle=kernel.OpenProcess(0x0410,False,int(pid))
        if not handle: return {'error':'OpenProcess failed'}
        try:
            values=Counters();values.cb=ctypes.sizeof(values)
            if not query(handle,ctypes.byref(values),values.cb): return {'error':'GetProcessMemoryInfo failed'}
            return {'pid':pid,'workingSetBytes':values.WorkingSetSize,'peakWorkingSetBytes':values.PeakWorkingSetSize,'privateBytes':values.PrivateUsage}
        finally: kernel.CloseHandle(handle)
    except Exception as exc: return {'error':str(exc)}

def redact(value):
    if isinstance(value,dict):
        return {k:('[REDACTED]' if any(s in k.lower() for s in ('secret','apikey','authorization','credential','proxyurl')) else redact(v)) for k,v in value.items()}
    if isinstance(value,list): return [redact(v) for v in value]
    return value

def read(item):
    name,path=item; started=time.monotonic()
    try:
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try: response=opener.open('http://127.0.0.1:8080'+path,timeout=8)
        except urllib.error.HTTPError as exc: response=exc
        with response: value=json.load(response); status=response.status
        return name,{'httpStatus':status,'durationMs':round((time.monotonic()-started)*1000),'data':redact(value)}
    except Exception as exc: return name,{'error':str(exc),'durationMs':round((time.monotonic()-started)*1000)}

def sample(compact=True):
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: rows=dict(pool.map(read,PATHS.items()))
    # Retain only active and recent incident history; full durable transitions come from log evidence.
    incidents=rows.get('incidents',{}).get('data',{})
    if isinstance(incidents,dict) and isinstance(incidents.get('history'),list): incidents['history']=incidents['history'][-12:]
    if compact:
        closeout=rows.get('closeout',{}).get('data',{});pipeline=closeout.get('pipeline',{})
        keys=('asOf','observationVersion','capacity','privateSync','entryResourcePolicy','authoritativeBlocker','pipelineState','marketDataReason','marketDataIsolation','marketDataDetail','market','freshMarkets','existingPositions','pendingEntries','entryPermission','binancePrivate','reconciliation','takeProfit','executionReadiness','scheduler','noEntryReason')
        if isinstance(pipeline,dict): closeout['pipeline']={k:pipeline[k] for k in keys if k in pipeline}
        rows.get('governance',{}).get('data',{}).pop('budgets',None) # routes retain each active route budget
        rows.get('private',{}).get('data',{}).pop('requests',None) # same budgets retained under governance
    pid=rows.get('health',{}).get('data',{}).get('pid')
    return {'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'capturedAtMs':int(time.time()*1000),'endpoints':rows,'engineMemory':process_memory(pid) if pid else {'error':'No observed Engine PID'}}

def summarize(rows):
    health=collections.Counter(); private=collections.Counter(); incidents=collections.Counter(); identities=set(); errors=collections.Counter();ages=[];tp_issues=collections.Counter();production=[]
    for row in rows:
        endpoints=row['endpoints']; h=endpoints.get('health',{}).get('data',{})
        health[str(h.get('status','UNAVAILABLE'))]+=1; identities.add((h.get('pid'),h.get('runtime',{}).get('instanceId')))
        pipeline=endpoints.get('closeout',{}).get('data',{}).get('pipeline',{})
        sync=pipeline.get('binancePrivate',{}); private[str(sync.get('status','UNAVAILABLE'))]+=1
        if isinstance(sync.get('snapshotAgeMs'),(int,float)): ages.append(sync['snapshotAgeMs'])
        for key in ('missing','unverifiedTp','duplicateTp','qtyMismatch','wrongSide','orphanTp','positionFactUnresolved'):
            if pipeline.get('takeProfit',{}).get(key,0): tp_issues[key]+=1
        boundary=endpoints.get('closeout',{}).get('data',{}).get('productionWriteBoundary',{});production.append(boundary.get('productionWrites'))
        for item in endpoints.get('incidents',{}).get('data',{}).get('active',[]): incidents[str(item.get('publicCode'))]+=1
        for name,value in endpoints.items():
            if 'error' in value: errors[name]+=1
    elapsed=(rows[-1]['capturedAtMs']-rows[0]['capturedAtMs'])/3_600_000 if rows else 0
    return {'sampleCount':len(rows),'elapsedHours':elapsed,'first':rows[0]['capturedAt'] if rows else None,'last':rows[-1]['capturedAt'] if rows else None,
            'healthSampleStates':dict(health),'privateSampleStates':dict(private),'activeIncidentSampleCounts':dict(incidents),'httpReadErrors':dict(errors),
            'identities':[{'pid':p,'instanceId':i} for p,i in identities],
            'privateSnapshotAgeMs':{'observedSamples':len(ages),'max':max(ages) if ages else None,'p95':sorted(ages)[min(len(ages)-1,int(len(ages)*.95))] if ages else None},
            'tpIssueSampleCounts':dict(tp_issues),'productionWriteSamples':{'nonzero':sum(isinstance(v,(int,float)) and v>0 for v in production),'unknown':sum(v is None for v in production)},
            'interpretation':'Sample prevalence is not incident frequency or duration. Missing samples and bounded ledgers cannot prove zero failures.',
            'acceptance':'OBSERVATION_PENDING' if elapsed<6 else 'DATA_AVAILABLE_REQUIRES_AUDIT'}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--hours',type=float,default=12);parser.add_argument('--interval',type=float,default=60);parser.add_argument('--once');args=parser.parse_args()
    if args.once:
        target=ROOT/(args.once+'.json');target.write_text(json.dumps(sample(compact=False),ensure_ascii=False,indent=2),encoding='utf-8');print(target);return
    target=ROOT/'stability-samples.jsonl'
    if target.exists(): raise SystemExit('Refusing to overwrite prior observation evidence')
    rows=[];start=time.monotonic();deadline=start+args.hours*3600
    while True:
        at=time.monotonic();row=sample();rows.append(row)
        with target.open('a',encoding='utf-8') as output: output.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n');output.flush()
        (ROOT/'stability-progress.json').write_text(json.dumps(summarize(rows),ensure_ascii=False,indent=2),encoding='utf-8')
        if time.monotonic()>=deadline: break
        time.sleep(max(0,min(args.interval-(time.monotonic()-at),deadline-time.monotonic())))
    summary=summarize(rows);summary['samplesSha256']=hashlib.sha256(target.read_bytes()).hexdigest()
    (ROOT/'stability-final.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False))

if __name__=='__main__': main()
