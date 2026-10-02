import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--plan'))throw new Error('Only --plan is supported; no command or lifecycle forwarding is permitted.');
const tsc='node_modules/typescript/bin/tsc',vueTsc='node_modules/vue-tsc/bin/vue-tsc.js';
const vite='node_modules/vite/bin/vite.js',vitest='node_modules/vitest/vitest.mjs';
const plan=[
  {name:'contracts build',cwd:'.',cli:tsc,args:['-p','packages/contracts/tsconfig.json']},
  {name:'core build',cwd:'.',cli:tsc,args:['-p','packages/core/tsconfig.json']},
  ...['contracts','core'].map(name=>({name:`${name} typecheck`,cwd:'.',cli:tsc,args:['-p',`packages/${name}/tsconfig.json`,'--noEmit']})),
  {name:'engine typecheck',cwd:'.',cli:tsc,args:['-p','apps/engine/tsconfig.json','--noEmit']},
  {name:'dashboard typecheck',cwd:'apps/dashboard',cli:vueTsc,args:['--noEmit']},
  // SQLite collection tests use a compiled worker; build it before the complete engine suite.
  {name:'engine build',cwd:'.',cli:tsc,args:['-p','apps/engine/tsconfig.json']},
  {name:'dashboard build',cwd:'apps/dashboard',cli:vite,args:['build','--outDir','<temporary-dashboard-output>','--emptyOutDir']},
  {name:'storage preflight temporary self-test',cwd:'.',cli:'scripts/v394-stage6-preflight.mjs',args:['--self-test']},
  ...['packages/contracts','packages/core','apps/engine','apps/dashboard'].map(cwd=>({
    name:`${cwd} complete tests`,cwd,cli:vitest,args:['run',...(cwd==='packages/contracts'?['--passWithNoTests']:[])]})),
];

if(args.includes('--plan')){
  console.log(JSON.stringify({execution:'NODE_CLI_WITHOUT_SHELL',runtimeMode:'MOCK',plan},null,2));
}else{
  const temp=mkdtempSync(path.join(tmpdir(),'zdj-entry-quality-'));
  const dataDir=path.join(temp,'data'),backups=path.join(temp,'backups');
  mkdirSync(dataDir);mkdirSync(backups);
  const env={...process.env,CI:'true',ZDJ_DATA_MODE:'mock',ZDJ_AI_MODE:'mock',ZDJ_TRADING_ADAPTER:'mock',
    ZDJ_DATA_DIR:dataDir,ZDJ_TRADE_SYNC_BACKUP_DIR:backups,npm_config_offline:'true',npm_config_ignore_scripts:'true'};
  try{
    for(const step of plan){
      console.log(`ENTRY_QUALITY_VERIFY: ${step.name}`);
      const stepArgs=step.args.map(arg=>arg==='<temporary-dashboard-output>'?path.join(temp,'dashboard'):arg);
      const result=spawnSync(process.execPath,[path.join(root,step.cli),...stepArgs],{
        cwd:path.join(root,step.cwd),env,shell:false,stdio:'inherit',windowsHide:true,
      });
      if(result.error)throw result.error;
      if(result.status!==0)throw new Error(`ENTRY_QUALITY_VERIFY_FAILED: ${step.name} (${result.signal??result.status})`);
    }
    console.log('ENTRY_QUALITY_VERIFY_PASS');
  }finally{
    rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
}
