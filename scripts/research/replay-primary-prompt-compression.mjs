// Offline only: read a fixed native archive interval; never contact a model or exchange.
// Usage: node scripts/research/replay-primary-prompt-compression.mjs DB START_MS END_MS OUTPUT_JSON
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {encodeEntryFacts,decodeEntryFacts,ENTRY_FACT_ENCODING_INSTRUCTIONS} from '../../packages/core/dist/entryFactEncoding.js';

const [database,startText,endText,output]=process.argv.slice(2);
const start=Number(startText),end=Number(endText);
assert(database&&output&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&end>=start,'fixed interval and output required');
const rows=JSON.parse(execFileSync('python3',['-c',`
import json,sqlite3,sys
from pathlib import Path
con=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True)
rows=con.execute("select payload from ai_runs_archive where started_at>=? and completed_at<=? and model=? order by started_at",(int(sys.argv[2]),int(sys.argv[3]),'qwen/qwen3.8-27b')).fetchall()
print(json.dumps([json.loads(row[0]) for row in rows]))
`,database,String(start),String(end)],{encoding:'utf8',maxBuffer:16*1024*1024}));
assert(rows.length>0,'no native archive rows in fixed interval');
const bytes=value=>Buffer.byteLength(value,'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}};
const runs=[];
for(const row of rows){
  const runId=row.runId??row.id;assert(typeof runId==='string'&&runId.length>0,'native run ID required');
  const input=typeof row.inputPreview==='string'?JSON.parse(row.inputPreview):row.inputPreview;
  assert(input&&typeof input.prompt==='string'&&input.packet,'native input prompt and packet required');
  const original=input.prompt;
  const split=original.indexOf('INPUT:');assert(split>=0,'native INPUT marker missing');
  const afterInput=original.slice(split+6),confirmationMarker='\nPREVIOUS_WAIT_RECONFIRMATION:';
  const confirmationAt=afterInput.indexOf(confirmationMarker);
  const rawFacts=confirmationAt<0?afterInput:afterInput.slice(0,confirmationAt);
  const facts=JSON.parse(rawFacts);
  // The archived packet uses [Circular] placeholders for shared references, so
  // it cannot reconstruct every original field. The actual transmitted prompt
  // remains complete and is the authoritative source for this transport replay.
  const factsBefore=normalize(facts);freeze(facts);
  const encodedJsonSource=JSON.stringify(encodeEntryFacts(facts));
  const prompt=original.slice(0,split)+ENTRY_FACT_ENCODING_INSTRUCTIONS+'\nINPUT:'+encodedJsonSource+
    (confirmationAt<0?'':afterInput.slice(confirmationAt));
  const encodedJson=prompt.split('\nINPUT:')[1].split(confirmationMarker)[0];
  const encoded=JSON.parse(encodedJson),decoded=decodeEntryFacts(encoded);
  assert.deepEqual(decoded,facts);
  assert.deepEqual(facts,factsBefore);
  const rebuilt=prompt.replace(`${ENTRY_FACT_ENCODING_INSTRUCTIONS}\n`,'').replace(encodedJson,rawFacts);
  assert.equal(rebuilt,original,'existing rules, Scout and reconfirmation must remain byte-identical');
  const beforeBytes=bytes(original),afterBytes=bytes(prompt);
  runs.push({runId,symbol:row.symbol,startedAt:row.startedAt,status:row.status,
    beforePromptUtf8Bytes:beforeBytes,afterPromptUtf8Bytes:afterBytes,
    reductionPercent:Number((100*(1-afterBytes/beforeBytes)).toFixed(2)),
    beforeFactsUtf8Bytes:bytes(rawFacts),encodedFactsUtf8Bytes:bytes(encodedJson),
    sourcePromptSha256:hash(original),compressedPromptSha256:hash(prompt),
    aliasCount:encoded.aliases?.length??0,technicalRows:encoded.technicalTables.reduce((n,t)=>n+t.rows.length,0),
    recordTables:(encoded.recordTables??[]).map(t=>({path:t.path,length:t.length})),
    candidates:{LONG:facts.EXECUTION_ENVELOPE.LONG.planCandidates.length,SHORT:facts.EXECUTION_ENVELOPE.SHORT.planCandidates.length},
    factsRoundtripExact:true,sourceFactsUnchanged:true,existingInstructionsUnchanged:true,
    archivedPacketHasCircularPlaceholders:JSON.stringify(input.packet).includes('[Circular]')});
}
const before=runs.reduce((sum,r)=>sum+r.beforePromptUtf8Bytes,0),after=runs.reduce((sum,r)=>sum+r.afterPromptUtf8Bytes,0);
const report={generatedAt:new Date().toISOString(),method:'OFFLINE_NATIVE_ARCHIVE_REPLAY_NO_MODEL_CALL',
  database:resolve(database),interval:{startedAtGte:start,completedAtLte:end},encoding:'ENTRY_FACT_TABLES_V3',
  runCount:runs.length,allFactsRoundtripExact:true,allExistingInstructionsUnchanged:true,allSourceFactsUnchanged:true,
  beforePromptUtf8Bytes:before,afterPromptUtf8Bytes:after,reductionPercent:Number((100*(1-after/before)).toFixed(2)),
  actualNewPromptTokens:null,actualNewLatencyMs:null,
  limitations:['UTF-8 byte reduction is not a measured tokenizer or latency reduction.','Strict response schema is unchanged.','Replay uses actual prompt facts, not the lossy archived packet with shared-reference placeholders.','Only post-deployment native inference can establish successful timely decisions.'],runs};
mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:resolve(output),runs:runs.length,reductionPercent:report.reductionPercent,allFactsRoundtripExact:true}));
