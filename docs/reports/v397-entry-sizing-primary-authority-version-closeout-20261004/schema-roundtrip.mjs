// Offline copy of the current TESTNET Settings DB; source files are only read.
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const root=path.resolve(process.argv[2]??'.'),data=path.resolve(process.argv[3]??path.join(root,'data'));
const temp=mkdtempSync(path.join(tmpdir(),'v397-schema-roundtrip-'));
const source=path.join(data,'zdj-settings.sqlite'),target=path.join(temp,'zdj-settings.sqlite');
let store;
try{
  copyFileSync(source,target);
  for(const suffix of ['-wal','-shm'])try{copyFileSync(source+suffix,target+suffix);}catch{}
  const inspect=()=>{
    const db=new DatabaseSync(target,{readOnly:true});
    try{
      const integrity=db.prepare('PRAGMA integrity_check').all().map(row=>String(row.integrity_check));
      const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>String(row.name));
      const counts=Object.fromEntries(tables.map(name=>[name,Number(db.prepare(`SELECT COUNT(*) n FROM "${name.replaceAll('"','""')}"`).get().n)]));
      return{integrity,tables:tables.length,counts};
    }finally{db.close();}
  };
  const before=inspect();
  if(before.integrity.join(',')!=='ok')throw new Error('SOURCE_COPY_INTEGRITY_FAILED');
  const {SettingsStore}=await import(pathToFileURL(path.join(root,'apps/engine/dist/config/settingsStore.js')).href);
  store=new SettingsStore(path.join(root,'config'),temp);
  const settings=await store.load();store.close();store=null;
  const after=inspect();
  const decreases=Object.entries(before.counts).filter(([table,count])=>Number(after.counts[table]??0)<Number(count))
    .map(([table,count])=>({table,before:count,after:after.counts[table]??0}));
  if(after.integrity.join(',')!=='ok'||decreases.length)throw new Error(`SCHEMA_ROUNDTRIP_LOST_ROWS:${JSON.stringify(decreases)}`);
  if(settings.entry.minimumInitialMarginByQuote.USDT<100||settings.entry.minimumInitialMarginByQuote.USDC<100||
    Number(settings.entry.minimumOrderNotionalBySymbol?.BTCUSDT)<150)throw new Error('V397_ENTRY_POLICY_MIGRATION_FAILED');
  console.log(JSON.stringify({gate:'V397_CURRENT_TESTNET_DB_COPY_ROUNDTRIP_PASS',settingsVersion:settings.settingsVersion,
    entry:{minimumInitialMarginByQuote:settings.entry.minimumInitialMarginByQuote,
      BTCUSDTBusinessMinimum:settings.entry.minimumOrderNotionalBySymbol.BTCUSDT,
      legacyQuoteMinimum:settings.entry.minimumOrderNotionalByQuote},
    integrity:'ok',tables:after.tables,rowsPreserved:true,
    additions:Object.entries(after.counts).filter(([table,count])=>Number(count)>Number(before.counts[table]??0)).map(([table,count])=>({table,before:before.counts[table]??0,after:count})),
    sourceModified:false}));
}finally{store?.close();rmSync(temp,{recursive:true,force:true});}
