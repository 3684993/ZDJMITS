// Offline only. Does not contact a model, exchange, or running Engine.
// Usage: node --import tsx scripts/research/replay-primary-prompt-factoring.mjs INPUT_JSON OUTPUT_JSON
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {EntryDecisionJsonSchema} from '../../packages/contracts/src/ai.ts';
import {ENTRY_PRIMARY_INSTRUCTIONS} from '../../packages/core/src/compactEntry.ts';
import {encodeEntryFacts,decodeEntryFacts,ENTRY_FACT_ENCODING_INSTRUCTIONS} from '../../packages/core/src/entryFactEncoding.ts';

const [inputFile,outputFile]=process.argv.slice(2);
assert(inputFile&&outputFile,'input archive JSON and output report JSON required');
const input=JSON.parse(readFileSync(inputFile,'utf8'));
const rows=Array.isArray(input.runs)?input.runs:Object.values(input).map(detail=>detail.run);
assert(rows.length&&rows.every(row=>row&&typeof row.symbol==='string'),'native primary records required');
const hash=value=>createHash('sha256').update(value).digest('hex'),bytes=value=>Buffer.byteLength(value,'utf8');
const request=prompt=>({model:'qwen/qwen3.8-27b',reasoning_effort:'none',messages:[{role:'user',content:prompt}],
  temperature:.1,stream:false,max_tokens:900,response_format:{type:'json_schema',json_schema:{name:'EntryDecisionV392',strict:true,schema:EntryDecisionJsonSchema}}});
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}};
const runs=rows.map(row=>{
  const archived=row.prompt?{prompt:row.prompt}:typeof row.inputPreview==='string'?JSON.parse(row.inputPreview):row.inputPreview;
  const original=archived?.prompt;assert(typeof original==='string','archived prompt required');
  const marker='\nINPUT:',split=original.indexOf(marker),encodingAt=original.indexOf('INPUT_ENCODING '),scoutAt=original.indexOf('SCOUT_FACTS_NON_AUTHORITATIVE:');
  assert(split>encodingAt&&encodingAt>=0,'encoded native INPUT required');
  const afterInput=original.slice(split+marker.length),raw=afterInput.split('\nPREVIOUS_WAIT_RECONFIRMATION:')[0];
  const previous=JSON.parse(raw),facts=decodeEntryFacts(previous),before=structuredClone(facts);freeze(facts);
  const encoded=encodeEntryFacts(facts),wire=JSON.stringify(encoded),decoded=decodeEntryFacts(JSON.parse(wire));
  assert.deepEqual(decoded,before);assert.deepEqual(facts,before);
  const scout=scoutAt<0?'':original.slice(scoutAt,encodingAt),tail=afterInput.slice(raw.length);
  const prompt=`${ENTRY_PRIMARY_INSTRUCTIONS}\n${scout}${ENTRY_FACT_ENCODING_INSTRUCTIONS}${marker}${wire}${tail}`;
  const beforeRequest=request(original),afterRequest=request(prompt);
  assert.deepEqual(beforeRequest.response_format,afterRequest.response_format);
  const beforeBody=JSON.stringify(beforeRequest),afterBody=JSON.stringify(afterRequest);
  assert(afterBody.length<beforeBody.length,'full request must shrink for every replayed run');
  return{runId:row.id,symbol:row.symbol,status:row.status,archivedLatencyMs:row.latencyMs,
    archivedInputTokens:row.inputTokens??null,
    beforePromptCharacters:original.length,afterPromptCharacters:prompt.length,
    beforePromptUtf8Bytes:bytes(original),afterPromptUtf8Bytes:bytes(prompt),
    beforeRequestCharacters:beforeBody.length,afterRequestCharacters:afterBody.length,
    beforeRequestUtf8Bytes:bytes(beforeBody),afterRequestUtf8Bytes:bytes(afterBody),
    promptReductionPercent:Number((100*(1-prompt.length/original.length)).toFixed(2)),
    requestReductionPercent:Number((100*(1-afterBody.length/beforeBody.length)).toFixed(2)),
    // This is an explicitly labeled size proxy, never a claim of measured tokenization.
    estimatedInputTokensByPromptCharacterRatio:row.inputTokens==null?null:Math.round(row.inputTokens*prompt.length/original.length),
    sourcePromptSha256:hash(original),newPromptSha256:hash(prompt),
    allFactsRoundtripExact:true,sourceFactsUnchanged:true,scoutAndConfirmationUnchanged:true,strictSchemaUnchanged:true,
    candidates:Object.fromEntries(['LONG','SHORT'].map(side=>[side,decoded.EXECUTION_ENVELOPE[side].planCandidates.length])),
    technicalCopies:encoded.technicalTables.reduce((n,t)=>n+(t.copies?.length??0),0),
    candidateProfiles:(encoded.recordTables??[]).filter(t=>t.path[2]==='planCandidates').map(t=>({side:t.path[1],candidateCount:t.length,profileCounts:t.groups.map(g=>g.profiles?.rows.length??0)})),
    contextCopies:encoded.contextCopies??[]};
});
const sum=key=>runs.reduce((total,row)=>total+row[key],0),before=sum('beforeRequestUtf8Bytes'),after=sum('afterRequestUtf8Bytes');
const report={method:'OFFLINE_NATIVE_ARCHIVE_REPLAY_NO_MODEL_CALL',source:resolve(inputFile),generatedAt:new Date().toISOString(),encoding:'ENTRY_FACT_TABLES_V3',
  runCount:runs.length,allFactsRoundtripExact:true,strictSchemaUnchanged:true,outputBudget:900,existingTimeoutMs:180000,
  responseSchemaUtf8Bytes:bytes(JSON.stringify(EntryDecisionJsonSchema)),responseSchemaSha256:hash(JSON.stringify(EntryDecisionJsonSchema)),
  beforeRequestUtf8Bytes:before,afterRequestUtf8Bytes:after,requestReductionPercent:Number((100*(1-after/before)).toFixed(2)),
  beforePromptCharacters:sum('beforePromptCharacters'),afterPromptCharacters:sum('afterPromptCharacters'),
  actualNewPromptTokens:null,actualNewLatencyMs:null,
  limitations:['Character-scaled token estimates are a size proxy calibrated to each archived run, not a Qwen tokenizer measurement.',
    'Serialized request sizes include the unchanged strict schema; providers may not tokenize all serialized fields.',
    'Archival redaction is retained. Exact equality covers all supplied archived prompt facts, not redacted secrets.',
    'No latency or timeout-resolution claim can be established without separately authorized native inference.'],runs};
mkdirSync(dirname(resolve(outputFile)),{recursive:true});writeFileSync(outputFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:resolve(outputFile),runs:runs.length,requestReductionPercent:report.requestReductionPercent,allFactsRoundtripExact:true}));
