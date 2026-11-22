import { z } from 'zod';

const mint = z.string().min(32).max(44);

/** Native SOL is named by its wrapped mint, the way a balance read names it. */
export const SwapQuoteRequestSchema = z.object({
  inputMint: mint,
  outputMint: mint,
  amountRaw: z.string().regex(/^[1-9]\d{0,19}$/),
});
export type SwapQuoteRequest = z.infer<typeof SwapQuoteRequestSchema>;

export const SwapPrepareRequestSchema = z.object({
  quoteId: z.string().uuid(),
});
export type SwapPrepareRequest = z.infer<typeof SwapPrepareRequestSchema>;

export const SwapSubmitRequestSchema = z.object({
  signedTxBase64: z.string().min(1),
});
export type SwapSubmitRequest = z.infer<typeof SwapSubmitRequestSchema>;

export interface SwapQuoteResponse {
  quoteId: string;
  inputMint: string;
  outputMint: string;
  amountInRaw: string;
  amountOutRaw: string;
  /** The least the swap can settle at; below it, it fails and nothing moves. */
  minAmountOutRaw: string;
  slippageBps: number;
  venue: string | null;
  /** Unix seconds. */
  expiresAt: number;
}

export interface SwapPrepareResponse {
  unsignedTxBase64: string;
  vaultAddress: string;
  primarySigner: string;
  blockhash: string;
  lastValidBlockHeight: number;
}
