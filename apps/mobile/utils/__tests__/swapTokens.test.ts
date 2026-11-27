import { EARN_PROVIDERS, JUPITER_EARN_ASSETS } from "@prydd/smart-account";
import type { TokenBalance } from "@/utils/apiClient";
import { formatTokenPrice } from "@/utils/swap";
import {
  heldSwapTokens,
  matchesTokenSearch,
  shortTokenAddress,
  tokenSearchKey,
} from "@/utils/swapTokens";
import { WRAPPED_SOL_MINT } from "@/utils/tokens";

const balance = (over: Partial<TokenBalance>): TokenBalance => ({
  mint: "mint",
  amountRaw: "1",
  decimals: 6,
  symbol: null,
  ...over,
});

describe("heldSwapTokens", () => {
  it("leaves out what the Account holds none of", () => {
    const held = heldSwapTokens([
      balance({ mint: "a", amountRaw: "0", symbol: "AAA", name: "Alpha" }),
      balance({ mint: "b", amountRaw: "25", symbol: "BBB", name: "Beta" }),
    ]);
    expect(held.map((token) => token.mint)).toEqual(["b"]);
  });

  it("leaves out Earn shares, which are withdrawn through Earn", () => {
    const held = heldSwapTokens([
      balance({ mint: EARN_PROVIDERS.kamino.receipt, amountRaw: "12376630" }),
      balance({
        mint: JUPITER_EARN_ASSETS.USDC.receipt,
        amountRaw: "14042735",
      }),
      balance({
        mint: JUPITER_EARN_ASSETS.SOL.receipt,
        amountRaw: "141736903",
      }),
      balance({ mint: "b", amountRaw: "25", symbol: "BBB", name: "Beta" }),
    ]);
    expect(held.map((token) => token.mint)).toEqual(["b"]);
  });

  it("puts the most valuable holding first", () => {
    const held = heldSwapTokens([
      balance({ mint: "a", symbol: "AAA", name: "Alpha", usdValue: 2 }),
      balance({ mint: "b", symbol: "BBB", name: "Beta", usdValue: 40 }),
      balance({ mint: "c", symbol: "CCC", name: "Gamma" }),
    ]);
    expect(held.map((token) => token.mint)).toEqual(["b", "a", "c"]);
  });

  it("calls native SOL what the rest of the app calls it", () => {
    const [sol] = heldSwapTokens([
      balance({
        mint: WRAPPED_SOL_MINT,
        decimals: 9,
        symbol: "SOL",
        name: "Wrapped SOL",
      }),
    ]);
    expect(sol).toMatchObject({ name: "Solana", symbol: "SOL", decimals: 9 });
  });
});

describe("matchesTokenSearch", () => {
  const token = {
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    symbol: "JUP",
    name: "Jupiter",
    decimals: 6,
    iconUrl: null,
  };

  it("finds a token by part of its name or ticker", () => {
    expect(matchesTokenSearch(token, " jupi ")).toBe(true);
    expect(matchesTokenSearch(token, "JUP")).toBe(true);
    expect(matchesTokenSearch(token, "bonk")).toBe(false);
  });

  it("finds a token by its whole mint address only", () => {
    expect(matchesTokenSearch(token, token.mint)).toBe(true);
    expect(matchesTokenSearch(token, token.mint.slice(0, 6))).toBe(false);
  });
});

describe("formatTokenPrice", () => {
  it("shows dollars and cents for a price of a dollar or more", () => {
    expect(formatTokenPrice(86282.657)).toBe("$86,282.66");
    expect(formatTokenPrice(1)).toBe("$1.00");
  });

  it("keeps the figures that matter for a price under a dollar", () => {
    expect(formatTokenPrice(0.9997041)).toBe("$0.9997");
    expect(formatTokenPrice(0.0000213449)).toBe("$0.00002134");
  });
});

describe("shortTokenAddress", () => {
  it("keeps the two ends of an address", () => {
    expect(
      shortTokenAddress("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")
    ).toBe("Es9v…wNYB");
  });
});

describe("tokenSearchKey", () => {
  it("treats a name the same however it is capitalised", () => {
    expect(tokenSearchKey(" Bonk ")).toBe("bonk");
  });

  it("leaves an address exactly as it was pasted", () => {
    const mint = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
    expect(tokenSearchKey(` ${mint} `)).toBe(mint);
  });
});
