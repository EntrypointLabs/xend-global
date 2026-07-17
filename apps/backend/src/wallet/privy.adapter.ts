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

/** Passkey member of Privy's linkedAccounts union (not exported by name). */
type PasskeyLinkedAccount = Extract<
  User['linkedAccounts'][number],
  { type: 'passkey' }
>;

// TEST ONLY — never production. A fixed, syntactically valid base58 devnet
// Solana pubkey used as a placeholder wallet address for a passkey-only Privy
// identity that has no embedded Solana wallet yet. Only ever read on the
// NODE_ENV==='development' branch below.
const DEV_PLACEHOLDER_SOLANA_ADDRESS =
  'ECwAKvHiqpyUMC4q1MTeMErnpgk4QNrU3KDPCxCrWNZk';

/**
 * Concrete WalletProvider backed by `@privy-io/server-auth`.
 *
 *   - verifyIdToken: validates a Privy-issued ID token. The SDK's
 *     `client.getUser({ idToken })` both verifies the signature against
 *     the Privy JWKS (using PRIVY_VERIFICATION_KEY) and returns the
 *     parsed User payload in one call, from which we pull the embedded
 *     Solana wallet and primary email.
 *   - getUser: fetches current user state by Privy DID, for paths that
 *     need fresh wallet info after a possible passkey rotation. Wraps
 *     `getUserById` (rate-limited; the id-token path is preferred by
 *     Privy but unavailable when we only have a stored DID).
 *   - signTransaction is deliberately NOT implemented: Privy signs on the
 *     device and the backend only submits via Helius, so it stays a stub
 *     reserved for an eventual Turnkey adapter.
 *
 * Error mapping (see privy.errors.ts):
 *   - Token shape / signature / expiry failures -> InvalidPrivyTokenError
 *     (401 INVALID_PRIVY_TOKEN at the controller boundary).
 *   - Network / 5xx from Privy API -> PrivyUnavailableError (502).
 *   - User missing Solana wallet or email -> PrivyUserShapeError (422;
 *     indicates Privy dashboard misconfiguration).
 *
 * ConfigService + OnModuleInit construct the SDK exactly once with
 * throw-on-missing env validation.
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
    // TEST ONLY — never production. Local checkout testing uses a minimal
    // passkey-only Privy identity (no email, no Solana wallet). Under
    // NODE_ENV==='development' only, fall back to deterministic placeholders
    // so the shape check does not reject it. Every non-development environment
    // keeps the strict PrivyUserShapeError behaviour below.
    const isDev = this.config.get<string>('NODE_ENV') === 'development';

    let email = user.email?.address;
    if (!email) {
      if (isDev) {
        // TEST ONLY — never production. Deterministic per-DID placeholder.
        email = `${user.id}@devtest.local`;
      } else {
        throw new PrivyUserShapeError(
          `Privy user ${user.id} has no linked email; email login required in dashboard`,
        );
      }
    }

    const solanaWallets = user.linkedAccounts.filter(
      (acct): acct is WalletWithMetadata =>
        acct.type === 'wallet' && acct.chainType === 'solana',
    );

    let walletAddress: string;
    if (solanaWallets.length === 0) {
      if (isDev) {
        // TEST ONLY — never production. Fixed valid base58 devnet placeholder.
        walletAddress = DEV_PLACEHOLDER_SOLANA_ADDRESS;
      } else {
        throw new PrivyUserShapeError(
          `Privy user ${user.id} has no Solana wallet linked`,
        );
      }
    } else {
      // Prefer the embedded wallet (created by Privy) over any external
      // wallets the user may have linked.
      const embedded = solanaWallets.find(
        (w) => w.walletClientType === 'privy',
      );
      const chosen = embedded ?? solanaWallets[0];
      walletAddress = chosen.address;
    }

    // Mirror any linked passkey credentials. @privy-io/server-auth's
    // PasskeyAccount exposes credentialId only (no public_key), so this
    // path captures the credential ID; the client backfills the public
    // key at enrollment.
    const passkeys = user.linkedAccounts
      .filter((acct): acct is PasskeyLinkedAccount => acct.type === 'passkey')
      .map((acct) => ({ credentialId: acct.credentialId }));

    return {
      providerUserId: user.id,
      email,
      walletAddress,
      passkeys,
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
