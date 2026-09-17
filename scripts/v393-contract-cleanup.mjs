import fs from 'node:fs';
const edit=(file,fn)=>{const before=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),after=fn(before);if(after!==before)fs.writeFileSync(file,after);};
edit('packages/core/src/compactEntry.ts',s=>{
  s=s.replace("deterministicOpportunityNonAuthoritative:p.opportunityEvidence??null,",'');
  for(const forbidden of ['preferredDirection','SHORT_ONLY','LONG_ONLY','15mDirectionAuthority','allowedDirections'])if(s.includes(forbidden))throw new Error(`V393_PROMPT_DIRECTION_HINT_REMAINS:${forbidden}`);
  return s;
});
edit('packages/contracts/src/ai.ts',s=>{
  s=s.replace("if(place&&(!d.acceptablePriceRange||d.idealPrice===null||d.horizonMinutes===null||d.quantityUnits===null))","if(place&&(!d.acceptablePriceRange||d.idealPrice===null||d.horizonMinutes===null||d.quantityUnits===null||d.profitTakePlan===null))");
  s=s.replace("message:'PLACE requires quantityUnits and explicit price/range/horizon'","message:'PLACE requires quantityUnits, explicit price/range/horizon and TP'");
  s=s.replace("const profitTake={type:['object','null'],","const profitTake={type:'object',");
  return s;
});
edit('apps/engine/src/services/preAiExecutionEnvelope.ts',s=>{
  const anchor="const LONG=sideCapacity('LONG'),SHORT=sideCapacity('SHORT'),atr1=Math.max(Number(market.technical['1m'].atr14??0),q.tickSize),bandMin=Math.max(q.tickSize,q.last-atr1*.8),bandMax=q.last+atr1*.8;";
  const cap="for(const side of [LONG,SHORT])side.maxQuantityUnits=Math.min(side.maxQuantityUnits,roundDownUnits(side.maxNotionalUsd/Math.max(bandMax,q.ask,q.last),q.stepSize));";
  if(!s.includes(cap)){if(!s.includes(anchor))throw new Error('V393_ENVELOPE_CAP_ANCHOR_MISSING');s=s.replace(anchor,`${anchor}\n  ${cap}`);}return s;
});
edit('apps/engine/src/services/aiFabric.ts',s=>{
  s=s.replace("import { validateOpportunityDecision } from './opportunityEvidence.js';\n",'');
  const veto="  if(packet.opportunityEvidence){const invalid=validateOpportunityDecision(d,packet.opportunityEvidence);if(invalid)throw new Error('AI_OUTPUT_INVALID: '+invalid);}\n";
  s=s.replace(veto,'');
  if(s.includes('validateOpportunityDecision('))throw new Error('V393_AI_PARSER_DIRECTION_VETO_REMAINS');
  return s;
});
console.log('V3.9.3 contract cleanup applied');
