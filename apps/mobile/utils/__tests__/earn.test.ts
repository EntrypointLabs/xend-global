import {
  selectPortfolio,
  holdingsBeforeDelete,
  selectUsdcDepositLimit,
  selectPortfolioTotal,
} from "@/utils/balances";
import { EARN_PROVIDERS } from "@prydd/smart-account";
import { getUsdcMint } from "@/utils/cluster";
import { selectEarnBalance } from "@/utils/earn";
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

describe("unknown Earn valuation", () => {
  const cash = { cashUsd: 10, investmentsUsd: 5, hasUnpricedHoldings: false };
  it("withholds the portfolio total on cold load or a failed Earn read", () => {
    expect(selectPortfolioTotal(cash, selectEarnBalance(undefined))).toBeNull();
    expect(
      selectPortfolioTotal(
        cash,
        selectEarnBalance([{ positionMinor: "250000000" }], true)
      )
    ).toBeNull();
    expect(holdingsBeforeDelete([], null).holdsAnything).toBe(true);
    expect(holdingsBeforeDelete([], null).usd).toBeNull();
  });
  it("restores the full total after a successful retry and distinguishes an empty position", () => {
    expect(
      selectPortfolioTotal(
        cash,
        selectEarnBalance([{ positionMinor: "250000000" }])
      )
    ).toBe(265);
    expect(selectPortfolioTotal(cash, selectEarnBalance([]))).toBe(15);
    expect(selectPortfolioTotal(null, 0)).toBeNull();
  });
});

describe("Earn deposit maximum", () => {
  it.each([
    ["10006000", 10],
    ["9999999", 9.99],
    ["10000000", 10],
    ["9999", 0],
  ])("floors %s raw USDC to owned cents", (amountRaw, expected) => {
    const maximum = selectUsdcDepositLimit([
      {
        mint: getUsdcMint(),
        amountRaw: String(amountRaw),
        decimals: 6,
        symbol: "USDC",
      },
    ]);
    expect(maximum).toBe(expected);
    expect(BigInt(Math.round(maximum * 1e6)) <= BigInt(amountRaw)).toBe(true);
  });
});

describe("non-associated Earn holdings", () => {
  it("includes external receipts in valuation while preserving a smaller withdrawal limit", () => {
    const product = {
      id: "kamino",
      provider: "Kamino",
      name: "Lending Yield",
      apy: 0.04,
      positionShares: "150000000",
      positionMinor: "300000000",
      withdrawableMinor: "200000000",
      available: true,
      withdrawAvailable: true,
      updatedAt: "2026-11-25T00:00:00.000Z",
    };
    const parsed = EarnCatalogSchema.parse({
      products: [product],
      lifetimeMinor: null,
      lastSevenDaysMinor: null,
    });
    expect(selectEarnBalance(parsed.products)).toBe(300);
    expect(Number(parsed.products[0].withdrawableMinor) / 1e6).toBe(200);
    expect(
      selectPortfolioTotal(
        { cashUsd: 0, investmentsUsd: 0, hasUnpricedHoldings: false },
        selectEarnBalance(parsed.products)
      )
    ).toBe(300);
  });
});
