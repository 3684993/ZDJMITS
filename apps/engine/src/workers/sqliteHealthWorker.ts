import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';

const {dbPath,intervalMs}=workerData as {dbPath:string;intervalMs:number};
let db:DatabaseSync|null=null,lastIntegrityAt=0,lastIntegrity:boolean|null=null;
function inspect(){
  const checkedAt=Date.now();
  try{
    db??=new DatabaseSync(dbPath,{readOnly:true});
    const events=db.prepare('SELECT COUNT(*) AS n FROM runtime_events').get() as {n:number};
    const runtime=db.prepare('SELECT updated_at FROM runtime_state WHERE id=1').get() as {updated_at:number}|undefined;
    if(checkedAt-lastIntegrityAt>=5*60_000||lastIntegrity===null){const row=db.prepare('PRAGMA quick_check(1)').get() as {quick_check?:string}|undefined;lastIntegrity=row?.quick_check==='ok';lastIntegrityAt=checkedAt;}
    parentPort?.postMessage({integrity:lastIntegrity,auditEvents:Number(events.n),runtimePersistedAt:runtime?.updated_at??null,checkedAt,error:null});
  }catch(error){parentPort?.postMessage({integrity:null,auditEvents:0,runtimePersistedAt:null,checkedAt,error:error instanceof Error?error.message:String(error)});try{db?.close();}catch{}db=null;}
}
inspect();const timer=setInterval(inspect,Math.max(5_000,intervalMs));timer.unref();
