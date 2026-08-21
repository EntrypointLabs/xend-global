import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { instructions, types } from "@sqds/smart-account";
import type { generated } from "@sqds/smart-account";

import { derivePolicyAddress } from "./pda.js";
import type { AccountAddresses } from "./types.js";

const { Permissions } = types;
const PRIMARY_ACCOUNT_INDEX = 0;

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
 * `instructionsConstraints` is deliberately **empty**. In the program that means no
 * constraint checking runs at all, so the policy permits any instruction. The
 * protection here is the threshold of 2, not an instruction allowlist. Narrowing it
 * later (destination allowlists, merchant rules) is a policy update, not a rewrite.
 */
export function buildCreateAboveLimitPolicy({
  addresses,
  policySeed,
  primary,
  approval,
  proposer,
  rentPayer,
  transactionIndex,
}: CreateAboveLimitPolicyParams): CreateSpendingLimitPolicyResult {
  return {
    policy: derivePolicyAddress(addresses.settings, policySeed),
    propose: proposeSettingsChange({
      addresses,
      transactionIndex,
      proposer,
      rentPayer,
      actions: [aboveLimitPolicyAction({ policySeed, primary, approval })],
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
  if (terms.maxPerUse > terms.maxPerPeriod) {
    throw new Error(
      "maxPerUse exceeds maxPerPeriod, so the per-use cap could never be reached",
    );
  }

  return {
    __kind: "PolicyCreate",
    seed: policySeed,
    policyCreationPayload: {
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
    },
    signers: [{ key: limitSigner, permissions: Permissions.all() }],
    threshold: 1,
    timeLock: 0,
    startTimestamp: null,
    expirationArgs: null,
  };
}

function aboveLimitPolicyAction({
  policySeed,
  primary,
  approval,
}: {
  policySeed: bigint;
  primary: PublicKey;
  approval: PublicKey;
}): generated.SettingsAction {
  if (primary.equals(approval)) {
    throw new Error("primary and approval signers must be distinct");
  }

  return {
    __kind: "PolicyCreate",
    seed: policySeed,
    policyCreationPayload: {
      __kind: "ProgramInteraction",
      fields: [
        {
          accountIndex: PRIMARY_ACCOUNT_INDEX,
          instructionsConstraints: [],
          preHook: null,
          postHook: null,
          spendingLimits: [],
        },
      ],
    },
    signers: [
      { key: primary, permissions: Permissions.all() },
      { key: approval, permissions: Permissions.all() },
    ],
    threshold: 2,
    timeLock: 0,
    startTimestamp: null,
    expirationArgs: null,
  };
}

function setTimeLockAction(seconds: number): generated.SettingsAction {
  return { __kind: "SetTimeLock", newTimeLock: seconds };
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
