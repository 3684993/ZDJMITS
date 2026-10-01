import {describe,expect,it} from 'vitest';
import {EntryEconomicMandateSchema} from './entryEconomicMandate.js';

const valid=()=>({schemaVersion:'V397-ENTRY-ECONOMIC-MANDATE-1',mandateId:'mandate-test-1234',environment:'TESTNET',quoteAsset:'USDT',settingsVersion:219,
  factsHash:'a'.repeat(64),createdAt:100,expiresAt:200,side:'LONG',directionFacts:(['1d','4h','15m'] as const).map((timeframe,i)=>({timeframe,closedAt:90-i,direction:'UP',status:'FRESH',evidenceHash:String(i).repeat(64)})),
  sizing:{minimumInitialMarginQuote:25,minimumOrderNotionalQuote:5,exchangeMinimumNotionalQuote:5,selectedInitialMarginQuote:25,selectedNotionalQuote:500,quantityUnits:50,quantity:50,leverage:20,entryPrice:10,stepSize:1,priceTick:.01},
  economics:{entryFeeQuote:.1,expectedExitFeeQuote:.1,slippageBufferQuote:.1,fundingQuote:null,fundingStatus:'UNPROVEN',fxToUsd:null,fxStatus:'UNPROVEN',minimumNetProfitQuote:1,targetPrice:10.2,targetHorizonMinutes:60,
    targetConditionalNetQuote:1.2,expectedNetQuote:null,oneHourReachability:null,oneHourReachabilityStatus:'INSUFFICIENT_SAMPLE',costVersion:'cost-v1'},rationale:'fixture'});

describe('EntryEconomicMandate',()=>{
  it('round-trips separated margin, business notional, exchange minimum and unknown cost evidence',()=>{
    const parsed=EntryEconomicMandateSchema.parse(valid());expect(EntryEconomicMandateSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(parsed.sizing).toMatchObject({minimumInitialMarginQuote:25,minimumOrderNotionalQuote:5,exchangeMinimumNotionalQuote:5,selectedInitialMarginQuote:25,selectedNotionalQuote:500});
    expect(parsed.economics).toMatchObject({fundingQuote:null,fundingStatus:'UNPROVEN',fxToUsd:null,fxStatus:'UNPROVEN',expectedNetQuote:null,oneHourReachability:null});
  });
  it('rejects a quantity, margin, notional or stale direction fact that diverges from the mandate',()=>{
    for(const change of [
      (x:any)=>{x.sizing.quantity=49;},
      (x:any)=>{x.sizing.selectedInitialMarginQuote=20;},
      (x:any)=>{x.sizing.selectedNotionalQuote=4;},
      (x:any)=>{x.directionFacts[0].status='STALE';},
    ]){const input=valid();change(input);expect(EntryEconomicMandateSchema.safeParse(input).success).toBe(false);}
  });
});
