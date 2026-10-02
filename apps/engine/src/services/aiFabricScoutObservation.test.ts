import {afterEach,describe,expect,it,vi} from 'vitest';
import {AiFabric,canonicalAiBackend} from './aiFabric.js';
import {loadAiResources} from '../config/aiResourceLoader.js';
import {harness} from './tradingQualityTestHarness.js';

const annotation={symbol:'TESTUSDT',summary:'Observation only',keyEvidence:[],contradictions:[],missingEvidence:[],attentionScore:.5};
function fixture(scoutUrl='http://independent.invalid:1234/v1'){
  const h=harness();h.state.settings.ai.scoutEnabled=true;h.state.settings.ai.decisionTimeoutMs=180_000;
  h.state.settings.aiResources=h.state.settings.aiResources.map(resource=>({...resource,enabled:true,
    baseUrl:resource.role==='PRIMARY_BRAIN'?'http://localhost:1234/v1':scoutUrl}));
  h.state.aiResources=loadAiResources(h.state.settings);
  const ai=new AiFabric(h.state,h.bus,{} as never),runJson=vi.spyOn((ai as any).openAi,'runJson').mockImplementation(async(args:any)=>({
    value:args.parse(annotation),raw:{__zdjParsedDecision:annotation},inputTokens:1,outputTokens:1,finishReason:'stop',modelIdentity:null,
    timing:{requestMs:1,parseMs:0,retryMs:0}}));
  return {...h,ai,runJson};
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('budgeted independent Scout observations',()=>{
  it.each(['http://127.0.0.1:1234/v1/','http://localhost:1234','http://[::1]:1234/','http://localhost:1234/openai/v1','http://127.0.0.1:1234/api/v1'])('skips shared backend %s without a model request',url=>{
    const h=fixture(url);return expect(h.ai.observeScout(h.packet)).resolves.toEqual({status:'SKIPPED',reason:'SKIPPED_SHARED_BACKEND'}).then(()=>{
      expect(h.runJson).not.toHaveBeenCalled();expect(h.state.aiRuns).toHaveLength(0);
    });
  });
  it('normalizes local aliases and API suffix while keeping independent ports distinct',()=>{
    expect(canonicalAiBackend('http://LOCALHOST:1234/v1/')).toBe(canonicalAiBackend('http://127.0.0.1:1234'));
    expect(canonicalAiBackend('http://localhost:1235/v1')).not.toBe(canonicalAiBackend('http://localhost:1234/v1'));
    expect(canonicalAiBackend('invalid')).toBeNull();
  });
  it.each(['REVIEW_OWED','PRIMARY_ACTIVE','SCOUT_BUSY'] as const)('does not queue while %s',async reason=>{
    const h=fixture();
    if(reason==='REVIEW_OWED')h.ai.noteReviewOwed();
    else{const role=reason==='PRIMARY_ACTIVE'?'PRIMARY_BRAIN':'SCOUT',resource=h.state.aiResources.find(row=>row.role===role)!;
      (h.ai as any).load.get(resource.id).active=1;}
    expect(await h.ai.observeScout(h.packet)).toEqual({status:'SKIPPED',reason:`SKIPPED_${reason}`});
    expect(h.runJson).not.toHaveBeenCalled();
  });
  it('uses the independent backend with a 30s local budget, SHADOW provenance and no handoff',async()=>{
    const h=fixture();expect(await h.ai.observeScout(h.packet)).toEqual({status:'COMPLETED',annotation});
    expect(h.runJson).toHaveBeenCalledOnce();expect(h.runJson.mock.calls[0][0]).toMatchObject({baseUrl:'http://independent.invalid:1234/v1',timeoutMs:30_000,maxOutputTokens:600});
    expect(h.state.settings.ai.decisionTimeoutMs).toBe(180_000);
    expect(h.state.aiRuns[0]).toMatchObject({role:'SCOUT',requestSource:'SHADOW',scoutHandoff:false,status:'COMPLETED',triggerReason:'SAMPLED_SCOUT_OBSERVATION',runKind:'SCOUT_OBSERVATION_RUN'});
    expect(h.state.entryIntents.size).toBe(0);expect(h.state.entryOrders.size).toBe(0);
  });
});
