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

/**
 * The programs the above-limit policy lets a two-signature Spend call.
 *
 * Written onto the policy as one instruction constraint per program, in this
 * order. A Spend names the constraint each of its instructions satisfies by
 * index, so anything that rewrites the policy or builds a Spend against it
 * has to use the same list in the same order.
 */
export const ABOVE_LIMIT_PROGRAM_ALLOWLIST: readonly PublicKey[] = [
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
];
