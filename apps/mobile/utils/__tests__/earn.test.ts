import {
  selectPortfolio,
  holdingsBeforeDelete,
  isEarnReceipt,
  selectPortfolioTotal,
} from "@/utils/balances";
import { EARN_PROVIDERS, JUPITER_EARN_ASSETS } from "@prydd/smart-account";
import {
  EarnCatalogSchema,
  EarnQuoteSchema,
  selectEarnBalance,
  earnDepositLimit,
  productCanWithdraw,
  productHasExternalReceipts,
  productValueUsd,
  productEarningsUsd,
  catalogEarnings,
} from "@/utils/earn";
import { projectedValue } from "@/utils/earnProjection";

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
      depositableMinor: "0",
      lifetimeMinor: null,
      lastSevenDaysMinor: null,
    });
    expect(parsed.lifetimeMinor).toBeNull();
    expect(
      EarnCatalogSchema.parse({
        products: [],
        depositableMinor: "0",
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
    const receipts = [
      ...Object.values(EARN_PROVIDERS).map((p) => p.receipt),
      ...Object.values(JUPITER_EARN_ASSETS).map((a) => a.receipt),
    ].map((mint) => ({
      mint,
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

  it("treats Jupiter Lend WSOL as a receipt, not an investment", () => {
    expect(isEarnReceipt(JUPITER_EARN_ASSETS.SOL.receipt)).toBe(true);
    expect(isEarnReceipt(JUPITER_EARN_ASSETS.SOL.mint)).toBe(false);
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
    const maximum = earnDepositLimit(String(amountRaw));
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
      depositableMinor: "0",
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

describe("Earn products that lend more than USDC", () => {
  const row = (
    symbol: string,
    positionRaw: string,
    positionUsd: string | null,
    withdrawableRaw = positionRaw
  ) => ({
    mint: symbol,
    symbol,
    name: symbol,
    iconUrl: null,
    decimals: symbol === "SOL" ? 9 : 6,
    apy: 0.04,
    positionRaw,
    positionUsd,
    withdrawableRaw,
    lifetimeEarnedRaw: "0",
    lastSevenDaysEarnedRaw: "0",
    depositableRaw: "0",
    available: true,
    withdrawAvailable: BigInt(withdrawableRaw) > 0n,
  });
  // Product-level fields stay USDC only, as the server sends them.
  const solOnly = {
    positionMinor: "0",
    withdrawableMinor: "0",
    assets: [
      row("USDC", "0", "0.000000"),
      row("SOL", "2000000000", "300.000000"),
    ],
  };
  it("values a SOL-only position from its token row", () => {
    expect(productValueUsd(solOnly)).toBe(300);
    expect(selectEarnBalance([solOnly])).toBe(300);
    expect(productCanWithdraw(solOnly)).toBe(true);
  });
  it("leaves the balance unknown when a held token cannot be priced", () => {
    const unpriced = {
      ...solOnly,
      assets: [row("USDC", "5000000", "5.000000"), row("SOL", "1", null)],
    };
    expect(productValueUsd(unpriced)).toBeNull();
    expect(selectEarnBalance([unpriced])).toBeNull();
  });
  it("ignores unpriced tokens the product does not hold", () => {
    const empty = {
      ...solOnly,
      assets: [row("USDC", "0", "0.000000"), row("SOL", "0", null)],
    };
    expect(productValueUsd(empty)).toBe(0);
    expect(productCanWithdraw(empty)).toBe(false);
  });
  it("flags shares held outside the canonical account for any token", () => {
    expect(
      productHasExternalReceipts({
        ...solOnly,
        assets: [row("SOL", "2000000000", "300.000000", "1000000000")],
      })
    ).toBe(true);
    expect(productHasExternalReceipts(solOnly)).toBe(false);
  });
  it("still reads products from servers that send no token rows", () => {
    const legacy = { positionMinor: "250000000", withdrawableMinor: "0" };
    expect(productValueUsd(legacy)).toBe(250);
    expect(productCanWithdraw(legacy)).toBe(false);
    expect(productHasExternalReceipts(legacy)).toBe(true);
  });
});

describe("Earn income across tokens", () => {
  const asset = (
    lifetimeEarnedUsd: string | null | undefined,
    lastSevenDaysEarnedUsd: string | null | undefined = lifetimeEarnedUsd
  ) => ({
    mint: "m",
    symbol: "T",
    name: "T",
    iconUrl: null,
    decimals: 6,
    apy: 0.04,
    positionRaw: "0",
    positionUsd: "0.000000",
    withdrawableRaw: "0",
    lifetimeEarnedRaw: "0",
    lastSevenDaysEarnedRaw: "0",
    lifetimeEarnedUsd,
    lastSevenDaysEarnedUsd,
    depositableRaw: "0",
    available: true,
    withdrawAvailable: false,
  });
  const catalog = (assets: ReturnType<typeof asset>[][]) => ({
    depositableMinor: "0",
    lifetimeMinor: "0",
    lastSevenDaysMinor: "0",
    products: assets.map((a, i) => ({
      id: (i === 0 ? "kamino" : "jupiter") as "kamino" | "jupiter",
      provider: "P",
      name: "Lending Yield",
      apy: null,
      positionShares: "0",
      positionMinor: "0",
      withdrawableMinor: "0",
      available: true,
      withdrawAvailable: false,
      updatedAt: "2026-11-26T00:00:00.000Z",
      lifetimeMinor: "0",
      lastSevenDaysMinor: "0",
      assets: a,
    })),
  });
  it("adds SOL income in dollars to the USDC-only product figures", () => {
    expect(
      productEarningsUsd({
        assets: [asset("1.250000"), asset("15.000000", null)],
      })
    ).toEqual({ lifetimeMinor: "16250000", lastSevenDaysMinor: null });
    expect(
      catalogEarnings(
        catalog([[asset("0.500000")], [asset("1.250000"), asset("15.000000")]])
      )
    ).toEqual({ lifetimeMinor: "16750000", lastSevenDaysMinor: "16750000" });
  });
  it("falls back to the account totals for a server without token dollars", () => {
    expect(productEarningsUsd({ assets: [asset(undefined)] })).toBeNull();
    expect(catalogEarnings(catalog([[asset(undefined)]]))).toEqual({
      lifetimeMinor: "0",
      lastSevenDaysMinor: "0",
    });
  });
});
