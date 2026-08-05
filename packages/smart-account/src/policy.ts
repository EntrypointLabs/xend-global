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
  transactionIndex,
}: CreateSpendingLimitPolicyParams): CreateSpendingLimitPolicyResult {
  if (terms.maxPerUse > terms.maxPerPeriod) {
    throw new Error(
      "maxPerUse exceeds maxPerPeriod, so the per-use cap could never be reached",
    );
  }

  const policy = derivePolicyAddress(addresses.settings, policySeed);

  const action: generated.SettingsAction = {
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

  return {
    policy,
    propose: [
      instructions.createSettingsTransaction({
        settingsPda: addresses.settings,
        transactionIndex,
        creator: proposer,
        actions: [action],
      }),
      instructions.createProposal({
        settingsPda: addresses.settings,
        transactionIndex,
        creator: proposer,
      }),
    ],
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
  policies = [],
}: {
  addresses: AccountAddresses;
  transactionIndex: bigint;
  signer: PublicKey;
  /** Policy addresses the change creates, which need rent. */
  policies?: PublicKey[];
}): TransactionInstruction {
  return instructions.executeSettingsTransaction({
    settingsPda: addresses.settings,
    transactionIndex,
    signer,
    rentPayer: signer,
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
