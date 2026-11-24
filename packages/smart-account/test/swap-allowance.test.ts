/*
 * A swap on an allowance: the vault lends one of its signers the right to move
 * exactly the amount being swapped, and Jupiter runs beside the vault.
 *
 * The first half holds the shape to the same reading as a swap from inside
 * the vault. The second half is the part that matters: an allowance is a
 * single key being handed authority over the vault's tokens, so every way of
 * dressing one up as a swap has to be refused.
 */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { instructions, utils } from "@sqds/smart-account";
import { describe, expect, it } from "vitest";

import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  buildSwap,
  buildSwapOnAllowance,
  deriveAccountAddresses,
  derivePolicyAddress,
  describeTransaction,
  JUPITER_PROGRAM_ID,
  JUPITER_ROUTE_ACCOUNTS,
  SYSTEM_PROGRAM_ID,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from "../src/index.js";

const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDT = Keypair.generate().publicKey;
const addresses = deriveAccountAddresses(11n);
const { vault } = addresses;
const policy = derivePolicyAddress(addresses.settings, 2n);
const feePayer = Keypair.generate().publicKey;
const primary = Keypair.generate().publicKey;
const approval = Keypair.generate().publicKey;
const signers = [primary, approval];
const key = () => Keypair.generate().publicKey;
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const context = { addresses };
const BEFORE_JUPITER = ABOVE_LIMIT_PROGRAM_ALLOWLIST.filter(
  (program) => !program.equals(JUPITER_PROGRAM_ID),
);

const ata = (mint: PublicKey, owner = vault) =>
  associatedTokenAddress(owner, mint, TOKEN_PROGRAM_ID);
const wrappedSol = ata(WRAPPED_SOL_MINT);

interface RouteOverrides {
  authority?: PublicKey;
  source?: PublicKey;
  destination?: PublicKey;
  platformFeeBps?: number;
  remaining?: PublicKey[];
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
    Buffer.from("c1209b3341d69c81", "hex"),
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
    [JUPITER_PROGRAM_ID, false, false],
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

function openAta(mint: PublicKey, owner = vault): TransactionInstruction {
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

function compile(ixs: TransactionInstruction[]): string {
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: BLOCKHASH,
    instructions: ixs,
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    "base64",
  );
}

const onAllowance = (
  params: Omit<
    Parameters<typeof buildSwapOnAllowance>[0],
    "addresses" | "policy" | "signers" | "delegate" | "allowedPrograms"
  >,
) =>
  buildSwapOnAllowance({
    addresses,
    policy,
    signers,
    delegate: primary,
    allowedPrograms: BEFORE_JUPITER,
    ...params,
  });

/** The vault running anything at all under its policy, as a hostile backend could. */
function asVault(inner: TransactionInstruction[]): TransactionInstruction {
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
            inner.map((ix) =>
              BEFORE_JUPITER.findIndex((p) => p.equals(ix.programId)),
            ),
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

function approve(
  source: PublicKey,
  delegate: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(4, 0);
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: delegate, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: true, isWritable: true },
    ],
    data,
  });
}

const closeWrapped = (to = vault) =>
  new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: wrappedSol, isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: true, isWritable: true },
    ],
    data: Buffer.from([9]),
  });

const AMOUNT = 100_000_000n;
const beside = (overrides: RouteOverrides = {}, amount = AMOUNT) =>
  route(USDC, USDT, amount, 99_900_000n, { authority: primary, ...overrides });

const reasonFor = (ixs: TransactionInstruction[]): string => {
  const described = describeTransaction(compile(ixs), context);
  expect(described.kind).toBe("unknown");
  return described.kind === "unknown" ? described.reason : "";
};

describe("describing a swap on an allowance", () => {
  it("reads the same swap as the one from inside the vault", () => {
    const built = route(USDC, USDT, AMOUNT, 99_900_000n);
    const inside = describeTransaction(
      compile([
        openAta(USDT),
        buildSwap({ addresses, policy, signers, route: built }),
      ]),
      context,
    );
    const besideIt = describeTransaction(
      compile([openAta(USDT), ...onAllowance({ route: built })]),
      context,
    );

    expect(besideIt.kind).toBe("swap");
    // A signer shown either is shown the same thing, so the app's own check
    // of pair, amount and price needs to know nothing about which it got.
    expect(JSON.stringify(besideIt, stringify)).toBe(
      JSON.stringify(inside, stringify),
    );
  });

  it("is two instructions when no SOL is involved, and three when it is", () => {
    expect(onAllowance({ route: route(USDC, USDT, AMOUNT, 1n) })).toHaveLength(
      2,
    );
    expect(
      onAllowance({
        route: route(USDC, WRAPPED_SOL_MINT, AMOUNT, 1n),
        unwrapOutput: true,
      }),
    ).toHaveLength(3);
  });

  it("reads paying in SOL as SOL, with the rent refund", () => {
    const described = describeTransaction(
      compile([
        openAta(WRAPPED_SOL_MINT),
        ...onAllowance({
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
      compile(
        onAllowance({
          route: route(USDC, WRAPPED_SOL_MINT, AMOUNT, 1_440_000_000n),
          unwrapOutput: true,
        }),
      ),
      context,
    );
    expect(described).toMatchObject({ kind: "swap", outputMint: "SOL" });
  });

  it("names both of the Account's signers, whichever one holds the allowance", () => {
    const described = describeTransaction(
      compile(onAllowance({ route: route(USDC, USDT, AMOUNT, 1n) })),
      context,
    );
    if (described.kind !== "swap") throw new Error("not a swap");
    expect(described.signers.map(String)).toEqual(signers.map(String));
    expect(described.vault.equals(vault)).toBe(true);
  });
});

describe("building a swap on an allowance", () => {
  it("refuses an allowance for a key that is not signing", () => {
    expect(() =>
      buildSwapOnAllowance({
        addresses,
        policy,
        signers,
        delegate: key(),
        route: route(USDC, USDT, AMOUNT, 1n),
      }),
    ).toThrow(/not signing/);
  });

  it("refuses a route that was not built for this vault", () => {
    expect(() =>
      onAllowance({
        route: route(USDC, USDT, AMOUNT, 1n, { authority: key() }),
      }),
    ).toThrow(/not built for this vault/);
  });

  it("refuses a route that draws on someone else's token account", () => {
    expect(() =>
      onAllowance({
        route: route(USDC, USDT, AMOUNT, 1n, { source: ata(USDC, key()) }),
      }),
    ).toThrow(/vault's token account/);
  });

  it("puts the delegate where the vault was and nowhere else", () => {
    const [, routed] = onAllowance({ route: route(USDC, USDT, AMOUNT, 1n) });
    const at = JUPITER_ROUTE_ACCOUNTS.transferAuthority;
    expect(routed!.keys[at]!.pubkey.equals(primary)).toBe(true);
    expect(routed!.keys.some((k) => k.pubkey.equals(vault))).toBe(false);
  });
});

describe("refusing an allowance that is not a swap", () => {
  it("an allowance with no swap after it", () => {
    reasonFor([asVault([approve(ata(USDC), primary, AMOUNT)])]);
  });

  it("a route with no allowance before it", () => {
    reasonFor([beside()]);
  });

  it("a wrapped SOL account closed with no swap before it", () => {
    reasonFor([asVault([closeWrapped()])]);
  });

  it("an allowance for more than the swap pays", () => {
    expect(
      reasonFor([
        asVault([approve(ata(USDC), primary, AMOUNT + 1n)]),
        beside(),
      ]),
    ).toMatch(/not the amount/);
  });

  it("an allowance for less than the swap pays", () => {
    expect(
      reasonFor([
        asVault([approve(ata(USDC), primary, AMOUNT - 1n)]),
        beside(),
      ]),
    ).toMatch(/not the amount/);
  });

  it("an allowance to a key that is not signing the swap", () => {
    const stranger = key();
    expect(
      reasonFor([
        asVault([approve(ata(USDC), stranger, AMOUNT)]),
        beside({ authority: stranger }),
      ]),
    ).toMatch(/not signing/);
  });

  it("a route run by a key other than the one the vault allowed", () => {
    expect(
      reasonFor([
        asVault([approve(ata(USDC), primary, AMOUNT)]),
        beside({ authority: approval }),
      ]),
    ).toMatch(/not run by the key/);
  });

  it("an allowance over a token account the route does not draw on", () => {
    expect(
      reasonFor([asVault([approve(ata(USDT), primary, AMOUNT)]), beside()]),
    ).toMatch(/vault's token account/);
  });

  it("an allowance over a token account that is not the vault's own", () => {
    const elsewhere = key();
    expect(
      reasonFor([
        asVault([approve(elsewhere, primary, AMOUNT)]),
        beside({ source: elsewhere }),
      ]),
    ).toMatch(/vault's token account/);
  });

  it("a route that pays into someone else's token account", () => {
    expect(
      reasonFor([
        asVault([approve(ata(USDC), primary, AMOUNT)]),
        beside({ destination: ata(USDT, key()) }),
      ]),
    ).toMatch(/pay into the vault/);
  });

  it("a route that takes a fee for a third party", () => {
    expect(
      reasonFor([
        asVault([approve(ata(USDC), primary, AMOUNT)]),
        beside({ platformFeeBps: 50 }),
      ]),
    ).toMatch(/fee/);
  });

  it("a route that hands the delegate's signature to a venue", () => {
    expect(
      reasonFor([
        asVault([approve(ata(USDC), primary, AMOUNT)]),
        beside({ remaining: [primary, key()] }),
      ]),
    ).toMatch(/signature to a venue/);
  });

  it("a route that names the vault among its accounts", () => {
    expect(
      reasonFor([
        asVault([approve(ata(USDC), primary, AMOUNT)]),
        beside({ remaining: [vault, key()] }),
      ]),
    ).toMatch(/names the vault/);
  });

  it("the route placed before the allowance", () => {
    reasonFor([beside(), asVault([approve(ata(USDC), primary, AMOUNT)])]);
  });

  it("two allowances around one route", () => {
    reasonFor([
      asVault([approve(ata(USDC), primary, AMOUNT)]),
      asVault([approve(ata(USDT), primary, AMOUNT)]),
      beside(),
    ]);
  });

  it("a second allowance slipped in after the route", () => {
    reasonFor([
      asVault([approve(ata(USDC), primary, AMOUNT)]),
      beside(),
      asVault([approve(ata(USDT), primary, 1n)]),
    ]);
  });

  it("an allowance that rides with a transfer out of the vault", () => {
    reasonFor([
      asVault([
        SystemProgram.transfer({
          fromPubkey: vault,
          toPubkey: key(),
          lamports: 1_000_000n,
        }),
        approve(ata(USDC), primary, AMOUNT),
      ]),
      beside(),
    ]);
  });

  it("a swap on an allowance travelling with a transfer", () => {
    expect(
      reasonFor([
        asVault([approve(ata(USDC), primary, AMOUNT)]),
        beside(),
        SystemProgram.transfer({
          fromPubkey: primary,
          toPubkey: key(),
          lamports: 1n,
        }),
      ]),
    ).toMatch(/travelling with something else/);
  });

  it("wrapping more SOL than the allowance covers", () => {
    reasonFor([
      asVault([
        SystemProgram.transfer({
          fromPubkey: vault,
          toPubkey: wrappedSol,
          lamports: AMOUNT * 2n,
        }),
        new TransactionInstruction({
          programId: TOKEN_PROGRAM_ID,
          keys: [{ pubkey: wrappedSol, isSigner: false, isWritable: true }],
          data: Buffer.from([17]),
        }),
        approve(wrappedSol, primary, AMOUNT),
      ]),
      route(WRAPPED_SOL_MINT, USDC, AMOUNT, 1n, { authority: primary }),
      asVault([closeWrapped()]),
    ]);
  });

  it("wrapped SOL closed to someone other than the vault", () => {
    expect(
      reasonFor([
        asVault([approve(ata(USDC), primary, AMOUNT)]),
        route(USDC, WRAPPED_SOL_MINT, AMOUNT, 1n, { authority: primary }),
        asVault([closeWrapped(key())]),
      ]),
    ).toMatch(/closes something other/);
  });

  it("a rent refund to someone other than the fee payer", () => {
    expect(
      reasonFor([
        openAta(WRAPPED_SOL_MINT),
        asVault([approve(ata(USDC), primary, AMOUNT)]),
        route(USDC, WRAPPED_SOL_MINT, AMOUNT, 1n, { authority: primary }),
        asVault([
          closeWrapped(),
          SystemProgram.transfer({
            fromPubkey: vault,
            toPubkey: key(),
            lamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
          }),
        ]),
      ]),
    ).toMatch(/other than the fee payer/);
  });

  it("a refund larger than one token account's rent", () => {
    reasonFor([
      openAta(WRAPPED_SOL_MINT),
      asVault([approve(ata(USDC), primary, AMOUNT)]),
      route(USDC, WRAPPED_SOL_MINT, AMOUNT, 1n, { authority: primary }),
      asVault([
        closeWrapped(),
        SystemProgram.transfer({
          fromPubkey: vault,
          toPubkey: feePayer,
          lamports: TOKEN_ACCOUNT_RENT_LAMPORTS + 1n,
        }),
      ]),
    ]);
  });

  it("wrapped SOL closed after a swap that never touched it", () => {
    expect(
      reasonFor([
        asVault([approve(ata(USDC), primary, AMOUNT)]),
        beside(),
        asVault([closeWrapped()]),
      ]),
    ).toMatch(/wraps SOL/);
  });

  it("a swap out of another Account's vault", () => {
    const other = deriveAccountAddresses(12n);
    const described = describeTransaction(
      compile(onAllowance({ route: route(USDC, USDT, AMOUNT, 1n) })),
      { addresses: other },
    );
    expect(described.kind).toBe("unknown");
  });

  it("a token account opened for a stranger alongside the swap", () => {
    expect(
      reasonFor([
        openAta(USDT, key()),
        ...onAllowance({ route: route(USDC, USDT, AMOUNT, 1n) }),
      ]),
    ).toMatch(/opens a token account/);
  });
});

function stringify(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  return value;
}
