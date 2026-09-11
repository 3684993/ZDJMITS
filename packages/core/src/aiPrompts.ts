import type { EntryIntelligencePacket, ScoutAnnotation } from '@zdj/contracts';

export function buildScoutPrompt(packet:EntryIntelligencePacket):string {
  const market=packet.market;const scoutEvidence={symbol:packet.symbol,selection:packet.selection,quote:market.quote,technical:{'1m':market.technical['1m'],'5m':market.technical['5m'],'15m':market.technical['15m']},derivatives:market.derivatives,orderBook:market.orderBook,contradictions:packet.contradictions,evidenceCompleteness:packet.evidenceCompleteness,microstructure:packet.microstructure};
  return `You are the SCOUT model in a multi-symbol trading system. You have no order permission.\n`+
    `Read only this compact evidence extract. Never decide direction or an order; do not repeat full technical analysis.\n`+
    `Focus only on attention, missing facts, contradictions, unusual capital activity, and immediate 1m/5m/15m entry concerns.\n`+
    `Return strict JSON: {symbol,summary,keyEvidence[],contradictions[],missingEvidence[],attentionScore}. attentionScore MUST be a finite decimal from 0 through 1 inclusive.\nEVIDENCE:\n${JSON.stringify(scoutEvidence)}`;
}
export { buildCompactBrainPrompt } from './compactEntry.js';
import { buildCompactBrainPrompt } from './compactEntry.js';
export function buildBrainPrompt(packet:EntryIntelligencePacket,_scout:ScoutAnnotation|null,_extra:Record<string,unknown>={}):string {
  return buildCompactBrainPrompt(packet);
}
