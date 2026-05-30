import { z } from 'zod';

/**
 * Wallet response shapes for the Phase 1 GET /wallet/me and
 * GET /wallet/me/balances endpoints.
 *
 * These coexist alongside the legacy /wallets/me and
 * /wallets/me/balances endpoints (which return the Grid-shaped
 * payload). Mobile cuts over in Phase 4; Phase 5 deletes the legacy
 * pair.
 *
 * Spec: docs/specs/migration-already-built-features.md §5.3, §5.5.
 */

export const WalletResponseSchema = z.object({
  walletAddress: z.string(),
  provider: z.literal('privy'),
});
export type WalletResponse = z.infer<typeof WalletResponseSchema>;

/**
 * Per-mint balance entry. `symbol` is nullable because we do not run a
 * mint-metadata fetch here; the mobile app maps known mints (USDC,
 * USDT) to symbols itself, and any non-stablecoin SPL mint surfaces
 * under Investments where the symbol is resolved on-demand. Keeping
 * symbol nullable here means the backend never blocks balance reads
 * on a metadata round-trip per the spec §5.5 perf budget.
 *
 * `amountRaw` is an integer at the mint's native decimals, serialized
 * as a string because Solana u64 amounts overflow JS Number. The
 * mobile app divides by 10^decimals for display.
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
