import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineRuntime } from './appRuntime.js';
import { RuntimeState } from '../state/runtimeState.js';

const paths:string[]=[];
const card=(last:number)=>({timeframe:'15m',asOf:Date.now(),sampleSize:80,lastPrice:last,trend:'RANGE',trendStrength:.4,ema8:last,ema21:last,ema55:last,emaSlope21:0,macdLine:0,macdSignal:0,macdHistogram:0,macdHistogramSlope:0,macdCrossDirection:'NONE',macdCrossAgeBars:0,bbUpper:last*1.02,bbMiddle:last,bbLower:last*.98,bbPosition:.5,bbBandwidth:.04,atr14:last*.005,atrPercent:.5,volumeZScore:0,recentSwingHigh:last*1.01,recentSwingLow:last*.99,higherHighs:2,higherLows:2,lowerHighs:1,lowerLows:1,freshnessMs:0});
afterEach(async()=>Promise.all(paths.splice(0).map(dir=>rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50}))));

describe('Testnet risk-pause override',()=>{
  it('records a complete audit, preserves risk metrics, restores AUTO, and survives restart state',async()=>{
    const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-risk-'));paths.push(dataDir);
    const runtime=await EngineRuntime.createTestHarness({configDir:path.resolve(process.cwd(),'../..','config'),dataDir});
    try {
      const now=Date.now(),last=100;
      runtime.state.settings.connections.executionMode='TESTNET_ENABLED';
      runtime.state.settings.riskGovernance.entrySafetyMode='AUTO';
      runtime.state.runtimeControl.entrySafetyMode='AUTO';
      runtime.state.account={...runtime.state.account,status:'READY',asOf:Date.now(),equityUsd:10_000,assets:[{asset:'USDT',walletBalance:10_000,availableBalance:10_000,crossWalletBalance:10_000,unrealizedPnl:0,usdValue:10_000,marginEligible:true}],riskBaseline:{capitalEpochRealizedPnlUsd:-600,calendarDayRealizedPnlUsd:-600,riskDrawdownPct:.06,equityUsd:9_400}};
      runtime.state.snapshots.set('ETHUSDT',{symbol:'ETHUSDT',quote:{symbol:'ETHUSDT',last,mark:last,bid:last-.01,ask:last+.01,tickSize:.01,stepSize:.01,minQty:.01,minNotional:5,quoteVolumeUsd24h:100_000_000,priceChangePercent24h:0,tradeCount24h:10000,ts:now},orderBook:{symbol:'ETHUSDT',bids:[[99.99,100000]],asks:[[100.01,100000]],ts:now},derivatives:{symbol:'ETHUSDT',openInterest:1_000_000,openInterestChange5m:0,openInterestChange15m:0,fundingRate:0,takerBuySellRatio5m:1,globalLongShortRatio:1,topTraderPositionRatio:1,ts:now},technical:{'1m':card(last),'5m':card(last),'15m':card(last),'4h':card(last),'1d':card(last),'1w':card(last)},dataCompleteness:1} as any);
      runtime.state.universe=[{symbol:'ETHUSDT',rank:1,score:90,lifecycle:'SHORTLIST',eligible:true,exclusionReasons:[],components:{liquidity:90,tradingActivity:90,capitalActivity:80,technicalOpportunity:80,executionReachability:90,dataQuality:100},quoteVolumeUsd24h:100_000_000,spreadBps:2,lastPrice:last,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:now,underlyingAsset:'ETH',quoteAsset:'USDT',riskTier:'LIQUID_ALT',directionPolicy:'BOTH',locationScore:80} as any];
      runtime.state.settings.releasePolicy={lifecycleVersion:382};runtime.state.executionGovernance={...runtime.state.executionGovernance,mode:'AUTO_RUNNING'};
      runtime.runtimeControl.evaluate(true);
      expect(runtime.state.runtimeControl.mode).toBe('PAUSED_DAILY_RISK_LIMIT');
      const result=runtime.manualRiskPauseOverride('验收：人工复核后继续 Testnet AUTO');
      expect(result.status).toBe('AUTO_RUNNING');
      expect(runtime.runtimeControl.canDispatch()).toBe(true);
      expect(runtime.state.account.riskBaseline.riskDrawdownPct).toBe(.06);
      const event=(runtime.settingsStore.runtimeEvents(Date.now()-60_000,['MANUAL_RISK_PAUSE_OVERRIDE'],10) as any[])[0];
      expect(event.payload).toMatchObject({operatorAction:'MANUAL_RISK_PAUSE_OVERRIDE',riskMetrics:{riskDrawdownPct:.06},sessionScope:{riskCycleKey:expect.any(String)}});
      const restored=new RuntimeState(runtime.state.settings);restored.restore(runtime.state.serialize());
      expect(restored.runtimeControl.manualRiskOverride.status).toBe('MANUAL_RISK_OVERRIDE_ACTIVE');
    } finally { runtime.stop(); }
  });
});
