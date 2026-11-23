import type { TokenBalance } from "@/utils/apiClient";
import { heldSwapTokens, matchesTokenSearch } from "@/utils/swapTokens";
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
