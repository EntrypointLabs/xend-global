import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  buildSwap,
  deriveAccountAddresses,
  derivePolicyAddress,
  describeTransaction,
  JUPITER_PROGRAM_ID,
  readJupiterRouteTerms,
  SYSTEM_PROGRAM_ID,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from "../src/index.js";

const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const addresses = deriveAccountAddresses(11n);
const { vault } = addresses;
const policy = derivePolicyAddress(addresses.settings, 2n);
const feePayer = Keypair.generate().publicKey;
const primary = Keypair.generate().publicKey;
const approval = Keypair.generate().publicKey;
const key = () => Keypair.generate().publicKey;
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const context = { addresses };

const ata = (mint: PublicKey, owner = vault) =>
  associatedTokenAddress(owner, mint, TOKEN_PROGRAM_ID);

interface RouteOverrides {
  authority?: PublicKey;
  source?: PublicKey;
  destination?: PublicKey;
  platformFeeAccount?: PublicKey;
  platformFeeBps?: number;
  remaining?: PublicKey[];
  discriminator?: string;
}

/** A `shared_accounts_route` shaped the way Jupiter's API returns one. */
function route(
  sourceMint: PublicKey,
  destinationMint: PublicKey,
  amountIn: bigint,
  quotedOut: bigint,
  overrides: RouteOverrides = {},
): TransactionInstruction {
  const tail = Buffer.alloc(19);
  tail.writeBigUInt64LE(amountIn, 0);
  tail.writeBigUInt64LE(quotedOut, 8);
  tail.writeUInt16LE(50, 16);
  tail.writeUInt8(overrides.platformFeeBps ?? 0, 18);
  const data = Buffer.concat([
    Buffer.from(overrides.discriminator ?? "c1209b3341d69c81", "hex"),
    // id, then a one-step route plan through a venue that takes no arguments.
    Buffer.from([3, 1, 0, 0, 0, 7, 100, 0, 1]),
    tail,
  ]);
  const fixed: [PublicKey, boolean, boolean][] = [
    [TOKEN_PROGRAM_ID, false, false],
    [key(), false, false],
    [overrides.authority ?? vault, true, false],
    [overrides.source ?? ata(sourceMint), false, true],
    [key(), false, true],
    [key(), false, true],
    [overrides.destination ?? ata(destinationMint), false, true],
    [sourceMint, false, false],
    [destinationMint, false, false],
    [overrides.platformFeeAccount ?? JUPITER_PROGRAM_ID, false, false],
    [JUPITER_PROGRAM_ID, false, false],
    [key(), false, false],
    [JUPITER_PROGRAM_ID, false, false],
  ];
  return new TransactionInstruction({
    programId: JUPITER_PROGRAM_ID,
    data,
    keys: [
      ...fixed.map(([pubkey, isSigner, isWritable]) => ({
        pubkey,
        isSigner,
        isWritable,
      })),
      ...(overrides.remaining ?? [key(), key()]).map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: true,
      })),
    ],
  });
}

function openAta(owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: feePayer, isSigner: true, isWritable: true },
      { pubkey: ata(mint, owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function compile(instructions: TransactionInstruction[]): string {
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: BLOCKHASH,
    instructions,
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    "base64",
  );
}

const signers = [primary, approval];
const swap = (
  params: Omit<
    Parameters<typeof buildSwap>[0],
    "addresses" | "policy" | "signers"
  >,
) => buildSwap({ addresses, policy, signers, ...params });

/**
 * Wraps arbitrary inner instructions the way a swap is wrapped, to stand in
 * for a backend that built something `buildSwap` never would.
 */
async function forge(inner: TransactionInstruction[]) {
  const { instructions, utils } = await import("@sqds/smart-account");
  const allow = (await import("../src/index.js")).ABOVE_LIMIT_PROGRAM_ALLOWLIST;
  const compiled = utils.instructionsToSynchronousTransactionDetails({
    vaultPda: vault,
    members: [],
    transaction_instructions: inner,
  });
  return instructions.executePolicyPayloadSync({
    policy,
    accountIndex: 0,
    numSigners: 2,
    policyPayload: {
      __kind: "ProgramInteraction",
      fields: [
        {
          instructionConstraintIndices: Uint8Array.from(
            inner.map((ix) => allow.findIndex((p) => p.equals(ix.programId))),
          ),
          transactionPayload: {
            __kind: "SyncTransaction",
            fields: [{ accountIndex: 0, instructions: compiled.instructions }],
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

const signable = (ix: TransactionInstruction) =>
  new TransactionInstruction({
    ...ix,
    keys: ix.keys.map((k) =>
      k.pubkey.equals(vault) ? { ...k, isSigner: true, isWritable: true } : k,
    ),
  });

describe("describing a swap", () => {
  it("reads a token for token swap", () => {
    const usdt = key();
    const described = describeTransaction(
      compile([
        openAta(vault, usdt),
        swap({ route: route(USDC, usdt, 100_000_000n, 99_900_000n) }),
      ]),
      context,
    );
    expect(described).toMatchObject({
      kind: "swap",
      amountIn: 100_000_000n,
      quotedAmountOut: 99_900_000n,
      slippageBps: 50,
      minimumAmountOut: 99_400_500n,
      refundsRent: false,
    });
    if (described.kind !== "swap") throw new Error("unreachable");
    expect(described.vault.equals(vault)).toBe(true);
    expect((described.inputMint as PublicKey).equals(USDC)).toBe(true);
    expect((described.outputMint as PublicKey).equals(usdt)).toBe(true);
    expect(described.signers.map(String)).toEqual(signers.map(String));
  });

  it("reads paying in SOL as SOL, not as its wrapped mint", () => {
    const described = describeTransaction(
      compile([
        openAta(vault, WRAPPED_SOL_MINT),
        swap({
          route: route(WRAPPED_SOL_MINT, USDC, 1_000_000_000n, 69_000_000n),
          wrapInput: true,
          refundRentTo: feePayer,
        }),
      ]),
      context,
    );
    expect(described).toMatchObject({
      kind: "swap",
      inputMint: "SOL",
      amountIn: 1_000_000_000n,
      refundsRent: true,
    });
  });

  it("reads receiving SOL as SOL", () => {
    const described = describeTransaction(
      compile([
        swap({
          route: route(USDC, WRAPPED_SOL_MINT, 100_000_000n, 1_440_000_000n),
          unwrapOutput: true,
        }),
      ]),
      context,
    );
    expect(described).toMatchObject({ kind: "swap", outputMint: "SOL" });
  });

  it("leaves wrapped SOL named as a token when nothing unwraps it", () => {
    const described = describeTransaction(
      compile([
        swap({ route: route(USDC, WRAPPED_SOL_MINT, 100_000_000n, 1n) }),
      ]),
      context,
    );
    expect(described.kind).toBe("swap");
    if (described.kind !== "swap") throw new Error("unreachable");
    expect(described.outputMint).not.toBe("SOL");
  });
});

describe("refusing a swap that is not the one a signer would be shown", () => {
  const refused = async (
    inner: TransactionInstruction[],
    extra: TransactionInstruction[] = [],
  ) => {
    const described = describeTransaction(
      compile([...extra, await forge(inner)]),
      context,
    );
    expect(described.kind).toBe("unknown");
    return described.kind === "unknown" ? described.reason : "";
  };
  const good = () => signable(route(USDC, WRAPPED_SOL_MINT, 100n, 90n));

  it("accepts the baseline these cases are built from", async () => {
    expect(
      describeTransaction(compile([await forge([good()])]), context).kind,
    ).toBe("swap");
  });

  it("refuses a route that pays into someone else's token account", async () => {
    const thief = key();
    expect(
      await refused([
        signable(
          route(USDC, WRAPPED_SOL_MINT, 100n, 90n, {
            destination: ata(WRAPPED_SOL_MINT, thief),
          }),
        ),
      ]),
    ).toMatch(/does not pay into the vault/);
  });

  it("refuses a route that draws on an account that is not the vault's", async () => {
    expect(
      await refused([
        signable(route(USDC, WRAPPED_SOL_MINT, 100n, 90n, { source: key() })),
      ]),
    ).toMatch(/does not draw on the vault/);
  });

  it("refuses a platform fee", async () => {
    expect(
      await refused([
        signable(
          route(USDC, WRAPPED_SOL_MINT, 100n, 90n, { platformFeeBps: 100 }),
        ),
      ]),
    ).toMatch(/fee to a third party/);
    expect(
      await refused([
        signable(
          route(USDC, WRAPPED_SOL_MINT, 100n, 90n, {
            platformFeeAccount: key(),
          }),
        ),
      ]),
    ).toMatch(/fee to a third party/);
  });

  it("refuses a Jupiter instruction other than the shared accounts route", async () => {
    expect(
      await refused([
        signable(
          route(USDC, WRAPPED_SOL_MINT, 100n, 90n, {
            discriminator: "e517cb977ae3ad2a",
          }),
        ),
      ]),
    ).toMatch(/cannot read/);
  });

  it("refuses a route that hands the vault's signature to a venue", async () => {
    expect(
      await refused([
        signable(
          route(USDC, WRAPPED_SOL_MINT, 100n, 90n, { remaining: [vault] }),
        ),
      ]),
    ).toMatch(/signature to a venue/);
  });

  it("accepts a venue paying straight into the vault's token account", async () => {
    const paid = signable(
      route(USDC, WRAPPED_SOL_MINT, 100n, 90n, {
        remaining: [ata(WRAPPED_SOL_MINT)],
      }),
    );
    expect(
      describeTransaction(compile([await forge([paid])]), context).kind,
    ).toBe("swap");
  });

  it("refuses a transfer out of the vault riding behind the swap", async () => {
    const transfer = SystemProgram.transfer({
      fromPubkey: vault,
      toPubkey: key(),
      lamports: 5_000_000_000n,
    });
    expect(await refused([good(), transfer])).toMatch(
      /other than unwrapping SOL/,
    );
  });

  it("refuses a refund larger than one token account's rent", async () => {
    const close = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: ata(WRAPPED_SOL_MINT), isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: true, isWritable: true },
      ],
      data: Buffer.from([9]),
    });
    const refund = SystemProgram.transfer({
      fromPubkey: vault,
      toPubkey: feePayer,
      lamports: TOKEN_ACCOUNT_RENT_LAMPORTS + 1n,
    });
    expect(await refused([good(), close, refund])).toMatch(/not a rent refund/);
  });

  it("refuses a rent refund to anyone but the fee payer", () => {
    const described = describeTransaction(
      compile([
        swap({
          route: route(USDC, WRAPPED_SOL_MINT, 100n, 90n),
          unwrapOutput: true,
          refundRentTo: key(),
        }),
      ]),
      context,
    );
    expect(described).toMatchObject({ kind: "unknown" });
  });

  it("refuses a token account opened for someone else", () => {
    const described = describeTransaction(
      compile([
        openAta(key(), USDC),
        swap({ route: route(USDC, WRAPPED_SOL_MINT, 100n, 90n) }),
      ]),
      context,
    );
    expect(described).toMatchObject({ kind: "unknown" });
  });

  it("refuses a swap out of another Account's vault", () => {
    const other = deriveAccountAddresses(12n);
    const described = describeTransaction(
      compile([
        buildSwap({
          addresses: other,
          policy: derivePolicyAddress(other.settings, 2n),
          signers,
          route: route(USDC, key(), 100n, 90n, {
            authority: other.vault,
            source: ata(USDC, other.vault),
          }),
        }),
      ]),
      context,
    );
    expect(described.kind).toBe("unknown");
  });

  it("refuses a swap travelling with a plain transfer", () => {
    const described = describeTransaction(
      compile([
        swap({ route: route(USDC, WRAPPED_SOL_MINT, 100n, 90n) }),
        SystemProgram.transfer({
          fromPubkey: feePayer,
          toPubkey: key(),
          lamports: 1,
        }),
      ]),
      context,
    );
    expect(described).toMatchObject({ kind: "unknown" });
  });
});

describe("building a swap", () => {
  it("will not wrap a route that hands the vault's signature to a venue", () => {
    expect(() =>
      swap({ route: route(USDC, key(), 100n, 90n, { remaining: [vault] }) }),
    ).toThrow(/signature to a venue/);
  });

  it("will not wrap a route that was built for another vault", () => {
    expect(() =>
      swap({ route: route(USDC, key(), 100n, 90n, { authority: key() }) }),
    ).toThrow(/not built for this vault/);
  });

  it("will not wrap SOL for a route that does not spend it", () => {
    expect(() =>
      swap({ route: route(USDC, key(), 100n, 90n), wrapInput: true }),
    ).toThrow(/does not spend it/);
  });

  it("needs both signers", () => {
    expect(() =>
      buildSwap({
        addresses,
        policy,
        signers: [primary],
        route: route(USDC, key(), 100n, 90n),
      }),
    ).toThrow(/two signers/);
  });
});

describe("reading what a route commits to", () => {
  const DISCRIMINATOR = Buffer.from("c1209b3341d69c81", "hex");
  const terms = (amountIn: bigint, quotedOut: bigint, slippageBps: number) => {
    const tail = Buffer.alloc(19);
    tail.writeBigUInt64LE(amountIn, 0);
    tail.writeBigUInt64LE(quotedOut, 8);
    tail.writeUInt16LE(slippageBps, 16);
    return tail;
  };
  const plan = (...steps: number[][]) =>
    Buffer.from([3, steps.length, 0, 0, 0, ...steps.flat()]);
  // Raydium takes no arguments. WhirlpoolSwapV2 takes a direction and an
  // optional list of two-byte entries.
  const RAYDIUM = [7, 100, 0, 1];
  const WHIRLPOOL_V2 = 47;

  it("reads the terms that follow a multi-venue plan", () => {
    const data = Buffer.concat([
      DISCRIMINATOR,
      plan(
        [WHIRLPOOL_V2, 1, 1, 2, 0, 0, 0, 6, 3, 0, 1, 100, 0, 1],
        [WHIRLPOOL_V2, 0, 0, 100, 1, 2],
        RAYDIUM,
      ),
      terms(1_000n, 2_000n, 50),
    ]);
    expect(readJupiterRouteTerms(data)).toEqual({
      amountIn: 1_000n,
      quotedAmountOut: 2_000n,
      slippageBps: 50,
      platformFeeBps: 0,
    });
  });

  it("refuses terms appended after the ones the program will read", () => {
    const data = Buffer.concat([
      DISCRIMINATOR,
      plan(RAYDIUM),
      terms(1_000_000_000n, 1n, 9_999),
      terms(100n, 2_000n, 50),
    ]);
    expect(readJupiterRouteTerms(data)).toBeNull();
  });

  it("refuses a venue it cannot measure", () => {
    const data = Buffer.concat([
      DISCRIMINATOR,
      plan([250, 100, 0, 1]),
      terms(1_000n, 2_000n, 50),
    ]);
    expect(readJupiterRouteTerms(data)).toBeNull();
  });

  it("refuses a plan that claims more steps than it holds", () => {
    const data = Buffer.concat([
      DISCRIMINATOR,
      Buffer.from([3, 9, 0, 0, 0, ...RAYDIUM]),
      terms(1_000n, 2_000n, 50),
    ]);
    expect(readJupiterRouteTerms(data)).toBeNull();
  });

  it("refuses a list that claims more entries than the data holds", () => {
    const data = Buffer.concat([
      DISCRIMINATOR,
      plan([WHIRLPOOL_V2, 1, 1, 255, 255, 255, 255, 100, 0, 1]),
      terms(1_000n, 2_000n, 50),
    ]);
    expect(readJupiterRouteTerms(data)).toBeNull();
  });
});
