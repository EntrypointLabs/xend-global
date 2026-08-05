import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { instructions, utils } from "@sqds/smart-account";

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
  /** What is left in the current period, in the mint's smallest units. */
  remainingInPeriod: bigint;
  /** Empty means any destination is allowed. */
  destinations: PublicKey[];
}

export type SpendRoute =
  /** One signature from the primary signer, executed under the limit's policy. */
  | { kind: "spending-limit"; policy: PublicKey }
  /** Two signatures, primary plus approval. Always available. */
  | { kind: "two-signature"; reason: TwoSignatureReason };

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
): SpendRoute {
  if (limits.length === 0) {
    return { kind: "two-signature", reason: "no-spending-limit" };
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

  return { kind: "two-signature", reason: closestReason };
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
 * The two-signature route currently runs against the **Settings**, and synchronous
 * execution rejects a non-zero time lock on whichever consensus account it is given.
 * So this route only works on an Account whose Settings time lock is zero, which is
 * **not** the configuration D3 calls for. The intended above-limit path is an
 * above-limit policy carrying signers `[primary, approval]` at threshold 2 and its
 * own zero time lock; that builder does not exist yet. Until it does, an Account
 * with a Settings time lock can only spend under a spending limit.
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
  const compiled = utils.instructionsToSynchronousTransactionDetails({
    vaultPda: addresses.vault,
    members: signers,
    transaction_instructions: [transfer],
  });

  return instructions.executeTransactionSync({
    settingsPda: addresses.settings,
    accountIndex: PRIMARY_ACCOUNT_INDEX,
    numSigners: signers.length,
    instructions: compiled.instructions,
    instruction_accounts: compiled.accounts,
  });
}
