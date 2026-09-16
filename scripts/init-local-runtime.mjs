#!/usr/bin/env node
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,renameSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
const option=(name,fallback)=>args.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.resolve(option('data-dir',path.join(root,'data')));
const live=path.join(dataDir,'zdj-settings.sqlite');
if(!existsSync(live))throw new Error(`INIT_LIVE_DB_NOT_FOUND:${live}`);

// This script is deliberately local-only. It never imports an exchange adapter and never
// opens a network connection. start-v3.ps1 also refuses init while the engine is listening.
let db;
try{
  db=new DatabaseSync(live);
  const integrity=db.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if(integrity!=='ok')throw new Error(`INIT_LIVE_DB_INTEGRITY_FAILED:${integrity}`);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}finally{db?.close();}

const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const archive=path.join(dataDir,'init-archive',stamp);
const fresh=path.join(dataDir,`.zdj-init-${stamp}.sqlite`);
const freshReport=`${fresh}.verification.json`;
mkdirSync(archive,{recursive:true});

const resetScript=path.join(root,'scripts','reset-testnet-runtime-db.mjs');
try{
  execFileSync(process.execPath,[resetScript,`--source=${live}`,`--output=${fresh}`],{cwd:root,stdio:'inherit',windowsHide:true});
  const report=JSON.parse(readFileSync(freshReport,'utf8'));
  if(report.status!=='FRESH_TESTNET_DB_READY_NOT_INSTALLED'||report.strategy!=='SCHEMA_ONLY_REBUILD'||report.integrity!=='ok'||report.originalPreserved!==true)throw new Error('INIT_FRESH_DB_VERIFICATION_INVALID');

  const moved=[];
  const move=(source,name=path.basename(source))=>{
    if(!existsSync(source))return;
    const destination=path.join(archive,name);
    if(existsSync(destination))throw new Error(`INIT_ARCHIVE_COLLISION:${destination}`);
    renameSync(source,destination);moved.push({source,destination});
  };
  try{
    // Main runtime database: static settings/secrets/resources were copied into `fresh` by
    // reset-testnet-runtime-db.mjs; all other tables are schema-only/empty.
    move(live,'zdj-settings.sqlite.before-init');
    move(`${live}-wal`,'zdj-settings.sqlite-wal.before-init');
    move(`${live}-shm`,'zdj-settings.sqlite-shm.before-init');
    renameSync(fresh,live);

    // Independent evidence/history stores must start a new experiment as well.
    for(const name of ['trading-quality.sqlite','trading-quality.sqlite-wal','trading-quality.sqlite-shm','v393-evidence.sqlite','v393-evidence.sqlite-wal','v393-evidence.sqlite-shm','v393-experiment-manifest.json'])move(path.join(dataDir,name));
    for(const name of ['rate-limit','runtime-logs','logs'])move(path.join(dataDir,name));

    const initReport={
      status:'V393_LOCAL_INIT_COMPLETE',
      initializedAt:new Date().toISOString(),
      strategy:'LOCAL_SCHEMA_ONLY_RESET',
      exchangeWrites:false,
      exchangeOrdersCanceled:false,
      exchangePositionsClosed:false,
      preservedTables:report.preservedTables,
      clearedTables:report.clearedTables,
      resetEvidence:['trading-quality.sqlite','v393-evidence.sqlite','v393-experiment-manifest.json'],
      resetRuntimeHistory:['rate-limit','runtime-logs','logs'],
      liveDb:live,
      rollbackArchive:archive,
    };
    writeFileSync(path.join(archive,'init-report.json'),JSON.stringify(initReport,null,2),{flag:'wx'});
    if(existsSync(freshReport))renameSync(freshReport,path.join(archive,'fresh-db.verification.json'));
    console.log(JSON.stringify(initReport,null,2));
  }catch(error){
    // If installation failed before the new live DB became usable, restore the original.
    try{
      if(existsSync(live)&&moved.some(x=>x.source===live))rmSync(live,{force:true});
      for(const item of moved.reverse())if(!existsSync(item.source)&&existsSync(item.destination)){mkdirSync(path.dirname(item.source),{recursive:true});renameSync(item.destination,item.source);}
    }catch(rollbackError){throw new AggregateError([error,rollbackError],'INIT_FAILED_AND_ROLLBACK_FAILED');}
    throw error;
  }
}catch(error){
  if(existsSync(fresh))rmSync(fresh,{force:true});
  if(existsSync(freshReport))rmSync(freshReport,{force:true});
  throw error;
}
