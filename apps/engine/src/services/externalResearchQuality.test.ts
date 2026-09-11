import {describe,expect,it} from 'vitest';
import {verifyExternalResearch} from './externalResearchQuality.js';
import type {ExternalIntelligenceSnapshot} from './externalIntelligenceService.js';

const snapshot=(index:number):ExternalIntelligenceSnapshot=>{
  const at=1_800_000_000_000+index*60_000,alpaca=index%2===0,facts=alpaca?{open:100+index,close:101+index,return15m:.01,feed:'us'}:{title:`Federal Reserve item ${index}`,summary:`Official release ${index}: target range unchanged.`};
  return{id:`ext_${index}`,provider:alpaca?'ALPACA':'FEDERAL_RESERVE',instrument:alpaca?'BTC/USD':'USD_MACRO',venue:alpaca?'ALPACA_CRYPTO_SPOT':'FEDERAL_RESERVE_OFFICIAL_RSS',sourceId:`source-${index}`,url:`https://example.invalid/${index}`,eventAt:at,publishedAt:at,receivedAt:at+1000,availableAt:at+1000,expiresAt:at+60_000,closedBar:alpaca?true:null,facts,quality:alpaca?'AUTHENTICATED_MARKET_DATA':'OFFICIAL',revision:`r${index}`,contentHash:`h${index}`};
};

describe('external research fact quality gate',()=>{
  it('passes a fixed 20-event numeric, unit and timestamp comparison set with zero errors',()=>{
    const checks=Array.from({length:20},(_,index)=>{const source=snapshot(index),field=index%2===0?'close':'title',value=source.facts[field]!,unit=index%2===0?'USD':null;return verifyExternalResearch(source,{sourceId:source.sourceId,entities:[source.instrument],facts:[{field,value,unit,observedAt:source.eventAt,evidenceLocation:`facts.${field}`,conflict:null}],conflicts:[]});});
    expect(checks).toHaveLength(20);expect(checks.every(x=>x.passed)).toBe(true);expect(checks.reduce((n,x)=>n+x.issues.length,0)).toBe(0);expect(checks.reduce((n,x)=>n+x.rejectedFactCount,0)).toBe(0);
  });
  it('drops unsupported numbers, units, times and trading instructions instead of forwarding them',()=>{
    const source=snapshot(0),result=verifyExternalResearch(source,{sourceId:source.sourceId,entities:[],facts:[{field:'close',value:999,unit:'BTC',observedAt:1,evidenceLocation:'summary',conflict:'PLACE_LONG with leverage'}],conflicts:[]});
    expect(result.result.facts).toEqual([]);expect(result.rejectedFactCount).toBe(1);expect(new Set(result.issues.map(x=>x.code))).toEqual(new Set(['VALUE','UNIT','TIME','EVIDENCE','PERMISSION']));
  });
});
