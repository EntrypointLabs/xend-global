import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  associatedTokenAddress,
  buildAddRecoverySigner,
  buildApproveSettingsChange,
  buildExecuteSettingsChange,
  buildProvisionAccount,
  buildRejectSettingsChange,
  buildRemoveRecoverySigner,
  buildRotateApprovalSigner,
  buildRotatePrimarySigner,
  buildRotateRecoverySigner,
  buildSpend,
  deriveAccountAddresses,
  derivePolicyAddress,
  deriveProposalAddress,
  describeTransaction,
  ROLE_PERMISSIONS,
  SETTINGS_TIME_LOCK_SECONDS,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  type SpendingLimit,
} from "../src/index.js";

const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const SOL = PublicKey.default;
const addresses = deriveAccountAddresses(11n);
const spendingLimitPolicy = derivePolicyAddress(addresses.settings, 1n);
const aboveLimitPolicy = derivePolicyAddress(addresses.settings, 2n);
const feePayer = Keypair.generate().publicKey;
const primary = Keypair.generate().publicKey;
const approval = Keypair.generate().publicKey;
const recovery = Keypair.generate().publicKey;
const key = () => Keypair.generate().publicKey;
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

const terms = {
  mint: USDC,
  maxPerUse: 100_000_000n,
  maxPerPeriod: 100_000_000n,
  period: "Daily" as const,
  destinations: [],
};

function compile(
  instructions: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[] = [],
): string {
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: BLOCKHASH,
    instructions,
  }).compileToV0Message(lookupTables);
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    "base64",
  );
}

const context = { addresses };

function openAta(owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: feePayer, isSigner: true, isWritable: true },
      {
        pubkey: associatedTokenAddress(owner, mint, TOKEN_PROGRAM_ID),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

describe("describeTransaction: spends", () => {
  const destination = key();

  it("reads a token spend under the spending limit", () => {
    const tx = compile([
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 2_500_000n, destination },
        route: { kind: "spending-limit", policy: spendingLimitPolicy },
        signers: [primary],
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ]);
    const described = describeTransaction(tx, context);
    expect(described).toMatchObject({
      kind: "spend",
      route: "spending-limit",
      amount: 2_500_000n,
      decimals: 6,
      opensDestinationTokenAccount: false,
    });
    if (described.kind !== "spend") throw new Error("not a spend");
    expect(described.vault.equals(addresses.vault)).toBe(true);
    expect(described.destination?.equals(destination)).toBe(true);
    expect(
      described.destinationTokenAccount?.equals(
        associatedTokenAddress(destination, USDC, TOKEN_PROGRAM_ID),
      ),
    ).toBe(true);
    expect((described.mint as PublicKey).equals(USDC)).toBe(true);
    expect(described.signers.map((s) => s.toBase58())).toEqual([
      primary.toBase58(),
    ]);
  });

  it("reads a SOL spend under the spending limit", () => {
    const tx = compile([
      buildSpend({
        addresses,
        request: { mint: SOL, amount: 7n, destination },
        route: { kind: "spending-limit", policy: spendingLimitPolicy },
        signers: [primary],
        decimals: 9,
      }),
    ]);
    const described = describeTransaction(tx, context);
    expect(described).toMatchObject({
      kind: "spend",
      route: "spending-limit",
      mint: "SOL",
      amount: 7n,
    });
    if (described.kind !== "spend") throw new Error("not a spend");
    expect(described.destination?.equals(destination)).toBe(true);
  });

  it("reads a token spend above the limit, with the destination's account opened beside it", () => {
    const tx = compile([
      openAta(destination, USDC),
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 250_000_000n, destination },
        route: {
          kind: "two-signature",
          reason: "exceeds-per-use",
          policy: aboveLimitPolicy,
        },
        signers: [primary, approval],
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ]);
    const described = describeTransaction(tx, context);
    expect(described).toMatchObject({
      kind: "spend",
      route: "above-limit",
      amount: 250_000_000n,
      opensDestinationTokenAccount: true,
    });
    if (described.kind !== "spend") throw new Error("not a spend");
    expect(described.destination?.equals(destination)).toBe(true);
    expect(described.vault.equals(addresses.vault)).toBe(true);
    expect(described.signers).toHaveLength(2);
  });

  it("names the destination token account and no owner for an above-limit spend without an open", () => {
    const tx = compile([
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 250_000_000n, destination },
        route: {
          kind: "two-signature",
          reason: "exceeds-per-use",
          policy: aboveLimitPolicy,
        },
        signers: [primary, approval],
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ]);
    const described = describeTransaction(tx, context);
    if (described.kind !== "spend") throw new Error("not a spend");
    expect(described.destination).toBeNull();
    expect(
      described.destinationTokenAccount?.equals(
        associatedTokenAddress(destination, USDC, TOKEN_PROGRAM_ID),
      ),
    ).toBe(true);
  });

  it("reads a SOL spend above the limit", () => {
    const tx = compile([
      buildSpend({
        addresses,
        request: { mint: SOL, amount: 5_000_000_000n, destination },
        route: {
          kind: "two-signature",
          reason: "no-spending-limit",
          policy: aboveLimitPolicy,
        },
        signers: [primary, approval],
        decimals: 9,
      }),
    ]);
    const described = describeTransaction(tx, context);
    expect(described).toMatchObject({
      kind: "spend",
      route: "above-limit",
      mint: "SOL",
      amount: 5_000_000_000n,
    });
    if (described.kind !== "spend") throw new Error("not a spend");
    expect(described.destination?.equals(destination)).toBe(true);
  });

  it("labels the route by policy address when the context names the policies", () => {
    const tx = compile([
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 1n, destination },
        route: { kind: "spending-limit", policy: spendingLimitPolicy },
        signers: [primary],
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ]);
    expect(
      describeTransaction(tx, {
        addresses,
        spendingLimitPolicy,
        aboveLimitPolicy,
      }),
    ).toMatchObject({ kind: "spend", route: "spending-limit" });
  });

  it("labels a spend executed against the Settings as the settings route", () => {
    const tx = compile([
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 1n, destination },
        route: { kind: "spending-limit", policy: addresses.settings },
        signers: [primary],
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ]);
    expect(describeTransaction(tx, context)).toMatchObject({
      kind: "spend",
      route: "settings",
    });
  });

  it("refuses a spend that leaves a different vault", () => {
    const other = deriveAccountAddresses(12n);
    const tx = compile([
      buildSpend({
        addresses: other,
        request: { mint: USDC, amount: 1n, destination },
        route: { kind: "spending-limit", policy: spendingLimitPolicy },
        signers: [primary],
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ]);
    expect(describeTransaction(tx, context)).toMatchObject({
      kind: "unknown",
      reason: expect.stringContaining("other than this one"),
    });
  });

  it("is unknown when a foreign instruction rides with a valid spend", () => {
    const foreign = new TransactionInstruction({
      programId: key(),
      keys: [],
      data: Buffer.from([1, 2, 3]),
    });
    const tx = compile([
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 1n, destination },
        route: { kind: "spending-limit", policy: spendingLimitPolicy },
        signers: [primary],
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
      foreign,
    ]);
    expect(describeTransaction(tx, context).kind).toBe("unknown");
  });

  it("is unknown when a second transfer rides with a valid spend", () => {
    const tx = compile([
      buildSpend({
        addresses,
        request: { mint: SOL, amount: 1n, destination },
        route: { kind: "spending-limit", policy: spendingLimitPolicy },
        signers: [primary],
        decimals: 9,
      }),
      SystemProgram.transfer({
        fromPubkey: feePayer,
        toPubkey: key(),
        lamports: 1,
      }),
    ]);
    expect(describeTransaction(tx, context).kind).toBe("unknown");
  });

  it("is unknown when the opened token account is not the one paid into", () => {
    const tx = compile([
      openAta(key(), USDC),
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 1n, destination },
        route: { kind: "spending-limit", policy: spendingLimitPolicy },
        signers: [primary],
        decimals: 6,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ]);
    expect(describeTransaction(tx, context).kind).toBe("unknown");
  });

  it("is unknown for a legacy message", () => {
    const legacy = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: BLOCKHASH,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: feePayer,
          toPubkey: key(),
          lamports: 1,
        }),
      ],
    }).compileToLegacyMessage();
    const tx = Buffer.from(
      new VersionedTransaction(legacy).serialize(),
    ).toString("base64");
    expect(describeTransaction(tx, context)).toMatchObject({ kind: "unknown" });
  });

  it("is unknown for garbage", () => {
    expect(describeTransaction("AA==", context).kind).toBe("unknown");
    expect(describeTransaction("not base64!", context).kind).toBe("unknown");
  });

  describe("address lookup tables", () => {
    const table = new AddressLookupTableAccount({
      key: key(),
      state: {
        deactivationSlot: BigInt("18446744073709551615"),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [destination, SYSTEM_PROGRAM_ID],
      },
    });
    const build = () =>
      compile(
        [
          buildSpend({
            addresses,
            request: { mint: SOL, amount: 3n, destination },
            route: { kind: "spending-limit", policy: spendingLimitPolicy },
            signers: [primary],
            decimals: 9,
          }),
        ],
        [table],
      );

    it("refuses a message whose lookups it cannot resolve", () => {
      const tx = build();
      expect(
        VersionedTransaction.deserialize(Buffer.from(tx, "base64")).message
          .addressTableLookups,
      ).toHaveLength(1);
      expect(describeTransaction(tx, context)).toMatchObject({
        kind: "unknown",
        reason: expect.stringContaining("lookup"),
      });
    });

    it("reads the spend once the table is supplied", () => {
      const described = describeTransaction(build(), {
        addresses,
        lookupTables: [table],
      });
      expect(described).toMatchObject({
        kind: "spend",
        amount: 3n,
        mint: "SOL",
      });
      if (described.kind !== "spend") throw new Error("not a spend");
      expect(described.destination?.equals(destination)).toBe(true);
    });
  });
});

describe("describeTransaction: settings changes", () => {
  it("reads provisioning in one transaction", () => {
    const { propose, policies } = buildProvisionAccount({
      addresses,
      spendingLimitSeed: 1n,
      aboveLimitSeed: 2n,
      terms,
      primary,
      approval,
      proposer: primary,
      rentPayer: feePayer,
      transactionIndex: 1n,
      timeLockSeconds: SETTINGS_TIME_LOCK_SECONDS,
    });
    const tx = compile([
      ...propose,
      buildApproveSettingsChange({
        addresses,
        transactionIndex: 1n,
        signer: primary,
      }),
      buildApproveSettingsChange({
        addresses,
        transactionIndex: 1n,
        signer: approval,
      }),
      buildExecuteSettingsChange({
        addresses,
        transactionIndex: 1n,
        signer: primary,
        rentPayer: feePayer,
        policies,
      }),
    ]);
    const described = describeTransaction(tx, context);
    expect(described).toMatchObject({ kind: "settings", transactionIndex: 1n });
    if (described.kind !== "settings") throw new Error("not a settings change");
    expect(described.settings.equals(addresses.settings)).toBe(true);
    expect(described.proposer.equals(primary)).toBe(true);
    expect(described.actions).toHaveLength(3);

    const [limit, above, lock] = described.actions;
    expect(limit).toMatchObject({
      kind: "policy-create",
      seed: 1n,
      terms: {
        kind: "spending-limit",
        maxPerUse: 100_000_000n,
        maxPerPeriod: 100_000_000n,
        period: "Daily",
        threshold: 1,
        timeLock: 0,
      },
    });
    if (
      limit?.kind !== "policy-create" ||
      limit.terms.kind !== "spending-limit"
    ) {
      throw new Error("not the spending limit");
    }
    expect(limit.policy.equals(spendingLimitPolicy)).toBe(true);
    expect((limit.terms.mint as PublicKey).equals(USDC)).toBe(true);
    expect(limit.terms.signers.map((s) => s.toBase58())).toEqual([
      primary.toBase58(),
    ]);

    expect(above).toMatchObject({
      kind: "policy-create",
      seed: 2n,
      terms: { kind: "program-interaction", threshold: 2, programOnly: true },
    });
    if (
      above?.kind !== "policy-create" ||
      above.terms.kind !== "program-interaction"
    ) {
      throw new Error("not the above-limit policy");
    }
    expect(above.policy.equals(aboveLimitPolicy)).toBe(true);
    expect(above.terms.allowedPrograms.map((p) => p.toBase58())).toEqual(
      ABOVE_LIMIT_PROGRAM_ALLOWLIST.map((p) => p.toBase58()),
    );
    expect(above.terms.signers.map((s) => s.toBase58())).toEqual([
      primary.toBase58(),
      approval.toBase58(),
    ]);

    expect(lock).toEqual({
      kind: "set-time-lock",
      seconds: SETTINGS_TIME_LOCK_SECONDS,
    });
    expect(described.votes.map((v) => v.kind)).toEqual([
      "approve",
      "approve",
      "execute",
    ]);
    expect(described.votes[1]?.signer.equals(approval)).toBe(true);
  });

  it("reads a recovery signer being added with vote-only permissions", () => {
    const newSigner = key();
    const tx = compile(
      buildAddRecoverySigner({
        addresses,
        newSigner,
        proposer: primary,
        rentPayer: feePayer,
        transactionIndex: 4n,
      }),
    );
    const described = describeTransaction(tx, context);
    expect(described).toMatchObject({
      kind: "settings",
      transactionIndex: 4n,
      votes: [],
    });
    if (described.kind !== "settings") throw new Error("not a settings change");
    expect(described.actions).toHaveLength(1);
    expect(described.actions[0]).toMatchObject({
      kind: "add-signer",
      permissions: ROLE_PERMISSIONS.recovery,
    });
    expect(
      (described.actions[0] as { key: PublicKey }).key.equals(newSigner),
    ).toBe(true);
  });

  it("reads a recovery signer being removed", () => {
    const tx = compile(
      buildRemoveRecoverySigner({
        addresses,
        oldSigner: recovery,
        recoverySigners: [recovery, key()],
        proposer: primary,
        rentPayer: feePayer,
        transactionIndex: 5n,
      }),
    );
    const described = describeTransaction(tx, context);
    if (described.kind !== "settings") throw new Error("not a settings change");
    expect(described.actions).toHaveLength(1);
    expect(described.actions[0]).toMatchObject({ kind: "remove-signer" });
    expect(
      (described.actions[0] as { key: PublicKey }).key.equals(recovery),
    ).toBe(true);
  });

  it("reads a recovery signer rotation as an add then a remove", () => {
    const newSigner = key();
    const tx = compile(
      buildRotateRecoverySigner({
        addresses,
        oldSigner: recovery,
        newSigner,
        proposer: primary,
        rentPayer: feePayer,
        transactionIndex: 6n,
      }),
    );
    const described = describeTransaction(tx, context);
    if (described.kind !== "settings") throw new Error("not a settings change");
    expect(described.actions.map((a) => a.kind)).toEqual([
      "add-signer",
      "remove-signer",
    ]);
    expect(
      (described.actions[0] as { key: PublicKey }).key.equals(newSigner),
    ).toBe(true);
    expect(
      (described.actions[1] as { key: PublicKey }).key.equals(recovery),
    ).toBe(true);
  });

  it("reads an approval signer rotation including the policy it rewrites", () => {
    const newApproval = key();
    const { propose } = buildRotateApprovalSigner({
      addresses,
      oldApproval: approval,
      newApproval,
      primary,
      aboveLimitSeed: 2n,
      proposer: primary,
      rentPayer: feePayer,
      transactionIndex: 7n,
    });
    const described = describeTransaction(compile(propose), context);
    if (described.kind !== "settings") throw new Error("not a settings change");
    expect(described.actions.map((a) => a.kind)).toEqual([
      "add-signer",
      "remove-signer",
      "policy-update",
    ]);
    expect(described.actions[0]).toMatchObject({
      permissions: ROLE_PERMISSIONS.approval,
    });
    expect(
      (described.actions[0] as { key: PublicKey }).key.equals(newApproval),
    ).toBe(true);
    expect(
      (described.actions[1] as { key: PublicKey }).key.equals(approval),
    ).toBe(true);
    const update = described.actions[2];
    if (
      update?.kind !== "policy-update" ||
      update.terms.kind !== "program-interaction"
    ) {
      throw new Error("not the above-limit update");
    }
    expect(update.policy.equals(aboveLimitPolicy)).toBe(true);
    expect(update.terms.signers.map((s) => s.toBase58())).toEqual([
      primary.toBase58(),
      newApproval.toBase58(),
    ]);
    expect(update.terms.threshold).toBe(2);
  });

  it("reads a primary signer rotation including both policies it rewrites", () => {
    const newPrimary = key();
    const currentLimit: SpendingLimit = {
      policy: spendingLimitPolicy,
      mint: USDC,
      maxPerUse: 100_000_000n,
      maxPerPeriod: 100_000_000n,
      remainingInPeriod: 40_000_000n,
      period: "Daily",
      destinations: [],
    };
    const { propose } = buildRotatePrimarySigner({
      addresses,
      oldPrimary: primary,
      newPrimary,
      approval,
      signers: [
        { key: primary, permissions: { mask: ROLE_PERMISSIONS.primary } },
        { key: approval, permissions: { mask: ROLE_PERMISSIONS.approval } },
        { key: recovery, permissions: { mask: ROLE_PERMISSIONS.recovery } },
      ],
      spendingLimitSeed: 1n,
      currentLimit,
      aboveLimitSeed: 2n,
      proposer: approval,
      rentPayer: feePayer,
      transactionIndex: 8n,
    });
    const described = describeTransaction(compile(propose), context);
    if (described.kind !== "settings") throw new Error("not a settings change");
    expect(described.proposer.equals(approval)).toBe(true);
    expect(described.actions.map((a) => a.kind)).toEqual([
      "add-signer",
      "remove-signer",
      "policy-update",
      "policy-update",
    ]);
    expect(
      (described.actions[0] as { key: PublicKey }).key.equals(newPrimary),
    ).toBe(true);
    expect(
      (described.actions[1] as { key: PublicKey }).key.equals(primary),
    ).toBe(true);
    const [, , limit, above] = described.actions;
    if (
      limit?.kind !== "policy-update" ||
      limit.terms.kind !== "spending-limit"
    ) {
      throw new Error("not the spending-limit update");
    }
    expect(limit.policy.equals(spendingLimitPolicy)).toBe(true);
    expect(limit.terms.maxPerUse).toBe(100_000_000n);
    expect(limit.terms.signers.map((s) => s.toBase58())).toEqual([
      newPrimary.toBase58(),
    ]);
    if (
      above?.kind !== "policy-update" ||
      above.terms.kind !== "program-interaction"
    ) {
      throw new Error("not the above-limit update");
    }
    expect(above.terms.signers.map((s) => s.toBase58())).toEqual([
      newPrimary.toBase58(),
      approval.toBase58(),
    ]);
  });

  it("refuses a change against a Settings that is not this Account's", () => {
    const other = deriveAccountAddresses(12n);
    const tx = compile(
      buildAddRecoverySigner({
        addresses: other,
        newSigner: key(),
        proposer: primary,
        rentPayer: feePayer,
        transactionIndex: 1n,
      }),
    );
    expect(describeTransaction(tx, context)).toMatchObject({
      kind: "unknown",
      reason: expect.stringMatching(/not this Account|does not belong/),
    });
  });

  it("refuses a proposal whose index disagrees with its change", () => {
    const [createTransaction] = buildAddRecoverySigner({
      addresses,
      newSigner: key(),
      proposer: primary,
      rentPayer: feePayer,
      transactionIndex: 1n,
    });
    const [, createProposal] = buildAddRecoverySigner({
      addresses,
      newSigner: key(),
      proposer: primary,
      rentPayer: feePayer,
      transactionIndex: 2n,
    });
    expect(
      describeTransaction(
        compile([createTransaction!, createProposal!]),
        context,
      ).kind,
    ).toBe("unknown");
  });

  it("is unknown when a spend rides with a settings change", () => {
    const tx = compile([
      ...buildAddRecoverySigner({
        addresses,
        newSigner: key(),
        proposer: primary,
        rentPayer: feePayer,
        transactionIndex: 1n,
      }),
      buildSpend({
        addresses,
        request: { mint: SOL, amount: 1n, destination: key() },
        route: { kind: "spending-limit", policy: spendingLimitPolicy },
        signers: [primary],
        decimals: 9,
      }),
    ]);
    expect(describeTransaction(tx, context).kind).toBe("unknown");
  });
});

describe("describeTransaction: votes", () => {
  it("reads a lone approval", () => {
    const tx = compile([
      buildApproveSettingsChange({
        addresses,
        transactionIndex: 3n,
        signer: approval,
      }),
    ]);
    const described = describeTransaction(tx, context);
    expect(described).toMatchObject({ kind: "vote" });
    if (described.kind !== "vote") throw new Error("not a vote");
    expect(described.settings.equals(addresses.settings)).toBe(true);
    expect(
      described.proposal.equals(deriveProposalAddress(addresses.settings, 3n)),
    ).toBe(true);
    expect(described.votes).toHaveLength(1);
    expect(described.votes[0]?.kind).toBe("approve");
    expect(described.votes[0]?.signer.equals(approval)).toBe(true);
  });

  it("reads a two-signer rejection", () => {
    const tx = compile([
      buildRejectSettingsChange({
        addresses,
        transactionIndex: 3n,
        signer: approval,
      }),
      buildRejectSettingsChange({
        addresses,
        transactionIndex: 3n,
        signer: primary,
      }),
    ]);
    const described = describeTransaction(tx, context);
    if (described.kind !== "vote") throw new Error("not a vote");
    expect(described.votes.map((v) => v.kind)).toEqual(["reject", "reject"]);
  });

  it("reads an execute", () => {
    const tx = compile([
      buildExecuteSettingsChange({
        addresses,
        transactionIndex: 3n,
        signer: primary,
        rentPayer: feePayer,
        policies: [aboveLimitPolicy],
      }),
    ]);
    const described = describeTransaction(tx, context);
    if (described.kind !== "vote") throw new Error("not a vote");
    expect(described.votes).toEqual([{ kind: "execute", signer: primary }]);
  });

  it("refuses votes on two different changes", () => {
    const tx = compile([
      buildApproveSettingsChange({
        addresses,
        transactionIndex: 3n,
        signer: approval,
      }),
      buildApproveSettingsChange({
        addresses,
        transactionIndex: 4n,
        signer: primary,
      }),
    ]);
    expect(describeTransaction(tx, context).kind).toBe("unknown");
  });

  it("refuses a vote on another Account", () => {
    const other = deriveAccountAddresses(12n);
    const tx = compile([
      buildApproveSettingsChange({
        addresses: other,
        transactionIndex: 3n,
        signer: approval,
      }),
    ]);
    expect(describeTransaction(tx, context).kind).toBe("unknown");
  });
});

describe("describeTransaction: plain transfers", () => {
  it("reads a SOL transfer signed by an ordinary key", () => {
    const from = key();
    const tx = compile([
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: addresses.vault,
        lamports: 42,
      }),
    ]);
    const described = describeTransaction(tx, context);
    expect(described).toMatchObject({
      kind: "transfer",
      mint: "SOL",
      amount: 42n,
    });
    if (described.kind !== "transfer") throw new Error("not a transfer");
    expect(described.source.equals(from)).toBe(true);
    expect(described.destination?.equals(addresses.vault)).toBe(true);
  });

  it("reads a TransferChecked with the destination account opened beside it", () => {
    const from = key();
    const data = Buffer.alloc(10);
    data.writeUInt8(12, 0);
    data.writeBigUInt64LE(9_000_000n, 1);
    data.writeUInt8(6, 9);
    const transfer = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        {
          pubkey: associatedTokenAddress(from, USDC, TOKEN_PROGRAM_ID),
          isSigner: false,
          isWritable: true,
        },
        { pubkey: USDC, isSigner: false, isWritable: false },
        {
          pubkey: associatedTokenAddress(
            addresses.vault,
            USDC,
            TOKEN_PROGRAM_ID,
          ),
          isSigner: false,
          isWritable: true,
        },
        { pubkey: from, isSigner: true, isWritable: false },
      ],
      data,
    });
    const described = describeTransaction(
      compile([openAta(addresses.vault, USDC), transfer]),
      context,
    );
    expect(described).toMatchObject({
      kind: "transfer",
      amount: 9_000_000n,
      opensDestinationTokenAccount: true,
    });
    if (described.kind !== "transfer") throw new Error("not a transfer");
    expect(described.destination?.equals(addresses.vault)).toBe(true);
    expect((described.mint as PublicKey).equals(USDC)).toBe(true);
  });
});
