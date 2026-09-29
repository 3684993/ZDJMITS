import { testnetFundsOnlyEntry } from '@zdj/core';
/**
 * The read-only bridge between the installed portfolio admission and the capacity surfaces that must agree
 * with it. It deliberately imports nothing from the ledger: a writer that reached for the authority module
 * directly could ask a *different* instance, which is exactly the second-authority shape this project has
 * been removing. The runtime installs one admission on state; this reads that one, or reports no verdict.
 */

/** The part of the ledger's capacity facts a capacity surface is allowed to consume. */
export type AdmissionCapacityView={
  evaluatedAt:number;scope?:'BOOK'|'CANDIDATE_CONTEXT';snapshotHash?:string;profileVersion?:string;settingsVersion?:string|null;riskGeneration?:number;authorityVersions?:Record<string,unknown>;coverage?:Record<string,string>;complete?:boolean;
  quoteAsset?:string|null;leverage?:number|null;leverageFact?:string|null;pendingLineage?:Array<{id:string;dedupeKey?:string;symbol:string;side:string;notionalUsd:number;marginUsd?:number;quoteAsset:string|null;source?:string;ownerState?:string;factStatus:string}>;
  gates?:Array<{name:string;reason:string;unit:string;limitUsd:number;usedUsd:number;maxAdditionalUsd:number;shortfallUsd?:number;candidateImpactUsd?:number;candidateShortfallUsd?:number;clusterKey?:string|null}>;
  firstBinding?:{kind:string;code:string;gate:string|null;unit?:string|null;limitUsd:number|null;usedUsd:number|null;headroomUsd:number|null;shortfallUsd:number|null;detail:string}|null;
  admitsAnyPositiveNotional:boolean;
  maxNewRiskNotionalUsd:number;
  maxNewRiskNotionalUsdBySide:{LONG:number;SHORT:number};
  evidenceBlockers:string[];
  sizeIndependentRefusals:string[];
  overdueHandoffs?:number;
  oldestOverdueHours?:number|null;
};

export type AdmissionCapacityInputs={riskAdmissionCeilingUsd:number|null;riskAdmissionRefusal:string|null;
  riskAdmissionNote:{gate:string|null;detail:string|null}|null;capacity:AdmissionCapacityView|null};

const NOTHING:{riskAdmissionCeilingUsd:number|null;riskAdmissionRefusal:string|null;riskAdmissionNote:null;capacity:null}=
  {riskAdmissionCeilingUsd:null,riskAdmissionRefusal:null,riskAdmissionNote:null,capacity:null};
const UNAVAILABLE:AdmissionCapacityInputs={riskAdmissionCeilingUsd:null,riskAdmissionRefusal:'RISK_ADMISSION_UNAVAILABLE',
  riskAdmissionNote:{gate:null,detail:'Portfolio risk admission did not return a valid capacity result; new Entry capacity is unavailable'},capacity:null};

/** The one definition of the mode where the Engine analyses but never writes. */
export function analysisOnlyMode(state:any){const connections=state?.settings?.connections;return connections?.executionMode==='READ_ONLY'&&connections?.exchange?.environment==='TESTNET';}

/**
 * The two numbers a capacity calculation needs from the gate that will judge the order.
 *
 * An absent or failed portfolio admission is unavailable and fails closed in execution mode. It remains
 * distinct from a valid zero ceiling. Only analysis-only mode is exempt because it cannot write orders.
 *
 * Analysis-only mode is exempt by design: there the admission is evaluated once and published as an
 * observation (`allowed:false, analysisOnly:true`), because nothing it refuses could have been written anyway.
 * Letting it gate dispatch there would silence the market evidence the mode exists to produce.
 */
export function readAdmissionCapacity(state:any,symbol:string,side:'LONG'|'SHORT',now=Date.now(),candidate?:{leverage:number;leverageFact?:string|null;quoteAsset:string}):AdmissionCapacityInputs{
  if(analysisOnlyMode(state)||testnetFundsOnlyEntry(state.settings))return NOTHING;
  const ledger=state?.riskAdmission;
  if(!ledger||typeof ledger.capacityFacts!=='function')return UNAVAILABLE;
  let facts:AdmissionCapacityView|null=null;
  try{facts=ledger.capacityFacts(now,symbol,candidate)as AdmissionCapacityView;}
  catch{facts=null;}
  return inputsFor(facts,side);
}

/** Split out so the same precedence is testable without a runtime state object. */
export function inputsFor(facts:AdmissionCapacityView|null,side:'LONG'|'SHORT'):AdmissionCapacityInputs{
  if(!facts||!Number.isFinite(Number(facts.evaluatedAt))||!facts.maxNewRiskNotionalUsdBySide
    ||!Number.isFinite(Number(facts.maxNewRiskNotionalUsdBySide.LONG))||!Number.isFinite(Number(facts.maxNewRiskNotionalUsdBySide.SHORT))
    ||!Array.isArray(facts.evidenceBlockers)||!Array.isArray(facts.sizeIndependentRefusals))return UNAVAILABLE;
  const refusal=facts.evidenceBlockers.length?facts.evidenceBlockers[0]:facts.sizeIndependentRefusals.length?facts.sizeIndependentRefusals[0]:null;
  return{riskAdmissionCeilingUsd:refusal?null:Math.max(0,Number(facts.maxNewRiskNotionalUsdBySide?.[side]??0)),riskAdmissionRefusal:refusal,
    riskAdmissionNote:{gate:facts.firstBinding?.gate??null,detail:facts.firstBinding?.detail??null},capacity:facts};
}

/** The book-level answer a display page needs: is there any size this gate would accept at all, and if not, what number says so. */
export type AdmissionBookSummary={status:'AVAILABLE'|'ZERO'|'UNAVAILABLE'|'NOT_APPLICABLE';hasVerdict:boolean;exhausted:boolean;code:string|null;gate:string|null;detail:string|null;
  /**
   * P4/R8: a ceiling that the gate never issued is `null`, not `0`. Zero is a real answer ("no positive
   * notional would be admitted"); NOT_APPLICABLE and UNAVAILABLE are the absence of an answer, and
   * publishing them as 0 is what made the cockpit show "$0 capacity" beside nine executable routes.
   * `enforced` says whether this gate is an Entry veto at all in the current mode.
   */
  ceilingUsdBySide:{LONG:number|null;SHORT:number|null}|null;enforced:boolean;reasons:string[];evaluatedAt:number;overdueHandoffs:number;oldestOverdueHours:number|null;
  scope?:'BOOK'|'CANDIDATE_CONTEXT';snapshotHash?:string;profileVersion?:string;settingsVersion?:string|null;riskGeneration?:number;authorityVersions?:Record<string,unknown>;coverage?:Record<string,string>;gates?:AdmissionCapacityView['gates'];firstBinding?:AdmissionCapacityView['firstBinding'];pendingLineage?:AdmissionCapacityView['pendingLineage'];
  quoteAsset?:string|null;leverage?:number|null;leverageFact?:string|null};

/**
 * The gate's verdict about the book, with no candidate in it. Read once per projection: money capacity and
 * permission are different questions, and a page that answered the second from the first is how a cockpit
 * came to publish "both sides executable" beside a gate that refused every order.
 */
export function bookAdmissionSummary(state:any,now=Date.now()):AdmissionBookSummary{
  const ledger=state?.riskAdmission;
  const none:AdmissionBookSummary={status:'NOT_APPLICABLE',hasVerdict:false,exhausted:false,code:null,gate:null,detail:null,ceilingUsdBySide:null,enforced:false,reasons:[],evaluatedAt:0,overdueHandoffs:0,oldestOverdueHours:null};
  const unavailable:AdmissionBookSummary={status:'UNAVAILABLE',hasVerdict:false,exhausted:false,code:'RISK_ADMISSION_UNAVAILABLE',gate:null,
    detail:'Portfolio risk admission did not return a valid capacity result; new Entry capacity is unavailable',ceilingUsdBySide:null,enforced:true,
    reasons:['RISK_ADMISSION_UNAVAILABLE'],evaluatedAt:now,overdueHandoffs:0,oldestOverdueHours:null};
  // Analysis-only writes nothing, so there is no new risk for the gate to deny: its book verdict must not
  // silence the market evidence this mode exists to produce, exactly as the dispatch path must not.
  if(analysisOnlyMode(state)||testnetFundsOnlyEntry(state.settings))return {...none,detail:testnetFundsOnlyEntry(state.settings)?'TESTNET_FUNDS_ONLY_ENTRY: portfolio risk is observational; see risk diagnostics':null};
  if(!ledger||typeof ledger.capacityFacts!=='function')return unavailable;
  let facts:AdmissionCapacityView|null=null;
  try{facts=ledger.capacityFacts(now,null)as AdmissionCapacityView;}
  catch{facts=null;}
  if(!facts||typeof facts.evaluatedAt!=='number'||!Number.isFinite(facts.evaluatedAt)||!facts.maxNewRiskNotionalUsdBySide
    ||typeof facts.maxNewRiskNotionalUsdBySide.LONG!=='number'||!Number.isFinite(facts.maxNewRiskNotionalUsdBySide.LONG)
    ||typeof facts.maxNewRiskNotionalUsdBySide.SHORT!=='number'||!Number.isFinite(facts.maxNewRiskNotionalUsdBySide.SHORT)
    ||!Array.isArray(facts.evidenceBlockers)||!Array.isArray(facts.sizeIndependentRefusals))return unavailable;
  const reasons=[...new Set([...facts.evidenceBlockers,...facts.sizeIndependentRefusals])];
  const ceilingUsdBySide={LONG:Math.max(0,Number(facts.maxNewRiskNotionalUsdBySide?.LONG??0)),SHORT:Math.max(0,Number(facts.maxNewRiskNotionalUsdBySide?.SHORT??0))};
  const status=facts.complete===false||facts.evidenceBlockers.length>0?'UNAVAILABLE':Math.max(ceilingUsdBySide.LONG,ceilingUsdBySide.SHORT)>0?'AVAILABLE':'ZERO';
  return{status,hasVerdict:true,enforced:true,exhausted:facts.admitsAnyPositiveNotional===false,evaluatedAt:Number(facts.evaluatedAt)||now,
    code:facts.firstBinding?.code??reasons[0]??null,gate:facts.firstBinding?.gate??null,detail:facts.firstBinding?.detail??null,
    ceilingUsdBySide,reasons,
    overdueHandoffs:Number(facts.overdueHandoffs??0),oldestOverdueHours:facts.oldestOverdueHours??null,scope:facts.scope,snapshotHash:facts.snapshotHash,
    profileVersion:facts.profileVersion,settingsVersion:facts.settingsVersion,riskGeneration:facts.riskGeneration,authorityVersions:facts.authorityVersions,coverage:facts.coverage,gates:facts.gates,firstBinding:facts.firstBinding,
    pendingLineage:facts.pendingLineage,quoteAsset:facts.quoteAsset,leverage:facts.leverage,leverageFact:facts.leverageFact};
}
