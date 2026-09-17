import {it,expect} from 'vitest';
import {Worker} from 'node:worker_threads';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TradingQualityV393EvidenceStore} from './tradingQualityV393EvidenceStore.js';

it('runs compiled evidence worker in an isolated database, without trading authority',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'v393-observer-')),file=path.join(dir,'evidence.sqlite');
 const manifest={experimentId:'worker-integration',environment:'TESTNET',accountScope:'account-test',codeHead:'abcdef1234',configHash:'config123',policyVersion:'V393-SHADOW-1',metricVersion:'V393-MARK-1',ruleHash:'rule1234',analysisPlanHash:'analysis1',decisionStartAt:1000,entryEnrollmentEndAt:10000,followupEndAt:20000,authoritativeClock:'SYSTEM_UTC',enrollmentRuleVersion:'V393-ENROLL-1',transitionalRule:'BASELINE_PREEXISTING_ORDER_IS_TRANSITIONAL',exclusionReasons:[],runtimeSessions:[],createdAt:1000};
 const worker=new Worker(new URL('../workers/tradingQualityObserverWorker.ts',import.meta.url),{execArgv:['--import','tsx/esm'],workerData:{file,manifest}});
 try{
  const reply=new Promise<any>((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
  worker.postMessage({now:2000,records:[],intents:[],orders:[],fills:[],runs:[],positions:[],candidates:[],quotes:[]});
  expect(await reply).toMatchObject({status:'READY',authorization:'NONE',safetyIntegrity:'INCONCLUSIVE',measurementReadiness:'INCONCLUSIVE',economicAcceptance:'INCONCLUSIVE',counts:{enrolled:0,positions:0}});
  await worker.terminate();
  const store=new TradingQualityV393EvidenceStore(file);
  expect(store.snapshot(manifest.experimentId,2000)).toMatchObject({manifest,enrollment:[],evidence:[],authorization:'NONE'});store.close();
 }finally{await worker.terminate();rmSync(dir,{recursive:true,force:true});}
},10000);
