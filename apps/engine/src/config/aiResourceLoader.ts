import { AiResourceSchema, type AiResource, type SystemSettings } from '@zdj/contracts';

export function loadAiResources(settings: SystemSettings): AiResource[] {
  return settings.aiResources
    .filter(resource => resource.enabled && !(resource.role === 'SCOUT' && settings.ai?.scoutEnabled === false))
    .map(resource => AiResourceSchema.parse(resource));
}
