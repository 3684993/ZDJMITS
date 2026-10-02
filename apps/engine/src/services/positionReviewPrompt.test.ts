import {describe,expect,it} from 'vitest';
import {buildPositionReviewPrompt} from './positionReviewPrompt.js';

describe('position review fact contract',()=>{
  it('uses cited market and existing-plan facts without requiring entry sizing authority',()=>{
    const packet:any={packetId:'packet-review',symbol:'BTCUSDT',market:{
      quote:{ts:100,bid:99,ask:101,last:100,mark:100},
      technical:{'15m':{asOf:90,barCloseTime:90,isClosed:true,source:'BINANCE_KLINE',trend:'UP',ema21:98}},
      orderBook:{ts:100,bids:[[99,1]],asks:[[101,1]]},
    },referenceMarkets:{btc:{symbol:'BTCUSDT',quote:{ts:100,mark:100},technical:{'15m':{asOf:90,trend:'UP'}}}}};
    const request:any={planRef:'plan-1',planVersion:2,plan:{side:'LONG',entryReferencePrice:95,targetPrice:105,
      targetHorizonMinutes:60,thesis:'existing thesis',invalidationPredicate:'fact condition',predicateEvidenceRefs:['symbol.15m.confirmed'],
      minNetProfitUsd:1,maxRealizedLossUsd:3,economicMandate:null}};
    const prompt=buildPositionReviewPrompt(packet,request);
    expect(prompt).toContain('symbol.15m.confirmed');
    expect(prompt).toContain('plan.current');
    expect(prompt).toContain('existing thesis');
    expect(prompt).not.toContain('PRE_AI_EXECUTION_ENVELOPE_MISSING');
    expect(prompt).not.toContain('EXECUTION_ENVELOPE');
    expect(prompt).not.toContain('maxQuantityUnits');
  });
});
