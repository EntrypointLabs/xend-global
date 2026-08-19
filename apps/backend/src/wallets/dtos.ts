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
  /**
   * What the holding is worth in USD, or null when nothing could price the
   * mint. Null rather than 0 on purpose: a holding of unknown value must not
   * be silently summed as worthless, which would understate a Consumer's
   * balance without saying so.
   */
  usdValue: z.number().nullable(),
  /**
   * USD per whole token, or null when the mint could not be priced. Carried
   * alongside the value because a holding of zero has a price but no value,
   * and reconstructing one from the other divides by that zero.
   */
  usdPrice: z.number().nullable(),
  /**
   * Percent change in the mint's price over 24 hours, or null when nothing
   * reports one (a pinned stablecoin, or an unpriced mint). Null rather than 0
   * so "flat" and "unknown" are not shown to a Consumer as the same thing.
   */
  priceChange24h: z.number().nullable(),
  /** What a Consumer calls it: "Solana". Null when nothing knows the mint. */
  name: z.string().nullable(),
  /**
   * Absolute URL of the token's logo, or null when nothing has one. Null
   * rather than a placeholder so the client picks its own fallback instead of
   * rendering a broken image.
   */
  iconUrl: z.string().nullable(),
});
export type TokenBalanceDto = z.infer<typeof TokenBalanceSchema>;

export const BalancesResponseSchema = z.object({
  walletAddress: z.string(),
  tokens: z.array(TokenBalanceSchema),
  fetchedAtSlot: z.number().int(),
});
export type BalancesResponse = z.infer<typeof BalancesResponseSchema>;

export const DeleteAccountResponseSchema = z.object({
  deleted: z.literal(true),
});
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponseSchema>;
