import {describe,expect,it} from 'vitest';
import {compactTableValues,expandTableValues,compactFactContexts,expandFactContexts} from './entryTableDedup.js';

const now=1790858321536;
const table=()=>({common:{side:'LONG'},columns:['candidateId','targetPrice','targetHorizonMinutes','marginUsd','asOf','barCloseTime'],
  rows:Array.from({length:9},(_,i)=>[i,`candidate-exact-id-${i}`,100.123456789012+(i%3),15+(i%3),25+i,now+(i%3),now+(i%3)])});
const factsOf=(t:ReturnType<typeof table>)=>t.rows.map(row=>Object.fromEntries([...Object.entries(t.common),...t.columns.map((column,i)=>[column,row[i+1]])]));

describe('exact candidate metadata factoring',()=>{
  it('restores every candidate ID, quantity-related value, target/horizon and original clock without sharing mutations',()=>{
    const original=table(),before=structuredClone(original),encoded=compactTableValues(original,1);
    expect(encoded.copies).toEqual([['barCloseTime','asOf']]);
    expect(encoded.profiles?.rows).toHaveLength(3);
    expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(original).length);
    const expanded=expandTableValues(encoded,1);
    expect(factsOf(expanded)).toEqual(factsOf(original));
    expanded.rows[0][1]='changed';expect(original).toEqual(before);
    expect(factsOf(expandTableValues(encoded,1))).toEqual(factsOf(original));
  });

  it('keeps even a one-millisecond timestamp conflict explicit',()=>{
    const original=table();original.rows[8][6]=now+999;
    const encoded=compactTableValues(original,1);
    expect(encoded.copies).toBeUndefined();
    expect(factsOf(expandTableValues(encoded,1))).toEqual(factsOf(original));
  });

  it('keeps null, zero, false, empty string and empty containers distinct in profiles',()=>{
    const values=[null,0,false,'',{},[]];
    const original={common:{},columns:['candidateId','targetPrice','targetHorizonMinutes'],rows:Array.from({length:18},(_,i)=>[i,`candidate-${i}`,values[i%6],180])};
    const expanded=expandTableValues(compactTableValues(original,1),1);
    const restore=(t:any)=>t.rows.map((row:any[])=>Object.fromEntries(t.columns.map((column:string,i:number)=>[column,row[i+1]])));
    expect(restore(expanded)).toEqual(restore(original));
  });

  it.each(['missingSource','duplicateTarget','chained','rowLength','profileIndex','profileLength'])('rejects malformed %s without modifying the encoded source',kind=>{
    const encoded:any=compactTableValues(table(),1);
    if(kind==='missingSource')encoded.copies[0][1]='missing';
    if(kind==='duplicateTarget')encoded.copies.push(encoded.copies[0]);
    if(kind==='chained')encoded.copies.push(['clock','barCloseTime']);
    if(kind==='rowLength')encoded.rows[0].pop();
    if(kind==='profileIndex')encoded.profiles.forRows[0]=encoded.profiles.rows.length;
    if(kind==='profileLength')encoded.profiles.forRows.pop();
    const before=structuredClone(encoded);
    expect(()=>expandTableValues(encoded,1)).toThrow();expect(encoded).toEqual(before);
  });
});

describe('identical fact context copies',()=>{
  const context=()=>({records:Array.from({length:8},(_,i)=>({price:.123456789123+i,lastSeenAt:now+i})),empty:[],unknown:null});
  it('copies only exact duplicate contexts and preserves omitted/null and conflicting fields',()=>{
    const first=context(),facts:any={first,second:structuredClone(first),different:{...structuredClone(first),observedAt:now},missing:null};
    const before=structuredClone(facts),copies=compactFactContexts(facts);
    expect(copies).toContainEqual([['second'],['first']]);
    expect(facts.second).toBeNull();
    expandFactContexts(facts,copies);expect(facts).toEqual(before);
    facts.second.records[0].lastSeenAt=0;expect(facts.first.records[0].lastSeenAt).toBe(now);
  });

  it('never creates a source containing another placeholder when duplicated contexts are nested',()=>{
    const shared=context(),nested={a:shared,b:structuredClone(shared)};
    const facts:any={first:structuredClone(nested),second:structuredClone(nested),third:{inner:structuredClone(nested)}};
    const before=structuredClone(facts),copies=compactFactContexts(facts);
    expandFactContexts(facts,copies);expect(facts).toEqual(before);
  });

  it.each(['missing','cycle','duplicate','overwrite'])('rejects invalid %s context targets atomically',kind=>{
    const facts:any={source:context(),target:null,third:null},copies:any=[[['target'],['source']]];
    if(kind==='missing')copies[0][1]=['absent'];
    if(kind==='cycle')copies.push([['third'],['target']]);
    if(kind==='duplicate')copies.push(copies[0]);
    if(kind==='overwrite')facts.target={existing:'must remain'};
    const before=structuredClone(facts);expect(()=>expandFactContexts(facts,copies)).toThrow();expect(facts).toEqual(before);
  });
});
