import {describe,expect,it} from 'vitest';
import {RuntimeState} from '../state/runtimeState.js';
import {PortfolioRiskAdmission} from './portfolioRiskLedger.js';
import {executionScope} from './executionLifecycle.js';
import {SettingsStore} from '../config/settingsStore.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';

/**
 * J2 acceptance: the portfolio admission is the single authority for new risk. Every case below is
 * an attempt to get a reservation without a proven snapshot, or to make the snapshot look better
 * than the facts are.
 */

const ROOT=path.resolve(fileURLToPath(new URL('../../../..',import.meta.url)));
const dirs:string[]=[];
const tempDir=()=>{const dir=mkdtempSync(path.join(tmpdir(),'zdj-v396-j2-'));dirs.push(dir);return dir;};
const identity={environment:'TESTNET',account:'binance-primary'};
const any=(value:unknown)=>value as any;

const profile=(over:Record<string,any>={})=>({
  configured:true,marginTierVersion:'bracket-table-2026-09',maintenanceMarginRatePct:.005,correlationVersion:'corr-2026-09',scenarioVersion:'scn-2026-09',
  maxCapitalAtRiskUsd:600,maxDrawdownPct:.2,maxStressLossUsd:900,maxGrossNotionalUsd:6_000,maxDirectionNotionalUsd:4_000,maxClusterNotionalUsd:3_000,
  minMarginBufferPct:.2,minLiquidationBufferPct:.01,maxHumanPositions:6,maxHumanNotionalUsd:6_000,maxPendingHandoffs:4,maxAckAgeMs:8*3_600_000,
  snapshotTtlMs:20_000,cashFlowWindowMs:86_400_000,cashFlowMaxAgeMs:900_000,
  clusters:{BTC:'MAJOR',ETH:'MAJOR',SOL:'SOLANA'},
  scenarios:[{id:'shock10',priceShockPct:.10,spreadWidenPct:.01,fundingShockPct:.001,markBasisShockPct:.005,depthPenaltyPct:.01,exchangeUnavailable:false,unavailablePenaltyPct:0,clusterConvergencePct:.25},
    {id:'gap15',priceShockPct:-.15,spreadWidenPct:.02,fundingShockPct:.002,markBasisShockPct:.01,depthPenaltyPct:.02,exchangeUnavailable:true,unavailablePenaltyPct:.03,clusterConvergencePct:.4}],
  ...over,
});

function build(over:{profile?:Record<string,any>|null;positions?:any[];cashFlows?:any[];account?:any;reserve?:boolean}={}){
  const now=Date.now();
  const settings:any={portfolio:{maxPositions:10},riskGovernance:{portfolioRisk:over.profile===null?{configured:false}:profile(over.profile??{})}};
  const state=new RuntimeState(any(settings));
  state.account={...state.account,status:'READY',asOf:now,equityUsd:10_000,assets:[{asset:'USDT',walletBalance:10_000,availableBalance:9_000,usdValue:10_000}],
    riskBaseline:{startingEquityUsd:11_000,currentEquityUsd:10_000,riskDrawdownPct:.09},...(over.account??{})};
  state.runtimeControl={...state.runtimeControl,capital:{generation:7,evaluatedAt:now,capitalVersion:'capital-j2',nextRecheckAt:now+300_000}} as never;
  for(const position of over.positions??[])state.positions.set(position.id,position);
  const owners=new Map<string,{ownerState:any;handoffAt:number|null;acknowledgedAt:number|null}>();
  const reservations=(over.reserve??true)?[]:[];
  const admission=new PortfolioRiskAdmission({state,identity:()=>identity,
    ownerOf:(scope,cycleId)=>owners.get(`${scope}|${cycleId}`)??null,
    cashFlows:()=>over.cashFlows===undefined?[{id:`coverage:${now}`,amountUsd:0,factStatus:'VERIFIED'}]:over.cashFlows,
    profile:()=>(state.settings.riskGovernance as any).portfolioRisk??{}});
  const bind=(scope:string,cycleId:string,ownerState:string,extra={})=>owners.set(`${scope}|${cycleId}`,{ownerState,handoffAt:now-1_000,acknowledgedAt:null,...extra});
  state.entryRiskGate=(input:any)=>admission.gate(input);
  (state as any).riskAdmission=admission;
  return {now,state,admission,bind,owners,reservations,
    position:(id:string,symbol:string,side:'LONG'|'SHORT',quantity:number,markPrice:number,extra={})=>({id,symbol,side,quantity,markPrice,entryPrice:markPrice,leverage:10,
      openedAt:now-60_000,firstObservedAt:now-60_000,cycleId:`cycle_${id}`,liquidationPrice:markPrice*.85,marginAsset:'USDT',notionalUsd:quantity*markPrice,maintenanceMarginUsd:quantity*markPrice*.005,...extra}),
    reserve:(c:any,ticket:any)=>state.reserveEntry({underlying:String(c.symbol).replace(/(USDT|USDC|BUSD)$/,''),quoteAsset:c.quoteAsset,marginUsd:c.marginUsd,notionalUsd:c.notionalUsd,
      planId:c.planId,maxPositions:10,ttlSeconds:120,leaseSeconds:60,maxConcurrentReservations:10,riskCapitalVersion:'capital-j2',
      riskGeneration:ticket?.riskGeneration,riskTicket:ticket,admissionCandidate:c})};
}

const candidate=(over:Record<string,any>={}):any=>({symbol:'BTCUSDT',side:'LONG',quoteAsset:'USDT',notionalUsd:500,marginUsd:50,leverage:10,markPrice:100,planId:'plan_j2_1',intentId:null,...over});

describe('J2 portfolio admission is the only risk authority',()=>{
  it('refuses new risk while the profile is unconfigured, and never invents a tradable number',()=>{
    const x=build({profile:null});
    const decision=x.admission.admit(candidate(),x.now);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('RISK_PROFILE_UNCONFIGURED');
    expect(decision.ticket).toBeNull();
    expect(x.reserve(candidate(),null).ok).toBe(false);
  });

  it('refuses on every missing fact class: margin tier, cash flow, fresh account, stale asset rate',()=>{
    const noTier=build({profile:{marginTierVersion:'',maintenanceMarginRatePct:null}});
    expect(noTier.admission.admit(candidate(),noTier.now).reasons).toContain('MARGIN_TIER_UNPROVEN');
    const noFlow=build({cashFlows:[]});
    expect(noFlow.admission.admit(candidate(),noFlow.now).reasons).toContain('CASH_FLOW_COVERAGE_UNPROVIDED');
    const stale=build({account:{asOf:Date.now()-3_600_000,status:'READY'}});
    expect(stale.admission.admit(candidate(),stale.now).reasons).toContain('PRIVATE_ACCOUNT_NOT_FRESH');
    const noRate=build({account:{assets:[{asset:'BTC',walletBalance:1,availableBalance:1,usdValue:null}]}});
    expect(noRate.admission.admit(candidate(),noRate.now).reasons.join('|')).toMatch(/ACCOUNT_ASSET_UNVERIFIED|ACCOUNT_EQUITY_UNPROVEN/);
    const noScenario=build({profile:{scenarios:[]}});
    expect(noScenario.admission.admit(candidate(),noScenario.now).reasons.join('|')).toMatch(/STRESS_SCENARIO_SET_UNPROVEN|STRESS_SCENARIOS_INVALID/);
  });

  it('S05-T05 a position without proven margin composition blocks admission instead of being assumed safe',()=>{
    const x=build();
    const position={id:'p1',symbol:'BTCUSDT',side:'LONG',quantity:1,markPrice:100,entryPrice:100,leverage:10,openedAt:x.now-60_000,cycleId:'cycle_p1',liquidationPrice:null,maintenanceMarginUsd:null,marginAsset:'USDT'};
    x.state.positions.set('p1',any(position));
    x.bind(executionScope(identity.environment,identity.account,'BTCUSDT','LONG'),'cycle_p1','AI_ACTIVE');
    const decision=x.admission.admit(candidate(),x.now);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join('|')).toMatch(/MAINTENANCE_MARGIN_UNPROVEN|LIQUIDATION_BUFFER_UNPROVEN/);
  });

  it('S05-T01 handing a cycle to a human does not reduce exposure or free capacity',()=>{
    const x=build();
    const scope=executionScope(identity.environment,identity.account,'BTCUSDT','LONG');
    const position=x.position('p1','BTCUSDT','LONG',10,100);
    x.state.positions.set('p1',any(position));
    x.bind(scope,'cycle_p1','AI_ACTIVE');
    const ai=x.admission.admit(candidate(),x.now);
    x.bind(scope,'cycle_p1','HUMAN_MANAGED');
    const human=x.admission.admit(candidate(),x.now);
    expect(ai.snapshot.grossNotionalUsd).toBe(human.snapshot.grossNotionalUsd);
    expect(ai.snapshot.capitalAtRiskUsd).toBe(human.snapshot.capitalAtRiskUsd);
    expect(human.capacity.humanManagedPositions).toBe(1);
    expect(ai.snapshot.snapshotHash).not.toBe(human.snapshot.snapshotHash);
  });

  it('S05-T02 one underlying across two quotes and a duplicated lineage counts the risk once',()=>{
    const x=build();
    const btc=executionScope(identity.environment,identity.account,'BTCUSDT','LONG');
    x.state.positions.set('p1',any(x.position('p1','BTCUSDT','LONG',10,100)));
    x.state.positions.set('p2',any(x.position('p2','BTCUSDT','LONG',10,100,{cycleId:'cycle_p2',marginAsset:'USDC'})));
    x.state.entryReservations.set('r1',any({id:'r1',underlying:'BTC',quoteAsset:'USDT',marginUsd:50,notionalUsd:500,status:'RESERVED',expiresAt:x.now+60_000}));
    x.state.entryReservations.set('r1-again',any({id:'r1',underlying:'BTC',quoteAsset:'USDT',marginUsd:50,notionalUsd:500,status:'RESERVED',expiresAt:x.now+60_000}));
    x.bind(btc,'cycle_p1','AI_ACTIVE');x.bind(btc,'cycle_p2','AI_ACTIVE');
    const decision=x.admission.admit(candidate(),x.now);
    const grouped=decision.snapshot.underlying.find(row=>row.underlying==='BTC');
    expect(grouped?.longNotionalUsd).toBeGreaterThan(0);
    expect(decision.snapshot.exposures.filter(row=>row.kind==='PENDING'&&String(row.id).startsWith('pending:reservation'))).toHaveLength(1);
    expect(decision.snapshot.exposures.filter(row=>String(row.id).startsWith('pending:candidate'))).toHaveLength(0);
    // two live cycles plus the planned candidate row
    expect(decision.snapshot.exposures.filter(row=>row.kind==='POSITION')).toHaveLength(3);
  });

  it('S05-T03 two candidates sharing one snapshot version cannot both claim the risk',()=>{
    const x=build();
    const first=x.admission.admit(candidate({planId:'plan_a',symbol:'ETHUSDT',side:'SHORT',notionalUsd:120,marginUsd:12}),x.now);
    const second=x.admission.admit(candidate({planId:'plan_b',notionalUsd:120,marginUsd:12}),x.now);
    expect([first.reasons,second.reasons],[first.reasons,second.reasons].flat().join(',')).toEqual([[],[]]);
    const ethA=candidate({planId:'plan_a',symbol:'ETHUSDT',side:'SHORT',notionalUsd:120,marginUsd:12,markPrice:2000});
    const ethB=candidate({planId:'plan_b',notionalUsd:120,marginUsd:12});
    expect(x.reserve(ethA,first.ticket).ok,JSON.stringify(x.reserve(ethA,first.ticket))).toBe(true);
    const replay=x.reserve(ethB,second.ticket);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe('RISK_SNAPSHOT_CHANGED');
    expect(x.state.entryReservations.size).toBe(1);
    const fresh=x.admission.admit(ethB,x.now);
    expect(fresh.ticket?.snapshotHash).not.toBe(second.ticket?.snapshotHash);
    const reused=x.reserve(ethB,first.ticket);
    expect(reused.reason).toBe('RISK_TICKET_CANDIDATE_MISMATCH');
  });

  it('a reservation keeps its durable binding and the next admission sees the occupied risk',()=>{
    const x=build();
    const base=candidate();
    const ticket=x.admission.admit(base,x.now).ticket;
    expect(x.reserve(base,ticket).ok).toBe(true);
    const row=[...x.state.entryReservations.values()][0];
    expect(row.riskBinding.snapshotHash).toBe(ticket!.snapshotHash);
    expect(row.riskBinding.riskGeneration).toBe(ticket!.riskGeneration);
    expect(String(row.riskBinding.profileVersion)).toMatch(/^v396r[0-9a-f]{32,}$/);
    expect(row.riskBinding.factCoverage.cashFlow).toBe('VERIFIED');
    expect(Number(row.riskBinding.expiresAt)).toBeGreaterThan(x.now);
    expect(String(row.riskBinding.snapshotHash)).toMatch(/^v396r[0-9a-f]{64}$/);
    const after=x.admission.admit(candidate({planId:'plan_j2_2',notionalUsd:500,marginUsd:50}),x.now);
    expect(after.snapshot.pendingNotionalUsd).toBeGreaterThanOrEqual(500);
  });

  it('S05-T04 a worse scenario or a tighter budget can only reduce what is admitted',()=>{
    const base=build();
    expect(base.admission.admit(candidate(),base.now).allowed).toBe(true);
    const converged=build({profile:{maxStressLossUsd:100,scenarios:[{id:'converged',priceShockPct:.4,spreadWidenPct:.1,fundingShockPct:.05,markBasisShockPct:.05,depthPenaltyPct:.1,exchangeUnavailable:true,unavailablePenaltyPct:.1,clusterConvergencePct:1}]}});
    const worse=converged.admission.admit(candidate(),converged.now);
    expect(worse.allowed).toBe(false);
    expect(worse.reasons.join('|')).toMatch(/STRESS_LIMIT:MAX_STRESS_LOSS/);
    const tight=build({profile:{maxGrossNotionalUsd:100}});
    expect(tight.admission.admit(candidate(),tight.now).reasons.join('|')).toMatch(/STRESS_LIMIT:MAX_GROSS_NOTIONAL/);
    const widened=build({profile:{maxGrossNotionalUsd:100}});
    const held=widened.admission.admit(candidate(),widened.now);
    expect(held.reasons,JSON.stringify(held.reasons)).toContain('STRESS_LIMIT:MAX_GROSS_NOTIONAL');
    (widened.state.settings.riskGovernance as any).portfolioRisk.maxGrossNotionalUsd=100_000;
    const after=widened.admission.admit(candidate(),widened.now);
    expect(after.allowed).toBe(true);
    const staleTicket=widened.reserve(candidate(),held.ticket);
    expect(staleTicket.ok).toBe(false);
    expect(staleTicket.reason).toBe('RISK_TICKET_REQUIRED');
  });

  it('S05-T06 a full human backlog stops new entries but never withdraws protection',()=>{
    const x=build({profile:{maxHumanPositions:1,maxPendingHandoffs:0,maxAckAgeMs:60_000}});
    const scope=executionScope(identity.environment,identity.account,'BTCUSDT','LONG');
    x.state.positions.set('p1',any(x.position('p1','BTCUSDT','LONG',10,100)));
    x.bind(scope,'cycle_p1','HANDOFF_PENDING',{handoffAt:x.now-10});
    const decision=x.admission.admit(candidate(),x.now);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join('|')).toMatch(/HUMAN_PENDING_HANDOFF_LIMIT|HUMAN_POTENTIAL_SLOT_LIMIT/);
    expect(decision.capacity.protectionAllowed).toBe(true);
    x.bind(scope,'cycle_p1','HUMAN_MANAGED',{handoffAt:x.now-10,acknowledgedAt:x.now-5});
    expect(x.admission.admit(candidate(),x.now).reasons.join('|')).toMatch(/HUMAN_POTENTIAL_SLOT_LIMIT/);
  });

  it('S05-T07 a deposit cannot mask the drawdown, and an unknown transfer cannot be treated as zero',()=>{
    const deposit=build({cashFlows:[{id:'transfer-1',amountUsd:5_000,factStatus:'VERIFIED'}]});
    const admitted=deposit.admission.admit(candidate(),deposit.now);
    expect(admitted.snapshot.netExternalFlowUsd).toBe(5_000);
    expect(admitted.snapshot.flowAdjustedEquityUsd).toBe(5_000);
    expect(admitted.snapshot.drawdownPct).toBeCloseTo((11_000-5_000)/11_000,6);
    const unverified=build({cashFlows:[{id:'transfer-2',amountUsd:5_000,factStatus:'UNKNOWN'}]});
    expect(unverified.admission.admit(candidate(),unverified.now).reasons.join('|')).toMatch(/CASH_FLOW_UNVERIFIED|CASH_FLOW_COVERAGE_UNPROVIDED/);
  });

  it('S05-T08 only a real reduction of risk releases capacity',()=>{
    const x=build();
    const scope=executionScope(identity.environment,identity.account,'BTCUSDT','LONG');
    x.state.positions.set('p1',any(x.position('p1','BTCUSDT','LONG',10,100)));
    x.bind(scope,'cycle_p1','AI_ACTIVE');
    const withPosition=x.admission.admit(candidate({notionalUsd:4_000,marginUsd:400}),x.now);
    x.state.entryOrders.set('o1',any({id:'o1',symbol:'BTCUSDT',side:'SELL',quantity:10,price:100,status:'UNKNOWN',leverage:10,expiresAt:x.now+60_000}));
    const unknownExit=x.admission.admit(candidate({notionalUsd:4_000,marginUsd:400}),x.now);
    expect(unknownExit.snapshot.grossNotionalUsd).toBe(withPosition.snapshot.grossNotionalUsd+1_000);
    expect(unknownExit.snapshot.exposures.some(row=>row.kind==='PENDING'&&row.factStatus==='UNKNOWN')).toBe(true);
    expect(unknownExit.reasons.join('|')).toMatch(/STRESS_LIMIT|PENDING_RISK_UNVERIFIED|MAX_/);
    x.state.positions.delete('p1');
    const stillOpen=x.admission.admit(candidate({notionalUsd:4_000,marginUsd:400}),x.now);
    expect(stillOpen.snapshot.exposures.filter(row=>row.kind==='POSITION'&&!String(row.id).includes('|plan:'))).toHaveLength(0);
    expect(stillOpen.snapshot.pendingNotionalUsd).toBeGreaterThan(0);
  });

  it('a restart keeps the generation ordering but holds no live authority',()=>{
    const x=build();
    const scope=executionScope(identity.environment,identity.account,'BTCUSDT','LONG');
    x.state.positions.set('p1',any(x.position('p1','BTCUSDT','LONG',10,100)));
    x.bind(scope,'cycle_p1','AI_ACTIVE');
    const base=candidate({notionalUsd:400,marginUsd:40});
    const ticket=x.admission.admit(base,x.now).ticket;
    expect(x.reserve(base,ticket).ok).toBe(true);
    const persisted=x.admission.serialize();
    // A restart that cannot re-read who owns the cycle gets no authority from the persisted ledger.
    const restarted=new PortfolioRiskAdmission({state:x.state,identity:()=>identity,ownerOf:()=>null,cashFlows:()=>[{id:'coverage',amountUsd:0,factStatus:'VERIFIED'}],profile:()=>(x.state.settings.riskGovernance as any).portfolioRisk});
    restarted.restore(persisted);
    expect(restarted.state().snapshotHash).toBeNull();
    expect(restarted.state().generation).toBe(persisted.generation);
    const afterRestart=restarted.admit(candidate({notionalUsd:400,marginUsd:40}),x.now+1);
    expect(afterRestart.allowed).toBe(false);
    expect(afterRestart.reasons.join('|')).toMatch(/POSITION_FACT_UNVERIFIED/);
    expect(Number(restarted.state().generation)).toBeGreaterThanOrEqual(Number(persisted.generation));
    expect(restarted.admit(candidate({planId:'plan_other',notionalUsd:400,marginUsd:40}),x.now+2).ticket).toBeNull();
  });

  it('the ledger only advances when the underlying facts actually move',()=>{
    const x=build();
    const first=x.admission.admit(candidate(),x.now);
    const second=x.admission.admit(candidate(),x.now);
    expect(second.ticket?.riskGeneration).toBe(first.ticket?.riskGeneration);
    expect(second.ticket?.snapshotHash).toBe(first.ticket?.snapshotHash);
    x.state.positions.set('p1',any(x.position('p1','SOLUSDT','LONG',2,50)));
    x.bind(executionScope(identity.environment,identity.account,'SOLUSDT','LONG'),'cycle_p1','AI_ACTIVE');
    const third=x.admission.admit(candidate(),x.now+1);
    expect(third.ticket?.riskGeneration).toBeGreaterThan(second.ticket!.riskGeneration);
  });

  it('an expired ticket is refused even though the snapshot still looks fine',()=>{
    const x=build();
    const ticket=x.admission.admit(candidate(),x.now).ticket!;
    const base=candidate();
    const expired={...ticket,expiresAt:x.now-1};
    expect(x.reserve(base,expired).reason).toBe('RISK_TICKET_EXPIRED');
    expect(x.reserve(base,null).reason).toBe('RISK_TICKET_REQUIRED');
    expect(x.state.entryReservations.size).toBe(0);
  });

  it('the durable transaction still refuses a stale writer after an admission succeeds',async()=>{
    const dir=tempDir();
    try{
      const store=new SettingsStore(path.join(ROOT,'config'),dir);
      await store.load();
      const x=build();
      x.state.entryReservationTransaction=(revision:number,work:()=>unknown)=>store.mutateEntryReservations(revision,work);
      const base=candidate();
      const ticket=x.admission.admit(base,x.now).ticket!;
      expect(x.reserve(base,ticket).ok).toBe(true);
      x.state.entryReservationTransaction=(revision:number,work:()=>unknown)=>store.mutateEntryReservations(revision+1,work);
      const second=x.admission.admit(candidate({planId:'plan_j2_2',notionalUsd:300,marginUsd:30}),Date.now());
      expect(x.reserve(candidate({planId:'plan_j2_2',notionalUsd:300,marginUsd:30}),second.ticket).ok).toBe(false);
      store.close();
    }finally{try{rmSync(dir,{recursive:true,force:true});}catch{/* busy */}}
  });
});
