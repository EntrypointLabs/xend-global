/**
 * Seams for creating a Consumer's Squads smart account (ADR 0025).
 *
 * The chain work sits behind `AccountChain` for two reasons. It keeps
 * `@solana/web3.js` and `@xend/smart-account` out of the service, per ADR 0020's
 * rule that the two Solana toolchains trade bytes rather than objects, and it
 * makes the ordering rules in `AccountService` testable without a validator.
 */

export const ACCOUNT_CHAIN = Symbol('ACCOUNT_CHAIN');
export const SQUADS_ACCOUNT_STORE = Symbol('SQUADS_ACCOUNT_STORE');

export interface SignerAddresses {
  /** S1, the Privy embedded wallet. */
  primary: string;
  /** S2, the Turnkey sub-organization. */
  approval: string;
  /** S3, the server-held recovery signer. */
  recovery: string;
}

export interface CreatedAccount {
  /** Assigned by the program's global counter. Persist it; it is not derivable. */
  settingsSeed: bigint;
  settingsAddress: string;
  vaultAddress: string;
  signature: string;
}

export interface AccountChain {
  /**
   * Builds, pays for and submits the creation transaction.
   *
   * Throws {@link SeedTakenError} when another creator claimed the seed between
   * the config read and the send, which is expected under concurrency and is a
   * retry rather than a failure.
   */
  createAccount(signers: SignerAddresses): Promise<CreatedAccount>;
}

export interface SquadsAccountRow {
  userId: string;
  settingsSeed: bigint;
  settingsAddress: string;
  vaultAddress: string;
  primarySigner: string;
  approvalSigner: string;
  approvalSubOrgId: string;
}

export interface SquadsAccountStore {
  findByUserId(userId: string): Promise<SquadsAccountRow | null>;
  insert(row: SquadsAccountRow): Promise<SquadsAccountRow>;
}
