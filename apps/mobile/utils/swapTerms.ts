import type { SwapQuoteResponse } from "@/utils/apiClient";
import type { SwapQuote } from "@/utils/swap";

export interface SwapRequest {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
}

/**
 * The quote for exactly what was asked, or null when the answer is for
 * anything else.
 *
 * What is paid, and in which assets, is what the Consumer typed and sees on
 * screen, and the signed transaction is later checked against the quote. So
 * those terms are taken from the request, never from the answer: a quote
 * that quietly named a larger amount would otherwise be approved under the
 * smaller one still showing.
 */
export function bindSwapQuote(
  request: SwapRequest,
  quoted: SwapQuoteResponse
): SwapQuote | null {
  if (
    quoted.inputMint !== request.inputMint ||
    quoted.outputMint !== request.outputMint ||
    quoted.amountInRaw !== request.amountRaw
  ) {
    return null;
  }
  return {
    quoteId: quoted.quoteId,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amountInRaw: request.amountRaw,
    outAmountRaw: quoted.amountOutRaw,
    minOutAmountRaw: quoted.minAmountOutRaw,
    slippageBps: quoted.slippageBps,
    venue: quoted.venue,
    expiresAt: quoted.expiresAt,
  };
}
