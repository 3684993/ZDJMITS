export type P0RiskConvergenceInput={
  startedAt:number;
  clearedAt:number|null;
  evidenceUnavailable:boolean;
  failClosed:boolean;
  reservationHeld:boolean;
  duplicateEntryCount:number;
  unprotectedPositionCount:number;
  slaMs?:number;
};

export type P0RiskConvergenceResult={classification:'TRANSIENT_EVIDENCE_UNAVAILABLE'|'REAL_ACTIVE_RISK'|'UNKNOWN';converged:boolean;convergenceMs:number|null;slaMs:number;reason:string};

/** Formal release-acceptance semantics for a temporary reconciliation gap.
 * A transient is admissible only when the exchange proof was unavailable, the
 * system stayed fail-closed, and no order/position safety invariant was lost.
 */
export function classifyP0RiskConvergence(input:P0RiskConvergenceInput):P0RiskConvergenceResult{
  const slaMs=input.slaMs??120_000,elapsed=input.clearedAt===null?null:Math.max(0,input.clearedAt-input.startedAt);
  if(input.duplicateEntryCount>0||input.unprotectedPositionCount>0)return{classification:'REAL_ACTIVE_RISK',converged:false,convergenceMs:elapsed,slaMs,reason:'duplicate entry or unprotected position'};
  if(input.evidenceUnavailable&&input.failClosed&&input.reservationHeld&&input.clearedAt!==null&&elapsed! <= slaMs)return{classification:'TRANSIENT_EVIDENCE_UNAVAILABLE',converged:true,convergenceMs:elapsed,slaMs,reason:'exchange proof recovered within fail-closed SLA'};
  if(input.evidenceUnavailable&&input.failClosed&&input.reservationHeld&&input.clearedAt===null)return{classification:'TRANSIENT_EVIDENCE_UNAVAILABLE',converged:false,convergenceMs:null,slaMs,reason:'exchange proof unavailable; risk remains held'};
  return{classification:'UNKNOWN',converged:false,convergenceMs:elapsed,slaMs,reason:'required transient safety evidence is incomplete'};
}
