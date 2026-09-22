import {readdirSync,readFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import {buildExitEstimate,deriveProjectedExit,exitPriceBound,stableHash,type CostItem,type EstimateInput} from './s03ExitCostEstimator.js';
import {decideAiExit,type AiExitVerdict,type PolicyInput} from './s03AiExitPolicy.js';

const NOW=1_800_000_000_000;
const SCOPE=JSON.stringify(['TESTNET','binance-primary','BTCUSDT','LONG']);
const CYCLE='cycle_1';

const item=(id:string,kind:CostItem['kind'],amount:number|null,extra:Partial<CostItem>={}):CostItem=>({
  id,kind,cycleId:CYCLE,scope:SCOPE,settled:!kind.startsWith('PROJECTED'),amount,status:'EXACT',asset:'USDT',sourceId:`src_${id}`,...extra,
});
/** The stage file's worked example: -2 realized, 1 incurred fee, -0.5 funding, -5 remaining gross, 0.5 remaining fee, 0.2 buffer = -9.2. */
const specItems=(remainingGross:number):CostItem[]=>[
  item('realized','REALIZED_GROSS',-2),item('entry-fee','ENTRY_FEE',1),item('funding','FUNDING',-0.5),
  item('remaining-gross','PROJECTED_EXIT_GROSS',remainingGross,{settled:false}),
  item('remaining-fee','PROJECTED_EXIT_FEE',0.5,{settled:false}),
  item('buffer','UNCERTAINTY_BUFFER',0.2,{settled:false}),
];
const estimateInput=(items:CostItem[],over:Partial<EstimateInput>={}):EstimateInput=>({
  scope:SCOPE,cycleId:CYCLE,positionVersion:7,costVersion:'cost-v1',remainingQuantityUnits:10,side:'LONG',
  quoteAt:NOW-1_000,expiresAt:NOW+14_000,now:NOW,entryPrice:100,bid:95,ask:96,tickSize:0.05,stepSize:0.001,minNotional:5,
  quoteAsset:'USDT',rateMaxAgeMs:60_000,items,...over,
});
const executableBound=(limitPrice=95.05)=>({executable:true,reason:null,orderType:'LIMIT' as const,marketFallbackAllowed:false as const,limitPrice,targetNet:-10,achievedNet:-9.99,worseningAllowed:false as const});
const policyInput=(over:Partial<PolicyInput>={}):PolicyInput=>({
  owner:{ownerState:'AI_ACTIVE',ownerVersion:4,cycleId:CYCLE,scope:SCOPE,deadline:NOW+60_000},
  plan:{planVersion:2,cycleId:CYCLE,scope:SCOPE,thesisInvalid:true,invalidationPredicate:'STRUCTURE_BREAK_15M',invalidationEvidenceRefs:['ev-1'],exitConditionMet:false,minNetProfitUsd:0.5},
  estimate:buildExitEstimate(estimateInput(specItems(-5.79))),
  bound:executableBound(),
  policy:{lossLimit:10,allowSmallLoss:true,minNetProfitUsd:0.2,authorizationTtlMs:15_000},
  now:NOW,...over,
});
const decide=(over:Partial<PolicyInput>={}):AiExitVerdict=>decideAiExit(policyInput(over));

describe('S03 exit valuation and authority gate',()=>{
  it('S03-T01 treats -9.99 and -10.00 as inside the permission and -10.01 as a breach, with no epsilon',()=>{
    const cases=[[-5.79,-9.99,'ALLOW'],[-5.8,-10,'ALLOW'],[-5.81,-10.01,'HANDOFF']] as const;
    for(const [gross,net,outcome] of cases){
      const estimate=buildExitEstimate(estimateInput(specItems(gross)));
      expect(estimate.netIfAllClosed,`${net}`).toBe(net);
      expect(estimate.factsStatus).toBe('EXACT');
      const verdict=decide({estimate});
      expect(verdict.outcome,`${net}`).toBe(outcome);
      expect(verdict.reasonCodes).toContain(outcome==='ALLOW'?'THESIS_INVALIDATED_WITHIN_SMALL_LOSS_LIMIT':'CYCLE_WOULD_BREACH_LOSS_LIMIT');
      if(outcome==='HANDOFF'){expect(verdict.authorizationExpiresAt).toBeNull();expect(verdict.boundaryPrice).toBeNull();}
    }
    // the worked example from the stage file
    expect(buildExitEstimate(estimateInput(specItems(-5))).netIfAllClosed).toBeCloseTo(-9.2,10);
  });

  it('S03-T02 does not cut a loser just because it is a loser: no thesis break means HOLD, missing evidence blocks',()=>{
    const noThesis=decide({plan:{...policyInput().plan,thesisInvalid:false}});
    expect(noThesis.outcome).toBe('HOLD');
    expect(noThesis.reasonCodes).toContain('NO_PERMITTED_EXIT_CONDITION');
    const noPredicate=decide({plan:{...policyInput().plan,invalidationPredicate:null}});
    expect(noPredicate.outcome).toBe('BLOCKED_FACTS');
    expect(noPredicate.reasonCodes).toContain('THESIS_INVALIDATION_EVIDENCE_MISSING');
    const noRefs=decide({plan:{...policyInput().plan,invalidationEvidenceRefs:[]}});
    expect(noRefs.reasonCodes).toContain('THESIS_INVALIDATION_EVIDENCE_MISSING');
    const switchOff=decide({policy:{lossLimit:10,allowSmallLoss:false,minNetProfitUsd:0.2,authorizationTtlMs:15_000}});
    expect(switchOff.outcome).toBe('HOLD');
    expect(switchOff.reasonCodes).toContain('SMALL_LOSS_EXIT_NOT_PERMITTED');
  });

  it('S03-T03 refuses the micro-profit branch when a positive gross turns negative after fees',()=>{
    const items=[item('r','REALIZED_GROSS',0),item('f','ENTRY_FEE',0),item('u','FUNDING',0),
      item('g','PROJECTED_EXIT_GROSS',3,{settled:false}),item('e','PROJECTED_EXIT_FEE',3.4,{settled:false}),item('b','UNCERTAINTY_BUFFER',0,{settled:false})];
    const estimate=buildExitEstimate(estimateInput(items));
    expect(estimate.projectedExitGross).toBe(3);
    expect(estimate.netIfAllClosed).toBe(-0.4);
    const verdict=decide({estimate,plan:{...policyInput().plan,thesisInvalid:false,exitConditionMet:true}});
    expect(verdict.outcome).toBe('HOLD');
    expect(verdict.reasonCodes).not.toContain('MICRO_PROFIT_EXIT_CONDITION_MET');
    // the same net with a positive net does take it, and only when the plan condition is met
    const profitable=buildExitEstimate(estimateInput(items.map(row=>row.id==='e'?{...row,amount:0.4}:row)));
    expect(profitable.netIfAllClosed).toBe(2.6);
    expect(decide({estimate:profitable,plan:{...policyInput().plan,thesisInvalid:false,exitConditionMet:true}}).outcome).toBe('ALLOW');
    expect(decide({estimate:profitable,plan:{...policyInput().plan,thesisInvalid:false,exitConditionMet:false}}).reasonCodes).toContain('PROFIT_EXIT_CONDITION_NOT_MET');
  });

  it('S03-T04 conserves each cost exactly once and blocks conflicting facts',()=>{
    const once=buildExitEstimate(estimateInput(specItems(-5)));
    expect(once.incurredFees).toBe(1);
    const duplicated=buildExitEstimate(estimateInput([...specItems(-5),item('entry-fee','ENTRY_FEE',1),item('realized','REALIZED_GROSS',-2)]));
    expect(duplicated.netIfAllClosed).toBe(once.netIfAllClosed);
    expect(duplicated.reasons.filter(reason=>reason.startsWith('DUPLICATE_COST_ITEM'))).toHaveLength(2);
    const entryPlusPriorExit=buildExitEstimate(estimateInput([...specItems(-5),item('prior-exit-fee','PRIOR_EXIT_FEE',0.4)]));
    expect(entryPlusPriorExit.incurredFees).toBe(1.4);
    const conflicting=buildExitEstimate(estimateInput(specItems(-5).map(row=>row.id==='funding'?{...row,status:'CONFLICT' as const}:row)));
    expect(conflicting.factsStatus).toBe('CONFLICT');
    expect(conflicting.netIfAllClosed).toBeNull();
    expect(decide({estimate:conflicting}).outcome).toBe('BLOCKED_FACTS');
    // the same id cannot be reused for a different kind to smuggle a second deduction
    const rekeyed=buildExitEstimate(estimateInput([...specItems(-5),item('entry-fee','PROJECTED_EXIT_FEE',9,{settled:false})]));
    expect(rekeyed.netIfAllClosed).toBe(once.netIfAllClosed);
  });

  it('S03-T05 converts a non-quote asset only through a fresh rate and never treats USDC as USDT 1:1',()=>{
    const converted=buildExitEstimate(estimateInput(specItems(-5).map(row=>row.id==='funding'?{...row,amount:-1,asset:'USDC',rateToQuote:0.98,rateAt:NOW-1_000}:row)));
    expect(converted.signedFunding).toBeCloseTo(-0.98,10);
    expect(converted.factsStatus).toBe('EXACT');
    expect(converted.reasons).toContain('SEPARATE_STABLE_ASSET:funding');
    const stale=buildExitEstimate(estimateInput(specItems(-5).map(row=>row.id==='funding'?{...row,amount:-1,asset:'USDC',rateToQuote:0.98,rateAt:NOW-120_000}:row)));
    expect(stale.factsStatus).toBe('UNKNOWN');
    expect(stale.netIfAllClosed).toBeNull();
    expect(stale.reasons).toContain('UNCONVERTED_COST:funding');
    const blocked=decide({estimate:stale});
    expect(blocked.outcome).toBe('BLOCKED_FACTS');
    expect(blocked.reasonCodes).toContain('COST_CURRENCY_UNCONVERTED');
    const noRate=buildExitEstimate(estimateInput(specItems(-5).map(row=>row.id==='entry-fee'?{...row,asset:'BNB'}:row)));
    expect(noRate.factsStatus).toBe('UNKNOWN');
  });

  it('S03-T06 gives a human-managed or exactly-expired cycle no authority even when it is profitable',()=>{
    const profitable=buildExitEstimate(estimateInput(specItems(4)));
    expect(profitable.netIfAllClosed).toBeCloseTo(-0.2,10);
    const positive=buildExitEstimate(estimateInput(specItems(6)));
    expect(positive.netIfAllClosed).toBe(1.8);
    const human=decide({estimate:positive,owner:{...policyInput().owner,ownerState:'HUMAN_MANAGED'}});
    expect(human.outcome).toBe('HOLD');
    expect(human.reasonCodes).toContain('HUMAN_MANAGED_NO_AI_AUTHORITY');
    expect(human.authorizationExpiresAt).toBeNull();
    const atDeadline=decide({estimate:positive,now:policyInput().owner.deadline!});
    expect(atDeadline.outcome).toBe('HANDOFF');
    expect(atDeadline.reasonCodes).toContain('AI_MANAGEMENT_EXPIRED');
    const closed=decide({estimate:positive,owner:{...policyInput().owner,ownerState:'CLOSED'}});
    expect(closed.outcome).toBe('HOLD');
    expect(closed.reasonCodes).toContain('CYCLE_CLOSED_NO_AI_EXIT');
    const pendingHandoff=decide({estimate:positive,owner:{...policyInput().owner,ownerState:'HANDOFF_PENDING'}});
    expect(pendingHandoff.reasonCodes).toContain('AI_AUTHORITY_REVOKED_PENDING_HUMAN');
    const noDeadline=decide({estimate:positive,owner:{...policyInput().owner,deadline:null}});
    expect(noDeadline.outcome).toBe('HANDOFF');
    expect(noDeadline.reasonCodes).toContain('AI_MANAGEMENT_DEADLINE_UNKNOWN');
  });

  it('S03-T07 rounds the limit price towards conservatism and re-verifies it; no market fallback exists',()=>{
    const fixedMilli=Math.round(-4.2*1_000);
    const long=exitPriceBound({side:'LONG',remainingQuantityUnits:10,stepSize:1,tickSize:0.05,entryPrice:100,exitFeeRate:0.0004,fixedNetMilli:fixedMilli,targetNet:-10,minNotional:5,now:NOW});
    expect(long.executable).toBe(true);
    expect(long.orderType).toBe('LIMIT');
    expect(long.marketFallbackAllowed).toBe(false);
    const onTick=(price:number)=>Math.abs(price/0.05-Math.round(price/0.05))<1e-9;
    expect(onTick(long.limitPrice!)).toBe(true);
    expect(long.achievedNet!+1e-9).toBeGreaterThanOrEqual(-10);
    // one tick cheaper would breach the line, which is what proves the rounding direction
    const netAt=(price:number)=>(fixedMilli+Math.round(((price-100)*10-Math.abs(price*10*0.0004))*1_000))/1_000;
    expect(netAt(long.limitPrice!-0.05)).toBeLessThan(-10);
    const short=exitPriceBound({side:'SHORT',remainingQuantityUnits:10,stepSize:1,tickSize:0.05,entryPrice:100,exitFeeRate:0.0004,fixedNetMilli:fixedMilli,targetNet:-10,minNotional:5,now:NOW});
    expect(short.executable).toBe(true);
    expect(onTick(short.limitPrice!)).toBe(true);
    expect(short.achievedNet!+1e-9).toBeGreaterThanOrEqual(-10);
    const unreachable=exitPriceBound({side:'LONG',remainingQuantityUnits:10,stepSize:1,tickSize:0.05,entryPrice:100,exitFeeRate:0.0004,fixedNetMilli:fixedMilli,targetNet:5_000,minNotional:5,now:NOW,maxPrice:110});
    expect(unreachable.executable).toBe(false);
    expect(unreachable.reason).toBe('BOUND_UNREACHABLE');
    const tooSmall=exitPriceBound({side:'LONG',remainingQuantityUnits:1,stepSize:0.001,tickSize:0.05,entryPrice:100,exitFeeRate:0.0004,fixedNetMilli:fixedMilli,targetNet:-10,minNotional:1_000,now:NOW});
    expect(tooSmall.executable).toBe(false);
    expect(tooSmall.reason).toBe('BOUND_NOTIONAL_TOO_SMALL');
    const badTick=exitPriceBound({side:'LONG',remainingQuantityUnits:10,stepSize:1,tickSize:0,entryPrice:100,exitFeeRate:0.0004,fixedNetMilli:fixedMilli,targetNet:-10,minNotional:5,now:NOW});
    expect(badTick.reason).toBe('BOUND_MARKET_INPUT_INVALID');
    // an unexecutable bound can never yield ALLOW
    expect(decide({bound:tooSmall}).outcome).toBe('HOLD');
    expect(decide({bound:tooSmall}).reasonCodes).toContain('EXECUTION_BOUND_UNAVAILABLE');
  });

  it('S03-T08 accumulates the original cycle across partial fills and refuses a foreign profit as an offset',()=>{
    const cumulative=[
      item('realized-leg1','REALIZED_GROSS',-6,{sourceId:'fill-1'}),item('leg1-exit-fee','PRIOR_EXIT_FEE',0.4,{sourceId:'fill-1'}),
      item('entry-fee','ENTRY_FEE',0.3),item('funding','FUNDING',0),
      item('remaining-gross','PROJECTED_EXIT_GROSS',-4,{settled:false}),item('remaining-fee','PROJECTED_EXIT_FEE',0.2,{settled:false}),item('buffer','UNCERTAINTY_BUFFER',0.1,{settled:false}),
    ];
    const estimate=buildExitEstimate(estimateInput(cumulative));
    expect(estimate.netIfAllClosed).toBeCloseTo(-11.0,10);
    expect(decide({estimate}).outcome).toBe('HANDOFF');
    expect(decide({estimate}).reasonCodes).toContain('CYCLE_WOULD_BREACH_LOSS_LIMIT');
    // a fact borrowed from another cycle or another position is a caller error: the whole
    // estimate is refused rather than quietly dropped, so it can never offset the cycle loss
    const withForeign=buildExitEstimate(estimateInput([...cumulative,item('other-cycle','REALIZED_GROSS',50,{cycleId:'cycle_other'})]));
    expect(withForeign.factsStatus).toBe('CONFLICT');
    expect(withForeign.netIfAllClosed).toBeNull();
    expect(withForeign.reasons).toContain('FOREIGN_CYCLE_FACT:other-cycle');
    expect(decide({estimate:withForeign}).outcome).toBe('BLOCKED_FACTS');
    const withForeignScope=buildExitEstimate(estimateInput([...cumulative,item('other-scope','REALIZED_GROSS',80,{scope:JSON.stringify(['TESTNET','binance-primary','ETHUSDT','LONG'])})]));
    expect(withForeignScope.factsStatus).toBe('CONFLICT');
    expect(decide({estimate:withForeignScope}).outcome).toBe('BLOCKED_FACTS');
  });

  it('S03-T09 rejects stale quotes, NaN, negative costs and unmodelled projections instead of returning ALLOW',()=>{
    const stale=decide({estimate:buildExitEstimate(estimateInput(specItems(-5.79),{now:NOW+20_000})),bound:executableBound()});
    expect(stale.outcome).toBe('BLOCKED_FACTS');
    expect(stale.reasonCodes).toContain('QUOTE_EXPIRED_NO_AUTHORITY');
    expect(decide({estimate:buildExitEstimate(estimateInput(specItems(-5.79),{expiresAt:NOW-1}))}).reasonCodes).toContain('QUOTE_STALE_FOR_AUTHORITY');
    const nan=buildExitEstimate(estimateInput(specItems(-5.79).map(row=>row.id==='buffer'?{...row,amount:Number.NaN}:row)));
    expect(nan.factsStatus).toBe('CONFLICT');
    expect(nan.netIfAllClosed).toBeNull();
    expect(decide({estimate:nan}).outcome).toBe('BLOCKED_FACTS');
    const negativeFee=buildExitEstimate(estimateInput(specItems(-5.79).map(row=>row.id==='remaining-fee'?{...row,amount:-5}:row)));
    expect(negativeFee.reasons).toContain('NEGATIVE_COST:remaining-fee');
    expect(decide({estimate:negativeFee}).outcome).toBe('BLOCKED_FACTS');
    const missing=buildExitEstimate(estimateInput(specItems(-5.79).filter(row=>row.kind!=='PROJECTED_EXIT_FEE')));
    expect(missing.factsStatus).toBe('UNKNOWN');
    expect(missing.reasons).toContain('MISSING_PROJECTION:projectedExitFee');
    expect(decide({estimate:missing}).outcome).toBe('BLOCKED_FACTS');
    const badQuote=buildExitEstimate(estimateInput(specItems(-5.79),{tickSize:Number.NaN}));
    expect(badQuote.reasons).toContain('TICK_SIZE_INVALID');
    expect(decide({estimate:badQuote,plan:{...policyInput().plan,minNetProfitUsd:Number.NaN}}).reasonCodes).toContain('POLICY_CONFIG_INVALID_PROFIT_FLOOR');
    expect(decide({estimate:badQuote,policy:{lossLimit:11,allowSmallLoss:true,minNetProfitUsd:0.2,authorizationTtlMs:15_000}}).reasonCodes).toContain('POLICY_CONFIG_INVALID_LOSS_LIMIT_OR_TTL');
    expect(decide({estimate:badQuote,policy:{lossLimit:10,allowSmallLoss:true,minNetProfitUsd:0.2,authorizationTtlMs:0}}).outcome).toBe('BLOCKED_FACTS');
  });
});

describe('S03 properties',()=>{
  // deterministic LCG: a property test must never depend on the clock or a model
  let seed=20260921;
  const rand=()=>((seed=(Math.imul(seed,1_103_515_245)+12345)>>>0)/4_294_967_296);
  const money=()=>Math.round(rand()*400)/100;

  const randomFacts=()=>{
    const items=specItems(Math.round((money()-10)*100)/100).map(row=>({...row}));
    return estimateInput(items);
  };
  const bump=(input:EstimateInput,amount:number):EstimateInput=>({...input,items:input.items.map(row=>row.kind==='PROJECTED_EXIT_FEE'?{...row,amount:(row.amount??0)+amount}:row)});

  it('a higher cost never turns a refused exit into an allowed one and never raises the net',()=>{
    for(let i=0;i<150;i++){
      const base=randomFacts();
      const before=buildExitEstimate(base);
      const after=buildExitEstimate(bump(base,Math.round((0.01+rand()*2)*100)/100));
      if(before.conservativeNet!=null&&after.conservativeNet!=null)expect(after.conservativeNet).toBeLessThanOrEqual(before.conservativeNet+1e-12);
      const decisionBefore=decide({estimate:before,bound:executableBound()});
      const decisionAfter=decide({estimate:after,bound:executableBound()});
      if(decisionBefore.outcome!=='ALLOW'&&decisionAfter.outcome==='ALLOW')throw new Error(`cost increase unlocked ALLOW at iteration ${i}`);
    }
  });

  it('a worse exit quote never improves the projected net, and a slippage band only widens conservatism',()=>{
    for(let i=0;i<150;i++){
      const entryPrice=100,quantityUnits=10,stepSize=1,feeRate=0.0004;
      const face=95+Math.round(rand()*400)/100;
      const worse=face-Math.round((0.05+rand()*5)*100)/100;
      const good=deriveProjectedExit({side:'LONG',entryPrice,quantityUnits,stepSize,price:face,feeRate});
      const bad=deriveProjectedExit({side:'LONG',entryPrice,quantityUnits,stepSize,price:worse,feeRate});
      expect(bad.projectedExitGross!).toBeLessThanOrEqual(good.projectedExitGross!+1e-9);
      expect(bad.projectedExitFee!).toBeLessThanOrEqual(good.projectedExitFee!+1e-9);
      const slipped=deriveProjectedExit({side:'LONG',entryPrice,quantityUnits,stepSize,price:face,feeRate,slippageBps:25});
      expect(slipped.status).toBe('CONSERVATIVE_BOUND');
      expect(slipped.projectedExitGross!).toBeLessThanOrEqual(good.projectedExitGross!+1e-9);
      const shortGood=deriveProjectedExit({side:'SHORT',entryPrice,quantityUnits,stepSize:1,price:face,feeRate});
      const shortBad=deriveProjectedExit({side:'SHORT',entryPrice,quantityUnits,stepSize:1,price:face+Math.round(rand()*500)/100,feeRate});
      expect(shortBad.projectedExitGross!).toBeLessThanOrEqual(shortGood.projectedExitGross!+1e-9);
      expect(deriveProjectedExit({side:'LONG',entryPrice,quantityUnits,stepSize,price:Number.NaN,feeRate}).status).toBe('UNKNOWN');
    }
  });

  it('identical facts always hash identically and any single change moves the hash',()=>{
    for(let i=0;i<50;i++){
      const base=randomFacts();
      const first=buildExitEstimate(base);
      const second=buildExitEstimate({...base,items:base.items.map(row=>({...row}))});
      expect(second.estimateHash).toBe(first.estimateHash);
      // key order must not matter for a stable identity
      const reordered=buildExitEstimate({...base,items:base.items.map(row=>Object.fromEntries(Object.keys(row).sort((a,b)=>b.localeCompare(a)).map(key=>[key,(row as never as Record<string,unknown>)[key]])) as CostItem)});
      expect(reordered.estimateHash).toBe(first.estimateHash);
      for(const [label,over] of [['quantity',{remainingQuantityUnits:11}],['position',{positionVersion:8}],['cost version',{costVersion:'cost-v2'}],['quote window',{expiresAt:NOW+14_001}]] as const){
        expect(buildExitEstimate({...base,...over}).estimateHash,label).not.toBe(first.estimateHash);
      }
      for(const kind of ['PROJECTED_EXIT_FEE','UNCERTAINTY_BUFFER','FUNDING','ENTRY_FEE']){
        const moved=buildExitEstimate({...base,items:base.items.map(row=>row.kind===kind?{...row,amount:Math.round((((row.amount??0)+0.07)*100))/100}:row)});
        expect(moved.estimateHash,kind).not.toBe(first.estimateHash);
      }
    }
    expect(stableHash({a:1,b:[2,3]})).toBe(stableHash({b:[2,3],a:1}));
    expect(stableHash({a:1})).not.toBe(stableHash({a:2}));
  });

  it('the verdict always carries the estimate identity it was decided on',()=>{
    const verdict=decide({});
    expect(verdict.outcome).toBe('ALLOW');
    expect(verdict.estimateHash).toBe(policyInput().estimate.estimateHash);
    expect(verdict.authorizationExpiresAt).toBe(NOW+14_000);
    expect(verdict.boundaryPrice).toBe(95.05);
    expect(verdict.orderType).toBe('LIMIT');
    expect(verdict.marketFallbackAllowed).toBe(false);
    expect(verdict.evidenceRefs).toContain('ev-1');
    const staleIdentity=decide({owner:{...policyInput().owner,cycleId:'cycle_other'}});
    expect(staleIdentity.reasonCodes).toContain('IDENTITY_MISMATCH_OWNER_PLAN_ESTIMATE');
    const staleVersion=decide({owner:{...policyInput().owner,ownerVersion:undefined as never}});
    expect(staleVersion.reasonCodes).toContain('OWNER_OR_PLAN_VERSION_INVALID');
  });

  it('the S03 modules stay pure, and their only production consumers are the two named files',()=>{
    const moduleFiles=['s03ExitCostEstimator.ts','s03AiExitPolicy.ts'];
    const ownDirectory=fileURLToPath(new URL('.',import.meta.url));
    for(const file of moduleFiles){
      const source=readFileSync(join(ownDirectory,file),'utf8');
      const imports=[...source.matchAll(/^\s*import\s[\s\S]*?from '([^']+)';/gm)].map(match=>match[1].replace(/^\.\//,''));
      // the only permitted dependency is the sibling pure module itself
      expect(imports,file).toEqual(imports.filter(specifier=>specifier==='s03ExitCostEstimator.js'));
      expect(source,file).not.toMatch(/node:|fetch|axios|WebSocket|DatabaseSync|settingsStore|placeEntry|placeTakeProfit|placeManualOrder|submitOrder|\.reserve\(/);
    }
    const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):entry.name.endsWith('.ts')?[join(dir,entry.name)]:[]);
    const consumers=walk(join(ownDirectory,'..')).filter(path=>!moduleFiles.includes(basename(path))&&!basename(path).endsWith('.test.ts')&&readFileSync(path,'utf8').includes('s03ExitCostEstimator'));
    // J1 replaced "S03 has no consumer" with a closed list: the fact assembler and the single
    // authority-gated AI exit runner. A new entry point has to be added here on purpose, and the
    // runner itself may never become a second order path.
    expect(consumers.map(path=>basename(path)).sort()).toEqual(['s03ExitCostFacts.ts','v396AiExitRunner.ts']);
    const runner=readFileSync(join(ownDirectory,'v396AiExitRunner.ts'),'utf8');
    expect(runner).toMatch(/currentAuthority\(\)[\s\S]*AI_EXIT_ADAPTER_CAPABILITIES_UNPROVEN/);
    expect(runner).toMatch(/if\(authority==='OFF'\)return report;/);
  });
});

describe('S03 review regressions',()=>{
  const goodItems=specItems(-5.79);
  const goodEstimate=buildExitEstimate(estimateInput(goodItems));

  it('R1 refuses instead of pricing on structurally broken market or identity inputs',()=>{
    const broken:Array<[string,Partial<EstimateInput>]>=[
      ['tick', {tickSize:Number.NaN}],['step',{stepSize:0}],['entry',{entryPrice:-100}],
      ['window',{expiresAt:NOW-10_000,quoteAt:NOW}],['notional',{minNotional:0}],
      ['future quote',{quoteAt:NOW+5_000,expiresAt:NOW+60_000}],['missing bid',{bid:0}],
      ['identity',{scope:''}],['quantity',{remainingQuantityUnits:0}],['side',{side:'BOTH' as never}],
      ['position version',{positionVersion:0}],['cost version',{costVersion:''}],
    ];
    for(const [label,over] of broken){
      const estimate=buildExitEstimate(estimateInput(goodItems,over));
      expect(estimate.factsStatus,label).not.toBe('EXACT');
      expect(estimate.conservativeNet,label).toBeNull();
      const outcome=decide({estimate}).outcome;
      expect(outcome,label).not.toBe('ALLOW');
      expect(decide({estimate}).reasonCodes.join(),label).toMatch(/ESTIMATE_INTEGRITY_FAILED|FACTS_INCOMPLETE_NO_NET_VALUE|QUOTE_|COST_CURRENCY|IDENTITY_MISMATCH/);
    }
  });

  it('R1b a policy fed a hand-crafted estimate with integrity reasons still cannot ALLOW',()=>{
    const forged={...goodEstimate,reasons:['TICK_SIZE_INVALID'],factsStatus:'EXACT' as const,conservativeNet:-9.99,netIfAllClosed:-9.99,quoteFresh:true};
    const verdict=decide({estimate:forged});
    expect(verdict.outcome).toBe('BLOCKED_FACTS');
    expect(verdict.reasonCodes).toContain('ESTIMATE_INTEGRITY_FAILED');
  });

  it('R2 a fact from another cycle or scope blocks rather than being quietly dropped',()=>{
    const foreign=buildExitEstimate(estimateInput([...goodItems,item('leak','REALIZED_GROSS',50,{cycleId:'cycle_other'})]));
    expect(foreign.factsStatus).toBe('CONFLICT');
    expect(foreign.netIfAllClosed).toBeNull();
    expect(decide({estimate:foreign}).outcome).toBe('BLOCKED_FACTS');
    const foreignScope=buildExitEstimate(estimateInput([...goodItems,item('leak2','REALIZED_GROSS',80,{scope:'["TESTNET","binance-primary","ETHUSDT","LONG"]'})]));
    expect(foreignScope.factsStatus).toBe('CONFLICT');
    // an idempotent re-submission of the same id stays conserved, it is not a conflict
    const replayed=buildExitEstimate(estimateInput([...goodItems,item('realized','REALIZED_GROSS',-2)]));
    expect(replayed.factsStatus).toBe('EXACT');
    expect(replayed.netIfAllClosed).toBe(goodEstimate.netIfAllClosed);
  });

  it('R3 the returned limit price is tick-exact with no float dust and is the conservative side',()=>{
    const fixedMilli=Math.round(-4.2*1_000);
    const long=exitPriceBound({side:'LONG',remainingQuantityUnits:10,stepSize:1,tickSize:0.05,entryPrice:100,exitFeeRate:0.0004,fixedNetMilli:fixedMilli,targetNet:-10,minNotional:5,now:NOW});
    const short=exitPriceBound({side:'SHORT',remainingQuantityUnits:10,stepSize:1,tickSize:0.05,entryPrice:100,exitFeeRate:0.0004,fixedNetMilli:fixedMilli,targetNet:-10,minNotional:5,now:NOW});
    for(const bound of [long,short]){
      expect(bound.executable).toBe(true);
      const price=bound.limitPrice!;
      expect(String(price)).toMatch(/^\d+(\.\d{1,4})?$/);
      expect(Math.round(price*10_000)%500,price.toFixed(6)).toBe(0);
      expect(price>0).toBe(true);
    }
    // LONG: the sell floor is never below breakeven; SHORT: the buy ceiling is never above it
    expect(long.achievedNet!+1e-9).toBeGreaterThanOrEqual(-10);
    expect(short.achievedNet!+1e-9).toBeGreaterThanOrEqual(-10);
    const longNet=(price:number)=>(fixedMilli+Math.round(((price-100)*10-Math.abs(price*10*0.0004))*1_000))/1_000;
    const shortNet=(price:number)=>(fixedMilli+Math.round(((100-price)*10-Math.abs(price*10*0.0004))*1_000))/1_000;
    expect(longNet(long.limitPrice!-0.05)).toBeLessThan(-10);
    expect(shortNet(short.limitPrice!+0.05)).toBeLessThan(-10);
  });

  it('R4 an authorization window that is already empty can never be ALLOW',()=>{
    const atExpiry=buildExitEstimate(estimateInput(goodItems,{expiresAt:NOW,quoteAt:NOW-1}));
    expect(atExpiry.conservativeNet).not.toBeNull();
    const verdict=decide({estimate:atExpiry,now:NOW});
    expect(verdict.outcome).not.toBe('ALLOW');
    expect(verdict.reasonCodes).toContain('AUTHORIZATION_WINDOW_EMPTY');
    expect(verdict.authorizationExpiresAt).toBeNull();
    // a generous ttl is still capped by the quote expiry and by the deadline
    const wide=decide({estimate:buildExitEstimate(estimateInput(goodItems)),policy:{lossLimit:10,allowSmallLoss:true,minNetProfitUsd:0.2,authorizationTtlMs:10*60_000}});
    expect(wide.outcome).toBe('ALLOW');
    expect(wide.authorizationExpiresAt).toBe(NOW+14_000);
    const nearDeadline=decide({owner:{...policyInput().owner,deadline:NOW+5_000},estimate:buildExitEstimate(estimateInput(goodItems))});
    expect(nearDeadline.authorizationExpiresAt).toBe(NOW+5_000);
  });

  it('R5 the decision identity binds the policy and ownership inputs that change the outcome',()=>{
    const base=decide({});
    const sameInputs=decide({});
    expect(sameInputs.decisionHash).toBe(base.decisionHash);
    const tighterLimit=decide({policy:{lossLimit:5,allowSmallLoss:true,minNetProfitUsd:0.2,authorizationTtlMs:15_000}});
    expect(tighterLimit.decisionHash).not.toBe(base.decisionHash);
    const switchOff=decide({policy:{lossLimit:10,allowSmallLoss:false,minNetProfitUsd:0.2,authorizationTtlMs:15_000}});
    expect(switchOff.decisionHash).not.toBe(base.decisionHash);
    // The AI's own profit permission is part of the decision identity, and which of the two lines
    // actually binds is reported: the plan floor and the AI permission are different authorities and
    // an operator has to be able to tell them apart after the fact.
    const higherAiFloor=decide({policy:{lossLimit:10,allowSmallLoss:true,minNetProfitUsd:0.8,authorizationTtlMs:15_000}});
    expect(higherAiFloor.decisionHash).not.toBe(base.decisionHash);
    expect(higherAiFloor).toMatchObject({profitFloorSource:'AI_PERMISSION',profitFloorUsd:0.8});
    expect(base).toMatchObject({profitFloorSource:'PLAN_FLOOR',profitFloorUsd:0.5});
    const equalFloors=decide({policy:{lossLimit:10,allowSmallLoss:true,minNetProfitUsd:0.5,authorizationTtlMs:15_000}});
    expect(equalFloors).toMatchObject({profitFloorSource:'BOTH',profitFloorUsd:0.5});
    expect(decide({policy:{lossLimit:10,allowSmallLoss:true,minNetProfitUsd:0,authorizationTtlMs:15_000}}).reasonCodes)
      .toContain('POLICY_CONFIG_INVALID_AI_MIN_NET_PROFIT');
    const newPlan=decide({plan:{...policyInput().plan,planVersion:3}});
    expect(newPlan.decisionHash).not.toBe(base.decisionHash);
    const reauthorized=decide({owner:{...policyInput().owner,ownerVersion:5}});
    expect(reauthorized.decisionHash).not.toBe(base.decisionHash);
    const movedDeadline=decide({owner:{...policyInput().owner,deadline:NOW+90_000}});
    expect(movedDeadline.decisionHash).not.toBe(base.decisionHash);
    const worseEvidence=decide({plan:{...policyInput().plan,invalidationEvidenceRefs:['ev-2']}});
    expect(worseEvidence.decisionHash).not.toBe(base.decisionHash);
    expect(base.decisionHash).not.toBe(base.estimateHash);
  });

  it('R6 the micro-profit floor is inclusive and a net below it never reaches the profit branch',()=>{
    const exactly=buildExitEstimate(estimateInput(specItems(-4)));
    expect(exactly.netIfAllClosed).toBe(-8.2);
    expect(decide({estimate:exactly}).outcome).toBe('ALLOW');
    const floorZero=buildExitEstimate(estimateInput(specItems(4.7)));
    expect(floorZero.netIfAllClosed).toBe(0.5);
    const met=decide({estimate:floorZero,plan:{...policyInput().plan,thesisInvalid:false,exitConditionMet:true,minNetProfitUsd:0.5}});
    expect(met.outcome).toBe('ALLOW');
    const justBelow=decide({estimate:buildExitEstimate(estimateInput(specItems(4.699))),plan:{...policyInput().plan,thesisInvalid:false,exitConditionMet:true,minNetProfitUsd:0.5}});
    expect(justBelow.outcome).toBe('HOLD');
    expect(justBelow.reasonCodes).toContain('NO_PERMITTED_EXIT_CONDITION');
    // a zero floor would mean "exit as soon as it is not a loss", which S03 does not authorise
    const zero=decide({estimate:buildExitEstimate(estimateInput(specItems(4.2))),plan:{...policyInput().plan,thesisInvalid:false,exitConditionMet:true,minNetProfitUsd:0}});
    expect(zero.outcome).toBe('BLOCKED_FACTS');
    expect(zero.reasonCodes).toContain('POLICY_CONFIG_INVALID_PROFIT_FLOOR');
  });
});
