import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {decodeEntryFacts,encodeEntryFacts,encodeReadableEntryFacts,ENTRY_READABLE_FACT_ENCODING_INSTRUCTIONS} from './entryFactEncoding.js';

const native=JSON.parse(readFileSync(new URL('./__fixtures__/entry-readable-sol-native.json',import.meta.url),'utf8'));
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const frames=['1d','4h','15m'];
const expandCandidate=(encoded:any,side:string,row:any)=>({...encoded.candidateCommon?.[side],...(row.targetTermsId&&encoded.targetTerms?.[side]?encoded.targetTerms[side][row.targetTermsId]:{}),...Object.fromEntries(Object.entries(row).filter(([key])=>!(key==='targetTermsId'&&encoded.targetTerms?.[side])).map(([key,value])=>[encoded.candidateFields?.[key]??key,value]))});
function freeze(value:unknown):void {
  if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}
}

describe('readable exact entry evidence',()=>{
  it('shows all 6 LONG and 10 SHORT candidates in the native SOL false-empty-menu case',()=>{
    expect(native.sourceRunId).toBe('airun_mur4ppbc_5kwdhygp');
    const original=clone(native.facts),before=clone(original);freeze(original);
    const encoded=encodeReadableEntryFacts(original),decoded=decodeEntryFacts(clone(encoded));
    expect(encoded.encoding).toBe('ENTRY_READABLE_FACTS_V4');
    expect(encoded.candidateCounts).toEqual({LONG:6,SHORT:10});
    for(const side of ['LONG','SHORT']){
      const literal=(encoded.facts as any).EXECUTION_ENVELOPE[side];
      expect(literal.planCandidates.map((row:any)=>expandCandidate(encoded,side,row))).toEqual(before.EXECUTION_ENVELOPE[side].planCandidates);
      expect(literal.candidateSetHash).toBe(before.EXECUTION_ENVELOPE[side].candidateSetHash);
      expect(literal.candidateSetFactVersion).toBe(before.EXECUTION_ENVELOPE[side].candidateSetFactVersion);
      expect(literal.planCandidates.every((row:any)=>typeof row.id==='string'&&(row.side??encoded.candidateCommon?.[side as 'LONG'|'SHORT']?.side)===side)).toBe(true);
    }
    expect(encoded.recordTables?.some(table=>table.path.includes('planCandidates'))??false).toBe(false);
    expect(decoded).toEqual(before);expect(original).toEqual(before);
  });

  it('publishes small exact strategic/tactical cards and preserves the full technical facts in tables',()=>{
    const original=clone(native.facts),encoded=encodeReadableEntryFacts(original),literal=encoded.criticalTechnicalFacts!;
    for(const frame of frames)expect(literal[frame]).toEqual(Object.fromEntries(['factId','trend','macdHistogram','emaSlope21','asOf','isClosed','source'].filter(key=>Object.hasOwn(original.MARKET_FACTS.symbol.technical[frame],key)).map(key=>[key,original.MARKET_FACTS.symbol.technical[frame][key]])));
    expect(encoded.technicalTables.flatMap(table=>table.rows).some(row=>row[0]==='symbol'&&frames.includes(String(row[1])))).toBe(true);
    expect(decodeEntryFacts(encoded)).toEqual(original);
  });

  it('preserves exact unknowns, absent fields, precision, cost versions and frozen event clocks',()=>{
    const original=clone(native.facts),row=original.EXECUTION_ENVELOPE.LONG.planCandidates[0];
    row.expectedNetPnlAtHorizonUsd=null;row.reachProbability=null;delete row.targetBasis;
    row.targetPrice=123.456789123456;row.marginUsd=0;row.futureFlag=false;
    original.MARKET_FACTS.symbol.technical['1m'].macdHistogram=-1.234567e-100;
    original.MARKET_FACTS.symbol.technical['1m'].isClosed=false;
    const encoded=encodeReadableEntryFacts(original),decoded=decodeEntryFacts(clone(encoded));
    expect(decoded).toEqual(original);
    expect(expandCandidate(encoded,'LONG',(encoded.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates[0])).toEqual(row);
    expect((encoded.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates[0]).not.toHaveProperty('targetBasis');
  });

  it('does not turn missing or null candidate evidence into a zero-length menu',()=>{
    for(const value of [undefined,null]){
      const original=clone(native.facts);
      if(value===undefined)delete original.EXECUTION_ENVELOPE.LONG.planCandidates;
      else original.EXECUTION_ENVELOPE.LONG.planCandidates=value;
      const encoded=encodeReadableEntryFacts(original);
      expect(encoded.candidateCounts).toEqual({SHORT:10});
      expect(decodeEntryFacts(encoded)).toEqual(original);
    }
    const original=clone(native.facts);original.EXECUTION_ENVELOPE.LONG.planCandidates=[];
    const encoded=encodeReadableEntryFacts(original);
    expect(encoded.candidateCounts).toEqual({LONG:0,SHORT:10});
    expect((encoded.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates).toEqual([]);
    expect(decodeEntryFacts(encoded)).toEqual(original);
  });

  it('protects literal cards/candidate menus even if complete ancestors equal another fact section',()=>{
    const original=clone(native.facts);
    // Object order makes OTHER the first dedup source; the important second copy
    // must not become a null placeholder or an inherited menu.
    const duplicated={OTHER:clone(original),...original};
    const encoded=encodeReadableEntryFacts(duplicated);
    expect((encoded.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates.map((row:any)=>expandCandidate(encoded,'LONG',row))).toEqual(original.EXECUTION_ENVELOPE.LONG.planCandidates);
    for(const frame of frames)expect(encoded.criticalTechnicalFacts?.[frame]).toMatchObject({factId:original.MARKET_FACTS.symbol.technical[frame].factId});
    expect(decodeEntryFacts(encoded)).toEqual(duplicated);
  });

  it('rejects mismatched counts or a table/copy that hides a protected literal',()=>{
    const encoded=encodeReadableEntryFacts(native.facts),wrongCount=clone(encoded);
    wrongCount.candidateCounts!.LONG=0;
    expect(()=>decodeEntryFacts(wrongCount)).toThrow('ENTRY_CANDIDATE_COUNTS_INVALID');
    const hidden=clone(encoded);
    hidden.contextCopies=[[['EXECUTION_ENVELOPE','LONG'],['EXECUTION_ENVELOPE','SHORT']]];
    expect(()=>decodeEntryFacts(hidden)).toThrow('ENTRY_READABLE_LITERAL_REQUIRED');
    const hiddenTable=clone(encoded);
    hiddenTable.recordTables=[{path:['EXECUTION_ENVELOPE','LONG','planCandidates'],length:6,groups:[]}];
    expect(()=>decodeEntryFacts(hiddenTable)).toThrow('ENTRY_READABLE_LITERAL_REQUIRED');
  });

  it('rejects inherited candidate overrides or common trading values beyond allowed metadata',()=>{
    const encoded=encodeReadableEntryFacts(native.facts),override=clone(encoded);
    (override.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates[0].costVersion=override.candidateCommon!.LONG!.costVersion;
    expect(()=>decodeEntryFacts(override)).toThrow('ENTRY_CANDIDATE_COMMON_OVERRIDE');
    const changed=clone(encoded);changed.candidateCommon!.LONG!.quantityUnits=209;
    expect(()=>decodeEntryFacts(changed)).toThrow(/ENTRY_CANDIDATE_COMMON_INVALID|ENTRY_REQUIRED_REFERENCES_MISMATCH/);
    const different=clone(native.facts);different.EXECUTION_ENVELOPE.LONG.planCandidates[0].costVersion='DIFFERENT';
    const varied=encodeReadableEntryFacts(different);
    expect(varied.candidateCommon!.LONG).not.toHaveProperty('costVersion');
    expect((varied.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates[0].costVersion).toBe('DIFFERENT');
    expect(decodeEntryFacts(varied)).toEqual(different);
  });

  it('validates short-name collision handling and rejects conflicting aliases or changed direct facts',()=>{
    const original=clone(native.facts);original.EXECUTION_ENVELOPE.LONG.planCandidates[0].id='future-original-field';
    const encoded=encodeReadableEntryFacts(original);
    expect(encoded.candidateFields).not.toHaveProperty('id');
    expect((encoded.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates[0].candidateId).toBe(original.EXECUTION_ENVELOPE.LONG.planCandidates[0].candidateId);
    expect(decodeEntryFacts(encoded)).toEqual(original);
    const conflict=encodeReadableEntryFacts(native.facts);
    (conflict.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates[0].candidateId='changed';
    expect(()=>decodeEntryFacts(conflict)).toThrow('ENTRY_CANDIDATE_FIELD_CONFLICT');
    const wrong=encodeReadableEntryFacts(native.facts);(wrong.criticalTechnicalFacts!['4h'] as any).macdHistogram=-999;
    expect(()=>decodeEntryFacts(wrong)).toThrow('ENTRY_CRITICAL_FACTS_MISMATCH');
  });

  it('uses one exact named target reference while all size and net values remain literal',()=>{
    const encoded=encodeReadableEntryFacts(native.facts);
    expect(encoded.targetTerms!.LONG!.T1.targetPrice).toBe(native.facts.EXECUTION_ENVELOPE.LONG.planCandidates[0].targetPrice);
    for(const side of ['LONG','SHORT'] as const){
      const candidates=(encoded.facts as any).EXECUTION_ENVELOPE[side].planCandidates;
      candidates.forEach((row:any,index:number)=>{
        expect(typeof row.targetTermsId).toBe('string');
        expect(row.id).toBe(native.facts.EXECUTION_ENVELOPE[side].planCandidates[index].candidateId);
        expect(row.qtyUnits).toBe(native.facts.EXECUTION_ENVELOPE[side].planCandidates[index].quantityUnits);
        expect(row.marginUsd).toBe(native.facts.EXECUTION_ENVELOPE[side].planCandidates[index].marginUsd);
        expect(row.notionalUsd).toBe(native.facts.EXECUTION_ENVELOPE[side].planCandidates[index].notionalUsd);
        expect(row.targetNetUsd).toBe(native.facts.EXECUTION_ENVELOPE[side].planCandidates[index].targetConditionalNetProfitUsd);
        expect(row.expectedNetUsd).toBe(native.facts.EXECUTION_ENVELOPE[side].planCandidates[index].expectedNetPnlAtHorizonUsd);
      });
    }
    expect(decodeEntryFacts(encoded)).toEqual(native.facts);
  });

  it('rejects unknown named targets, target overrides, unreferenced targets and trading values in terms',()=>{
    const original=encodeReadableEntryFacts(native.facts),unknown=clone(original);
    (unknown.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates[0].targetTermsId='T999';
    expect(()=>decodeEntryFacts(unknown)).toThrow('ENTRY_TARGET_TERMS_REFERENCE_INVALID');
    const override=clone(original);(override.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates[0].targetPrice=1;
    expect(()=>decodeEntryFacts(override)).toThrow('ENTRY_TARGET_TERMS_OVERRIDE');
    const unused=clone(original);unused.targetTerms!.LONG!.T999=clone(unused.targetTerms!.LONG!.T1);
    expect(()=>decodeEntryFacts(unused)).toThrow(/ENTRY_TARGET_TERMS_UNUSED|ENTRY_REQUIRED_REFERENCES_MISMATCH/);
    const size=clone(original);size.targetTerms!.LONG!.T1.quantityUnits=999;
    expect(()=>decodeEntryFacts(size)).toThrow('ENTRY_TARGET_TERMS_INVALID');
  });

  it('does not overwrite future field collisions or merge target values that differ by one exact field',()=>{
    const collision=clone(native.facts);collision.EXECUTION_ENVELOPE.LONG.planCandidates[0].targetTermsId='original-future-key';
    const preserved=encodeReadableEntryFacts(collision);
    expect(preserved.targetTerms).not.toHaveProperty('LONG');expect(decodeEntryFacts(preserved)).toEqual(collision);
    const changed=clone(native.facts);changed.EXECUTION_ENVELOPE.LONG.planCandidates[0].reachProbability=0.2666666666666667;
    const encoded=encodeReadableEntryFacts(changed),literal=(encoded.facts as any).EXECUTION_ENVELOPE.LONG.planCandidates;
    expect(encoded.targetTerms!.LONG![literal[0].targetTermsId].reachProbability).toBe(0.2666666666666667);
    expect(decodeEntryFacts(encoded)).toEqual(changed);
  });

  it.each(['targetTerms','candidateFields','candidateCommon','requiredReferences'] as const)('rejects removal of the whole %s metadata section',field=>{
    const encoded=encodeReadableEntryFacts(native.facts);delete encoded[field];
    expect(()=>decodeEntryFacts(encoded)).toThrow(/ENTRY_REQUIRED_REFERENCES_(INVALID|MISMATCH)/);
  });

  it('rejects an orphan side map, a removed named target, a deleted common field or a partial alias map',()=>{
    const base=encodeReadableEntryFacts(native.facts),missingSide=clone(base);
    delete missingSide.targetTerms!.LONG;
    expect(()=>decodeEntryFacts(missingSide)).toThrow('ENTRY_REQUIRED_REFERENCES_MISMATCH');
    const missingTarget=clone(base);delete missingTarget.targetTerms!.LONG!.T1;
    expect(()=>decodeEntryFacts(missingTarget)).toThrow('ENTRY_REQUIRED_REFERENCES_MISMATCH');
    const missingCommonSide=clone(base);delete missingCommonSide.candidateCommon!.LONG;
    expect(()=>decodeEntryFacts(missingCommonSide)).toThrow('ENTRY_REQUIRED_REFERENCES_MISMATCH');
    const missingCommon=clone(base);delete missingCommon.candidateCommon!.LONG!.costVersion;
    expect(()=>decodeEntryFacts(missingCommon)).toThrow('ENTRY_REQUIRED_REFERENCES_MISMATCH');
    const missingAlias=clone(base);delete missingAlias.candidateFields!.qtyUnits;
    expect(()=>decodeEntryFacts(missingAlias)).toThrow('ENTRY_REQUIRED_REFERENCES_MISMATCH');
  });

  it('preserves an original future targetTermsId value even if it looks like a generated reference',()=>{
    const source=clone(native.facts);source.EXECUTION_ENVELOPE.LONG.planCandidates[0].targetTermsId='T1';
    const encoded=encodeReadableEntryFacts(source);
    expect(encoded.targetTerms).not.toHaveProperty('LONG');
    expect(encoded.requiredReferences!.targetTerms).not.toHaveProperty('LONG');
    expect(decodeEntryFacts(encoded)).toEqual(source);
  });

  it('retains legacy V3 audit decoding without rewriting archived input or inventing counts',()=>{
    const old=encodeEntryFacts(native.facts);
    expect(old.encoding).toBe('ENTRY_FACT_TABLES_V3');
    expect(old).not.toHaveProperty('candidateCounts');
    expect(decodeEntryFacts(clone(old))).toEqual(native.facts);
    expect(ENTRY_READABLE_FACT_ENCODING_INSTRUCTIONS).toContain('explicit candidate objects');
    expect(ENTRY_READABLE_FACT_ENCODING_INSTRUCTIONS).toContain('Absent stays absent');
  });
});
