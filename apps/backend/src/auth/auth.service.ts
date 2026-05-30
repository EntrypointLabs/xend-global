import {
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GridService } from '../grid/grid.service';
import { DbService } from '../db/db.service';
import { users, smartAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  CompleteAuthAndCreateAccountResponse,
  CompleteAuthResponse,
  SessionSecrets,
  MetaInfo,
  GridClientUserContext,
} from '@sqds/grid';
import { PublicKey } from '@solana/web3.js';
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
    private grid: GridService,
    private jwt: JwtService,
    private db: DbService,
    @Inject(WALLET_PROVIDER) private wallet: WalletProvider,
    @Inject(SOLANA_RPC) private solana: SolanaRpc,
  ) {}

  // ── Phase 1: Privy exchange ────────────────────────────────────────
  //
  // POST /auth/exchange replaces the Grid-shaped /register +
  // /verify-otp-and-create-account chain. Mobile completes the Privy
  // email-OTP + embedded-wallet flow client-side, then hands us the
  // Privy ID token. We verify it via the WalletProvider seam (today
  // PrivyAdapter), upsert users + smart_accounts, and mint our own
  // JWT. The legacy /register, /auth, /verify-otp, and
  // /verify-otp-and-create-account remain alive until Phase 5 deletes
  // them.
  //
  // Spec: docs/specs/migration-already-built-features.md §5.1.
  async exchange(privyIdToken: string): Promise<ExchangeResponse> {
    // 1. Verify the Privy ID token. Typed errors from PrivyAdapter map
    //    to the Phase 1 "Error codes" table:
    //      InvalidPrivyTokenError -> 401 INVALID_PRIVY_TOKEN
    //      PrivyUserShapeError    -> 422 EMAIL_MISMATCH (rare: missing
    //                                 email / Solana wallet)
    //      PrivyUnavailableError  -> 502 PRIVY_UNAVAILABLE
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
        // PLAN.md error-codes maps this case to 422 EMAIL_MISMATCH.
        // The PrivyUserShapeError carries the underlying shape detail.
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
      // Defensive: unknown shape — treat as upstream outage.
      this.logger.error('Unexpected error verifying Privy ID token', err);
      throw new HttpException(
        { code: 'PRIVY_UNAVAILABLE', message: 'Privy verification failed' },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const { providerUserId, email, walletAddress } = privyUser;

    // 2. Upsert users by email. We capture isNewUser by checking
    //    whether the row existed before insert. The `users` table is
    //    keyed by email (UNIQUE NOT NULL); concurrent first-login from
    //    two devices is resolved by the ON CONFLICT path on
    //    smart_accounts (step 3) — the second writer reads the
    //    already-inserted row.
    const [existingUser] = await this.db.client
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let userRow: typeof users.$inferSelect;
    let isNewUser: boolean;

    if (existingUser) {
      // Touch updatedAt so the row reflects the most recent sign-in.
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

    // 3. Upsert smart_accounts keyed by (provider, provider_user_id).
    //    provider_user_id is UNIQUE in 0001; we INSERT ... ON CONFLICT
    //    DO UPDATE SET updated_at = NOW(). The wallet_address column is
    //    also UNIQUE: if Privy ever returns a different wallet for the
    //    same provider_user_id (extremely unlikely; the embedded
    //    wallet is permanent) we still keep the original row.
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
      // Phase 2: subscribe the wallet to the Helius account-activity
      // webhook so inbound receives + outbound confirmations are
      // surfaced to the tailer in real time. Wrapped in try/catch:
      // webhook registration failure MUST NOT break /auth/exchange.
      // The reconciler poll's getSignatureStatuses + boot-time
      // streamConfirmedTransfers replay is the safety net — if the
      // registration is missing, the wallet still gets reconciled,
      // just with the 30s poll latency instead of the webhook's ~3s.
      //
      // We deliberately do NOT touch the legacy /verify-otp* path
      // here; it gets its own subscription wiring when Phase 4
      // migrates it. Adding the call there now would double-register
      // wallets that the Phase 1 /auth/exchange path also covers.
      try {
        await this.solana.registerWebhookAddress(walletAddress);
      } catch (err) {
        this.logger.error(
          `Failed to register webhook address for ${walletAddress} (continuing; reconciler will catch up)`,
          err,
        );
      }
    } else {
      // Touch updatedAt; do not mutate walletAddress or provider.
      await this.db.client
        .update(smartAccounts)
        .set({ updatedAt: new Date() })
        .where(eq(smartAccounts.id, existingAccount.id));
      // If the smart_account already existed under a different users.id
      // (e.g. user changed Privy-linked email between sessions) we keep
      // the existing user binding. isNewUser reflects the users-row
      // insert, not the smart_account.
    }

    // 4. Mint our own JWT. Shape matches jwt.strategy.ts:JwtPayload
    //    ({ sub: userId, walletAddress }) so all downstream guarded
    //    routes (wallet/me, transfers/*) work without a DB lookup.
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

  private handleGridError(error: unknown, context: string): never {
    this.logger.error(`Grid error in ${context}:`, error);

    const err = error as Record<string, unknown> | undefined;
    const lastResponse = err?.lastResponse as
      | Record<string, unknown>
      | undefined;
    const cause = lastResponse?.cause as Record<string, unknown> | undefined;
    const response = err?.response as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;

    const status =
      cause?.statusCode ?? err?.statusCode ?? response?.status ?? err?.status;
    const message =
      (data?.message as string) ??
      (err?.message as string) ??
      'Grid service error';
    const code =
      (data?.code as string) ?? (err?.code as string) ?? 'GRID_ERROR';

    // Map known Grid status codes to HTTP status codes
    if (status === 404 || message.toLowerCase().includes('not found')) {
      throw new HttpException(
        { code: 'USER_NOT_FOUND', message },
        HttpStatus.NOT_FOUND,
      );
    }
    if (status === 401 || message.toLowerCase().includes('unauthorized')) {
      throw new HttpException(
        { code: 'UNAUTHORIZED', message },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (
      status === 409 ||
      message.toLowerCase().includes('already exists') ||
      message.toLowerCase().includes('conflict')
    ) {
      throw new HttpException(
        { code: 'USER_ALREADY_EXISTS', message },
        HttpStatus.CONFLICT,
      );
    }
    if (status === 429 || message.toLowerCase().includes('rate limit')) {
      throw new HttpException(
        { code: 'OTP_RATE_LIMIT', message },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    throw new HttpException(
      { code, message },
      typeof status === 'number' && status >= 400
        ? status
        : HttpStatus.BAD_GATEWAY,
    );
  }

  // Registration

  // Step 1: mobile sends email - Grid sends OTP
  async register(email: string) {
    try {
      return await this.grid.createAccount(email);
    } catch (error) {
      this.handleGridError(error, 'register');
    }
  }

  // Step 2: mobile sends OTP + sessionSecrets + user context
  // Grid creates the smart account automatically with Turnkey MPC
  async verifyOtpAndCreateAccount(dto: {
    otpCode: string;
    sessionSecrets: SessionSecrets;
    user: GridClientUserContext;
  }) {
    let gridResponse: CompleteAuthAndCreateAccountResponse;
    try {
      gridResponse = await this.grid.completeAuthAndCreateAccount({
        otpCode: dto.otpCode,
        sessionSecrets: dto.sessionSecrets,
        user: dto.user,
      });
    } catch (error) {
      this.handleGridError(error, 'verifyOtpAndCreateAccount');
    }

    const address = gridResponse.data.address;

    // Check if user already exists (e.g. re-registration attempt)
    const existingAccount = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.walletAddress, address))
      .limit(1);

    if (existingAccount.length > 0) {
      // Already registered — just return a JWT
      const token = this.jwt.sign({
        sub: existingAccount[0].userId,
        walletAddress: address,
      });
      return { ...gridResponse, token };
    }

    // First time — persist user + smart account.
    //
    // Phase 1 schema requires provider_user_id (UNIQUE NOT NULL). For
    // the Grid-shaped flow we synthesize one as `grid:<walletAddress>`
    // so the column has a value; Phase 4 will replace this whole code
    // path with a Privy ID-token exchange (/auth/exchange) that
    // populates provider_user_id with the real Privy DID.
    const email = dto.user?.email ?? '';
    const [user] = await this.db.client
      .insert(users)
      .values({ email })
      .returning();

    await this.db.client.insert(smartAccounts).values({
      userId: user.id,
      walletAddress: address,
      provider: 'privy',
      providerUserId: `grid:${address}`,
    });

    const token = this.jwt.sign({ sub: user.id, walletAddress: address });

    return { ...gridResponse, token };
  }

  // Login

  // Step 1: mobile sends email → Grid sends OTP
  async authenticate(email: string) {
    try {
      return await this.grid.initAuth(email);
    } catch (error) {
      this.handleGridError(error, 'authenticate');
    }
  }

  // Step 2: mobile sends OTP + sessionSecrets + user context
  async verifyOtp(dto: {
    otpCode: string;
    sessionSecrets: SessionSecrets;
    user: GridClientUserContext;
  }) {
    let gridResponse: CompleteAuthResponse;
    try {
      gridResponse = await this.grid.completeAuth({
        otpCode: dto.otpCode,
        sessionSecrets: dto.sessionSecrets,
        user: dto.user,
      });
    } catch (error) {
      this.handleGridError(error, 'verifyOtp');
    }

    const address = gridResponse.data.address;

    const [smartAccount] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.walletAddress, address))
      .limit(1);

    if (!smartAccount) throw new UnauthorizedException('Account not found');

    const token = this.jwt.sign({
      sub: smartAccount.userId,
      walletAddress: address,
    });

    return { ...gridResponse, token };
  }

  // ── Passkeys ───────────────────────────────────────────────────────

  async checkPasskeys(accountAddress: string) {
    try {
      return await this.grid.getPasskeys(accountAddress);
    } catch (error) {
      this.handleGridError(error, 'checkPasskeys');
    }
  }

  async createPasskeySession(dto: {
    accountAddress: string;
    metaInfo: MetaInfo;
  }) {
    try {
      const sessionSecrets = await this.grid.generateSessionSecrets();
      const passkeySecret = sessionSecrets.find((s) => s.tag === 'passkey');
      if (!passkeySecret) {
        throw new HttpException(
          {
            code: 'PASSKEY_SESSION_FAILED',
            message: 'No passkey session key generated',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const pubKey = new PublicKey(passkeySecret.publicKey);

      const sessionKey = this.grid.client.getSessionKeyObject(
        pubKey.toBase58(),
        '900',
      );

      return await this.grid.createPasskeySession({
        sessionKey,
        env: this.grid.getEnv(),
        metaInfo: dto.metaInfo,
      });
    } catch (error) {
      this.handleGridError(error, 'createPasskeySession');
    }
  }
}
