import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {harness} from './tradingQualityTestHarness.js';
import {TradingQualityCollector} from './tradingQualityCollector.js';

it('captures exact trade repair scope and mutable linked facts before maps disappear without serializing unrelated retained fills',()=>{
 const h=harness(),dir=mkdtempSync(path.join(tmpdir(),'tq-symbol-repair-')),file=path.join(dir,'evidence.sqlite');let collector=new TradingQualityCollector(file,h.state,h.bus);
 const unrelated=vi.fn(function(this:any){return{symbol:this.symbol,tradeId:this.tradeId,qty:1};});
 const fill:any={symbol:'BTCUSDT',tradeId:'target-fill',executionTime:Date.now(),qty:1,attributionStatus:'UNATTRIBUTED'};
 try{
  h.state.executionFills=[fill,...Array.from({length:500},(_,n)=>({symbol:'ETHUSDT',tradeId:`unrelated-${n}`,executionTime:Date.now(),qty:1,toJSON:unrelated} as any))];
  h.state.tradeRecords.set('target-trade',{tradeId:'target-trade',symbol:'BTCUSDT',cycleId:'cycle1',updatedAt:Date.now()} as any);
  h.state.entryIntents.set('intent',{id:'intent',symbol:'BTCUSDT',createdAt:Date.now()} as any);
  h.state.entryOrders.set('order',{id:'order',symbol:'BTCUSDT',intentId:'intent',exchangeOrderId:'ex1',updatedAt:Date.now()} as any);
  h.state.entryReservations.set('reservation',{id:'reservation',symbol:'BTCUSDT',status:'RELEASED'} as any);
  h.state.positions.set('opposite',{id:'opposite',symbol:'BTCUSDT',side:'SHORT',cycleId:'other-cycle'} as any);
  h.state.lifecycles.set('opposite-life',{symbol:'BTCUSDT',cycleId:'other-cycle'} as any);
  h.bus.publish('TRADE_RECORD_REPAIRED',{tradeId:'target-trade'},'BTCUSDT');
  expect(unrelated).not.toHaveBeenCalled();
  fill.qty=2;h.bus.publish('TRADE_RECORD_REPAIRED',{tradeId:'target-trade'},'BTCUSDT');expect(unrelated).not.toHaveBeenCalled();
  const rows=()=>((collector as any).db.prepare('SELECT kind,payload FROM tq_facts').all() as any[]);
  expect(new Set(rows().map(row=>row.kind))).toEqual(new Set(['events','fills','trades','intents','orders','reservations','positions','cycles']));
  expect(rows().filter(row=>row.kind==='fills')).toHaveLength(1);
  h.state.executionFills=[];h.state.tradeRecords.clear();h.state.entryOrders.clear();collector.close();collector=new TradingQualityCollector(file,h.state,h.bus);
  expect(JSON.parse(rows().find(row=>row.kind==='fills').payload).qty).toBe(2);
  expect(JSON.parse(rows().find(row=>row.kind==='positions').payload).cycleId).toBe('other-cycle');
 }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
});

it.each(['ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED','ENTRY_ORDER_TTL_CLOSED'])('synchronously retains exact %s order and released reservation without unrelated history capture',type=>{
 const h=harness(),dir=mkdtempSync(path.join(tmpdir(),'tq-order-scope-')),collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus),unrelated=vi.fn();
 try{
  h.state.executionFills=[{symbol:'ETHUSDT',tradeId:'other',toJSON:unrelated} as any];
  const order:any={id:'order',symbol:'BTCUSDT',exchangeOrderId:'ex1',status:'EXPIRED',fills:[{qty:1}],updatedAt:Date.now()};h.state.entryOrders.set(order.id,order);
  h.state.entryReservations.set('reservation',{id:'reservation',symbol:'BTCUSDT',status:'RELEASED'} as any);
  h.bus.publish(type,{orderId:order.id},order.symbol);order.fills[0].qty=2;h.bus.publish(type,{orderId:order.id},order.symbol);
  expect(unrelated).not.toHaveBeenCalled();const db=(collector as any).db;
  expect(JSON.parse(db.prepare("SELECT payload FROM tq_facts WHERE kind='orders'").get().payload).fills[0].qty).toBe(2);
  expect(JSON.parse(db.prepare("SELECT payload FROM tq_facts WHERE kind='reservations'").get().payload).status).toBe('RELEASED');
 }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
});

it('falls back to complete synchronous evidence for aggregate, missing and mismatched mutation identities',()=>{
 const h=harness(),dir=mkdtempSync(path.join(tmpdir(),'tq-fallback-scope-')),collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus);
 try{
  const fill:any={symbol:'ETHUSDT',tradeId:'unrelated',qty:1,executionTime:Date.now()};h.state.executionFills=[fill];
  h.state.tradeRecords.set('trade',{tradeId:'trade',symbol:'BTCUSDT',updatedAt:Date.now()} as any);
  for(const [payload,symbol] of [[{source:'BULK_REBUILD'},undefined],[{tradeId:'missing'},'BTCUSDT'],[{tradeId:'trade'},'WRONGUSDT']] as any){
   fill.qty++;h.bus.publish('TRADE_RECORD_REPAIRED',payload,symbol);
   expect(JSON.parse((collector as any).db.prepare("SELECT payload FROM tq_facts WHERE kind='fills'").get().payload).qty).toBe(fill.qty);
  }
 }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
});

it('durably captures opportunity and Primary proof without history scans, retaining synchronous execution facts',()=>{
 const h=harness(),dir=mkdtempSync(path.join(tmpdir(),'tq-proof-event-')),file=path.join(dir,'evidence.sqlite');let collector=new TradingQualityCollector(file,h.state,h.bus);
 try{
  h.state.executionFills=[{symbol:'BTCUSDT',tradeId:'exact-fill',executionTime:Date.now(),qty:1,attributionStatus:'UNATTRIBUTED'} as any];
  h.bus.publish('TRADING_QUALITY_OPPORTUNITY',{opportunity:{opportunityId:'op1',version:1},packetId:'packet1'});
  h.bus.publish('TRADING_QUALITY_PRIMARY_LINK',{runId:'run1',packetId:'packet1',decision:'WAIT'});
  const facts=()=>((collector as any).db.prepare('SELECT kind,id,payload FROM tq_facts').all() as any[]);
  expect(facts().filter(row=>row.kind==='fills')).toHaveLength(0);
  expect(facts().filter(row=>row.kind==='events')).toHaveLength(2);
  expect(facts().find(row=>row.kind==='opportunityObservations').id).toBe('op1:packet1');
  h.bus.publish('ENTRY_SUBMIT_ATTEMPTED',{intentId:'real-intent'});
  expect(JSON.parse(facts().find(row=>row.kind==='fills').payload).qty).toBe(1);
  collector.close();collector=new TradingQualityCollector(file,h.state,h.bus);
  expect(JSON.parse(facts().find(row=>row.kind==='primaryLinks').payload)).toMatchObject({runId:'run1',packetId:'packet1',decision:'WAIT'});
  expect(facts().filter(row=>row.kind==='opportunities')).toHaveLength(1);
  expect(facts().filter(row=>row.kind==='events')).toHaveLength(3);
 }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
});

it('projects a bounded HTTP summary without materialising raw evidence payloads',()=>{
  const h=harness(),dir=mkdtempSync(path.join(tmpdir(),'tq-http-summary-'));
  const collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus);
  try{
    const summary=collector.summary() as any;
    expect(summary).toMatchObject({schemaVersion:'TQ-HTTP-SUMMARY-1',status:'READY',fullReportAvailableOffline:true,authorization:'NONE'});
    expect(summary.counts).toMatchObject({episodes:0,episodeWork:0,dirtyEpisodeWork:0,marks:0,collectorSamples:0});
    expect(summary.factsByKind).toEqual({});
    expect(summary).not.toHaveProperty('episodes');
    expect(summary).not.toHaveProperty('facts');
  }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
});

it('keeps exact mutable fill evidence across a 30000-event burst and database reopen',()=>{
  const h=harness(),dir=mkdtempSync(path.join(tmpdir(),'tq-event-burst-')),file=path.join(dir,'evidence.sqlite');
  let collector=new TradingQualityCollector(file,h.state,h.bus);
  try{
    const fill:any={symbol:'BTCUSDT',tradeId:'burst-fill',executionTime:Date.now(),qty:1,attributionStatus:'UNATTRIBUTED'};
    h.state.executionFills=[fill];
    (collector as any).captureState();
    // This is a correctness/cache-churn invariant, not a benchmark of hosted-runner fsync.
    // Keep all 30,001 put() calls, but commit them as one SQLite transaction so Windows cloud-disk
    // autocommit latency cannot turn an otherwise-correct test into a machine-speed timeout.
    (collector as any).db.exec('BEGIN IMMEDIATE');
    try{
      for(let n=0;n<30001;n++)(collector as any).put('events',`burst:${n}`,{id:n,type:'ENTRY_TEST',ts:n},n);
      (collector as any).db.exec('COMMIT');
    }catch(error){
      try{(collector as any).db.exec('ROLLBACK');}catch{}
      throw error;
    }
    const prepare=vi.spyOn((collector as any).db,'prepare');
    (collector as any).captureState();
    expect(prepare.mock.calls.filter(([sql])=>String(sql).startsWith('SELECT payload FROM tq_facts'))).toHaveLength(0);
    prepare.mockRestore();
    fill.qty=2;(collector as any).captureState();
    expect(JSON.parse((collector as any).db.prepare("SELECT payload FROM tq_facts WHERE kind='fills'").get().payload).qty).toBe(2);
    expect(Number((collector as any).db.prepare("SELECT count(*) n FROM tq_facts WHERE kind='events'").get().n)).toBe(30001);
    collector.close();collector=new TradingQualityCollector(file,h.state,h.bus);
    (collector as any).captureState();
    expect(JSON.parse((collector as any).db.prepare("SELECT payload FROM tq_facts WHERE kind='fills'").get().payload).qty).toBe(2);
  }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
});

it('bounds background history capture and never reverts a replaced fill after synchronous event capture',()=>{
 const h=harness(),dir=mkdtempSync(path.join(tmpdir(),'tq-background-capture-')),collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus);
 try{
  h.state.executionFills=Array.from({length:1000},(_,n)=>({symbol:'BTCUSDT',tradeId:`chunk-${n}`,executionTime:Date.now(),qty:1,attributionStatus:'UNATTRIBUTED'} as any));
  collector.tick();expect(collector.health().stateCapture.pendingRows).toBeGreaterThan(0);
  expect(Number((collector as any).db.prepare("SELECT count(*) n FROM tq_facts WHERE kind='fills'").get().n)).toBeLessThan(1000);
  h.state.executionFills=h.state.executionFills.map((fill,n)=>n===900?{...fill,qty:2}:fill);
  h.bus.publish('RECONCILIATION_COMPLETED',{});
  expect(Number((collector as any).db.prepare("SELECT count(*) n FROM tq_facts WHERE kind='fills'").get().n)).toBe(1000);
  for(let n=0;n<8;n++)collector.tick();
  expect(JSON.parse((collector as any).db.prepare("SELECT payload FROM tq_facts WHERE kind='fills' AND id='BTCUSDT:chunk-900'").get().payload).qty).toBe(2);
 }finally{collector.close();rmSync(dir,{recursive:true,force:true});}
});
