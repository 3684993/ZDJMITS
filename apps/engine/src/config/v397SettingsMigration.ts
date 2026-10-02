type SettingsDocument = Record<string, unknown>;

const record = (value: unknown): value is SettingsDocument =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteOr = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Introduces the V3.9.7 initial-margin contract into a document that predates it.
 *
 * Presence of `businessMinInitialMarginUsd` is the migration marker. Once that field exists, every
 * related value is operator-owned and the schema must reject contradictions rather than silently
 * repairing them. A legacy document is different: its old 25/50 USDT caps cannot coexist with the
 * newly defaulted 100 USDT floor, so the whole legacy sizing tuple is lifted once as one auditable
 * migration instead of making the runtime impossible to reopen.
 */
export function migrateV397BusinessSizing(document: SettingsDocument): SettingsDocument {
  const portfolioIntelligence = record(document.portfolioIntelligence)
    ? document.portfolioIntelligence
    : (document.portfolioIntelligence = {} as SettingsDocument);

  if (Object.prototype.hasOwnProperty.call(portfolioIntelligence, 'businessMinInitialMarginUsd'))
    return document;

  const businessFloor = 100;
  const preferred = 200;
  portfolioIntelligence.businessMinInitialMarginUsd = businessFloor;
  portfolioIntelligence.preferredInitialMarginUsd = preferred;
  portfolioIntelligence.baseMarginUsd = Math.max(
    preferred,
    finiteOr(portfolioIntelligence.baseMarginUsd, preferred),
  );
  portfolioIntelligence.maxMarginPerPositionUsd = Math.max(
    500,
    finiteOr(portfolioIntelligence.maxMarginPerPositionUsd, 500),
  );
  portfolioIntelligence.maxEquityPct = Math.max(
    0.1,
    finiteOr(portfolioIntelligence.maxEquityPct, 0.1),
  );

  const portfolio = record(document.portfolio)
    ? document.portfolio
    : (document.portfolio = {} as SettingsDocument);
  portfolio.entryMarginUsd = Math.max(
    preferred,
    finiteOr(portfolio.entryMarginUsd, preferred),
  );
  return document;
}
