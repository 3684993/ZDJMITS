import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { createConnection, isIP } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DURABLE_SQLITE } from './durable-storage-inventory.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SECRET_KEYS=new Set(['apikey','apisecret','secret','password','token','ciphertext']);

/** Per-table row counts. Two files with the same fingerprint hold the same records. */
function fingerprint(db){return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(row=>[row.name,Number(one(db,`SELECT COUNT(*) AS c FROM "${row.name.replaceAll('"','""')}"`)?.c??0)]));}

function arg(name,fallback){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;}
function assertNoSecretKeys(value,at='root'){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(SECRET_KEYS.has(key.toLowerCase()))throw new Error(`SECRET_FIELD_IN_EXPORT:${at}.${key}`);assertNoSecretKeys(item,`${at}.${key}`);}}
function portListening(port){return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});const done=value=>{socket.destroy();resolve(value);};socket.setTimeout(500);socket.once('connect',()=>done(true));socket.once('timeout',()=>done(false));socket.once('error',()=>done(false));});}
function one(db,sql){return db.prepare(sql).get();}
function rows(db,table){try{return db.prepare(`SELECT id,payload,updated_at FROM ${table} ORDER BY updated_at DESC`).all().map(row=>({...row,payload:JSON.parse(String(row.payload))}));}catch{return[];}}
function safeSettings(db){const row=one(db,'SELECT version,payload,updated_at FROM settings WHERE id=1');if(!row)throw new Error('SETTINGS_ROW_MISSING');const payload=JSON.parse(String(row.payload));assertNoSecretKeys(payload,'settings');return{version:Number(row.version),updatedAt:Number(row.updated_at),payload};}

async function runPreflight({dataDir,outDir,port=8080,skipEngineCheck=false}){
  if(!skipEngineCheck&&await portListening(port))throw new Error(`ENGINE_MUST_BE_OFF: port ${port} is listening`);
  const dbPath=path.join(dataDir,'zdj-settings.sqlite');await stat(dbPath);await mkdir(outDir,{recursive:true});
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
    const integrity=String(one(db,'PRAGMA integrity_check')?.integrity_check??'UNKNOWN');if(integrity.toLowerCase()!=='ok')throw new Error(`SQLITE_INTEGRITY_FAILED:${integrity}`);
    const settings=safeSettings(db),connections=settings.payload.connections??{},exchange=connections.exchange??{},proxy=connections.proxy??{},rest=String(exchange.testnetRestBaseUrl??exchange.testnetBaseUrl??'');
    if(exchange.environment!=='TESTNET')throw new Error('STAGE6_REQUIRES_TESTNET');
    if(connections.executionMode!=='READ_ONLY')throw new Error('STAGE6_REQUIRES_READ_ONLY');
    if(new URL(rest).hostname!=='demo-fapi.binance.com')throw new Error(`STAGE6_REQUIRES_BINANCE_DEMO_REST:${rest}`);
    if(proxy.enabled!==true||String(proxy.protocol??'')!=='SOCKS5H'||!String(proxy.url??'')){let scheme='INVALID_OR_MISSING';try{scheme=new URL(String(proxy.url??'')).protocol;}catch{}throw new Error('STAGE6_REQUIRES_ENABLED_SOCKS5H_PROXY:enabled='+String(proxy.enabled===true)+',protocol='+String(proxy.protocol??'MISSING')+',urlScheme='+scheme);}
    const expectedEgress=String(proxy.expectedStaticEgressIp??'').trim();if(!expectedEgress)throw new Error('STAGE6_REQUIRES_EXPECTED_STATIC_EGRESS_IP');if(!isIP(expectedEgress))throw new Error('STAGE6_EXPECTED_STATIC_EGRESS_IP_INVALID');

    const resources={exchange:rows(db,'exchange_resources'),proxy:rows(db,'proxy_resources'),ai:rows(db,'ai_resources')};assertNoSecretKeys(resources,'resources');
    let profile=null;try{const row=one(db,"SELECT profile,updated_at FROM connection_profiles WHERE id='active'");if(row)profile={updatedAt:Number(row.updated_at),profile:JSON.parse(String(row.profile))};}catch{}if(profile)assertNoSecretKeys(profile,'connectionProfile');
    let secretMetadata=[];try{secretMetadata=db.prepare('SELECT ref,last4,updated_at FROM secrets ORDER BY ref').all();}catch{}
    // S08: every durable SQLite file in the data directory is backed up and verified here, not just
    // the settings store. The ownership ledger holds who controls a position and what is still in
    // flight; a restore point that loses it cannot be trusted, so it is part of the same image.
    const durable=[];
    for(const name of DURABLE_SQLITE){
      const source=path.join(dataDir,name),target=path.join(outDir,name);
      let handle=source===dbPath?db:null;
      if(!handle){try{await stat(source);}catch{durable.push({name,present:false,backedUp:false,reason:'FILE_ABSENT'});continue;}handle=new DatabaseSync(source,{readOnly:true});}
      try{
        const before=fingerprint(handle);
        if(String(one(handle,'PRAGMA integrity_check')?.integrity_check??'').toLowerCase()!=='ok')throw new Error(`SOURCE_INTEGRITY_FAILED:${name}`);
        await sqliteBackup(handle,target);
        const check=new DatabaseSync(target,{readOnly:true});
        try{
          if(String(one(check,'PRAGMA integrity_check')?.integrity_check??'').toLowerCase()!=='ok')throw new Error(`BACKUP_INTEGRITY_FAILED:${name}`);
          const after=fingerprint(check);
          // Row counts per table are the restore proof: the same owner versions, deadlines and
          // pending outbox rows must be there, not merely a file of the same size.
          if(JSON.stringify(before)!==JSON.stringify(after))throw new Error(`BACKUP_FINGERPRINT_MISMATCH:${name}`);
          durable.push({name,present:true,backedUp:true,integrity:'ok',tables:before});
        }finally{check.close();}
      }finally{if(source!==dbPath)handle.close();}
    }
    await Promise.all([writeFile(path.join(outDir,'settings.json'),JSON.stringify(settings,null,2)),writeFile(path.join(outDir,'resource-profiles.json'),JSON.stringify(resources,null,2)),writeFile(path.join(outDir,'connection-profile.json'),JSON.stringify(profile,null,2)),writeFile(path.join(outDir,'secret-metadata.json'),JSON.stringify(secretMetadata,null,2))]);
    const manifest={schema:'V3.9.6-STAGE6-PREFLIGHT-2',createdAt:new Date().toISOString(),sourceDb:dbPath,sqliteIntegrity:'ok',settingsVersion:settings.version,environment:exchange.environment,executionMode:connections.executionMode,restHost:new URL(rest).hostname,wsBaseUrl:exchange.testnetWsBaseUrl??null,proxyUrl:String(proxy.url),expectedStaticEgressIp:expectedEgress,secretMaterialExported:false,durableSqlite:durable,
      files:[...new Set([...durable.filter(row=>row.backedUp).map(row=>row.name),'settings.json','resource-profiles.json','connection-profile.json','secret-metadata.json','manifest.json'])]};
    await writeFile(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));return manifest;
  }finally{db.close();}
}

async function selfTest(){
  const temp=await mkdtemp(path.join(os.tmpdir(),'zdj-v394-preflight-')),dataDir=path.join(temp,'data'),outDir=path.join(temp,'evidence');await mkdir(dataDir,{recursive:true});
  const db=new DatabaseSync(path.join(dataDir,'zdj-settings.sqlite'));try{
    db.exec("CREATE TABLE settings(id INTEGER PRIMARY KEY,version INTEGER,payload TEXT,updated_at INTEGER);CREATE TABLE connection_profiles(id TEXT PRIMARY KEY,profile TEXT,updated_at INTEGER);CREATE TABLE exchange_resources(id TEXT PRIMARY KEY,payload TEXT,updated_at INTEGER);CREATE TABLE proxy_resources(id TEXT PRIMARY KEY,payload TEXT,updated_at INTEGER);CREATE TABLE ai_resources(id TEXT PRIMARY KEY,payload TEXT,updated_at INTEGER);CREATE TABLE secrets(ref TEXT PRIMARY KEY,ciphertext TEXT,last4 TEXT,updated_at INTEGER);");
    const settings={settingsVersion:7,connections:{executionMode:'READ_ONLY',exchange:{environment:'TESTNET',testnetBaseUrl:'https://demo-fapi.binance.com',testnetRestBaseUrl:'https://demo-fapi.binance.com',testnetWsBaseUrl:'wss://stream.binancefuture.com/ws'},proxy:{enabled:true,protocol:'SOCKS5H',url:'socks5h://127.0.0.1:20081',expectedStaticEgressIp:'203.0.113.10'}}};
    db.prepare('INSERT INTO settings VALUES(1,?,?,?)').run(7,JSON.stringify(settings),Date.now());db.prepare('INSERT INTO connection_profiles VALUES(?,?,?)').run('active',JSON.stringify({connections:settings.connections}),Date.now());db.prepare('INSERT INTO proxy_resources VALUES(?,?,?)').run('binance-proxy',JSON.stringify({id:'binance-proxy',url:'socks5h://127.0.0.1:20081'}),Date.now());db.prepare('INSERT INTO secrets VALUES(?,?,?,?)').run('TESTNET:key','DO_NOT_EXPORT','1234',Date.now());
  }finally{db.close();}
  // The ownership ledger is created exactly the way the runtime creates it, so the self-test proves
  // the real file shape is what gets backed up and verified.
  const ledger=new DatabaseSync(path.join(dataDir,'v396-ownership.sqlite'));
  try{
    ledger.exec('CREATE TABLE v396_owners(scope TEXT,cycle_id TEXT,version INTEGER,payload TEXT);CREATE TABLE v396_outbox(id INTEGER PRIMARY KEY,key TEXT,payload TEXT,type TEXT);CREATE TABLE v396_quantity_claims(scope TEXT,slot INTEGER,claim TEXT);CREATE TABLE v396_claims_history(key TEXT,payload TEXT);CREATE TABLE v396_mandates(scope TEXT,cycle_id TEXT,payload TEXT);');
    ledger.prepare('INSERT INTO v396_owners VALUES(?,?,?,?)').run('["TESTNET","binance-primary","BTCUSDT","LONG"]','cycle_ledger',1,JSON.stringify({ownerState:'HANDOFF_PENDING',ownerVersion:1,deadline:null}));
    ledger.prepare('INSERT INTO v396_outbox(key,payload,type) VALUES(?,?,?)').run('k1','{}','OWNERSHIP_CHANGED');
  }finally{ledger.close();}
  try{const manifest=await runPreflight({dataDir,outDir,skipEngineCheck:true}),secret=await readFile(path.join(outDir,'secret-metadata.json'),'utf8');if(secret.includes('DO_NOT_EXPORT')||manifest.secretMaterialExported!==false)throw new Error('SELF_TEST_SECRET_LEAK');
    const covered=manifest.durableSqlite.filter(row=>row.backedUp).map(row=>row.name).sort();
    if(JSON.stringify(covered)!==JSON.stringify([...DURABLE_SQLITE].sort()))throw new Error(`SELF_TEST_DURABLE_COVERAGE:${covered.join(',')}`);
    const ledgerEntry=manifest.durableSqlite.find(row=>row.name==='v396-ownership.sqlite');
    if(ledgerEntry?.tables?.v396_owners!==1||ledgerEntry?.tables?.v396_outbox!==1)throw new Error('SELF_TEST_LEDGER_ROWS_NOT_PRESERVED');
    console.log('V3.9.4 Stage6 preflight self-test PASS');}
  finally{await rm(temp,{recursive:true,force:true});}
}

if(process.argv.includes('--self-test'))await selfTest();
else{
  const dataDir=path.resolve(arg('--data-dir',path.join(root,'data'))),stamp=new Date().toISOString().replace(/[:.]/g,'-'),outDir=path.resolve(arg('--out-dir',path.join(root,'data','reports',`v394-stage6-preflight-${stamp}`))),port=Number(arg('--port','8080'));
  const manifest=await runPreflight({dataDir,outDir,port});console.log(`STAGE6_PREFLIGHT_PASS=${outDir}`);console.log(JSON.stringify(manifest,null,2));
}
