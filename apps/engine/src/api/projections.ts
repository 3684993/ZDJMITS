import type {DashboardSnapshot} from '@zdj/contracts';
import type {EngineRuntime} from '../runtime/appRuntime.js';
import {dashboardProjection as legacyDashboardProjection,redactAudit} from './projectionsLegacy.js';
import {projectTradeRecordSummary} from '../services/tradeRecordReadModel.js';

export {redactAudit};

/** V3.9.3 economics overlay; no mutation/backfill/reconciliation is allowed here. */
export function dashboardProjection(runtime:EngineRuntime):DashboardSnapshot{
  const base=legacyDashboardProjection(runtime),economics=projectTradeRecordSummary({records:[...runtime.state.tradeRecords.values()],asOf:Date.now()});
  return {...base,
    tradeNetPnl:economics.canonicalNetPnl??0,
    tradeCompletedCount:economics.canonicalPnlEligibleCount,
    tradeTradingNetExFunding:economics.tradingNetExFunding,
    tradeCompletedExFundingCount:economics.tradingNetExFundingEligibleCount,
    tradeFundingUnknownCount:economics.fundingUnknownCount,
    tradeQualityEconomics:economics,
  } as DashboardSnapshot;
}
