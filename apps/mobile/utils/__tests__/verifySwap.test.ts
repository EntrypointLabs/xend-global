import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  associatedTokenAddress,
  buildApproveSettingsChange,
  buildExecuteSettingsChange,
  buildRejectSettingsChange,
  buildRotateApprovalSigner,
  buildSpend,
  buildSwap,
  buildUpdateAboveLimitAllowlist,
  deriveAccountAddresses,
  derivePolicyAddress,
  describeTransaction,
  JUPITER_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
  type StagedSettingsChange,
} from "@prydd/smart-account";

import {
  checkSwap,
  checkSwapAccess,
  type ExpectedSwap,
} from "@/utils/verifyTransaction";

const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const addresses = deriveAccountAddresses(11n);
const policy = derivePolicyAddress(addresses.settings, 2n);
const feePayer = Keypair.generate().publicKey;
const primary = Keypair.generate().publicKey;
const approval = Keypair.generate().publicKey;
const key = () => Keypair.generate().publicKey;
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

function compile(instructions: TransactionInstruction[]): string {
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: BLOCKHASH,
    instructions,
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    "base64"
  );
}

/** A `shared_accounts_route` shaped the way Jupiter's API returns one. */
function route(
  sourceMint: PublicKey,
  destinationMint: PublicKey,
  amountIn: bigint,
  quotedOut: bigint,
  slippageBps = 50
): TransactionInstruction {
  const tail = Buffer.alloc(19);
  tail.writeBigUInt64LE(amountIn, 0);
  tail.writeBigUInt64LE(quotedOut, 8);
  tail.writeUInt16LE(slippageBps, 16);
  const ata = (mint: PublicKey) =>
    associatedTokenAddress(addresses.vault, mint, TOKEN_PROGRAM_ID);
  const fixed: [PublicKey, boolean, boolean][] = [
    [TOKEN_PROGRAM_ID, false, false],
    [key(), false, false],
    [addresses.vault, true, false],
    [ata(sourceMint), false, true],
    [key(), false, true],
    [key(), false, true],
    [ata(destinationMint), false, true],
    [sourceMint, false, false],
    [destinationMint, false, false],
    [JUPITER_PROGRAM_ID, false, false],
    [JUPITER_PROGRAM_ID, false, false],
    [key(), false, false],
    [JUPITER_PROGRAM_ID, false, false],
    [key(), false, true],
  ];
  return new TransactionInstruction({
    programId: JUPITER_PROGRAM_ID,
    data: Buffer.concat([
      Buffer.from("c1209b3341d69c81", "hex"),
      Buffer.from([3, 1, 0, 0, 0, 7, 100, 0, 1]),
      tail,
    ]),
    keys: fixed.map(([pubkey, isSigner, isWritable]) => ({
      pubkey,
      isSigner,
      isWritable,
    })),
  });
}

const swap = (
  ix: TransactionInstruction,
  options: { unwrapOutput?: boolean; signers?: PublicKey[] } = {}
) =>
  compile([
    buildSwap({
      addresses,
      policy,
      signers: options.signers ?? [primary, approval],
      route: ix,
      unwrapOutput: options.unwrapOutput ?? true,
    }),
  ]);

const quoted: ExpectedSwap = {
  vault: addresses.vault.toBase58(),
  signers: [primary.toBase58(), approval.toBase58()],
  inputMint: USDC.toBase58(),
  outputMint: WRAPPED_SOL_MINT.toBase58(),
  amountInRaw: "100000000",
  quotedAmountOutRaw: "1440000000",
  slippageBps: 50,
};

const asQuoted = () =>
  route(USDC, WRAPPED_SOL_MINT, 100_000_000n, 1_440_000_000n);

describe("checkSwap", () => {
  it("accepts the swap that was priced on screen", () => {
    expect(checkSwap(swap(asQuoted()), quoted, [])).toBeNull();
  });

  it("refuses a swap at a worse price than the one shown", () => {
    const worse = route(USDC, WRAPPED_SOL_MINT, 100_000_000n, 1_000_000_000n);
    expect(checkSwap(swap(worse), quoted, [])).toBe("it is priced differently");
  });

  it("refuses a swap that may settle further below the price", () => {
    const loose = route(
      USDC,
      WRAPPED_SOL_MINT,
      100_000_000n,
      1_440_000_000n,
      5_000
    );
    expect(checkSwap(swap(loose), quoted, [])).toBe(
      "it allows a different shortfall"
    );
  });

  it("refuses a swap that pays more than was entered", () => {
    const more = route(USDC, WRAPPED_SOL_MINT, 900_000_000n, 1_440_000_000n);
    expect(checkSwap(swap(more), quoted, [])).toBe(
      "it pays a different amount"
    );
  });

  it("refuses a swap into another asset", () => {
    const other = route(USDC, key(), 100_000_000n, 1_440_000_000n);
    expect(checkSwap(swap(other, { unwrapOutput: false }), quoted, [])).toBe(
      "it buys a different currency"
    );
  });

  it("refuses SOL left wrapped when SOL is what was quoted", () => {
    expect(
      checkSwap(swap(asQuoted(), { unwrapOutput: false }), quoted, [])
    ).toBe("it buys a different currency");
  });

  it("refuses a swap counting a key that is not this account's", () => {
    expect(
      checkSwap(swap(asQuoted(), { signers: [primary, key()] }), quoted, [])
    ).toBe("it is signed for by keys that are not this account's");
  });

  it("refuses a payment dressed as a swap", () => {
    const payment = compile([
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 100_000_000n, destination: key() },
        route: { kind: "two-signature", reason: "no-spending-limit", policy },
        signers: [primary, approval],
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ]);
    expect(checkSwap(payment, quoted, [])).toBe("it is not a swap (spend)");
  });
});

describe("checkSwapAccess", () => {
  const account = {
    vault: addresses.vault.toBase58(),
    primary: primary.toBase58(),
    approval: approval.toBase58(),
  };
  const common = {
    addresses,
    aboveLimitSeed: 2n,
    proposer: primary,
    rentPayer: feePayer,
    transactionIndex: 8n,
  };
  const approvals = (signers: PublicKey[] = [primary, approval]) =>
    signers.map((signer) =>
      buildApproveSettingsChange({ addresses, transactionIndex: 8n, signer })
    );
  const staged = (
    over: Partial<Parameters<typeof buildUpdateAboveLimitAllowlist>[0]> = {}
  ) =>
    compile([
      ...buildUpdateAboveLimitAllowlist({
        ...common,
        primary,
        approval,
        ...over,
      }).propose,
      ...approvals(),
    ]);

  /** A change as this phone would read it back off the chain. */
  const stagedChange = (proposed = staged()): StagedSettingsChange => {
    const change = describeTransaction(proposed, { addresses });
    const vote = describeTransaction(compile(approvals()), { addresses });
    if (change.kind !== "settings" || vote.kind !== "vote") {
      throw new Error("the fixture is not a settings change");
    }
    return {
      settings: change.settings,
      proposal: vote.proposal,
      transactionIndex: change.transactionIndex,
      actions: change.actions,
    };
  };

  it("accepts the one rewrite Swap needs, approved by both keys", () => {
    expect(checkSwapAccess(staged(), account)).toBeNull();
  });

  it("accepts the execute that lands it a day later", () => {
    const execute = compile([
      buildExecuteSettingsChange({
        addresses,
        transactionIndex: 8n,
        signer: primary,
        rentPayer: feePayer,
        policies: [policy],
      }),
    ]);
    expect(checkSwapAccess(execute, account, stagedChange())).toBeNull();
  });

  it("refuses an approval of some other change waiting on the Account", () => {
    const rotationWaiting = stagedChange(
      compile(
        buildRotateApprovalSigner({
          ...common,
          primary,
          oldApproval: approval,
          newApproval: key(),
        }).propose
      )
    );
    expect(
      checkSwapAccess(compile(approvals()), account, rotationWaiting)
    ).toBe("it changes more than the spending rule Swap needs");
  });

  it("refuses the same rewrite aimed at the Spending Limit", () => {
    const aimedElsewhere = staged({ aboveLimitSeed: 1n });
    expect(checkSwapAccess(aimedElsewhere, account)).toBe(
      "it rewrites a different spending rule"
    );
    expect(
      checkSwapAccess(
        compile(approvals()),
        account,
        stagedChange(aimedElsewhere)
      )
    ).toBe("it rewrites a different spending rule");
  });

  it("refuses a rewrite that would make the spending rule expire", () => {
    const change = stagedChange();
    const [update] = change.actions;
    if (update?.kind !== "policy-update") throw new Error("not an update");
    const lapsing = {
      ...change,
      actions: [{ ...update, terms: { ...update.terms, expires: true } }],
    };
    expect(checkSwapAccess(compile(approvals()), account, lapsing)).toBe(
      "it makes the spending rule expire"
    );
  });

  it("refuses an approval of a change it could not read", () => {
    expect(checkSwapAccess(compile(approvals()), account)).toBe(
      "the change it approves could not be read"
    );
  });

  it("refuses a change read for a different proposal than the one voted on", () => {
    const other = { ...stagedChange(), proposal: key() };
    expect(checkSwapAccess(compile(approvals()), account, other)).toBe(
      "the change it approves could not be read"
    );
  });

  it("refuses a rule that admits a program this app does not know", () => {
    expect(
      checkSwapAccess(
        staged({ allowedPrograms: [...ABOVE_LIMIT_PROGRAM_ALLOWLIST, key()] }),
        account
      )
    ).toBe("it allows programs this app does not know");
  });

  it("refuses a rule that puts another key in the approval signer's place", () => {
    expect(checkSwapAccess(staged({ approval: key() }), account)).toBe(
      "it changes who can approve a payment"
    );
  });

  it("refuses a change that also moves a signer", () => {
    const rotation = compile([
      ...buildRotateApprovalSigner({
        ...common,
        primary,
        oldApproval: approval,
        newApproval: key(),
      }).propose,
      ...approvals(),
    ]);
    expect(checkSwapAccess(rotation, account)).toBe(
      "it changes more than the spending rule Swap needs"
    );
  });

  it("refuses a rejection passed off as a step", () => {
    const rejection = compile([
      buildRejectSettingsChange({
        addresses,
        transactionIndex: 8n,
        signer: primary,
      }),
    ]);
    expect(checkSwapAccess(rejection, account)).toBe(
      "it carries a vote that is not this account's"
    );
  });

  it("refuses a payment passed off as a step", () => {
    const payment = compile([
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 1n, destination: key() },
        route: { kind: "two-signature", reason: "no-spending-limit", policy },
        signers: [primary, approval],
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ]);
    expect(checkSwapAccess(payment, account)).toBe(
      "it is not a settings change (spend)"
    );
  });
});
