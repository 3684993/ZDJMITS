from pathlib import Path
root=Path('apps/engine/src')
(root/'services/reconciliationTiming.ts').write_text('''import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
type Phase={count:number;totalMs:number;maxMs:number;values:number[]};
type Cycle={id:string;startedAt:number;endedAt?:number;totalMs?:number;phases:Record<string,Phase>;counts:Record<string,number>;marks:Record<string,number>};
/** Bounded observation only. Authority-critical writes execute inline with original exceptions. */
class ReconciliationTiming {
  private context=new AsyncLocalStorage<Cycle>();private cycles:Cycle[]=[];private sequence=0;
  active(){return Boolean(this.context.getStore());}
  async run<T>(work:()=>Promise<T>){const c:Cycle={id:`reconcile-${++this.sequence}`,startedAt:Date.now(),phases:{},counts:{},marks:{}};const start=performance.now();return this.context.run(c,async()=>{try{return await work();}finally{c.endedAt=Date.now();c.totalMs=performance.now()-start;this.cycles.push(c);if(this.cycles.length>64)this.cycles.shift();}});}
  measure<T>(name:string,work:()=>T):T{const c=this.context.getStore();if(!c)return work();const start=performance.now();try{return work();}finally{this.record(c,name,performance.now()-start);}}
  async remote<T>(name:string,work:()=>Promise<T>):Promise<T>{const c=this.context.getStore();if(!c)return work();const start=performance.now();try{return await work();}finally{this.record(c,name,performance.now()-start);}}
  private record(c:Cycle,name:string,ms:number){if(!c.phases[name]&&Object.keys(c.phases).length>=64)return;const p=c.phases[name]??(c.phases[name]={count:0,totalMs:0,maxMs:0,values:[]});p.count++;p.totalMs+=ms;p.maxMs=Math.max(p.maxMs,ms);if(p.values.length<64)p.values.push(ms);}
  count(name:string,n=1){const c=this.context.getStore();if(c)c.counts[name]=(c.counts[name]??0)+n;}
  mark(name:string){const c=this.context.getStore();if(c)c.marks[name]=performance.now();}
  elapsed(name:string,from:string){const c=this.context.getStore();if(c&&c.marks[from]!==undefined)this.record(c,name,performance.now()-c.marks[from]);}
  health(){const phases:Record<string,{count:number;maxMs:number;p95Ms:number;totalMs:number}>={};for(const c of this.cycles)for(const [key,p]of Object.entries(c.phases)){const v=this.cycles.flatMap(row=>row.phases[key]?.values??[]).sort((a,b)=>a-b);phases[key]={count:this.cycles.reduce((n,row)=>n+(row.phases[key]?.count??0),0),maxMs:Math.max(...this.cycles.map(row=>row.phases[key]?.maxMs??0)),p95Ms:v[Math.floor((v.length-1)*.95)]??0,totalMs:this.cycles.reduce((n,row)=>n+(row.phases[key]?.totalMs??0),0)};}return{scope:'CURRENT_INSTANCE_BOUNDED64_COMPLETED_CYCLES',phases,recent:this.cycles.map(({phases,...c})=>({...c,phases:Object.fromEntries(Object.entries(phases).map(([key,{values,...p}])=>[key,p]))}))};}
}
export const reconciliationTiming=new ReconciliationTiming();
''',encoding='utf-8')
p=root/'events/eventBus.ts';s=p.read_text(encoding='utf-8');s="import {reconciliationTiming} from '../services/reconciliationTiming.js';\n"+s;s=s.replace("this.emit('event',event); this.emit(type,event);", "reconciliationTiming.measure('eventBus.genericListeners',()=>this.emit('event',event)); reconciliationTiming.measure('eventBus.typedListeners',()=>this.emit(type,event));");s=s.replace('  private seq=0;','''  private seq=0;
  onMeasured(group:string,listener:(event:DomainEvent)=>void){const wrapped=(event:DomainEvent)=>reconciliationTiming.measure(`listener.${group}`,()=>listener(event));this.on('event',wrapped);return wrapped;}
''');p.write_text(s,encoding='utf-8')
p=root/'services/runtimeWriteBuffer.ts';s=p.read_text(encoding='utf-8');s=s.replace('/** Coalesced retry for non-critical telemetry/checkpoints. Submission journals remain synchronous. */','/** Success executes synchronously inline; only failed non-critical writes enter a coalesced retry queue. Authority-critical submission journals must call the store directly and propagate failure. */');p.write_text(s,encoding='utf-8')
p=root/'services/tradingQualityCollector.ts';s=p.read_text(encoding='utf-8');s=s.replace("events.on('event',this.listener);","this.listener=events.onMeasured('TradingQuality',this.listener);");p.write_text(s,encoding='utf-8')
(root/'services/reconciliationChanges.ts').write_text('''import {isDeepStrictEqual} from 'node:util';
import type {RuntimeState} from '../state/runtimeState.js';
/** Tracks exact cycle mutations, never serializes/rewrites untouched execution history. */
export class ReconciliationChanges {
  readonly entry=new Set<string>();readonly manual=new Set<string>();
  constructor(private state:RuntimeState){}
  setEntry(id:string,row:any){if(!isDeepStrictEqual(this.state.entryOrders.get(id),row))this.entry.add(id);this.state.entryOrders.set(id,row);}
  setManual(id:string,row:any){if(!isDeepStrictEqual(this.state.manualOrders.get(id),row))this.manual.add(id);this.state.manualOrders.set(id,row);}
  reservation(id:string,work:()=>unknown){const before=this.state.entryReservations.get(id);const result=work();if(!isDeepStrictEqual(before,this.state.entryReservations.get(id)))for(const order of this.state.entryOrders.values())if(order.reservationId===id)this.entry.add(order.id);return result;}
  setManualIntent(id:string,next:any,orderId:string){const previous=this.state.manualIntents.get(id);if(isDeepStrictEqual(previous,{...next,updatedAt:previous?.updatedAt}))return;this.state.manualIntents.set(id,next);this.manual.add(orderId);}
  payload(){return{entryOrderIds:[...this.entry],manualOrderIds:[...this.manual]};}
}
''',encoding='utf-8')
(root/'services/reconciliationJournalPersistence.ts').write_text('''import type {DomainEvent} from '../events/eventBus.js';
import type {RuntimeState} from '../state/runtimeState.js';
import {reconciliationTiming} from './reconciliationTiming.js';
/** Uses the cycle's precise change set. Save callbacks remain synchronous. */
export function persistReconciliationJournals(event:DomainEvent,state:RuntimeState,saveEntry:(v:any)=>void,saveManual:(v:any)=>void){
  const p=event.payload as any,changed=p?.executionChanges;
  if(event.type!=='RECONCILIATION_COMPLETED')return;
  if(!changed||!Array.isArray(changed.entryOrderIds)||!Array.isArray(changed.manualOrderIds))throw Error('RECONCILIATION_EXECUTION_CHANGE_SET_MISSING');
  reconciliationTiming.measure('entry.persistenceFanout',()=>{for(const id of new Set<string>(changed.entryOrderIds)){const order=state.entryOrders.get(id),intent=order&&state.entryIntents.get(order.intentId);if(order&&intent)saveEntry({intent,order,reservation:order.reservationId?state.entryReservations.get(order.reservationId):undefined});}});
  reconciliationTiming.measure('manual.persistenceFanout',()=>{for(const id of new Set<string>(changed.manualOrderIds)){const order=state.manualOrders.get(id),intent=order&&state.manualIntents.get(order.intentId);if(order&&intent)saveManual({intent,order});}});
}
''',encoding='utf-8')
p=root/'services/reconciliationService.ts';s=p.read_text(encoding='utf-8');s="import {reconciliationTiming} from './reconciliationTiming.js';\nimport {ReconciliationChanges} from './reconciliationChanges.js';\n"+s;s=s.replace("  async run(options:{startupCurrentOnly?:boolean}={}){", "  async run(options:{startupCurrentOnly?:boolean}={}){if(this.running)return;return reconciliationTiming.run(()=>this.runCycle(options));}\n  private async runCycle(options:{startupCurrentOnly?:boolean}={}){\n    const changes=new ReconciliationChanges(this.state);")
s=s.replace('this.state.entryOrders.set(', 'changes.setEntry(').replace('this.state.manualOrders.set(', 'changes.setManual(')
import re
s=re.sub(r'this.state.releaseEntryReservation\(([^()]*)\)',r'changes.reservation(\1,()=>this.state.releaseEntryReservation(\1))',s)
s=re.sub(r'this.state.markEntryReservationWorking\(([^;]*?)\);',lambda m:'changes.reservation('+m.group(1).split(',')[0]+',()=>this.state.markEntryReservationWorking('+m.group(1)+'));',s)
s=s.replace('this.state.manualIntents.set(intent.id,next);','changes.setManualIntent(intent.id,next,order.id);')
old='await Promise.all([this.adapter.fetchPositions(),fullOrderScan?this.adapter.fetchOpenOrders():Promise.resolve(null),...targetedTpSymbols.map(symbol=>this.adapter.fetchOpenOrders(symbol))]);';assert old in s
s=s.replace(old,"await reconciliationTiming.remote('remote.initialReads',()=>Promise.all([this.adapter.fetchPositions(),fullOrderScan?this.adapter.fetchOpenOrders():Promise.resolve(null),...targetedTpSymbols.map(symbol=>this.adapter.fetchOpenOrders(symbol))]));reconciliationTiming.mark('remoteCompleted');reconciliationTiming.mark('applicationStart');")
s=s.replace('this.reportOpenOrderExitFacts(orders,Date.now());',"reconciliationTiming.elapsed('remoteCompletionToApply','remoteCompleted');this.reportOpenOrderExitFacts(orders,Date.now());")
s=s.replace('claims=this.readEntryClaims?.()??null;',"claims=reconciliationTiming.measure('claimStats',()=>this.readEntryClaims?.()??null);")
s=s.replace("this.events.publish('RECONCILIATION_COMPLETED',{", "reconciliationTiming.elapsed('applicationBeforeCompletion','applicationStart');reconciliationTiming.measure('completionPublish',()=>this.events.publish('RECONCILIATION_COMPLETED',{executionChanges:changes.payload(),")
s=s.replace('remoteAuditBudgetMs:remoteAuditDeadline-requestedAt});\n    }catch', 'remoteAuditBudgetMs:remoteAuditDeadline-requestedAt}));\n    }catch')
s=s.replace('health(){const audits:', 'health(){const audits:').replace('return{lastRun:this.lastRun,lastError:this.lastError,remoteReadBudget:', 'return{phaseTiming:reconciliationTiming.health(),lastRun:this.lastRun,lastError:this.lastError,remoteReadBudget:')
p.write_text(s,encoding='utf-8')
p=root/'runtime/appRuntime.ts';s=p.read_text(encoding='utf-8');s="import {reconciliationTiming} from '../services/reconciliationTiming.js';\nimport {persistReconciliationJournals} from '../services/reconciliationJournalPersistence.js';\n"+s;s=s.replace('events.on("event", (event) => {','events.onMeasured("RuntimePersistence", (event) => {');s=s.replace("if(event.type==='RECONCILIATION_COMPLETED'||event.type==='ENTRY_ORDER_TTL_CLOSED'||event.type==='ENTRY_ORDER_REPRICED'){", "if(event.type==='RECONCILIATION_COMPLETED')persistReconciliationJournals(event,state,value=>runtime.writes.apply(`entry:${value.order.id}`,()=>store.saveEntryExecution(value)),value=>runtime.writes.apply(`manual:${value.order.id}`,()=>store.saveManualExecution(value)));\n      if(event.type==='ENTRY_ORDER_TTL_CLOSED'||event.type==='ENTRY_ORDER_REPRICED'){")
s=s.replace("const orders=event.type==='RECONCILIATION_COMPLETED'||!orderId?state.entryOrders.values():[state.entryOrders.get(orderId)];", "const orders=!orderId?state.entryOrders.values():[state.entryOrders.get(orderId)];")
s=s.replace("if(event.type.startsWith('MANUAL_')||event.type==='RECONCILIATION_COMPLETED') {\n        for(const order of state.manualOrders.values()) {", "if(event.type.startsWith('MANUAL_')) {\n        const payload=event.payload as any,orderId=payload?.orderId??payload?.order?.id;\n        const manualRows=reconciliationTiming.active()&&orderId?[state.manualOrders.get(orderId)]:reconciliationTiming.active()&&payload?.intent?.id?[...state.manualOrders.values()].filter(row=>row.intentId===payload.intent.id):state.manualOrders.values();\n        for(const order of manualRows) {\n          if(!order)continue;")
p.write_text(s,encoding='utf-8')
