/// <reference types="jest" />
import {
  describeToken,
  formatTokenAmount,
  WRAPPED_SOL_MINT,
} from "@/utils/tokens";

const USDC_MINT = "UsdcMint00000000000000000000000000000000000";

describe("describeToken", () => {
  const original = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;
  beforeEach(() => {
    process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS = USDC_MINT;
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS = original;
  });

  it("names native SOL", () => {
    expect(describeToken(WRAPPED_SOL_MINT)).toEqual({
      name: "Solana",
      symbol: "SOL",
    });
  });

  it("resolves USDC through the cluster's mint rather than a fixed address", () => {
    expect(describeToken(USDC_MINT)).toEqual({
      name: "USD Coin",
      symbol: "USDC",
    });
  });

  it("keeps our own name for SOL over the index's 'Wrapped SOL'", () => {
    // Accurate about the token, wrong about what the Consumer holds.
    expect(describeToken(WRAPPED_SOL_MINT, "SOL", "Wrapped SOL")).toEqual({
      name: "Solana",
      symbol: "SOL",
    });
  });

  it("takes the index's name for an asset it has never heard of", () => {
    expect(describeToken("SomeNewMint111", "BONK", "Bonk")).toEqual({
      name: "Bonk",
      symbol: "BONK",
    });
  });

  it("falls back to a truncated mint when it knows nothing", () => {
    expect(describeToken("AbcdefghijklmnopqrstuvwXYZ")).toEqual({
      name: "Abcd…wXYZ",
      symbol: "",
    });
  });

  it("prefers a supplied symbol over the truncated mint", () => {
    expect(describeToken("AbcdefghijklmnopqrstuvwXYZ", "BONK")).toEqual({
      name: "BONK",
      symbol: "BONK",
    });
  });
});

describe("formatTokenAmount", () => {
  it("drops trailing zeros a nine-decimal mint would otherwise show", () => {
    expect(formatTokenAmount(0.005, 9)).toBe("0.005");
    expect(formatTokenAmount(5, 9)).toBe("5");
  });

  it("groups thousands", () => {
    expect(formatTokenAmount(1234.5, 6)).toBe("1,234.5");
  });

  it("never shows more precision than the mint carries", () => {
    expect(formatTokenAmount(1.23456789, 2)).toBe("1.23");
  });
});
