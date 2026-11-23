import { chooseToken, type SwapPair } from "@/utils/swapPair";
import type { SwapToken } from "@/utils/swap";

const token = (symbol: string): SwapToken => ({
  mint: `${symbol}-mint`,
  symbol,
  name: symbol,
  decimals: 6,
  iconUrl: null,
});

const pair: SwapPair = { pay: token("SOL"), receive: token("USDC") };

describe("chooseToken", () => {
  it("replaces the side that was chosen for", () => {
    expect(chooseToken(pair, "receive", token("JUP"))).toEqual({
      pay: token("SOL"),
      receive: token("JUP"),
    });
  });

  it("turns the pair around when the other side's asset is chosen", () => {
    expect(chooseToken(pair, "pay", token("USDC"))).toEqual({
      pay: token("USDC"),
      receive: token("SOL"),
    });
    expect(chooseToken(pair, "receive", token("SOL"))).toEqual({
      pay: token("USDC"),
      receive: token("SOL"),
    });
  });
});
