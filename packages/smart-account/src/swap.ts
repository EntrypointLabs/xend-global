import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { instructions, utils } from "@sqds/smart-account";

import {
  JUPITER_SWAP_LAYOUTS,
  type Layout,
  type LayoutPart,
} from "./jupiter-swap-layouts.js";
import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  JUPITER_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from "./programs.js";
import { associatedTokenAddress } from "./spend.js";
import type { AccountAddresses } from "./types.js";

const PRIMARY_ACCOUNT_INDEX = 0;

/** Rent a classic token account holds, which closing it hands to the vault. */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;

/**
 * Jupiter's `shared_accounts_route`, the only swap instruction a Spend wraps.
 *
 * Chosen over `route` because every intermediate hop runs through accounts
 * Jupiter's own program owns. The vault then appears exactly once, as the
 * authority over the first transfer, and the only vault token accounts in the
 * instruction are the one paid from and the one paid into.
 */
export const JUPITER_SHARED_ACCOUNTS_ROUTE = Buffer.from(
  "c1209b3341d69c81",
  "hex",
);

/** Positions in `shared_accounts_route`'s fixed account list. */
export const JUPITER_ROUTE_ACCOUNTS = {
  transferAuthority: 2,
  source: 3,
  destination: 6,
  sourceMint: 7,
  destinationMint: 8,
  platformFee: 9,
  program: 12,
  fixedLength: 13,
} as const;

/** `in_amount`, `quoted_out_amount`, `slippage_bps`, `platform_fee_bps`. */
const JUPITER_ROUTE_TERMS_LENGTH = 19;

/** `percent`, `input_index`, `output_index`, after each venue's arguments. */
const ROUTE_STEP_TRAILER_LENGTH = 3;

/** More hops than any real route, and few enough to walk without thinking. */
const MAX_ROUTE_STEPS = 32;

export interface JupiterRouteTerms {
  amountIn: bigint;
  quotedAmountOut: bigint;
  slippageBps: number;
  platformFeeBps: number;
}

/**
 * The amounts a `shared_accounts_route` commits to.
 *
 * Read from where Jupiter's program reads them: after the route plan, which
 * is walked venue by venue to find its end. Taking the last bytes instead
 * would trust whoever built the instruction, because the program stops
 * reading once its arguments are filled and ignores anything appended. So
 * the data must also end exactly where the terms do, and a venue this build
 * cannot measure is refused, not skipped.
 */
export function readJupiterRouteTerms(data: Buffer): JupiterRouteTerms | null {
  if (
    data.length < 8 ||
    !data.subarray(0, 8).equals(JUPITER_SHARED_ACCOUNTS_ROUTE)
  ) {
    return null;
  }
  // The discriminator, then `id`, then the route plan's length.
  let offset = 9;
  if (data.length < offset + 4) return null;
  const steps = data.readUInt32LE(offset);
  offset += 4;
  if (steps === 0 || steps > MAX_ROUTE_STEPS) return null;

  for (let step = 0; step < steps; step++) {
    if (offset >= data.length) return null;
    const layout = JUPITER_SWAP_LAYOUTS[data.readUInt8(offset)];
    if (!layout) return null;
    const end = skipLayout(data, offset + 1, layout);
    if (end === null) return null;
    offset = end + ROUTE_STEP_TRAILER_LENGTH;
  }
  if (offset + JUPITER_ROUTE_TERMS_LENGTH !== data.length) return null;

  return {
    amountIn: data.readBigUInt64LE(offset),
    quotedAmountOut: data.readBigUInt64LE(offset + 8),
    slippageBps: data.readUInt16LE(offset + 16),
    platformFeeBps: data.readUInt8(offset + 18),
  };
}

/** Where `layout` ends when it starts at `offset`, or null if it runs out. */
function skipLayout(
  data: Buffer,
  offset: number,
  layout: Layout,
): number | null {
  let at: number | null = offset;
  for (const part of layout) {
    at = skipPart(data, at, part);
    if (at === null) return null;
  }
  return at;
}

function skipPart(
  data: Buffer,
  offset: number,
  part: LayoutPart,
): number | null {
  if (typeof part === "number") {
    return offset + part <= data.length ? offset + part : null;
  }
  const [kind, ...rest] = part;
  if (kind === "o") {
    if (offset >= data.length) return null;
    const tag = data.readUInt8(offset);
    if (tag === 0) return offset + 1;
    return tag === 1 ? skipLayout(data, offset + 1, rest as Layout) : null;
  }
  if (kind === "v") {
    if (offset + 4 > data.length) return null;
    const count = data.readUInt32LE(offset);
    let at: number | null = offset + 4;
    // Each element takes at least no bytes, so the count is bounded by what
    // is left to read rather than trusted.
    if (count > data.length) return null;
    for (let i = 0; i < count; i++) {
      at = skipLayout(data, at, rest as Layout);
      if (at === null) return null;
    }
    return at;
  }
  if (offset >= data.length) return null;
  const variant = (rest as Layout[])[data.readUInt8(offset)];
  return variant ? skipLayout(data, offset + 1, variant) : null;
}

/** The least a route may pay out, as Jupiter's program enforces it. */
export function minimumAmountOut(
  quotedAmountOut: bigint,
  slippageBps: number,
): bigint {
  return (quotedAmountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

export interface BuildSwapParams {
  addresses: AccountAddresses;
  /** The above-limit policy. A swap always takes both signatures. */
  policy: PublicKey;
  /** Primary and approval. */
  signers: PublicKey[];
  /** Jupiter's `shared_accounts_route`, built for the vault. */
  route: TransactionInstruction;
  /**
   * Pay in native SOL: the amount is moved into the vault's wrapped SOL
   * account first, and that account is closed once the route has drawn on it.
   */
  wrapInput?: boolean;
  /**
   * Receive native SOL: the vault's wrapped SOL account is closed after the
   * route pays into it, which releases everything it holds to the vault.
   */
  unwrapOutput?: boolean;
  /**
   * Whoever funded the wrapped SOL account this swap closes. Closing hands
   * its rent to the vault, so without this every swap touching SOL would pay
   * the Consumer a token account's rent out of the fee payer's pocket.
   */
  refundRentTo?: PublicKey;
  allowedPrograms?: readonly PublicKey[];
}

/**
 * Builds the single instruction that swaps out of the vault through Jupiter.
 *
 * Throws on a route this package would not recognise when reading the message
 * back, so a swap that a signer is bound to refuse is never handed to one.
 */
export function buildSwap({
  addresses,
  policy,
  signers,
  route,
  wrapInput = false,
  unwrapOutput = false,
  refundRentTo,
  allowedPrograms = ABOVE_LIMIT_PROGRAM_ALLOWLIST,
}: BuildSwapParams): TransactionInstruction {
  if (signers.length < 2) {
    throw new Error(`a swap takes two signers, got ${signers.length}`);
  }
  const terms = assertVaultRoute(route, addresses.vault);
  if (refundRentTo && !wrapInput && !unwrapOutput) {
    throw new Error("a rent refund without a wrapped SOL account to close");
  }

  const wrappedSol = associatedTokenAddress(
    addresses.vault,
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ID,
  );
  const sourceMint = route.keys[JUPITER_ROUTE_ACCOUNTS.sourceMint]!.pubkey;
  const destinationMint =
    route.keys[JUPITER_ROUTE_ACCOUNTS.destinationMint]!.pubkey;
  if (wrapInput && !sourceMint.equals(WRAPPED_SOL_MINT)) {
    throw new Error("wrapping SOL for a route that does not spend it");
  }
  if (unwrapOutput && !destinationMint.equals(WRAPPED_SOL_MINT)) {
    throw new Error("unwrapping SOL from a route that does not pay it");
  }

  const inner: TransactionInstruction[] = [];
  if (wrapInput) {
    inner.push(
      SystemProgram.transfer({
        fromPubkey: addresses.vault,
        toPubkey: wrappedSol,
        lamports: terms.amountIn,
      }),
      syncNative(wrappedSol),
    );
  }
  inner.push(asVaultSigned(route, addresses.vault));
  if (wrapInput || unwrapOutput) {
    inner.push(closeAccount(wrappedSol, addresses.vault));
  }
  if (refundRentTo) {
    inner.push(
      SystemProgram.transfer({
        fromPubkey: addresses.vault,
        toPubkey: refundRentTo,
        lamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
      }),
    );
  }

  return underPolicy(inner, { addresses, policy, signers, allowedPrograms });
}

export interface BuildSwapOnAllowanceParams extends BuildSwapParams {
  /**
   * The signer that moves the tokens once the vault has allowed it to. One of
   * `signers`, so it is already signing the transaction.
   */
  delegate: PublicKey;
}

/**
 * Builds a swap for an Account whose policy does not admit Jupiter.
 *
 * The vault never calls Jupiter here. It lends `delegate` an allowance for
 * exactly the amount being swapped, which is a Token instruction every
 * Account's policy admits, and the route then runs beside the vault with the
 * delegate as its transfer authority. Both sides of the swap are still the
 * vault's own token accounts, and the three instructions travel in one
 * transaction, so the allowance cannot outlive a swap that fails.
 *
 * It needs no settings change, which is the point: adding a program to a
 * policy waits out the Settings time lock, and this does not.
 *
 * Returns the allowance, the route, and, when wrapped SOL is involved, the
 * instruction that closes the vault's wrapped SOL account afterwards.
 */
export function buildSwapOnAllowance({
  addresses,
  policy,
  signers,
  delegate,
  route,
  wrapInput = false,
  unwrapOutput = false,
  refundRentTo,
  allowedPrograms = ABOVE_LIMIT_PROGRAM_ALLOWLIST,
}: BuildSwapOnAllowanceParams): TransactionInstruction[] {
  if (signers.length < 2) {
    throw new Error(`a swap takes two signers, got ${signers.length}`);
  }
  if (!signers.some((signer) => signer.equals(delegate))) {
    throw new Error("the allowance goes to a key that is not signing the swap");
  }
  const terms = assertVaultRoute(route, addresses.vault);
  if (refundRentTo && !wrapInput && !unwrapOutput) {
    throw new Error("a rent refund without a wrapped SOL account to close");
  }

  const wrappedSol = associatedTokenAddress(
    addresses.vault,
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ID,
  );
  const source = route.keys[JUPITER_ROUTE_ACCOUNTS.source]!.pubkey;
  const sourceMint = route.keys[JUPITER_ROUTE_ACCOUNTS.sourceMint]!.pubkey;
  const destinationMint =
    route.keys[JUPITER_ROUTE_ACCOUNTS.destinationMint]!.pubkey;
  if (wrapInput && !sourceMint.equals(WRAPPED_SOL_MINT)) {
    throw new Error("wrapping SOL for a route that does not spend it");
  }
  if (unwrapOutput && !destinationMint.equals(WRAPPED_SOL_MINT)) {
    throw new Error("unwrapping SOL from a route that does not pay it");
  }
  const tokenProgram = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].find(
    (program) =>
      source.equals(
        associatedTokenAddress(addresses.vault, sourceMint, program),
      ),
  );
  if (!tokenProgram) {
    throw new Error("the route does not draw on the vault's token account");
  }

  const before: TransactionInstruction[] = [];
  if (wrapInput) {
    before.push(
      SystemProgram.transfer({
        fromPubkey: addresses.vault,
        toPubkey: wrappedSol,
        lamports: terms.amountIn,
      }),
      syncNative(wrappedSol),
    );
  }
  before.push(
    approve(source, delegate, addresses.vault, terms.amountIn, tokenProgram),
  );

  const after: TransactionInstruction[] = [];
  if (wrapInput || unwrapOutput) {
    after.push(closeAccount(wrappedSol, addresses.vault));
  }
  if (refundRentTo) {
    after.push(
      SystemProgram.transfer({
        fromPubkey: addresses.vault,
        toPubkey: refundRentTo,
        lamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
      }),
    );
  }

  const under = { addresses, policy, signers, allowedPrograms };
  return [
    underPolicy(before, under),
    withAuthority(route, delegate),
    ...(after.length > 0 ? [underPolicy(after, under)] : []),
  ];
}

/** The vault running `inner` under its above-limit policy. */
function underPolicy(
  inner: TransactionInstruction[],
  {
    addresses,
    policy,
    signers,
    allowedPrograms,
  }: {
    addresses: AccountAddresses;
    policy: PublicKey;
    signers: PublicKey[];
    allowedPrograms: readonly PublicKey[];
  },
): TransactionInstruction {
  const compiled = utils.instructionsToSynchronousTransactionDetails({
    vaultPda: addresses.vault,
    members: [],
    transaction_instructions: inner,
  });

  return instructions.executePolicyPayloadSync({
    policy,
    accountIndex: PRIMARY_ACCOUNT_INDEX,
    numSigners: signers.length,
    policyPayload: {
      __kind: "ProgramInteraction",
      fields: [
        {
          instructionConstraintIndices: Uint8Array.from(
            inner.map((ix) => constraintIndex(ix.programId, allowedPrograms)),
          ),
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
    instruction_accounts: [
      ...signers.map((pubkey) => ({
        pubkey,
        isSigner: true,
        isWritable: false,
      })),
      ...compiled.accounts,
    ],
  });
}

/**
 * Why a route that names the vault among a venue's accounts is refused. A
 * signature cannot be given to one account position and withheld from
 * another, so that venue would hold the vault's authority over everything it
 * is passed, not only the amount being swapped.
 */
export const VENUE_TAKES_VAULT_SIGNATURE =
  "the route hands the vault's signature to a venue";

/** Why a route through a venue this build cannot measure is refused. */
export const ROUTE_TERMS_UNREADABLE = "the route's terms could not be read";

function assertVaultRoute(
  route: TransactionInstruction,
  vault: PublicKey,
): JupiterRouteTerms {
  if (!route.programId.equals(JUPITER_PROGRAM_ID)) {
    throw new Error("the route is not a Jupiter instruction");
  }
  const terms = readJupiterRouteTerms(Buffer.from(route.data));
  if (!terms) {
    throw new Error(ROUTE_TERMS_UNREADABLE);
  }
  const authority = route.keys[JUPITER_ROUTE_ACCOUNTS.transferAuthority];
  if (
    route.keys.length < JUPITER_ROUTE_ACCOUNTS.fixedLength ||
    !authority?.pubkey.equals(vault)
  ) {
    throw new Error("the route was not built for this vault");
  }
  const elsewhere = route.keys.some(
    (key, i) =>
      key.pubkey.equals(vault) &&
      i !== JUPITER_ROUTE_ACCOUNTS.transferAuthority,
  );
  if (elsewhere) {
    throw new Error(VENUE_TAKES_VAULT_SIGNATURE);
  }
  return terms;
}

/**
 * Jupiter marks the authority read-only. The payload is compiled as a message
 * with no fee payer, and that compiler refuses one with no writable signer, so
 * the vault is marked writable the same way a transfer's authority is.
 */
function asVaultSigned(
  route: TransactionInstruction,
  vault: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: route.programId,
    data: route.data,
    keys: route.keys.map((key) =>
      key.pubkey.equals(vault)
        ? { pubkey: key.pubkey, isSigner: true, isWritable: true }
        : key,
    ),
  });
}

const TOKEN_APPROVE = 4;
const TOKEN_CLOSE_ACCOUNT = 9;
const TOKEN_SYNC_NATIVE = 17;

/** The route as Jupiter built it, with `authority` moving the tokens. */
function withAuthority(
  route: TransactionInstruction,
  authority: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: route.programId,
    data: route.data,
    keys: route.keys.map((key, i) =>
      i === JUPITER_ROUTE_ACCOUNTS.transferAuthority
        ? { pubkey: authority, isSigner: true, isWritable: false }
        : key,
    ),
  });
}

function approve(
  source: PublicKey,
  delegate: PublicKey,
  vault: PublicKey,
  amount: bigint,
  tokenProgram: PublicKey,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(TOKEN_APPROVE, 0);
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: delegate, isSigner: false, isWritable: false },
      // Writable for the reason `asVaultSigned` gives: the payload compiler
      // refuses a message with no writable signer.
      { pubkey: vault, isSigner: true, isWritable: true },
    ],
    data,
  });
}

function syncNative(account: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    data: Buffer.from([TOKEN_SYNC_NATIVE]),
  });
}

function closeAccount(
  account: PublicKey,
  vault: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: true, isWritable: true },
    ],
    data: Buffer.from([TOKEN_CLOSE_ACCOUNT]),
  });
}

function constraintIndex(
  programId: PublicKey,
  allowedPrograms: readonly PublicKey[],
): number {
  const index = allowedPrograms.findIndex((p) => p.equals(programId));
  if (index < 0) {
    throw new Error(
      `${programId.toBase58()} is not on the above-limit program allowlist`,
    );
  }
  return index;
}
