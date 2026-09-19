import { describe, expect, it } from 'vitest';
import type { Candle } from '@zdj/contracts';
import { evaluateTargetReachability, summarizeReachability } from './historicalTpReachability.js';

function candles(count=90,now=1_800_000):Candle[]{
  const start=now-count*60_000;
  return Array.from({length:count},(_,i)=>({
    openTime:start+i*60_000,closeTime:start+(i+1)*60_000-1,receivedAt:start+(i+1)*60_000,
    isClosed:true,source:'MOCK' as const,open:100,high:101,low:99,close:100,volume:1,quoteVolume:100,trades:1,
  }));
}
describe('historical TP reachability',()=>{
  it('uses only closed historical candles and returns empirical probability',()=>{
    const now=1_800_000,rows=candles(90,now);
    rows.push({...rows.at(-1)!,openTime:now,closeTime:now+59_999,isClosed:false,high:1000,low:.1});
    const result=evaluateTargetReachability({rows,side:'LONG',horizonMinutes:5,targetMovePercent:.5,lookbackBars:60,minSamples:30,now});
    expect(result.status).toBe('READY');
    expect(result.hardMaxMovePercent).toBeCloseTo(1,8);
    expect(result.reachProbability).toBe(1);
  });
  it('is symmetric for LONG and SHORT favorable excursions',()=>{
    const now=1_800_000,rows=candles(90,now);
    const long=summarizeReachability({rows,horizonMinutes:5,lookbackBars:60,minSamples:30,now});
    expect(long.LONG.hardMaxMovePercent).toBeCloseTo(1,8);
    expect(long.SHORT.hardMaxMovePercent).toBeCloseTo(1,8);
  });
  it('fails closed on stale history',()=>{
    const rows=candles(90,1_800_000);
    const result=summarizeReachability({rows,horizonMinutes:5,lookbackBars:60,minSamples:30,now:2_500_000});
    expect(result.status).toBe('STALE');
  });
});
