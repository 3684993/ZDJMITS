import {describe,expect,it} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {loadAiResources} from './aiResourceLoader.js';

describe('AI resource loader',()=>{
  it('always omits legacy enabled Scout resources while keeping the enabled Primary Brain',()=>{
    const settings=SystemSettingsSchema.parse({
      ...defaults,
      ai:{...defaults.ai,scoutEnabled:true},
      aiResources:defaults.aiResources.map(resource=>resource.role==='SCOUT'?{...resource,enabled:true}:{...resource,enabled:true}),
    });

    expect(settings.aiResources.find(resource=>resource.role==='SCOUT')?.enabled).toBe(true);
    expect(settings.aiResources.find(resource=>resource.role==='PRIMARY_BRAIN')?.enabled).toBe(true);
    const resources=loadAiResources(settings);

    expect(resources.filter(resource=>resource.role==='SCOUT')).toHaveLength(0);
    expect(resources.filter(resource=>resource.role==='PRIMARY_BRAIN')).toHaveLength(1);
    expect(resources[0]).toMatchObject({role:'PRIMARY_BRAIN',model:'qwen/qwen3.8-27b'});
  });
});
