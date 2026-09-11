import { describe, expect, it } from 'vitest';
import { evaluateObservation } from './shadowObservation.js';
const now=1_000_000;
const account:any={status:'READY',asOf:now};
const snapshot:any={quote:{bid:99,ask:101,mark:100,last:100,ts:now},orderBook:{bids:[[99,1],[98,1]],asks:[[101,1],[102,1]],ts:now},technical:{'1m':{lastPrice:100,sampleSize:10,asOf:now}},derivatives:{openInterest:null,fundingRate:null,ts:now}};
describe('V3.5.4 observation validity',()=>{
 it('accepts valid required domains even when derivatives are unavailable',()=>{const v=evaluateObservation(snapshot,account,now);expect(v.status).toBe('VALID');expect(v.optionalMissing).toContain('DERIVATIVES');});
 it('fails closed on missing or invalid quote',()=>{const v=evaluateObservation({...snapshot,quote:{...snapshot.quote,bid:102}},account,now);expect(v.status).toBe('INVALID');expect(v.invalidReasons).toContain('QUOTE_INVALID');});
 it('fails closed on stale account cadence',()=>{const v=evaluateObservation(snapshot,{...account,asOf:now-46_000},now);expect(v.status).toBe('INVALID');expect(v.invalidReasons).toContain('ACCOUNT_STALE');});
 it('keeps suspicious price divergence visible without invalidating the observation',()=>{const v=evaluateObservation({...snapshot,quote:{...snapshot.quote,last:104}},account,now);expect(v.status).toBe('VALID');expect(v.suspicious).toBe(true);});
});
