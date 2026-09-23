import {harness} from './tradingQualityTestHarness.js';
import {describe,it,expect,vi} from 'vitest';
import {PortfolioRiskAdmission} from './portfolioRiskLedger.js';
import {EngineRuntime} from '../runtime/appRuntime.js';
import {RuntimeState} from '../state/runtimeState.js';
import {EntryCoordinator} from './entryCoordinator.js';
import {EventBus} from '../events/eventBus.js';
function risk(asset:any={asset:'USDT',walletBalance:100,availableBalance:90,usdValue:100},position:any=null){
 const now=Date.now(),state=new RuntimeState({riskGovernance:{portfolioRisk:{configured:false}},portfolio:{maxPositions:50}} as any);
 state.account={...state.account,status:'READY',asOf:now,equityUsd:100,assets:[asset],enrichment:{valuationAsOf:now}} as any;
 if(position)state.positions.set('p',{id:'p',symbol:'BTCUSDC',side:'LONG',cycleId:'c',quantity:1,markPrice:10,leverage:2,liquidationPrice:5,maintenanceMarginUsd:.1,...position} as any);
 const service=new PortfolioRiskAdmission({state,identity:()=>({environment:'TESTNET',account:'a'}),ownerOf:()=>({ownerState:'HUMAN_MANAGED',handoffAt:now,acknowledgedAt:now}),cashFlows:()=>[{id:'coverage',amountUsd:0,factStatus:'VERIFIED'}],profile:()=>state.settings.riskGovernance.portfolioRisk});
 return {state,service,now};
}
describe('final activation independent analysis and write authorities',()=>{
 it('dispatches the real analysis tick in READ_ONLY without an exchange loop',async()=>{
  const processPool=vi.fn(async()=>{}),fake:any={state:{settings:{connections:{executionMode:'READ_ONLY',exchange:{environment:'TESTNET'}}}},runtimeControl:{canDispatch:()=>true},entry:{processPool}};
  await (EngineRuntime.prototype as any).dispatchAnalysisTick.call(fake);expect(processPool).toHaveBeenCalledOnce();
 });
 it('refuses production analysis and does not dispatch through a closed fact gate',async()=>{
  const processPool=vi.fn(),fake:any={state:{settings:{connections:{executionMode:'READ_ONLY',exchange:{environment:'PRODUCTION'}}}},runtimeControl:{canDispatch:()=>true},entry:{processPool}};
  await (EngineRuntime.prototype as any).dispatchAnalysisTick.call(fake);expect(processPool).not.toHaveBeenCalled();
 });
 it('does not resume pending execution waits in READ_ONLY',async()=>{
  const s=new RuntimeState({connections:{executionMode:'READ_ONLY',exchange:{environment:'TESTNET'}},riskGovernance:{},portfolio:{maxPendingEntries:1}} as any),e:any=new EntryCoordinator(s,{} as any,{setIdleContext:vi.fn()} as any,{} as any,new EventBus());
  s.executionGovernance={mode:'AUTO_RUNNING'} as any;s.runtimeControl.mode='RUNNING';e.resumeExecutionWaits=vi.fn();e.state.pool.replenish=()=>{};e.state.pool.refreshReadyView=()=>{};e.state.pool.readyList=()=>[];e.state.activeEntrySymbols=()=>new Set(['busy']);
  await e.processPool();expect(e.resumeExecutionWaits).not.toHaveBeenCalled();
 });
});
describe('authoritative profile and real units',()=>{
 it('does not call an incomplete profile a complete pre-trade fact set',()=>{const x=risk();expect(x.service.preTradeFacts(x.now).complete).toBe(false);});
 it('versions all profile authority including maintenance rate',()=>{const x=risk();const a=x.service.preTradeFacts(x.now).profileVersion;(x.state.settings.riskGovernance.portfolioRisk as any).maintenanceMarginRatePct=.01;expect(x.service.preTradeFacts(x.now).profileVersion).not.toBe(a);});
 it('does not label an unknown USDC margin asset USDT',()=>{const x=risk(undefined,{marginAsset:null});const r=x.service.refresh(x.now);expect(r.snapshot.exposures[0]?.marginAsset).not.toBe('USDT');expect(r.blockers).toContain('POSITION_MARGIN_ASSET_UNPROVEN');});
 it('converts BTC 0.01 with fresh valuation, not into 0.01 dollars',()=>{const x=risk({asset:'BTC',walletBalance:.01,availableBalance:.01,usdValue:870});const r=x.service.refresh(x.now);expect(r.snapshot.assets[0]?.availableMarginUsd).toBe(870);});
 it('keeps a stale BTC rate UNKNOWN',()=>{const x=risk({asset:'BTC',walletBalance:.01,availableBalance:.01,usdValue:870});(x.state.account as any).enrichment.valuationAsOf=x.now-3600000;expect(x.service.refresh(x.now).coverage.assets).toBe('UNVERIFIED');});
 it.each(['USDT','USDC'])('preserves explicit stable asset units for %s',asset=>{const x=risk({asset,walletBalance:100,availableBalance:90,usdValue:100});expect(x.service.refresh(x.now).snapshot.assets[0]?.availableMarginUsd).toBe(90);});
});

describe('real coordinator analysis-only terminal path',()=>{
 it.each(['PLACE_LONG','REJECT_CANDIDATE','WAIT_FOR_PRICE'])('keeps %s model evidence and persists only a SYSTEM WAIT with no write',async decision=>{
  const h=harness();h.state.settings.connections.executionMode='READ_ONLY';
  const service=new PortfolioRiskAdmission({state:h.state,identity:()=>({environment:'TESTNET',account:'a'}),ownerOf:()=>null,cashFlows:()=>[],profile:()=>h.state.settings.riskGovernance.portfolioRisk});
  (h.state as any).riskAdmission=service;
  h.ai.decide.mockResolvedValue({runId:'readonly-natural-fixture',decision:{...h.supplied,decision,tradeSide:'LONG',reason:'fixture thesis'}} as any);
  await h.run();
  expect(h.ai.decide).toHaveBeenCalledOnce();
  expect(h.events.some(e=>e.type==='ANALYSIS_ONLY_COMPLETED'),JSON.stringify(h.events.filter(e=>e.type==='ENTRY_ANALYSIS_FAILED'))).toBe(true);
  expect(h.events.find(e=>e.type==='PORTFOLIO_RISK_ADMISSION_EVALUATED')?.payload).toMatchObject({allowed:false,analysisOnly:true,scope:'CURRENT_BOOK'});
  expect(h.state.tradePlans.size).toBe(1);const plan=[...h.state.tradePlans.values()][0]!;
  expect(plan).toMatchObject({side:'WAIT',quantityUnits:0,immutable:true,provenance:{source:'SYSTEM',modelRunId:'readonly-natural-fixture'}});
  expect(plan.thesis).toContain(decision);expect(plan.releaseCondition).toContain('EXCHANGE_WRITE_LOCKED');
  expect(h.state.putTradePlan({...plan,thesis:'tampered'} as any).written).toBe(false);
  expect(h.state.putTradePlan({...plan,planVersion:plan.planVersion+1,thesis:'tampered with higher version'} as any).written).toBe(false);
  expect(h.state.entryReservations.size).toBe(0);expect(h.state.entryIntents.size).toBe(0);expect(h.state.entryOrders.size).toBe(0);
  expect(h.exchange.setLeverage).not.toHaveBeenCalled();expect(h.exchange.placeEntry).not.toHaveBeenCalled();expect(h.exchange.cancelEntry).not.toHaveBeenCalled();
 });
});
