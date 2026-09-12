import {describe,it,expect} from 'vitest';
import {waitFingerprint,waitTrigger} from './entryWaiting.js';
const market=(overrides:any={})=>({quote:{ts:1_000_000,bid:100,ask:101},technical:{'1m':{trend:'UP'},'5m':{trend:'UP'},'15m':{trend:'UP',barCloseTime:899_999,asOf:899_999,emaSlope21:1,macdHistogram:1}},...overrides}) as any;
describe('WAIT event gate',()=>{
 it('does not wake Primary for 1m/5m noise',()=>{const first=market(),w:any={direction:'LONG',condition:{operator:'LTE',price:90},expiresAt:2_000_000,fingerprint:waitFingerprint(first)};const next=market();next.technical['1m'].trend='DOWN';next.technical['5m'].trend='DOWN';expect(waitTrigger(w,next,1_000_100)).toBeNull();});
 it('wakes on explicit price trigger',()=>{const first=market(),w:any={direction:'LONG',condition:{operator:'LTE',price:100},expiresAt:2_000_000,fingerprint:waitFingerprint(first)};expect(waitTrigger(w,first,1_000_100)).toBe('PRICE_TRIGGERED');});
 it('wakes on a new closed 15m bar without changing the lifecycle reason contract',()=>{const first=market(),w:any={direction:'LONG',condition:{operator:'LTE',price:90},expiresAt:2_000_000,fingerprint:waitFingerprint(first)},next=market();next.technical['15m'].barCloseTime=1_799_999;next.technical['15m'].asOf=1_799_999;expect(waitTrigger(w,next,1_000_100)).toBe('MATERIAL_STATE_CHANGE');});
});

it('does not re-run Primary on WAIT expiry but permits a subsequent material bar change',()=>{
 const first=market(),w:any={direction:'LONG',condition:{operator:'LTE',price:1000},expiresAt:1_000_000,fingerprint:waitFingerprint(first)};
 expect(waitTrigger(w,first,1_000_100)).toBeNull();const next=market();next.technical['15m'].barCloseTime=1_799_999;expect(waitTrigger(w,next,1_000_100)).toBe('MATERIAL_STATE_CHANGE');
});
