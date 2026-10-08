import {parentPort,workerData} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {TradingQualityCollector} from '../services/tradingQualityCollector.js';

// This worker can only project the additive evidence database. It receives no
// adapter, SettingsStore, RuntimeState history, credential secret or lifecycle API.
const collector=new TradingQualityCollector(workerData.file,new RuntimeState(workerData.settings),new EventBus());
parentPort!.postMessage({initialized:true,status:'READY',asOf:Date.now(),authorization:'NONE'});
parentPort!.on('message',({now,settings})=>{
  const start=performance.now();
  try{collector.historicalWork(now,settings);parentPort!.postMessage({status:'READY',asOf:now,completedAt:Date.now(),durationMs:performance.now()-start,authorization:'NONE'});}
  catch(error){parentPort!.postMessage({status:'DEGRADED',asOf:now,completedAt:Date.now(),durationMs:performance.now()-start,error:String(error),authorization:'NONE'});}
});
