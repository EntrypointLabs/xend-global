import { selectPortfolio, holdingsBeforeDelete } from "@/utils/balances";
import { EARN_PROVIDERS } from "@prydd/smart-account";
import { projectedValue } from "@/utils/earnProjection";
import { EarnCatalogSchema, EarnQuoteSchema } from "@/utils/earn";

describe("Earn estimates and API boundaries", () => {
  it("uses effective APY without compounding it a second time", () => {
    expect(projectedValue(1000, 0.0359, 1)).toBeCloseTo(1035.9, 6);
    expect(projectedValue(1000, 0.06, 10)).toBeCloseTo(1790.8477, 4);
    expect(projectedValue(0, 0.06, 30)).toBe(0);
    expect(projectedValue(1000, 0, 30)).toBe(1000);
  });
  it.each([
    [-1, 0.06, 1],
    [1000, NaN, 1],
    [1000, 0.06, 31],
  ])("rejects invalid projections", (amount, apy, years) => {
    expect(() => projectedValue(amount, apy, years)).toThrow();
  });
  it("accepts unavailable historical income without inventing a zero", () => {
    const parsed = EarnCatalogSchema.parse({
      products: [],
      lifetimeMinor: null,
      lastSevenDaysMinor: null,
    });
    expect(parsed.lifetimeMinor).toBeNull();
    expect(
      EarnCatalogSchema.parse({
        products: [],
        lifetimeMinor: "-123",
        lastSevenDaysMinor: "0",
      }).lifetimeMinor
    ).toBe("-123");
  });
  it("requires integer base units and a known protocol in an executable quote", () => {
    const quote = {
      provider: "kamino",
      action: "deposit",
      amountMinor: "1000000",
      quoteId: "9240c437-4800-481a-9c16-1a64bc4330d2",
      inputAmountRaw: "1000000",
      expectedOutRaw: "900000",
      minimumOutRaw: "895500",
      expiresAt: 123,
    };
    expect(EarnQuoteSchema.parse(quote).inputAmountRaw).toBe("1000000");
    expect(() =>
      EarnQuoteSchema.parse({ ...quote, minimumOutRaw: "0.5" })
    ).toThrow();
    expect(() =>
      EarnQuoteSchema.parse({ ...quote, provider: "navi" })
    ).toThrow();
  });
});

describe("Earn receipt holdings", () => {
  it("does not double count receipts as investments and still protects account deletion", () => {
    const receipts = Object.values(EARN_PROVIDERS).map((p) => ({
      mint: p.receipt,
      amountRaw: "1000000",
      decimals: 6,
      symbol: null,
      usdValue: 1.1,
    }));
    expect(selectPortfolio(receipts)).toEqual({
      cashUsd: 0,
      investmentsUsd: 0,
      hasUnpricedHoldings: false,
    });
    expect(holdingsBeforeDelete(receipts, 0).holdsAnything).toBe(true);
  });
});
