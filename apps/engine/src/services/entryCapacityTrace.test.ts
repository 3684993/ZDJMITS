import {describe, expect, it} from 'vitest';
import {classifySideCapacityBinding, entrySideCapacityTrace} from './entryCapacityTrace.js';

/**
 * §B: "SHORT has no room" is not an explanation. A zero on one side must name the one number that is
 * smaller than the number it has to clear — and an exchange minimum may only be blamed when a real
 * final notional actually falls below a real, verified minimum.
 */

const binding = (over: Record<string, unknown>) => classifySideCapacityBinding({
  symbol: 'ADAUSDC', side: 'SHORT', executable: false, blockers: ['BELOW_MINIMUM_NOTIONAL'], firstBindingConstraint: 'MINIMUM_NOTIONAL',
  plannedNotionalUsd: 0, finalNotionalUsd: 0, minimumLegalNotionalUsd: 5, exchangeFiltersComplete: true,
  planPresent: true, routePresent: true, marginTierProven: true, portfolioRiskAllowed: true,
  capitalBindingConstraint: 'NONE', ...over,
} as never);

describe('a side may only be blamed on the exchange minimum when that is the truth', () => {
  it('MN-01 names an absent side plan instead of inventing a minimum', () => {
    expect(binding({planPresent: false, plannedNotionalUsd: 0})).toMatchObject({constraint: 'SIDE_PLAN_ABSENT', detail: expect.stringContaining('ADAUSDC')});
  });

  it('MN-02 names a zero-sized plan instead of the exchange minimum', () => {
    expect(binding({plannedNotionalUsd: 0, finalNotionalUsd: 0, planPresent: true})).toMatchObject({constraint: 'PLANNED_NOTIONAL_ZERO'});
  });

  it('MN-03 refuses to quote a minimum it never verified', () => {
    expect(binding({exchangeFiltersComplete: false, minimumLegalNotionalUsd: null})).toMatchObject({constraint: 'EXCHANGE_FILTERS_UNPROVEN'});
  });

  it('MN-04 keeps the real minimum verdict when a finite plan is genuinely below it', () => {
    expect(binding({plannedNotionalUsd: 4, finalNotionalUsd: 4, minimumLegalNotionalUsd: 5})).toMatchObject({constraint: 'BELOW_EXCHANGE_MIN_NOTIONAL', actualUsd: 4, requiredUsd: 5});
  });

  it('MN-05 never reports a minimum when another gate already denied the side', () => {
    expect(binding({firstBindingConstraint: 'CLUSTER', blockers: ['REJECT_CORRELATED_CLUSTER'], plannedNotionalUsd: 500, finalNotionalUsd: 0})).toMatchObject({constraint: 'CLUSTER'});
    expect(binding({firstBindingConstraint: 'AVAILABLE_MARGIN', blockers: ['INSUFFICIENT_AVAILABLE_MARGIN'], capitalBindingConstraint: 'AVAILABLE_MARGIN', plannedNotionalUsd: 500, finalNotionalUsd: 0})).toMatchObject({constraint: 'AVAILABLE_MARGIN'});
    expect(binding({firstBindingConstraint: 'LEVERAGE_UNPROVEN', blockers: ['LEVERAGE_UNPROVEN'], capitalBindingConstraint: 'LEVERAGE_UNPROVEN', plannedNotionalUsd: 500, finalNotionalUsd: 0})).toMatchObject({constraint: 'LEVERAGE_UNPROVEN'});
  });

  it('MN-06 reports the facts that come before capacity in order', () => {
    expect(binding({portfolioRiskAllowed: false, planPresent: false})).toMatchObject({constraint: 'PORTFOLIO_RISK_DENIED'});
    expect(binding({marginTierProven: false})).toMatchObject({constraint: 'MARGIN_TIER_SYMBOL_UNPROVEN:ADAUSDC'});
    expect(binding({routePresent: false})).toMatchObject({constraint: 'NO_ROUTABLE_SHORT_CANDIDATE'});
    expect(binding({capitalBindingConstraint: 'QUOTE_ASSET_NOT_ENTRY_ELIGIBLE', symbol: 'BNBFDUSD'})).toMatchObject({constraint: 'QUOTE_ASSET_NOT_ENTRY_ELIGIBLE'});
  });

  it('MN-07 leaves an executable side unblocked and names what limits its size', () => {
    expect(binding({executable: true, blockers: [], firstBindingConstraint: 'PLANNED_NOTIONAL', plannedNotionalUsd: 200, finalNotionalUsd: 200})).toMatchObject({constraint: 'PLANNED_NOTIONAL', actualUsd: 200});
  });

  it('MN-10 never relabels an executable side with a fact that sits in front of capacity', () => {
    const executed = binding({executable: true, blockers: [], firstBindingConstraint: 'PLANNED_NOTIONAL', plannedNotionalUsd: 202, finalNotionalUsd: 202, marginTierProven: false});
    expect(executed.constraint).toBe('PLANNED_NOTIONAL');
    const trace = entrySideCapacityTrace({
      symbol: 'ADAUSDC', underlying: 'ADA', side: 'LONG', quoteAsset: 'USDC',
      snapshot: {quote: {last: 0.75, tickSize: 0.001, stepSize: 0.1, minQty: 0.1, minNotional: 5}} as never,
      route: {leverage: 8, longExecutable: true, longRecommendedNotionalUsd: 202, longPlanFacts: {present: true, admission: 'ALLOW_REDUCED_SIZE', reasons: [], minExecutableMarginUsd: 25}} as never,
      headroom: {plannedNotional: 202, finalNotional: 202, minimumNotional: 5, executable: true, reason: 'PASS', blockers: [], firstBindingConstraint: 'PLANNED_NOTIONAL',
        remaining: {gross: 0, direction: 7_000, cluster: 3_700, clusterDirection: 3_700, riskSizing: 15_000, quote: 3_980}, limits: {}, observed: {}, capital: null} as never,
      marginTier: {proven: false} as never, portfolioRisk: {allowed: true, blockers: []} as never, evaluationSnapshot: null,
    });
    expect(trace.executable).toBe(true);
    expect(trace.firstBindingConstraint).toBe('PLANNED_NOTIONAL');
    // The missing bracket row is still visible, just not dressed up as the reason.
    expect(trace.risk.marginTierProven).toBe(false);
  });

  it('MN-08 builds the whole per-candidate trace out of the facts the gates already computed', () => {
    const trace = entrySideCapacityTrace({
      symbol: 'ADAUSDC', underlying: 'ADA', side: 'SHORT', quoteAsset: 'USDC',
      snapshot: {quote: {last: 0.75, tickSize: 0.001, stepSize: 0.1, minQty: 0.1, minNotional: 5}} as never,
      route: {leverage: 8, marginUsd: 25, shortExecutable: false, shortRecommendedNotionalUsd: null, minExecutableNotionalUsd: 5, shortPlanFacts: null} as never,
      headroom: {plannedNotional: 0, finalNotional: 0, minimumNotional: 5, executable: false, reason: 'BELOW_MINIMUM_NOTIONAL', blockers: ['BELOW_MINIMUM_NOTIONAL'], firstBindingConstraint: 'MINIMUM_NOTIONAL',
        remaining: {gross: 0, direction: 3_195.08, cluster: 3_701.7, clusterDirection: 3_701.7, riskSizing: 15_289.04, quote: 3_980}, limits: {gross: 10_790.59, direction: 10_790.59, cluster: 3_776.71, clusterDirection: 3_776.71},
        observed: {gross: {mode: 'OBSERVE', enforced: false}, direction: {mode: 'OBSERVE', enforced: false}, cluster: {mode: 'ENFORCE', enforced: true}},
        capital: {availableBalanceUsd: 4_970.81, reservedMarginUsd: 0, executionLeaseMarginUsd: 466.57, executableMarginUsd: 4_504.24, policyMarginCapUsd: 497.08, executableNotionalUsd: 3_980, leverage: 8, leverageFact: 'CANDIDATE_RECOMMENDED', bindingConstraint: 'MARGIN_POLICY_CAP'}} as never,
      portfolioRisk: {allowed: true, blockers: []} as never,
      marginTier: {proven: true} as never,
      evaluationSnapshot: {equityUsd: 10_790.59, grossNotionalUsd: 10_703.8, clusterNotionalUsd: 0, positions: 24, maxPositions: 50},
    });
    expect(trace).toMatchObject({
      symbol: 'ADAUSDC', side: 'SHORT', quoteAsset: 'USDC', executable: false,
      referencePrice: 0.75, leverage: 8, leverageFact: 'CANDIDATE_RECOMMENDED',
      exchangeFilters: {tickSize: 0.001, stepSize: 0.1, minQty: 0.1, minNotional: 5, factsComplete: true},
      minimumLegalNotionalUsd: 5,
      funding: {availableBalanceUsd: 4_970.81, executionLeaseMarginUsd: 466.57, executableMarginUsd: 4_504.24, policyMarginCapUsd: 497.08, executableNotionalUsd: 3_980},
      risk: {grossRemainingUsd: 0, grossMode: 'OBSERVE', directionRemainingUsd: 3_195.08, directionMode: 'OBSERVE', clusterRemainingUsd: 3_701.7, perTradeRiskRemainingUsd: 15_289.04, portfolioRiskAllowed: true},
      plan: {present: false, recommendedNotionalUsd: 0},
      plannedNotionalUsd: 0, finalNotionalBeforeRoundingUsd: 0,
    });
    // The live mis-attribution this round exists to kill.
    expect(trace.firstBindingConstraint).toBe('SIDE_PLAN_ABSENT');
    expect(trace.blockers).toEqual(expect.arrayContaining(['BELOW_MINIMUM_NOTIONAL']));
    expect(trace.rounded).toMatchObject({quantityUnits: 0, legalNotionalUsd: 0, stepSize: 0.1});
    expect(trace.explanation).toContain('ADAUSDC');
    expect(trace.explanation).toContain('SHORT');
  });

  it('MN-09 rounds down to the largest legal quantity instead of over-claiming', () => {
    const trace = entrySideCapacityTrace({
      symbol: 'XRPUSDT', underlying: 'XRP', side: 'LONG', quoteAsset: 'USDT',
      snapshot: {quote: {last: 2.5, tickSize: 0.0001, stepSize: 1, minQty: 10, minNotional: 5}} as never,
      route: {leverage: 8, marginUsd: 30, longExecutable: true, longRecommendedNotionalUsd: 202.05, minExecutableNotionalUsd: 25, longPlanFacts: {present: true, admission: 'ALLOW_REDUCED_SIZE', reasons: [], minExecutableMarginUsd: 3.13}} as never,
      headroom: {plannedNotional: 202.05, finalNotional: 202.05, minimumNotional: 25, executable: true, reason: 'PASS', blockers: [], firstBindingConstraint: 'PLANNED_NOTIONAL',
        remaining: {gross: 0, direction: 7_000, cluster: 3_700, clusterDirection: 3_700, riskSizing: 15_000, quote: 3_980}, limits: {gross: 10_790, direction: 10_790, cluster: 3_776, clusterDirection: 3_776},
        observed: {gross: {mode: 'OBSERVE', enforced: false}, direction: {mode: 'OBSERVE', enforced: false}, cluster: {mode: 'ENFORCE', enforced: true}},
        capital: {availableBalanceUsd: 3_681.75, reservedMarginUsd: 0, executionLeaseMarginUsd: 462.79, executableMarginUsd: 3_218.96, policyMarginCapUsd: 497.08, executableNotionalUsd: 3_980, leverage: 8, leverageFact: 'CANDIDATE_RECOMMENDED', bindingConstraint: 'MARGIN_POLICY_CAP'}} as never,
      portfolioRisk: {allowed: true, blockers: []} as never,
      marginTier: {proven: true} as never,
      evaluationSnapshot: {equityUsd: 10_790, grossNotionalUsd: 10_703, clusterNotionalUsd: 0, positions: 24, maxPositions: 50},
    });
    expect(trace.executable).toBe(true);
    expect(trace.firstBindingConstraint).toBe('PLANNED_NOTIONAL');
    expect(trace.rounded).toMatchObject({quantityUnits: 80, legalNotionalUsd: 200, stepSize: 1, minQty: 10});
    expect(trace.minimumLegalNotionalUsd).toBe(25);
    expect(trace.finalNotionalBeforeRoundingUsd).toBeCloseTo(202.05, 6);
  });
});
