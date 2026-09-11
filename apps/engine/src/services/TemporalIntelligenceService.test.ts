import {it,expect,vi} from 'vitest';
import {TemporalIntelligenceService} from './temporalIntelligenceService.js';
it('keeps research off the live database and rejects case-insensitive aliases',()=>{
 const service=new TemporalIntelligenceService('D:/MITS/data',{publish:vi.fn()} as any);
 try{vi.stubEnv('ZDJ_OFFLINE_RESEARCH','0');service.start();expect(service.snapshot()).toMatchObject({status:'OFFLINE_ONLY',runtime:{workerCount:0}});expect(service.request()).toBe(false);
 vi.stubEnv('ZDJ_OFFLINE_RESEARCH','1');vi.stubEnv('ZDJ_RESEARCH_DB','d:/mits/DATA/zdj-settings.sqlite');expect(()=>service.start()).toThrow('RESEARCH_LIVE_DATABASE_FORBIDDEN');}
 finally{service.stop();vi.unstubAllEnvs();}
});
