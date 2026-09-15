import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { accounts, getProposalPda } from "@sqds/smart-account";

import type { SpendingLimit } from "./spend.js";

/**
 * Reading Account state back off the chain.
 *
 * The layouts live here rather than at the call sites so that consumers depend
 * on this package's shapes instead of the vendored SDK's: the SDK's decoded
 * types leak `__kind` tags and bignums, and every place that touched one had to
 * know how to convert them.
 */

export class AccountStateError extends Error {}

export interface SettingsSigner {
  key: PublicKey;
  /** The `Initiate | Vote | Execute` bitmask the Settings grants this key. */
  permissions: { mask: number };
}

/** The Settings fields anything outside the program actually acts on. */
export interface SettingsState {
  timeLockSeconds: number;
  /** The index the next settings change will take. */
  transactionIndex: bigint;
  signers: SettingsSigner[];
  /**
   * The last policy seed the program assigned, or null before it has assigned
   * any. The next policy must take exactly this plus one: the counter only
   * ever moves forward, and removing a policy does not give its seed back, so
   * a create at any other seed is refused at execute.
   */
  policySeed: bigint | null;
}

export interface ProposalState {
  /** Signers who have approved, base58. */
  approved: string[];
  /** Signers who have rejected, base58. A signer here cannot vote again. */
  rejected: string[];
  /** Nothing further is owed to this proposal. See {@link UNFINISHED}. */
  settled: boolean;
  /** The program's own name for where this proposal stands. */
  status: ProposalStatusName;
  /**
   * Unix seconds at which the proposal entered {@link status}, or null for
   * `Executing`, which the program records without one.
   *
   * The Settings time lock is counted from the moment of approval, so this is
   * what says when a staged change becomes executable, and therefore how long a
   * Consumer has left to reject one they did not make.
   */
  statusTimestamp: bigint | null;
}

export type ProposalStatusName =
  | "Draft"
  | "Active"
  | "Rejected"
  | "Approved"
  | "Executing"
  | "Executed"
  | "Cancelled";

/**
 * Proposal states that still have a step owed to them.
 *
 * Enumerated rather than expressed as "not one of the terminal states", because
 * the two mistakes are not equal. Calling an unfinished proposal finished makes
 * provisioning loop, re-proposing and re-approving at a fresh index every lap
 * and charging the Consumer a fingerprint each time. Calling a finished one
 * unfinished stalls on a step the program will simply refuse. A stall is
 * visible; the loop looked like slowness.
 */
const UNFINISHED = ["Draft", "Active", "Approved", "Executing"];

export async function fetchSettings(
  connection: Connection,
  settings: PublicKey,
): Promise<SettingsState> {
  const state = await accounts.Settings.fromAccountAddress(
    connection,
    settings,
  );
  return {
    timeLockSeconds: state.timeLock,
    transactionIndex: toBigInt(state.transactionIndex),
    signers: state.signers.map(({ key, permissions }) => ({
      key,
      permissions: { mask: permissions.mask },
    })),
    policySeed:
      state.policySeed === null || state.policySeed === undefined
        ? null
        : toBigInt(state.policySeed),
  };
}

/** The seed the next policy on this Account has to take. */
export function nextPolicySeed(settings: SettingsState): bigint {
  return (settings.policySeed ?? 0n) + 1n;
}

/**
 * The spending limit a policy account currently holds. Anything that restates
 * the limit, such as a primary signer rotation, reads it from here rather than
 * from whatever provisioning wrote.
 */
export async function fetchSpendingLimit(
  connection: Connection,
  policy: PublicKey,
): Promise<SpendingLimit> {
  const info = await connection.getAccountInfo(policy);
  if (!info) {
    throw new AccountStateError(`No policy account at ${policy.toBase58()}`);
  }
  return decodeSpendingLimit(policy, info);
}

export function deriveProposalAddress(
  settings: PublicKey,
  transactionIndex: bigint,
): PublicKey {
  return getProposalPda({ settingsPda: settings, transactionIndex })[0];
}

export function decodeProposal(info: AccountInfo<Buffer>): ProposalState {
  const [proposal] = accounts.Proposal.fromAccountInfo(info);
  const status = proposal.status as { __kind: string; timestamp?: unknown };
  return {
    approved: proposal.approved.map((key) => key.toBase58()),
    // Needed to build a rejection. A signer who has already voted cannot vote
    // again, so anything adding a rejection has to know who is left.
    rejected: proposal.rejected.map((key) => key.toBase58()),
    settled: !UNFINISHED.includes(status.__kind),
    status: status.__kind as ProposalStatusName,
    statusTimestamp:
      status.timestamp === undefined ? null : toBigInt(status.timestamp),
  };
}

/**
 * The spending limit a policy account holds.
 *
 * Throws rather than returning null for a policy that is not a spending limit,
 * or one carrying a period nothing in this package creates: at the fixed seed
 * provisioning writes, either means the account is not the policy that was
 * written, and routing Spends against it would be deciding from a state nobody
 * intended.
 */
export function decodeSpendingLimit(
  policy: PublicKey,
  info: AccountInfo<Buffer>,
): SpendingLimit {
  let state: accounts.Policy;
  try {
    [state] = accounts.Policy.fromAccountInfo(info);
  } catch (cause) {
    throw new AccountStateError(
      `Could not decode the policy at ${policy.toBase58()}: ${describe(cause)}`,
    );
  }

  if (state.policyState.__kind !== "SpendingLimit") {
    throw new AccountStateError(
      `Policy ${policy.toBase58()} holds a ${state.policyState.__kind} policy, not a spending limit`,
    );
  }

  const [{ destinations, spendingLimit }] = state.policyState.fields;
  const period = spendingLimit.timeConstraints.period;
  if (period.__kind === "Custom") {
    throw new AccountStateError(
      `Policy ${policy.toBase58()} carries a custom period, which provisioning never creates`,
    );
  }

  return {
    policy,
    mint: spendingLimit.mint,
    maxPerUse: toBigInt(spendingLimit.quantityConstraints.maxPerUse),
    maxPerPeriod: toBigInt(spendingLimit.quantityConstraints.maxPerPeriod),
    period: period.__kind,
    remainingInPeriod: toBigInt(spendingLimit.usage.remainingInPeriod),
    destinations,
  };
}

/** The SDK's u64s are BN at runtime whatever the declaration says. */
function toBigInt(value: unknown): bigint {
  return BigInt((value as { toString(): string }).toString());
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
