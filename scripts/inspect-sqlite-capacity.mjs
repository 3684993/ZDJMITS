#!/usr/bin/env node
import {existsSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const args=process.argv.slice(2),option=(name,fallback)=>args.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const dbPath=path.resolve(option('db','data/zdj-settings.sqlite.compact')),out=option('out',''),top=Math.max(5,Math.min(100,Number(option('top','30'))||30));
if(!existsSync(dbPath))throw new Error(`DB_NOT_FOUND:${dbPath}`);
const q=name=>`"${String(name).replaceAll('"','""')}"`,db=new DatabaseSync(dbPath,{readOnly:true}),now=Date.now(),day=86_400_000;
const cutoff=days=>now-days*day;
try{
 const integrity=String(db.prepare('PRAGMA integrity_check').get()?.integrity_check??'unknown');if(integrity!=='ok')throw new Error(`SQLITE_INTEGRITY_FAILED:${integrity}`);
 const pageSize=Number(db.prepare('PRAGMA page_size').get()?.page_size??0),pageCount=Number(db.prepare('PRAGMA page_count').get()?.page_count??0),freePages=Number(db.prepare('PRAGMA freelist_count').get()?.freelist_count??0),maxPages=Number(db.prepare('PRAGMA max_page_count').get()?.max_page_count??0);
 const fileBytes=statSync(dbPath).size,walPath=dbPath+'-wal',walBytes=existsSync(walPath)?statSync(walPath).size:0,livePageBytes=Math.max(0,pageCount-freePages)*pageSize;
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>String(r.name));
 const tableStats=[];
 for(const table of tables){
  const columns=db.prepare(`PRAGMA table_info(${q(table)})`).all().map(r=>String(r.name)),rowCount=Number(db.prepare(`SELECT COUNT(*) n FROM ${q(table)}`).get()?.n??0);
  const payloadColumns=columns.filter(c=>/payload|json|preview|summary|content|state|evidence/i.test(c));let logicalBytes=0;
  if(payloadColumns.length){const expression=payloadColumns.map(c=>`COALESCE(length(${q(c)}),0)`).join('+');logicalBytes=Number(db.prepare(`SELECT COALESCE(SUM(${expression}),0) n FROM ${q(table)}`).get()?.n??0);}
  tableStats.push({table,rowCount,logicalBytes,payloadColumns});
 }
 tableStats.sort((a,b)=>b.logicalBytes-a.logicalBytes||b.rowCount-a.rowCount);
 const eventTypes=tables.includes('runtime_events')?db.prepare(`SELECT type,COUNT(*) rows,COALESCE(SUM(length(payload)),0) payloadBytes,MIN(ts) firstTs,MAX(ts) lastTs,SUM(CASE WHEN ts<? THEN 1 ELSE 0 END) older1dRows,SUM(CASE WHEN ts<? THEN 1 ELSE 0 END) older7dRows,SUM(CASE WHEN ts<? THEN 1 ELSE 0 END) older14dRows,SUM(CASE WHEN ts<? THEN 1 ELSE 0 END) older30dRows,COALESCE(SUM(CASE WHEN ts<? THEN length(payload) ELSE 0 END),0) older7dPayloadBytes FROM runtime_events GROUP BY type ORDER BY payloadBytes DESC LIMIT ?`).all(cutoff(1),cutoff(7),cutoff(14),cutoff(30),cutoff(7),top):[];
 const entityKinds=tables.includes('runtime_entities')?db.prepare('SELECT kind,COUNT(*) rows,COALESCE(SUM(length(payload)),0) payloadBytes FROM runtime_entities GROUP BY kind ORDER BY payloadBytes DESC LIMIT ?').all(top):[];
 const aiArchiveAge=tables.includes('ai_runs_archive')?db.prepare(`SELECT status,COALESCE(role,'UNKNOWN') role,COUNT(*) rows,COALESCE(SUM(length(payload)),0) payloadBytes,SUM(CASE WHEN started_at<? THEN 1 ELSE 0 END) older1dRows,SUM(CASE WHEN started_at<? THEN 1 ELSE 0 END) older7dRows,SUM(CASE WHEN started_at<? THEN 1 ELSE 0 END) older14dRows,COALESCE(SUM(CASE WHEN started_at<? THEN length(payload) ELSE 0 END),0) older1dPayloadBytes,COALESCE(SUM(CASE WHEN started_at<? THEN length(payload) ELSE 0 END),0) older7dPayloadBytes FROM ai_runs_archive GROUP BY status,role ORDER BY payloadBytes DESC`).all(cutoff(1),cutoff(7),cutoff(14),cutoff(1),cutoff(7)):[];
 const chainClassification=tables.includes('decision_chains')?db.prepare(`SELECT status,CASE WHEN json_valid(payload)=0 THEN 'MALFORMED' WHEN EXISTS (SELECT 1 FROM json_each(payload,'$.events') e WHERE json_extract(e.value,'$.type') GLOB '*ORDER*' OR json_extract(e.value,'$.type') GLOB '*FILL*' OR json_extract(e.value,'$.type') GLOB '*TP_*' OR json_extract(e.value,'$.type') GLOB '*MANUAL*') THEN 'EXECUTION_LINKED' ELSE 'ANALYSIS_ONLY' END class,COUNT(*) rows,COALESCE(SUM(length(payload)),0) payloadBytes,SUM(CASE WHEN updated_at<? THEN 1 ELSE 0 END) older1dRows,SUM(CASE WHEN updated_at<? THEN 1 ELSE 0 END) older7dRows,SUM(CASE WHEN updated_at<? THEN 1 ELSE 0 END) older14dRows,COALESCE(SUM(CASE WHEN updated_at<? THEN length(payload) ELSE 0 END),0) older7dPayloadBytes FROM decision_chains GROUP BY status,class ORDER BY payloadBytes DESC`).all(cutoff(1),cutoff(7),cutoff(14),cutoff(7)):[];
 const snapshotAge=tables.includes('decision_snapshots')?db.prepare(`SELECT COUNT(*) rows,COALESCE(SUM(length(payload)),0) payloadBytes,SUM(CASE WHEN created_at<? THEN 1 ELSE 0 END) older1dRows,SUM(CASE WHEN created_at<? THEN 1 ELSE 0 END) older3dRows,SUM(CASE WHEN created_at<? THEN 1 ELSE 0 END) older7dRows,COALESCE(SUM(CASE WHEN created_at<? THEN length(payload) ELSE 0 END),0) older1dPayloadBytes,COALESCE(SUM(CASE WHEN created_at<? THEN length(payload) ELSE 0 END),0) older3dPayloadBytes FROM decision_snapshots`).get(cutoff(1),cutoff(3),cutoff(7),cutoff(1),cutoff(3)):null;
 const runtimeAi=tables.includes('runtime_entities')?db.prepare(`SELECT CASE WHEN json_valid(payload) THEN COALESCE(json_extract(payload,'$.status'),'UNKNOWN') ELSE 'MALFORMED' END status,COUNT(*) rows,COALESCE(SUM(length(payload)),0) payloadBytes FROM runtime_entities WHERE kind='aiRuns' GROUP BY status ORDER BY payloadBytes DESC`).all():[];
 const GiB=1024**3,MiB=1024**2,round256=value=>Math.ceil(value/(256*MiB))*256*MiB;let guardrailRecommendation;
 if(fileBytes>=6*GiB)guardrailRecommendation={status:'BASELINE_TOO_LARGE',reason:'Compact baseline is >=6 GiB; classify remaining protected facts before choosing a hard limit.'};
 else guardrailRecommendation={status:'PROVISIONAL',warningBytes:round256(Math.max(fileBytes*1.20,fileBytes+512*MiB)),pressureBytes:round256(Math.max(fileBytes*1.35,fileBytes+GiB)),entryBlockBytes:round256(Math.max(fileBytes*1.50,fileBytes+1.5*GiB)),hardMaxBytes:Math.min(8*GiB,round256(Math.max(fileBytes*1.75,fileBytes+2*GiB))),note:'Calibrate after 2h/6h observed growth; hard limit must stay above the verified compact baseline and reserve critical audit/TP writes.'};
 const report={mode:'READ_ONLY_SQLITE_CAPACITY_V2',dbPath,generatedAt:new Date().toISOString(),integrity,fileBytes,walBytes,pageSize,pageCount,freePages,maxPages,livePageBytes,freePageRatio:pageCount?freePages/pageCount:0,tableCount:tables.length,topTables:tableStats.slice(0,top),runtimeEventTypes:eventTypes,runtimeEntityKinds:entityKinds,aiArchiveAge,decisionChainClassification:chainClassification,decisionSnapshotAge:snapshotAge,runtimeAiStatus:runtimeAi,guardrailRecommendation};
 const text=JSON.stringify(report,null,2);if(out)writeFileSync(path.resolve(out),text,{flag:'wx'});console.log(text);
}finally{db.close();}
