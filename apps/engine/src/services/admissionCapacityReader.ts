/**
 * The read-only bridge between the installed portfolio admission and the capacity surfaces that must agree
 * with it. It deliberately imports nothing from the ledger: a writer that reached for the authority module
 * directly could ask a *different* instance, which is exactly the second-authority shape this project has
 * been removing. The runtime installs one admission on state; this reads that one, or reports no verdict.
 */

/** The part of the ledger's capacity facts a capacity surface is allowed to consume. */
export type AdmissionCapacityView={
  admitsAnyPositiveNotional:boolean;
  maxNewRiskNotionalUsd:number;
  maxNewRiskNotionalUsdBySide:{LONG:number;SHORT:number};
  evidenceBlockers:string[];
  sizeIndependentRefusals:string[];
  firstBinding:{kind:string;code:string;gate:string|null;limitUsd:number|null;usedUsd:number|null;headroomUsd:number|null;shortfallUsd:number|null;detail:string}|null;
};

export type AdmissionCapacityInputs={riskAdmissionCeilingUsd:number|null;riskAdmissionRefusal:string|null;
  riskAdmissionNote:{gate:string|null;detail:string|null}|null;capacity:AdmissionCapacityView|null};

const NOTHING:{riskAdmissionCeilingUsd:number|null;riskAdmissionRefusal:string|null;riskAdmissionNote:null;capacity:null}=
  {riskAdmissionCeilingUsd:null,riskAdmissionRefusal:null,riskAdmissionNote:null,capacity:null};

/** The one definition of the mode where the Engine analyses but never writes. */
export function analysisOnlyMode(state:any){const connections=state?.settings?.connections;return connections?.executionMode==='READ_ONLY'&&connections?.exchange?.environment==='TESTNET';}

/**
 * The two numbers a capacity calculation needs from the gate that will judge the order.
 *
 * "No installed admission" returns no verdict at all, which the headroom layer leaves out of its arithmetic;
 * it is never read as unlimited room and never as a refusal. Only a denial that no smaller order can answer
 * is quoted as a refusal — a dollar ceiling stays the number it is.
 *
 * Analysis-only mode is exempt by design: there the admission is evaluated once and published as an
 * observation (`allowed:false, analysisOnly:true`), because nothing it refuses could have been written anyway.
 * Letting it gate dispatch there would silence the market evidence the mode exists to produce.
 */
export function readAdmissionCapacity(state:any,symbol:string,side:'LONG'|'SHORT',now=Date.now()):AdmissionCapacityInputs{
  if(analysisOnlyMode(state))return NOTHING;
  const ledger=state?.riskAdmission;
  if(!ledger||typeof ledger.capacityFacts!=='function')return NOTHING;
  let facts:AdmissionCapacityView|null=null;
  try{facts=ledger.capacityFacts(now,symbol)as AdmissionCapacityView;}
  catch{facts=null;} // A capacity read must never break a dispatch: with no verdict this layer says nothing.
  return inputsFor(facts,side);
}

/** Split out so the same precedence is testable without a runtime state object. */
export function inputsFor(facts:AdmissionCapacityView|null,side:'LONG'|'SHORT'):AdmissionCapacityInputs{
  if(!facts)return NOTHING;
  const refusal=facts.evidenceBlockers.length?facts.evidenceBlockers[0]:facts.sizeIndependentRefusals.length?facts.sizeIndependentRefusals[0]:null;
  return{riskAdmissionCeilingUsd:refusal?null:Math.max(0,Number(facts.maxNewRiskNotionalUsdBySide?.[side]??0)),riskAdmissionRefusal:refusal,
    riskAdmissionNote:{gate:facts.firstBinding?.gate??null,detail:facts.firstBinding?.detail??null},capacity:facts};
}

/** The book-level answer a display page needs: is there any size this gate would accept at all, and if not, what number says so. */
export type AdmissionBookSummary={hasVerdict:boolean;exhausted:boolean;code:string|null;gate:string|null;detail:string|null;
  ceilingUsdBySide:{LONG:number;SHORT:number};reasons:string[]};

/**
 * The gate's verdict about the book, with no candidate in it. Read once per projection: money capacity and
 * permission are different questions, and a page that answered the second from the first is how a cockpit
 * came to publish "both sides executable" beside a gate that refused every order.
 */
export function bookAdmissionSummary(state:any,now=Date.now()):AdmissionBookSummary{
  const ledger=state?.riskAdmission;
  const none:AdmissionBookSummary={hasVerdict:false,exhausted:false,code:null,gate:null,detail:null,ceilingUsdBySide:{LONG:0,SHORT:0},reasons:[]};
  if(!ledger||typeof ledger.capacityFacts!=='function')return none;
  let facts:AdmissionCapacityView|null=null;
  try{facts=ledger.capacityFacts(now,null)as AdmissionCapacityView;}
  catch{facts=null;}
  if(!facts)return none;
  const reasons=[...new Set([...facts.evidenceBlockers,...facts.sizeIndependentRefusals])];
  return{hasVerdict:true,exhausted:facts.admitsAnyPositiveNotional===false,
    code:facts.firstBinding?.code??reasons[0]??null,gate:facts.firstBinding?.gate??null,detail:facts.firstBinding?.detail??null,
    ceilingUsdBySide:{LONG:Math.max(0,Number(facts.maxNewRiskNotionalUsdBySide?.LONG??0)),SHORT:Math.max(0,Number(facts.maxNewRiskNotionalUsdBySide?.SHORT??0))},reasons};
}
