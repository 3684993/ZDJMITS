#!/usr/bin/env node
import {existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const arg=(name,fallback)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const file=path.resolve(arg('db','data/trading-quality.sqlite'));
if(!existsSync(file)){console.log(JSON.stringify({status:'INCONCLUSIVE',reason:'PROSPECTIVE_EVIDENCE_DB_NOT_CREATED',db:file}));process.exit(0);}
const db=new DatabaseSync(file,{readOnly:true});
try{
 const table=db.prepare("SELECT name FROM sqlite_master WHERE name='tq_episodes'").get();
 if(!table)throw new Error('NOT_A_TRADING_QUALITY_EVIDENCE_DATABASE');
 const {tradingQualityReport}=await import(pathToFileURL(path.resolve('apps/engine/dist/services/tradingQualityCollector.js')).href);
 const scopes=db.prepare('SELECT DISTINCT scope FROM tq_facts').all().map(x=>x.scope),selected=arg('scope',null);
 console.log(JSON.stringify({mode:'READ_ONLY',db:file,reports:scopes.filter(s=>!selected||s===selected).map(s=>tradingQualityReport(db,s))},null,2));
}finally{db.close();}
