import {expect,it} from 'vitest';
import {minimumQuantityForTarget, leverageChoices} from './v397FrozenSizing.js';
import {buildQuantityHorizonCandidates} from './quantityHorizonCandidates.js';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};

const takeProfit={entryFeeRate:.0004,takerFeeRate:.0004,makerFeeRate:.0002,exitFeeAssumption:'TAKER',slippageBufferPct:.05,feeSafetyBufferPct:.02,minNetProfitUsd:1,minNetProfitRoiPct:.1};

it('enumerates each exchange supported integer leverage from 10 through 20',()=>{
  expect(leverageChoices(20,20)).toEqual([10,11,12,13,14,15,16,17,18,19,20]);
  expect(leverageChoices(20,15)).toEqual([10,11,12,13,14,15]);
  expect(leverageChoices(20,9)).toEqual([]);
});

it('solves quantity upward from a 100 quote margin floor for USDT and USDC',()=>{
  for(const quoteAsset of ['USDT','USDC'] as const){
    for(const leverage of [10,20]){
      const solved=minimumQuantityForTarget({quoteAsset,side:'LONG',entryPrice:100,targetPrice:101,stepSize:.01,minQty:.01,
        exchangeMinimumNotional:5,businessMinimumNotional:0,minimumInitialMarginQuote:100,availableMarginQuote:1000,
        leverage,takeProfit});
      expect(solved?.initialMarginQuote).toBeGreaterThanOrEqual(100);
      expect(solved?.notionalQuote).toBeGreaterThanOrEqual(100*leverage);
      expect(solved?.quantityUnits).toBeGreaterThanOrEqual(100*leverage/(100*.01));
    }
  }
});

it('refuses 99.99 available margin before Primary and never falls back to a small order',()=>{
  expect(minimumQuantityForTarget({quoteAsset:'USDT',side:'LONG',entryPrice:100,targetPrice:101,stepSize:.01,minQty:.01,
    exchangeMinimumNotional:5,businessMinimumNotional:0,minimumInitialMarginQuote:100,availableMarginQuote:99.99,
    leverage:10,takeProfit})).toBeNull();
});

it('raises quantity when target economics need more notional than the margin floor',()=>{
  const solved=minimumQuantityForTarget({quoteAsset:'USDT',side:'LONG',entryPrice:100,targetPrice:100.2,stepSize:.01,minQty:.01,
    exchangeMinimumNotional:5,businessMinimumNotional:150,minimumInitialMarginQuote:100,availableMarginQuote:5000,
    leverage:10,takeProfit});
  expect(solved?.notionalQuote).toBeGreaterThan(1000);
  expect(solved?.expectedNetProfitQuote).toBeGreaterThanOrEqual(solved?.requiredNetProfitQuote??Infinity);
});

it('keeps BTCUSDT business 150 separate from exchange and rejects a lower saved Settings value',()=>{
  const settings=SystemSettingsSchema.parse(defaults);
  expect(settings.entry.minimumOrderNotionalBySymbol.BTCUSDT).toBe(150);
  expect(settings.entry.minimumOrderNotionalByQuote.USDT).toBe(200);
  expect(SystemSettingsSchema.safeParse({...settings,entry:{...settings.entry,minimumOrderNotionalBySymbol:{BTCUSDT:149.99}}}).success).toBe(false);
  expect(SystemSettingsSchema.safeParse({...settings,entry:{...settings.entry,minimumOrderNotionalBySymbol:{}}}).success).toBe(false);
});

it('never offers a candidate whose frozen lowest executable price breaks the 100 margin floor',()=>{
  const settings=SystemSettingsSchema.parse(defaults);
  const now=Date.now();
  const candles=Array.from({length:300},(_,index)=>({high:104,low:96,close:100,
    closeTime:now-(299-index)*900000}));
  const set=buildQuantityHorizonCandidates({symbol:'BTCUSDT',side:'LONG',now,
    quote:{bid:50,ask:100,tickSize:.1,stepSize:.01,minQty:.01,minNotional:50,minEntryPrice:50,maxEntryPrice:100},
    leverage:10,envelope:{executable:true,minQuantityUnits:1,maxQuantityUnits:10000,maxNotionalUsd:100000,maxMarginUsd:10000,
      minimumInitialMarginQuote:100,minimumOrderNotionalQuote:150},envelopeExpiresAt:Date.now()+120000,
    factVersion:'worst-price-floor',risk:null,
    settings:{...settings,tradeEconomics:{...settings.tradeEconomics,admissionMode:'SHADOW'}},
    candles:()=>candles,managementDurationMs:86400000} as never);
  expect(set.candidates.length).toBeGreaterThan(0);
  for(const row of set.candidates){
    expect(row.quantityUnits*.01*50/row.leverage).toBeGreaterThanOrEqual(100);
    expect(row.quantityUnits*.01*50).toBeGreaterThanOrEqual(150);
  }
});
