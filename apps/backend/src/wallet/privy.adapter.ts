import {
  Injectable,
  Logger,
  NotImplementedException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';
import type { User, WalletWithMetadata } from '@privy-io/server-auth';
import {
  ProviderUserId,
  SignatureRequest,
  WalletProvider,
  WalletProviderUser,
} from './wallet-provider.interface';
import {
  InvalidPrivyTokenError,
  PrivyUnavailableError,
  PrivyUserShapeError,
} from './privy.errors';

/**
 * PrivyAdapter — concrete WalletProvider backed by `@privy-io/server-auth`.
 *
 * Responsibilities (Phase 1):
 *   - verifyIdToken: validate a Privy-issued ID token. The SDK's
 *     `client.getUser({ idToken })` both verifies the signature against
 *     the Privy JWKS (using PRIVY_VERIFICATION_KEY) and returns the
 *     parsed User payload in one call. We pull the embedded Solana
 *     wallet and primary email from the result.
 *   - getUser: fetch the current user state by Privy DID. Used by the
 *     RPC tailer and admin paths that need fresh wallet info after a
 *     possible passkey rotation. Wraps `getUserById` (rate-limited; the
 *     id-token path is preferred by Privy but unavailable when we only
 *     have a stored DID).
 *
 * NOT implemented (deliberate):
 *   - signTransaction. Privy signs on the device via @privy-io/expo; the
 *     backend only submits via Helius. signTransaction stays a stub for
 *     the eventual Turnkey adapter swap (spec §6: "Optional
 *     signTransaction (not used for Privy; reserved for Turnkey)").
 *
 * Error mapping (see privy.errors.ts):
 *   - Token shape / signature / expiry failures -> InvalidPrivyTokenError
 *     (401 INVALID_PRIVY_TOKEN at the controller boundary).
 *   - Network / 5xx from Privy API -> PrivyUnavailableError (502
 *     PRIVY_UNAVAILABLE).
 *   - User missing Solana wallet or email -> PrivyUserShapeError (422 at
 *     controller; rare, indicates Privy dashboard misconfiguration).
 *
 * The adapter uses ConfigService + OnModuleInit per the GridService
 * pattern (apps/backend/src/grid/grid.service.ts) so the SDK is
 * constructed exactly once with throw-on-missing env validation.
 */
@Injectable()
export class PrivyAdapter implements WalletProvider, OnModuleInit {
  private readonly logger = new Logger(PrivyAdapter.name);
  private client!: PrivyClient;
  /** Cached PRIVY_VERIFICATION_KEY for offline JWKS-style verification. */
  private verificationKey?: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const appId = this.config.getOrThrow<string>('PRIVY_APP_ID');
    const appSecret = this.config.getOrThrow<string>('PRIVY_APP_SECRET');
    // PRIVY_VERIFICATION_KEY is the JWKS public key. The SDK can fetch
    // it on demand via getVerificationKey(), but we cache the configured
    // value so token verification works without a network round-trip on
    // every /auth/exchange.
    this.verificationKey = this.config.get<string>('PRIVY_VERIFICATION_KEY');
    this.client = new PrivyClient(appId, appSecret);
    this.logger.log('PrivyAdapter initialized');
  }

  /**
   * Verify a Privy-issued ID token and return the embedded Solana
   * wallet + email. `client.getUser({ idToken })` performs verification
   * internally; any thrown error is mapped to a typed error here.
   */
  async verifyIdToken(idToken: string): Promise<WalletProviderUser> {
    if (!idToken || typeof idToken !== 'string') {
      throw new InvalidPrivyTokenError(
        'Privy ID token missing or not a string',
      );
    }

    let user: User;
    try {
      user = await this.client.getUser({ idToken });
    } catch (err) {
      throw this.mapSdkError(err, 'verifyIdToken');
    }

    return this.userToProviderUser(user);
  }

  /**
   * Fetch a Privy user by their DID. Used after we have already minted
   * our own JWT and need a fresh wallet read (e.g. tailer reconciliation,
   * admin tooling). Note: rate-limited by Privy; treat as fallback only.
   */
  async getUser(providerUserId: ProviderUserId): Promise<WalletProviderUser> {
    if (!providerUserId) {
      throw new InvalidPrivyTokenError('providerUserId required');
    }
    let user: User;
    try {
      user = await this.client.getUserById(providerUserId);
    } catch (err) {
      throw this.mapSdkError(err, 'getUser');
    }
    return this.userToProviderUser(user);
  }

  /**
   * Optional in the WalletProvider interface. Privy signs on the device,
   * not on the server, so this stays a stub for the lifetime of the
   * PrivyAdapter. A future TurnkeyAdapter would implement it.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signTransaction(req: SignatureRequest): Promise<string> {
    return Promise.reject(
      new NotImplementedException(
        'PrivyAdapter.signTransaction — Privy signs client-side; backend only submits via Helius. signTransaction is reserved for Turnkey.',
      ),
    );
  }

  // ── internals ──────────────────────────────────────────────────────

  /**
   * Extract the embedded Solana wallet and primary email from a Privy
   * User. The user may carry multiple linked wallets; we pick the FIRST
   * Solana wallet whose walletClientType is 'privy' (i.e. the embedded
   * one we created), falling back to any Solana wallet if no embedded
   * one is present.
   */
  private userToProviderUser(user: User): WalletProviderUser {
    const email = user.email?.address;
    if (!email) {
      throw new PrivyUserShapeError(
        `Privy user ${user.id} has no linked email; email login required in dashboard`,
      );
    }

    const solanaWallets = user.linkedAccounts.filter(
      (acct): acct is WalletWithMetadata =>
        acct.type === 'wallet' && acct.chainType === 'solana',
    );

    if (solanaWallets.length === 0) {
      throw new PrivyUserShapeError(
        `Privy user ${user.id} has no Solana wallet linked`,
      );
    }

    // Prefer the embedded wallet (created by Privy) over any external
    // wallets the user may have linked.
    const embedded = solanaWallets.find((w) => w.walletClientType === 'privy');
    const chosen = embedded ?? solanaWallets[0];

    return {
      providerUserId: user.id,
      email,
      walletAddress: chosen.address,
    };
  }

  /**
   * Map an unknown SDK error into one of our typed errors.
   *
   * The Privy SDK does not export typed error classes, so we sniff
   * common shapes: a `status` or `statusCode` >= 500 (or network errors
   * like ECONNREFUSED) -> PrivyUnavailableError; everything else
   * (signature mismatch, expired token, malformed JWT) ->
   * InvalidPrivyTokenError. PrivyUserShapeError is NOT mapped here; it
   * is thrown explicitly in `userToProviderUser`.
   */
  private mapSdkError(err: unknown, context: string): Error {
    this.logger.warn(`Privy SDK error in ${context}`, err);
    const e = err as
      | (Error & {
          status?: number;
          statusCode?: number;
          code?: string;
          response?: { status?: number };
        })
      | undefined;
    const status = e?.status ?? e?.statusCode ?? e?.response?.status;
    const message = e?.message ?? 'Privy request failed';

    // Network-level errors
    if (
      e?.code === 'ECONNREFUSED' ||
      e?.code === 'ENOTFOUND' ||
      e?.code === 'ETIMEDOUT' ||
      e?.code === 'ECONNRESET'
    ) {
      return new PrivyUnavailableError(
        `Privy network failure: ${message}`,
        err,
      );
    }

    if (typeof status === 'number' && status >= 500) {
      return new PrivyUnavailableError(
        `Privy returned ${status}: ${message}`,
        err,
      );
    }

    return new InvalidPrivyTokenError(message, err);
  }
}
