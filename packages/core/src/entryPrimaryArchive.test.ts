import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {EntryDecisionJsonSchema,EntryDecisionReferenceJsonSchema} from '@zdj/contracts';
import native from './fixtures/entry-primary-native-20261001.json';
import {decodeEntryFacts,encodeEntryFacts,ENTRY_FACT_ENCODING_INSTRUCTIONS} from './entryFactEncoding.js';
import {ENTRY_PRIMARY_R1_INSTRUCTIONS} from './fixtures/entry-primary-r1-instructions.js';

describe('native 27B V2 to V3 offline prompt replay',()=>{
  it.each(native.runs)('preserves all supplied facts with explicitly versioned R1 output for $symbol ($status)',run=>{
    expect(createHash('sha256').update(run.prompt).digest('hex')).toBe(run.promptSha256);
    const marker='\nINPUT:',confirmation='\nPREVIOUS_WAIT_RECONFIRMATION:',input=run.prompt.split(marker)[1];
    const raw=input.split(confirmation)[0],prior=JSON.parse(raw),facts=decodeEntryFacts(prior),before=structuredClone(facts);
    expect(prior.encoding).toBe('ENTRY_FACT_TABLES_V2');
    const freeze=(value:any)=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}};freeze(facts);
    const encoded=encodeEntryFacts(facts),decoded:any=decodeEntryFacts(JSON.parse(JSON.stringify(encoded)));
    expect(decoded).toEqual(before);expect(facts).toEqual(before);
    for(const side of ['LONG','SHORT']){
      const candidates=(before as any).EXECUTION_ENVELOPE[side].planCandidates;
      expect(decoded.EXECUTION_ENVELOPE[side].planCandidates).toEqual(candidates);
      expect(encoded.recordTables?.find(t=>t.path[1]===side)?.groups.some(g=>g.profiles!==undefined)).toBe(true);
    }
    const scoutAt=run.prompt.indexOf('SCOUT_FACTS_NON_AUTHORITATIVE:'),encodingAt=run.prompt.indexOf('INPUT_ENCODING ');
    const scout=scoutAt<0?'':run.prompt.slice(scoutAt,encodingAt),tail=input.slice(raw.length);
    const next=`${ENTRY_PRIMARY_R1_INSTRUCTIONS}\n${scout}${ENTRY_FACT_ENCODING_INSTRUCTIONS}${marker}${JSON.stringify(encoded)}${tail}`;
    const body=(prompt:string,schema=EntryDecisionJsonSchema)=>({model:'qwen/qwen3.8-27b',reasoning_effort:'none',messages:[{role:'user',content:prompt}],temperature:.1,stream:false,max_tokens:900,
      response_format:{type:'json_schema',json_schema:{name:'EntryDecisionV392',strict:true,schema}}});
    const originalRequest=body(run.prompt),newRequest=body(next,EntryDecisionReferenceJsonSchema as typeof EntryDecisionJsonSchema);
    expect(newRequest.response_format.json_schema.schema).toEqual(EntryDecisionReferenceJsonSchema);
    expect(newRequest.response_format.json_schema.strict).toBe(true);
    expect(newRequest.response_format.json_schema.schema).not.toEqual(originalRequest.response_format.json_schema.schema);
    expect(newRequest.max_tokens).toBe(900);expect(newRequest.reasoning_effort).toBe('none');
    expect(JSON.stringify(newRequest).length).toBeLessThan(JSON.stringify(originalRequest).length);
    expect(next).toContain(scout);if(tail)expect(next.endsWith(tail)).toBe(true);
    expect(next).toContain('Never replace original event timestamps with the current clock');
    expect(next).toContain('schemaVersion=V3.9.7-R1');
    expect(next).not.toContain('V3.9.7-R2');
  });
});
