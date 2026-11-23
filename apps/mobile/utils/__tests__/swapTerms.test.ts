import type { SwapQuoteResponse } from "@/utils/apiClient";
import { bindSwapQuote } from "@/utils/swapTerms";

const request = { inputMint: "sol", outputMint: "usdc", amountRaw: "1000" };
const quoted: SwapQuoteResponse = {
  quoteId: "quote",
  inputMint: "sol",
  outputMint: "usdc",
  amountInRaw: "1000",
  amountOutRaw: "7000",
  minAmountOutRaw: "6965",
  slippageBps: 50,
  venue: "Whirlpool",
  expiresAt: 1_800_000_000,
};

describe("bindSwapQuote", () => {
  it("accepts a quote for what was asked", () => {
    expect(bindSwapQuote(request, quoted)).toMatchObject({
      quoteId: "quote",
      amountInRaw: "1000",
      outAmountRaw: "7000",
      minOutAmountRaw: "6965",
    });
  });

  it("refuses a quote that pays more than was asked", () => {
    expect(
      bindSwapQuote(request, { ...quoted, amountInRaw: "10000" })
    ).toBeNull();
  });

  it("refuses a quote for another pair", () => {
    expect(bindSwapQuote(request, { ...quoted, inputMint: "jup" })).toBeNull();
    expect(bindSwapQuote(request, { ...quoted, outputMint: "jup" })).toBeNull();
  });

  it("works out the floor itself instead of showing the one it was sent", () => {
    const bound = bindSwapQuote(request, {
      ...quoted,
      minAmountOutRaw: "6999",
    });
    expect(bound?.minOutAmountRaw).toBe("6965");
  });

  it("refuses a quote that may settle further short than this app allows", () => {
    expect(
      bindSwapQuote(request, { ...quoted, slippageBps: 9_999 })
    ).toBeNull();
  });

  it("refuses a quote that pays out nothing", () => {
    expect(bindSwapQuote(request, { ...quoted, amountOutRaw: "0" })).toBeNull();
  });
});
