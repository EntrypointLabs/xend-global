import { PublicKey, SystemProgram } from "@solana/web3.js";

/**
 * Program ids pinned here rather than imported, so this package keeps its
 * single runtime dependency on `@solana/web3.js`.
 */
export const SYSTEM_PROGRAM_ID = SystemProgram.programId;
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
  "ComputeBudget111111111111111111111111111111",
);

export const JUPITER_PROGRAM_ID = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
);
export const WRAPPED_SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

/**
 * The programs the above-limit policy lets a two-signature Spend call.
 *
 * Written onto the policy as one instruction constraint per program, in this
 * order. A Spend names the constraint each of its instructions satisfies by
 * index, so anything that rewrites the policy or builds a Spend against it
 * has to use the same list in the same order. New programs go on the end, so
 * the indices of the ones already there never move.
 *
 * The policy checks the program and nothing finer, so for Jupiter the chain
 * accepts any instruction the two signers approve. What holds a swap to the
 * one on screen is the signer reading the message back before signing it.
 */
export const ABOVE_LIMIT_PROGRAM_ALLOWLIST: readonly PublicKey[] = [
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  JUPITER_PROGRAM_ID,
];
