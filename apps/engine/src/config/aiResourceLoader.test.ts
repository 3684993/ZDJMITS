import {describe,expect,it} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {loadAiResources} from './aiResourceLoader.js';

describe('AI resource loader',()=>{
  it('omits enabled Scout resources when Scout is retired while keeping Primary Brain',()=>{
    const settings=SystemSettingsSchema.parse({
      ...defaults,
      ai:{...defaults.ai,scoutEnabled:false},
      aiResources:defaults.aiResources.map(resource=>resource.role==='SCOUT'?{...resource,enabled:true}:resource),
    });

    const resources=loadAiResources(settings);

    expect(resources.some(resource=>resource.role==='SCOUT')).toBe(false);
    expect(resources).toEqual(expect.arrayContaining([
      expect.objectContaining({role:'PRIMARY_BRAIN',model:'qwen/qwen3.8-27b'}),
    ]));
  });
});
