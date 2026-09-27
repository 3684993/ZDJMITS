import {describe,expect,it} from 'vitest';
import {NO_RISK_ABSENCE_SOURCES,validateNoActiveRiskProof,hasVerifiedNoActiveRisk,entryOrderOccupiesRisk,durableEntryClaimActive,entryClaimReleasedByExchangeFacts,historicalNoRiskEligible,remoteRiskAuditDeferred} from './entryRiskOccupancy.js';
const now=1_790_000_000_000;
const row=(over:Record<string,unknown>={})=>({id:'o',symbol:'BTCUSDT',clientOrderId:'ml_o',exchangeOrderId:null,side:'LONG',filledQuantity:0,status:'UNKNOWN',activeRiskExposure:false,
 activeRiskEvidence:{status:'VERIFIED_NO_ACTIVE_RISK',proofTier:0,checkedAt:now-1000,validUntil:now+1000,identityTombstone:'ENTRY:BTCUSDT:ml_o',sources:[...NO_RISK_ABSENCE_SOURCES,'BINANCE_LONG_SHORT_POSITION_ZERO'],...over}} as any);
const bad:Array<[string,Record<string,unknown>]>=[
 ['expired',{validUntil:now}],['identity',{identityTombstone:'ENTRY:BTCUSDT:other'}],['checked-null',{checkedAt:null}],['checked-missing',{checkedAt:undefined}],
 ['checked-string',{checkedAt:String(now-1000)}],['checked-empty',{checkedAt:''}],['checked-NaN',{checkedAt:NaN}],['checked-Infinity',{checkedAt:Infinity}],
 ['checked-negative',{checkedAt:-1}],['checked-zero',{checkedAt:0}],['until-null',{validUntil:null}],['until-missing',{validUntil:undefined}],
 ['until-string',{validUntil:String(now+1000)}],['until-NaN',{validUntil:NaN}],['until-Infinity',{validUntil:Infinity}],['until-negative',{validUntil:-1}],['until-zero',{validUntil:0}],
 ['inverted',{validUntil:now-2000}],['equal',{validUntil:now-1000}],['future',{checkedAt:now+1}],['sources-empty',{sources:[]}],['sources-missing',{sources:undefined}],
 ['partial',{sources:[...NO_RISK_ABSENCE_SOURCES]}],['duplicate',{sources:[...NO_RISK_ABSENCE_SOURCES,NO_RISK_ABSENCE_SOURCES[0]]}],
 ['unsupported',{sources:[...NO_RISK_ABSENCE_SOURCES,'SYNTHETIC_ZERO']}],['both-position-classes',{sources:[...NO_RISK_ABSENCE_SOURCES,'BINANCE_LONG_SHORT_POSITION_ZERO','POSITION_PRESENT_PROVEN_OTHER_CYCLE']}],
 ['wrong-class',{proofClass:'POSITION_OTHER_CYCLE'}],['unsupported-class',{proofClass:'UNKNOWN'}],['over-tier-ttl',{validUntil:now+300_000}],['oversized-max-ttl',{proofTier:2,validUntil:now+1800_000}],
 ['tier-null',{proofTier:null}],['tier-string',{proofTier:'2'}],['tier-negative',{proofTier:-1}],['tier-unsupported',{proofTier:3}],['wrong-status',{status:'CONFLICT'}],
];
describe('canonical strict UNKNOWN release proof',()=>{
 it.each(bad)('rejects %s consistently through all release consumers',(_name,over)=>{
  const order=row(over),original=structuredClone(order);expect(validateNoActiveRiskProof(order,now).valid).toBe(false);
  expect(hasVerifiedNoActiveRisk(order,now)).toBe(false);expect(entryOrderOccupiesRisk(order,now)).toBe(true);
  expect(durableEntryClaimActive(order,now)).toBe(true);expect(entryClaimReleasedByExchangeFacts(order,now)).toBe(false);
  expect(historicalNoRiskEligible(order,now)).toBe(false);expect(remoteRiskAuditDeferred({...order,remoteAudit:{tier:2,nextAuditAt:now+1000}},now)).toBe(false);
  expect(order).toEqual(original);
 });
 it.each(['POSITION_ABSENT','POSITION_OTHER_CYCLE'])('accepts producer class %s and preserves history',proofClass=>{
  const order=row({proofClass,sources:[...NO_RISK_ABSENCE_SOURCES,proofClass==='POSITION_ABSENT'?'BINANCE_LONG_SHORT_POSITION_ZERO':'POSITION_PRESENT_PROVEN_OTHER_CYCLE']});
  expect(validateNoActiveRiskProof(order,now)).toMatchObject({valid:true,proofClass});expect(entryOrderOccupiesRisk(order,now)).toBe(false);
  expect(durableEntryClaimActive(order,now)).toBe(false);expect(historicalNoRiskEligible(order,now)).toBe(true);expect(order.status).toBe('UNKNOWN');
 });
 it.each([0,1,2])('accepts exact supported tier %i TTL and rejects one extra millisecond',tier=>{
  const ttl=[300000,900000,1800000][tier],order=row({checkedAt:now,validUntil:now+ttl,proofTier:tier});
  expect(hasVerifiedNoActiveRisk(order,now)).toBe(true);order.activeRiskEvidence.validUntil++;expect(hasVerifiedNoActiveRisk(order,now)).toBe(false);
 });
 it('supports legacy producer tiers without weakening timestamps or sources',()=>{
  const order=row({checkedAt:now,validUntil:now+1800000,proofTier:undefined});order.remoteAudit={tier:2};expect(hasVerifiedNoActiveRisk(order,now)).toBe(true);
  order.remoteAudit.tier='2';expect(hasVerifiedNoActiveRisk(order,now)).toBe(false);
 });
 it('cannot gain release from Number(null) or string numeric conversion',()=>{
  expect(Number(null)).toBe(0);expect(Number(String(now))).toBe(now);
  for(const checkedAt of [null,String(now)])expect(hasVerifiedNoActiveRisk(row({checkedAt}),now)).toBe(false);
 });
 it.each(['CANCELED','EXPIRED','REJECTED','FILLED'])('retains terminal %s plus UNKNOWN occupancy and claim until valid proof',status=>{
  const order={...row({checkedAt:null}),status,exchangeTerminalStatus:'UNKNOWN'};
  expect(entryOrderOccupiesRisk(order,now)).toBe(true);expect(durableEntryClaimActive(order,now)).toBe(true);
  order.activeRiskEvidence=row().activeRiskEvidence;expect(entryOrderOccupiesRisk(order,now)).toBe(false);expect(durableEntryClaimActive(order,now)).toBe(false);
 });
 it('rejects malformed objects, fill conflicts and missing external identity',()=>{
  for(const activeRiskEvidence of [null,[],false,'VERIFIED_NO_ACTIVE_RISK'])expect(hasVerifiedNoActiveRisk({...row(),activeRiskEvidence},now)).toBe(false);
  for(const filledQuantity of [undefined,null,'0',NaN,1])expect(hasVerifiedNoActiveRisk({...row(),filledQuantity},now)).toBe(false);
  expect(hasVerifiedNoActiveRisk({...row(),clientOrderId:null,exchangeOrderId:null},now)).toBe(false);
  expect(hasVerifiedNoActiveRisk({...row(),activeRiskExposure:true},now)).toBe(false);
 });
});
