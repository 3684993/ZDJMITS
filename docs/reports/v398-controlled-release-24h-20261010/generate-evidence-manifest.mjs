// Generate hashes of this delivery's staged Git blobs; no live runtime access.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const prefix='docs/reports/v398-controlled-release-24h-20261010/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=execFileSync('git',['diff','--cached','--name-only'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).filter(p=>p!==prefix+'evidence-manifest.json');
const rows=files.map(file=>{
  const local=readFileSync(file),blob=execFileSync('git',['show',':'+file],{maxBuffer:4*1024*1024});
  if(file.endsWith('.log')&&!local.equals(blob))throw Error('RAW_LOG_BLOB_CHANGED:'+file);
  return {file,localBytes:local.length,localSha256:hash(local),gitBlobBytes:blob.length,gitBlobSha256:hash(blob),byteIdentity:local.equals(blob)?'EXACT':'GIT_TEXT_NORMALIZATION'};
});
writeFileSync(prefix+'evidence-manifest.json',JSON.stringify({sourceSha:'8cd63a0f13f3260b3faa986b89959cfb090d6844',scope:'STAGED_DELIVERY_FILES_EXCLUDING_THIS_SELF_REFERENTIAL_MANIFEST',files:rows},null,2)+'\n');
console.log(JSON.stringify({files:rows.length,rawLogs:rows.filter(r=>r.file.endsWith('.log')).length,rawLogBytesPreserved:true}));
