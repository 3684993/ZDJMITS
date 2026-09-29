import { testnetFundsOnlyEntry } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import { privateAccountFresh } from './privateAccountReadiness.js';
import { entryDataError } from './entryFacts.js';
import { reservationDebitsAvailableFunds } from './entryFundingCommitment.js';
import { activeExecutionLeaseMargin } from './executionLease.js';
import { portfolioScopeObservation } from './entrySubmissionIdentity.js';
import { resolveUnderlying } from '@zdj/core';

/**
 * P4: one shared vocabulary for the three different questions the Entry chain kept asking each other.
 *
 * Before this, Capital Admission, Risk Readiness, runtime Readiness, Reservation and the Final/JIT
 * check each invented their own field for "may I place this order", so the same money fact was
 * recomputed five times with five names, and a risk number that is not an Entry permission (a zero
 * ceiling, a missing risk proof, a slot count, an historical claim) could still stop a submission.
 *
 * These three types are deliberately not interchangeable:
 *  - `CandidateAnalysisEligibility` - is this symbol worth spending a model on, right now?
 *  - `EntryExecutionPermit`        - may this exact order be submitted, on which facts?
 *  - `PortfolioRiskObservation`    - what does the portfolio look like? Never a permission.
 *
 * Under the precise TESTNET + TESTNET_ENABLED + funds-only condition the observation carries
 * `enforced:false`, and nothing in the permit reads an observation field.
 */

export type CandidateAnalysisEligibility={
  eligible:boolean;
  /** Why analysis is not worth spending now; a wait is not a refusal. */
  reasons:string[];
  disposition:'ANALYZE'|'WAIT'|'SKIP';
  evaluatedAt:number;
  facts:{marketFresh:boolean;dataError:string|null;modelAvailable:boolean;alreadyHeld:boolean};
};

export type EntryExecutionPermit={
  permitted:boolean;
  /** The single first cause. Later generic errors must not overwrite it. */
  firstCause:string|null;
  mode:{environment:string;executionMode:string;fundsOnly:boolean};
  facts:{
    privateFresh:boolean;
    quoteAsset:string|null;
    exchangeAvailableUsd:number|null;
    uncommittedReservationUsd:number|null;
    analysisEarmarkUsd:number|null;
    executableForNewReservationUsd:number|null;
    requiredMarginUsd:number|null;
    filtersComplete:boolean;
    authorizationValid:boolean;
    submissionIdentity:string|null;
    durableStorageReady:boolean;
  };
  evaluatedAt:number;
  expiresAt:number|null;
  factVersions:{capitalGeneration:number|null;marketFilterVersion:string|null;settingsVersion:number|null;portfolioObservationVersion:number|null};
  /** Portfolio facts travel with the permit for the record; they are not inputs to it. */
  observation:PortfolioRiskObservation;
};

export type PortfolioRiskObservation={
  enforced:false|true;
  basis:'TESTNET_FUNDS_ONLY_OBSERVATION'|'PORTFOLIO_RISK_ENFORCED';
  grossNotionalUsd:number|null;
  directionExposureUsd:Record<string,number|null>;
  clusterExposureUsd:number|null;
  stressLossUsd:number|null;
  humanPotentialUsd:number|null;
  capitalAtRiskUsd:number|null;
  positionCount:{used:number;max:number;pending:number;enforced:boolean};
  historicalPendingRiskUsd:number|null;
  riskProfileStatus:string|null;
  scopeObservations:Array<ReturnType<typeof portfolioScopeObservation>>;
  evaluatedAt:number;
  note:string;
};

const numberOrNull=(value:unknown)=>{if(value==null||value==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};

/**
 * Analysis eligibility is deliberately narrow. It never looks at money: a symbol that cannot be
 * afforded is still worth analysing for the next round, and a symbol already held is not "refused",
 * it is skipped.
 */
export function candidateAnalysisEligibility(state:RuntimeState,symbol:string,now=Date.now(),input:{modelAvailable?:boolean;dataNotReadyReasons?:string[]}={}):CandidateAnalysisEligibility{
  const market=state.snapshots.get(symbol);
  const dataError=market?entryDataError(market):(input.dataNotReadyReasons?.[0]??'MARKET_DATA_MISSING');
  const marketFresh=!dataError&&!(input.dataNotReadyReasons?.length??false);
  const held=[...state.positions.values()].some(row=>row.symbol===symbol);
  const reasons=[...(!marketFresh?[dataError??'MARKET_DATA_STALE']:[]),...(input.modelAvailable===false?['AI_RESOURCE_UNAVAILABLE']:[])];
  const disposition=held&&!testnetFundsOnlyEntry(state.settings)?'SKIP':reasons.length?'WAIT':'ANALYZE';
  return{eligible:disposition==='ANALYZE',reasons,disposition,evaluatedAt:now,
    facts:{marketFresh,modelAvailable:input.modelAvailable!==false,alreadyHeld:held,dataError:dataError??null}};
}

/**
 * The permit is the only Entry authority under funds-only. Every field is a money, identity,
 * freshness or exchange-legality fact; none of them is a portfolio-risk number. `observation` is
 * attached after the decision so the readback can show both without the second one able to change
 * the first.
 */
export function evaluateEntryExecutionPermit(input:{
  state:RuntimeState;symbol:string;side:'LONG'|'SHORT';quoteAsset:string;requiredMarginUsd:number;
  authorization:{valid:boolean;expiresAt:number|null;identity:string|null};
  filtersComplete:boolean;durableStorageReady:boolean;
  pendingScopeObservations?:Array<ReturnType<typeof portfolioScopeObservation>>;
  now?:number;excludeReservationId?:string;excludeLeaseId?:string;
}):EntryExecutionPermit{
  const now=input.now??Date.now(),state=input.state;
  const environment=String(state.settings.connections?.exchange?.environment??''),executionMode=String(state.settings.connections?.executionMode??'');
  const fundsOnly=testnetFundsOnlyEntry(state.settings);
  const asset=(state.account.assets??[]).find((row:any)=>row.asset===input.quoteAsset);
  const available=numberOrNull(asset?.availableBalance);
  const committed=[...state.entryReservations.values()]
    .filter((row:any)=>row.id!==input.excludeReservationId&&row.quoteAsset===input.quoteAsset&&reservationDebitsAvailableFunds(state,row,now))
    .reduce((sum:number,row:any)=>sum+Math.max(0,numberOrNull(row.marginUsd)??0),0);
  const earmark=activeExecutionLeaseMargin(state,input.quoteAsset,now,input.excludeLeaseId);
  const executable=available==null?null:Math.max(0,available-committed-earmark);
  const privateFresh=privateAccountFresh(state.account,now);
  const observation=portfolioRiskObservation(state,now,input.pendingScopeObservations??[]);
  const blockers:string[]=[];
  if(environment!=='TESTNET')blockers.push('ENVIRONMENT_NOT_TESTNET');
  if(executionMode!=='TESTNET_ENABLED')blockers.push('EXECUTION_WRITE_LOCKED');
  if(!Number.isFinite(input.requiredMarginUsd)||input.requiredMarginUsd<=0)blockers.push('MARGIN_REQUIREMENT_INVALID');
  if(!privateFresh)blockers.push('PRIVATE_ACCOUNT_NOT_FRESH');
  if(available==null)blockers.push('CAPITAL_FACT_UNPROVEN');
  else if(executable+1e-8<input.requiredMarginUsd)blockers.push('INSUFFICIENT_AVAILABLE_MARGIN');
  if(!input.filtersComplete)blockers.push('EXCHANGE_FILTERS_UNPROVEN');
  if(!input.authorization.valid)blockers.push('AI_AUTHORIZATION_INVALID');
  if(input.authorization.expiresAt!=null&&now>=input.authorization.expiresAt)blockers.push('AI_AUTHORIZATION_EXPIRED');
  if(!input.authorization.identity)blockers.push('SUBMISSION_IDENTITY_MISSING');
  if(!input.durableStorageReady)blockers.push('DURABILITY_UNPROVEN');
  return{
    permitted:blockers.length===0,firstCause:blockers[0]??null,
    mode:{environment,executionMode,fundsOnly},
    facts:{privateFresh,quoteAsset:input.quoteAsset,exchangeAvailableUsd:available,uncommittedReservationUsd:committed,
      analysisEarmarkUsd:earmark,executableForNewReservationUsd:executable,requiredMarginUsd:input.requiredMarginUsd,
      filtersComplete:input.filtersComplete,authorizationValid:input.authorization.valid&&!(input.authorization.expiresAt!=null&&now>=input.authorization.expiresAt),
      submissionIdentity:input.authorization.identity??null,durableStorageReady:input.durableStorageReady},
    evaluatedAt:now,expiresAt:input.authorization.expiresAt??null,
    factVersions:{capitalGeneration:numberOrNull(state.runtimeControl?.capital?.generation),marketFilterVersion:String((state.snapshots.get(input.symbol) as any)?.quote?.filterVersion??'UNSTAMPED')??'UNSTAMPED',
      settingsVersion:numberOrNull((state.settings as any).settingsVersion),portfolioObservationVersion:numberOrNull(observation.evaluatedAt)},
    observation,
  };
}

/**
 * The portfolio picture, with the one field that matters for safety stated explicitly:
 * `enforced`. Funds-only cannot produce `enforced:true`, so a zero ceiling, an unknown stress number
 * or a slot overrun has no path into a permit.
 */
export function portfolioRiskObservation(state:RuntimeState,now:number,scopeObservations:Array<ReturnType<typeof portfolioScopeObservation>>=[]):PortfolioRiskObservation{
  const fundsOnly=testnetFundsOnlyEntry(state.settings);
  const positions=[...state.positions.values()] as any[];
  const gross=positions.reduce((sum,row)=>{const notional=numberOrNull(row.notionalUsd);return notional==null?sum:sum+Math.abs(notional);},0);
  const bySide:Record<string,number|null>={LONG:null,SHORT:null};
  for(const row of positions){const sign=row.side==='SHORT'?-1:1;const value=Math.abs(numberOrNull(row.notionalUsd)??0);bySide[row.side==='SHORT'?'SHORT':'LONG']=(bySide[row.side==='SHORT'?'SHORT':'LONG']??0)+sign*value;}
  const capacity=state.entryCapacity?.() as any;
  const profile=state.settings.portfolioIntelligence;
  return{
    enforced:!fundsOnly,
    basis:fundsOnly?'TESTNET_FUNDS_ONLY_OBSERVATION':'PORTFOLIO_RISK_ENFORCED',
    grossNotionalUsd:positions.length?gross:null,
    directionExposureUsd:bySide,
    clusterExposureUsd:null,
    stressLossUsd:null,
    humanPotentialUsd:null,
    capitalAtRiskUsd:null,
    positionCount:{used:Math.trunc(Number(capacity?.used??positions.length)),max:Math.trunc(Number(state.settings.portfolio?.maxPositions??0)),
      pending:Math.trunc(Number(capacity?.inFlight??0)),enforced:!fundsOnly},
    historicalPendingRiskUsd:numberOrNull(capacity?.pendingRiskNotionalUsd),
    riskProfileStatus:profile?String((state as any).riskProfileStatus??'OBSERVED'):'NOT_CONFIGURED',
    scopeObservations,
    evaluatedAt:now,
    note:fundsOnly
      ?'Gross/Direction/Cluster/Slot/历史风险在本模式仅作观察，不构成 Entry 执行许可输入'
      :'非 funds-only 模式：组合风险仍然是执行输入',
  };
}

/** A read model for the cockpit: the same three layers, never merged into one "risk" number. */
export function entryPermissionReadback(state:RuntimeState,symbol:string,underlying=resolveUnderlying(symbol),now=Date.now()){
  const observation=portfolioRiskObservation(state,now);
  return{evaluatedAt:now,symbol,underlying,fundsOnly:testnetFundsOnlyEntry(state.settings),
    riskStage:observation.enforced?'REQUIRED':'OBSERVED',
    admissionCeilingUsd:null as number|null,
    observation:{...observation,scopeObservations:observation.scopeObservations.filter(row=>row.underlying===underlying)}};
}
