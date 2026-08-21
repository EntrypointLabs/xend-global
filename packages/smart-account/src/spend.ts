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
 * Associated Token Program. Pinned rather than taking a dependency on
 * `@solana/spl-token`, which this package would otherwise need for one
 * address derivation.
 */
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/** The mint a spending limit uses to mean native SOL. */
const NATIVE_MINT = PublicKey.default;

/**
 * The associated token account for an owner and mint.
 *
 * `findProgramAddressSync` rather than the spl-token helper so the vault, which
 * is a PDA and therefore off-curve, derives the same way any other owner does.
 */
export function associatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

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
  /**
   * The token program that owns `request.mint`. Required for anything but
   * native SOL, and it has to be the mint's actual owner: the program accepts
   * either SPL Token or Token-2022 and checks the account against the mint.
   */
  tokenProgram?: PublicKey;
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
  tokenProgram,
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
      // Signers first, then whatever the policy's mint calls for. The settings
      // account is only required when the policy carries a settings-state
      // expiration.
      instruction_accounts: [
        { pubkey: signers[0]!, isSigner: true, isWritable: false },
        ...spendAccounts({ addresses, request, tokenProgram }),
      ],
    });
  }

  if (signers.length < 2) {
    throw new Error(
      `two-signature route takes at least two signers, got ${signers.length}`,
    );
  }

  const transfer = aboveLimitTransfer({
    addresses,
    request,
    decimals,
    tokenProgram,
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

/**
 * The transfer the above-limit route wraps in its `ProgramInteraction` payload.
 *
 * Unlike the spending-limit route, nothing here is a hand-built account list:
 * the payload carries a compiled inner instruction, and the accounts fall out
 * of compiling it. So the whole difference between SOL and a token is which
 * instruction gets compiled.
 *
 * The vault is marked a signer because it is the authority on both. It cannot
 * sign a transaction itself — the program signs for the PDA during its CPI, and
 * the SDK's compiler clears the flag on the way out.
 */
function aboveLimitTransfer({
  addresses,
  request,
  decimals,
  tokenProgram,
}: {
  addresses: AccountAddresses;
  request: SpendRequest;
  decimals: number;
  tokenProgram?: PublicKey;
}): TransactionInstruction {
  if (request.mint.equals(NATIVE_MINT)) {
    return SystemProgram.transfer({
      fromPubkey: addresses.vault,
      toPubkey: request.destination,
      // As a bigint, not a Number. Above the limit is exactly where the large
      // amounts are, and past 2^53 lamports a Number silently rounds.
      lamports: request.amount,
    });
  }

  if (!tokenProgram) {
    throw new Error(
      `spending a token needs its token program; ${request.mint.toBase58()} has none`,
    );
  }

  // `destination` is the recipient's wallet; the transfer has to name their
  // associated token account. The caller opens it beforehand, because a policy
  // will not open one mid-Spend.
  return transferChecked({
    source: associatedTokenAddress(addresses.vault, request.mint, tokenProgram),
    mint: request.mint,
    destination: associatedTokenAddress(
      request.destination,
      request.mint,
      tokenProgram,
    ),
    authority: addresses.vault,
    amount: request.amount,
    decimals,
    tokenProgram,
  });
}

/**
 * SPL Token `TransferChecked`, built by hand.
 *
 * Checked rather than plain `Transfer` because it carries the mint and decimals
 * and the program verifies them, so a wrong-decimals amount is rejected on
 * chain instead of moving the wrong quantity. Built here rather than imported
 * so this package keeps its single dependency on `@solana/web3.js`, the same
 * reason {@link associatedTokenAddress} derives its address directly.
 *
 * Token-2022 shares the instruction tag and layout, so `tokenProgram` selects
 * between them and nothing else changes.
 */
function transferChecked({
  source,
  mint,
  destination,
  authority,
  amount,
  decimals,
  tokenProgram,
}: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amount: bigint;
  decimals: number;
  tokenProgram: PublicKey;
}): TransactionInstruction {
  const TRANSFER_CHECKED = 12;
  const data = Buffer.alloc(10);
  data.writeUInt8(TRANSFER_CHECKED, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);

  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      // Writable, though SPL treats the authority as read-only. The payload is
      // compiled as a message with no fee payer, and that compiler refuses one
      // with no writable signer at all. The vault is the only signer here, and
      // it is the account the program signs for, so it is the one to mark. The
      // native route marks it the same way via `SystemProgram.transfer`.
      { pubkey: authority, isSigner: true, isWritable: true },
    ],
    data,
  });
}

/**
 * The accounts the spending limit policy reads, after the signers.
 *
 * Two entirely different lists, because the program branches on the policy's
 * mint: native SOL takes the destination wallet directly, while a token takes
 * the two token accounts, the mint and its program. Sending a token with the
 * native list is what raises InvalidNumberOfAccounts, and the transaction is
 * refused before anything moves.
 *
 * The payload carries the destination OWNER either way; only the account list
 * differs, and for a token it names that owner's associated token account.
 */
function spendAccounts({
  addresses,
  request,
  tokenProgram,
}: {
  addresses: AccountAddresses;
  request: SpendRequest;
  tokenProgram?: PublicKey;
}) {
  if (request.mint.equals(NATIVE_MINT)) {
    return [
      { pubkey: addresses.vault, isSigner: false, isWritable: true },
      { pubkey: request.destination, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
  }

  if (!tokenProgram) {
    throw new Error(
      `spending a token needs its token program; ${request.mint.toBase58()} has none`,
    );
  }

  return [
    { pubkey: addresses.vault, isSigner: false, isWritable: true },
    {
      pubkey: associatedTokenAddress(
        addresses.vault,
        request.mint,
        tokenProgram,
      ),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: associatedTokenAddress(
        request.destination,
        request.mint,
        tokenProgram,
      ),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: request.mint, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
  ];
}
