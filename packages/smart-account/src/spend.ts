import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { instructions, utils } from "@sqds/smart-account";

import type { LimitPeriod } from "./policy.js";
import type { AccountAddresses } from "./types.js";

const PRIMARY_ACCOUNT_INDEX = 0;

/**
 * A spending limit an Account currently has, resolved from chain state.
 *
 * Optional by design: an Account may have none, in which case every Spend takes two
 * signatures. That is a valid higher-security state, not an error. See D5.
 */
export interface SpendingLimit {
  policy: PublicKey;
  mint: PublicKey;
  /** Largest single use, in the mint's smallest units. */
  maxPerUse: bigint;
  /** The period's ceiling, in the mint's smallest units. */
  maxPerPeriod: bigint;
  /**
   * What is left in the current period, in the mint's smallest units.
   *
   * Recorded by the program, which refills it when a Spend executes under this
   * policy. It is not a live countdown: a period that has rolled over still
   * reads low until something spends under the limit again.
   */
  remainingInPeriod: bigint;
  /** How often {@link remainingInPeriod} refills to {@link maxPerPeriod}. */
  period: LimitPeriod;
  /** Empty means any destination is allowed. */
  destinations: PublicKey[];
}

export type SpendRoute =
  /** One signature from the primary signer, executed under the limit's policy. */
  | { kind: "spending-limit"; policy: PublicKey }
  /**
   * Two signatures, primary plus approval, executed under the above-limit
   * policy. The policy rather than the Settings, because synchronous execution
   * rejects a non-zero time lock on its consensus account and D3 puts a 24-hour
   * lock on the Settings. Routing this through the Settings makes every
   * above-limit Spend impossible on a correctly configured Account.
   */
  | { kind: "two-signature"; reason: TwoSignatureReason; policy: PublicKey };

export type TwoSignatureReason =
  | "no-spending-limit"
  | "different-mint"
  | "exceeds-per-use"
  | "exceeds-remaining"
  | "destination-not-allowed";

export interface SpendRequest {
  mint: PublicKey;
  /** In the mint's smallest units. */
  amount: bigint;
  destination: PublicKey;
}

/**
 * Decides how a Spend must be signed.
 *
 * The two-signature path is the floor, so this only ever returns the
 * single-signature route when a limit positively admits the Spend. Anything
 * unresolved falls through to two signatures rather than assuming permission.
 */
export function resolveSpendRoute(
  request: SpendRequest,
  limits: readonly SpendingLimit[],
  aboveLimitPolicy: PublicKey,
): SpendRoute {
  const twoSignature = (reason: TwoSignatureReason): SpendRoute => ({
    kind: "two-signature",
    reason,
    policy: aboveLimitPolicy,
  });

  if (limits.length === 0) {
    return twoSignature("no-spending-limit");
  }

  let closestReason: TwoSignatureReason = "different-mint";
  for (const limit of limits) {
    if (!limit.mint.equals(request.mint)) continue;

    if (request.amount > limit.maxPerUse) {
      closestReason = "exceeds-per-use";
      continue;
    }
    if (request.amount > limit.remainingInPeriod) {
      closestReason = "exceeds-remaining";
      continue;
    }
    if (
      limit.destinations.length > 0 &&
      !limit.destinations.some((d) => d.equals(request.destination))
    ) {
      closestReason = "destination-not-allowed";
      continue;
    }

    return { kind: "spending-limit", policy: limit.policy };
  }

  return twoSignature(closestReason);
}

export interface BuildSpendParams {
  addresses: AccountAddresses;
  request: SpendRequest;
  route: SpendRoute;
  /** Primary alone for the limit route; primary and approval for two-signature. */
  signers: PublicKey[];
  /** Decimals of `request.mint`. 9 for SOL. */
  decimals: number;
}

/**
 * Builds a single instruction that executes the Spend.
 *
 * Both routes are synchronous: one transaction, no proposal accounts, no rent.
 *
 * Both routes execute under a policy, never under the Settings. Synchronous
 * execution rejects a non-zero time lock on its consensus account, and D3 puts a
 * 24-hour lock on the Settings, so a Settings-routed Spend cannot execute at all on
 * a correctly configured Account. The above-limit policy carries `[primary,
 * approval]` at threshold 2 with its own zero time lock, which is what makes the
 * two-signature route work alongside a time-locked Settings.
 */
export function buildSpend({
  addresses,
  request,
  route,
  signers,
  decimals,
}: BuildSpendParams): TransactionInstruction {
  if (route.kind === "spending-limit") {
    if (signers.length !== 1) {
      throw new Error(
        `spending-limit route takes exactly one signer, got ${signers.length}`,
      );
    }
    return instructions.executePolicyPayloadSync({
      policy: route.policy,
      accountIndex: PRIMARY_ACCOUNT_INDEX,
      numSigners: 1,
      policyPayload: {
        __kind: "SpendingLimit",
        fields: [
          {
            amount: request.amount,
            destination: request.destination,
            decimals,
          },
        ],
      },
      // Signers first, then source, destination, system program. The settings
      // account is only required when the policy carries a settings-state
      // expiration.
      instruction_accounts: [
        { pubkey: signers[0]!, isSigner: true, isWritable: false },
        { pubkey: addresses.vault, isSigner: false, isWritable: true },
        { pubkey: request.destination, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
    });
  }

  if (signers.length < 2) {
    throw new Error(
      `two-signature route takes at least two signers, got ${signers.length}`,
    );
  }

  const transfer = SystemProgram.transfer({
    fromPubkey: addresses.vault,
    toPubkey: request.destination,
    lamports: Number(request.amount),
  });
  // Compiled with no members, so the account indices start at the message
  // accounts. The program strips the first `numSigners` remaining accounts
  // before reading the message, so indices that counted the signers point past
  // the end of what it sees and fail as InvalidTransactionMessage (6007).
  const compiled = utils.instructionsToSynchronousTransactionDetails({
    vaultPda: addresses.vault,
    members: [],
    transaction_instructions: [transfer],
  });
  const signerAccounts = signers.map((pubkey) => ({
    pubkey,
    isSigner: true,
    isWritable: false,
  }));

  // A ProgramInteraction policy takes a payload, not a raw transaction. Handing
  // it one fails with ProgramInteractionAsyncPayloadNotAllowedWithSyncTransaction
  // (6061), and routing it through the Settings instead fails the
  // consensus_account constraint (2003) as soon as the Settings carries a time
  // lock. The payload form is the only shape that executes.
  return instructions.executePolicyPayloadSync({
    policy: route.policy,
    accountIndex: PRIMARY_ACCOUNT_INDEX,
    numSigners: signers.length,
    policyPayload: {
      __kind: "ProgramInteraction",
      fields: [
        {
          instructionConstraintIndices: null,
          transactionPayload: {
            __kind: "SyncTransaction",
            fields: [
              {
                accountIndex: PRIMARY_ACCOUNT_INDEX,
                instructions: compiled.instructions,
              },
            ],
          },
        },
      ],
    },
    instruction_accounts: [...signerAccounts, ...compiled.accounts],
  });
}
