"""Summarize actual runtime gates. Never sends an order or implies natural Entry acceptance."""
import pathlib,json,datetime
root=pathlib.Path(__file__).resolve().parents[1]
b=root/'docs/reports/v398-entry-sizing-quality-review';e=b/'evidence-20261008'
read=lambda name:json.loads((e/name).read_text(encoding='utf-8'))
j=read('runtime-acceptance-final.json');h=next(r for r in j['results'] if r['endpoint']=='/health');c=next(r for r in j['results'] if r['endpoint'].endswith('closeout'));d=c['data'];tp=d['pipeline']['takeProfit'];boundary=d['productionWriteBoundary'];ident=read('identity-post-load.json');local=read('local-identity-accepted-state.json');before=read('local-identity-pre-start.json')
checks={'healthReady':h['httpStatus']==200 and h['data']['ready'] is True,'closeoutHTTP200':c['httpStatus']==200,'identitySixChecks':all(ident['checks'].values()),'samePidAndBuild':d['runtime']['pid']==ident['runtimeApi']['pid'] and d['runtime']['buildId']==ident['runtimeApi']['buildId'],'lockedTestnet':boundary['lockedToTestnet'] and boundary['environment']=='TESTNET','zeroProductionWrites':boundary['productionWrites']==0,'TPProtected':tp['required']==tp['protected'] and tp['missing']==0 and all(tp[k]==0 for k in ['duplicateTp','qtyMismatch','wrongSide','unverifiedTp']),'settingsUnchanged':before['settingsPayloadSha256']==local['settingsPayloadSha256'] and before['settingsVersion']==local['settingsVersion'],'canonicalDirtyPreserved':before['preservedCanonicalStatus']==local['preservedCanonicalStatus']}
result={'observedAt':j['observedAt'],'checks':checks,'runtimeOperationalClosure':'PROVEN' if all(checks.values()) else 'INCOMPLETE','codeCommit':'3327c84ff943934653e003f98b31573b3886647d','codeCIRun':37850135010,'codeCIConclusion':'success','runtime':{k:d['runtime'].get(k) for k in ['pid','instanceId','version','buildId','uptimeMs','lastRestartReason','restartCount']},'boundary':boundary,'takeProfit':tp,'taskActualEngineStarts':1,'taskActualEngineStops':0,'taskManualExchangeWrites':0,'optionalOnlineNativeOrderReadback':'CANCELED_BACKUP_TIMEOUT_UNKNOWN','newOriginNaturalEntryAcceptance':'UNKNOWN_NO_FORCED_ORDERS','formalRiskCalibration':'INSUFFICIENT_EVIDENCE','engineExitTimerRemoved':True,'autoRestartEnabled':False,'sourceWorktree':'D:/MITS-worktrees/v398-entry-quality-20261008','dataJunctionTarget':'D:/MITS/data','priorLogsPreserved':True}
(e/'RUNTIME_CLOSEOUT.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
if not all(checks.values()):raise SystemExit('RUNTIME_CLOSEOUT_INCOMPLETE')
stamp=datetime.datetime.fromisoformat(j['observedAt'].replace('Z','+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M +08')
section=f'''

## 当前运行闭合 — {stamp}

代码 `3327c84ff943934653e003f98b31573b3886647d` 普通 FF 到 main，217 项 remote blob 哈希通过；[CI37850135010](https://github.com/3684993/ZDJMITS/actions/runs/37850135010) completed/success，deps/scripts/release/S00/typecheck/build/test全部成功，未额外 workflow_dispatch。

用户独立明确授权的当前 TESTNET 升级启动已完成，不再是 NOT_DEPLOYED。原已停止，stop=0、实际 MANUAL_START=1；PID8524、host PID44084、instance c685f035-1f52-48ac-80fa-998811ff3fe5、build3.9.8-7271c941c2cdec049610。工具 freshness 预检第一次在任何子进程创建前拒绝；UTC DateTime 被重解析为本地字符串造成 +8h，类型证据记录并修正，PreflightOnly通过后才完成唯一实际启动。没有 Engine 失败后的重新启动、退出定时器或自动重启 supervisor。

/health HTTP200 READY，closeout200，IDENTITY_CLOSED6/6；数据库 HEALTHY、scheduler RUNNING。启动前 signed GET13positions/12orders/risk-increasing0。原 TPGuardian 为 VVVUSDT SHORT41.25 补齐 BUY41.25 保护：第一次 SQLite lock 在 pre-wire 阶段 NOT_ATTEMPTED，正常保护重试后 TP_PROTECTED记录 exchangeOrderId775318990。当前 TP13/13，missing/duplicate/qtyMismatch/wrongSide/unverified均0。**Engine实际TESTNET写1、生产写0；任务人工交易0。** 不把自然保护写入藏成全局零写。

额外运行后 native GET 卡在在线 SQLite backup，只停止 owned read-only helper30824，未动 Engine8524/模型。没有生成原生 readback，不声称成功；TP证据为当前实例 TP_PROTECTED、qty/side/exchange ID、gateway/counter，额外native GET仍UNKNOWN。自动审批拒绝删除临时私有备份，原因仅为 blocked by policy；私有copy保留本机，公开大小/hash/ref清单，不换方式重试删除、不上传私有数据。

Settings247及完整payload digest前后相同；原 D:\\MITS 六项dirty entries与HEAD保留。运行源码 D:\\MITS-worktrees\\v398-entry-quality-20261008、data junction指向原 D:\\MITS\\data；不要从旧dirty checkout启动旧build。8081/8083/8084仍PID12732/17468/51124。原stdout/stderr原字节私有归档并公开hash/ref；原数据库/私有完整历史日志不上传。随后只提交维护工具/运行证据/报告，不改变已加载Engine src/dist。

详见RUNTIME_CLOSEOUT.json、分阶段快照、process receipts、source/hash/manifest、全部测试失败与成功日志。新origin的自然Entry/partial/concurrent/restart接受样本仍UNKNOWN，无强迫交易；formal sizing参数仍INSUFFICIENT_EVIDENCE。独立Reactivity历史6.14s未知链仍暂停。当前健康不代表未来无限uptime或风险算法已校准。
'''
p=b/'IMPLEMENTATION_REPORT.md';p.write_text(p.read_text(encoding='utf-8')+section,encoding='utf-8')
prefix=f'''# Current closure — V3.9.8 RUNNING / {stamp}

用户另行明确授权的当前TESTNET升级启动完成：代码3327c84，CI37850135010 success，remote217hash通过。PID8524/build3.9.8-7271c941c2cdec049610；/health READY、closeout200、identity6/6、TP13/13。生产写0、Engine自然TP写1、任务人工交易0；Settings247/digest与原dirty checkout未变。仅一次实际MANUAL_START，无退出定时器/自动重启。风险函数仅影子、formal calibration/new-origin natural evidence UNKNOWN。额外在线native GET备份超界已取消；临时私有copy因policy拒绝删除而本机保留。详见IMPLEMENTATION_REPORT.md / RUNTIME_CLOSEOUT.json。下方为原分阶段历史，旧NOT_DEPLOYED不能作为当前状态。

---

'''
for file in ['docs/plans/V398_ENTRY_SIZING_RISK_BUDGET_PLAN.md','docs/reports/v398-entry-sizing-quality-review/ENTRY_SIZING_QUALITY_REVIEW.md','docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md']:
    p=root/file;p.write_text(prefix+p.read_text(encoding='utf-8'),encoding='utf-8')
