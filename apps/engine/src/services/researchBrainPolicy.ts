export const RESEARCH_OUTPUT_TYPES=['HYPOTHESIS','FEATURE_IDEA','ALGORITHM_PROPOSAL','CONTRADICTION','DATA_QUALITY_QUESTION'] as const;
export type ResearchOutputType=typeof RESEARCH_OUTPUT_TYPES[number];
export type ResearchProposal={type:ResearchOutputType;text:string;features?:string[]};
export function validateResearchProposal(value:unknown):ResearchProposal{
  if(!value||typeof value!=='object')throw new Error('RESEARCH_OUTPUT_INVALID');const v=value as any;
  if(!RESEARCH_OUTPUT_TYPES.includes(v.type))throw new Error('RESEARCH_OUTPUT_TYPE_FORBIDDEN');
  const text=String(v.text??'').trim();if(!text)throw new Error('RESEARCH_OUTPUT_EMPTY');
  if(/ENTRY_INTENT|PLACE_LONG|PLACE_SHORT|CREATE_ORDER|下单/i.test(text))throw new Error('RESEARCH_TRADING_ACTION_FORBIDDEN');
  return{type:v.type,text,features:Array.isArray(v.features)?v.features.map(String):undefined};
}
export const RESEARCH_BRAIN_POLICY={priority:'LOW',idleOnly:true,maxRunsPerHour:1,queueLimit:1,entryIntentPermission:false,orderPermission:false,workflow:['HYPOTHESIS','REPLAY','WALK_FORWARD','ABLATION','SHADOW','HUMAN_REVIEW']} as const;
