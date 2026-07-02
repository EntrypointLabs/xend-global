import { z } from 'zod';

// Response shapes for GET /wallet/me and GET /wallet/me/balances.

export const WalletResponseSchema = z.object({
  walletAddress: z.string(),
  provider: z.literal('privy'),
});
export type WalletResponse = z.infer<typeof WalletResponseSchema>;

/**
 * Per-mint balance entry. `symbol` is nullable because no mint-metadata
 * fetch runs here — the mobile app maps known mints (USDC, USDT) to
 * symbols itself — so the backend never blocks balance reads on a
 * metadata round-trip.
 *
 * `amountRaw` is an integer at the mint's native decimals, serialized as
 * a string because Solana u64 amounts overflow JS Number. The mobile app
 * divides by 10^decimals for display.
 */
export const TokenBalanceSchema = z.object({
  mint: z.string(),
  amountRaw: z.string(),
  decimals: z.number().int(),
  symbol: z.string().nullable(),
});
export type TokenBalanceDto = z.infer<typeof TokenBalanceSchema>;

export const BalancesResponseSchema = z.object({
  walletAddress: z.string(),
  tokens: z.array(TokenBalanceSchema),
  fetchedAtSlot: z.number().int(),
});
export type BalancesResponse = z.infer<typeof BalancesResponseSchema>;
