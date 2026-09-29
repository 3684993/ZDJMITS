import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {FundingIncomeLedger} from './fundingIncomeLedger.js';
import {convertToBaseUnit} from './quoteFxPolicy.js';
import {executableDepth} from './orderBookDepth.js';
import {AiFabric} from './aiFabric.js';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';

/**
 * P6 acceptance: funding, FX and depth as facts, plus the shared model endpoint divided fairly.
 *
 * The audit (R7) counted 11 124 AI_EXIT_FACTS_INCOMPLETE in the retained window, of which 8 785
 * blamed funding plus depth and 2 299 also blamed USDC FX. The runner was passing
 * `quoteAsset:'USDT', fx:null` for every position and reading `quote.depthNotionalUsd`, a field no
 * production path ever filled - while unit tests that hand-set that field passed.
 */

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const any=(value:unknown)=>value as any;

async function ledgerAt(identity={environment:'TESTNET',account:'binance-primary'}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-v396-funding-'));
  dirs.push(dir);
  return new FundingIncomeLedger(path.join(dir,'v396-ownership.sqlite'),()=>identity);
}

describe('P6 funding income ledger',()=>{
  it('records an income row once and reports the exact total for an enclosed window',async()=>{
    const ledger=await ledgerAt(),now=Date.now();
    const inserted=ledger.recordRows([
      {incomeId:'f1',asset:'USDT',symbol:'BRUSDT',incomeType:'FUNDING_FEE',income:-0.25,time:now-70_000,observedAt:now},
      {incomeId:'f2',asset:'USDT',symbol:'BRUSDT',incomeType:'FUNDING_FEE',income:0.1,time:now-60_000,observedAt:now},
    ]);
    expect(inserted).toMatchObject({inserted:2,duplicates:0,rejected:[]});
    expect(ledger.recordRows([{incomeId:'f1',asset:'USDT',symbol:'BRUSDT',incomeType:'FUNDING_FEE',income:-0.25,time:now-70_000}]).duplicates).toBe(1);
    expect(ledger.coverageSummary().fundingRows).toBe(2);
    ledger.recordCoverage({asset:'USDT',sinceMs:now-120_000,untilMs:now,pages:1,rows:2,complete:true});
    expect(ledger.attribution({asset:'USDT',symbol:'BRUSDT',fromMs:now-90_000,toMs:now})).toMatchObject({
      status:'EXACT',fundingUsd:-0.15,observedFundingRows:2,coverageComplete:true,reason:null});
    ledger.close();
  });

  it('a coverage gap stays UNKNOWN and is never reported as zero funding',async()=>{
    const ledger=await ledgerAt(),now=Date.now();
    ledger.recordRows([{incomeId:'f1',asset:'USDT',symbol:'BRUSDT',incomeType:'FUNDING_FEE',income:-0.25,time:now-70_000}]);
    const noCoverage=ledger.attribution({asset:'USDT',symbol:'BRUSDT',fromMs:now-90_000,toMs:now});
    expect(noCoverage).toMatchObject({status:'UNKNOWN',fundingUsd:null,reason:'COVERAGE_UNRECORDED'});
    ledger.recordCoverage({asset:'USDT',sinceMs:now-30_000,untilMs:now,pages:1,rows:0,complete:false,reason:'INCOME_COVERAGE_INCOMPLETE'});
    const partial=ledger.attribution({asset:'USDT',symbol:'BRUSDT',fromMs:now-90_000,toMs:now});
    expect(partial.status).toBe('UNKNOWN');
    expect(partial.reason).toBe('COVERAGE_DOES_NOT_ENCLOSE_WINDOW');
    expect(partial.partialCoverageRows).toBe(1);
    ledger.close();
  });

  it('a window with full coverage and no rows is proven zero, which is not the same claim as unknown',async()=>{
    const ledger=await ledgerAt(),now=Date.now();
    ledger.recordCoverage({asset:'USDT',sinceMs:now-120_000,untilMs:now,pages:1,rows:0,complete:true});
    expect(ledger.attribution({asset:'USDT',symbol:'BRUSDT',fromMs:now-90_000,toMs:now})).toMatchObject({status:'EXACT',fundingUsd:0,observedFundingRows:0});
    ledger.close();
  });

  it('income rows of another type are kept but never counted as funding',async()=>{
    const ledger=await ledgerAt(),now=Date.now();
    ledger.recordRows([
      {incomeId:'r1',asset:'USDT',symbol:'BRUSDT',incomeType:'REALIZED_PNL',income:5,time:now-70_000},
      {incomeId:'c1',asset:'USDT',symbol:'BRUSDT',incomeType:'COMMISSION',income:-0.4,time:now-69_000},
    ]);
    ledger.recordCoverage({asset:'USDT',sinceMs:now-120_000,untilMs:now,pages:1,rows:2,complete:true});
    const fact=ledger.attribution({asset:'USDT',symbol:'BRUSDT',fromMs:now-90_000,toMs:now});
    expect(fact).toMatchObject({status:'EXACT',fundingUsd:0,observedFundingRows:0});
    expect(ledger.coverageSummary().rows).toBe(2);
    ledger.close();
  });

  it('a rejected row is reported, not silently dropped',async()=>{
    const ledger=await ledgerAt();
    const result=ledger.recordRows([{incomeId:'ok',asset:'',income:1,time:1},{incomeId:'',asset:'USDT',income:Number.NaN,time:1}]);
    expect(result.inserted).toBe(0);
    expect(result.rejected.length).toBe(2);
    ledger.close();
  });
});

describe('P6 quote conversion contract',()=>{
  it('USDT needs no rate and says so, rather than pretending a rate was proven',()=>{
    expect(convertToBaseUnit({amount:2.5,fromAsset:'USDT',now:1_000_000,maxAgeMs:60_000}))
      .toMatchObject({status:'NOT_APPLICABLE',rate:1,amountBase:2.5,source:'BASE_UNIT_IDENTITY'});
  });
  it('USDC uses a timestamped rate when one exists',()=>{
    const converted=convertToBaseUnit({amount:10,fromAsset:'USDC',now:1_000_000,maxAgeMs:60_000,
      rateProvider:()=>({rate:1.0002,observedAt:999_990,source:'USDCUSDT_QUOTE_LAST'})});
    expect(converted).toMatchObject({status:'PROVEN',rate:1.0002,ageMs:10,source:'USDCUSDT_QUOTE_LAST'});
    expect(converted.amountBase).toBeCloseTo(10.002,9);
  });
  it('a missing rate is a refusal with no amount, never an implicit one',()=>{
    expect(convertToBaseUnit({amount:10,fromAsset:'USDC',now:1_000_000,maxAgeMs:60_000,rateProvider:null}))
      .toMatchObject({status:'RATE_ABSENT',rate:null,amountBase:null});
  });
  it('a stale rate refuses the conversion instead of applying an old number',()=>{
    const converted=convertToBaseUnit({amount:10,fromAsset:'USDC',now:1_000_000,maxAgeMs:60_000,
      rateProvider:()=>({rate:1.05,observedAt:1_000_000-120_000,source:'OLD'})});
    expect(converted.status).toBe('RATE_STALE');
    expect(converted.amountBase).toBeNull();
    expect(converted.rate).toBe(1.05);
  });
  it('an unknown asset cannot be converted at all',()=>{
    expect(convertToBaseUnit({amount:1,fromAsset:'',now:1,maxAgeMs:1})).toMatchObject({status:'IDENTITY_UNPROVEN',amountBase:null});
    expect(convertToBaseUnit({amount:null,fromAsset:'USDC',now:1,maxAgeMs:1})).toMatchObject({status:'RATE_ABSENT',amountBase:null});
  });
});

describe('P6 executable depth from the order book',()=>{
  const book=(overrides:Record<string,unknown>={})=>any({ts:Date.now()-200,sequence:42,bids:[[100,2],[99.9,3],[99.5,50]],asks:[[100.1,1.5],[100.2,4]],...overrides});
  it('walks only the side that receives the order and only inside the bound',()=>{
    const depth=executableDepth({side:'LONG',quantity:4,boundPrice:99.9,book:book(),now:Date.now(),maxAgeMs:15_000});
    // Closing a LONG sells into bids at or above the bound: 100 x2 and 99.9 x2 of the 3 available.
    expect(depth.executableQuantity).toBeCloseTo(4,9);
    expect(depth.levelsUsed).toBe(2);
    expect(depth.worstPriceUsed).toBe(99.9);
    expect(depth.source).toBe('ORDER_BOOK');
    expect(depth.sequence).toBe(42);
    expect(depth.reason).toBeNull();
  });
  it('reports an insufficient walk instead of rounding it up to enough',()=>{
    const depth=executableDepth({side:'LONG',quantity:40,boundPrice:99.9,book:book(),now:Date.now(),maxAgeMs:15_000});
    expect(depth.executableQuantity).toBeLessThan(40);
    expect(depth.walkedWholeBook).toBe(true);
  });
  it('a SHORT buys the asks at or below its bound',()=>{
    const depth=executableDepth({side:'SHORT',quantity:1.5,boundPrice:100.1,book:book(),now:Date.now(),maxAgeMs:15_000});
    expect(depth.executableQuantity).toBeCloseTo(1.5,9);
    expect(depth.worstPriceUsed).toBe(100.1);
  });
  it('every unavailable book is a named reason, never a zero',()=>{
    const now=Date.now();
    expect(executableDepth({side:'LONG',quantity:1,boundPrice:100,book:null,now,maxAgeMs:15_000}).reason).toBe('ORDER_BOOK_ABSENT');
    expect(executableDepth({side:'LONG',quantity:1,boundPrice:100,book:book({ts:now-60_000}),now,maxAgeMs:15_000}).reason).toBe('ORDER_BOOK_STALE');
    expect(executableDepth({side:'LONG',quantity:1,boundPrice:100,book:book({bids:[]}),now,maxAgeMs:15_000}).reason).toBe('BIDS_EMPTY');
    expect(executableDepth({side:'LONG',quantity:1,boundPrice:101,book:book(),now,maxAgeMs:15_000}).reason).toBe('NO_BID_AT_OR_ABOVE_BOUND');
    expect(executableDepth({side:'LONG',quantity:1,boundPrice:null,book:book(),now,maxAgeMs:15_000}).reason).toBe('PRICE_BOUND_UNPROVEN');
    expect(executableDepth({side:'LONG',quantity:1,boundPrice:100,book:book({ts:null}),now,maxAgeMs:15_000}).reason).toBe('ORDER_BOOK_UNSTAMPED');
  });
});

describe('P6 bounded fairness on the shared Primary endpoint',()=>{
  const settings={ai:{scoutEnabled:false,decisionTimeoutMs:30_000},riskGovernance:{exitCoordination:{reviewMinIntervalMs:20_000,reviewCapacitySharePercent:25}},
    settingsVersion:219} as any;
  function makeFabric(){
    const state=new RuntimeState(settings);
    state.aiResources=[any({id:'primary',role:'PRIMARY_BRAIN',model:'m',status:'ONLINE',maxConcurrency:1,baseUrl:'http://127.0.0.1:9'})];
    const value=new AiFabric(state,new EventBus(),any({build:()=>({packetId:'p',symbol:'BTCUSDT'})}));
    (value as any).endpointAvailable=()=>true;
    return value;
  }
  const choose=(ai:AiFabric)=>(ai as any).choose('PRIMARY_BRAIN',undefined,'ENTRY');

  it('an Entry yields to a review that has been owed past its reservation',()=>{
    const ai=makeFabric(),now=Date.now();
    ai.noteReviewOwed(now-21_000);
    expect(()=>choose(ai)).toThrow(/AI_PRIMARY_HELD_FOR_REVIEW/);
    expect(ai.reviewFairness(now).heldForReview).toBe(true);
  });
  it('a freshly owed review does not block Entry at all',()=>{
    const ai=makeFabric(),now=Date.now();
    ai.noteReviewOwed(now-1_000);
    expect(choose(ai).id).toBe('primary');
  });
  it('the reservation is spent once the review has taken its bounded share',()=>{
    const ai=makeFabric(),now=Date.now();
    ai.noteReviewOwed(now-21_000);
    // Four serves with one review is the configured 25% share, so the debt is now satisfied.
    (ai as any).primaryServes=[{role:'REVIEW',at:now},{role:'ENTRY',at:now},{role:'ENTRY',at:now},{role:'ENTRY',at:now}];
    expect(choose(ai).id).toBe('primary');
    expect(ai.reviewFairness(now).reviewOwedSince).toBeNull();
  });
  it('the ceiling is unchanged: one slot still admits one run at a time',()=>{
    const ai=makeFabric();
    (ai as any).load.get('primary').active=1;
    expect(()=>choose(ai)).toThrow(/AI_RESOURCE_BUSY/);
    expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(false);
  });
});
