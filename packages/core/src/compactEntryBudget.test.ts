import {expect,it} from 'vitest';
import {encodeCandidateMenu,decodeCandidateMenu} from './compactEntry.js';
it('preserves both full 33-row menus, every authorization, price, TP, proof and UNKNOWN',()=>{
  for(const side of ['LONG','SHORT']){
    const candidates=Array.from({length:33},(_,i)=>({candidateId:`${side}-${i}`,side,quantityUnits:i+1,entryReferencePrice:2,targetPrice:side==='LONG'?3:1,acceptableTargetRange:{min:1,max:3},targetHorizonMinutes:i%3+1,sizingProof:{capitalAsOf:123,requiredMargin:100,riskBoundary:'UNKNOWN',source:'CURRENT_SETTINGS'},fundingStatus:'UNKNOWN',costVersion:'v1'}));
    const snapshot=JSON.stringify(candidates),menu=encodeCandidateMenu(candidates);
    expect(decodeCandidateMenu(menu)).toEqual(candidates);expect(menu.rows).toHaveLength(33);expect(JSON.stringify(candidates)).toBe(snapshot);expect(JSON.stringify(menu).length).toBeLessThan(snapshot.length);
  }
});
it('retains absent versus null, false and zero exactly',()=>{const rows=[{id:'a',v:null,n:0,flag:false},{id:'b',n:1}];expect(decodeCandidateMenu(encodeCandidateMenu(rows))).toEqual(rows);expect(decodeCandidateMenu(encodeCandidateMenu([]))).toEqual([]);});
