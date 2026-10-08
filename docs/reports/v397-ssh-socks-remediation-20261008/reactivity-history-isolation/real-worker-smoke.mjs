// Offline structural smoke. Unique OS-temp DB; no live data, adapter or network.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {SystemSettingsSchema} from '@zdj/contracts';
const root=process.cwd(),load=file=>import(pathToFileURL(path.join(root,'apps/engine/dist',file)).href);
const [{RuntimeState},{EventBus},{TradingQualityCollector}]=await Promise.all([load('state/runtimeState.js'),load('events/eventBus.js'),load('services/tradingQualityCollector.js')]);
const settings=SystemSettingsSchema.parse(JSON.parse(readFileSync(path.join(root,'config/settings.default.json'),'utf8')));
const state=new RuntimeState(settings),bus=new EventBus(),dir=mkdtempSync(path.join(tmpdir(),'zdj-reactivity-worker-')),file=path.join(dir,'evidence.sqlite');
if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep)||!path.basename(dir).startsWith('zdj-reactivity-worker-'))throw Error('Temporary boundary failed');
const collector=new TradingQualityCollector(file,state,bus,{historyWorker:true});
try{
  const deadline=Date.now()+15000;
  while(!state.tradingQualityEvidenceReady&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
  if(!state.tradingQualityEvidenceReady)throw Error('Worker initialization failed: '+JSON.stringify(collector.health()));
  const now=Date.now();state.entryIntents.set('offline-smoke-intent',{id:'offline-smoke-intent',symbol:'BTCUSDT',side:'LONG',brainRunId:'offline-smoke-run',createdAt:now});
  bus.publish('ENTRY_SUBMIT_ATTEMPTED',{intentId:'offline-smoke-intent'},'BTCUSDT');
  collector.tick(now);
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    let episodes=0;
    while(Date.now()<deadline){episodes=Number(db.prepare('SELECT count(*) n FROM tq_episodes').get().n);if(episodes)break;await new Promise(r=>setTimeout(r,20));}
    if(episodes!==1||collector.health().history.authorization!=='NONE')throw Error('Projection did not complete: '+JSON.stringify(collector.health()));
    const synchronousEventCount=Number(db.prepare("SELECT count(*) n FROM tq_facts WHERE kind='events'").get().n);
    if(synchronousEventCount!==1)throw Error('Pre-wire event missing');
    console.log(JSON.stringify({mode:'OFFLINE_UNIQUE_TEMP_NO_EXCHANGE',result:'PASS',episodes,synchronousEventCount,worker:collector.health().history,environment:settings.connections.exchange.environment,executionMode:settings.connections.executionMode,exchangeWrites:0}));
  }finally{db.close();}
}finally{collector.close();await new Promise(r=>setTimeout(r,100));rmSync(dir,{recursive:true,force:true});}
