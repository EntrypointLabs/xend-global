import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  buildCreateSpendingLimitPolicy,
  buildProvisionAccount,
  buildRemoveSpendingLimit,
  buildRotateApprovalSigner,
  buildSpend,
  buildUpdateSpendingLimit,
  deriveAccountAddresses,
  derivePolicyAddress,
  SETTINGS_TIME_LOCK_SECONDS,
  TOKEN_PROGRAM_ID,
} from "@xend/smart-account";

import { checkSettings, checkSpend } from "@/utils/verifyTransaction";

const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const addresses = deriveAccountAddresses(11n);
const vault = addresses.vault.toBase58();
const spendingLimitPolicy = derivePolicyAddress(addresses.settings, 1n);
const feePayer = Keypair.generate().publicKey;
const primary = Keypair.generate().publicKey;
const approval = Keypair.generate().publicKey;
const destination = Keypair.generate().publicKey;
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

const terms = {
  mint: USDC,
  maxPerUse: 100_000_000n,
  maxPerPeriod: 100_000_000n,
  period: "Daily" as const,
  destinations: [],
};

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

function spend(amount: bigint, to: PublicKey = destination): string {
  return compile([
    buildSpend({
      addresses,
      request: { mint: USDC, amount, destination: to },
      route: { kind: "spending-limit", policy: spendingLimitPolicy },
      signers: [primary],
      decimals: 6,
      tokenProgram: TOKEN_PROGRAM_ID,
    }),
  ]);
}

const expectedSpend = {
  vault,
  destination: destination.toBase58(),
  mint: USDC.toBase58(),
  amountRaw: "2500000",
};

describe("checkSpend", () => {
  it("accepts the transfer the Consumer confirmed", () => {
    expect(checkSpend(spend(2_500_000n), expectedSpend)).toBeNull();
  });

  it("refuses a different amount", () => {
    expect(checkSpend(spend(9_000_000n), expectedSpend)).toBe(
      "it sends a different amount"
    );
  });

  it("refuses a different destination", () => {
    const elsewhere = Keypair.generate().publicKey;
    expect(checkSpend(spend(2_500_000n, elsewhere), expectedSpend)).toBe(
      "it pays someone else"
    );
  });

  it("refuses another Account's vault", () => {
    const other = deriveAccountAddresses(12n).vault.toBase58();
    expect(
      checkSpend(spend(2_500_000n), { ...expectedSpend, vault: other })
    ).not.toBeNull();
  });

  it("refuses a settings change offered as a payment", () => {
    const { propose } = buildProvisionAccount({
      addresses,
      spendingLimitSeed: 1n,
      aboveLimitSeed: 2n,
      terms,
      primary,
      approval,
      proposer: primary,
      transactionIndex: 1n,
      timeLockSeconds: SETTINGS_TIME_LOCK_SECONDS,
    });
    expect(checkSpend(compile(propose), expectedSpend)).toContain(
      "it is not a payment"
    );
  });

  it("refuses a message it cannot account for", () => {
    const stray = SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: destination,
      lamports: 1,
    });
    expect(checkSpend(compile([stray]), expectedSpend)).not.toBeNull();
  });
});

describe("checkSettings", () => {
  const provisioning = () =>
    compile(
      buildProvisionAccount({
        addresses,
        spendingLimitSeed: 1n,
        aboveLimitSeed: 2n,
        terms,
        primary,
        approval,
        proposer: primary,
        transactionIndex: 1n,
        timeLockSeconds: SETTINGS_TIME_LOCK_SECONDS,
      }).propose
    );

  it("accepts setting the Account up", () => {
    expect(
      checkSettings(provisioning(), {
        vault,
        policyCreates: 2,
        setTimeLockSeconds: SETTINGS_TIME_LOCK_SECONDS,
      })
    ).toBeNull();
  });

  it("refuses a different time lock than the one expected", () => {
    expect(
      checkSettings(provisioning(), {
        vault,
        policyCreates: 2,
        setTimeLockSeconds: 60,
      })
    ).toBe("it changes how long a change waits");
  });

  it("refuses spending rules a change did not ask for", () => {
    expect(
      checkSettings(provisioning(), {
        vault,
        setTimeLockSeconds: SETTINGS_TIME_LOCK_SECONDS,
      })
    ).toBe("it sets up a spending rule that was not part of this change");
  });

  it("accepts the device rotation it was told about", () => {
    const replacement = Keypair.generate().publicKey;
    const tx = compile(
      buildRotateApprovalSigner({
        addresses,
        oldApproval: approval,
        newApproval: replacement,
        primary,
        aboveLimitSeed: 2n,
        proposer: primary,
        transactionIndex: 2n,
      }).propose
    );
    expect(
      checkSettings(tx, {
        vault,
        addSigners: [replacement.toBase58()],
        removeSigners: [approval.toBase58()],
        policyUpdates: 1,
      })
    ).toBeNull();
  });

  it("refuses a rotation to a key the step did not name", () => {
    const attacker = Keypair.generate().publicKey;
    const tx = compile(
      buildRotateApprovalSigner({
        addresses,
        oldApproval: approval,
        newApproval: attacker,
        primary,
        aboveLimitSeed: 2n,
        proposer: primary,
        transactionIndex: 2n,
      }).propose
    );
    const named = Keypair.generate().publicKey;
    expect(
      checkSettings(tx, {
        vault,
        addSigners: [named.toBase58()],
        removeSigners: [approval.toBase58()],
        policyUpdates: 1,
      })
    ).toBe("it adds a key that was not part of this change");
  });

  it("refuses a signer change riding on an unnamed budget of zero", () => {
    const replacement = Keypair.generate().publicKey;
    const tx = compile(
      buildRotateApprovalSigner({
        addresses,
        oldApproval: approval,
        newApproval: replacement,
        primary,
        aboveLimitSeed: 2n,
        proposer: primary,
        transactionIndex: 2n,
      }).propose
    );
    expect(checkSettings(tx, { vault })).toBe(
      "it adds a key that was not part of this change"
    );
  });

  it("refuses a payment offered as a settings change", () => {
    expect(checkSettings(spend(2_500_000n), { vault })).toContain(
      "it is not a settings change"
    );
  });
});

describe("checkSettings on a Spending Limit change", () => {
  const signers = [
    { key: primary, permissions: { mask: 7 } },
    { key: approval, permissions: { mask: 7 } },
  ];
  const currentLimit = {
    policy: spendingLimitPolicy,
    mint: USDC,
    maxPerUse: 100_000_000n,
    maxPerPeriod: 100_000_000n,
    remainingInPeriod: 40_000_000n,
    period: "Daily" as const,
    destinations: [],
  };

  const update = () =>
    compile(
      buildUpdateSpendingLimit({
        addresses,
        spendingLimitSeed: 1n,
        currentLimit,
        terms: {
          ...terms,
          maxPerUse: 250_000_000n,
          maxPerPeriod: 250_000_000n,
        },
        limitSigner: primary,
        signers,
        proposer: primary,
        transactionIndex: 3n,
      }).propose
    );

  const removal = () =>
    compile(
      buildRemoveSpendingLimit({
        addresses,
        spendingLimitSeed: 1n,
        currentLimit,
        signers,
        proposer: primary,
        transactionIndex: 3n,
      }).propose
    );

  it("accepts a change that rewrites the one spending rule", () => {
    expect(checkSettings(update(), { vault, policyUpdates: 1 })).toBeNull();
  });

  it("accepts a removal the caller asked for", () => {
    expect(checkSettings(removal(), { vault, policyRemovals: 1 })).toBeNull();
  });

  const creation = () =>
    compile(
      buildCreateSpendingLimitPolicy({
        addresses,
        policySeed: 1n,
        terms,
        limitSigner: primary,
        proposer: primary,
        transactionIndex: 3n,
      }).propose
    );

  it("accepts setting up the one spending rule an Account had none of", () => {
    expect(checkSettings(creation(), { vault, policyCreates: 1 })).toBeNull();
  });

  it("refuses a creation offered as an amount change", () => {
    expect(checkSettings(creation(), { vault, policyUpdates: 1 })).toBe(
      "it sets up a spending rule that was not part of this change"
    );
  });

  it("refuses an amount change offered as a creation", () => {
    expect(checkSettings(update(), { vault, policyCreates: 1 })).toBe(
      "it rewrites a spending rule that was not part of this change"
    );
  });

  it("refuses a removal offered as an amount change", () => {
    // The budget a rewrite gets does not pay for taking a rule away, which is
    // the difference between a lower limit and no limit at all.
    expect(checkSettings(removal(), { vault, policyUpdates: 1 })).toBe(
      "it takes away a spending rule that was not part of this change"
    );
  });

  it("refuses a rewrite offered as a removal", () => {
    expect(checkSettings(update(), { vault, policyRemovals: 1 })).toBe(
      "it rewrites a spending rule that was not part of this change"
    );
  });

  it("refuses a removal the caller did not ask for at all", () => {
    expect(checkSettings(removal(), { vault })).not.toBeNull();
  });

  it("refuses an approval step for another Account", () => {
    const other = deriveAccountAddresses(12n).vault.toBase58();
    expect(
      checkSettings(update(), { vault: other, policyUpdates: 1 })
    ).not.toBeNull();
  });
});
