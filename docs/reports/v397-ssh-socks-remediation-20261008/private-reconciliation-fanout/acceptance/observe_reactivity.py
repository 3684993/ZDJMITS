"""Fresh bounded localhost feedback, no exchange/lifecycle calls."""
import datetime,json,time,pathlib,ctypes
from collect_stability import sample,read
root=pathlib.Path(__file__).resolve().parent
def host_memory():
    class Info(ctypes.Structure):
        _fields_=[('cb',ctypes.c_ulong)]+[(n,ctypes.c_size_t) for n in ('CommitTotal','CommitLimit','CommitPeak','PhysicalTotal','PhysicalAvailable','SystemCache','KernelTotal','KernelPaged','KernelNonpaged','PageSize')]+[(n,ctypes.c_ulong) for n in ('HandleCount','ProcessCount','ThreadCount')]
    info=Info();info.cb=ctypes.sizeof(info)
    if not ctypes.windll.psapi.GetPerformanceInfo(ctypes.byref(info),info.cb):return {'error':'GetPerformanceInfo failed'}
    return {k:getattr(info,k)*info.PageSize for k in ('CommitTotal','CommitLimit','PhysicalAvailable','KernelPaged','KernelNonpaged')}
target=root/'samples.jsonl'
if target.exists():raise SystemExit('Refusing to overwrite independent window')
_,health=read(('health','/health'));_,closeout=read(('closeout','/api/v3/diagnostics/closeout'))
if health.get('data',{}).get('status')!='READY' or closeout.get('data',{}).get('pipeline',{}).get('binancePrivate',{}).get('status')!='READY':raise SystemExit('Post-READY window required')
identity=health.get('data',{}).get('runtime',{}).get('instanceId')
start=time.monotonic();deadline=start+360
while True:
    at=time.monotonic();value=sample()
    value['httpMetrics']=read(('httpMetrics','/api/v3/diagnostics/http'))[1]
    value['storage']=read(('storage','/api/v3/diagnostics/storage'))[1]
    value['hostMemory']=host_memory()
    with target.open('a',encoding='utf-8') as stream:stream.write(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')
    progress={'at':value['capturedAt'],'elapsedSeconds':time.monotonic()-start,'initialInstance':identity,'samplesFile':str(target),'mode':'LOCALHOST_READ_ONLY_POST_READY_6_MINUTES_15_SECOND_CADENCE'}
    (root/'progress.json').write_text(json.dumps(progress,indent=2),encoding='utf-8')
    if time.monotonic()>=deadline:break
    time.sleep(max(0,min(15-(time.monotonic()-at),deadline-time.monotonic())))
(root/'completed.json').write_text(json.dumps(progress,indent=2),encoding='utf-8')
