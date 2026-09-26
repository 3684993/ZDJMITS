import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {MarketSymbolSnapshotSchema,SystemSettingsSchema} from '@zdj/contracts';
import {materializeAiQuantityAllocation} from './aiQuantityAllocation.js';
import type {PreAiExecutionEnvelope} from './preAiExecutionEnvelope.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/v363-entry.json',import.meta.url),'utf8'))[0];
const snapshot=MarketSymbolSnapshotSchema.parse({...fixture.packet.market,symbol:fixture.packet.symbol,dataCompleteness:1});
const settings=SystemSettingsSchema.parse(JSON.parse(readFileSync(new URL('../../../../config/settings.default.json',import.meta.url),'utf8')));
const candidate:any={symbol:snapshot.symbol,underlyingAsset:snapshot.symbol.replace(/(USDT|USDC)$/,''),quoteAsset:'USDT',riskTier:'CORE',locationScore:70};
const state:any={settings,positions:new Map(),account:{assets:[{asset:'USDT',walletBalance:5000,availableBalance:5000,equityUsd:5000}]}};
const recentTradedPrices=(snapshot.recentTradedPrices??[]).flatMap(row=>Number.isFinite(row.price)&&Number.isFinite(row.lastSeenAt)?[{price:Number(row.price),lastSeenAt:Number(row.lastSeenAt)}]:[]);
const legalMinUnits=Math.max(1,Math.ceil(Math.max(snapshot.quote.minQty,snapshot.quote.minNotional/snapshot.quote.last)/snapshot.quote.stepSize));
const env=(maxUnits=1000,minUnits=legalMinUnits):PreAiExecutionEnvelope=>({version:'V3.9.3_PRE_AI_EXECUTION_ENVELOPE',symbol:snapshot.symbol,underlying:candidate.underlyingAsset,quoteAsset:'USDT',createdAt:1,expiresAt:9999999999999,notice:'EXECUTION FACTS ARE NOT MARKET SIGNALS.',account:{status:'READY',equityUsd:5000,availableMarginUsd:5000,reservedMarginUsd:0,executionLeaseMarginUsd:0,freeMarginUsd:5000},positionCapacity:{used:0,max:8,slotAvailable:true,sameUnderlyingOccupied:false},leverage:10,exchange:{tickSize:snapshot.quote.tickSize,stepSize:snapshot.quote.stepSize,minQty:snapshot.quote.minQty,minNotional:snapshot.quote.minNotional},makerReachableBand:{min:snapshot.quote.bid*.99,max:snapshot.quote.ask*1.01},recentTradedPrices,fees:{makerFeeBps:2,takerFeeBps:5,roundTripCostBps:7,safetyMarginBps:2},LONG:{executable:true,maxMarginUsd:5000,maxNotionalUsd:50000,maxQuantityUnits:maxUnits,minQuantityUnits:minUnits,legalQuantityRangeUnits:[minUnits,maxUnits],minimumLegalNotionalUsd:Math.max(snapshot.quote.minNotional,snapshot.quote.minQty*snapshot.quote.last),legalNotionalRangeUsd:[Math.max(snapshot.quote.minNotional,snapshot.quote.minQty*snapshot.quote.last),maxNotionalFor(maxUnits)],riskHeadroom:{factVersion:'l',remaining:{gross:50000},blockers:[],reason:'PASS'}},SHORT:{executable:true,maxMarginUsd:5000,maxNotionalUsd:50000,maxQuantityUnits:maxUnits,minQuantityUnits:minUnits,legalQuantityRangeUnits:[minUnits,maxUnits],minimumLegalNotionalUsd:Math.max(snapshot.quote.minNotional,snapshot.quote.minQty*snapshot.quote.last),legalNotionalRangeUsd:[Math.max(snapshot.quote.minNotional,snapshot.quote.minQty*snapshot.quote.last),maxNotionalFor(maxUnits)],riskHeadroom:{factVersion:'s',remaining:{gross:50000},blockers:[],reason:'PASS'}},executableSides:['LONG','SHORT'],noExecutableSide:false,sideAuthorization:{LONG:'EXECUTABLE',SHORT:'EXECUTABLE'},leaseRequiredMarginUsd:5000});
function maxNotionalFor(units:number){return units*snapshot.quote.stepSize*snapshot.quote.last;}

describe('V3.9.3 AI quantity materializer',()=>{
  it('materializes exact quantityUnits without confidence sizing',()=>{const price=snapshot.quote.ask,units=legalMinUnits+5;const a=materializeAiQuantityAllocation({state,candidate,snapshot,side:'LONG',quantityUnits:units,authorizationMaxPrice:price,envelope:env(units+100),confidence:.55} as any),b=materializeAiQuantityAllocation({state,candidate,snapshot,side:'LONG',quantityUnits:units,authorizationMaxPrice:price,envelope:env(units+100),confidence:.95} as any);expect(a.notionalUsd).toBeCloseTo(units*snapshot.quote.stepSize*price,10);expect(b.notionalUsd).toBeCloseTo(a.notionalUsd,10);expect(b.marginUsd).toBeCloseTo(a.marginUsd,10);expect(a.reasons).toContain('NO_CONFIDENCE_RESIZING');});
  it('fails closed above Envelope and never clamps units',()=>{expect(()=>materializeAiQuantityAllocation({state,candidate,snapshot,side:'SHORT',quantityUnits:101,authorizationMaxPrice:snapshot.quote.ask,envelope:env(100)})).toThrow('AI_QUANTITY_EXCEEDS_ENVELOPE');});
  it('fails closed when AI selects an objectively unavailable side',()=>{const e=env(100);e.SHORT.executable=false;e.SHORT.maxQuantityUnits=0;e.SHORT.maxNotionalUsd=0;e.SHORT.maxMarginUsd=0;expect(()=>materializeAiQuantityAllocation({state,candidate,snapshot,side:'SHORT',quantityUnits:1,authorizationMaxPrice:snapshot.quote.ask,envelope:e})).toThrow('AI_DIRECTION_NOT_EXECUTABLE');});

  // G2: the legal quantity interval is closed on both ends. Below the published floor nothing is submitted
  // and nothing is quietly rounded up; at the floor the exchange minimum is met by the model's own number.
  it('QB-01 refuses a quantity below the published floor without clamping it into range',()=>{
    const envelope=env(legalMinUnits+50);
    expect(envelope.LONG.minQuantityUnits).toBe(legalMinUnits);
    expect(envelope.LONG.legalQuantityRangeUnits).toEqual([legalMinUnits,legalMinUnits+50]);
    expect(()=>materializeAiQuantityAllocation({state,candidate,snapshot,side:'LONG',quantityUnits:legalMinUnits-1,authorizationMaxPrice:snapshot.quote.ask,envelope})).toThrow('AI_QUANTITY_BELOW_ENVELOPE');
  });
  it('QB-02 materializes the floor exactly, with the model units untouched',()=>{
    const plan=materializeAiQuantityAllocation({state,candidate,snapshot,side:'LONG',quantityUnits:legalMinUnits,authorizationMaxPrice:snapshot.quote.ask,envelope:env(legalMinUnits+50)});
    expect(plan.notionalUsd).toBeCloseTo(legalMinUnits*snapshot.quote.stepSize*snapshot.quote.ask,10);
    expect(plan.notionalUsd+1e-8).toBeGreaterThanOrEqual(snapshot.quote.minNotional);
    expect(legalMinUnits*snapshot.quote.stepSize+1e-12).toBeGreaterThanOrEqual(snapshot.quote.minQty);
  });
  it('QB-03 reports the floor in whole steps from real filters, not from a guessed price',()=>{
    const envelope=env(1000),floor=envelope.LONG.minQuantityUnits!;
    expect(floor).toBe(Math.max(1,Math.ceil(snapshot.quote.minQty/snapshot.quote.stepSize-1e-9),Math.ceil(Math.max(snapshot.quote.minNotional,snapshot.quote.minQty*snapshot.quote.last)/(snapshot.quote.last*snapshot.quote.stepSize)-1e-9)));
    expect(floor*snapshot.quote.stepSize*snapshot.quote.last+1e-8).toBeGreaterThanOrEqual(snapshot.quote.minNotional);
  });
});
