import {describe,expect,it} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {loadAiResources} from './aiResourceLoader.js';

describe('AI resource loader',()=>{
  it('keeps enabled Scout and Primary Brain resources available to the runtime',()=>{
    const settings=SystemSettingsSchema.parse({
      ...defaults,
      ai:{...defaults.ai,scoutEnabled:true},
      aiResources:defaults.aiResources.map(resource=>resource.role==='SCOUT'?{...resource,enabled:true}:{...resource,enabled:true}),
    });

    expect(settings.aiResources.find(resource=>resource.role==='SCOUT')?.enabled).toBe(true);
    expect(settings.aiResources.find(resource=>resource.role==='PRIMARY_BRAIN')?.enabled).toBe(true);
    expect(settings.aiResources.find(resource=>resource.role==='REVIEW_BRAIN')?.enabled).toBe(true);
    const resources=loadAiResources(settings);

    expect(resources.filter(resource=>resource.role==='SCOUT')).toHaveLength(1);
    expect(resources.filter(resource=>resource.role==='PRIMARY_BRAIN')).toHaveLength(1);
    expect(resources.filter(resource=>resource.role==='REVIEW_BRAIN')).toHaveLength(1);
    expect(resources.find(resource=>resource.role==='PRIMARY_BRAIN')).toMatchObject({role:'PRIMARY_BRAIN',model:'qwen/qwen3.8-27b'});
    expect(resources.find(resource=>resource.role==='SCOUT')).toMatchObject({role:'SCOUT',model:'qwen3.5:9b'});
    expect(resources.find(resource=>resource.role==='REVIEW_BRAIN')).toMatchObject({role:'REVIEW_BRAIN',baseUrl:'http://127.0.0.1:8083/v1'});
  });
});
