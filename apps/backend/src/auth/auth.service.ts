import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DbService } from '../db/db.service';
import { users, smartAccounts, passkeyCredentials } from '../db/schema';
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
import type { ExchangeResponse, MirrorPasskeyCredentialRequest } from './dtos';

/**
 * A passkey credential is already mirrored under a different account. Kept
 * HTTP-framework-agnostic (plain Error subclass); the controller maps it to
 * 409 CREDENTIAL_CONFLICT.
 */
export class CredentialConflictError extends Error {
  readonly code = 'CREDENTIAL_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'CredentialConflictError';
  }
}

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

    const { providerUserId, email, walletAddress, passkeys } = privyUser;

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

    // Mirror passkey credential metadata (the vendor hedge). Fire-and-
    // forget: a failed hedge-write must never break /auth/exchange, and
    // replays collapse via ON CONFLICT DO NOTHING (same idempotency
    // posture as the smart_accounts upsert above). public_key is absent on
    // this server-side path (Privy's SDK drops it); the client backfills
    // it through POST /auth/passkey-credentials at enrollment.
    if (passkeys.length > 0) {
      try {
        await this.db.client
          .insert(passkeyCredentials)
          .values(
            passkeys.map((passkey) => ({
              userId: userRow.id,
              credentialId: passkey.credentialId,
              publicKey: passkey.publicKey,
            })),
          )
          .onConflictDoNothing({ target: passkeyCredentials.credentialId });
      } catch (err) {
        this.logger.error(
          `Failed to mirror passkey credentials for user ${userRow.id} (continuing; the mirror is a hedge, not auth truth)`,
          err,
        );
      }
    }

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

  /**
   * Backfill or record a mirrored passkey credential for the authenticated
   * Consumer. Enrollment on the client supplies the public key the
   * server-side vendor SDK cannot see. Idempotent: re-sending the same
   * credential is a no-op (or a public-key backfill); a credential already
   * owned by another Consumer is rejected so one account cannot claim
   * another's credential.
   */
  async mirrorPasskeyCredential(
    userId: string,
    dto: MirrorPasskeyCredentialRequest,
  ): Promise<{ mirrored: true }> {
    const [existing] = await this.db.client
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.credentialId, dto.credentialId))
      .limit(1);

    if (existing) {
      if (existing.userId !== userId) {
        throw new CredentialConflictError(
          'Passkey credential already mirrored under a different account',
        );
      }
      // Backfill the public key only when we do not already hold one; the
      // first captured value wins.
      if (dto.publicKey && !existing.publicKey) {
        await this.db.client
          .update(passkeyCredentials)
          .set({ publicKey: dto.publicKey, updatedAt: new Date() })
          .where(eq(passkeyCredentials.id, existing.id));
      }
      return { mirrored: true };
    }

    await this.db.client.insert(passkeyCredentials).values({
      userId,
      credentialId: dto.credentialId,
      publicKey: dto.publicKey,
    });
    return { mirrored: true };
  }
}
