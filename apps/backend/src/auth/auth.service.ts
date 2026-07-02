import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DbService } from '../db/db.service';
import { users, smartAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import { WALLET_PROVIDER } from '../wallet/wallet-provider.interface';
import type { WalletProvider } from '../wallet/wallet-provider.interface';
import {
  InvalidPrivyTokenError,
  PrivyUnavailableError,
  PrivyUserShapeError,
} from '../wallet/privy.errors';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { ExchangeResponse } from './dtos';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwt: JwtService,
    private db: DbService,
    @Inject(WALLET_PROVIDER) private wallet: WalletProvider,
    @Inject(SOLANA_RPC) private solana: SolanaRpc,
  ) {}

  async exchange(privyIdToken: string): Promise<ExchangeResponse> {
    // Verify the Privy ID token. Typed errors from PrivyAdapter map to
    // HTTP responses:
    //   InvalidPrivyTokenError -> 401 INVALID_PRIVY_TOKEN
    //   PrivyUserShapeError    -> 422 EMAIL_MISMATCH (missing email /
    //                              Solana wallet)
    //   PrivyUnavailableError  -> 502 PRIVY_UNAVAILABLE
    let privyUser: Awaited<ReturnType<WalletProvider['verifyIdToken']>>;
    try {
      privyUser = await this.wallet.verifyIdToken(privyIdToken);
    } catch (err) {
      if (err instanceof InvalidPrivyTokenError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (err instanceof PrivyUserShapeError) {
        throw new HttpException(
          { code: 'EMAIL_MISMATCH', message: err.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (err instanceof PrivyUnavailableError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.BAD_GATEWAY,
        );
      }
      this.logger.error('Unexpected error verifying Privy ID token', err);
      throw new HttpException(
        { code: 'PRIVY_UNAVAILABLE', message: 'Privy verification failed' },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const { providerUserId, email, walletAddress } = privyUser;

    // Upsert users by email.
    const [existingUser] = await this.db.client
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let userRow: typeof users.$inferSelect;
    let isNewUser: boolean;

    if (existingUser) {
      const [touched] = await this.db.client
        .update(users)
        .set({ updatedAt: new Date() })
        .where(eq(users.id, existingUser.id))
        .returning();
      userRow = touched;
      isNewUser = false;
    } else {
      const [inserted] = await this.db.client
        .insert(users)
        .values({ email })
        .returning();
      userRow = inserted;
      isNewUser = true;
    }

    // Upsert smart_accounts keyed by user_id (UNIQUE). Matching on
    // provider_user_id alone would miss when an existing user re-creates
    // their Privy account (fresh DID + embedded wallet) under the same
    // email, and the resulting INSERT would violate the user_id unique
    // constraint and lock the user out. Keying on user_id makes re-auth
    // idempotent and adopts the new DID/wallet.
    const [existingAccount] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userRow.id))
      .limit(1);
    const previousWalletAddress = existingAccount?.walletAddress;

    await this.db.client
      .insert(smartAccounts)
      .values({
        userId: userRow.id,
        walletAddress,
        provider: 'privy',
        providerUserId,
      })
      .onConflictDoUpdate({
        target: smartAccounts.userId,
        set: {
          walletAddress,
          provider: 'privy',
          providerUserId,
          updatedAt: new Date(),
        },
      });

    // Register the webhook whenever this is a new account or the wallet
    // address changed (e.g. re-auth with a fresh embedded wallet).
    // Best-effort; the reconciler is the safety net, so failure MUST NOT
    // break /auth/exchange.
    if (!existingAccount || previousWalletAddress !== walletAddress) {
      try {
        await this.solana.registerWebhookAddress(walletAddress);
      } catch (err) {
        this.logger.error(
          `Failed to register webhook address for ${walletAddress} (continuing; reconciler will catch up)`,
          err,
        );
      }
    }

    // Mint our JWT. Shape matches jwt.strategy.ts:JwtPayload.
    const token = this.jwt.sign({
      sub: userRow.id,
      walletAddress,
    });

    return {
      token,
      user: {
        id: userRow.id,
        email,
        walletAddress,
        isNewUser,
      },
    };
  }
}
