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
afterEach(()=>vi.restoreAllMocks());
function candidateDecision(packet:any,base:any,side:'LONG'|'SHORT'='LONG',candidateIndex=0,overrides:Record<string,unknown>={}){
  const rows=packet?.executionEnvelope?.[side]?.planCandidates??[],row=rows[Math.max(0,Math.min(rows.length-1,candidateIndex))];
  if(!row)throw new Error(`TEST_CANDIDATE_MISSING:${side}`);
  const quote=packet.market.quote,idealPrice=side==='LONG'?Number(quote.bid):Number(quote.ask);
  return brainParse({...base,schemaVersion:'V3.9.7',protocolVersion:'V3.9.7',decision:`PLACE_${side}`,tradeSide:side,direction:side,structureDirection:side,
    selectedCandidateId:row.candidateId,quantityUnits:null,idealPrice,
    acceptablePriceRange:{min:Number(quote.bid)-Number(quote.tickSize)*10,max:Number(quote.ask)+Number(quote.tickSize)*10},horizonMinutes:3,
    profitTakePlan:{targetPrice:row.targetPrice,acceptableTargetRange:{...row.acceptableTargetRange},targetHorizonMinutes:row.targetHorizonMinutes,
      targetReason:'selected exact frozen candidate economics',evidenceRefs:['technical.15m.confirmed']},...overrides},packet);
}
export function harness(raw?:any) {
  const f=structuredClone(fixtures[0]),packet=EntryIntelligencePacketSchema.parse(f.packet),now=Date.now();
  packet.market.quote.ts=now;packet.market.orderBook.ts=now;packet.createdAt=now;packet.expiresAt=now+300_000;
  const settings=SystemSettingsSchema.parse({...defaults,appearance:{...defaults.appearance,theme:'BINANCE_NOIR'}});settings.connections.executionMode='TESTNET_ENABLED';
  // TESTNET fixtures opt into a deliberately tiny positive margin and provide closed thesis bars.
  settings.entry.minimumInitialMarginByQuote.USDT=.01;
  settings.entry.minimumOrderNotionalByQuote.USDT=.01;
  for(const timeframe of ['1d','4h','15m'] as const){const card=(packet.market.technical as any)[timeframe];if(card)card.lastClosedBar={openTime:now-60_000,closeTime:now-1_000,open:packet.market.quote.last,high:packet.market.quote.last,low:packet.market.quote.last,close:packet.market.quote.last,volume:1};}
  settings.entry.nearMarket.enabled=false; // Archived V3.7 fixtures have no trade-tick stream; V3.9 has separate evidence tests.
  settings.selection.assetDirectory={...settings.selection.assetDirectory,version:'V3.9.1-fixture',methodVersion:'V3.9.1-LIQUIDITY-30D-V4',reviewedAt:now-1,nextReviewAt:now+86_400_000,evidenceHash:'fixture-evidence',approvedLiquid:[...new Set([...settings.selection.assetDirectory.approvedLiquid,'4'])],approvals:{...settings.selection.assetDirectory.approvals,'4':{symbol:'4USDT',reason:'FIXTURE_V4_APPROVAL',reviewedAt:now,quoteVolumeUsd24h:100_000_000,medianDailyQuoteVolumeUsd30d:100_000_000,tradeCount24h:100_000,openInterestUsd:10_000_000,listingAgeDays:400,liquidityComposite:.9}}};
  const state=new RuntimeState(settings);installDeterministicAdmission(state);state.runtimeControl.entrySafetyMode='AUTO';Object.assign(state.runtimeControl.capital,{generation:1,evaluatedAt:Date.now(),capitalVersion:`capital-fixture-${Date.now()}`,nextRecheckAt:Date.now()+300_000});state.runtimeControl.capital.routedCandidates=[{symbol:packet.symbol,underlying:packet.symbol.replace(/USD[TC]$/,''),quoteAsset:'USDT',marginUsd:200,leverage:20,admission:'ALLOW',reason:'fixture',longExecutable:true,shortExecutable:true,longFeasibleNotionalUsd:4000,shortFeasibleNotionalUsd:4000,minExecutableNotionalUsd:5} as any];state.executionGovernance={...state.executionGovernance,mode:'AUTO_RUNNING',reason:'TESTNET_CAPITAL_AVAILABLE_AUTO'};
  state.account={...state.account,status:'READY',asOf:Date.now(),equityUsd:10000,assets:[{asset:'USDT',availableBalance:10000,usdValue:10000}]};
  state.snapshots.set(packet.symbol,MarketSymbolSnapshotSchema.parse({...packet.market,symbol:packet.symbol,dataCompleteness:packet.evidenceCompleteness}));
  state.universe=[UniverseCandidateSchema.parse({...packet.selection,symbol:packet.symbol,lifecycle:'READY',eligible:true,exclusionReasons:[],quoteVolumeUsd24h:packet.market.quote.quoteVolumeUsd24h,spreadBps:1,lastPrice:packet.market.quote.last,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:now})];
  const q=packet.market.quote;
  const supplied=raw??{...f.normalized,decision:'PLACE_LONG',direction:'LONG',confidence:.8,idealPrice:q.bid,acceptablePriceRange:{min:q.bid-q.tickSize*10,max:q.ask+q.tickSize*10},horizonMinutes:3,reachability:.8,reason:'ISOLATED_CONTRACT_PLACE'};
  const bus=new EventBus(),events:any[]=[];bus.on('event',e=>events.push(e));
  const ai={scout:vi.fn(async()=>null),hasCapacity:()=>true,decide:vi.fn(async(decisionPacket:any)=>({decision:raw?brainParse(supplied,decisionPacket):candidateDecision(decisionPacket,supplied,'LONG',0),runId:'fixture-run'}))};
  const exchange={setLeverage:vi.fn(async()=>{}),placeEntry:vi.fn(async(order:any)=>({...order,status:'WORKING'})),findEntryByClientOrderId:vi.fn(async(_order?:any)=>null),cancelEntry:vi.fn(async(order:any)=>({...order,status:'CANCELED'}))};
  const coordinator=new EntryCoordinator(state,{build:(_symbol:string,executionEnvelope:any)=>({...packet,executionEnvelope})} as never,ai as never,exchange as never,bus);
  return {state,packet,ai,exchange,events,coordinator,supplied,candidateDecision:(decisionPacket:any,side:'LONG'|'SHORT'='LONG',candidateIndex=0,overrides:Record<string,unknown>={})=>candidateDecision(decisionPacket,supplied,side,candidateIndex,overrides),run:()=> (coordinator as any).analyze(packet.symbol)};
}
async function frozenFarPricePlace(){
  const h=harness(),market=h.state.snapshots.get(h.packet.symbol)!,tick=market.quote.tickSize,target=Math.ceil((market.quote.bid*1.02)/tick)*tick;
  h.state.settings.entry.nearMarket.enabled=true;
  market.recentTradedPrices=[];
  h.ai.decide.mockImplementation(async(decisionPacket:any)=>({decision:h.candidateDecision(decisionPacket,'LONG',0,{
    idealPrice:target,acceptablePriceRange:{min:target,max:target+tick*4},horizonMinutes:3,reachability:.8,reason:'FROZEN_PLACE_POST_AI_NO_VETO'
  }),runId:'frozen-place-run'}));
  await h.run();
  expect(h.ai.decide).toHaveBeenCalledOnce();
  expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  expect(h.state.candidateLifecycle.get(h.packet.symbol)).toMatchObject({status:'ENTRY_WORKING'});
  expect(h.state.candidateLifecycle.get(h.packet.symbol)?.status).not.toBe('WAIT_EXECUTION_RANGE');
  expect(h.events.some(e=>e.type==='POST_AI_OBSERVATION_ONLY'&&e.payload?.postAiVeto===false)).toBe(true);
  return h;
}
describe('V3.7.0 isolated real-EIP contracts; production write=0',()=>{
  it('does not use an empty legacy routed-candidate list as a deterministic pre-Primary veto',async()=>{const h=harness();h.state.runtimeControl.capital.routedCandidates=[];await h.run();expect(h.ai.decide).toHaveBeenCalledOnce();expect(h.events.some(e=>e.type==='PRE_AI_EXECUTION_ENVELOPE_CREATED')).toBe(true);expect(h.events.some(e=>e.type==='ENTRY_PREFLIGHT_BLOCKED')).toBe(false);});
  it('consumes genuine six-timeframe evidence and preserves original REJECT',()=>{for(const f of fixtures){const p=EntryIntelligencePacketSchema.parse(f.packet);expect(Object.keys(p.market.technical)).not.toContain('1h');const h=harness();expect(()=>new DirectionPolicyService(h.state).evaluate(p.symbol,MarketSymbolSnapshotSchema.parse({...p.market,symbol:p.symbol,dataCompleteness:p.evidenceCompleteness}))).not.toThrow();expect(brainParse(f.raw,p).decision).toBe('REJECT_CANDIDATE');}});
  it('legal autonomous PLACE crosses allocation, reservation and Entry Manager exactly once',async()=>{const h=harness();await h.run();expect(h.events.filter(x=>x.type==='ENTRY_ANALYSIS_FAILED')).toEqual([]);expect(h.exchange.placeEntry,JSON.stringify(h.events.filter(x=>/BLOCKED|REJECTED/.test(x.type)))).toHaveBeenCalledOnce();expect(h.state.entryIntents.size).toBe(1);await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();});
  it('runs Scout as an asynchronous observation without serially feeding its result to Primary',async()=>{const h=harness();h.state.settings.ai.scoutEnabled=true;const annotation={symbol:h.packet.symbol,summary:'fixture scout',keyEvidence:['technical.15m.confirmed'],contradictions:[],missingEvidence:[],attentionScore:.5};h.ai.scout.mockResolvedValue(annotation);await h.run();expect(h.ai.scout).toHaveBeenCalledOnce();expect(h.ai.decide).toHaveBeenCalledWith(expect.anything(),null,expect.any(Number),undefined);});
  it.each(['REJECT','AI_FAILED','INVALID_PLACE','NO_CAPITAL','STALE_QUOTE'])('does not submit %s',async(kind)=>{const h=harness(kind==='REJECT'?fixtures[0].raw:undefined);if(kind==='AI_FAILED')h.ai.decide.mockRejectedValue(new Error('AI_FAILED'));if(kind==='INVALID_PLACE')h.ai.decide.mockImplementation(async()=>({decision:brainParse({...fixtures[0].normalized,decision:'PLACE_LONG',reachability:'HIGH'},h.packet),runId:'invalid'}));if(kind==='NO_CAPITAL')h.state.account.assets[0].availableBalance=0;if(kind==='STALE_QUOTE')h.state.snapshots.get(h.packet.symbol)!.quote.ts=1;if(kind==='DUPLICATE_UNDERLYING')h.state.underlyingLocks.set(h.packet.symbol.replace('USDT',''),{leaseUntil:Date.now()+60_000});await h.run();expect(h.exchange.placeEntry).not.toHaveBeenCalled();});
  it('keeps AI LONG authorized even when legacy portfolio preference says SHORT_ONLY',async()=>{const h=harness();h.state.settings.portfolioIntelligence.symbolDirectionPreferences[h.packet.symbol]='SHORT_ONLY';await h.run();expect(h.ai.decide).toHaveBeenCalledOnce();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();expect([...h.state.entryIntents.values()][0]?.side).toBe('LONG');});
  it.each(['RESELECT_SYMBOL','NO_DIRECTION_EDGE','DATA_ERROR','AI_OUTPUT_INVALID'] as const)('closes %s without intent or submit',async decision=>{const h=harness();const noEntry={...fixtures[0].normalized,decision,reason:`fixture ${decision}`};h.ai.decide.mockResolvedValue({decision:noEntry,runId:'semantic-run'});await h.run();expect(h.state.entryIntents.size).toBe(0);expect(h.exchange.placeEntry).not.toHaveBeenCalled();expect(h.events.some(x=>x.type==='PRIMARY_NO_ENTRY'&&x.payload.decision===decision)).toBe(true);});
  it('saves WAIT without intent or order authorization',async()=>{const h=harness(),price=h.packet.market.quote.bid*.99;h.ai.decide.mockResolvedValue({decision:{...fixtures[0].normalized,decision:'WAIT_FOR_PRICE',waitCondition:{operator:'LTE',price,validForMinutes:3},reason:'wait'},runId:'wait-run'});await h.run();expect(h.state.entryIntents.size).toBe(0);expect(h.exchange.placeEntry).not.toHaveBeenCalled();expect(h.state.candidateLifecycle.get(h.packet.symbol)).toMatchObject({status:'WAIT_FOR_PRICE',waitContext:{runId:'wait-run',orderAuthorization:false}});});
  it('does not rerun Primary for an unchanged NO_EDGE solely because a 5m boundary or legacy review clock advanced',async()=>{const h=harness();h.ai.decide.mockResolvedValue({decision:{...fixtures[0].normalized,decision:'NO_DIRECTION_EDGE',reason:'no edge'},runId:'same-context'});await h.run();const row=h.state.candidateLifecycle.get(h.packet.symbol);expect(row.decisionContextKey).toBeTruthy();expect((h.coordinator as any).lifecycleRunnable(h.packet.symbol)).toBe(false);h.state.snapshots.get(h.packet.symbol)!.technical['5m'].asOf+=5*60_000;new UniverseCoordinator(h.state,new EventBus()).refresh();expect((h.coordinator as any).lifecycleRunnable(h.packet.symbol)).toBe(false);h.state.candidateLifecycle.get(h.packet.symbol).nextReviewAt=Date.now()-1;expect((h.coordinator as any).lifecycleRunnable(h.packet.symbol)).toBe(false);expect(h.ai.decide).toHaveBeenCalledOnce();});
  it('removes a slash-form blacklisted symbol before ranking and Pool, without altering an existing position',()=>{const h=harness(),symbol=h.packet.symbol,slashSymbol=symbol.replace(/(USDT|USDC|BUSD)$/,'/$1');h.state.settings.selection={...h.state.settings.selection,minQuoteVolumeUsd24h:0,maxSpreadBps:1_000_000,minDataCompleteness:0,marketQuality:{...h.state.settings.selection.marketQuality,enabled:false,symbolBlacklist:[slashSymbol],underlyingBlacklist:[]}};h.state.positions.set(symbol,{symbol,side:'LONG',quantity:1,markPrice:h.packet.market.quote.mark,leverage:1});new UniverseCoordinator(h.state,new EventBus()).refresh();expect(h.state.universe.find(x=>x.symbol===symbol)).toBeUndefined();expect(h.state.pool.list().some(x=>x.symbol===symbol)).toBe(false);expect(h.state.positions.get(symbol)).toMatchObject({symbol,quantity:1});});
  it('canonicalizes a Unicode blacklist Symbol written with a quote separator',()=>{expect(canonicalBlacklistValue('币安人生/USDT')).toBe('币安人生USDT');expect(canonicalBlacklistValue('币安人生USDT')).toBe('币安人生USDT');});
  it('keeps oversized events valid JSON and raw intent separately readable',()=>{const raw={decision:'PLACE_SHORT',reason:'x'.repeat(20000)};expect(rawIntent(JSON.stringify(raw))?.decision).toBe('PLACE_SHORT');const text=redactAudit({failure:{errorCode:'AI_SCHEMA_INVALID',rawOutput:JSON.stringify(raw)},apiSecret:'secret-value'},16000);expect(()=>JSON.parse(text)).not.toThrow();expect(text).not.toContain('secret-value');});
  it('does not feed a previous empty capital route back into Universe eligibility',()=>{const h=harness();h.state.runtimeControl.capital.routedCandidates=[];new UniverseCoordinator(h.state,new EventBus()).refresh();const candidate=h.state.universe.find(row=>row.symbol===h.packet.symbol)!;expect(candidate.pipelineEligible).toBe(true);expect(candidate.lifecycle).not.toBe('WAITING_CAPITAL_ROUTE');});
  it('does not clear cooldown when Entry and Universe inspect the same unchanged facts',()=>{const h=harness(),symbol=h.packet.symbol,context=(h.coordinator as any).currentDecisionContext(symbol);h.state.candidateLifecycle.set(symbol,{symbol,status:'REJECT_COOLDOWN',reason:'TEST',decisionContextKey:context,nextEligibleAt:Date.now()+60_000,updatedAt:Date.now()});h.state.rejectionCooldown.set(symbol,{until:Date.now()+60_000});new UniverseCoordinator(h.state,new EventBus()).refresh();expect(h.state.candidateLifecycle.get(symbol)).toMatchObject({status:'REJECT_COOLDOWN'});expect(h.state.rejectionCooldown.has(symbol)).toBe(true);});
  it('repairs Episode fields from normalized terminal facts with previous provenance',()=>{const d=terminalDecision({id:'r',status:'COMPLETED',startedAt:1,completedAt:2,normalizedPreview:JSON.stringify({confidence:.8,reason:'explicit'})},{status:'RUNNING'});expect(d).toMatchObject({confidence:.8,reason:'explicit',revision:{previous:{status:'RUNNING'}}});});
  it('fixed outcome rejects immature horizons and separates SHORT from market return',()=>{const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE shadow_mark_series(symbol TEXT,ts INTEGER,mark REAL)');const s=db.prepare('INSERT INTO shadow_mark_series VALUES(?,?,?)');for(let i=0;i<=15;i++)s.run('X',1000+i*60000,100-i/15);expect(observedOutcome(db,'X',1000,100,'SHORT',1000+899999).horizons.m15).toBeNull();const o=observedOutcome(db,'X',1000,100,'SHORT',901000);expect(o.horizons.m15).toMatchObject({maturedAt:901000,coverage:'SAMPLED_CONTIGUOUS',mae:0});expect(o.horizons.m15.directionReturn).toBeCloseTo(.01);expect(o.horizons.m15.marketReturn).toBeCloseTo(-.01);expect(o.horizons.h1).toBeNull();}finally{db.close();}});
  it('submits a frozen far-price PLACE immediately and never creates a post-Primary execution wait',async()=>{
    const h=await frozenFarPricePlace();
    await (h.coordinator as any).resumeExecutionWaits(Date.now());
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(h.state.entryIntents.size).toBe(1);
    expect(h.state.entryOrders.size).toBe(1);
    expect([...h.state.entryOrders.values()][0]?.clientOrderId).toMatch(/^ml_/);
  });

  it('keeps real insufficient funds as a pre-execution hard fact',async()=>{
    const h=harness();h.state.account.assets[0].availableBalance=0;
    await h.run();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
  });

  it('treats post-Primary authorization age as observation-only in TESTNET funds-only',async()=>{
    const h=harness();
    h.exchange.setLeverage.mockImplementation(async()=>{
      const intent=[...h.state.entryIntents.values()][0] as any;
      if(intent){intent.aiAuthorizationExpiresAt=Date.now()-1;intent.absoluteExpiresAt=Date.now()-1;}
    });
    await h.run();
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(h.events.some(e=>e.type==='POST_AI_OBSERVATION_ONLY'&&e.payload?.postAiVeto===false&&['AI_AUTHORIZATION_EXPIRED','JIT_AUTHORIZATION_AGE'].includes(e.payload?.kind))).toBe(true);
  });

  it.each([
    ['symbol blacklist policy',(h:any)=>{h.state.settings.selection.marketQuality.symbolBlacklist=[h.packet.symbol];}],
    ['order-book freshness drift',(h:any)=>{h.state.snapshots.get(h.packet.symbol).orderBook.ts=1;}],
  ])('does not let post-Primary %s revoke a frozen PLACE',async(_name,mutate)=>{
    const h=harness();
    h.exchange.setLeverage.mockImplementation(async()=>mutate(h));
    await h.run();
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });

  it('recovers an exchange-accepted submit after response loss without a duplicate',async()=>{
    const h=harness(),remote=new Map<string,any>();
    h.exchange.placeEntry.mockImplementation(async(order:any)=>{remote.set(order.clientOrderId,{...order,status:'WORKING',exchangeOrderId:'accepted-on-exchange'});throw new Error('response lost');});
    h.exchange.findEntryByClientOrderId.mockImplementation(async(order:any)=>remote.get(order.clientOrderId)??null);
    await h.run();
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(h.state.entryOrders.size).toBe(1);
    expect([...h.state.entryOrders.values()][0]).toMatchObject({status:'WORKING',exchangeOrderId:'accepted-on-exchange'});
  });

  it('recovers the same UNKNOWN identity by clientOrderId without another wire submit',async()=>{
    const h=harness(),ids:string[]=[];
    h.exchange.placeEntry.mockImplementation(async(order:any)=>{ids.push(order.clientOrderId);throw new Error('timeout');});
    h.exchange.findEntryByClientOrderId.mockResolvedValue(null);
    await h.run();
    const unknown=[...h.state.entryOrders.values()][0] as any,intent=[...h.state.entryIntents.values()][0] as any;
    expect(unknown?.status).toBe('UNKNOWN');
    const remote={...unknown,status:'WORKING',exchangeOrderId:'restart-recovered'};
    h.exchange.findEntryByClientOrderId.mockImplementation(async(order:any)=>order.clientOrderId===unknown.clientOrderId?remote:null);
    const recovered=await (h.coordinator as any).submitExactlyOnce(intent,unknown);
    expect(recovered).toMatchObject({status:'WORKING',exchangeOrderId:'restart-recovered'});
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(ids).toEqual([unknown.clientOrderId]);
  });

});


describe('V3.9 near-quote Primary to Entry contract',()=>{
  it.each(['LONG','SHORT'])('executes authorized %s once with actual recent trade evidence',async side=>{
    const h=harness(),q=h.packet.market.quote,market=h.state.snapshots.get(h.packet.symbol)!;
    h.state.settings.entry.nearMarket.enabled=true;
    h.packet.market.technical['15m'].trend=side==='LONG'?'UP':'DOWN';market.technical['15m'].trend=h.packet.market.technical['15m'].trend;
    const trades=[{price:q.bid,lastSeenAt:Date.now()},{price:q.ask,lastSeenAt:Date.now()}];market.recentTradedPrices=trades;h.packet.market.recentTradedPrices=trades;
    h.ai.decide.mockImplementation(async(decisionPacket:any)=>({decision:h.candidateDecision(decisionPacket,side as 'LONG'|'SHORT'),runId:`near-${side}`}));
    await h.run();expect(h.exchange.placeEntry,JSON.stringify(h.events.filter(e=>e.type.includes('REJECT')))).toHaveBeenCalledOnce();
    const order=[...h.state.entryOrders.values()][0]!;expect(order.side).toBe(side);expect(order.price).toBe(side==='LONG'?q.bid:q.ask);expect(order.absoluteExpiresAt-order.createdAt).toBeLessThanOrEqual(90000);
    await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });
});

it('retains a quality-admitted stale resident as WAITING while freshness still blocks entry',()=>{const h=harness(),symbol=h.packet.symbol;h.state.settings.selection={...h.state.settings.selection,minQuoteVolumeUsd24h:0,maxSpreadBps:1_000_000,minDataCompleteness:0,marketQuality:{...h.state.settings.selection.marketQuality,enabled:false,liquidityTopN:0,allowSpeculative:true,allowNewListings:true}};h.state.snapshots.get(symbol)!.quote.ts=Date.now()-30_000;new UniverseCoordinator(h.state,new EventBus()).refresh();const candidate=h.state.universe.find(x=>x.symbol===symbol)!;expect(candidate.exclusionReasons).toContain('QUOTE_STALE');expect(candidate.eligible).toBe(false);expect(h.state.pool.list().find(x=>x.symbol===symbol)?.state).toBe('WAITING');h.state.settings.selection.marketQuality.symbolBlacklist=[symbol];new UniverseCoordinator(h.state,new EventBus()).refresh();expect(h.state.pool.has(symbol)).toBe(false);});
