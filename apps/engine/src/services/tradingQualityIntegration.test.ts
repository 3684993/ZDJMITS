import {describe,it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EntryIntentSchema,TradingQualityPolicySchema} from '@zdj/contracts';
import {harness} from './tradingQualityTestHarness.js';
import {buildOpportunityEvidence,revalidateOpportunity,validateOpportunityDecision} from './opportunityEvidence.js';
import {TradingQualityCollector} from './tradingQualityCollector.js';
import {PositionService} from './positionService.js';
import {EntryCoordinator} from './entryCoordinator.js';

afterEach(()=>vi.restoreAllMocks());
function ready(){
  const h=harness(),now=Date.now(),m=h.state.snapshots.get(h.packet.symbol)!;
  h.state.settings.tradingQuality=TradingQualityPolicySchema.parse({mode:'ENFORCE'});
  Object.assign(m.quote,{bid:100,ask:100.01,last:100,mark:100,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5,ts:now});
  m.orderBook={...m.orderBook,ts:now,bids:[[100,10000]],asks:[[100.01,10000]]};
  for(const [tf,period] of [['15m',900000],['5m',300000],['1m',60000]] as const){
    Object.assign(m.technical[tf],{trend:'UP',ema8:100,ema21:99,ema55:98,emaSlope21:1,atr14:2,atrPercent:2,recentSwingHigh:110,recentSwingLow:95,
      isClosed:true,asOf:now-1000,barCloseTime:now-1000,receivedAt:now,lastClosedBar:{openTime:now-1000-period+1,closeTime:now-1000,open:99.5,high:101,low:99,close:100.5,volume:100}});
  }
  h.packet.market={...h.packet.market,...m};
  h.ai.decide.mockImplementation(async(decisionPacket:any)=>{
    return {runId:'quality-run',decision:h.candidateDecision(decisionPacket,'LONG',0,{opportunityType:'TREND_RESUMPTION',timingEvent:null,
      idealPrice:100,acceptablePriceRange:{min:99.99,max:100.01},horizonMinutes:1})};
  });
  return {...h,m,now};
}

describe('real EntryCoordinator opportunity authorization',()=>{
  it('records TradingQuality evidence without carrying it as Entry direction authorization',async()=>{
    const h=ready();await h.run();expect(h.exchange.placeEntry,JSON.stringify(h.events.filter(e=>/FAILED|BLOCKED/.test(e.type)))).toHaveBeenCalledOnce();
    const i=[...h.state.entryIntents.values()][0];expect(i).toBeDefined();expect(i.opportunityEvidence).toBeUndefined();
    const persisted=EntryIntentSchema.parse(JSON.parse(JSON.stringify(i)));expect(persisted.quantityUnits).toBe(i.quantityUnits);expect(i.quantityUnits).not.toBe(1000);expect(persisted.executionEnvelope).toBeDefined();
    expect(h.events.some(e=>e.type==='TRADING_QUALITY_OPPORTUNITY')).toBe(true);expect(h.events.some(e=>e.type==='TRADING_QUALITY_PRIMARY_LINK')).toBe(true);
  });
  it('keeps TradingQuality observation outside the Primary input contract',async()=>{
    const h=ready();await h.run();const primaryPacket=h.ai.decide.mock.calls[0]?.[0] as any;
    expect(primaryPacket?.opportunityEvidence).toBeUndefined();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });
  it('does not treat legacy timingEvent evidence as post-AI direction authorization',async()=>{
    const h=ready(),original=h.ai.decide.getMockImplementation()!;
    h.ai.decide.mockImplementation(async(...args:any[])=>{const r:any=await (original as any)(...args);r.decision.timingEvent={status:'COMPLETED',time:1};return r;});
    await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();expect([...h.state.entryIntents.values()][0]?.side).toBe('LONG');
  });
  it.each(['expiry','price','structure','payoff','policy'] as const)('keeps TradingQuality %s perturbation observational after autonomous Primary',async(kind)=>{
    const h=ready();h.exchange.setLeverage.mockImplementation(async()=>{
      if(kind==='structure')h.m.technical['15m'].trend='DOWN';
      if(kind==='payoff')h.m.technical['15m'].recentSwingHigh=100;
      if(kind==='policy')h.state.settings.tradingQuality!.policyVersion='changed-after-primary';
      if(kind==='price')Object.assign(h.m.quote,{last:100.005,mark:100.005});
      if(kind==='expiry')h.state.settings.tradingQuality!.policyVersion='expired-observation-sim';
    });
    await h.run();
    expect(h.exchange.placeEntry, `post-Primary TradingQuality ${kind} drift is observation-only`).toHaveBeenCalledOnce();
    expect(h.events.some(e=>String(e.payload?.reason??'').includes('MARKET_THESIS_FACTS_CHANGED_REQUIRES_NEW_MANDATE'))).toBe(false);
    if(h.state.entryIntents.size)expect([...h.state.entryIntents.values()][0]?.side).toBe('LONG');
  });
  it('WAIT creates no intent and fresh evaluation creates new authorization',async()=>{
    const h=ready(),place=h.ai.decide.getMockImplementation()!;
    h.ai.decide.mockResolvedValueOnce({runId:'wait-run',decision:{...h.supplied,decision:'WAIT_FOR_PRICE',structureDirection:'LONG',tradeSide:null,waitCondition:{operator:'LTE',price:100,validForMinutes:1},reason:'wait'}} as any);
    await h.run();expect(h.state.entryIntents.size).toBe(0);expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.state.candidateLifecycle.get(h.packet.symbol).waitContext.orderAuthorization).toBe(false);
    h.ai.decide.mockImplementation(place);await h.run();expect(h.ai.decide).toHaveBeenCalledTimes(2);expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });
  it('round-trips frozen quantity and execution envelope through the durable EntryIntent schema',async()=>{
    const h=ready();await h.run();const i=[...h.state.entryIntents.values()][0];const restored=EntryIntentSchema.parse(JSON.parse(JSON.stringify(i)));
    expect(restored.side).toBe(i.side);expect(restored.quantityUnits).toBe(i.quantityUnits);expect(restored.acceptablePriceRange).toEqual(i.acceptablePriceRange);expect(restored.executionEnvelope).toEqual(i.executionEnvelope);
  });
  it('revalidates changed replacement price independently of original legal price',()=>{
    const h=ready(),e=buildOpportunityEvidence(h.m,h.state.settings,h.now);
    expect(revalidateOpportunity(e,h.m,h.state.settings,100,h.now,1)).toBeNull();
    expect(revalidateOpportunity(e,h.m,h.state.settings,110,h.now,1)).toBe('OPPORTUNITY_PRICE_OUTSIDE_BAND');
    h.state.settings.tradingQuality!.maxLocationAtr=10;const wider=buildOpportunityEvidence(h.m,h.state.settings,h.now);
    expect(revalidateOpportunity(wider,h.m,h.state.settings,109.99,h.now,1)).toBe('OPPORTUNITY_PAYOFF_INSUFFICIENT');
    expect(validateOpportunityDecision({decision:'PLACE_LONG',tradeSide:'LONG',opportunityType:e.setupType,timingEvent:null},e)).toBe('PRIMARY_EVENT_NOT_VERIFIED');
  });
  it.each([101,102.44])('reviewPending preserves frozen AI authorization at proposed reprice %s',async(nextPrice)=>{
    const h=ready();h.m.technical['15m'].recentSwingHigh=102.45;
    const original=h.ai.decide.getMockImplementation()!;
    h.ai.decide.mockImplementation(async(...args:any[])=>{const r:any=await (original as any)(...args);r.decision.acceptablePriceRange={min:98.5,max:102.5};return r;});
    await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    const o=[...h.state.entryOrders.values()][0];o.updatedAt=Date.now()-10000;h.state.settings.entry.nearMarket.enabled=true;h.m.recentTradedPrices=[{price:nextPrice,lastSeenAt:Date.now()}];
    Object.assign(h.m.quote,{bid:nextPrice,ask:nextPrice+.01,last:nextPrice,mark:nextPrice,ts:Date.now()});
    h.m.orderBook={...h.m.orderBook,ts:Date.now(),bids:[[nextPrice,10000]],asks:[[nextPrice+.01,10000]]};
    const replace=vi.fn(async(order:any,price:number)=>({...order,price,status:'WORKING'}));(h.exchange as any).replaceEntry=replace;
    await h.coordinator.reviewPending();
    expect(replace).toHaveBeenCalledOnce();
  });
  it('restored execution wait cannot reuse an expired PLACE and missing intent cannot release UNKNOWN',async()=>{
    const h=ready();await h.run();const i=[...h.state.entryIntents.values()][0],o=[...h.state.entryOrders.values()][0];
    o.status='NEW';o.exchangeOrderId=null;i.aiAuthorizationExpiresAt=Date.now()-1;i.absoluteExpiresAt=Date.now()-1;
    h.state.candidateLifecycle.set(i.symbol,{status:'WAIT_EXECUTION_RANGE',executionWait:{intentId:i.id,reservationId:i.reservationId}});
    await (h.coordinator as any).resumeExecutionWaits(Date.now());expect(h.exchange.placeEntry).toHaveBeenCalledTimes(1);expect(o.clientOrderId).toBeTruthy();
    o.status='UNKNOWN';h.state.entryOrders.set(o.id,o);h.state.entryReservations.get(i.reservationId).status='WORKING';h.state.entryIntents.delete(i.id);
    h.state.candidateLifecycle.set(i.symbol,{status:'WAIT_EXECUTION_RANGE',executionWait:{intentId:i.id,reservationId:i.reservationId}});
    await (h.coordinator as any).resumeExecutionWaits(Date.now());expect(h.state.entryReservations.get(i.reservationId).status).toBe('WORKING');
  });
  it('recovers UNKNOWN with same identity even after opportunity expiry without a new submit',async()=>{
    const h=ready();await h.run();const i=[...h.state.entryIntents.values()][0],o=[...h.state.entryOrders.values()][0];
    o.status='UNKNOWN';
    h.exchange.findEntryByClientOrderId.mockResolvedValue({...o,status:'WORKING',exchangeOrderId:'remote'} as any);
    const restarted=new EntryCoordinator(h.state,{} as any,{} as any,h.exchange as any,h.bus);
    const result=await (restarted as any).submitExactlyOnce(EntryIntentSchema.parse(JSON.parse(JSON.stringify(i))),o);
    expect(result.clientOrderId).toBe(o.clientOrderId);expect(h.exchange.placeEntry).toHaveBeenCalledTimes(1);
  });
  it('TradingQuality evidence storage is observational in TESTNET funds-only and cannot suppress Primary',async()=>{
    const h=ready();(h.state as any).tradingQualityEvidenceReady=false;await h.run();
    expect(h.ai.decide).toHaveBeenCalledOnce();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    const off=harness();(off.supplied as any).quantityUnits=1000;(off.state as any).tradingQualityEvidenceReady=false;await off.run();expect(off.exchange.placeEntry).toHaveBeenCalledOnce();
  });
  it('processPool wakes WAIT on a fresh event and obtains a new Primary decision',async()=>{
    const h=ready();h.ai.decide.mockResolvedValueOnce({runId:'waiting',decision:{...h.supplied,decision:'WAIT_FOR_PRICE',structureDirection:'LONG',tradeSide:null,waitCondition:{operator:'LTE',price:100,validForMinutes:1},reason:'wait'}} as any);
    await h.run();expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    (h.ai as any).probePrimaryIfDue=vi.fn(async()=>{});(h.ai as any).setIdleContext=vi.fn();
    h.state.snapshots.set('BTCUSDT',{...h.m,symbol:'BTCUSDT'});h.state.snapshots.set('ETHUSDT',{...h.m,symbol:'ETHUSDT'});
    await h.coordinator.processPool();await new Promise(resolve=>setImmediate(resolve));
    expect(h.events.some(e=>e.type==='ENTRY_WAIT_TRIGGERED'&&e.payload.orderAuthorization===false)).toBe(true);
    expect(h.ai.decide).toHaveBeenCalledTimes(2);expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });
  it('OFF keeps accepted baseline authorization unchanged',async()=>{
    const h=harness();(h.supplied as any).quantityUnits=1000;await h.run();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();expect([...h.state.entryIntents.values()][0].opportunityEvidence).toBeUndefined();
  });
});

describe('prospective runtime evidence collection',()=>{
  it('does not leave an UNKNOWN durable claim when evidence storage fails before exchange submission',async()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-atomic-submit-')),h=ready(),collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus),durable:{current:any}={current:null};
    try{
      (h.coordinator as any).executionHardBlock=()=>null;
      (h.coordinator as any).journal={claim:(_scope:string,value:any)=>{durable.current=structuredClone(value);return{acquired:true,record:value};},save:(value:any)=>{durable.current=structuredClone(value);}};
      const intent:any={id:'atomic-intent',symbol:h.packet.symbol,side:'LONG',brainRunId:'atomic-run'},order:any={id:'entry_atomic',clientOrderId:'atomic-client',exchangeOrderId:null,symbol:intent.symbol,side:'LONG',quantity:1,price:100,filledQuantity:0,leverage:10,status:'NEW',createdAt:h.now,updatedAt:h.now,absoluteExpiresAt:h.now+60_000,repriceCount:0,intentId:intent.id,reachability:1};
      (collector as any).db.exec('DROP TABLE tq_facts');
      await expect((h.coordinator as any).submitExactlyOnce(intent,order)).rejects.toThrow('ENTRY_SUBMISSION_ABORTED_BEFORE_EXCHANGE');
      expect(h.exchange.placeEntry).not.toHaveBeenCalled();
      expect(h.state.entryOrders.get(order.id)).toMatchObject({status:'REJECTED',factSource:'LOCAL_NOT_SUBMITTED'});
      expect(durable.current).toMatchObject({order:{status:'REJECTED',factSource:'LOCAL_NOT_SUBMITTED'}});
      expect(durable.current.order.status).not.toBe('UNKNOWN');
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('100 idle symbols produce no path-mark writes',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-idle-marks-')),h=ready(),collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus);
    try{
      for(let i=0;i<100;i++)h.state.snapshots.set(`IDLE${i}USDT`,{...structuredClone(h.m),symbol:`IDLE${i}USDT`} as any);
      collector.tick(h.now);
      expect((collector as any).db.prepare('SELECT COUNT(*) AS n FROM tq_marks').get().n).toBe(0);
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('100 unchanged SHADOW candidates do not create poll-time observation rows',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-shadow-candidates-')),h=ready(),collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus);
    h.state.settings.tradingQuality!.mode='SHADOW';
    try{
      const base=h.state.universe[0],markets:any[]=[];
      h.state.universe=Array.from({length:100},(_,index)=>{
        const symbol=`SHADOW${index}USDT`,candidate={...structuredClone(base),symbol,rank:index+1};
        const market={...structuredClone(h.m),symbol};markets.push(market);h.state.snapshots.set(symbol,market);
        return candidate;
      });
      collector.tick(h.now);
      for(let dt=5000;dt<=55_000;dt+=5000){
        for(const market of markets){market.quote.ts=h.now+dt;market.orderBook.ts=h.now+dt;}
        collector.tick(h.now+dt);
      }
      expect(Number((collector as any).db.prepare("SELECT COUNT(*) AS n FROM tq_facts WHERE kind='opportunityObservations' AND json_extract(payload,'$.stage')='CANDIDATE_SHADOW'").get().n)).toBe(100);
      expect(Number((collector as any).db.prepare("SELECT COUNT(*) AS n FROM tq_facts WHERE kind='candidates'").get().n)).toBe(100);
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('persists a new candidate observation when a material opportunity version changes',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-shadow-version-')),h=ready(),collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus);
    h.state.settings.tradingQuality!.mode='SHADOW';
    try{
      collector.tick(h.now);
      const rows=()=>((collector as any).db.prepare("SELECT payload FROM tq_facts WHERE kind='opportunityObservations' AND json_extract(payload,'$.stage')='CANDIDATE_SHADOW' ORDER BY id").all() as any[]).map(row=>JSON.parse(row.payload));
      const before=rows();expect(before).toHaveLength(1);
      h.m.technical['15m'].atr14=2.1;h.m.quote.ts=h.now+5000;h.m.orderBook.ts=h.now+5000;
      collector.tick(h.now+5000);
      const after=rows();expect(after).toHaveLength(2);
      expect(after[1].opportunity.opportunityId).toBe(before[0].opportunity.opportunityId);
      expect(after[1].opportunity.version).not.toBe(before[0].opportunity.version);
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('keeps the exact Primary-linked opportunity observation alongside candidate coalescing',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-primary-opportunity-')),h=ready(),collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus);
    h.state.settings.tradingQuality!.mode='SHADOW';
    try{
      const opportunity=buildOpportunityEvidence(h.m,h.state.settings,h.now),packetId='primary-linked-packet';
      h.bus.publish('TRADING_QUALITY_OPPORTUNITY',{opportunity,packetId,stage:'BEFORE_PRIMARY'},opportunity.symbol);
      collector.tick(h.now);
      const exact=(collector as any).db.prepare("SELECT payload FROM tq_facts WHERE kind='opportunityObservations' AND id=?").get(`${opportunity.opportunityId}:${packetId}`) as any;
      expect(exact).toBeDefined();expect(JSON.parse(exact.payload)).toMatchObject({packetId,stage:'BEFORE_PRIMARY',opportunity:{opportunityId:opportunity.opportunityId,version:opportunity.version}});
      expect(Number((collector as any).db.prepare("SELECT COUNT(*) AS n FROM tq_facts WHERE kind='opportunityObservations'").get().n)).toBe(2);
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('does not replay unchanged candidate observations after collector restart',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-shadow-restart-')),h=ready(),file=path.join(dir,'evidence.sqlite');
    h.state.settings.tradingQuality!.mode='SHADOW';
    let collector=new TradingQualityCollector(file,h.state,h.bus);
    try{
      collector.tick(h.now);collector.close();
      collector=new TradingQualityCollector(file,h.state,h.bus);
      for(let dt=5000;dt<=50_000;dt+=5000){h.m.quote.ts=h.now+dt;h.m.orderBook.ts=h.now+dt;collector.tick(h.now+dt);}
      expect(Number((collector as any).db.prepare("SELECT COUNT(*) AS n FROM tq_facts WHERE kind='opportunityObservations' AND json_extract(payload,'$.stage')='CANDIDATE_SHADOW'").get().n)).toBe(1);
      expect(Number((collector as any).db.prepare('SELECT revision FROM tq_candidate_state WHERE candidate_id=?').get(`${h.packet.symbol}:1`).revision)).toBe(1);
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('samples an exactly attributed filled Entry and ignores idle-symbol quotes',async()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-filled-path-')),h=ready(),file=path.join(dir,'evidence.sqlite'),collector=new TradingQualityCollector(file,h.state,h.bus);
    h.state.settings.tradingQuality!.positionObservationHorizonMs=60_000;
    try{
      h.exchange.placeEntry.mockImplementation(async(o:any)=>({...o,status:'WORKING',exchangeOrderId:'exact-entry'}));await h.run();
      const order=[...h.state.entryOrders.values()][0],positions=new PositionService(h.state,h.bus);
      for(let i=0;i<100;i++)h.state.snapshots.set(`IDLE${i}USDT`,{...structuredClone(h.m),symbol:`IDLE${i}USDT`} as any);
      const fill={fillId:'exact-fill',symbol:order.symbol,side:'BUY' as const,positionSide:'LONG' as const,orderId:'exact-entry',clientOrderId:order.clientOrderId!,tradeId:'exact-trade',executionTime:h.now,qty:order.quantity,price:100,realizedPnl:0,commission:.01,commissionAsset:'USDT',maker:true};
      positions.recordExchangeFill(fill);
      for(let dt=0;dt<=30_000;dt+=1000){h.m.quote.ts=h.now+dt;h.m.quote.mark=dt<10_000?99:101;collector.tick(h.now+dt);}
      const ep=collector.report().episodes.find((row:any)=>row.intentId===order.intentId);
      expect(ep?.fillIds).toContain('exact-fill');expect(ep?.path[0]).toMatchObject({coverage:'COMPLETE',sampleCount:31});
      expect((collector as any).db.prepare('SELECT COUNT(*) AS n FROM tq_marks').get().n).toBe(31);
      expect((collector as any).db.prepare("SELECT COUNT(*) AS n FROM tq_marks WHERE symbol LIKE 'IDLE%'").get().n).toBe(0);
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('restarts an unfinished exact observation window without changing its identity',async()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-resume-path-')),h=ready(),file=path.join(dir,'evidence.sqlite');
    h.state.settings.tradingQuality!.positionObservationHorizonMs=60_000;
    let collector=new TradingQualityCollector(file,h.state,h.bus);
    try{
      h.exchange.placeEntry.mockImplementation(async(o:any)=>({...o,status:'WORKING',exchangeOrderId:'resume-entry'}));await h.run();
      const order=[...h.state.entryOrders.values()][0],positions=new PositionService(h.state,h.bus),fill={fillId:'resume-fill',symbol:order.symbol,side:'BUY' as const,positionSide:'LONG' as const,orderId:'resume-entry',clientOrderId:order.clientOrderId!,tradeId:'resume-trade',executionTime:h.now,qty:order.quantity,price:100,realizedPnl:0,commission:.01,commissionAsset:'USDT',maker:true};
      positions.recordExchangeFill(fill);
      for(let dt=0;dt<=10_000;dt+=1000){h.m.quote.ts=h.now+dt;collector.tick(h.now+dt);}
      const before=collector.report().episodes.find((row:any)=>row.intentId===order.intentId);collector.close();
      collector=new TradingQualityCollector(file,h.state,h.bus);
      for(let dt=11_000;dt<=30_000;dt+=1000){h.m.quote.ts=h.now+dt;collector.tick(h.now+dt);}
      const after=collector.report().episodes.find((row:any)=>row.intentId===order.intentId);
      expect(after?.opportunityId).toBe(before?.opportunityId);expect(after?.opportunityVersion).toBe(before?.opportunityVersion);
      expect(after?.fillIds).toEqual(['resume-fill']);expect(after?.path[0].sampleCount).toBeGreaterThan(before?.path[0].sampleCount??0);
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('stops raw path writes and episode recomputation after the observation horizon matures',async()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-mature-path-')),h=ready(),collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus);
    h.state.settings.tradingQuality!.positionObservationHorizonMs=60_000;
    try{
      h.exchange.placeEntry.mockImplementation(async(o:any)=>({...o,status:'WORKING',exchangeOrderId:'mature-entry'}));await h.run();
      const order=[...h.state.entryOrders.values()][0],positions=new PositionService(h.state,h.bus),fill={fillId:'mature-fill',symbol:order.symbol,side:'BUY' as const,positionSide:'LONG' as const,orderId:'mature-entry',clientOrderId:order.clientOrderId!,tradeId:'mature-trade',executionTime:h.now,qty:order.quantity,price:100,realizedPnl:0,commission:.01,commissionAsset:'USDT',maker:true};
      positions.recordExchangeFill(fill);
      for(let dt=0;dt<60_000;dt+=1000){h.m.quote.ts=h.now+dt;collector.tick(h.now+dt);}
      h.m.quote.ts=h.now+60_000;collector.tick(h.now+60_000);
      const marks=(collector as any).db.prepare('SELECT COUNT(*) AS n FROM tq_marks').get().n,episode=(collector as any).db.prepare('SELECT updated_at FROM tq_episodes WHERE intent_id=?').get(order.intentId).updated_at;
      for(let dt=61_000;dt<=65_000;dt+=1000){h.m.quote.ts=h.now+dt;collector.tick(h.now+dt);}
      expect((collector as any).db.prepare('SELECT COUNT(*) AS n FROM tq_marks').get().n).toBe(marks);
      expect((collector as any).db.prepare('SELECT updated_at FROM tq_episodes WHERE intent_id=?').get(order.intentId).updated_at).toBe(episode);
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('same symbol reopened in the same millisecond keeps separate position cycles and exact fills',()=>{
    const h=ready(),service=new PositionService(h.state,h.bus),symbol=h.packet.symbol;
    const p:any={id:'remote-stable-id',symbol,side:'LONG',quantity:1,entryPrice:100,markPrice:100,leverage:10,openedAt:h.now,firstObservedAt:h.now};
    const fill=(n:number,exit=false)=>({cycleId:p.cycleId,fillId:`f${n}`,symbol,side:exit?'SELL' as const:'BUY' as const,positionSide:'LONG' as const,orderId:`order${n}`,clientOrderId:exit?`tp_${n}`:`ml_${n}`,tradeId:`t${n}`,executionTime:h.now,qty:1,price:exit?102:100,realizedPnl:exit?2:0,commission:.01,commissionAsset:'USDT',maker:true});
    h.state.positions.set(p.id,p);service.observeRemotePosition(p);service.recordExchangeFill(fill(1));service.recordExchangeFill(fill(2,true));service.onReconciledClose(p,'TP');
    const first=[...h.state.tradeRecords.values()][0];expect(first.entryQty).toBe(1);
    service.observeRemotePosition(p);service.recordExchangeFill(fill(3));service.recordExchangeFill(fill(4,true));service.onReconciledClose(p,'TP');
    const records=[...h.state.tradeRecords.values()];expect(records).toHaveLength(2);expect(records[0].cycleId).not.toBe(records[1].cycleId);
    expect(records[1].entryQty).toBe(1);expect(records[1].linkedFillIds).toEqual(expect.arrayContaining(['f3','f4']));expect(records[1].linkedFillIds).not.toContain('f1');
  });
  it('automatically persists fills/episodes, samples fresh quote timestamps and survives reopen',async()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tq-evidence-')),h=ready(),file=path.join(dir,'evidence.sqlite');
    let collector=new TradingQualityCollector(file,h.state,h.bus);
    try{
      h.exchange.placeEntry.mockImplementation(async(o:any)=>({...o,status:'WORKING',exchangeOrderId:'ex-quality'}));await h.run();
      const order=[...h.state.entryOrders.values()][0],positions=new PositionService(h.state,h.bus);
      const f={fillId:'f1',symbol:order.symbol,side:'BUY' as const,positionSide:'LONG' as const,orderId:'ex-quality',clientOrderId:order.clientOrderId!,tradeId:'t1',executionTime:h.now,qty:order.quantity/2,price:100,realizedPnl:0,commission:.01,commissionAsset:'USDT',maker:true};
      positions.recordExchangeFill(f);positions.recordExchangeFill(f);collector.tick(h.now);
      const first=collector.report().episodes[0];expect(first.fillIds).toHaveLength(1);expect(first.completeFillAt).toBeNull();expect(first.firstFillVwap).toBe(100);
      positions.recordExchangeFill({...f,fillId:'f2',tradeId:'t2',executionTime:h.now+1000,price:102});
      for(let dt=1000;dt<=35000;dt+=1000){h.m.quote.ts=h.now+dt;h.m.quote.mark=dt<10000?99:101;collector.tick(h.now+dt);}
      let ep=collector.report().episodes[0];expect(ep.completeFillAt).toBe(h.now+1000);expect(ep.firstFillVwap).toBe(100);expect(ep.fillVwap).toBeCloseTo(101,10);
      expect(ep.path[0]).toMatchObject({coverage:'COMPLETE',sampleCount:31});expect(ep.path[0].maeBps).toBeCloseTo(100);
      expect(ep.path[1].coverage).toBe('IMMATURE');expect(ep.netPnl).toBeNull();
      collector.close();collector=new TradingQualityCollector(file,h.state,h.bus);collector.tick(h.now+40000);ep=collector.report().episodes[0];
      expect(ep.opportunityVersion).toBe(first.opportunityVersion);expect(ep.fillIds).toHaveLength(2);expect(collector.health().status).toBe('READY');
      expect(collector.report().funnel.candidates).toBeGreaterThan(0);
    }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
  });
});

it('retains all legitimate plan evidence warnings through intent schema hydration',()=>{const base:any={id:'warnings',symbol:'BTCUSDT',side:'LONG',confidence:.8,idealPrice:100,acceptablePriceRange:{min:99,max:101},horizonMinutes:3,leverage:10,createdAt:1,absoluteExpiresAt:100000,packetId:'p',brainRunId:'b',planWarnings:Array.from({length:26},(_,i)=>'PLAN_EVIDENCE_BAR_NOT_CLOSED:ref'+i)};expect(EntryIntentSchema.parse(base).planWarnings).toHaveLength(26);});
