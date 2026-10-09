import {expect,it} from 'vitest';
import {EffectivePrimaryCadence,primaryFailureClass} from './effectivePrimaryCadence.js';
it('counts useful decisions independently of orders and excludes schema/model failures',()=>{
  const c=new EffectivePrimaryCadence(),now=1800000000000;
  c.evaluate(1,now);c.outcome('A','WAIT_FOR_PRICE',true,now+1000);c.outcome('B','SCHEMA_INVALID',false,now+2000);c.outcome('C','PLACE_LONG',true,now+241000);
  c.evaluate(1,now+242000);const p=c.projection(now+242000);expect(p.effective).toBe(2);expect(p.failedOrInvalid).toBe(1);expect(p.p90CompletionIntervalMs).toBe(240000);expect(p.sloAcceptance).toContain('UNKNOWN');
});
it('signals only continuously observed preflight gaps and resets on no opportunity or missing ticks',()=>{
  const c=new EffectivePrimaryCadence(),now=1800000000000;for(let t=0;t<=600000;t+=30000)c.evaluate(1,now+t);
  expect(c.projection(now+600001).status).toBe('PREFLIGHT_GAP_10M');c.evaluate(0,now+600002);expect(c.projection(now+600002).status).toBe('NO_PREFLIGHT_CANDIDATE');c.evaluate(1,now+700000);expect(c.projection(now+700000).preflightOpportunityAgeMs).toBe(0);expect(c.projection(now+760001).status).toBe('UNKNOWN_TICK_COVERAGE');
});
it.each([['acceptablePriceRange: min <= idealPrice <= max required','SCHEMA_INVALID'],['PROMPT_BUDGET_UNAVAILABLE','PROMPT_BUDGET_UNAVAILABLE'],['MARKET_DATA_STALE: MISSING_LATEST_CLOSED','MARKET_STALE'],['request timeout','MODEL_TIMEOUT'],['AI_PRIMARY_CIRCUIT_OPEN','AI_BUSY']])('classifies %s separately', (reason,want)=>expect(primaryFailureClass(reason)).toBe(want));
