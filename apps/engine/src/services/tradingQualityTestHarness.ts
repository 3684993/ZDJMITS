import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {EntryIntelligencePacketSchema,MarketSymbolSnapshotSchema,SystemSettingsSchema,UniverseCandidateSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {RuntimeState} from '../state/runtimeState.js';
import {installDeterministicAdmission} from '../testing/deterministicRiskAdmission.js';
import {EventBus} from '../events/eventBus.js';
import {EntryCoordinator} from './entryCoordinator.js';
import {DirectionPolicyService} from './directionPolicyService.js';
import {UniverseCoordinator,canonicalBlacklistValue} from './universeCoordinator.js';
import {brainParse,rawIntent} from './aiFabric.js';
import {redactAudit} from '../api/projections.js';
import {terminalDecision,observedOutcome} from './decisionEpisodeFacts.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/v363-entry.json',import.meta.url),'utf8'));

export function harness(raw?:any) {
  const f=structuredClone(fixtures[0]),packet=EntryIntelligencePacketSchema.parse(f.packet),now=Date.now();
  packet.market.quote.ts=now;packet.market.orderBook.ts=now;packet.createdAt=now;packet.expiresAt=now+300_000;
  // The unit harness supplies explicit closed-bar identity for the mandate's 1D/4H/15m thesis.
  for(const timeframe of ['1d','4h','15m'] as const){const card=(packet.market.technical as any)[timeframe];if(card)card.lastClosedBar={openTime:now-60_000,closeTime:now-1_000,open:packet.market.quote.last,high:packet.market.quote.last,low:packet.market.quote.last,close:packet.market.quote.last,volume:1};}
  const settings=SystemSettingsSchema.parse({...defaults,appearance:{...defaults.appearance,theme:'BINANCE_NOIR'}});settings.connections.executionMode='TESTNET_ENABLED';
  // Fixtures explicitly choose a small positive business margin; production values are never inferred.
  settings.entry.minimumInitialMarginByQuote.USDT=.01;
  settings.entry.nearMarket.enabled=false; // Archived V3.7 fixtures have no trade-tick stream; V3.9 has separate evidence tests.
  settings.selection.assetDirectory={...settings.selection.assetDirectory,version:'V3.9.1-fixture',methodVersion:'V3.9.1-LIQUIDITY-30D-V4',reviewedAt:now-1,nextReviewAt:now+86_400_000,evidenceHash:'fixture-evidence',approvedLiquid:[...new Set([...settings.selection.assetDirectory.approvedLiquid,'4'])],approvals:{...settings.selection.assetDirectory.approvals,'4':{symbol:'4USDT',reason:'FIXTURE_V4_APPROVAL',reviewedAt:now,quoteVolumeUsd24h:100_000_000,medianDailyQuoteVolumeUsd30d:100_000_000,tradeCount24h:100_000,openInterestUsd:10_000_000,listingAgeDays:400,liquidityComposite:.9}}};
  const state=new RuntimeState(settings);installDeterministicAdmission(state);state.runtimeControl.entrySafetyMode='AUTO';Object.assign(state.runtimeControl.capital,{generation:1,evaluatedAt:Date.now(),capitalVersion:`capital-fixture-${Date.now()}`,nextRecheckAt:Date.now()+300_000});state.runtimeControl.capital.routedCandidates=[{symbol:packet.symbol,underlying:packet.symbol.replace(/USD[TC]$/,''),quoteAsset:'USDT',marginUsd:200,leverage:20,admission:'ALLOW',reason:'fixture',longExecutable:true,shortExecutable:true,longFeasibleNotionalUsd:4000,shortFeasibleNotionalUsd:4000,minExecutableNotionalUsd:5} as any];state.executionGovernance={...state.executionGovernance,mode:'AUTO_RUNNING',reason:'TESTNET_CAPITAL_AVAILABLE_AUTO'};
  state.account={...state.account,status:'READY',asOf:Date.now(),equityUsd:10000,assets:[{asset:'USDT',availableBalance:10000,usdValue:10000}]};
  state.snapshots.set(packet.symbol,MarketSymbolSnapshotSchema.parse({...packet.market,symbol:packet.symbol,dataCompleteness:packet.evidenceCompleteness}));
  state.universe=[UniverseCandidateSchema.parse({...packet.selection,symbol:packet.symbol,lifecycle:'READY',eligible:true,exclusionReasons:[],quoteVolumeUsd24h:packet.market.quote.quoteVolumeUsd24h,spreadBps:1,lastPrice:packet.market.quote.last,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:now})];
  const q=packet.market.quote;
  const supplied=raw??{...f.normalized,decision:'PLACE_LONG',direction:'LONG',confidence:.8,idealPrice:q.bid,acceptablePriceRange:{min:q.bid-q.tickSize*10,max:q.ask+q.tickSize*10},horizonMinutes:3,reachability:.8,reason:'ISOLATED_CONTRACT_PLACE'};
  const bus=new EventBus(),events:any[]=[];bus.on('event',e=>events.push(e));
  const ai={scout:vi.fn(async()=>null),hasCapacity:()=>true,decide:vi.fn(async(..._args:any[])=>({decision:brainParse(supplied,packet),runId:'fixture-run'}))};
  const exchange={setLeverage:vi.fn(async()=>{}),placeEntry:vi.fn(async(order:any)=>({...order,status:'WORKING'})),findEntryByClientOrderId:vi.fn(async(_order?:any)=>null),cancelEntry:vi.fn(async(order:any)=>({...order,status:'CANCELED'}))};
  const coordinator=new EntryCoordinator(state,{build:()=>packet} as never,ai as never,exchange as never,bus);
  return {state,packet,ai,exchange,events,bus,coordinator,supplied,run:()=> (coordinator as any).analyze(packet.symbol)};
}
