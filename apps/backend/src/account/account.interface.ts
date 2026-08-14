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

  /**
   * Serialises enrolment for one Consumer.
   *
   * Enrolment reads "does an Account exist", then spends twenty seconds
   * creating a Turnkey sub-organization and an on-chain account before writing
   * anything back. Two requests overlapping in that gap both see no Account and
   * both build one, and only the first can be stored: the second leaves a live
   * sub-organization stranded and fails on the unique user id.
   *
   * Nothing cheaper closes it. The device mints a fresh hardware key for every
   * attestation, so the duplicate attempt looks like a different device to
   * every key-based check.
   */
  withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T>;
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

export const PROVISIONING_CHAIN = Symbol('PROVISIONING_CHAIN');

/**
 * The three settings changes that make a new Account usable, in the only order
 * that works.
 *
 * Both policies have to exist before the time lock goes on. A settings change
 * waits out the lock in force when it executes, so an Account locked first
 * cannot add a policy for a day, and every Spend runs under a policy. Raising
 * the lock last is not self-blocking for the same reason: the lock in force
 * while that change executes is still the old zero.
 */
export type ProvisioningChange = 'spending-limit' | 'above-limit' | 'time-lock';

/**
 * A settings change is four transactions: propose it, collect an approval from
 * each of the two signers, then execute. The threshold is 2 of 3 and S3 is
 * deliberately not in the spend path, so the two approvals are S1 and S2.
 */
export type ProvisioningStep =
  | 'propose'
  | 'approve-primary'
  | 'approve-approval'
  | 'execute';

export interface SettingsState {
  timeLockSeconds: number;
  /** The last index the program assigned. The next change takes this plus one. */
  transactionIndex: bigint;
}

export interface ProposalState {
  /** Base58 addresses that have approved so far. */
  approved: string[];
  /** Executed, rejected or cancelled: nothing more to do with this index. */
  settled: boolean;
}

export interface ProvisioningChain {
  readSettings(settingsAddress: string): Promise<SettingsState>;
  policyExists(settingsAddress: string, policySeed: bigint): Promise<boolean>;
  /** Null when no proposal was ever created at that index. */
  readProposal(
    settingsAddress: string,
    transactionIndex: bigint,
  ): Promise<ProposalState | null>;
  compile(params: {
    instructions: import('@solana/web3.js').TransactionInstruction[];
    feePayer: import('@solana/web3.js').PublicKey;
  }): Promise<{
    unsignedTxBase64: string;
    messageBase64: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }>;

  /**
   * Submits a signed step and waits for confirmation.
   *
   * Confirmation is not optional here. The next step is derived by reading the
   * chain, so returning before the effect is visible would hand the device the
   * step it just completed and it would loop.
   */
  submit(signedTxBase64: string): Promise<string>;
}

export interface ProvisioningPlan {
  /** Both policies exist and the time lock is on. Nothing left to sign. */
  done: boolean;
  change?: ProvisioningChange;
  step?: ProvisioningStep;
  unsignedTxBase64?: string;
  messageBase64?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  /**
   * True only on the step S2 approves. S1 pays the fee on every step, so that
   * transaction carries both signatures; the rest carry one.
   */
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
