import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import path from 'node:path';import {createHash} from 'node:crypto';import {gzipSync,gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const types=['CANDIDATE_RANKING_SHADOW','SHADOW_SAMPLE_RECORDED','POOL_UPDATED','POOL_SUPPLY_HEALTH','ASSET_ADMISSION_EVALUATED','UNIVERSE_UPDATED','MARKET_FRESHNESS_RECOVERED','MARKET_FRESHNESS_RECOVERY'];
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
/** Export -> readback/hash/count -> optional exact-row prune; never touches trading facts. */
export async function archiveTelemetry({database,outDir,before,limit=5000,prune=false}){
 if(!path.isAbsolute(database)||!path.isAbsolute(outDir)||!Number.isFinite(before)||before>Date.now()-86400000)throw new Error('ABSOLUTE_PATHS_AND_CLOSED_24H_WINDOW_REQUIRED');
 const db=new DatabaseSync(database,{readOnly:!prune});db.exec('PRAGMA busy_timeout=1000');
 try{
  const rows=db.prepare(`SELECT id,type,ts,symbol,payload FROM runtime_events WHERE ts<? AND type IN (${types.map(()=>'?').join(',')}) ORDER BY ts,id LIMIT ?`).all(before,...types,limit);
  if(!rows.length)return{rows:0,deleted:0};
  const raw=Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n'),digest=hash(raw),name=`telemetry-${rows[0].ts}-${rows.at(-1).ts}-${digest.slice(0,16)}`;await mkdir(outDir,{recursive:true});
  const file=path.join(outDir,name+'.jsonl.gz'),tmp=file+'.tmp';await writeFile(tmp,gzipSync(raw));const decoded=gunzipSync(await readFile(tmp));
  if(hash(decoded)!==digest||decoded.toString().trim().split('\n').length!==rows.length)throw new Error('ARCHIVE_READBACK_FAILED');await rename(tmp,file);
  const manifest={file,rows:rows.length,firstAt:rows[0].ts,lastAt:rows.at(-1).ts,sha256:digest,sourceBytes:raw.length,verifiedAt:Date.now(),deleted:0};
  await writeFile(file+'.manifest.json',JSON.stringify(manifest,null,2));
  if(prune){db.exec('BEGIN IMMEDIATE');try{const del=db.prepare('DELETE FROM runtime_events WHERE id=? AND type=? AND ts=? AND payload=?');for(const r of rows)manifest.deleted+=Number(del.run(r.id,r.type,r.ts,r.payload).changes);if(manifest.deleted!==rows.length)throw new Error('ARCHIVE_SOURCE_CHANGED');db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}await writeFile(file+'.manifest.json',JSON.stringify(manifest,null,2));}
  return manifest;
 }finally{db.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [database,outDir,beforeRaw,limitRaw,flag]=process.argv.slice(2);const result=await archiveTelemetry({database,outDir,before:Number(beforeRaw),limit:Number(limitRaw??5000),prune:flag==='--prune-verified'});process.stdout.write(JSON.stringify(result)+'\n');
}
