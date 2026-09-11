import {describe,expect,it,vi} from 'vitest';
import {LiveValidationService} from './liveValidationService.js';
import {EventBus} from '../events/eventBus.js';

function fixture(){
  const state:any={settings:{connections:{exchange:{environment:'TESTNET'}},riskGovernance:{maxDailyDrawdownPct:.05}},executionGovernance:{mode:'AUTO_RUNNING',reason:'USER_ENABLED'},account:{assets:[]},entryOrders:new Map(),positions:new Map(),tradeRecords:new Map(),experienceSamples:new Map(),snapshots:new Map(),pool:{list:()=>[]},runtimeControl:{manualRiskOverride:null},reservationSummary:()=>({locks:[]})};
  const validation:any={validationId:'v',status:'AUTO_RUNNING',startedAt:1,requiredUntil:2,capitalEpochId:'c',sourceHash:'source',settingsHash:'settings'};
  const store:any={latestCapitalEpoch:()=>null,latestWeeklyLiveValidation:()=>validation,listValidationDailySummaries:()=>[],upsertWeeklyLiveValidation:vi.fn()};
  const service=new LiveValidationService(state,store,new EventBus(),null as any,{} as any,{} as any,{} as any,{} as any,{} as any,'x');
  return{state,store,service};
}
describe('observation never controls trading',()=>{
  it('invalidates a statistics segment without pausing execution',()=>{const h=fixture(),before={...h.state.executionGovernance};expect(h.service.invalidate('CODE_CHANGED')?.status).toBe('INVALIDATED');expect(h.state.executionGovernance).toEqual(before);expect(h.store.upsertWeeklyLiveValidation).toHaveBeenCalledOnce();});
  it('records the seven day checkpoint without pausing execution',async()=>{const h=fixture(),before={...h.state.executionGovernance};(h.service as any).refreshRiskBaseline=vi.fn();(h.service as any).sourceHash=vi.fn(async()=> 'source');(h.service as any).settingsHash=vi.fn(()=> 'settings');(h.service as any).dailySummary=vi.fn(async()=>({}));await h.service.tick();expect(h.service.getValidation()?.status).toBe('WEEKLY_REVIEW_PENDING');expect(h.state.executionGovernance).toEqual(before);});
});
