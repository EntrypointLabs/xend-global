import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../db/db.service';
import { WRAPPED_SOL_MINT } from '../solana/web3-connection';
import { TOKEN_METADATA_PROVIDER } from '../tokens/token-metadata.interface';
import type { TokenMetadataProvider } from '../tokens/token-metadata.interface';
import { TOKEN_PRICE_PROVIDER } from '../prices/token-price.interface';
import type {
  TokenPrice,
  TokenPriceProvider,
} from '../prices/token-price.interface';
import type { TokenMetadata } from '../tokens/token-metadata.interface';
import { smartAccounts, squadsAccounts, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc, TokenBalance } from '../solana/solana-rpc.interface';
import type {
  BalancesResponse,
  DeleteAccountResponse,
  WalletResponse,
} from './dtos';

/**
 * A Consumer tried to delete their account while a token balance remains.
 * The controller maps this to 409 ACCOUNT_HAS_BALANCE so the mobile app can
 * point the Consumer at withdrawing/sending their Balance first.
 */
const SOL_DECIMALS = 9;

export class AccountHasBalanceError extends Error {
  readonly code = 'ACCOUNT_HAS_BALANCE';
  constructor(message: string) {
    super(message);
    this.name = 'AccountHasBalanceError';
  }
}

/**
 * Backs `/wallet/me` and `/wallet/me/balances` via SolanaRpc
 * (FailoverSolanaRpc).
 */
@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private db: DbService,
    @Inject(SOLANA_RPC) private solana: SolanaRpc,
    @Inject(TOKEN_PRICE_PROVIDER) private prices: TokenPriceProvider,
    @Inject(TOKEN_METADATA_PROVIDER) private metadata: TokenMetadataProvider,
    private config: ConfigService,
  ) {}

  async getMe(userId: string): Promise<WalletResponse> {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    return {
      walletAddress: account.walletAddress,
      provider: 'privy',
    };
  }

  /**
   * Where the Consumer's money actually is.
   *
   * The Squads vault once an Account exists, and the Privy wallet before
   * that. Both are real at once during the migration window: the vault is the
   * address a Consumer receives at, while any pre-multisig balance still sits
   * in the Privy wallet until it is swept.
   */
  private async resolveBalanceAddress(
    userId: string,
    privyAddress: string,
  ): Promise<string> {
    const [account] = await this.db.client
      .select({ vaultAddress: squadsAccounts.vaultAddress })
      .from(squadsAccounts)
      .where(eq(squadsAccounts.userId, userId))
      .limit(1);

    return account?.vaultAddress ?? privyAddress;
  }

  async getMeBalances(userId: string): Promise<BalancesResponse> {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    const address = await this.resolveBalanceAddress(
      userId,
      account.walletAddress,
    );

    // Parallel read: tokens + native SOL + a recent block reference.
    // `lastValidBlockHeight` is the closest monotonic chain marker without a
    // separate getSlot round trip; mobile uses it for cache-staleness
    // signalling only.
    const [tokens, lamports, blockhash] = await Promise.all([
      this.solana.getTokenBalances(address),
      this.solana.getSolBalance(address),
      this.solana.getRecentBlockhash(),
    ]);

    const held = withNativeSol(tokens, lamports);
    const mints = held.map((t) => t.mint);
    const [usdPrices, metadata] = await Promise.all([
      this.usdPricesFor(held),
      this.metadataFor(mints),
    ]);

    return {
      walletAddress: address,
      tokens: held.map((t) => ({
        mint: t.mint,
        amountRaw: t.amountRaw.toString(),
        decimals: t.decimals,
        // Named rather than left null so the Consumer reads "SOL" instead of a
        // truncated mint, which is all the client can show without a symbol.
        symbol: metadata.get(t.mint)?.symbol ?? symbolFallback(t.mint),
        name: metadata.get(t.mint)?.name ?? null,
        iconUrl: metadata.get(t.mint)?.iconUrl ?? null,
        usdValue: usdValueOf(t, usdPrices.get(t.mint)?.usdPrice),
        usdPrice: usdPrices.get(t.mint)?.usdPrice ?? null,
        priceChange24h: usdPrices.get(t.mint)?.priceChange24h ?? null,
      })),
      fetchedAtSlot: blockhash.lastValidBlockHeight,
    };
  }

  /**
   * USD price per whole token for everything held.
   *
   * A price outage degrades to unpriced holdings rather than an error: the
   * balance itself is on-chain fact and must still render. Stablecoin pinning
   * lives in the provider, so a balance and an activity row agree.
   */
  private async usdPricesFor(
    held: TokenBalance[],
  ): Promise<Map<string, TokenPrice>> {
    try {
      return await this.prices.getUsdPrices(held.map((t) => t.mint));
    } catch (err) {
      this.logger.warn(
        `prices.unavailable mints=${held.length}; balances will report them unpriced`,
        err,
      );
      return new Map();
    }
  }

  /**
   * Names and logos for what is held.
   *
   * Never allowed to fail the read: a balance is the point of the endpoint and
   * a missing logo is not a reason to withhold it.
   */
  private async metadataFor(
    mints: string[],
  ): Promise<Map<string, TokenMetadata>> {
    try {
      return await this.metadata.getMetadata(mints);
    } catch (err) {
      this.logger.warn('tokens.metadata.failed; balances render unnamed', err);
      return new Map();
    }
  }

  /**
   * Closes a Consumer's Xend account. Blocked while any token balance
   * remains — Xend has no custody path to sweep it out first, so a
   * Consumer must withdraw/send everything down to zero themselves.
   *
   * `users` is soft-deleted (`deletedAt` set, email anonymized to free it
   * up) rather than removed — `smart_accounts` and `transfers` stay in
   * place for the financial-recordkeeping retention the privacy policy
   * commits to. JwtStrategy rejects any token for a soft-deleted user, so
   * this is a hard lockout regardless of how long the caller's JWT still
   * has left to live.
   *
   * `smart_accounts.wallet_address` / `provider_user_id` are also
   * anonymized (not left pointing at the real values): both columns are
   * unique, and `/auth/exchange` re-inserts a smart_accounts row keyed on
   * the new user if the same Privy identity signs in again later. Leaving
   * the old row's uniques intact would turn that re-registration into an
   * unhandled 500 instead of a clean new account.
   */
  async deleteMe(userId: string): Promise<DeleteAccountResponse> {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    const tokens = await this.solana.getTokenBalances(account.walletAddress);
    if (tokens.some((t) => t.amountRaw > 0n)) {
      throw new AccountHasBalanceError(
        'Balance must be zero before the account can be deleted',
      );
    }

    await this.db.client
      .update(users)
      .set({
        email: `deleted-${userId}@deleted.xend.internal`,
        deletedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await this.db.client
      .update(smartAccounts)
      .set({
        walletAddress: `deleted-${account.id}`,
        providerUserId: `deleted-${account.id}`,
      })
      .where(eq(smartAccounts.id, account.id));

    return { deleted: true };
  }
}

/**
 * Fold native SOL into the token list.
 *
 * Native SOL lives in the account's lamports, not in a token account, so it
 * never comes back from getTokenBalances: a wallet holding nothing but SOL
 * reads as holding nothing at all. Summed with any real wrapped-SOL account
 * rather than listed beside it, because two rows for the same mint is not
 * something a Consumer can act on.
 */
function withNativeSol(
  tokens: TokenBalance[],
  lamports: bigint,
): TokenBalance[] {
  if (lamports === 0n) return tokens;

  const hasWrapped = tokens.some((t) => t.mint === WRAPPED_SOL_MINT);
  if (!hasWrapped) {
    return [
      ...tokens,
      {
        mint: WRAPPED_SOL_MINT,
        amountRaw: lamports,
        decimals: SOL_DECIMALS,
      },
    ];
  }

  return tokens.map((t) =>
    t.mint === WRAPPED_SOL_MINT
      ? { ...t, amountRaw: t.amountRaw + lamports }
      : t,
  );
}

/**
 * Value of a holding, or null when its mint could not be priced.
 *
 * The raw amount is divided in two parts so a large u64 does not lose its
 * whole-token component to float rounding before the multiply.
 */
function usdValueOf(
  token: TokenBalance,
  usdPrice: number | undefined,
): number | null {
  if (usdPrice === undefined) return null;

  const divisor = 10n ** BigInt(token.decimals);
  const whole = Number(token.amountRaw / divisor);
  const fraction = Number(token.amountRaw % divisor) / Number(divisor);
  return (whole + fraction) * usdPrice;
}

/**
 * The symbol to use when nothing upstream names the mint.
 *
 * Only native SOL is special-cased, because the cluster's own wrapped-SOL
 * mint is the one holding every Consumer has that a mainnet token index may
 * not resolve on a test network.
 */
function symbolFallback(mint: string): string | null {
  return mint === WRAPPED_SOL_MINT ? 'SOL' : null;
}
