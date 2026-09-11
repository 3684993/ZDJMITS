import { describe, expect, it } from "vitest";
import { normalizeBlacklistInput } from "./blacklistInput";

describe("normalizeBlacklistInput", () => {
  it("accepts Binance Unicode symbols in raw and slash notation", () => {
    expect(normalizeBlacklistInput("symbolBlacklist", "币安人生/USDT")).toBe("币安人生USDT");
    expect(normalizeBlacklistInput("symbolBlacklist", "币安人生USDT")).toBe("币安人生USDT");
  });

  it("accepts a Unicode underlying while rejecting punctuation", () => {
    expect(normalizeBlacklistInput("underlyingBlacklist", "币安人生")).toBe("币安人生");
    expect(normalizeBlacklistInput("symbolBlacklist", "币安人生;USDT")).toBeNull();
  });
});
