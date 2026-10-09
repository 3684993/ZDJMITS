export function primaryFailureClass(reason:string){
  if(/PROMPT_BUDGET|CONTEXT_BUDGET/.test(reason))return'PROMPT_BUDGET_UNAVAILABLE';
  if(/EIP_|MARKET_DATA_STALE|MISSING_LATEST_CLOSED/.test(reason))return'MARKET_STALE';
  if(/timeout|abort/i.test(reason))return'MODEL_TIMEOUT';
  if(/AI_SCHEMA|AI_OUTPUT_INVALID|acceptablePriceRange|target must|Zod|"code"\s*:/.test(reason))return'SCHEMA_INVALID';
  if(/AI_PRIMARY_CIRCUIT|AI_RESOURCE/.test(reason))return'AI_BUSY';
  return'MODEL_OR_CONTEXT_FAILURE';
}

/** Instance-local bounded telemetry. FAILED and model DATA_ERROR are never useful decisions. */
export class EffectivePrimaryCadence {
  private outcomes:Array<{at:number;symbol:string;effective:boolean;classification:string}>=[];
  private eligibleSince:number|null=null;private lastEvaluation:number|null=null;
  evaluate(preflightCount:number,now=Date.now()){
    if(!preflightCount||this.lastEvaluation===null||now-this.lastEvaluation>60_000)this.eligibleSince=preflightCount?now:null;
    else this.eligibleSince??=now;
    this.lastEvaluation=now;
    this.outcomes=this.outcomes.filter(x=>now-x.at<=3600_000).slice(-512);
  }
  outcome(symbol:string,classification:string,effective:boolean,now=Date.now()){
    this.outcomes.push({at:now,symbol,classification,effective});this.outcomes=this.outcomes.filter(x=>now-x.at<=3600_000).slice(-512);
  }
  projection(now=Date.now()){
    const effective=this.outcomes.filter(x=>x.effective),last=effective.at(-1)?.at??null;
    const gaps=effective.slice(1).map((x,i)=>x.at-effective[i]!.at).sort((a,b)=>a-b);
    const fresh=this.lastEvaluation!==null&&now-this.lastEvaluation<=60_000;
    const opportunityAgeMs=fresh&&this.eligibleSince!==null?now-Math.max(this.eligibleSince,last??this.eligibleSince):null;
    const windows=Array.from({length:12},(_,i)=>{const until=now-(11-i)*300_000,since=until-300_000,rows=this.outcomes.filter(x=>x.at>=since&&x.at<until);return{since,until,effective:rows.filter(x=>x.effective).length,failedOrInvalid:rows.filter(x=>!x.effective).length,distinctEffectiveSymbols:new Set(rows.filter(x=>x.effective).map(x=>x.symbol)).size};});
    return {metric:'EFFECTIVE_PRIMARY_DECISION_CADENCE',windowMs:3600_000,targetIntervalMs:300_000,effective:effective.length,failedOrInvalid:this.outcomes.length-effective.length,
      p90CompletionIntervalMs:gaps.length?gaps[Math.ceil(gaps.length*.9)-1]:null,lastEffectiveAt:last,preflightOpportunityAgeMs:opportunityAgeMs,
      status:!fresh?'UNKNOWN_TICK_COVERAGE':opportunityAgeMs===null?'NO_PREFLIGHT_CANDIDATE':opportunityAgeMs>600_000?'PREFLIGHT_GAP_10M':opportunityAgeMs>300_000?'PREFLIGHT_GAP_5M':'OBSERVING',
      eligibilityProof:'PREFLIGHT_ONLY_FULL_FROZEN_MENU_VERIFIED_AT_DISPATCH',sloAcceptance:'UNKNOWN_UNTIL_CONTINUOUS_ELIGIBILITY_REPLAY',windows};
  }
}
