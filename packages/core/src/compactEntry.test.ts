import {describe,expect,it} from 'vitest';
import {EntryExecutionEnvelopeSchema,type EntryIntelligencePacket,type OpportunityEvidence} from '@zdj/contracts';
import {buildCompactBrainPrompt,compactEntryFacts,compactFactIds} from './compactEntry.js';
import {decodeEntryFacts} from './entryFactEncoding.js';

function fixturePacket():EntryIntelligencePacket {
    const now=1_790_812_800_000;
    const capacity=(side:'LONG'|'SHORT')=>({
      executable:true,maxMarginUsd:25,maxNotionalUsd:500,maxQuantityUnits:500,
      businessMinInitialMarginUsd:25,preferredInitialMarginUsd:25,availableInitialMarginUsd:25,
      sizingStatus:'FLOOR_AVAILABLE',riskHeadroom:{factVersion:'fixture-risk',remaining:{},blockers:[],reason:'READY'},
      planCandidates:[{candidateId:`fixture-${side}`,side,quantityUnits:500,notionalUsd:500,marginUsd:25,leverage:20,
        entryReferencePrice:1,targetPrice:side==='LONG'?1.01:0.99,
        acceptableTargetRange:side==='LONG'?{min:1.01,max:1.01}:{min:0.99,max:0.99},targetHorizonMinutes:15,
        targetConditionalNetProfitUsd:4,expectedNetPnlAtHorizonUsd:null,reachProbability:null,
        reachProbabilityStatus:'UNPROVEN',targetVsStatisticalCeiling:'UNPROVEN',costVersion:'fixture-cost'}],
    });
    const envelope=EntryExecutionEnvelopeSchema.parse({
      version:'V3.9.3_PRE_AI_EXECUTION_ENVELOPE',resourcePolicy:'TESTNET_FUNDS_ONLY',symbol:'TESTUSDT',underlying:'TEST',quoteAsset:'USDT',
      createdAt:now,expiresAt:now+60_000,notice:'EXECUTION FACTS ARE NOT MARKET SIGNALS.',
      account:{status:'READY',equityUsd:1_000,availableMarginUsd:25,reservedMarginUsd:0,executionLeaseMarginUsd:0,freeMarginUsd:25},
      positionCapacity:{used:0,max:1,slotAvailable:true,sameUnderlyingOccupied:false},leverage:20,
      exchange:{tickSize:0.0001,stepSize:1,minQty:1,minNotional:5},makerReachableBand:{min:0.9999,max:1.0001},recentTradedPrices:[],
      fees:{makerFeeBps:2,takerFeeBps:5,roundTripCostBps:7,safetyMarginBps:1},
      LONG:capacity('LONG'),SHORT:capacity('SHORT'),leaseRequiredMarginUsd:25,
    });
    const packet={packetId:'fixture-packet',symbol:'TESTUSDT',createdAt:now,expiresAt:now+60_000,
      market:{quote:{ts:now,bid:0.9999,ask:1.0001,last:1,mark:1},technical:{},derivatives:{},
        orderBook:{ts:now,bids:[[0.9999,1_000]],asks:[[1.0001,1_000]]},recentTradedPrices:[]},
      microstructure:{reachableBand1m:[0.9999,1.0001],spreadBps:2,bidDepthUsd5:999.9,askDepthUsd5:1_000.1,imbalance:-0.0001},
      economic:{},portfolio:{},experience:{},executionEnvelope:envelope} as unknown as EntryIntelligencePacket;
    return packet;
}

describe('configured initial margin in the Primary prompt',()=>{
  it('preserves a legal 25/25 envelope and refers to its side-specific configuration without imposing fixed defaults',()=>{
    const packet=fixturePacket(),envelope=packet.executionEnvelope!;
    const original=structuredClone(packet),prompt=buildCompactBrainPrompt(packet);
    const [instructions,json]=prompt.split('INPUT:');
    const facts=decodeEntryFacts(JSON.parse(json)) as any;
    expect(facts).toEqual(JSON.parse(JSON.stringify(compactEntryFacts(packet))));
    expect(instructions).toContain('EXECUTION_ENVELOPE.{LONG|SHORT}.businessMinInitialMarginUsd');
    expect(instructions).toContain('EXECUTION_ENVELOPE.{LONG|SHORT}.preferredInitialMarginUsd');
    expect(instructions).not.toMatch(/businessMinInitialMarginUsd\s*=\s*100|preferredInitialMarginUsd\s*=\s*200/);
    expect(facts.EXECUTION_ENVELOPE).toEqual(envelope);
    for(const side of ['LONG','SHORT'] as const){
      expect(facts.EXECUTION_ENVELOPE[side]).toMatchObject({businessMinInitialMarginUsd:25,preferredInitialMarginUsd:25});
      expect(facts.EXECUTION_ENVELOPE[side].planCandidates).toEqual(envelope[side].planCandidates);
    }
    expect(packet).toEqual(original);
  });
});

describe('lossless Primary prompt transport',()=>{
  it('roundtrips exact 3.9.7 facts including conflicting clocks, precision, candidates and unknowns',()=>{
    const packet:any=fixturePacket(),now=packet.createdAt;
    const frames=['1m','5m','15m','1h','4h','1d','1w'];
    const technical=Object.fromEntries(frames.map((frame,index)=>[frame,{
      asOf:now-1000-index,barCloseTime:now-999-index,receivedAt:now-10-index,isClosed:index!==0,source:'BINANCE_WS',
      trend:'UP',trendStrength:.123456789123,emaSlope21:-1.23456789123e-100,macdHistogram:0,macdCrossAgeBars:0,
      bbPosition:null,atr14:.123456789123,volumeZScore:-.7123456789,recentSwingLow:.987654321987,
      recentSwingHigh:1.123456789123,higherHighs:0,lowerLows:2,
      lastClosedBar:{openTime:now-61000-index,closeTime:now-1000-index,open:1.123456789123,close:.987654321987},
      ...(index===0?{inProgressBar:{openTime:now-999,closeTime:now+59000,lastPrice:1.000000000001}}:{}),
    }]));
    packet.market.technical=technical;
    packet.referenceMarkets={btc:{symbol:'BTCUSDT',technical:structuredClone(technical),quote:packet.market.quote},
      eth:{symbol:'ETHUSDT',technical:structuredClone(technical),quote:packet.market.quote}};
    for(const side of ['LONG','SHORT']){
      const base=packet.executionEnvelope[side].planCandidates[0];
      packet.executionEnvelope[side].planCandidates=Array.from({length:6},(_,i)=>({...base,candidateId:`${side}-${i}`,
        quantityUnits:500+i,marginUsd:25+i/7,expectedNetPnlAtHorizonUsd:i===0?null:-.123456789123+i/7,
        ...(i%2?{targetBasis:'P75'}:{})}));
    }
    const before=structuredClone(packet);
    const freeze=(value:any)=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}};
    freeze(packet);
    const scout={symbol:packet.symbol,summary:'facts only',keyEvidence:['quote.top'],contradictions:[],missingEvidence:[],attentionScore:2};
    const confirmation={trigger:'NEW_BAR',createdAt:now+60000};
    const prompt=buildCompactBrainPrompt(packet,confirmation,undefined,scout);
    const wire=JSON.parse(prompt.split('INPUT:')[1].split('\nPREVIOUS_WAIT_RECONFIRMATION:')[0]);
    const decoded:any=decodeEntryFacts(wire);
    expect(decoded).toEqual(JSON.parse(JSON.stringify(compactEntryFacts(packet))));
    expect(packet).toEqual(before);
    expect(decoded.MARKET_FACTS.symbol.technical['1m'].barCloseTime).toBe(now-999);
    expect(decoded.MARKET_FACTS.symbol.technical['1m'].lastClosedBar.closeTime).toBe(now-1000);
    expect(decoded.MARKET_FACTS.symbol.technical['1m'].isClosed).toBe(false);
    expect(decoded.MARKET_FACTS.symbol.technical['1m'].bbPosition).toBeNull();
    expect(decoded.EXECUTION_ENVELOPE.LONG.planCandidates.map((p:any)=>p.candidateId)).toEqual(before.executionEnvelope.LONG.planCandidates.map((p:any)=>p.candidateId));
    expect(prompt).toContain(`SCOUT_FACTS_NON_AUTHORITATIVE:${JSON.stringify(scout)}`);
    expect(prompt).toContain(`PREVIOUS_WAIT_RECONFIRMATION:${JSON.stringify(confirmation)}`);
    expect(prompt).toContain('previous decision is context, not authorization or direction');
    expect(prompt).toContain('Do not output quantityUnits or profitTakePlan');
    expect(prompt).toContain('schemaVersion=V3.9.7-R2');
    expect(prompt).toContain('copy candidateSetHash and candidateSetFactVersion');
    expect(prompt).toContain('never another row or a fresh recomputation');
    expect(prompt).toContain('1D is the strategic regime, 4H is the setup direction, 15m is the tactical trigger');
  });
});

function opportunityFixture(packet:EntryIntelligencePacket):OpportunityEvidence {
  const eventTime=packet.createdAt-280_000;
  return{opportunityId:'original-opportunity',version:'original-fact-version',policyVersion:'original-policy',
    symbol:packet.symbol,direction:'LONG',setupType:'TREND_PULLBACK',
    structureAnchor:{barCloseTime:eventTime-20_000,price:.987654321987,target:1.123456789123},
    timingEvent:{id:`reclaim_5m_${eventTime}_original`,status:'COMPLETED',time:eventTime,
      anchorPrice:1.000000000001,timeframe:'5m',provenance:'technical.5m.confirmed'},
    eventTtlMs:300_000,authorizationTtlMs:90_000,positionObservationHorizonMs:900_000,
    locationFacts:{distanceAtr:.123456789123,atr:.987654321987},executablePriceBand:{min:.99,max:1.01},
    structuralTarget:1.123456789123,payoffSpaceBps:12.3456789123,
    costs:{entryFeeBps:2,exitFeeBps:5,bufferBps:.123456789123},disposition:'ALLOW',blockers:[],releaseCondition:'ORIGINAL_CLOSED_EVENT',
    observedAt:packet.createdAt-3_000,expiresAt:eventTime+300_000,eventExpiresAt:eventTime+300_000,
    materialFactFingerprint:'original-fingerprint'};
}
function decodePrompt(packet:EntryIntelligencePacket){
  const prompt=buildCompactBrainPrompt(packet),input=JSON.parse(prompt.split('INPUT:')[1]);
  return{prompt,input,facts:decodeEntryFacts(input) as any};
}

describe('frozen opportunity evidence in the actual encoded Primary input',()=>{
  it('transmits original event identity, all six event fields and independent clocks without altering candidate authorization',()=>{
    const packet=fixturePacket();packet.opportunityEvidence=opportunityFixture(packet);
    const original=structuredClone(packet),opportunity=original.opportunityEvidence!;
    const freeze=(value:any)=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}};
    freeze(packet);
    const {prompt,input,facts}=decodePrompt(packet);
    expect(input.encoding).toBe('ENTRY_READABLE_FACTS_V4');
    expect(facts.contract).toBe('V3.9.7-R2');
    expect(facts.MARKET_FACTS.opportunity).toEqual({factId:'opportunity.original',...opportunity});
    expect(Object.keys(facts.MARKET_FACTS.opportunity.timingEvent).sort()).toEqual(['anchorPrice','id','provenance','status','time','timeframe']);
    expect(facts.MARKET_FACTS.opportunity).toMatchObject({version:'original-fact-version',policyVersion:'original-policy',
      timingEvent:{time:packet.createdAt-280_000},observedAt:packet.createdAt-3_000,
      expiresAt:packet.createdAt+20_000,eventExpiresAt:packet.createdAt+20_000});
    expect(facts.EXECUTION_ENVELOPE).toEqual(original.executionEnvelope);
    expect(facts.validFactIds.filter((id:string)=>id==='opportunity.original')).toEqual(['opportunity.original']);
    expect(prompt.match(/"original-opportunity"/g)).toHaveLength(1);
    expect(prompt).toContain('it cannot veto/flip your side or grant permission');
    expect(prompt).toContain('Never replace original event timestamps with the current clock or renew authorization');
    expect(prompt).toContain('copy its exact original timingEvent.id into timingEventId');
    expect(prompt).toContain('Otherwise timingEventId=null only for an independent thesis');
    expect(prompt).toContain('Missing/NONE/null/expired evidence never becomes a completed fresh event');
    expect(packet).toEqual(original);
  });

  it.each(['LONG','SHORT'] as const)('retains %s evidence unchanged without deriving a model side or filtering the opposite menu',side=>{
    const packet=fixturePacket();packet.opportunityEvidence={...opportunityFixture(packet),direction:side};
    const {facts}=decodePrompt(packet);
    expect(facts.MARKET_FACTS.opportunity.direction).toBe(side);
    expect(facts.EXECUTION_ENVELOPE.LONG.planCandidates).toEqual(packet.executionEnvelope!.LONG.planCandidates);
    expect(facts.EXECUTION_ENVELOPE.SHORT.planCandidates).toEqual(packet.executionEnvelope!.SHORT.planCandidates);
    expect(facts.MARKET_FACTS.opportunity).not.toHaveProperty('tradeSide');
  });

  it('retains an expired event with its old clock and does not manufacture a fresh authorization',()=>{
    const packet=fixturePacket();packet.opportunityEvidence=opportunityFixture(packet);
    packet.createdAt+=60_000;
    const {facts}=decodePrompt(packet),event=facts.MARKET_FACTS.opportunity;
    expect(event).toEqual({factId:'opportunity.original',...packet.opportunityEvidence});
    expect(event.eventExpiresAt).toBeLessThan(facts.MARKET_FACTS.symbol.identity.observedAt);
    expect(event.timingEvent.time).toBe(packet.opportunityEvidence.timingEvent.time);
  });

  it('preserves NONE and each explicit null instead of fabricating a completed event',()=>{
    const packet=fixturePacket();packet.opportunityEvidence={...opportunityFixture(packet),direction:null,setupType:'NONE',structureAnchor:null,
      timingEvent:{id:'NONE',status:'NONE',time:null,anchorPrice:null,timeframe:null,provenance:'CLOSED_BAR_RECLAIM_V1'},
      eventExpiresAt:null,locationFacts:{distanceAtr:null,atr:null},executablePriceBand:null,structuralTarget:null,payoffSpaceBps:null,
      disposition:'REJECT',blockers:['TIMING_EVENT_NOT_COMPLETED']};
    const {prompt,facts}=decodePrompt(packet);
    expect(facts.MARKET_FACTS.opportunity).toEqual({factId:'opportunity.original',...packet.opportunityEvidence});
    expect(prompt).toContain('Missing/NONE/null/expired evidence never becomes a completed fresh event');
  });

  it('keeps a legacy missing eventExpiresAt absent instead of synthesizing it from newer clocks',()=>{
    const packet=fixturePacket();packet.opportunityEvidence=opportunityFixture(packet);delete packet.opportunityEvidence.eventExpiresAt;
    const {facts}=decodePrompt(packet);
    expect(facts.MARKET_FACTS.opportunity).not.toHaveProperty('eventExpiresAt');
    expect(facts.MARKET_FACTS.opportunity.timingEvent).toEqual(packet.opportunityEvidence.timingEvent);
  });

  it('distinguishes absent opportunity evidence from an explicit null without inventing a fact id',()=>{
    const packet=fixturePacket();
    expect(decodePrompt(packet).facts.MARKET_FACTS).not.toHaveProperty('opportunity');
    expect(compactFactIds(packet)).not.toContain('opportunity.original');
    (packet as any).opportunityEvidence=null;
    const {facts}=decodePrompt(packet);
    expect(facts.MARKET_FACTS).toHaveProperty('opportunity',null);
    expect(facts.validFactIds).not.toContain('opportunity.original');
  });
});
