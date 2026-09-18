import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { createConnection } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function arg(name,fallback){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;}
function listeningAt(host,port){return new Promise(resolve=>{const s=createConnection({host,port});const done=v=>{s.destroy();resolve(v)};s.setTimeout(800);s.once('connect',()=>done(true));s.once('timeout',()=>done(false));s.once('error',()=>done(false));});}\nfunction listening(port){return listeningAt('127.0.0.1',port);}
function one(db,sql){return db.prepare(sql).get();}
function restHost(settings){const x=settings?.connections?.exchange??{},rest=String(x.testnetRestBaseUrl??x.testnetBaseUrl??'');return rest?new URL(rest).hostname:'';}

async function forceReadOnly({dataDir,backupDir,port=8080,skipEngineCheck=false,authorizeEnableProxy=false}){
  if(!skipEngineCheck&&await listening(port))throw new Error('ENGINE_MUST_BE_OFF: port '+port+' is listening');
  const dbPath=path.join(dataDir,'zdj-settings.sqlite');
  await mkdir(backupDir,{recursive:true});
  const db=new DatabaseSync(dbPath);
  try{
    const integrity=String(one(db,'PRAGMA integrity_check')?.integrity_check??'UNKNOWN');
    if(integrity.toLowerCase()!=='ok')throw new Error('SQLITE_INTEGRITY_FAILED:'+integrity);
    const row=one(db,'SELECT version,payload,updated_at FROM settings WHERE id=1');
    if(!row)throw new Error('SETTINGS_ROW_MISSING');
    const before=JSON.parse(String(row.payload)),oldVersion=Number(row.version);
    if(before?.connections?.exchange?.environment!=='TESTNET')throw new Error('READONLY_DOWNGRADE_REQUIRES_TESTNET');
    const beforeRestHost=restHost(before);
    if(!['demo-fapi.binance.com','testnet.binancefuture.com'].includes(beforeRestHost))throw new Error('READONLY_DOWNGRADE_UNSUPPORTED_TESTNET_REST:'+beforeRestHost);
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const backupPath=path.join(backupDir,'zdj-settings-before-readonly-'+stamp+'.sqlite');
    await sqliteBackup(db,backupPath);
    const verifyBackup=new DatabaseSync(backupPath,{readOnly:true});
    try{const check=String(one(verifyBackup,'PRAGMA integrity_check')?.integrity_check??'UNKNOWN');if(check.toLowerCase()!=='ok')throw new Error('BACKUP_INTEGRITY_FAILED:'+check);}
    finally{verifyBackup.close();}
    if(!['READ_ONLY','TESTNET_ENABLED'].includes(before.connections.executionMode))throw new Error('UNSUPPORTED_EXECUTION_MODE:'+before.connections.executionMode);
    const proxy=before.connections.proxy??{},proxyUrl=String(proxy.url??'');
    let proxyScheme='';try{proxyScheme=new URL(proxyUrl).protocol.toLowerCase();}catch{}
    const needsProxyProtocol=!proxy.protocol&&proxyScheme==='socks5h:';
    if(!proxy.protocol&&proxyScheme!=='socks5h:')throw new Error('LEGACY_PROXY_PROTOCOL_AMBIGUOUS:'+String(proxyUrl||'MISSING_URL'));
    const needsProxyEnable=proxy.enabled!==true;
    if(needsProxyEnable&&!authorizeEnableProxy)throw new Error('STAGE6_PROXY_DISABLED_REQUIRES_EXPLICIT_AUTHORIZATION');
    if(needsProxyEnable){
      const parsedProxy=new URL(proxyUrl),proxyHost=parsedProxy.hostname.replace(/^\\[|\\]$/g,''),proxyPort=Number(parsedProxy.port||0);
      if(proxyScheme!=='socks5h:'||!proxyHost||!proxyPort)throw new Error('STAGE6_PROXY_ENABLE_REQUIRES_VALID_SOCKS5H_URL');
      if(!await listeningAt(proxyHost,proxyPort))throw new Error('STAGE6_PROXY_ENDPOINT_NOT_LISTENING:'+proxyHost+':'+proxyPort);
    }
    const needsRestMigration=beforeRestHost==='testnet.binancefuture.com';
    const needsModeDowngrade=before.connections.executionMode==='TESTNET_ENABLED';
    if(!needsRestMigration&&!needsModeDowngrade&&!needsProxyProtocol&&!needsProxyEnable)return{changed:false,oldVersion,newVersion:oldVersion,executionMode:'READ_ONLY',restHost:beforeRestHost,proxyEnabled:true,proxyProtocol:proxy.protocol??null,backupPath};
    const now=Date.now(),newVersion=oldVersion+1,after=structuredClone(before);
    after.settingsVersion=newVersion;
    if(needsRestMigration){after.connections.exchange.testnetBaseUrl='https://demo-fapi.binance.com';after.connections.exchange.testnetRestBaseUrl='https://demo-fapi.binance.com';after.connections.exchange.testnetWsBaseUrl=after.connections.exchange.testnetWsBaseUrl??'wss://stream.binancefuture.com/ws';}
    if(needsProxyProtocol)after.connections.proxy.protocol='SOCKS5H';
    if(needsProxyEnable)after.connections.proxy.enabled=true;
    after.connections.executionMode='READ_ONLY';
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('UPDATE settings SET version=?,payload=?,updated_at=? WHERE id=1').run(newVersion,JSON.stringify(after),now);
      db.prepare('INSERT INTO settings_audit(changed_at,source,old_version,new_version,summary) VALUES(?,?,?,?,?)').run(now,'v394-stage6-offline-migration',oldVersion,newVersion,JSON.stringify({message:'Stage6 offline safety normalization',executionMode:{before:before.connections.executionMode,after:'READ_ONLY'},testnetRestHost:{before:beforeRestHost,after:'demo-fapi.binance.com'},proxyProtocol:{before:proxy.protocol??null,after:after.connections.proxy?.protocol??null},proxyEnabled:{before:proxy.enabled===true,after:after.connections.proxy?.enabled===true}}));
      db.prepare("INSERT INTO connection_profiles(id,profile,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile,updated_at=excluded.updated_at").run('active',JSON.stringify({connections:after.connections,aiResources:after.aiResources}),now);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    const readback=one(db,'SELECT version,payload FROM settings WHERE id=1'),saved=JSON.parse(String(readback.payload));
    if(Number(readback.version)!==newVersion||saved.settingsVersion!==newVersion||saved.connections.executionMode!=='READ_ONLY'||restHost(saved)!=='demo-fapi.binance.com'||saved.connections.proxy?.protocol!=='SOCKS5H'||saved.connections.proxy?.enabled!==true)throw new Error('STAGE6_OFFLINE_NORMALIZATION_READBACK_FAILED');
    return{changed:true,oldVersion,newVersion,executionMode:saved.connections.executionMode,restHost:restHost(saved),migratedLegacyRest:needsRestMigration,normalizedProxyProtocol:needsProxyProtocol,enabledProxy:needsProxyEnable,proxyEnabled:saved.connections.proxy?.enabled===true,proxyProtocol:saved.connections.proxy?.protocol??null,backupPath};
  }finally{db.close();}
}
async function selfTest(){
  const temp=await mkdtemp(path.join(os.tmpdir(),'zdj-v394-readonly-')),dataDir=path.join(temp,'data'),backupDir=path.join(temp,'backup');
  await mkdir(dataDir,{recursive:true});
  const db=new DatabaseSync(path.join(dataDir,'zdj-settings.sqlite'));
  try{
    db.exec("CREATE TABLE settings(id INTEGER PRIMARY KEY,version INTEGER,payload TEXT,updated_at INTEGER);CREATE TABLE settings_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,changed_at INTEGER,source TEXT,old_version INTEGER,new_version INTEGER,summary TEXT);CREATE TABLE connection_profiles(id TEXT PRIMARY KEY,profile TEXT,updated_at INTEGER);");
    const settings={settingsVersion:41,connections:{executionMode:'TESTNET_ENABLED',exchange:{environment:'TESTNET',testnetBaseUrl:'https://testnet.binancefuture.com',testnetRestBaseUrl:'https://testnet.binancefuture.com'},proxy:{enabled:false,url:'socks5h://127.0.0.1:20081'}},aiResources:[],sentinel:'PRESERVE_ME'};
    db.prepare('INSERT INTO settings VALUES(1,?,?,?)').run(41,JSON.stringify(settings),Date.now());
  }finally{db.close();}
  try{
    let refused=false;try{await forceReadOnly({dataDir,backupDir,skipEngineCheck:true});}catch(error){refused=String(error).includes('STAGE6_PROXY_DISABLED_REQUIRES_EXPLICIT_AUTHORIZATION');}\n    if(!refused)throw new Error('SELF_TEST_PROXY_ENABLE_AUTHORIZATION_NOT_ENFORCED');\n    const listener=await new Promise((resolve,reject)=>{const server=(await import('node:net')).createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server));});\n    const address=listener.address(),proxyPort=typeof address==='object'&&address?address.port:0;\n    const dbPatch=new DatabaseSync(path.join(dataDir,'zdj-settings.sqlite'));try{const row=one(dbPatch,'SELECT payload FROM settings WHERE id=1'),value=JSON.parse(String(row.payload));value.connections.proxy.url='socks5h://127.0.0.1:'+proxyPort;dbPatch.prepare('UPDATE settings SET payload=? WHERE id=1').run(JSON.stringify(value));}finally{dbPatch.close();}\n    let result;try{result=await forceReadOnly({dataDir,backupDir,skipEngineCheck:true,authorizeEnableProxy:true});}finally{listener.close();}
    const verify=new DatabaseSync(path.join(dataDir,'zdj-settings.sqlite'),{readOnly:true});
    try{
      const row=one(verify,'SELECT version,payload FROM settings WHERE id=1'),saved=JSON.parse(String(row.payload)),audit=one(verify,"SELECT source FROM settings_audit ORDER BY id DESC LIMIT 1");
      if(result.changed!==true||Number(row.version)!==42||saved.settingsVersion!==42||saved.connections.executionMode!=='READ_ONLY'||saved.sentinel!=='PRESERVE_ME'||audit?.source!=='v394-stage6-offline-migration'||restHost(saved)!=='demo-fapi.binance.com'||saved.connections.proxy.protocol!=='SOCKS5H')throw new Error('SELF_TEST_READBACK_FAILED');
    }finally{verify.close();}
    const backup=new DatabaseSync(result.backupPath,{readOnly:true});
    try{const original=JSON.parse(String(one(backup,'SELECT payload FROM settings WHERE id=1').payload));if(original.connections.executionMode!=='TESTNET_ENABLED'||restHost(original)!=='testnet.binancefuture.com')throw new Error('SELF_TEST_BACKUP_NOT_ORIGINAL');}
    finally{backup.close();}
    console.log('V3.9.4 explicit proxy-enable + legacy normalization + READ_ONLY self-test PASS');
  }finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv.includes('--self-test'))await selfTest();
else{
  const dataDir=path.resolve(arg('--data-dir',path.join(root,'data'))),backupDir=path.resolve(arg('--backup-dir',path.join(root,'data','backups','v394-stage6'))),port=Number(arg('--port','8080'));
  const authorizeEnableProxy=process.argv.includes('--authorize-enable-proxy');\n  const result=await forceReadOnly({dataDir,backupDir,port,authorizeEnableProxy});
  console.log('V394_STAGE6_READONLY_READY=TRUE');console.log(JSON.stringify(result,null,2));
}
