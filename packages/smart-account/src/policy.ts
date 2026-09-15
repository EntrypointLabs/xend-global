import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { instructions, types } from "@sqds/smart-account";
import type { generated } from "@sqds/smart-account";

import { ROLE_PERMISSIONS } from "./account.js";
import { derivePolicyAddress } from "./pda.js";
import { ABOVE_LIMIT_PROGRAM_ALLOWLIST } from "./programs.js";
import type { SpendingLimit } from "./spend.js";
import type { SettingsSigner } from "./state.js";
import type { AccountAddresses, SignerRole } from "./types.js";

const { Permission, Permissions } = types;
const PRIMARY_ACCOUNT_INDEX = 0;
/** The program's own ceiling on instruction constraints per policy. */
const MAX_INSTRUCTION_CONSTRAINTS = 20;

/**
 * A settings change this package will not build, because the program would
 * accept it and the Account would be worse off for it.
 */
export class SettingsChangeRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsChangeRefusedError";
  }
}

export type LimitPeriod = "OneTime" | "Daily" | "Weekly" | "Monthly";

export interface SpendingLimitTerms {
  mint: PublicKey;
  /** Largest single Spend, in the mint's smallest units. */
  maxPerUse: bigint;
  /** Cap across the period, in the mint's smallest units. */
  maxPerPeriod: bigint;
  period: LimitPeriod;
  /** Empty allows any destination. */
  destinations?: PublicKey[];
}

export interface CreateSpendingLimitPolicyParams {
  addresses: AccountAddresses;
  /** Distinguishes this policy from others on the Account. */
  policySeed: bigint;
  terms: SpendingLimitTerms;
  /** The signer that may draw on the limit. The primary signer in our model. */
  limitSigner: PublicKey;
  /** Proposes the change. Must be a signer with `Initiate`. */
  proposer: PublicKey;
  /**
   * Funds the rent for the transaction and proposal accounts this creates.
   * Defaults to `proposer`.
   *
   * Provisioning runs before a Consumer has funded anything, so the proposer
   * has no lamports to pay rent with and the whole settings change dies inside
   * the program on a System transfer. Naming a funded payer here is the only
   * way to separate who authorises the change from who pays for the accounts
   * it needs.
   */
  rentPayer?: PublicKey;

  /** The Settings account's current `transactionIndex`, plus one. */
  transactionIndex: bigint;
}

export interface CreateSpendingLimitPolicyResult {
  policy: PublicKey;
  /** Propose the policy. Signed by `proposer` alone. */
  propose: TransactionInstruction[];
}

/**
 * Proposes a spending-limit policy.
 *
 * Creating one is a **settings change**, so it runs through the Account's own
 * threshold: propose, collect approvals from two signers, then execute. That is
 * deliberate. A policy that carves out a single-signature spend path must not itself
 * be creatable by a single signature.
 *
 * The policy's own `timeLock` is 0 so Spends under it execute synchronously.
 * Synchronous execution rejects a non-zero time lock on whichever consensus account
 * it is given, and the Settings keeps its time lock for settings changes.
 */
export function buildCreateSpendingLimitPolicy({
  addresses,
  policySeed,
  terms,
  limitSigner,
  proposer,
  rentPayer,
  transactionIndex,
}: CreateSpendingLimitPolicyParams): CreateSpendingLimitPolicyResult {
  return {
    policy: derivePolicyAddress(addresses.settings, policySeed),
    propose: proposeSettingsChange({
      addresses,
      transactionIndex,
      proposer,
      rentPayer,
      actions: [spendingLimitPolicyAction({ policySeed, terms, limitSigner })],
    }),
  };
}

/** One signer's approval of a pending settings change. */
export function buildApproveSettingsChange({
  addresses,
  transactionIndex,
  signer,
}: {
  addresses: AccountAddresses;
  transactionIndex: bigint;
  signer: PublicKey;
}): TransactionInstruction {
  return instructions.approveProposal({
    settingsPda: addresses.settings,
    transactionIndex,
    signer,
  });
}

/**
 * Executes an approved settings change.
 *
 * Fails until the Settings time lock has elapsed since approval, which is the point
 * of the time lock: it gives a Consumer a window to notice and reject a change they
 * did not make.
 */
export function buildExecuteSettingsChange({
  addresses,
  transactionIndex,
  signer,
  rentPayer,
  policies = [],
}: {
  addresses: AccountAddresses;
  transactionIndex: bigint;
  signer: PublicKey;
  /**
   * Funds the accounts the change creates. Defaults to `signer`.
   *
   * Executing is where a `PolicyCreate` actually allocates, so this is charged
   * the rent for every policy in `policies` at once. The signer executing a
   * change is not necessarily anyone with lamports: a Consumer finishing
   * onboarding has none at all, and the whole change dies here on a System
   * transfer after all its approvals have already been collected.
   */
  rentPayer?: PublicKey;
  /**
   * Policy addresses the change creates, which need rent. They ride along as
   * remaining accounts and are consumed in order, so a change carrying several
   * `PolicyCreate` actions must list them in the order it declared them.
   */
  policies?: PublicKey[];
}): TransactionInstruction {
  return instructions.executeSettingsTransaction({
    settingsPda: addresses.settings,
    transactionIndex,
    signer,
    rentPayer: rentPayer ?? signer,
    policies,
  });
}

/** Rejects a pending settings change. The defence against a stolen quorum. */
export function buildRejectSettingsChange({
  addresses,
  transactionIndex,
  signer,
}: {
  addresses: AccountAddresses;
  transactionIndex: bigint;
  signer: PublicKey;
}): TransactionInstruction {
  return instructions.rejectProposal({
    settingsPda: addresses.settings,
    transactionIndex,
    signer,
  });
}

export interface CreateAboveLimitPolicyParams {
  addresses: AccountAddresses;
  policySeed: bigint;
  /** Both signers required for a Spend the limit does not admit. */
  primary: PublicKey;
  approval: PublicKey;
  proposer: PublicKey;
  /**
   * Funds the rent for the transaction and proposal accounts this creates.
   * Defaults to `proposer`. See {@link CreateSpendingLimitPolicyParams}.
   */
  rentPayer?: PublicKey;
  transactionIndex: bigint;
  /**
   * The programs a Spend under this policy may call. Defaults to
   * {@link ABOVE_LIMIT_PROGRAM_ALLOWLIST}. Order matters: see there.
   */
  allowedPrograms?: readonly PublicKey[];
}

/**
 * Proposes the policy that governs Spends above the spending limit.
 *
 * This exists because a Spend cannot run against the Settings: synchronous execution
 * rejects a non-zero time lock on its consensus account, and the Settings carries one
 * for settings changes. So the above-limit path needs a consensus account of its own
 * with a zero time lock. It also keeps the recovery signer out of the spend path,
 * which permissions alone do not do.
 *
 * The policy carries one instruction constraint per allowed program and
 * nothing finer. An empty constraint list would mean no checking at all, so
 * the threshold of 2 would be the only thing between a compromised pair and
 * any program on the cluster. Account and data constraints (destination
 * allowlists, merchant rules) are a later policy update, not a rewrite.
 */
export function buildCreateAboveLimitPolicy({
  addresses,
  policySeed,
  primary,
  approval,
  proposer,
  rentPayer,
  transactionIndex,
  allowedPrograms = ABOVE_LIMIT_PROGRAM_ALLOWLIST,
}: CreateAboveLimitPolicyParams): CreateSpendingLimitPolicyResult {
  return {
    policy: derivePolicyAddress(addresses.settings, policySeed),
    propose: proposeSettingsChange({
      addresses,
      transactionIndex,
      proposer,
      rentPayer,
      actions: [
        aboveLimitPolicyAction({
          policySeed,
          primary,
          approval,
          allowedPrograms,
        }),
      ],
    }),
  };
}

export interface SetTimeLockParams {
  addresses: AccountAddresses;
  /** Seconds. `SETTINGS_TIME_LOCK_SECONDS` is the value D3 settled on. */
  seconds: number;
  /** Proposes the change. Must be a signer with `Initiate`. */
  proposer: PublicKey;
  /**
   * Funds the rent for the transaction and proposal accounts this creates.
   * Defaults to `proposer`.
   *
   * Provisioning runs before a Consumer has funded anything, so the proposer
   * has no lamports to pay rent with and the whole settings change dies inside
   * the program on a System transfer. Naming a funded payer here is the only
   * way to separate who authorises the change from who pays for the accounts
   * it needs.
   */
  rentPayer?: PublicKey;

  /** The Settings account's current `transactionIndex`, plus one. */
  transactionIndex: bigint;
}

/**
 * Raises (or lowers) the Settings time lock.
 *
 * This exists because of an ordering problem. Policies are created by a
 * settings change, and a settings change waits out the current time lock, so an
 * Account created with D3's 24-hour lock has no policies for 24 hours. Every
 * Spend executes under a policy, so that Account cannot move money at all for
 * its first day.
 *
 * Provisioning therefore runs at a zero time lock and calls this last: create
 * the Account open, add both policies while changes apply immediately, then
 * close it. The lock in force when the change executes is the old one, which is
 * what makes the final step immediate rather than self-blocking.
 */
export function buildSetTimeLock({
  addresses,
  seconds,
  proposer,
  rentPayer,
  transactionIndex,
}: SetTimeLockParams): TransactionInstruction[] {
  return proposeSettingsChange({
    addresses,
    transactionIndex,
    proposer,
    rentPayer,
    actions: [setTimeLockAction(seconds)],
  });
}

export interface AddRecoverySignerParams {
  addresses: AccountAddresses;
  /** The recovery signer joining the Settings signer set. */
  newSigner: PublicKey;
  /** Proposes the change. Must be a signer with `Initiate`, so S1. */
  proposer: PublicKey;
  /**
   * Funds the rent. Defaults to `proposer`. See {@link SetTimeLockParams}.
   *
   * Adding a signer reallocates the Settings account by 33 bytes, and the
   * difference is charged here on top of the transaction and proposal accounts.
   * Measured against the deployed program: 229_680 lamports per added signer.
   */
  rentPayer?: PublicKey;
  /** The Settings account's current `transactionIndex`, plus one. */
  transactionIndex: bigint;
}

/**
 * Adds a recovery signer to the Settings signer set.
 *
 * Only the Settings. Spends run under policies that carry their own inline
 * signer sets, and recovery is deliberately absent from both of them (D5b), so
 * this reaches no spend path and needs no matching `PolicyUpdate`.
 *
 * The program validates nothing until execute, which is after both approvals
 * and the full time lock. A key already in the set fails there with
 * `DuplicateSigner`, having consumed a `transactionIndex` and burned the wait.
 * Check the current signer set before proposing rather than after.
 */
export function buildAddRecoverySigner({
  addresses,
  newSigner,
  proposer,
  rentPayer,
  transactionIndex,
}: AddRecoverySignerParams): TransactionInstruction[] {
  return proposeSettingsChange({
    addresses,
    transactionIndex,
    proposer,
    rentPayer,
    actions: [addSignerAction(newSigner, "recovery")],
  });
}

export interface RemoveRecoverySignerParams {
  addresses: AccountAddresses;
  /** The recovery signer leaving the Settings signer set. */
  oldSigner: PublicKey;
  /** Every recovery signer the Account currently has, `oldSigner` included. */
  recoverySigners: readonly PublicKey[];
  /** Proposes the change. Must be a signer with `Initiate`, so S1. */
  proposer: PublicKey;
  /** Funds the rent. Defaults to `proposer`. Removal reallocates down and refunds nothing. */
  rentPayer?: PublicKey;
  /** The Settings account's current `transactionIndex`, plus one. */
  transactionIndex: bigint;
}

/**
 * Removes a recovery signer from the Settings signer set.
 *
 * The program refuses a removal that would leave fewer vote-holding signers
 * than the threshold, with `InvalidThreshold` at execute time. That is a weaker
 * guard than it sounds: an Account with S1, S2 and one recovery signer still
 * has two signers left without it, so the program is happy to strip the last
 * recovery signer and leave a lost phone unrecoverable. So the rule that an
 * Account always keeps one is applied here, against the recovery signers the
 * caller has read off the Account. Replacing the only one is
 * {@link buildRotateRecoverySigner}, which never passes through zero.
 */
export function buildRemoveRecoverySigner({
  addresses,
  oldSigner,
  recoverySigners,
  proposer,
  rentPayer,
  transactionIndex,
}: RemoveRecoverySignerParams): TransactionInstruction[] {
  if (!recoverySigners.some((signer) => signer.equals(oldSigner))) {
    throw new SettingsChangeRefusedError(
      `${oldSigner.toBase58()} is not one of the Account's recovery signers`,
    );
  }
  if (recoverySigners.length === 1) {
    throw new SettingsChangeRefusedError(
      `${oldSigner.toBase58()} is the Account's only recovery signer; rotate it rather than remove it`,
    );
  }

  return proposeSettingsChange({
    addresses,
    transactionIndex,
    proposer,
    rentPayer,
    actions: [removeSignerAction(oldSigner)],
  });
}

export interface RotateRecoverySignerParams {
  addresses: AccountAddresses;
  /** The recovery signer being retired. Its inbox may be exactly what was compromised. */
  oldSigner: PublicKey;
  /** The fresh recovery signer, sealed against the address that replaces it. */
  newSigner: PublicKey;
  /** Proposes the change. Must be a signer with `Initiate`, so S1. */
  proposer: PublicKey;
  /** Funds the rent. Defaults to `proposer`. */
  rentPayer?: PublicKey;
  /** The Settings account's current `transactionIndex`, plus one. */
  transactionIndex: bigint;
}

/**
 * Swaps one recovery signer for another in a single change.
 *
 * One change rather than an add followed by a remove, because each change
 * waits out the full time lock and needs both on-device approvals, and a
 * Consumer changing their address would otherwise spend two days and four
 * fingerprints on one act. It also never passes through a state with one
 * recovery signer fewer than it started with, which is what keeps the
 * at-least-one rule intact for an Account whose only recovery signer is the
 * one being rotated.
 *
 * No policy is rewritten. Recovery signers sit on the Settings alone and are
 * deliberately absent from both spend policies, so unlike an approval signer
 * rotation there is no inline signer set to keep in step. The LiteSVM suite
 * pins that both policies come through a rotation unchanged.
 *
 * The new key is added before the old one is removed, for the same reason the
 * approval rotation orders it that way: the vote-holding count never dips.
 */
export function buildRotateRecoverySigner({
  addresses,
  oldSigner,
  newSigner,
  proposer,
  rentPayer,
  transactionIndex,
}: RotateRecoverySignerParams): TransactionInstruction[] {
  if (oldSigner.equals(newSigner)) {
    throw new Error("the new recovery signer must differ from the old one");
  }

  return proposeSettingsChange({
    addresses,
    transactionIndex,
    proposer,
    rentPayer,
    actions: [
      addSignerAction(newSigner, "recovery"),
      removeSignerAction(oldSigner),
    ],
  });
}

export interface RotateApprovalSignerParams {
  addresses: AccountAddresses;
  /** The approval signer being retired, whose sub-organization went with the phone. */
  oldApproval: PublicKey;
  /** The new phone's approval signer. */
  newApproval: PublicKey;
  /** Stays in the above-limit policy's signer set beside the new approval signer. */
  primary: PublicKey;
  /** Identifies the above-limit policy whose signer set names the old approval signer. */
  aboveLimitSeed: bigint;
  /** Proposes the change. Must be a signer with `Initiate`, so S1. */
  proposer: PublicKey;
  /** Funds the rent. Defaults to `proposer`. */
  rentPayer?: PublicKey;
  /** The Settings account's current `transactionIndex`, plus one. */
  transactionIndex: bigint;
  /**
   * The allowlist the above-limit policy was created with, restated because
   * `PolicyUpdate` replaces the whole policy. Defaults to
   * {@link ABOVE_LIMIT_PROGRAM_ALLOWLIST}.
   */
  allowedPrograms?: readonly PublicKey[];
}

export interface RotateApprovalSignerResult {
  /** The policy the change rewrites, which {@link buildExecuteSettingsChange} has to carry. */
  policies: PublicKey[];
  /** Propose the change. Signed by `proposer` alone. */
  propose: TransactionInstruction[];
}

/**
 * Moves the approval signer to a new phone: out of the Settings signer set,
 * out of the above-limit policy, and the new key into both.
 *
 * The policy half is the part that is easy to miss and expensive to get wrong.
 * A policy carries its **own inline signer set**, copied at creation and never
 * consulted against the Settings afterwards, so a rotation that only touches
 * the Settings leaves the above-limit policy still naming a key whose
 * sub-organization no longer exists. The Account looks recovered, one-signature
 * Spends work because that policy names the primary signer, and every Spend
 * over the limit is unsignable forever. Both halves belong in one change.
 *
 * The new key is added before the old one is removed. Either order satisfies
 * the threshold here, but adding first never dips the vote-holding count, which
 * keeps it correct for an Account that has since lost a recovery signer.
 *
 * The spending-limit policy is deliberately untouched: its signer is the
 * primary, and the approval signer was never on the one-signature path.
 */
export function buildRotateApprovalSigner({
  addresses,
  oldApproval,
  newApproval,
  primary,
  aboveLimitSeed,
  proposer,
  rentPayer,
  transactionIndex,
  allowedPrograms = ABOVE_LIMIT_PROGRAM_ALLOWLIST,
}: RotateApprovalSignerParams): RotateApprovalSignerResult {
  if (oldApproval.equals(newApproval)) {
    throw new Error("the new approval signer must differ from the old one");
  }

  const policy = derivePolicyAddress(addresses.settings, aboveLimitSeed);

  return {
    policies: [policy],
    propose: proposeSettingsChange({
      addresses,
      transactionIndex,
      proposer,
      rentPayer,
      actions: [
        addSignerAction(newApproval, "approval"),
        removeSignerAction(oldApproval),
        aboveLimitPolicyUpdateAction({
          policy,
          primary,
          approval: newApproval,
          allowedPrograms,
        }),
      ],
    }),
  };
}

export interface RotatePrimarySignerParams {
  addresses: AccountAddresses;
  /** The primary signer being retired, whose passkey is gone. */
  oldPrimary: PublicKey;
  /** The fresh embedded wallet behind the passkey just created. */
  newPrimary: PublicKey;
  /** Stays in the above-limit policy's signer set beside the new primary. */
  approval: PublicKey;
  /**
   * The Settings signer set as it stands, from {@link fetchSettings}. The
   * approval signer has to hold `Initiate` there to propose this at all.
   */
  signers: readonly SettingsSigner[];
  /** Identifies the spending-limit policy, whose only signer is the primary. */
  spendingLimitSeed: bigint;
  /**
   * The spending limit as the chain holds it, from {@link fetchSpendingLimit}.
   *
   * `PolicyUpdate` replaces the whole policy, so the limit is restated from
   * this. Taking the decoded policy rather than bare terms is what stops a
   * rotation from quietly resetting a limit the Consumer has since changed:
   * the address it carries has to be the policy this rotation rewrites.
   */
  currentLimit: SpendingLimit;
  /** Identifies the above-limit policy naming primary and approval. */
  aboveLimitSeed: bigint;
  /** Proposes the change. Must hold `Initiate`, which is the approval signer. */
  proposer: PublicKey;
  /** Funds the rent. Defaults to `proposer`. */
  rentPayer?: PublicKey;
  /** The Settings account's current `transactionIndex`, plus one. */
  transactionIndex: bigint;
  /**
   * The allowlist the above-limit policy was created with, restated because
   * `PolicyUpdate` replaces the whole policy. Defaults to
   * {@link ABOVE_LIMIT_PROGRAM_ALLOWLIST}.
   */
  allowedPrograms?: readonly PublicKey[];
}

export interface RotatePrimarySignerResult {
  /** Both policies the change rewrites, in action order, for execute. */
  policies: PublicKey[];
  /** Propose the change. Signed by `proposer` alone. */
  propose: TransactionInstruction[];
}

/**
 * Moves the primary signer to a fresh passkey after the old one is gone: out
 * of the Settings signer set and out of BOTH policies, the new key into all
 * three, in one change.
 *
 * The primary sits on both spend paths, which is what makes this the rotation
 * where a missed policy is worst. The spending-limit policy names the primary
 * alone, so leaving it behind makes every one-signature Spend unsignable; the
 * above-limit policy names primary and approval, so leaving that one strands
 * everything above the limit. Both are rewritten beside the signer swap.
 *
 * The pair meeting the threshold is the approval signer on the phone and the
 * recovery signer in the vault, which is why the proposer here is the approval
 * signer: it is the only remaining holder of `Initiate`. An account whose
 * approval signer predates that grant cannot run this at all.
 */
export function buildRotatePrimarySigner({
  addresses,
  oldPrimary,
  newPrimary,
  approval,
  signers,
  spendingLimitSeed,
  currentLimit,
  aboveLimitSeed,
  proposer,
  rentPayer,
  transactionIndex,
  allowedPrograms = ABOVE_LIMIT_PROGRAM_ALLOWLIST,
}: RotatePrimarySignerParams): RotatePrimarySignerResult {
  if (oldPrimary.equals(newPrimary)) {
    throw new Error("the new primary signer must differ from the old one");
  }
  if (spendingLimitSeed === aboveLimitSeed) {
    throw new Error("the two policies must take distinct seeds");
  }

  const approvalSigner = signers.find((s) => s.key.equals(approval));
  if (!approvalSigner) {
    throw new SettingsChangeRefusedError(
      `approval signer ${approval.toBase58()} is not on the Settings signer set`,
    );
  }
  if (!Permissions.has(approvalSigner.permissions, Permission.Initiate)) {
    throw new SettingsChangeRefusedError(
      `approval signer ${approval.toBase58()} does not hold Initiate, so it cannot propose the rotation; the primary signer cannot be replaced until it is granted`,
    );
  }

  const spendingLimitPolicy = derivePolicyAddress(
    addresses.settings,
    spendingLimitSeed,
  );
  if (!currentLimit.policy.equals(spendingLimitPolicy)) {
    throw new SettingsChangeRefusedError(
      `the spending limit given is for policy ${currentLimit.policy.toBase58()}, not the one at seed ${spendingLimitSeed} (${spendingLimitPolicy.toBase58()})`,
    );
  }
  const aboveLimitPolicy = derivePolicyAddress(
    addresses.settings,
    aboveLimitSeed,
  );

  return {
    policies: [spendingLimitPolicy, aboveLimitPolicy],
    propose: proposeSettingsChange({
      addresses,
      transactionIndex,
      proposer,
      rentPayer,
      actions: [
        addSignerAction(newPrimary, "primary"),
        removeSignerAction(oldPrimary),
        spendingLimitPolicyUpdateAction({
          policy: spendingLimitPolicy,
          terms: termsOf(currentLimit),
          limitSigner: newPrimary,
        }),
        aboveLimitPolicyUpdateAction({
          policy: aboveLimitPolicy,
          primary: newPrimary,
          approval,
          allowedPrograms,
        }),
      ],
    }),
  };
}

export interface UpdateSpendingLimitParams {
  addresses: AccountAddresses;
  /** Identifies the spending-limit policy whose terms this replaces. */
  spendingLimitSeed: bigint;
  /**
   * The limit as the chain holds it, from {@link fetchSpendingLimit}.
   *
   * Read rather than assumed, because a caller that does not know what it is
   * replacing cannot tell a raise from a lower. The address it carries has to
   * be the policy at `spendingLimitSeed`, which is what stops a limit read off
   * one Account being written onto another.
   */
  currentLimit: SpendingLimit;
  /** The terms replacing {@link currentLimit}. */
  terms: SpendingLimitTerms;
  /** The signer that may draw on the limit. The primary signer in our model. */
  limitSigner: PublicKey;
  /**
   * The Settings signer set as it stands, from {@link fetchSettings}. The
   * proposer has to hold `Initiate` there, and the limit signer has to be a
   * key the Account actually names.
   */
  signers: readonly SettingsSigner[];
  /** Proposes the change. Must be a signer with `Initiate`, so S1. */
  proposer: PublicKey;
  /** Funds the rent. Defaults to `proposer`. */
  rentPayer?: PublicKey;
  /** The Settings account's current `transactionIndex`, plus one. */
  transactionIndex: bigint;
}

export interface SpendingLimitChangeResult {
  /**
   * The policy the change rewrites or removes, which
   * {@link buildExecuteSettingsChange} has to carry.
   */
  policies: PublicKey[];
  /** Propose the change. Signed by `proposer` alone. */
  propose: TransactionInstruction[];
}

/**
 * Replaces the spending limit's terms with new ones.
 *
 * A settings change like any other: two approvals and the full time lock. That
 * is what the limit is worth. It is the size of the band one signature can
 * move, so a Consumer able to raise it on one signature would have no limit at
 * all, and the delay is the window in which a raise nobody asked for can be
 * rejected.
 *
 * `PolicyUpdate` replaces the whole policy rather than patching it, so the
 * signer, the threshold of 1 and the zero time lock are restated here from the
 * same helpers the create path uses. Anything left out would be dropped
 * silently, and a spending-limit policy with no signer is a one-signature route
 * nobody can take.
 *
 * The above-limit policy is deliberately untouched. It governs what the limit
 * does not admit, and that is unchanged by where the line sits.
 */
export function buildUpdateSpendingLimit({
  addresses,
  spendingLimitSeed,
  currentLimit,
  terms,
  limitSigner,
  signers,
  proposer,
  rentPayer,
  transactionIndex,
}: UpdateSpendingLimitParams): SpendingLimitChangeResult {
  const policy = spendingLimitPolicyOf(
    addresses,
    spendingLimitSeed,
    currentLimit,
  );
  assertHoldsInitiate(signers, proposer);

  if (!terms.mint.equals(currentLimit.mint)) {
    throw new SettingsChangeRefusedError(
      `the limit is denominated in ${currentLimit.mint.toBase58()}; writing ${terms.mint.toBase58()} onto it would put every Spend in the old mint on two signatures`,
    );
  }
  if (!signers.some((signer) => signer.key.equals(limitSigner))) {
    throw new SettingsChangeRefusedError(
      `${limitSigner.toBase58()} is not on the Settings signer set, so it cannot be the key the limit answers to`,
    );
  }
  if (sameTerms(terms, currentLimit)) {
    throw new SettingsChangeRefusedError(
      "the new terms are the terms the Account already carries",
    );
  }

  return {
    policies: [policy],
    propose: proposeSettingsChange({
      addresses,
      transactionIndex,
      proposer,
      rentPayer,
      actions: [
        spendingLimitPolicyUpdateAction({ policy, terms, limitSigner }),
      ],
    }),
  };
}

export interface RemoveSpendingLimitParams {
  addresses: AccountAddresses;
  /** Identifies the spending-limit policy being removed. */
  spendingLimitSeed: bigint;
  /**
   * The limit as the chain holds it, from {@link fetchSpendingLimit}. Removal
   * names an address, and this is what proves the address named is the limit
   * rather than whatever else sits at that seed.
   */
  currentLimit: SpendingLimit;
  /** The Settings signer set as it stands, from {@link fetchSettings}. */
  signers: readonly SettingsSigner[];
  /** Proposes the change. Must be a signer with `Initiate`, so S1. */
  proposer: PublicKey;
  /** Funds the rent. Defaults to `proposer`. Removal refunds nothing. */
  rentPayer?: PublicKey;
  /** The Settings account's current `transactionIndex`, plus one. */
  transactionIndex: bigint;
}

/**
 * Takes the spending limit off the Account entirely.
 *
 * What is left is an Account with no one-signature route: every Spend then
 * resolves to the above-limit policy and needs the primary and the approval
 * signer together. That is a valid higher-security state, not a broken
 * Account, which is exactly why the above-limit policy is untouched here.
 * Removing both would leave an Account that cannot pay anyone at all.
 *
 * The removal runs through the Account's own threshold and time lock like any
 * other settings change. Nothing is lost by waiting: while the change sits, the
 * limit still stands and Spends under it still take one signature.
 */
export function buildRemoveSpendingLimit({
  addresses,
  spendingLimitSeed,
  currentLimit,
  signers,
  proposer,
  rentPayer,
  transactionIndex,
}: RemoveSpendingLimitParams): SpendingLimitChangeResult {
  const policy = spendingLimitPolicyOf(
    addresses,
    spendingLimitSeed,
    currentLimit,
  );
  assertHoldsInitiate(signers, proposer);

  return {
    policies: [policy],
    propose: proposeSettingsChange({
      addresses,
      transactionIndex,
      proposer,
      rentPayer,
      actions: [{ __kind: "PolicyRemove", policy }],
    }),
  };
}

export interface ProvisionAccountParams {
  addresses: AccountAddresses;
  /** Distinguishes the spending-limit policy from others on the Account. */
  spendingLimitSeed: bigint;
  /** Distinguishes the above-limit policy from others on the Account. */
  aboveLimitSeed: bigint;
  terms: SpendingLimitTerms;
  /** Draws on the limit alone, and is one of the two above-limit signers. */
  primary: PublicKey;
  /** The second above-limit signer, kept off the spending-limit path. */
  approval: PublicKey;
  /** Proposes the change. Must be a signer with `Initiate`. */
  proposer: PublicKey;
  /**
   * Funds the rent for the transaction, proposal and policy accounts this
   * creates. Defaults to `proposer`. See {@link CreateSpendingLimitPolicyParams}.
   */
  rentPayer?: PublicKey;
  /** The Settings account's current `transactionIndex`, plus one. */
  transactionIndex: bigint;
  /** Seconds. `SETTINGS_TIME_LOCK_SECONDS` is the value D3 settled on. */
  timeLockSeconds: number;
  /**
   * The programs a Spend above the limit may call. Defaults to
   * {@link ABOVE_LIMIT_PROGRAM_ALLOWLIST}.
   */
  allowedPrograms?: readonly PublicKey[];
}

export interface ProvisionAccountResult {
  /**
   * In the order the actions create them, which is the order
   * {@link buildExecuteSettingsChange} has to pass them back.
   */
  policies: PublicKey[];
  /** Propose the change. Signed by `proposer` alone. */
  propose: TransactionInstruction[];
}

/**
 * Proposes everything a new Account needs in a single settings change: both
 * policies and the time lock.
 *
 * A settings change carries a *list* of actions, and each change costs four
 * transactions of which one is signed by the approval signer. Splitting this
 * work across three changes therefore costs three hardware-key prompts during
 * signup, for something the Consumer experiences as one act.
 *
 * The lock comes last in the list and does not hold back the policies beside
 * it. The lock is checked once, before any action applies, against the lock
 * the Settings currently carries, which provisioning leaves at zero until this
 * change lands.
 */
export function buildProvisionAccount({
  addresses,
  spendingLimitSeed,
  aboveLimitSeed,
  terms,
  primary,
  approval,
  proposer,
  rentPayer,
  transactionIndex,
  timeLockSeconds,
  allowedPrograms = ABOVE_LIMIT_PROGRAM_ALLOWLIST,
}: ProvisionAccountParams): ProvisionAccountResult {
  if (spendingLimitSeed === aboveLimitSeed) {
    throw new Error("the two policies must take distinct seeds");
  }

  return {
    policies: [
      derivePolicyAddress(addresses.settings, spendingLimitSeed),
      derivePolicyAddress(addresses.settings, aboveLimitSeed),
    ],
    propose: proposeSettingsChange({
      addresses,
      transactionIndex,
      proposer,
      rentPayer,
      actions: [
        spendingLimitPolicyAction({
          policySeed: spendingLimitSeed,
          terms,
          limitSigner: primary,
        }),
        aboveLimitPolicyAction({
          policySeed: aboveLimitSeed,
          primary,
          approval,
          allowedPrograms,
        }),
        setTimeLockAction(timeLockSeconds),
      ],
    }),
  };
}

function spendingLimitPolicyAction({
  policySeed,
  terms,
  limitSigner,
}: {
  policySeed: bigint;
  terms: SpendingLimitTerms;
  limitSigner: PublicKey;
}): generated.SettingsAction {
  return {
    __kind: "PolicyCreate",
    seed: policySeed,
    policyCreationPayload: spendingLimitPayload(terms),
    signers: spendingLimitSigners(limitSigner),
    threshold: 1,
    timeLock: 0,
    startTimestamp: null,
    expirationArgs: null,
  };
}

function spendingLimitPayload(
  terms: SpendingLimitTerms,
): generated.PolicyCreationPayload {
  if (terms.maxPerUse > terms.maxPerPeriod) {
    throw new Error(
      "maxPerUse exceeds maxPerPeriod, so the per-use cap could never be reached",
    );
  }

  return {
    __kind: "SpendingLimit",
    fields: [
      {
        mint: terms.mint,
        sourceAccountIndex: PRIMARY_ACCOUNT_INDEX,
        timeConstraints: {
          start: 0,
          expiration: null,
          period: { __kind: terms.period },
          accumulateUnused: false,
        },
        quantityConstraints: {
          maxPerPeriod: terms.maxPerPeriod,
          maxPerUse: terms.maxPerUse,
          enforceExactQuantity: false,
        },
        usageState: null,
        destinations: terms.destinations ?? [],
      },
    ],
  };
}

function spendingLimitSigners(limitSigner: PublicKey) {
  return [{ key: limitSigner, permissions: Permissions.all() }];
}

/**
 * Rewrites the spending-limit policy so its one signer is the new primary.
 *
 * `PolicyUpdate` replaces the whole policy, so the terms have to be restated
 * exactly as they stand; they are built by the same helper the create path
 * uses, which is what stops a rotation from quietly changing the limit it was
 * only meant to re-address.
 */
function spendingLimitPolicyUpdateAction({
  policy,
  terms,
  limitSigner,
}: {
  policy: PublicKey;
  terms: SpendingLimitTerms;
  limitSigner: PublicKey;
}): generated.SettingsAction {
  return {
    __kind: "PolicyUpdate",
    policy,
    policyUpdatePayload: spendingLimitPayload(terms),
    signers: spendingLimitSigners(limitSigner),
    threshold: 1,
    timeLock: 0,
    expirationArgs: null,
  };
}

function aboveLimitPolicyAction({
  policySeed,
  primary,
  approval,
  allowedPrograms,
}: {
  policySeed: bigint;
  primary: PublicKey;
  approval: PublicKey;
  allowedPrograms: readonly PublicKey[];
}): generated.SettingsAction {
  if (primary.equals(approval)) {
    throw new Error("primary and approval signers must be distinct");
  }

  return {
    __kind: "PolicyCreate",
    seed: policySeed,
    policyCreationPayload: aboveLimitPayload(allowedPrograms),
    signers: aboveLimitSigners(primary, approval),
    threshold: 2,
    timeLock: 0,
    startTimestamp: null,
    expirationArgs: null,
  };
}

/**
 * Rewrites the above-limit policy's signer set in place.
 *
 * `PolicyUpdate` replaces the whole policy rather than patching it, so the
 * payload and threshold have to be restated exactly as created. They are read
 * from the same two helpers the create path uses, which is what stops a
 * rotation from quietly narrowing or widening the policy it was only meant to
 * re-address.
 */
function aboveLimitPolicyUpdateAction({
  policy,
  primary,
  approval,
  allowedPrograms,
}: {
  policy: PublicKey;
  primary: PublicKey;
  approval: PublicKey;
  allowedPrograms: readonly PublicKey[];
}): generated.SettingsAction {
  if (primary.equals(approval)) {
    throw new Error("primary and approval signers must be distinct");
  }

  return {
    __kind: "PolicyUpdate",
    policy,
    policyUpdatePayload: aboveLimitPayload(allowedPrograms),
    signers: aboveLimitSigners(primary, approval),
    threshold: 2,
    timeLock: 0,
    expirationArgs: null,
  };
}

/**
 * One constraint per allowed program, each with no account or data
 * constraints, so any instruction to that program passes. A Spend then names
 * the constraint each of its instructions satisfies, by index into this list.
 */
function aboveLimitPayload(
  allowedPrograms: readonly PublicKey[],
): generated.PolicyCreationPayload {
  if (allowedPrograms.length === 0) {
    throw new Error(
      "the above-limit policy needs at least one allowed program; an empty list disables constraint checking",
    );
  }
  if (allowedPrograms.length > MAX_INSTRUCTION_CONSTRAINTS) {
    throw new Error(
      `the above-limit policy takes at most ${MAX_INSTRUCTION_CONSTRAINTS} allowed programs, got ${allowedPrograms.length}`,
    );
  }
  if (
    new Set(allowedPrograms.map((p) => p.toBase58())).size !==
    allowedPrograms.length
  ) {
    throw new Error("allowed programs must be distinct");
  }

  return {
    __kind: "ProgramInteraction",
    fields: [
      {
        accountIndex: PRIMARY_ACCOUNT_INDEX,
        instructionsConstraints: allowedPrograms.map((programId) => ({
          programId,
          accountConstraints: [],
          dataConstraints: [],
        })),
        preHook: null,
        postHook: null,
        spendingLimits: [],
      },
    ],
  };
}

/**
 * The policy address the caller means, checked against the limit they read.
 *
 * A seed alone derives an address whatever sits there, so a change built from
 * a seed the Account never used would propose a rewrite of nothing and fail a
 * day later at execute, having spent an index and the whole time lock.
 */
function spendingLimitPolicyOf(
  addresses: AccountAddresses,
  spendingLimitSeed: bigint,
  currentLimit: SpendingLimit,
): PublicKey {
  const policy = derivePolicyAddress(addresses.settings, spendingLimitSeed);
  if (!currentLimit.policy.equals(policy)) {
    throw new SettingsChangeRefusedError(
      `the spending limit given is for policy ${currentLimit.policy.toBase58()}, not the one at seed ${spendingLimitSeed} (${policy.toBase58()})`,
    );
  }
  return policy;
}

function assertHoldsInitiate(
  signers: readonly SettingsSigner[],
  proposer: PublicKey,
): void {
  const signer = signers.find((candidate) => candidate.key.equals(proposer));
  if (!signer) {
    throw new SettingsChangeRefusedError(
      `${proposer.toBase58()} is not on the Settings signer set, so it cannot propose a change`,
    );
  }
  if (!Permissions.has(signer.permissions, Permission.Initiate)) {
    throw new SettingsChangeRefusedError(
      `${proposer.toBase58()} does not hold Initiate, so it cannot propose a change`,
    );
  }
}

function sameTerms(terms: SpendingLimitTerms, limit: SpendingLimit): boolean {
  const destinations = terms.destinations ?? [];
  return (
    terms.maxPerUse === limit.maxPerUse &&
    terms.maxPerPeriod === limit.maxPerPeriod &&
    terms.period === limit.period &&
    destinations.length === limit.destinations.length &&
    destinations.every((destination, index) =>
      destination.equals(limit.destinations[index]!),
    )
  );
}

function termsOf(limit: SpendingLimit): SpendingLimitTerms {
  return {
    mint: limit.mint,
    maxPerUse: limit.maxPerUse,
    maxPerPeriod: limit.maxPerPeriod,
    period: limit.period,
    destinations: limit.destinations,
  };
}

function aboveLimitSigners(primary: PublicKey, approval: PublicKey) {
  return [
    { key: primary, permissions: Permissions.all() },
    { key: approval, permissions: Permissions.all() },
  ];
}

function setTimeLockAction(seconds: number): generated.SettingsAction {
  return { __kind: "SetTimeLock", newTimeLock: seconds };
}

/**
 * The mask is read from `ROLE_PERMISSIONS` rather than restated, so a signer
 * added later is granted exactly what account creation grants S3 and the two
 * cannot drift apart.
 */
function addSignerAction(
  newSigner: PublicKey,
  role: SignerRole,
): generated.SettingsAction {
  return {
    __kind: "AddSigner",
    newSigner: {
      key: newSigner,
      permissions: { mask: ROLE_PERMISSIONS[role] },
    },
  };
}

function removeSignerAction(oldSigner: PublicKey): generated.SettingsAction {
  return { __kind: "RemoveSigner", oldSigner };
}

function proposeSettingsChange({
  addresses,
  transactionIndex,
  proposer,
  rentPayer,
  actions,
}: {
  addresses: AccountAddresses;
  transactionIndex: bigint;
  proposer: PublicKey;
  rentPayer?: PublicKey;
  actions: generated.SettingsAction[];
}): TransactionInstruction[] {
  return [
    instructions.createSettingsTransaction({
      settingsPda: addresses.settings,
      transactionIndex,
      creator: proposer,
      rentPayer,
      actions,
    }),
    instructions.createProposal({
      settingsPda: addresses.settings,
      transactionIndex,
      creator: proposer,
      rentPayer,
    }),
  ];
}
