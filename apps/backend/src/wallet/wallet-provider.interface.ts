/**
 * Anti-lock-in seam for wallet creation, identity, and signing. Concrete
 * implementations (PrivyAdapter today; TurnkeyAdapter or CrossmintAdapter
 * tomorrow) live behind this interface; business logic in `wallet`,
 * `auth`, and `transfer` modules depends only on this contract, never on
 * the concrete adapter.
 */

/** Solana pubkey (base58 string). */
export type WalletAddress = string;

/** Opaque provider-side user identifier (e.g. Privy user ID). */
export type ProviderUserId = string;

/** DI token for the active WalletProvider binding. */
export const WALLET_PROVIDER = Symbol('WalletProvider');

export interface WalletProviderUser {
  providerUserId: ProviderUserId;
  email: string;
  walletAddress: WalletAddress;
}

export interface SignatureRequest {
  /** Serialized v0 transaction message, base64-encoded. */
  unsignedTxBase64: string;
  walletAddress: WalletAddress;
}

export interface WalletProvider {
  /** Verify a provider-issued ID token (e.g. Privy JWT) and return the user. */
  verifyIdToken(idToken: string): Promise<WalletProviderUser>;

  /** Read a user's current wallet (provider-side; may differ from our cache). */
  getUser(providerUserId: ProviderUserId): Promise<WalletProviderUser>;

  /**
   * Optional: server-side signing for non-passkey flows (e.g. system-initiated
   * batch transactions). Not used in v1; declared so adapters that support it
   * (Turnkey) can fulfil it later.
   */
  signTransaction?(req: SignatureRequest): Promise<string>;
}
