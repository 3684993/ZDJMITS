import fs from 'node:fs';
const edit=(file,fn)=>{const before=fs.readFileSync(file,'utf8'),after=fn(before);if(after!==before)fs.writeFileSync(file,after);};
edit('packages/core/src/compactEntry.ts',s=>{
  s=s.replace("deterministicOpportunityNonAuthoritative:p.opportunityEvidence??null,",'');
  if(s.includes('preferredDirection')||s.includes('SHORT_ONLY')||s.includes('LONG_ONLY')||s.includes('15mDirectionAuthority'))throw new Error('V393_PROMPT_DIRECTION_HINT_REMAINS');
  return s;
});
edit('packages/contracts/src/ai.ts',s=>{
  s=s.replace("if(place&&(!d.acceptablePriceRange||d.idealPrice===null||d.horizonMinutes===null||d.quantityUnits===null))","if(place&&(!d.acceptablePriceRange||d.idealPrice===null||d.horizonMinutes===null||d.quantityUnits===null||d.profitTakePlan===null))");
  s=s.replace("message:'PLACE requires quantityUnits and explicit price/range/horizon'","message:'PLACE requires quantityUnits, explicit price/range/horizon and TP'");
  s=s.replace("const profitTake={type:['object','null'],","const profitTake={type:'object',");
  return s;
});
edit('apps/engine/src/services/preAiExecutionEnvelope.ts',s=>{
  s=s.replace("const LONG=sideCapacity('LONG'),SHORT=sideCapacity('SHORT'),atr1=Math.max(Number(market.technical['1m'].atr14??0),q.tickSize),bandMin=Math.max(q.tickSize,q.last-atr1*.8),bandMax=q.last+atr1*.8;","const LONG=sideCapacity('LONG'),SHORT=sideCapacity('SHORT'),atr1=Math.max(Number(market.technical['1m'].atr14??0),q.tickSize),bandMin=Math.max(q.tickSize,q.last-atr1*.8),bandMax=q.last+atr1*.8;\n  for(const side of [LONG,SHORT])side.maxQuantityUnits=Math.min(side.maxQuantityUnits,roundDownUnits(side.maxNotionalUsd/Math.max(bandMax,q.ask,q.last),q.stepSize));");
  return s;
});
console.log('V3.9.3 contract cleanup applied');
