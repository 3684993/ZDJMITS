import { createHash } from 'node:crypto';
import { memoryCycleOf, retrieveTradeMemory, type MemoryCycle, type MemoryQuery, type MemoryRetrieval } from './tradeMemoryRetriever.js';
import type { TradeRecord } from '@zdj/contracts';

/**
 * S07-C: the read side of trade memory.
 *
 * The accounting record already says which of its facts were proven, so memory is derived from it
 * rather than from a parallel store that could drift. What the record does not carry (the volatility
 * or liquidity regime the entry was made under) stays UNKNOWN here instead of being filled in from
 * today's snapshot - a sample describing a different market than the one being reviewed is worse than
 * no sample, because it looks like evidence.
 */

export function memoryCycleOfRecord(record: TradeRecord): MemoryCycle {
  const net = typeof record.netPnl === 'number' && Number.isFinite(record.netPnl) ? record.netPnl : null;
  const closed = Number(record.closedAt ?? 0) > 0;
  return memoryCycleOf({
    cycleId: String(record.cycleId ?? record.tradeId),
    scope: String(record.symbol),
    symbol: record.symbol,
    direction: record.direction,
    openedAt: Number(record.openedAt ?? 0) || 0,
    closedAt: closed ? Number(record.closedAt) : null,
    netPnlUsd: net,
    netRoiOnMargin: record.netRoiOnMargin ?? null,
    fundingStatus: record.fundingAttributionStatus ?? 'UNKNOWN',
    feeCompleteness: record.feeCompleteness ?? 'UNKNOWN',
    planRef: null,
    planVersion: null,
    handoffAt: null,
    handoffMarkUsd: null,
    finalOwner: record.closeReason === 'MANUAL' ? 'HUMAN' : record.closeReason === 'TP' ? 'AI' : 'UNKNOWN',
    duplicateOf: record.duplicateOf ?? null,
    provenance: [`TRADE_RECORD:${record.tradeId}`, `STATUS:${record.status}`, `COMPLETENESS:${record.recordCompleteness}`],
  });
}

/** A memory store is one version per exact set of cycles, so a repeated query is provably the same query. */
export function tradeMemoryVersionOf(records: TradeRecord[]): string {
  const identity = records.map(record => `${record.tradeId}|${record.status}|${record.closedAt ?? '-'}|${record.netPnl ?? '-'}|${record.fundingAttributionStatus ?? '-'}|${record.feeCompleteness}`).sort();
  return `mem_${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 32)}`;
}

export function tradeMemoryOf(records: TradeRecord[]): MemoryCycle[] {
  const byKey = new Map<string, MemoryCycle>();
  for (const record of records) {
    const cycle = memoryCycleOfRecord(record);
    const prior = byKey.get(cycle.cycleId);
    // One cycle can have several accounting rows; the realized one wins, otherwise the newest.
    if (!prior || (prior.outcome !== 'REALIZED_PROFIT' && prior.outcome !== 'REALIZED_LOSS'
      && (cycle.outcome === 'REALIZED_PROFIT' || cycle.outcome === 'REALIZED_LOSS'))) byKey.set(cycle.cycleId, cycle);
  }
  return [...byKey.values()];
}

/** The review asks only about its own side; a mixed sample would answer a question nobody asked. */
export function reviewMemoryFor(records: TradeRecord[], query: MemoryQuery & { excludeCycleId?: string } = {}): MemoryRetrieval & { memoryVersion: string } {
  const cycles = tradeMemoryOf(records).filter(row => row.cycleId !== query.excludeCycleId);
  return { ...retrieveTradeMemory(cycles, { direction: query.direction, limit: query.limit }), memoryVersion: tradeMemoryVersionOf(records) };
}
