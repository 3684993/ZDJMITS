import {expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EngineRuntime} from '../runtime/appRuntime.js';
import {TradingQualityRuntimeObserver} from './tradingQualityRuntimeObserver.js';

it('rotates a fresh prospective manifest exactly at explicit startup Resume',async()=>{
  const root=path.resolve(process.cwd(),'../..'),dir=mkdtempSync(path.join(tmpdir(),'v393-resume-cohort-')),runtime=await EngineRuntime.createTestHarness({configDir:path.join(root,'config'),dataDir:dir});let observer:TradingQualityRuntimeObserver|null=null;
  try{
    observer=new TradingQualityRuntimeObserver(dir,runtime.state);const old=observer.manifest.experimentId,result=observer.beginProspectiveCohort(1_789_461_800_000),saved=JSON.parse(readFileSync(path.join(dir,'v393-experiment-manifest.json'),'utf8'));
    expect(result).toMatchObject({status:'STARTING',decisionStartAt:1_789_461_800_000,previousExperimentId:old,authorization:'NONE'});expect(saved).toMatchObject({experimentId:result.experimentId,decisionStartAt:1_789_461_800_000,codeHead:observer.manifest.codeHead,configHash:observer.manifest.configHash});expect(saved.experimentId).not.toBe(old);
  }finally{observer?.close();runtime.stop();rmSync(dir,{recursive:true,force:true});}
});
