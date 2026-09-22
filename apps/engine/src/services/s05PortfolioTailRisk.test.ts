import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {
  buildPortfolioRiskSnapshot,
  canonicalRiskUnderlying,
  type PortfolioAssetFact,
  type PortfolioCashFlowFact,
  type PortfolioPendingRiskFact,
  type PortfolioPositionFact,
  type PortfolioRiskSnapshot,
} from './portfolioRiskSnapshot.js';
import {
  evaluatePortfolioStress,
  type CorrelationMap,
  type PortfolioRiskProfile,
  type PortfolioStressResult,
  type StressScenario,
} from './portfolioStress.js';
import {evaluateHumanCapacity, type HumanCapacityProfile} from './humanCapacityPolicy.js';

/**
 * S05 local acceptance: hostile tests for the deterministic portfolio-risk snapshot, stress
 * evaluation and human-capacity policy. Written against the documented fail-closed contract
 * only; this file does not modify the three production modules.
 */

const NOW=1_800_000_000_000;
const BTC_SCOPE=JSON.stringify(['TESTNET','binance-primary','BTCUSDT','LONG']);
const ETH_SCOPE=JSON.stringify(['TESTNET','binance-primary','ETHUSDT','LONG']);

const position=(over:Partial<PortfolioPositionFact>={}):PortfolioPositionFact=>({
  scope:BTC_SCOPE,cycleId:'cycle_1',symbol:'BTCUSDT',side:'LONG',quantity:10,markPrice:100,leverage:10,
  quoteAsset:'USDT',marginAsset:'USDT',ownerState:'AI_ACTIVE',factStatus:'VERIFIED',
  maintenanceMarginUsd:50,liquidationBufferPct:0.5,handoffAt:null,acknowledgedAt:null,...over,
});
const usdtAsset=(over:Partial<PortfolioAssetFact>={}):PortfolioAssetFact=>({
  asset:'USDT',equityUsd:10_000,availableMarginUsd:20_000,factStatus:'VERIFIED',...over,
});
const pendingRisk=(over:Partial<PortfolioPendingRiskFact>={}):PortfolioPendingRiskFact=>({
  id:'res_1',dedupeKey:'reserve_btc_1',symbol:'BTCUSDT',side:'LONG',notionalUsd:120,marginUsd:12,
  quoteAsset:'USDT',source:'RESERVATION',factStatus:'VERIFIED',...over,
});
const cashFlow=(id:string,amountUsd:number,factStatus:PortfolioCashFlowFact['factStatus']='VERIFIED'):PortfolioCashFlowFact=>({id,amountUsd,factStatus});

const snapshotOf=(positions:PortfolioPositionFact[],pending:PortfolioPendingRiskFact[]=[],over:Record<string,unknown>={}):PortfolioRiskSnapshot=>
  buildPortfolioRiskSnapshot({riskGeneration:1,now:NOW,peakEquityUsd:10_000,assets:[usdtAsset()],cashFlows:[],positions,pending,...over} as never);

const btcSnapshot=()=>snapshotOf([position()]);
const btcEthSnapshot=()=>snapshotOf([position(),position({symbol:'ETHUSDT',scope:ETH_SCOPE,liquidationBufferPct:0.4,maintenanceMarginUsd:40})]);
const sixPositionSnapshot=()=>snapshotOf([
  position(),
  position({symbol:'ETHUSDT',scope:ETH_SCOPE,cycleId:'cycle_2'}),
  position({symbol:'SOLUSDT',scope:JSON.stringify(['TESTNET','binance-primary','SOLUSDT','LONG']),cycleId:'cycle_3'}),
  position({symbol:'ADAUSDT',scope:JSON.stringify(['TESTNET','binance-primary','ADAUSDT','LONG']),cycleId:'cycle_4'}),
  position({symbol:'DOGEUSDT',scope:JSON.stringify(['TESTNET','binance-primary','DOGEUSDT','LONG']),cycleId:'cycle_5'}),
  position({symbol:'XRPUSDT',scope:JSON.stringify(['TESTNET','binance-primary','XRPUSDT','LONG']),cycleId:'cycle_6'}),
]);
const sixClusterCorrelation=():CorrelationMap=>correlation({clusters:{BTC:'MAJORS',ETH:'MAJORS',SOL:'MAJORS',ADA:'MAJORS',DOGE:'MAJORS',XRP:'MAJORS'}});

const profile=(over:Partial<PortfolioRiskProfile>={}):PortfolioRiskProfile=>({
  maxCapitalAtRiskUsd:500,maxDrawdownPct:0.2,maxStressLossUsd:300,maxGrossNotionalUsd:5_000,
  maxDirectionNotionalUsd:5_000,maxClusterNotionalUsd:5_000,minMarginBufferPct:0.1,minLiquidationBufferPct:0.05,...over,
});
const scenario=(over:Partial<StressScenario>={}):StressScenario=>({
  id:'S_BASE',priceShockPct:0.02,spreadWidenPct:0.001,fundingShockPct:0.001,markBasisShockPct:0.002,
  depthPenaltyPct:0.001,exchangeUnavailable:false,unavailablePenaltyPct:0,clusterConvergencePct:0.5,...over,
});
const correlation=(over:Partial<CorrelationMap>={}):CorrelationMap=>({version:'corr-v1',clusters:{BTC:'MAJORS'},...over});
const twoClusterCorrelation=():CorrelationMap=>correlation({clusters:{BTC:'MAJORS',ETH:'MAJORS'}});

const stressOf=(snapshot:PortfolioRiskSnapshot,over:{profile?:PortfolioRiskProfile;correlation?:CorrelationMap;scenarios?:StressScenario[]}={}):PortfolioStressResult=>
  evaluatePortfolioStress({snapshot,profile:over.profile??profile(),correlation:over.correlation??correlation(),scenarios:over.scenarios??[scenario()]});

const capacityProfile=(over:Partial<HumanCapacityProfile>={}):HumanCapacityProfile=>({
  maxHumanPositions:2,maxHumanNotionalUsd:5_000,maxPendingHandoffs:1,maxAckAgeMs:60_000,...over,
});
const capacityOf=(snapshot:PortfolioRiskSnapshot,over:{profile?:HumanCapacityProfile;now?:number;candidateNotionalUsd?:number}={})=>
  evaluateHumanCapacity({snapshot,profile:over.profile??capacityProfile(),now:over.now??NOW,candidateNotionalUsd:over.candidateNotionalUsd});

const exposureId=(cycleId:string,scope=BTC_SCOPE)=>`position:${scope}|${cycleId}`;
const reorder=<T extends object>(row:T):T=>Object.fromEntries(Object.entries(row).reverse()) as T;

describe('S05-T01 ownership transition never releases portfolio risk',()=>{
  const states=['AI_ACTIVE','HANDOFF_PENDING','HUMAN_MANAGED'] as const;
  const snapshots=states.map(ownerState=>snapshotOf([position({
    ownerState,handoffAt:ownerState==='AI_ACTIVE'?null:NOW-5_000,acknowledgedAt:ownerState==='HUMAN_MANAGED'?NOW-1_000:null,
  })]));

  it.each(states.map(name=>({name})))('$name keeps gross, notional and capital at risk',({name})=>{
    const row=snapshots[states.indexOf(name as typeof states[number])];
    expect(row.exposures).toHaveLength(1);
    expect(row.exposures[0].notionalUsd).toBe(1_000);
    expect(row.exposures[0].marginUsd).toBe(100);
    expect(row.grossNotionalUsd).toBe(1_000);
    expect(row.longNotionalUsd).toBe(1_000);
    expect(row.capitalAtRiskUsd).toBe(100);
  });

  it('ownerState alone changes no risk aggregate yet stays visible in the hash',()=>{
    const [ai,pending,human]=snapshots;
    for(const row of [pending,human]){
      expect(row.grossNotionalUsd).toBe(ai.grossNotionalUsd);
      expect(row.capitalAtRiskUsd).toBe(ai.capitalAtRiskUsd);
      expect(row.exposures[0].notionalUsd).toBe(ai.exposures[0].notionalUsd);
      expect(row.snapshotHash).not.toBe(ai.snapshotHash);
    }
  });

  it('stress loss and admission are unchanged by an ownership-only transition',()=>{
    const results=snapshots.map(row=>stressOf(row));
    expect(results[0].admissionAllowed).toBe(true);
    expect(results[0].maxStressLossUsd).toBeCloseTo(25,12);
    for(const row of results.slice(1)){
      expect(row.maxStressLossUsd).toBe(results[0].maxStressLossUsd);
      expect(row.admissionAllowed).toBe(results[0].admissionAllowed);
      expect(row.blockers).toEqual([]);
    }
  });

  it('a handoff keeps occupying a human slot after the AI loses control',()=>{
    for(const row of snapshots){
      const decision=capacityOf(row,{profile:capacityProfile({maxHumanPositions:1})});
      expect(decision.executable).toBe(false);
      expect(decision.blockers).toContain('HUMAN_POTENTIAL_SLOT_LIMIT');
      expect(decision.potentialHandoffSlots).toBe(1);
      expect(decision.potentialHandoffNotionalUsd).toBe(1_000);
    }
    expect(capacityOf(snapshots[2]).humanManagedPositions).toBe(1);
    expect(capacityOf(snapshots[1]).pendingHandoffs).toBe(1);
    expect(capacityOf(snapshots[0]).aiActivePositions).toBe(1);
  });

  it('a human-managed position must still carry proven margin facts',()=>{
    const result=stressOf(snapshotOf([position({ownerState:'HUMAN_MANAGED',maintenanceMarginUsd:null,liquidationBufferPct:null})]));
    expect(result.blockers).toContain('MAINTENANCE_MARGIN_UNPROVEN:'+exposureId('cycle_1'));
    expect(result.blockers).toContain('LIQUIDATION_BUFFER_UNPROVEN:'+exposureId('cycle_1'));
    expect(result.admissionAllowed).toBe(false);
  });
});

describe('S05-T02 canonical underlying merge and pending-risk dedupe',()=>{
  it('BTCUSDT and BTCUSDC aggregate into one BTC underlying without losing either leg',()=>{
    const row=snapshotOf([
      position(),
      position({symbol:'BTCUSDC',side:'SHORT',cycleId:'cycle_2',scope:JSON.stringify(['TESTNET','binance-primary','BTCUSDC','SHORT']),quoteAsset:'USDC',marginAsset:'USDC'}),
    ],[],{assets:[usdtAsset(),usdtAsset({asset:'USDC',equityUsd:1_000,availableMarginUsd:2_000})]});
    expect(row.underlying).toEqual([{underlying:'BTC',grossNotionalUsd:2_000,longNotionalUsd:1_000,shortNotionalUsd:1_000}]);
    expect(row.grossNotionalUsd).toBe(2_000);
    expect(row.shortNotionalUsd).toBe(1_000);
    expect(row.complete).toBe(true);
    expect(stressOf(row,{correlation:twoClusterCorrelation()}).limitingConstraints).toEqual([]);
  });

  it('symbol prefixes are canonicalised so one asset cannot hide behind two names',()=>{
    expect(canonicalRiskUnderlying('1000PEPEUSDT')).toBe('PEPE');
    expect(canonicalRiskUnderlying('btcusdc')).toBe('BTC');
    expect(canonicalRiskUnderlying('ETHUSDT')).toBe('ETH');
    expect(canonicalRiskUnderlying('BTCFDUSD')).toBe('BTC');
    const row=snapshotOf([position(),position({symbol:'1000BTCUSDT',cycleId:'cycle_2',scope:JSON.stringify(['TESTNET','binance-primary','1000BTCUSDT','LONG'])})]);
    expect(row.underlying).toHaveLength(1);
    expect(row.underlying[0].grossNotionalUsd).toBe(2_000);
  });

  it('a reservation and its order share a dedupeKey and are counted once, at the larger fact',()=>{
    const row=snapshotOf([],[pendingRisk({id:'res_1',source:'RESERVATION',notionalUsd:120,marginUsd:12}),pendingRisk({id:'ord_1',source:'ORDER',notionalUsd:150,marginUsd:15})]);
    const pendings=row.exposures.filter(ex=>ex.kind==='PENDING');
    expect(pendings).toHaveLength(1);
    expect(pendings[0].notionalUsd).toBe(150);
    expect(pendings[0].marginUsd).toBe(15);
    expect(row.pendingNotionalUsd).toBe(150);
    expect(row.capitalAtRiskUsd).toBe(15);
    expect(row.complete).toBe(true);
  });

  it('an UNKNOWN pending fact keeps its notional occupied and fails the snapshot closed',()=>{
    const row=snapshotOf([position()],[pendingRisk({factStatus:'UNKNOWN',source:'UNKNOWN',notionalUsd:120})]);
    expect(row.complete).toBe(false);
    expect(row.blockers).toContain('PENDING_RISK_UNVERIFIED:reserve_btc_1');
    expect(row.pendingNotionalUsd).toBe(120);
    expect(row.grossNotionalUsd).toBe(1_120);
    expect(row.exposures.find(ex=>ex.kind==='PENDING')?.factStatus).toBe('UNKNOWN');
    const result=stressOf(row);
    expect(result.blockers).toContain('PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE');
    expect(result.admissionAllowed).toBe(false);
    expect(result.maxStressLossUsd).toBeGreaterThan(0);
  });

  it('a pending row without a dedupeKey can never be admitted',()=>{
    const row=snapshotOf([position()],[pendingRisk({dedupeKey:'  '})]);
    expect(row.blockers).toContain('PENDING_DEDUPE_KEY_MISSING:res_1');
    expect(row.complete).toBe(false);
    expect(stressOf(row).admissionAllowed).toBe(false);
    const decision=capacityOf(row);
    expect(decision.blockers).toContain('PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE');
    expect(decision.executable).toBe(false);
  });

  it('a BOTH-side pending reservation is charged to long and short exposure',()=>{
    const row=snapshotOf([],[pendingRisk({side:'BOTH',notionalUsd:200,marginUsd:20})]);
    expect(row.longNotionalUsd).toBe(200);
    expect(row.shortNotionalUsd).toBe(200);
    const result=stressOf(row);
    expect(result.limitingConstraints).toContain('MIN_LIQUIDATION_BUFFER');
    expect(result.admissionAllowed).toBe(false);
  });
});

describe('S05-T04 harsher scenarios never reduce loss or raise admission',()=>{
  type Axis={name:string;worse:Partial<StressScenario>;snapshot?:PortfolioRiskSnapshot;correlation?:CorrelationMap};
  const axes:Axis[]=[
    {name:'price shock',worse:{priceShockPct:0.2}},
    {name:'downside price shock',worse:{priceShockPct:-0.2}},
    {name:'spread widening',worse:{spreadWidenPct:0.05}},
    {name:'funding shock',worse:{fundingShockPct:0.05}},
    {name:'mark basis',worse:{markBasisShockPct:-0.05}},
    {name:'depth penalty',worse:{depthPenaltyPct:0.05}},
    {name:'exchange outage',worse:{exchangeUnavailable:true,unavailablePenaltyPct:0.5}},
    {name:'cluster convergence',worse:{clusterConvergencePct:1},snapshot:btcEthSnapshot(),correlation:twoClusterCorrelation()},
  ];
  it.each(axes)('$name: loss does not fall and admission does not open',axis=>{
    const snapshot=axis.snapshot??btcSnapshot();
    const map=axis.correlation??correlation();
    const base=stressOf(snapshot,{correlation:map});
    const harsher=stressOf(snapshot,{correlation:map,scenarios:[scenario(axis.worse)]});
    expect(harsher.scenarioSetValid,`${axis.name} must stay a valid scenario`).toBe(true);
    expect(harsher.maxStressLossUsd).toBeGreaterThanOrEqual(base.maxStressLossUsd);
    expect(harsher.admissionAllowed&&!base.admissionAllowed).toBe(false);
    expect(harsher.worstScenarioId).toBe('S_BASE');
  });

  it('adding a harsher scenario never lowers the reported worst loss',()=>{
    const snapshot=btcEthSnapshot();
    const one=stressOf(snapshot,{correlation:twoClusterCorrelation()});
    const two=stressOf(snapshot,{correlation:twoClusterCorrelation(),scenarios:[scenario(),scenario({id:'S_WORSE',priceShockPct:0.15,spreadWidenPct:0.02,fundingShockPct:0.02,markBasisShockPct:0.02,depthPenaltyPct:0.02,clusterConvergencePct:1})]});
    expect(two.maxStressLossUsd).toBeGreaterThanOrEqual(one.maxStressLossUsd);
    expect(two.worstScenarioId).toBe('S_WORSE');
    expect(two.scenarios.map(row=>row.id)).toEqual(['S_BASE','S_WORSE']);
    expect(two.admissionAllowed&&!one.admissionAllowed).toBe(false);
  });

  it('every member of a correlated cluster is charged the convergence penalty',()=>{
    const snapshot=btcEthSnapshot();
    const clustered=stressOf(snapshot,{correlation:twoClusterCorrelation(),scenarios:[scenario({clusterConvergencePct:1})]});
    const isolated=stressOf(snapshot,{correlation:correlation({clusters:{BTC:'MAJORS',ETH:'SINGLES'}}),scenarios:[scenario({clusterConvergencePct:1})]});
    expect(clustered.clusterNotional.MAJORS).toBe(2_000);
    expect(clustered.scenarios[0].correlationPenaltyUsd).toBeCloseTo(40,9);
    expect(isolated.scenarios[0].correlationPenaltyUsd).toBe(0);
    expect(clustered.maxStressLossUsd).toBeGreaterThan(isolated.maxStressLossUsd);
  });

  it('deterministic property sweep: componentwise harsher scenarios never cut the loss',()=>{
    let seed=202_609_22;
    const next=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4_294_967_296);
    const snapshot=btcEthSnapshot();
    for(let step=0;step<80;step++){
      const base=scenario({
        id:`S_${step}`,priceShockPct:(next()*0.1)*(next()<0.5?-1:1),spreadWidenPct:next()*0.02,fundingShockPct:next()*0.02,
        markBasisShockPct:(next()*0.02)*(next()<0.5?-1:1),depthPenaltyPct:next()*0.02,
        exchangeUnavailable:next()<0.3,unavailablePenaltyPct:next()*0.05,clusterConvergencePct:next()*0.5,
      });
      const harsher=scenario({...base,priceShockPct:base.priceShockPct*1.2,spreadWidenPct:base.spreadWidenPct*1.2,
        fundingShockPct:base.fundingShockPct*1.2,markBasisShockPct:base.markBasisShockPct*1.2,depthPenaltyPct:base.depthPenaltyPct*1.2,
        unavailablePenaltyPct:base.unavailablePenaltyPct*1.2,clusterConvergencePct:base.clusterConvergencePct*1.2});
      const before=stressOf(snapshot,{correlation:twoClusterCorrelation(),scenarios:[base]});
      const after=stressOf(snapshot,{correlation:twoClusterCorrelation(),scenarios:[harsher]});
      expect(before.scenarioSetValid&&after.scenarioSetValid,`step ${step}`).toBe(true);
      expect(after.maxStressLossUsd,`step ${step}`).toBeGreaterThanOrEqual(before.maxStressLossUsd-1e-9);
      expect(after.admissionAllowed&&!before.admissionAllowed,`step ${step}`).toBe(false);
    }
  });
});

describe('S05-T05 missing or unproven facts fail closed and never claim safety',()=>{
  const complete=btcSnapshot();
  type Row={name:string;snapshot?:PortfolioRiskSnapshot;profile?:PortfolioRiskProfile;correlation?:CorrelationMap;scenarios?:StressScenario[];expected:string};
  const rows:Row[]=[
    {name:'capital-at-risk limit is NaN',profile:profile({maxCapitalAtRiskUsd:Number.NaN}),expected:'RISK_PROFILE_INCOMPLETE_OR_INVALID'},
    {name:'stress budget is negative',profile:profile({maxStressLossUsd:-1}),expected:'RISK_PROFILE_INCOMPLETE_OR_INVALID'},
    {name:'liquidation buffer requirement above 100%',profile:profile({minLiquidationBufferPct:1.5}),expected:'RISK_PROFILE_INCOMPLETE_OR_INVALID'},
    {name:'a required limit is absent',profile:{...profile(),maxGrossNotionalUsd:undefined} as never,expected:'RISK_PROFILE_INCOMPLETE_OR_INVALID'},
    {name:'drawdown limit is a string',profile:{...profile(),maxDrawdownPct:'0.2'} as never,expected:'RISK_PROFILE_INCOMPLETE_OR_INVALID'},
    {name:'no scenario is supplied',scenarios:[],expected:'STRESS_SCENARIOS_INVALID'},
    {name:'two scenarios share an id',scenarios:[scenario(),scenario()],expected:'STRESS_SCENARIOS_INVALID'},
    {name:'scenario id is blank',scenarios:[scenario({id:'   '})],expected:'STRESS_SCENARIOS_INVALID'},
    {name:'price shock exceeds the representable range',scenarios:[scenario({priceShockPct:1.5})],expected:'STRESS_SCENARIOS_INVALID'},
    {name:'depth penalty is missing',scenarios:[{...scenario(),depthPenaltyPct:undefined} as never],expected:'STRESS_SCENARIOS_INVALID'},
    {name:'unavailable penalty is NaN',scenarios:[scenario({unavailablePenaltyPct:Number.NaN})],expected:'STRESS_SCENARIOS_INVALID'},
    {name:'correlation map has no version',correlation:correlation({version:'  '}),expected:'CORRELATION_VERSION_MISSING'},
    {name:'maintenance margin is absent',snapshot:snapshotOf([position({maintenanceMarginUsd:undefined})]),expected:'MAINTENANCE_MARGIN_UNPROVEN:'+exposureId('cycle_1')},
    {name:'liquidation buffer is null',snapshot:snapshotOf([position({liquidationBufferPct:null})]),expected:'LIQUIDATION_BUFFER_UNPROVEN:'+exposureId('cycle_1')},
    {name:'liquidation buffer is already negative',snapshot:snapshotOf([position({liquidationBufferPct:-0.01})]),expected:'LIQUIDATION_BUFFER_UNPROVEN:'+exposureId('cycle_1')},
    {name:'maintenance margin is negative',snapshot:snapshotOf([position({maintenanceMarginUsd:-5})]),expected:'MAINTENANCE_MARGIN_UNPROVEN:'+exposureId('cycle_1')},
    {name:'margin asset has no account fact',snapshot:snapshotOf([position({marginAsset:'USDC'})]),expected:'MARGIN_ASSET_UNVERIFIED:USDC'},
    {name:'account asset is UNKNOWN',snapshot:snapshotOf([position()],[],{assets:[usdtAsset({factStatus:'UNKNOWN'})]}),expected:'PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE'},
    {name:'account asset is duplicated',snapshot:snapshotOf([position()],[],{assets:[usdtAsset(),usdtAsset({equityUsd:9_000})]}),expected:'PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE'},
    {name:'account equity is zero',snapshot:snapshotOf([position()],[],{assets:[usdtAsset({equityUsd:0,availableMarginUsd:0})]}),expected:'PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE'},
    {name:'cash flow is unverified',snapshot:snapshotOf([position()],[],{cashFlows:[cashFlow('dep_1',100,'UNKNOWN')]}),expected:'PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE'},
    {name:'risk generation is not positive',snapshot:snapshotOf([position()],[],{riskGeneration:0}),expected:'PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE'},
    {name:'snapshot time is not finite',snapshot:snapshotOf([position()],[],{now:Number.NaN}),expected:'PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE'},
    {name:'peak equity is missing',snapshot:snapshotOf([position()],[],{peakEquityUsd:Number.NaN}),expected:'PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE'},
    {name:'position identity is missing',snapshot:snapshotOf([position({cycleId:''})]),expected:'PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE'},
    {name:'position facts contradict each other',snapshot:snapshotOf([position({quantity:10}),position({quantity:12})]),expected:'PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE'},
  ];
  it.each(rows)('$name',row=>{
    const result=stressOf(row.snapshot??complete,{profile:row.profile??profile(),correlation:row.correlation??correlation(),scenarios:row.scenarios??[scenario()]});
    expect(result.blockers,row.name).toContain(row.expected);
    expect(result.admissionAllowed,row.name).toBe(false);
  });

  it('an unproven fact is still priced, so the refusal is not an empty book',()=>{
    const result=stressOf(snapshotOf([position({maintenanceMarginUsd:null})]));
    expect(result.profileValid).toBe(true);
    expect(result.scenarioSetValid).toBe(true);
    expect(result.maxStressLossUsd).toBeCloseTo(25,12);
    expect(result.worstScenarioId).toBe('S_BASE');
    expect(result.minObservedLiquidationBufferPct).toBe(0.5);
    expect(result.admissionAllowed).toBe(false);
  });

  it('the healthy baseline is genuinely allowed, so the fail-closed rows are not vacuous',()=>{
    const result=stressOf(complete);
    expect(result.blockers).toEqual([]);
    expect(result.limitingConstraints).toEqual([]);
    expect(result.admissionAllowed).toBe(true);
  });
});

describe('S05-T06 human capacity is consumed by every owned position',()=>{
  const human=snapshotOf([position({ownerState:'HUMAN_MANAGED'})]);
  const pending=snapshotOf([position({ownerState:'HANDOFF_PENDING',handoffAt:NOW-5_000})]);
  const ai=btcSnapshot();

  const ownerCases:Array<[string,PortfolioRiskSnapshot]>=[['HUMAN_MANAGED',human],['HANDOFF_PENDING',pending],['AI_ACTIVE',ai]];
  it.each(ownerCases.map(([name,snapshot])=>({name,snapshot})))('$name consumes exactly one slot',({name,snapshot})=>{
    const decision=capacityOf(snapshot,{profile:capacityProfile({maxHumanPositions:1})});
    expect(decision.potentialHandoffSlots,`${name} must consume a slot`).toBe(1);
    expect(decision.potentialHandoffNotionalUsd).toBe(1_000);
    expect(decision.blockers).toContain('HUMAN_POTENTIAL_SLOT_LIMIT');
    expect(decision.executable).toBe(false);
  });

  it('an AI position pre-reserves its own worst-case handoff slot',()=>{
    expect(capacityOf(ai,{profile:capacityProfile({maxHumanPositions:2})}).executable).toBe(true);
    const full=capacityOf(btcEthSnapshot(),{profile:capacityProfile({maxHumanPositions:2})});
    expect(full.potentialHandoffSlots).toBe(2);
    expect(full.blockers).toContain('HUMAN_POTENTIAL_SLOT_LIMIT');
    expect(full.executable).toBe(false);
  });

  it('more handoffs than the profile allows blocks new risk',()=>{
    const decision=capacityOf(pending,{profile:capacityProfile({maxPendingHandoffs:0})});
    expect(decision.pendingHandoffs).toBe(1);
    expect(decision.blockers).toContain('HUMAN_PENDING_HANDOFF_LIMIT');
    expect(decision.executable).toBe(false);
  });

  it('an unacknowledged handoff past the timeout blocks new risk until a human acknowledges',()=>{
    const stale=capacityOf(pending,{profile:capacityProfile({maxHumanPositions:9,maxPendingHandoffs:9,maxAckAgeMs:60_000}),now:NOW+120_000});
    expect(stale.blockers).toContain('HUMAN_ACK_OVERDUE');
    expect(stale.overdueHandoffs).toEqual([exposureId('cycle_1')]);
    expect(stale.executable).toBe(false);
    const acknowledged=capacityOf(snapshotOf([position({ownerState:'HANDOFF_PENDING',handoffAt:NOW-120_000,acknowledgedAt:NOW-1_000})]),
      {profile:capacityProfile({maxHumanPositions:9,maxPendingHandoffs:9}),now:NOW+120_000});
    expect(acknowledged.overdueHandoffs).toEqual([]);
    expect(acknowledged.blockers).not.toContain('HUMAN_ACK_OVERDUE');
    expect(acknowledged.executable).toBe(true);
  });

  it('characterisation: a handoff with an unproven start time is not scored as overdue, so S05-E must supply handoffAt',()=>{
    const decision=capacityOf(snapshotOf([position({ownerState:'HANDOFF_PENDING',handoffAt:null})]),
      {profile:capacityProfile({maxHumanPositions:9,maxPendingHandoffs:9}),now:NOW+86_400_000});
    expect(decision.pendingHandoffs).toBe(1);
    expect(decision.overdueHandoffs).toEqual([]);
    expect(decision.executable).toBe(true);
    expect(snapshotOf([position({ownerState:'HANDOFF_PENDING',handoffAt:null})]).complete).toBe(true);
  });

  it('the worst-case handoff notional includes the candidate and is never discounted',()=>{
    expect(capacityOf(human).potentialHandoffNotionalUsd).toBe(capacityOf(ai).potentialHandoffNotionalUsd);
    const exact=capacityOf(ai,{profile:capacityProfile({maxHumanPositions:9}),candidateNotionalUsd:4_000});
    expect(exact.executable).toBe(true);
    const over=capacityOf(ai,{profile:capacityProfile({maxHumanPositions:9}),candidateNotionalUsd:4_500});
    expect(over.blockers).toContain('HUMAN_POTENTIAL_NOTIONAL_LIMIT');
    expect(over.executable).toBe(false);
    const invalid=capacityOf(ai,{candidateNotionalUsd:-1});
    expect(invalid.blockers).toContain('CANDIDATE_NOTIONAL_INVALID');
    expect(invalid.executable).toBe(false);
  });

  it('more existing risk never increases capacity',()=>{
    const one=capacityOf(ai,{profile:capacityProfile({maxHumanPositions:2})});
    const many=capacityOf(sixPositionSnapshot(),{profile:capacityProfile({maxHumanPositions:2})});
    expect(one.executable).toBe(true);
    expect(many.executable).toBe(false);
    expect(many.executable&&!one.executable).toBe(false);
    expect(many.potentialHandoffSlots).toBe(6);
    expect(many.potentialHandoffNotionalUsd).toBe(6_000);
    const tightened=capacityOf(ai,{profile:capacityProfile({maxHumanPositions:1})});
    expect(capacityOf(ai,{profile:capacityProfile({maxHumanPositions:2})}).executable&&!tightened.executable).toBe(true);
    expect(tightened.executable).toBe(false);
  });

  it('invalid capacity profiles and incomplete snapshots are blockers',()=>{
    const cases:Array<[string,Partial<HumanCapacityProfile>|undefined,string]>=[
      ['non-integer position cap',{maxHumanPositions:1.5},'HUMAN_CAPACITY_PROFILE_INVALID'],
      ['negative notional cap',{maxHumanNotionalUsd:-1},'HUMAN_CAPACITY_PROFILE_INVALID'],
      ['unusable ack age',{maxAckAgeMs:Number.NaN},'HUMAN_CAPACITY_PROFILE_INVALID'],
      ['zero slots is a valid profile',{maxHumanPositions:0},'HUMAN_POTENTIAL_SLOT_LIMIT'],
    ];
    for(const [name,over,expected] of cases){
      const decision=capacityOf(ai,{profile:capacityProfile(over)});
      expect(decision.blockers,name).toContain(expected);
      expect(decision.executable,name).toBe(false);
    }
    expect(capacityOf(ai,{profile:capacityProfile(),now:Number.NaN}).blockers).toContain('HUMAN_CAPACITY_TIME_INVALID');
    expect(capacityOf(snapshotOf([position({factStatus:'CONFLICT'})])).blockers).toContain('PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE');
    expect(capacityOf(snapshotOf([position()],[],{assets:[usdtAsset({factStatus:'UNKNOWN'})]})).executable).toBe(false);
  });

  it('protection stays allowed even when every capacity check refuses',()=>{
    const blocked=capacityOf(ai,{profile:capacityProfile({maxHumanPositions:0,maxHumanNotionalUsd:0,maxPendingHandoffs:0,maxAckAgeMs:0})});
    expect(blocked.executable).toBe(false);
    expect(blocked.blockers.length).toBeGreaterThan(1);
    expect(blocked.protectionAllowed).toBe(true);
    expect(capacityOf(ai,{profile:{} as never}).protectionAllowed).toBe(true);
    const overdue=capacityOf(snapshotOf([position({ownerState:'HANDOFF_PENDING',handoffAt:NOW-9_000})]),
      {profile:capacityProfile({maxHumanPositions:9,maxPendingHandoffs:9,maxAckAgeMs:1}),now:NOW});
    expect(overdue.blockers).toContain('HUMAN_ACK_OVERDUE');
    expect(overdue.protectionAllowed).toBe(true);
  });
});

describe('S05-T07 external flows never mask a real drawdown',()=>{
  it('a deposit stays in equity but leaves the performance base',()=>{
    const plain=buildPortfolioRiskSnapshot({riskGeneration:1,now:NOW,peakEquityUsd:100,assets:[usdtAsset({equityUsd:90,availableMarginUsd:90})],cashFlows:[],positions:[],pending:[]});
    const deposited=buildPortfolioRiskSnapshot({riskGeneration:1,now:NOW,peakEquityUsd:100,assets:[usdtAsset({equityUsd:190,availableMarginUsd:190})],cashFlows:[cashFlow('dep_1',100)],positions:[],pending:[]});
    expect(deposited.equityUsd).toBe(190);
    expect(deposited.netExternalFlowUsd).toBe(100);
    expect(deposited.flowAdjustedEquityUsd).toBe(90);
    expect(deposited.drawdownPct).toBeCloseTo(0.1,12);
    expect(deposited.drawdownPct).toBeCloseTo(plain.drawdownPct,12);
    expect(deposited.complete&&plain.complete).toBe(true);
  });

  it('stacked deposits and a withdrawal net out to the same underlying performance',()=>{
    const row=buildPortfolioRiskSnapshot({riskGeneration:1,now:NOW,peakEquityUsd:100,assets:[usdtAsset({equityUsd:240,availableMarginUsd:240})],
      cashFlows:[cashFlow('dep_1',100),cashFlow('dep_2',50),cashFlow('wit_1',-10)],positions:[],pending:[]});
    expect(row.netExternalFlowUsd).toBe(140);
    expect(row.flowAdjustedEquityUsd).toBeCloseTo(100,9);
    expect(row.drawdownPct).toBeCloseTo(0,12);
    const withdrawal=buildPortfolioRiskSnapshot({riskGeneration:1,now:NOW,peakEquityUsd:100,assets:[usdtAsset({equityUsd:90,availableMarginUsd:90})],
      cashFlows:[cashFlow('wit_1',-10)],positions:[],pending:[]});
    expect(withdrawal.flowAdjustedEquityUsd).toBe(100);
    expect(withdrawal.drawdownPct).toBeCloseTo(0,12);
  });

  it('the drawdown limit still binds after the deposit is stripped out',()=>{
    const row=buildPortfolioRiskSnapshot({riskGeneration:1,now:NOW,peakEquityUsd:100,assets:[usdtAsset({equityUsd:190,availableMarginUsd:190})],
      cashFlows:[cashFlow('dep_1',100)],positions:[position()],pending:[]});
    expect(row.exposures).toHaveLength(1);
    const result=stressOf(row,{profile:profile({maxDrawdownPct:0.05})});
    expect(result.limitingConstraints).toContain('MAX_DRAWDOWN');
    expect(result.admissionAllowed).toBe(false);
  });

  it('an unverified flow is a blocker, so its flattering zero drawdown cannot be used',()=>{
    const row=buildPortfolioRiskSnapshot({riskGeneration:1,now:NOW,peakEquityUsd:100,assets:[usdtAsset({equityUsd:190,availableMarginUsd:190})],
      cashFlows:[cashFlow('dep_1',100,'UNKNOWN')],positions:[position()],pending:[]});
    expect(row.blockers).toContain('CASH_FLOW_UNVERIFIED:dep_1');
    expect(row.netExternalFlowUsd).toBe(0);
    expect(row.drawdownPct).toBe(0);
    expect(row.complete).toBe(false);
    expect(stressOf(row).admissionAllowed).toBe(false);
    expect(capacityOf(row).executable).toBe(false);
  });

  it('duplicate or blank flow ids are rejected rather than double counted',()=>{
    const duplicated=buildPortfolioRiskSnapshot({riskGeneration:1,now:NOW,peakEquityUsd:100,assets:[usdtAsset({equityUsd:190,availableMarginUsd:190})],
      cashFlows:[cashFlow('dep_1',100),cashFlow('dep_1',100)],positions:[],pending:[]});
    expect(duplicated.blockers).toContain('CASH_FLOW_ID_INVALID:dep_1');
    expect(duplicated.complete).toBe(false);
    const blank=buildPortfolioRiskSnapshot({riskGeneration:1,now:NOW,peakEquityUsd:100,assets:[usdtAsset({equityUsd:90,availableMarginUsd:90})],
      cashFlows:[cashFlow('  ',100)],positions:[],pending:[]});
    expect(blank.blockers).toContain('CASH_FLOW_ID_INVALID:EMPTY');
    expect(blank.complete).toBe(false);
  });

  it('an unusable peak fails to the worst drawdown, not to zero',()=>{
    for(const peak of [0,-100,Number.NaN]){
      const row=buildPortfolioRiskSnapshot({riskGeneration:1,now:NOW,peakEquityUsd:peak,assets:[usdtAsset({equityUsd:190,availableMarginUsd:190})],
        cashFlows:[cashFlow('dep_1',100)],positions:[position()],pending:[]});
      expect(row.blockers,`${peak}`).toContain('PEAK_EQUITY_INVALID');
      expect(row.drawdownPct,`${peak}`).toBe(1);
      expect(row.complete).toBe(false);
      expect(stressOf(row,{profile:profile({maxDrawdownPct:0})}).admissionAllowed).toBe(false);
    }
  });
});

describe('S05 hostile extras',()=>{
  it('a CLOSED label over a non-zero quantity is a conflict and keeps its notional',()=>{
    const row=snapshotOf([position({ownerState:'CLOSED'})]);
    expect(row.blockers).toContain(`CLOSED_POSITION_HAS_RISK:${BTC_SCOPE}|cycle_1`);
    expect(row.exposures[0].factStatus).toBe('CONFLICT');
    expect(row.exposures[0].notionalUsd).toBe(1_000);
    expect(row.grossNotionalUsd).toBe(1_000);
    expect(row.complete).toBe(false);
    expect(stressOf(row).admissionAllowed).toBe(false);
    const flat=snapshotOf([position({ownerState:'CLOSED',quantity:0})]);
    expect(flat.complete).toBe(true);
    expect(flat.grossNotionalUsd).toBe(0);
  });

  it('contradictory facts for one scope and cycle conflict at the larger quantity',()=>{
    const row=snapshotOf([position({quantity:10}),position({quantity:12})]);
    expect(row.blockers).toContain(`POSITION_FACT_CONFLICT:${BTC_SCOPE}|cycle_1`);
    expect(row.blockers).toContain(`POSITION_FACT_UNVERIFIED:${BTC_SCOPE}|cycle_1`);
    expect(row.exposures).toHaveLength(1);
    expect(row.exposures[0].factStatus).toBe('CONFLICT');
    expect(row.exposures[0].notionalUsd).toBe(1_200);
    expect(row.exposures[0].marginUsd).toBe(120);
    expect(row.grossNotionalUsd).toBe(1_200);
    expect(row.complete).toBe(false);
    expect(stressOf(row).admissionAllowed).toBe(false);
  });

  it('invalid position facts cannot be scored as zero risk',()=>{
    const badFacts:Partial<PortfolioPositionFact>[]=[{quantity:Number.NaN},{quantity:-5},{markPrice:0},{markPrice:Number.NaN},{leverage:0},{leverage:Number.NaN},{symbol:'   '},{side:'BOTH' as never}];
    for(const over of badFacts){
      const row=snapshotOf([position(over)]);
      expect(row.blockers.some(code=>code.startsWith('POSITION_FACT_INVALID:')),JSON.stringify(over)).toBe(true);
      expect(row.complete,JSON.stringify(over)).toBe(false);
      expect(stressOf(row).admissionAllowed,JSON.stringify(over)).toBe(false);
    }
  });

  it('unmapped underlyings collapse into one correlated bucket instead of scattering',()=>{
    const result=stressOf(btcEthSnapshot(),{correlation:correlation({clusters:{}})});
    expect(Object.keys(result.clusterNotional)).toEqual(['UNMAPPED_CORRELATED']);
    expect(result.clusterNotional.UNMAPPED_CORRELATED).toBe(2_000);
    expect(result.scenarios[0].correlationPenaltyUsd).toBeGreaterThan(0);
    const partial=stressOf(btcEthSnapshot(),{correlation:correlation({clusters:{BTC:'MAJORS'}})});
    expect(partial.clusterNotional).toEqual({MAJORS:1_000,UNMAPPED_CORRELATED:1_000});
    expect(partial.scenarios[0].correlationPenaltyUsd).toBe(0);
  });

  it('identical facts in a different array or key order produce the same snapshot hash',()=>{
    const positions=[position(),position({symbol:'ETHUSDT',scope:ETH_SCOPE,cycleId:'cycle_2'})];
    const pending=[pendingRisk(),pendingRisk({id:'ord_2',dedupeKey:'reserve_eth_2',symbol:'ETHUSDT',notionalUsd:80,marginUsd:8})];
    const cashFlows=[cashFlow('dep_1',100),cashFlow('wit_1',-10)];
    const assets=[usdtAsset(),usdtAsset({asset:'USDC',equityUsd:100,availableMarginUsd:200})];
    const build=(ordered:boolean)=>buildPortfolioRiskSnapshot({riskGeneration:7,now:ordered?NOW:NOW+5_000,peakEquityUsd:10_000,
      assets:ordered?assets:assets.map(reorder).reverse(),cashFlows:ordered?cashFlows:cashFlows.map(reorder).reverse(),
      positions:ordered?positions:positions.map(reorder).reverse(),pending:ordered?pending:pending.map(reorder).reverse()});
    const a=build(true),b=build(false);
    expect(a.snapshotHash).toBe(b.snapshotHash);
    expect(a.snapshotHash).toMatch(/^v396r[0-9a-f]{8}$/);
    expect(build(true).snapshotHash).toBe(a.snapshotHash);
    expect(snapshotOf([position()]).snapshotHash).not.toBe(snapshotOf([position({quantity:11})]).snapshotHash);
    expect(snapshotOf([position()]).snapshotHash).not.toBe(snapshotOf([position({ownerState:'HUMAN_MANAGED',handoffAt:NOW})]).snapshotHash);
    expect(snapshotOf([position()],[],{riskGeneration:2}).snapshotHash).not.toBe(snapshotOf([position()],[],{riskGeneration:3}).snapshotHash);
  });

  it('tighter budgets and larger books never widen admission',()=>{
    const loose=stressOf(btcSnapshot());
    const tightened=stressOf(btcSnapshot(),{profile:profile({maxCapitalAtRiskUsd:50,maxStressLossUsd:10})});
    const grown=stressOf(sixPositionSnapshot(),{correlation:sixClusterCorrelation()});
    expect(loose.admissionAllowed).toBe(true);
    expect(tightened.admissionAllowed).toBe(false);
    expect(grown.admissionAllowed).toBe(false);
    expect(tightened.admissionAllowed&&!loose.admissionAllowed).toBe(false);
    expect(grown.admissionAllowed&&!loose.admissionAllowed).toBe(false);
    expect(tightened.limitingConstraints).toEqual(expect.arrayContaining(['MAX_CAPITAL_AT_RISK','MAX_STRESS_LOSS']));
    expect(grown.limitingConstraints).toEqual(expect.arrayContaining(['MAX_GROSS_NOTIONAL','MAX_CAPITAL_AT_RISK','MAX_CLUSTER_NOTIONAL','MAX_DIRECTION_NOTIONAL']));
    expect(stressOf(btcSnapshot()).admissionAllowed).toBe(true);
  });

  it('the S05 modules stay pure and unwired',()=>{
    const files=['portfolioRiskSnapshot.ts','portfolioStress.ts','humanCapacityPolicy.ts'];
    for(const file of files){
      const source=readFileSync(new URL(`./${file}`,import.meta.url),'utf8');
      expect(source,file).not.toMatch(/^\s*import (?!type)/m);
      expect(source,file).not.toMatch(/node:|fetch|axios|WebSocket|DatabaseSync|settingsStore|placeEntry|placeTakeProfit|placeManualOrder|submitOrder|\.reserve\(/);
      expect(source,file).not.toMatch(/from '@zdj\/(contracts|core)'/);
    }
    const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
    const pattern=`from *'\\./(${files.map(name=>name.split('.')[0]).join('|')})\\.js'`;
    const consumers=execFileSync('git',['grep','-l','--untracked','-E',pattern,'--','apps','packages'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean).sort();
    expect(consumers).toEqual([
      'apps/engine/src/services/humanCapacityPolicy.ts',
      'apps/engine/src/services/portfolioStress.ts',
      'apps/engine/src/services/s05PortfolioTailRisk.test.ts',
    ].sort());
    const joined=files.map(name=>readFileSync(join(root,'apps','engine','src','services',name),'utf8')).join('\n');
    expect(joined).not.toMatch(/ACCEPTED|selfSign|deploy|restart/i);
  });
});
