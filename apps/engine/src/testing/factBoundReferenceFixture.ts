import {
  ENTRY_FACT_BOUND_REFERENCE_PROTOCOL,
  ENTRY_FACT_BOUND_REQUIRED_FIELDS,
  EntryDecisionFactBoundSchema,
  type EntryIntelligencePacket,
} from '@zdj/contracts';
import {frozenEntryDirectionFacts} from '@zdj/core';

/** Synthetic test wire only. Never use this to migrate or repair archived model output.
 * The caller supplies all model-owned choices; factual assertions come from this exact packet.
 */
export function factBoundWire(packet: EntryIntelligencePacket, legacyWire: Record<string, any>) {
  const fields = Object.fromEntries(ENTRY_FACT_BOUND_REQUIRED_FIELDS
    .filter(key => Object.hasOwn(legacyWire, key)).map(key => [key, legacyWire[key]]));
  const result = {
    ...fields,
    schemaVersion: ENTRY_FACT_BOUND_REFERENCE_PROTOCOL,
    directionFactsVersion: frozenEntryDirectionFacts(packet).version,
    timingEventId: legacyWire.timingEventId ?? legacyWire.timingEvent?.id ?? null,
    factChecks: (['1d', '4h', '15m'] as const).map(frame => {
      const value = packet.market.technical[frame]?.macdHistogram;
      const sign = typeof value !== 'number' || !Number.isFinite(value) ? 'UNKNOWN'
        : value > 0 ? 'POSITIVE' : value < 0 ? 'NEGATIVE' : 'ZERO';
      return {factId: `technical.${frame}.confirmed`, field: 'macdHistogram', value: sign};
    }),
  };
  for (const key of ENTRY_FACT_BOUND_REQUIRED_FIELDS)
    if (!Object.hasOwn(result, key) || (result as any)[key] === undefined)
      throw new Error(`TEST_R2_FIXTURE_MISSING_FIELD:${key}`);
  return EntryDecisionFactBoundSchema.parse(result);
}
