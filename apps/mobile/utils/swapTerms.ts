import type { SwapQuoteResponse } from "@/utils/apiClient";
import type { SwapQuote } from "@/utils/swap";

/**
 * The most a swap may settle short of its quote. Held on the device so a
 * quote cannot loosen it: the floor is the only thing standing between the
 * price shown and whatever the venue pays out.
 */
export const MAX_SLIPPAGE_BPS = 100;

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
 *
 * The least it can settle at is worked out here for the same reason. The
 * transaction is checked against the quoted amount and the shortfall, so the
 * floor shown has to be the one those two produce, not a figure sent
 * alongside them.
 */
export function bindSwapQuote(
  request: SwapRequest,
  quoted: SwapQuoteResponse
): SwapQuote | null {
  if (
    quoted.inputMint !== request.inputMint ||
    quoted.outputMint !== request.outputMint ||
    quoted.amountInRaw !== request.amountRaw ||
    quoted.slippageBps > MAX_SLIPPAGE_BPS ||
    !/^[1-9]\d*$/.test(quoted.amountOutRaw)
  ) {
    return null;
  }
  const floor =
    (BigInt(quoted.amountOutRaw) * BigInt(10_000 - quoted.slippageBps)) /
    10_000n;
  return {
    quoteId: quoted.quoteId,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amountInRaw: request.amountRaw,
    outAmountRaw: quoted.amountOutRaw,
    minOutAmountRaw: floor.toString(),
    slippageBps: quoted.slippageBps,
    venue: quoted.venue,
    expiresAt: quoted.expiresAt,
  };
}
