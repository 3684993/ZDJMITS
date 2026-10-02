type Timed = { id?: string; tradeId?: string; openedAt?: number | null; closedAt?: number | null };
const descending = (a: number | null | undefined, b: number | null | undefined) =>
  (Number.isFinite(b) ? Number(b) : -Infinity) - (Number.isFinite(a) ? Number(a) : -Infinity);
/** Newest first; unknown timestamps last and ties deterministic. */
export const byOpenedAtDesc = <T extends Timed>(a: T, b: T) =>
  descending(a.openedAt, b.openedAt) || String(a.id ?? a.tradeId ?? '').localeCompare(String(b.id ?? b.tradeId ?? ''));
/** Recently closed first; records without a close fact stay last. */
export const byClosedAtDesc = <T extends Timed>(a: T, b: T) =>
  descending(a.closedAt, b.closedAt) || String(a.id ?? '').localeCompare(String(b.id ?? ''));
