import { describe, expect, it } from 'vitest';
import { PortfolioIntelligenceSettingsSchema } from '@zdj/contracts';
import { migrateV397BusinessSizing } from './v397SettingsMigration.js';
import { quantityLadder } from '../services/quantityHorizonCandidates.js';

describe('V3.9.7 business sizing settings migration', () => {
  it('preserves an explicit 25/25 local release policy and the existing 25/50/.005 risk caps',()=>{
    const explicit={portfolio:{entryMarginUsd:25},portfolioIntelligence:{businessMinInitialMarginUsd:25,preferredInitialMarginUsd:25,baseMarginUsd:25,maxMarginPerPositionUsd:50,maxEquityPct:.005}};
    const migrated=migrateV397BusinessSizing(structuredClone(explicit));
    expect(migrated).toEqual(explicit);
    expect(PortfolioIntelligenceSettingsSchema.parse(migrated.portfolioIntelligence)).toMatchObject(explicit.portfolioIntelligence);
    expect(quantityLadder(1,50,.1,100,5,{leverage:10,businessMinInitialMarginUsd:25,preferredInitialMarginUsd:25})).toEqual([25,38,50]);
    expect(quantityLadder(1,24,.1,100,5,{leverage:10,businessMinInitialMarginUsd:25,preferredInitialMarginUsd:25})).toEqual([]);
  });
  it('lifts the complete legacy sizing tuple so the 100/200 initial-margin contract is loadable', () => {
    const legacy: any = {
      portfolio: { entryMarginUsd: 25 },
      portfolioIntelligence: {
        baseMarginUsd: 25,
        maxMarginPerPositionUsd: 50,
        maxEquityPct: 0.005,
      },
    };

    const migrated: any = migrateV397BusinessSizing(structuredClone(legacy));
    expect(migrated.portfolio).toMatchObject({ entryMarginUsd: 200 });
    expect(migrated.portfolioIntelligence).toMatchObject({
      baseMarginUsd: 200,
      businessMinInitialMarginUsd: 100,
      preferredInitialMarginUsd: 200,
      maxMarginPerPositionUsd: 500,
      maxEquityPct: 0.1,
    });
    expect(() => PortfolioIntelligenceSettingsSchema.parse(migrated.portfolioIntelligence)).not.toThrow();
  });

  it('never repairs an explicitly versioned but contradictory operator document', () => {
    const explicit: any = {
      portfolio: { entryMarginUsd: 25 },
      portfolioIntelligence: {
        businessMinInitialMarginUsd: 100,
        preferredInitialMarginUsd: 200,
        maxMarginPerPositionUsd: 50,
      },
    };

    const migrated: any = migrateV397BusinessSizing(structuredClone(explicit));
    expect(migrated).toEqual(explicit);
    expect(() => PortfolioIntelligenceSettingsSchema.parse(migrated.portfolioIntelligence)).toThrow(
      /maxMarginPerPositionUsd must fund businessMinInitialMarginUsd/,
    );
  });
});
