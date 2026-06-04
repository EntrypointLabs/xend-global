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

    // Upsert smart_accounts keyed by (provider, provider_user_id).
    const [existingAccount] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.providerUserId, providerUserId))
      .limit(1);

    if (!existingAccount) {
      await this.db.client.insert(smartAccounts).values({
        userId: userRow.id,
        walletAddress,
        provider: 'privy',
        providerUserId,
      });
      // Best-effort webhook registration; the reconciler is the safety
      // net. Failure MUST NOT break /auth/exchange.
      try {
        await this.solana.registerWebhookAddress(walletAddress);
      } catch (err) {
        this.logger.error(
          `Failed to register webhook address for ${walletAddress} (continuing; reconciler will catch up)`,
          err,
        );
      }
    } else {
      await this.db.client
        .update(smartAccounts)
        .set({ updatedAt: new Date() })
        .where(eq(smartAccounts.id, existingAccount.id));
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
