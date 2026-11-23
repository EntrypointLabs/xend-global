import type { SwapQuoteResponse } from "@/utils/apiClient";
import { bindSwapQuote } from "@/utils/swapTerms";

const request = { inputMint: "sol", outputMint: "usdc", amountRaw: "1000" };
const quoted: SwapQuoteResponse = {
  quoteId: "quote",
  inputMint: "sol",
  outputMint: "usdc",
  amountInRaw: "1000",
  amountOutRaw: "70",
  minAmountOutRaw: "69",
  slippageBps: 50,
  venue: "Whirlpool",
  expiresAt: 1_800_000_000,
};

describe("bindSwapQuote", () => {
  it("accepts a quote for what was asked", () => {
    expect(bindSwapQuote(request, quoted)).toMatchObject({
      quoteId: "quote",
      amountInRaw: "1000",
      outAmountRaw: "70",
      minOutAmountRaw: "69",
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
});
