import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {harness} from './tradingQualityTestHarness.js';
import {TradingQualityCollector} from './tradingQualityCollector.js';
const workers=vi.hoisted(()=>[] as any[]);
vi.mock('node:worker_threads',async()=>{
 const {EventEmitter}=await import('node:events');
 return{Worker:class extends EventEmitter{
   sent:any[]=[];terminated=false;
   constructor(public url:URL,public options:any){super();workers.push(this);}
   postMessage(message:any){this.sent.push(structuredClone(message));}
   terminate(){this.terminated=true;return Promise.resolve(0);}
 }};
});
const open=(worker=false)=>{const h=harness(),dir=mkdtempSync(path.join(tmpdir(),'tq-history-isolation-')),collector=new TradingQualityCollector(path.join(dir,'evidence.sqlite'),h.state,h.bus,{historyWorker:worker});return{h,dir,collector,db:(collector as any).db,close(){collector.close();rmSync(dir,{recursive:true,force:true});}};};

it('moves only durable history projection to one bounded worker and coalesces clocks without cloning runtime history',()=>{
 const x=open(true),w=workers.at(-1),materialize=vi.spyOn(x.collector as any,'materialize');
 try{
  expect(x.collector.health().status).toBe('DEGRADED');
  x.collector.tick(10000);expect(w.sent).toHaveLength(0);
  w.emit('message',{initialized:true,status:'READY',authorization:'NONE'});expect(w.sent).toHaveLength(1);
  for(let now=20000;now<=100000;now+=10000)x.collector.tick(now);
  expect(w.sent).toHaveLength(1);expect(x.collector.health().history.pending).toBe(true);
  expect(Object.keys(w.sent[0]).sort()).toEqual(['now','settings']);expect(w.options.workerData).not.toHaveProperty('history');
  w.emit('message',{status:'READY',asOf:10000,authorization:'NONE'});expect(w.sent).toHaveLength(2);expect(w.sent[1].now).toBe(100000);
  expect(materialize).not.toHaveBeenCalled();expect(x.collector.health().history.busy).toBe(true);
 }finally{x.close();expect(w.terminated).toBe(true);}
});

it('keeps exact pre-wire evidence synchronous and refuses synchronous analysis fallback after worker failure',()=>{
 const x=open(true),w=workers.at(-1),materialize=vi.spyOn(x.collector as any,'materialize');
 try{
  w.emit('message',{initialized:true,status:'READY'});
  x.h.state.entryIntents.set('i',{id:'i',symbol:'BTCUSDT',brainRunId:'run',createdAt:1} as any);
  x.h.bus.publish('ENTRY_SUBMIT_ATTEMPTED',{intentId:'i'},'BTCUSDT');
  expect(x.db.prepare("SELECT count(*) n FROM tq_facts WHERE kind='events'").get().n).toBe(1);
  expect(x.db.prepare("SELECT count(*) n FROM tq_facts WHERE kind='intents'").get().n).toBe(1);
  w.emit('error',new Error('ISOLATED_WORKER_FAILURE'));w.emit('exit',1);x.collector.tick();
  expect(x.collector.health().status).toBe('DEGRADED');expect((x.h.state as any).tradingQualityEvidenceReady).toBe(false);
  expect(materialize).not.toHaveBeenCalled();expect(x.collector.summary().status).toBe('DEGRADED');
 }finally{x.close();}
});

it('revision-fences a concurrent fact change so an old analysis cannot clear dirty work or overwrite a newer episode',()=>{
 const x=open();
 try{
  const c=x.collector as any;c.markEpisodeDirty('i','BTCUSDT');
  const first=x.db.prepare('SELECT revision FROM tq_episode_work WHERE intent_id=?').get('i').revision;
  expect(c.commitEpisode(c.scope(),'i',first,1,{fact:1})).toBe(true);
  c.markEpisodeDirty('i','BTCUSDT');const old=x.db.prepare('SELECT revision FROM tq_episode_work WHERE intent_id=?').get('i').revision;
  c.markEpisodeDirty('i','BTCUSDT');expect(c.commitEpisode(c.scope(),'i',old,2,{fact:'STALE'})).toBe(false);
  expect(JSON.parse(x.db.prepare('SELECT payload FROM tq_episodes WHERE intent_id=?').get('i').payload)).toEqual({fact:1});
  expect(x.db.prepare('SELECT dirty FROM tq_episode_work WHERE intent_id=?').get('i').dirty).toBe(1);
  expect(c.commitEpisode(c.scope(),'i',old+1,3,{fact:2})).toBe(true);
 }finally{x.close();}
});

it('rolls the dirty-work acknowledgment back if projection persistence fails',()=>{
 const x=open();
 try{
  const c=x.collector as any;c.markEpisodeDirty('i','BTCUSDT');const revision=x.db.prepare('SELECT revision FROM tq_episode_work WHERE intent_id=?').get('i').revision;
  x.db.exec("CREATE TRIGGER fail_projection BEFORE INSERT ON tq_episodes BEGIN SELECT RAISE(ABORT,'PROJECTION_FAILURE'); END;");
  expect(()=>c.commitEpisode(c.scope(),'i',revision,1,{fact:1})).toThrow('PROJECTION_FAILURE');
  expect(x.db.prepare('SELECT dirty FROM tq_episode_work WHERE intent_id=?').get('i').dirty).toBe(1);
 }finally{x.close();}
});
