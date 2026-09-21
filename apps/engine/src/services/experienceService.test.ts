import {describe,expect,it} from 'vitest';
import {ExperienceService} from './experienceService.js';

describe('S01-T05 experience denominator',()=>{
  it('excludes closed complete records whose canonical net PnL is unknown',()=>{
    const state:any={tradeRecords:new Map([
      ['known',{status:'CLOSED',recordCompleteness:'COMPLETE',symbol:'BTCUSDT',regime:'R1',netPnl:2,fundingAttributionStatus:'EXACT',openedAt:2_000,createdAt:1_000}],
      ['unknown',{status:'CLOSED',recordCompleteness:'COMPLETE',symbol:'BTCUSDT',regime:'R1',netPnl:null,fundingAttributionStatus:'UNKNOWN',openedAt:2_000,createdAt:1_000}],
    ])};
    const result=new ExperienceService(state).summarize('BTCUSDT','R1');
    expect(result).toMatchObject({sampleSize:1,sameSymbolWinRate:1,coverage:{eligible:1,closedComplete:2,excludedNetUnknown:1,excludedOther:0}});
  });
});
