import {describe,expect,it} from 'vitest';
import {classifyP0RiskConvergence} from './p0RiskConvergence.js';

describe('P0 risk convergence acceptance semantics',()=>{
  it('accepts a fail-closed evidence gap that clears within 120 seconds',()=>expect(classifyP0RiskConvergence({startedAt:1_000,clearedAt:61_000,evidenceUnavailable:true,failClosed:true,reservationHeld:true,duplicateEntryCount:0,unprotectedPositionCount:0})).toMatchObject({classification:'TRANSIENT_EVIDENCE_UNAVAILABLE',converged:true,convergenceMs:60_000,slaMs:120_000}));
  it('does not accept a gap that loses a safety invariant',()=>expect(classifyP0RiskConvergence({startedAt:1_000,clearedAt:61_000,evidenceUnavailable:true,failClosed:true,reservationHeld:false,duplicateEntryCount:0,unprotectedPositionCount:0}).classification).toBe('UNKNOWN'));
  it('fails closed on duplicate entry or unprotected position',()=>expect(classifyP0RiskConvergence({startedAt:1_000,clearedAt:2_000,evidenceUnavailable:false,failClosed:false,reservationHeld:true,duplicateEntryCount:1,unprotectedPositionCount:0}).classification).toBe('REAL_ACTIVE_RISK'));
});
