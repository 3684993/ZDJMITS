import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const out='docs/reports/v396-local-main-sync-cleanup-restart-20260928';const gates=[];
for(const [id,command] of [['formal-build','npm run build'],['s00','node scripts/v396-s00-static-check.mjs'],['storage','node scripts/v396-storage-coverage.mjs --out='+out+'/storage-coverage.json --verify-backup'],['diff','git diff --check']]){
 console.log('START '+id);const start=new Date().toISOString();const r=spawnSync(command,{shell:true,encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'}});
 const body=((r.stdout??'')+'\n'+(r.stderr??'')).replace(/\u001b\[[0-9;]*m/g,'').split(/\r?\n/).map(x=>x.trimEnd()).join('\n');writeFileSync(out+'/'+id+'.txt',body+'\n');gates.push({id,command,start,end:new Date().toISOString(),exitCode:r.status});writeFileSync(out+'/fresh-local-gates.json',JSON.stringify(gates,null,2)+'\n');console.log('END '+id+' '+r.status);if(r.status!==0){console.log(body.slice(-8000));process.exit(1);}}
