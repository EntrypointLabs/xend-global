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
  /** Set only while a device rotation is in flight. See DeviceRotationService. */
  pendingApprovalSigner?: string | null;
  pendingApprovalSubOrgId?: string | null;
  pendingApprovalChangeIndex?: string | null;
  /** Set only while a passkey replacement is in flight. See PrimaryRotationService. */
  pendingPrimarySigner?: string | null;
  pendingPrimaryProviderId?: string | null;
  pendingPrimaryChangeIndex?: string | null;
  /**
   * The seed of the policy holding this Account's Spending Limit, when it is
   * not the one provisioning wrote. Read through {@link spendingLimitSeed}.
   */
  spendingLimitPolicySeed?: bigint | null;
}

export interface SquadsAccountStore {
  findByUserId(userId: string): Promise<SquadsAccountRow | null>;
  /** Every Account, for the sweeps that have to check all of them. */
  listAll(): Promise<SquadsAccountRow[]>;
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
   * Patches an existing Account. Used by device rotation to stage, commit and
   * clear the approval signer it is swapping in.
   */
  updateByUserId(
    userId: string,
    patch: Partial<Omit<SquadsAccountRow, 'userId'>>,
  ): Promise<SquadsAccountRow>;

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

/**
 * Where this Account's Spending Limit actually lives.
 *
 * The program assigns policy seeds in order from a counter on the Settings and
 * never gives one back, so a limit removed and set again lands past the seed
 * provisioning wrote. Every Account that has not done that carries no seed of
 * its own and resolves to the original, which is what keeps the constant
 * meaningful for every Account created so far.
 */
export function spendingLimitSeed(account: {
  spendingLimitPolicySeed?: bigint | null;
}): bigint {
  return account.spendingLimitPolicySeed ?? SPENDING_LIMIT_POLICY_SEED;
}

export interface UnsignedSpend {
  /** Base64 wire transaction, unsigned. */
  unsignedTxBase64: string;
  /** Base64 compiled message, so a caller can pin what it signed. */
  messageBase64: string;
  /** The vault the Spend leaves from. */
  vaultAddress: string;
  /**
   * S1, the signer this Spend is compiled for.
   *
   * Named rather than left implicit because the signing surface has to pick a
   * key deliberately. A Consumer may have more than one wallet connected, and
   * signing with the wrong one produces a transaction the program refuses.
   */
  primarySigner: string;
  blockhash: string;
  lastValidBlockHeight: number;
  route: 'spending-limit' | 'two-signature';
  /** True when S2 must also sign, i.e. no spending limit admits the Spend. */
  needsApprovalSignature: boolean;
}

export const PROVISIONING_CHAIN = Symbol('PROVISIONING_CHAIN');

/**
 * The one settings change that makes a new Account usable: both policies and
 * the time lock, in that order, carried as a single change.
 *
 * A single member rather than a bare flag because the wire shape has to survive
 * a second change appearing, and because a step reads better labelled than
 * anonymous.
 *
 * Ordering inside the change is not incidental. Both policies have to be
 * created before the lock goes on, and they are: a change is checked against
 * the lock the Settings carries when it executes, which provisioning leaves at
 * zero until this change lands. Locking first would leave an Account unable to
 * add a policy for a day, and every Spend runs under a policy.
 */
export type ProvisioningChange = 'provision';

/**
 * A settings change is four transactions: propose it, collect an approval from
 * each of the two signers, then execute. The threshold is 2 of 3 and S3 is
 * deliberately not in the spend path, so the two approvals are S1 and S2.
 */
export type ProvisioningStep =
  /**
   * The whole change in one transaction: propose, both approvals, execute.
   * Legal only while the Settings time lock is still zero, which is exactly
   * the state provisioning runs in, since this change is what sets it.
   */
  'provision' | 'propose' | 'approve-primary' | 'approve-approval' | 'execute';

export interface SettingsState {
  timeLockSeconds: number;
  /** The last index the program assigned. The next change takes this plus one. */
  transactionIndex: bigint;
  /**
   * The last policy seed the program assigned, or null before it has assigned
   * any. A policy created on this Account has to take this plus one.
   */
  policySeed: bigint | null;
  /**
   * The signer set as the chain holds it, with the permissions each key was
   * granted. Read on every settings change: an executed proposal at an index
   * only proves that some change landed there, and which keys the Account
   * now names is what says whether it was the one a rotation staged.
   */
  signers: import('@xend/smart-account').SettingsSigner[];
}

export interface ProposalState {
  /** Base58 addresses that have approved so far. */
  approved: string[];
  /** Base58 addresses that have rejected. A signer here cannot vote again. */
  rejected: string[];
  /** Executed, rejected or cancelled: nothing more to do with this index. */
  settled: boolean;
  /** The program's own name for where this proposal stands. */
  status: string;
  /**
   * Unix seconds at which it entered that status, or null where the program
   * records none. Approval is what the Settings time lock runs from, so this is
   * how long a Consumer has left to reject a change they did not make.
   */
  statusTimestamp: bigint | null;
}

export interface ProvisioningChain {
  /**
   * Who funds rent for the accounts a settings change creates, base58.
   *
   * Exposed because the instruction builders need it by value, and it is not
   * the proposer: a Consumer has no lamports when provisioning runs, so
   * defaulting rent to them fails inside the program on a System transfer.
   */
  readonly rentPayer: string;

  readSettings(settingsAddress: string): Promise<SettingsState>;
  /**
   * The spending limit as the chain holds it. A change that restates the
   * limit reads it from here, so a limit the Consumer has since changed is
   * carried forward rather than reset to what provisioning wrote.
   */
  readSpendingLimit(
    settingsAddress: string,
    policySeed: bigint,
  ): Promise<import('@xend/smart-account').SpendingLimit>;
  policyExists(settingsAddress: string, policySeed: bigint): Promise<boolean>;
  /** Null when no proposal was ever created at that index. */
  readProposal(
    settingsAddress: string,
    transactionIndex: bigint,
  ): Promise<ProposalState | null>;
  /**
   * Compiles a step with the settlement authority as fee payer.
   *
   * The Consumer cannot pay. Provisioning runs immediately after enrolment,
   * before they have funded anything, so S1 holds no lamports at exactly the
   * moment these four transactions go out: a transaction paid from it dies
   * before it reaches the program, with no logs. The authority already pays to
   * create the Account and is the only funded key in the flow.
   *
   * Paying is not signing: the authority is fee payer only, never a signer on
   * the settings change, so the 2-of-3 still comes from the device.
   */
  compile(params: {
    instructions: import('@solana/web3.js').TransactionInstruction[];
  }): Promise<{
    unsignedTxBase64: string;
    messageBase64: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }>;

  /**
   * Adds the authority's fee-payer signature to a step the device signed,
   * submits it, and waits for confirmation.
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
   * Spending limits attached to this Account, read from chain.
   *
   * Takes the Account because the limit is a policy account derived from its
   * settings address; there is no global list.
   *
   * An empty list is a valid answer and means every Spend takes the
   * two-signature route. It must never be inferred from a failed read: a read
   * error has to throw, or a transient RPC failure would silently downgrade
   * the route decision to "no limits" and change how the Spend is authorised.
   */
  readSpendingLimits(
    settingsAddress: string,
    policySeed: bigint,
  ): Promise<readonly import('@xend/smart-account').SpendingLimit[]>;

  /**
   * The token program that owns a mint.
   *
   * Read rather than assumed: the spending limit policy checks the token
   * accounts against the mint's own program, and a Token-2022 mint handed the
   * classic program's id is refused. Native SOL has no token program and is
   * not asked about.
   */
  tokenProgramFor(mint: string): Promise<import('@solana/web3.js').PublicKey>;

  /**
   * Compiles a Spend with the settlement authority as fee payer.
   *
   * Not the Consumer. The money lives in the vault, and a Consumer who has
   * only ever been paid in USDC holds no SOL at all, so charging the fee to S1
   * fails before the transaction reaches the program. Same reason provisioning
   * pays from the authority.
   *
   * Paying is not signing: the authority is fee payer only and is not a signer
   * on the Spend, so authorisation still comes from the Account's own signers.
   */
  /**
   * The instruction that creates the destination's token account, or null when
   * it already exists.
   *
   * A Consumer sending USDC to someone who has never held USDC has to open
   * that account first, or the policy refuses the Spend with
   * AccountNotInitialized. Rent is charged to the fee payer for the same
   * reason fees are: the recipient is a stranger and the sender may hold no
   * SOL at all.
   */
  createDestinationTokenAccount(params: {
    mint: string;
    destination: string;
    tokenProgram: import('@solana/web3.js').PublicKey;
  }): Promise<import('@solana/web3.js').TransactionInstruction | null>;

  compile(params: {
    instructions: import('@solana/web3.js').TransactionInstruction[];
  }): Promise<{
    unsignedTxBase64: string;
    messageBase64: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }>;

  /**
   * Whether the program would accept this Spend, asked by simulating it.
   *
   * Exists because `remainingInPeriod` is a stored counter, not a live one. The
   * program refills it as a side effect of a Spend executing under the spending
   * limit, so a Consumer who exhausts the limit reads zero forever: every later
   * Spend routes two-signature, two-signature executes under the above-limit
   * policy, and that never touches the counter that would have been refilled.
   *
   * Recomputing the rollover here would mean reimplementing the program's
   * period arithmetic from the outside, and guessing generously routes a Spend
   * one-signature that the program then rejects, which the Consumer sees as a
   * failed send. Simulating asks the program itself, which runs its own reset
   * on the way through.
   *
   * False on any failure, including an unreachable RPC. Two signatures is the
   * floor, so an unanswered question has to degrade towards more signatures.
   */
  wouldSucceed(
    instruction: import('@solana/web3.js').TransactionInstruction,
  ): Promise<boolean>;

  /** Who pays, base58. Surfaced so the Spend can be built against it. */
  readonly feePayer: string;
}
