import {describe,expect,it} from 'vitest';
import path from 'node:path';
import {EngineRuntime,applyStartupSafetyLatch} from './appRuntime.js';
import {RuntimeState} from '../state/runtimeState.js';
import {RuntimeControlService} from '../services/runtimeControlService.js';
import {EventBus} from '../events/eventBus.js';

describe('startup Entry safety latch',()=>{
  it('turns a persisted RUNNING authority into an immutable startup pause before dispatch',async()=>{
    const root=path.resolve(process.cwd(),'../..'),runtime=await EngineRuntime.createTestHarness({configDir:path.join(root,'config'),dataDir:path.join(root,'data-test')});
    try{
      runtime.state.runtimeControl={...runtime.state.runtimeControl,mode:'RUNNING',reasonCode:'NONE',autoResume:true,entrySafetyMode:'AUTO'};
      runtime.state.executionGovernance={...runtime.state.executionGovernance,mode:'AUTO_RUNNING'};
      const restarted=new RuntimeState(runtime.state.settings);restarted.restore(runtime.state.serialize());
      const proof=applyStartupSafetyLatch(restarted,123456);
      restarted.account={...restarted.account,status:'READY',asOf:Date.now(),reason:null};
      const control=new RuntimeControlService(restarted,new EventBus());
      expect(proof.previous).toMatchObject({mode:'RUNNING',autoResume:true,executionGovernance:'AUTO_RUNNING'});
      expect(restarted.runtimeControl).toMatchObject({mode:'PAUSED_MANUAL',reasonCode:'STARTUP_RECOVERY_REQUIRED',pauseSource:'AUTO',autoResume:false,lastTransitionAt:123456});
      expect(control.canDispatch()).toBe(false);
      control.evaluate(true);expect(restarted.runtimeControl.mode).toBe('PAUSED_MANUAL');expect(control.canDispatch()).toBe(false);
    }finally{runtime.stop();}
  });
});
