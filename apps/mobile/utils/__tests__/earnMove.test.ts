import { applyEarnMove, EarnCatalogSchema } from "@/utils/earn";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";

function asset(mint: string, positionRaw: string, positionUsd: string | null) {
  return {
    mint,
    symbol: mint === SOL ? "SOL" : "USDC",
    name: mint === SOL ? "Solana" : "USD Coin",
    iconUrl: null,
    decimals: mint === SOL ? 9 : 6,
    apy: 0.04,
    positionRaw,
    positionUsd,
    withdrawableRaw: positionRaw,
    lifetimeEarnedRaw: null,
    lastSevenDaysEarnedRaw: null,
    depositableRaw: "50000000",
    available: true,
    withdrawAvailable: true,
  };
}

const catalog = EarnCatalogSchema.parse({
  depositableMinor: "50000000",
  lifetimeMinor: null,
  lastSevenDaysMinor: null,
  products: [
    {
      id: "kamino",
      provider: "Kamino",
      name: "Flexible interest",
      apy: 0.0417,
      positionShares: "0",
      positionMinor: "10040000",
      withdrawableMinor: "10040000",
      available: true,
      withdrawAvailable: true,
      updatedAt: "2026-11-26T14:31:00.000Z",
      assets: [asset(USDC, "10040000", "10.040000")],
    },
    {
      id: "jupiter",
      provider: "Jupiter Lend",
      name: "Flexible interest",
      apy: 0.0428,
      positionShares: "0",
      positionMinor: "15040000",
      withdrawableMinor: "15040000",
      available: true,
      withdrawAvailable: true,
      updatedAt: "2026-11-26T14:31:00.000Z",
      assets: [asset(USDC, "15040000", "15.040000"), asset(SOL, "0", null)],
    },
  ],
});

describe("applyEarnMove", () => {
  it("empties a position the moment everything is withdrawn", () => {
    const after = applyEarnMove(catalog, {
      provider: "kamino",
      action: "redeem",
      mint: USDC,
      minor: 10040000n,
      all: true,
      usdc: true,
    });
    const kamino = after.products[0];
    expect(kamino.positionMinor).toBe("0");
    expect(kamino.assets?.[0].positionRaw).toBe("0");
    expect(kamino.assets?.[0].positionUsd).toBe("0");
    expect(after.products[1]).toBe(catalog.products[1]);
  });

  it("adds a deposit to the position and takes it from what is held", () => {
    const after = applyEarnMove(catalog, {
      provider: "jupiter",
      action: "deposit",
      mint: USDC,
      minor: 5000000n,
      all: false,
      usdc: true,
    });
    const usdc = after.products[1].assets?.[0];
    expect(usdc?.positionRaw).toBe("20040000");
    expect(usdc?.positionUsd).toBe("20.040000");
    expect(usdc?.depositableRaw).toBe("45000000");
    expect(after.products[1].positionMinor).toBe("20040000");
  });

  it("leaves a first deposit of an unpriced token unpriced", () => {
    const after = applyEarnMove(catalog, {
      provider: "jupiter",
      action: "deposit",
      mint: SOL,
      minor: 142800000n,
      all: false,
      usdc: false,
    });
    const sol = after.products[1].assets?.[1];
    expect(sol?.positionRaw).toBe("142800000");
    expect(sol?.positionUsd).toBeNull();
    expect(after.products[1].positionMinor).toBe("15040000");
  });
});
