import {describe,expect,it} from 'vitest';
import {decodeEntryRecordTables,encodeEntryRecordTables,type EntryRecordObject,type EntryRecordTable} from './entryRecordTables.js';

const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const card=(i:number)=>({candidateId:`candidate-LONG-${i}`,side:'LONG',quantityUnits:i+1,marginUsd:25.00000000000001+i,
  targetConditionalNetProfitUsd:-0.123456789012345+i,expectedNetPnlAtHorizonUsd:null,reachProbabilityStatus:'UNPROVEN',
  costVersion:'COST_VERSION_MUST_STAY_EXACT',createdAt:1790823900123,expiresAt:1790823960123,
  acceptableTargetRange:{min:0.000000000123456789,max:0.000000000987654321},evidenceRefs:['quote.top'],missingEvidence:false,
  note:'All original IDs, prices, signed costs, legal limits and timestamps must be retained exactly.'});
const fixture=():EntryRecordObject=>({EXECUTION_ENVELOPE:{LONG:{planCandidates:Array.from({length:8},(_,i)=>card(i))},
  SHORT:{planCandidates:Array.from({length:6},(_,i)=>({...card(i),candidateId:`candidate-SHORT-${i}`,side:'SHORT'}))},
  reachability:{horizons:Array.from({length:6},(_,i)=>({horizonMinutes:i*5+5,timeframe:'1m',sampleCount:100,status:'PROVEN',
    LONG:{p50MovePercent:0.123456789012345+i,p75MovePercent:0.223456789012345+i},SHORT:{p50MovePercent:0.3+i,p75MovePercent:0.4+i},
    provenance:'SOURCE_ONLY_NO_CHANGE_TO_TIME_OR_MISSINGNESS'}))},riskHeadroom:{factVersion:'KEEP_ALL_AUDIT_FIELDS'}},
  unrelated:{planCandidates:[card(0)]},validFactIds:['quote.top','symbol.1m.confirmed']});
const encoded=()=>{const facts=fixture(),tables=encodeEntryRecordTables(facts);return{facts,tables};};

describe('bounded lossless entry record tables',()=>{
  it('round-trips all three targets with exact numbers, null, IDs, timestamps, source fields and order',()=>{
    const facts=fixture(),original=clone(facts),tables=encodeEntryRecordTables(facts);
    expect(tables).toHaveLength(3);
    expect((facts.EXECUTION_ENVELOPE as any).LONG.planCandidates).toEqual([]);
    expect(facts.unrelated).toEqual(original.unrelated);
    expect(JSON.stringify({facts,tables}).length).toBeLessThan(JSON.stringify(original).length);
    decodeEntryRecordTables(facts,tables);expect(facts).toEqual(original);
  });
  it('groups exact field sets and preserves absent versus null, false, zero, empty strings, arrays and objects',()=>{
    const facts=fixture(),cards=(facts.EXECUTION_ENVELOPE as any).LONG.planCandidates;
    delete cards[0].expectedNetPnlAtHorizonUsd;cards[1].expectedNetPnlAtHorizonUsd=null;
    cards[2].optional=0;cards[3].optional=false;cards[4].optional='';cards[5].optional=[];cards[6].optional={};
    const original=clone(facts),tables=encodeEntryRecordTables(facts);decodeEntryRecordTables(facts,tables);
    expect(facts).toEqual(original);expect(Object.hasOwn((facts.EXECUTION_ENVELOPE as any).LONG.planCandidates[0],'expectedNetPnlAtHorizonUsd')).toBe(false);
  });
  it('preserves original candidate order when field-set groups interleave',()=>{
    const facts=fixture(),cards=(facts.EXECUTION_ENVELOPE as any).LONG.planCandidates;
    cards.forEach((c:any,i:number)=>{if(i%2)c.extra='COMMON_FOR_ODD';});
    const original=clone(facts),tables=encodeEntryRecordTables(facts);expect(tables[0].groups).toHaveLength(2);
    decodeEntryRecordTables(facts,tables);expect(facts).toEqual(original);
  });
  it('shares equal nested values despite insertion order without merging unequal values',()=>{
    const facts=fixture(),cards=(facts.EXECUTION_ENVELOPE as any).LONG.planCandidates;
    cards.forEach((c:any,i:number)=>{c.additional=i%2?{b:2,a:1}:{a:1,b:2};});
    const original=clone(facts),tables=encodeEntryRecordTables(facts);expect(tables[0].groups[0].common.additional).toEqual({a:1,b:2});
    decodeEntryRecordTables(facts,tables);expect(facts).toEqual(original);
  });
  it('does not expand small arrays, empty arrays, mixed arrays or absent targets',()=>{
    const facts:EntryRecordObject={EXECUTION_ENVELOPE:{LONG:{planCandidates:[{id:1}]},SHORT:{planCandidates:[]},reachability:{horizons:[{id:1},null]}}};
    const original=clone(facts);expect(encodeEntryRecordTables(facts)).toEqual([]);expect(facts).toEqual(original);
    expect(encodeEntryRecordTables({})).toEqual([]);
  });
  it('does not encode sparse or non-JSON input arrays',()=>{
    const facts=fixture(),cards=(facts.EXECUTION_ENVELOPE as any).LONG.planCandidates;delete cards[2];
    const tables=encodeEntryRecordTables(facts);expect(tables.some(t=>t.path[1]==='LONG')).toBe(false);expect(Object.hasOwn(cards,2)).toBe(false);
    cards[2]=card(2);cards[0].bad=Infinity;expect(encodeEntryRecordTables(facts).some(t=>t.path[1]==='LONG')).toBe(false);
  });
  it('ignores similarly named arrays outside explicitly allowed targets',()=>{
    const facts:EntryRecordObject={planCandidates:Array.from({length:9},(_,i)=>card(i)),OTHER:{horizons:[card(0),card(1)]}};
    expect(encodeEntryRecordTables(facts)).toEqual([]);
  });
  it('prevents prototype mutation while retaining literal special JSON keys',()=>{
    const facts=fixture(),cards=(facts.EXECUTION_ENVELOPE as any).LONG.planCandidates;
    cards.forEach((c:any)=>Object.defineProperty(c,'__proto__',{value:{polluted:'literal'},enumerable:true,writable:true}));
    const original=clone(facts),tables=encodeEntryRecordTables(facts);decodeEntryRecordTables(facts,tables);
    expect(facts).toEqual(original);expect(({} as any).polluted).toBeUndefined();
  });

  const rejects=(change:(tables:EntryRecordTable[],facts:EntryRecordObject)=>void,code:string)=>{
    const {facts,tables}=encoded();change(tables,facts);const before=clone(facts);
    expect(()=>decodeEntryRecordTables(facts,tables)).toThrow(code);expect(facts).toEqual(before);
  };
  it('rejects duplicate targets and preserves all placeholders on error',()=>rejects(t=>t.push(clone(t[0])),'TARGET_INVALID'));
  it('rejects foreign target paths',()=>rejects(t=>{t[0].path=['OTHER','LONG','planCandidates'];},'TABLE_INVALID'));
  it('refuses to overwrite an existing nonempty array',()=>rejects((_t,f)=>{(f.EXECUTION_ENVELOPE as any).LONG.planCandidates=[card(99)];},'TARGET_INVALID'));
  it('rejects duplicate, out-of-range and fractional source indexes',()=>{
    rejects(t=>{t[0].groups[0].rows[1][0]=0;},'INDEX_INVALID');
    rejects(t=>{t[0].groups[0].rows[1][0]=t[0].length;},'INDEX_INVALID');
    rejects(t=>{t[0].groups[0].rows[1][0]=0.5;},'INDEX_INVALID');
  });
  it('rejects missing source indexes and unsafe lengths',()=>{
    rejects(t=>{t[0].groups[0].rows.pop();},'INDEX_GAP');
    rejects(t=>{t[0].length=Number.MAX_SAFE_INTEGER+1;},'TABLE_INVALID');
  });
  it('rejects row-length mismatch, sparse rows and non-JSON cells',()=>{
    rejects(t=>{t[0].groups[0].rows[0].pop();},'ROW_INVALID');
    rejects(t=>{delete t[0].groups[0].rows[0][1];},'ROW_INVALID');
    rejects(t=>{t[0].groups[0].rows[0][1]=NaN;},'ROW_INVALID');
  });
  it('rejects duplicate and nested conflicting columns or a common/column overlap',()=>{
    rejects(t=>{t[0].groups[0].columns.push(t[0].groups[0].columns[0]);},'COLUMN_CONFLICT');
    rejects(t=>{t[0].groups[0].columns.push(['acceptableTargetRange','min']);},'COLUMN_CONFLICT');
    rejects(t=>{t[0].groups[0].columns.push(['candidateId','suffix']);},'COLUMN_CONFLICT');
  });
  it('rejects empty column paths and sparse table/group/column arrays',()=>{
    rejects(t=>{t[0].groups[0].columns[0]=[];},'COLUMN_INVALID');
    rejects(t=>{delete t[0].groups[0].columns[0];},'GROUP_INVALID');
    rejects(t=>{delete t[1];},'TABLES_INVALID');
    rejects(t=>{delete t[0].groups[0];},'TABLE_INVALID');
  });
  it('never partially restores valid early targets when a later target is malformed',()=>rejects(t=>{t[2].groups[0].rows[0][0]=-1;},'INDEX_INVALID'));
});
