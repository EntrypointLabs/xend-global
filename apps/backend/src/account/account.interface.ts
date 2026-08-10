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
  /**
   * The Consumer's email, which anchors the recovery signer.
   *
   * Read here rather than taken from the JWT, which does not carry it, and
   * rather than from the request body, which would let a caller anchor S3 to
   * an inbox they own.
   */
  findUserEmail(userId: string): Promise<string | null>;
}

export const SPEND_CHAIN = Symbol('SPEND_CHAIN');

/**
 * Policy seeds, fixed per Account so both policies are derivable from the
 * settings seed alone. Changing either orphans every Account already created
 * under the old value, so they are constants rather than configuration.
 */
export const SPENDING_LIMIT_POLICY_SEED = 1n;
export const ABOVE_LIMIT_POLICY_SEED = 2n;

export interface UnsignedSpend {
  /** Base64 wire transaction, unsigned. */
  unsignedTxBase64: string;
  /** Base64 compiled message, so a caller can pin what it signed. */
  messageBase64: string;
  /** The vault the Spend leaves from. */
  vaultAddress: string;
  blockhash: string;
  lastValidBlockHeight: number;
  route: 'spending-limit' | 'two-signature';
  /** True when S2 must also sign, i.e. no spending limit admits the Spend. */
  needsApprovalSignature: boolean;
}

export interface SpendChain {
  /**
   * Spending limits currently attached to the Account.
   *
   * An empty list is a valid answer and means every Spend takes the
   * two-signature route. It must never be inferred from a failed read: a read
   * error has to throw, or a transient RPC failure would silently downgrade
   * the route decision to "no limits" and change how the Spend is authorised.
   */
  readSpendingLimits(): Promise<
    readonly import('@xend/smart-account').SpendingLimit[]
  >;

  compile(params: {
    instruction: import('@solana/web3.js').TransactionInstruction;
    feePayer: import('@solana/web3.js').PublicKey;
  }): Promise<{
    unsignedTxBase64: string;
    messageBase64: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }>;
}
