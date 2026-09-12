import type {MarketSymbolSnapshot,BrainDecision} from '@zdj/contracts';
/** WAIT re-entry fingerprint deliberately excludes 1m/5m noise. Price has its own explicit trigger. */
export function waitFingerprint(m:MarketSymbolSnapshot) {
  const t=m.technical['15m'];
  return JSON.stringify({trend15m:t.trend,bar15m:Number(t.barCloseTime??t.asOf),emaDirection:Math.sign(t.emaSlope21),macdDirection:Math.sign(t.macdHistogram)});
}
export function waitingContext(d:BrainDecision,runId:string,m:MarketSymbolSnapshot,now=Date.now()) {
  if(d.decision!=='WAIT_FOR_PRICE'||!d.waitCondition)throw new Error('AI_OUTPUT_INVALID: WAIT condition missing');
  return {runId,direction:d.direction,condition:d.waitCondition,reason:d.reason,createdAt:now,
    expiresAt:now+d.waitCondition.validForMinutes*60_000,fingerprint:waitFingerprint(m),orderAuthorization:false};
}
export function waitTrigger(w:ReturnType<typeof waitingContext>,m:MarketSymbolSnapshot,now=Date.now()):string|null {
  if(now>=w.expiresAt)return 'WAIT_EXPIRED';
  if(now-m.quote.ts>15_000)return null;
  const price=w.direction==='LONG'?m.quote.bid:m.quote.ask;
  if(w.condition.operator==='LTE'?price<=w.condition.price:price>=w.condition.price)return 'PRICE_TRIGGERED';
  if(waitFingerprint(m)!==w.fingerprint)return 'MATERIAL_15M_STATE_CHANGE';
  return null;
}
