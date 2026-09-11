export type BlacklistKind = "symbolBlacklist" | "underlyingBlacklist";

/**
 * Binance USD-M symbols can contain non-ASCII underlying names.  Keep the
 * stored value in the exchange's compact form so `币安人生/USDT` and
 * `币安人生USDT` address the same contract.
 */
export function normalizeBlacklistInput(
  kind: BlacklistKind,
  value: string,
): string | null {
  const compact = value
    .trim()
    .normalize("NFKC")
    .replace(/[\s/_-]+/g, "")
    .toUpperCase();

  if (!compact || !/^[\p{L}\p{N}]+$/u.test(compact)) return null;
  if (kind === "symbolBlacklist" && compact.length > 64) return null;
  if (kind === "underlyingBlacklist" && compact.length > 48) return null;
  return compact;
}
