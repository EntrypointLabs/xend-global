/*
 * Runs the real deployed Squads bytecode in LiteSVM.
 *
 * These are the assertions the design rests on, so they execute the actual program
 * rather than asserting on instruction shapes. Run
 * `node test/fixtures/fetch-program.mjs` once to populate the fixtures; without them
 * the suite skips rather than silently passing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { accounts, instructions, utils } from "@sqds/smart-account";
import { LiteSVM } from "litesvm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  associatedTokenAddress,
  buildAddRecoverySigner,
  buildApproveSettingsChange,
  buildCreateAboveLimitPolicy,
  buildCreateAccount,
  buildCreateSpendingLimitPolicy,
  buildExecuteSettingsChange,
  buildProvisionAccount,
  buildRejectSettingsChange,
  deriveProposalAddress,
  buildRemoveRecoverySigner,
  buildRotateApprovalSigner,
  buildSetTimeLock,
  buildSpend,
  derivePolicyAddress,
  resolveSpendRoute,
  type AccountAddresses,
  type SignerSet,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const PROGRAM_SO = join(FIXTURES, "program.so");
const PROGRAM_CONFIG = join(FIXTURES, "program-config.json");
const HAVE_FIXTURES = existsSync(PROGRAM_SO) && existsSync(PROGRAM_CONFIG);

const PROGRAM_ADDRESS = new PublicKey(
  "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG",
);
const SETTINGS_TIME_LOCK = 60;
const LIMIT_POLICY_SEED = 1n;
const ABOVE_LIMIT_POLICY_SEED = 2n;
const SOL = PublicKey.default;

interface Harness {
  svm: LiteSVM;
  addresses: AccountAddresses;
  policy: PublicKey;
  abovePolicy: PublicKey;
  primary: Keypair;
  approval: Keypair;
  recovery: Keypair;
}

const failed = (result: unknown): boolean =>
  typeof (result as { err?: unknown })?.err === "function";

function send(
  svm: LiteSVM,
  payer: Keypair,
  ixs: TransactionInstruction[],
  signers: Keypair[],
) {
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: svm.latestBlockhash(),
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign(signers);
  return svm.sendTransaction(tx);
}

function decode<T>(svm: LiteSVM, address: PublicKey, from: unknown): T {
  const account = svm.getAccount(address);
  if (!account) throw new Error(`no account at ${address.toBase58()}`);
  const parser = from as {
    fromAccountInfo: (info: unknown) => [T, number];
  };
  return parser.fromAccountInfo({
    ...account,
    data: Buffer.from(account.data),
  })[0];
}

function setUp({ timeLockSeconds = SETTINGS_TIME_LOCK } = {}): Harness {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM_ADDRESS, PROGRAM_SO);

  const raw = JSON.parse(readFileSync(PROGRAM_CONFIG, "utf8"));
  const programConfigPda = new PublicKey(raw.address);
  svm.setAccount(programConfigPda, {
    lamports: Number(raw.lamports),
    data: Buffer.from(raw.data, "base64"),
    owner: new PublicKey(raw.owner),
    executable: false,
    rentEpoch: 0,
  });

  const programConfig = decode<{
    treasury: PublicKey;
    smartAccountIndex: { toString(): string };
  }>(svm, programConfigPda, accounts.ProgramConfig);

  const primary = Keypair.generate();
  const approval = Keypair.generate();
  const recovery = Keypair.generate();
  for (const kp of [primary, approval, recovery]) {
    svm.airdrop(kp.publicKey, BigInt(50 * LAMPORTS_PER_SOL));
  }
  svm.airdrop(programConfig.treasury, BigInt(LAMPORTS_PER_SOL));

  const signers: SignerSet = [
    { role: "primary", address: primary.publicKey },
    { role: "approval", address: approval.publicKey },
    { role: "recovery", address: recovery.publicKey },
  ];
  const { instruction, addresses } = buildCreateAccount({
    signers,
    creator: primary.publicKey,
    treasury: programConfig.treasury,
    settingsSeed: BigInt(programConfig.smartAccountIndex.toString()) + 1n,
    timeLockSeconds,
  });
  if (failed(send(svm, primary, [instruction], [primary]))) {
    throw new Error("account creation failed while setting up the harness");
  }

  svm.airdrop(addresses.vault, BigInt(20 * LAMPORTS_PER_SOL));

  return {
    svm,
    addresses,
    policy: derivePolicyAddress(addresses.settings, LIMIT_POLICY_SEED),
    abovePolicy: derivePolicyAddress(
      addresses.settings,
      ABOVE_LIMIT_POLICY_SEED,
    ),
    primary,
    approval,
    recovery,
  };
}

function settingsOf(h: Harness) {
  return decode<{
    threshold: number;
    timeLock: number;
    signers: unknown[];
    settingsAuthority: PublicKey;
    transactionIndex: { toString(): string };
  }>(h.svm, h.addresses.settings, accounts.Settings);
}

/*
 * SPL Token state, written straight into the SVM.
 *
 * Setting the accounts is preferable to running InitializeMint and MintTo: it
 * fixes the starting balances exactly, so an assertion that a Spend moved
 * tokens cannot be satisfied by anything the setup did. It also keeps
 * `@solana/spl-token` out of the package, which is why `associatedTokenAddress`
 * derives its address by hand too.
 *
 * Layouts are the SPL Token ones: Mint is 82 bytes, Account is 165.
 */
const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_DECIMALS = 6;
const MINT_LEN = 82n;
const TOKEN_ACCOUNT_LEN = 165n;

function writeMint(svm: LiteSVM, mint: PublicKey, decimals: number) {
  const data = Buffer.alloc(Number(MINT_LEN));
  data.writeUInt32LE(0, 0); // mint_authority: None
  data.writeUInt8(decimals, 44);
  data.writeUInt8(1, 45); // is_initialized
  data.writeUInt32LE(0, 46); // freeze_authority: None
  svm.setAccount(mint, {
    lamports: Number(svm.minimumBalanceForRentExemption(MINT_LEN)),
    data,
    owner: TOKEN_PROGRAM,
    executable: false,
    rentEpoch: 0,
  });
}

function writeTokenAccount(
  svm: LiteSVM,
  address: PublicKey,
  {
    mint,
    owner,
    amount,
  }: { mint: PublicKey; owner: PublicKey; amount: bigint },
) {
  const data = Buffer.alloc(Number(TOKEN_ACCOUNT_LEN));
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt32LE(0, 72); // delegate: None
  data.writeUInt8(1, 108); // state: Initialized
  data.writeUInt32LE(0, 109); // is_native: None
  data.writeUInt32LE(0, 129); // close_authority: None
  svm.setAccount(address, {
    lamports: Number(svm.minimumBalanceForRentExemption(TOKEN_ACCOUNT_LEN)),
    data,
    owner: TOKEN_PROGRAM,
    executable: false,
    rentEpoch: 0,
  });
}

function tokenBalance(svm: LiteSVM, address: PublicKey): bigint | null {
  const account = svm.getAccount(address);
  if (!account) return null;
  return Buffer.from(account.data).readBigUInt64LE(64);
}

function spend(
  h: Harness,
  signers: PublicKey[],
  destination: PublicKey,
  amount: bigint,
): TransactionInstruction {
  return buildSpend({
    addresses: h.addresses,
    request: { mint: SOL, amount, destination },
    route: {
      kind: "two-signature",
      reason: "no-spending-limit",
      policy: h.abovePolicy,
    },
    signers,
    decimals: 9,
  });
}

/**
 * The same Spend routed through the Settings rather than the above-limit
 * policy. Only used to demonstrate what the policy route prevents.
 */
function spendViaSettings(
  h: Harness,
  signers: PublicKey[],
  destination: PublicKey,
  amount: bigint,
): TransactionInstruction {
  // Built against the SDK directly rather than through buildSpend, which no
  // longer offers this route. Kept so the two findings that ruled it out stay
  // demonstrated against the real program.
  const transfer = SystemProgram.transfer({
    fromPubkey: h.addresses.vault,
    toPubkey: destination,
    lamports: Number(amount),
  });
  const compiled = utils.instructionsToSynchronousTransactionDetails({
    vaultPda: h.addresses.vault,
    members: signers,
    transaction_instructions: [transfer],
  });
  return instructions.executeTransactionSync({
    settingsPda: h.addresses.settings,
    accountIndex: 0,
    numSigners: signers.length,
    instructions: compiled.instructions,
    instruction_accounts: compiled.accounts,
  });
}

/** Runs a settings change end to end: propose, two approvals, warp, execute. */
function applySettingsChange(
  h: Harness,
  propose: TransactionInstruction[],
  transactionIndex: bigint,
  policy: PublicKey,
) {
  expect(failed(send(h.svm, h.primary, propose, [h.primary]))).toBe(false);
  for (const signer of [h.primary, h.approval]) {
    const approve = buildApproveSettingsChange({
      addresses: h.addresses,
      transactionIndex,
      signer: signer.publicKey,
    });
    expect(failed(send(h.svm, signer, [approve], [signer]))).toBe(false);
  }
  const clock = h.svm.getClock();
  clock.unixTimestamp = clock.unixTimestamp + BigInt(SETTINGS_TIME_LOCK + 10);
  h.svm.setClock(clock);
  h.svm.expireBlockhash();
  return send(
    h.svm,
    h.primary,
    [
      buildExecuteSettingsChange({
        addresses: h.addresses,
        transactionIndex,
        signer: h.primary.publicKey,
        policies: [policy],
      }),
    ],
    [h.primary],
  );
}

describe.skipIf(!HAVE_FIXTURES)("against deployed bytecode", () => {
  let h: Harness;
  beforeAll(() => {
    h = setUp();
  });

  it("creates a 2-of-3 Account whose vault is separate from its settings", () => {
    const settings = settingsOf(h);
    expect(settings.threshold).toBe(2);
    expect(settings.signers).toHaveLength(3);
    expect(settings.timeLock).toBe(SETTINGS_TIME_LOCK);
    // Autonomous: no admin key can rewrite the signer set.
    expect(settings.settingsAuthority.equals(PublicKey.default)).toBe(true);
    expect(h.addresses.vault.equals(h.addresses.settings)).toBe(false);
  });

  it("creating a spending limit needs two approvals and waits out the time lock", () => {
    const transactionIndex =
      BigInt(settingsOf(h).transactionIndex.toString()) + 1n;
    const { policy, propose } = buildCreateSpendingLimitPolicy({
      addresses: h.addresses,
      policySeed: LIMIT_POLICY_SEED,
      terms: {
        mint: SOL,
        maxPerUse: BigInt(2 * LAMPORTS_PER_SOL),
        maxPerPeriod: BigInt(5 * LAMPORTS_PER_SOL),
        period: "Daily",
      },
      limitSigner: h.primary.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex,
    });
    expect(policy.equals(h.policy)).toBe(true);
    expect(
      failed(applySettingsChange(h, propose, transactionIndex, policy)),
    ).toBe(false);

    const created = decode<{
      threshold: number;
      timeLock: number;
      signers: unknown[];
    }>(h.svm, policy, accounts.Policy);
    // The policy carries its own consensus, not the Account's.
    expect(created.threshold).toBe(1);
    expect(created.signers).toHaveLength(1);
    expect(created.timeLock).toBe(0);
  });

  it("spends under the limit with one signature while the Account is time-locked", () => {
    const destination = Keypair.generate().publicKey;
    const amount = BigInt(LAMPORTS_PER_SOL);

    const route = resolveSpendRoute(
      { mint: SOL, amount, destination },
      [
        {
          policy: h.policy,
          mint: SOL,
          maxPerUse: BigInt(2 * LAMPORTS_PER_SOL),
          maxPerPeriod: BigInt(5 * LAMPORTS_PER_SOL),
          remainingInPeriod: BigInt(5 * LAMPORTS_PER_SOL),
          period: "Daily",
          destinations: [],
        },
      ],
      h.abovePolicy,
    );
    expect(route.kind).toBe("spending-limit");

    const instruction = buildSpend({
      addresses: h.addresses,
      request: { mint: SOL, amount, destination },
      route,
      signers: [h.primary.publicKey],
      decimals: 9,
    });

    expect(failed(send(h.svm, h.primary, [instruction], [h.primary]))).toBe(
      false,
    );
    expect(h.svm.getBalance(destination)).toBe(amount);
  });

  it("creates the above-limit policy that carries two-signature spends", () => {
    const transactionIndex =
      BigInt(settingsOf(h).transactionIndex.toString()) + 1n;
    const { policy, propose } = buildCreateAboveLimitPolicy({
      addresses: h.addresses,
      policySeed: ABOVE_LIMIT_POLICY_SEED,
      primary: h.primary.publicKey,
      approval: h.approval.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex,
    });
    expect(policy.equals(h.abovePolicy)).toBe(true);
    expect(
      failed(applySettingsChange(h, propose, transactionIndex, policy)),
    ).toBe(false);

    const created = decode<{
      threshold: number;
      timeLock: number;
      signers: unknown[];
    }>(h.svm, policy, accounts.Policy);
    expect(created.threshold).toBe(2);
    expect(created.signers).toHaveLength(2);
    // Zero, so Spends under it execute synchronously despite the Settings lock.
    expect(created.timeLock).toBe(0);
  });

  it("cannot spend through the Settings while it carries a time lock", () => {
    // Synchronous execution requires the consensus account's time lock to be
    // zero, so a time-locked Settings cannot carry Spends at all. This is why
    // the two-signature route runs under the above-limit policy instead.
    const destination = Keypair.generate().publicKey;
    const instruction = spendViaSettings(
      h,
      [h.primary.publicKey, h.approval.publicKey],
      destination,
      BigInt(3 * LAMPORTS_PER_SOL),
    );

    expect(
      failed(send(h.svm, h.primary, [instruction], [h.primary, h.approval])),
    ).toBe(true);
    // getBalance returns null for an account that was never created.
    expect(h.svm.getBalance(destination)).toBeNull();
  });

  it("lets the recovery signer help spend once the Settings time lock is lifted", () => {
    // Vote-only permissions do NOT keep a recovery signer away from funds. This is
    // the finding that made per-policy signer sets a requirement rather than an
    // optimisation, pinned here so a program change would surface as a failure.
    const open = setUp({ timeLockSeconds: 0 });
    const destination = Keypair.generate().publicKey;
    const instruction = spendViaSettings(
      open,
      [open.primary.publicKey, open.recovery.publicKey],
      destination,
      BigInt(LAMPORTS_PER_SOL),
    );

    expect(
      failed(
        send(
          open.svm,
          open.primary,
          [instruction],
          [open.primary, open.recovery],
        ),
      ),
    ).toBe(false);
    expect(open.svm.getBalance(destination)).toBe(BigInt(LAMPORTS_PER_SOL));
  });

  it("spends above the limit with two signatures while the Settings is time-locked", () => {
    // The whole point of routing through the above-limit policy. Through the
    // Settings this same Spend is rejected with TimeLockNotZero, which would
    // leave a correctly configured Account unable to spend above its limit at
    // all.
    const destination = Keypair.generate().publicKey;
    const instruction = spend(
      h,
      [h.primary.publicKey, h.approval.publicKey],
      destination,
      BigInt(3 * LAMPORTS_PER_SOL),
    );

    expect(
      failed(send(h.svm, h.primary, [instruction], [h.primary, h.approval])),
    ).toBe(false);
    expect(h.svm.getBalance(destination)).toBe(BigInt(3 * LAMPORTS_PER_SOL));
  });

  it("moves a token above the limit, not the SOL beside it", () => {
    // The route built a SystemProgram.transfer whatever the mint said, so an
    // above-limit USDC Spend moved lamports while the intent and the transfer
    // row both recorded a stablecoin. Asserting on both balances is the point:
    // the token has to move *and* the vault's SOL has to stay put.
    const mint = Keypair.generate().publicKey;
    const destination = Keypair.generate().publicKey;
    const vaultTokens = associatedTokenAddress(
      h.addresses.vault,
      mint,
      TOKEN_PROGRAM,
    );
    const destinationTokens = associatedTokenAddress(
      destination,
      mint,
      TOKEN_PROGRAM,
    );

    writeMint(h.svm, mint, TOKEN_DECIMALS);
    writeTokenAccount(h.svm, vaultTokens, {
      mint,
      owner: h.addresses.vault,
      amount: 20_000_000n,
    });
    // The recipient's account already exists: a policy will not open one
    // mid-Spend, so the caller opens it in the same transaction.
    writeTokenAccount(h.svm, destinationTokens, {
      mint,
      owner: destination,
      amount: 0n,
    });
    const vaultLamportsBefore = h.svm.getBalance(h.addresses.vault);

    const instruction = buildSpend({
      addresses: h.addresses,
      request: { mint, amount: 1_000_000n, destination },
      route: {
        kind: "two-signature",
        reason: "exceeds-per-use",
        policy: h.abovePolicy,
      },
      signers: [h.primary.publicKey, h.approval.publicKey],
      decimals: TOKEN_DECIMALS,
      tokenProgram: TOKEN_PROGRAM,
    });

    expect(
      failed(send(h.svm, h.primary, [instruction], [h.primary, h.approval])),
    ).toBe(false);
    expect(tokenBalance(h.svm, vaultTokens)).toBe(19_000_000n);
    expect(tokenBalance(h.svm, destinationTokens)).toBe(1_000_000n);
    expect(h.svm.getBalance(h.addresses.vault)).toBe(vaultLamportsBefore);
  });

  it("still needs both signatures to move a token", () => {
    // The mint changes what the payload carries, not who may authorise it.
    const mint = Keypair.generate().publicKey;
    const destination = Keypair.generate().publicKey;
    const vaultTokens = associatedTokenAddress(
      h.addresses.vault,
      mint,
      TOKEN_PROGRAM,
    );

    writeMint(h.svm, mint, TOKEN_DECIMALS);
    writeTokenAccount(h.svm, vaultTokens, {
      mint,
      owner: h.addresses.vault,
      amount: 20_000_000n,
    });
    writeTokenAccount(
      h.svm,
      associatedTokenAddress(destination, mint, TOKEN_PROGRAM),
      { mint, owner: destination, amount: 0n },
    );

    const instruction = buildSpend({
      addresses: h.addresses,
      request: { mint, amount: 1_000_000n, destination },
      route: {
        kind: "two-signature",
        reason: "exceeds-per-use",
        policy: h.abovePolicy,
      },
      signers: [h.primary.publicKey, h.recovery.publicKey],
      decimals: TOKEN_DECIMALS,
      tokenProgram: TOKEN_PROGRAM,
    });

    expect(
      failed(send(h.svm, h.primary, [instruction], [h.primary, h.recovery])),
    ).toBe(true);
    expect(tokenBalance(h.svm, vaultTokens)).toBe(20_000_000n);
  });

  it("keeps the recovery signer out of the above-limit route", () => {
    // The policy carries its own signer set of [primary, approval], which is
    // what actually keeps S3 away from funds. Permissions alone do not.
    const destination = Keypair.generate().publicKey;
    const instruction = spend(
      h,
      [h.primary.publicKey, h.recovery.publicKey],
      destination,
      BigInt(LAMPORTS_PER_SOL),
    );

    expect(
      failed(send(h.svm, h.primary, [instruction], [h.primary, h.recovery])),
    ).toBe(true);
    expect(h.svm.getBalance(destination)).toBeNull();
  });
});

/*
 * Provisioning order.
 *
 * Policies are created by a settings change, and a settings change waits out the
 * Settings time lock. An Account created with the 24-hour lock from D3 therefore
 * has no policies for 24 hours, and since every Spend executes under a policy,
 * it cannot spend at all during that window. Not "no one-tap for a day": no
 * money movement for a day, on a payments app, starting at signup.
 *
 * The way out is ordering: create at time lock 0, add both policies while
 * changes execute immediately, then raise the lock as the last change. These
 * assert that the order works and that the lock really is on afterwards.
 */
describe.skipIf(!HAVE_FIXTURES)("provisioning order", () => {
  const DAY = 24 * 60 * 60;

  function settingsOfOpen(h: Harness) {
    return decode<{
      timeLock: number;
      transactionIndex: { toString(): string };
    }>(h.svm, h.addresses.settings, accounts.Settings);
  }

  /** Executes a settings change on an Account whose time lock is 0. */
  function applyImmediately(
    h: Harness,
    propose: TransactionInstruction[],
    transactionIndex: bigint,
    policies: PublicKey[] = [],
  ) {
    expect(failed(send(h.svm, h.primary, propose, [h.primary]))).toBe(false);
    for (const signer of [h.primary, h.approval]) {
      const approve = buildApproveSettingsChange({
        addresses: h.addresses,
        transactionIndex,
        signer: signer.publicKey,
      });
      expect(failed(send(h.svm, signer, [approve], [signer]))).toBe(false);
    }
    h.svm.expireBlockhash();
    return send(
      h.svm,
      h.primary,
      [
        buildExecuteSettingsChange({
          addresses: h.addresses,
          transactionIndex,
          signer: h.primary.publicKey,
          policies,
        }),
      ],
      [h.primary],
    );
  }

  it("adds both policies and then raises the lock, with no waiting", () => {
    const h = setUp({ timeLockSeconds: 0 });

    const limitIndex =
      BigInt(settingsOfOpen(h).transactionIndex.toString()) + 1n;
    const { propose: proposeLimit } = buildCreateSpendingLimitPolicy({
      addresses: h.addresses,
      policySeed: LIMIT_POLICY_SEED,
      limitSigner: h.primary.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex: limitIndex,
      terms: {
        mint: SOL,
        maxPerUse: BigInt(2 * LAMPORTS_PER_SOL),
        maxPerPeriod: BigInt(5 * LAMPORTS_PER_SOL),
        period: "Daily",
        destinations: [],
      },
    });
    expect(
      failed(applyImmediately(h, proposeLimit, limitIndex, [h.policy])),
    ).toBe(false);

    const aboveIndex =
      BigInt(settingsOfOpen(h).transactionIndex.toString()) + 1n;
    const { propose: proposeAbove } = buildCreateAboveLimitPolicy({
      addresses: h.addresses,
      policySeed: ABOVE_LIMIT_POLICY_SEED,
      primary: h.primary.publicKey,
      approval: h.approval.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex: aboveIndex,
    });
    expect(
      failed(applyImmediately(h, proposeAbove, aboveIndex, [h.abovePolicy])),
    ).toBe(false);

    // Both policies exist before the Account is ever locked down.
    expect(h.svm.getAccount(h.policy)).not.toBeNull();
    expect(h.svm.getAccount(h.abovePolicy)).not.toBeNull();
    expect(settingsOfOpen(h).timeLock).toBe(0);

    // The lock goes on last. The lock in force while this executes is still
    // the old one, which is why it does not block itself.
    const lockIndex =
      BigInt(settingsOfOpen(h).transactionIndex.toString()) + 1n;
    expect(
      failed(
        applyImmediately(
          h,
          buildSetTimeLock({
            addresses: h.addresses,
            seconds: DAY,
            proposer: h.primary.publicKey,
            transactionIndex: lockIndex,
          }),
          lockIndex,
        ),
      ),
    ).toBe(false);
    expect(settingsOfOpen(h).timeLock).toBe(DAY);

    // And the Account can spend on both routes from its very first minute,
    // which is the whole point of the ordering.
    const underLimit = Keypair.generate().publicKey;
    const oneSig = buildSpend({
      addresses: h.addresses,
      request: {
        mint: SOL,
        amount: BigInt(LAMPORTS_PER_SOL),
        destination: underLimit,
      },
      route: { kind: "spending-limit", policy: h.policy },
      signers: [h.primary.publicKey],
      decimals: 9,
    });
    expect(failed(send(h.svm, h.primary, [oneSig], [h.primary]))).toBe(false);
    expect(h.svm.getBalance(underLimit)).toBe(BigInt(LAMPORTS_PER_SOL));

    const aboveLimit = Keypair.generate().publicKey;
    const twoSig = spend(
      h,
      [h.primary.publicKey, h.approval.publicKey],
      aboveLimit,
      BigInt(3 * LAMPORTS_PER_SOL),
    );
    expect(
      failed(send(h.svm, h.primary, [twoSig], [h.primary, h.approval])),
    ).toBe(false);
    expect(h.svm.getBalance(aboveLimit)).toBe(BigInt(3 * LAMPORTS_PER_SOL));
  });

  it("reaches the same state in one change carrying all three actions", () => {
    // Three changes cost three approval-signer prompts at signup. A settings
    // change takes a list of actions, so one change reaches the same state for
    // one prompt, and the lock is still zero while its own actions apply.
    const h = setUp({ timeLockSeconds: 0 });
    const transactionIndex =
      BigInt(settingsOfOpen(h).transactionIndex.toString()) + 1n;

    const { policies, propose } = buildProvisionAccount({
      addresses: h.addresses,
      spendingLimitSeed: LIMIT_POLICY_SEED,
      aboveLimitSeed: ABOVE_LIMIT_POLICY_SEED,
      terms: {
        mint: SOL,
        maxPerUse: BigInt(2 * LAMPORTS_PER_SOL),
        maxPerPeriod: BigInt(5 * LAMPORTS_PER_SOL),
        period: "Daily",
        destinations: [],
      },
      primary: h.primary.publicKey,
      approval: h.approval.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex,
      timeLockSeconds: DAY,
    });

    expect(policies.map((p) => p.toBase58())).toEqual([
      h.policy.toBase58(),
      h.abovePolicy.toBase58(),
    ]);
    expect(
      failed(applyImmediately(h, propose, transactionIndex, policies)),
    ).toBe(false);

    expect(h.svm.getAccount(h.policy)).not.toBeNull();
    expect(h.svm.getAccount(h.abovePolicy)).not.toBeNull();
    expect(settingsOfOpen(h).timeLock).toBe(DAY);
    // One index consumed rather than three.
    expect(BigInt(settingsOfOpen(h).transactionIndex.toString())).toBe(
      transactionIndex,
    );

    const underLimit = Keypair.generate().publicKey;
    const oneSig = buildSpend({
      addresses: h.addresses,
      request: {
        mint: SOL,
        amount: BigInt(LAMPORTS_PER_SOL),
        destination: underLimit,
      },
      route: { kind: "spending-limit", policy: h.policy },
      signers: [h.primary.publicKey],
      decimals: 9,
    });
    expect(failed(send(h.svm, h.primary, [oneSig], [h.primary]))).toBe(false);
    expect(h.svm.getBalance(underLimit)).toBe(BigInt(LAMPORTS_PER_SOL));

    const aboveLimit = Keypair.generate().publicKey;
    const twoSig = spend(
      h,
      [h.primary.publicKey, h.approval.publicKey],
      aboveLimit,
      BigInt(3 * LAMPORTS_PER_SOL),
    );
    expect(
      failed(send(h.svm, h.primary, [twoSig], [h.primary, h.approval])),
    ).toBe(false);
    expect(h.svm.getBalance(aboveLimit)).toBe(BigInt(3 * LAMPORTS_PER_SOL));
  });
});

describe.skipIf(!HAVE_FIXTURES)("recovery signer changes", () => {
  /**
   * Like `applySettingsChange`, but for a change that creates no policy.
   *
   * `buildExecuteSettingsChange` defaults `policies` to `[]`, and passing a
   * policy that the change never creates fails inside the program.
   */
  function applySignerChange(
    h: Harness,
    propose: TransactionInstruction[],
    transactionIndex: bigint,
    rentPayer?: Keypair,
  ) {
    // The rent payer signs the propose too: it funds the transaction and
    // proposal accounts, and the program marks it a signer on both.
    const proposeSigners =
      rentPayer && !rentPayer.publicKey.equals(h.primary.publicKey)
        ? [h.primary, rentPayer]
        : [h.primary];
    expect(failed(send(h.svm, h.primary, propose, proposeSigners))).toBe(false);
    for (const signer of [h.primary, h.approval]) {
      const approve = buildApproveSettingsChange({
        addresses: h.addresses,
        transactionIndex,
        signer: signer.publicKey,
      });
      expect(failed(send(h.svm, signer, [approve], [signer]))).toBe(false);
    }
    const clock = h.svm.getClock();
    clock.unixTimestamp = clock.unixTimestamp + BigInt(SETTINGS_TIME_LOCK + 10);
    h.svm.setClock(clock);
    h.svm.expireBlockhash();

    const execute = buildExecuteSettingsChange({
      addresses: h.addresses,
      transactionIndex,
      signer: h.primary.publicKey,
      rentPayer: rentPayer?.publicKey,
    });
    const signers = rentPayer ? [h.primary, rentPayer] : [h.primary];
    return send(h.svm, h.primary, [execute], signers);
  }

  const signerKeys = (h: Harness): string[] =>
    (settingsOf(h).signers as { key: PublicKey }[]).map((signer) =>
      signer.key.toBase58(),
    );

  it("adds a recovery signer to the signer set", () => {
    const h = setUp();
    const added = Keypair.generate();
    const before = settingsOf(h);
    const index = BigInt(before.transactionIndex.toString()) + 1n;

    const result = applySignerChange(
      h,
      buildAddRecoverySigner({
        addresses: h.addresses,
        newSigner: added.publicKey,
        proposer: h.primary.publicKey,
        rentPayer: h.primary.publicKey,
        transactionIndex: index,
      }),
      index,
      h.primary,
    );

    expect(failed(result)).toBe(false);
    expect(signerKeys(h)).toContain(added.publicKey.toBase58());
    expect(signerKeys(h)).toHaveLength(4);
  });

  it("grants an added signer the recovery mask and nothing more", () => {
    const h = setUp();
    const added = Keypair.generate();
    const index = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;

    applySignerChange(
      h,
      buildAddRecoverySigner({
        addresses: h.addresses,
        newSigner: added.publicKey,
        proposer: h.primary.publicKey,
        rentPayer: h.primary.publicKey,
        transactionIndex: index,
      }),
      index,
      h.primary,
    );

    // Vote alone, matching what account creation grants S3. A wider mask here
    // would let a key added later initiate or execute, which S3 cannot, and
    // the drift would be invisible until someone read the chain.
    const signers = settingsOf(h).signers as {
      key: PublicKey;
      permissions: { mask: number };
    }[];
    const existing = signers.find((signer) =>
      signer.key.equals(h.recovery.publicKey),
    );
    const fresh = signers.find((signer) => signer.key.equals(added.publicKey));
    expect(fresh?.permissions.mask).toBe(existing?.permissions.mask);
  });

  it("removes a recovery signer from the signer set", () => {
    const h = setUp();
    const added = Keypair.generate();

    const addIndex = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;
    applySignerChange(
      h,
      buildAddRecoverySigner({
        addresses: h.addresses,
        newSigner: added.publicKey,
        proposer: h.primary.publicKey,
        rentPayer: h.primary.publicKey,
        transactionIndex: addIndex,
      }),
      addIndex,
      h.primary,
    );
    expect(signerKeys(h)).toHaveLength(4);

    const removeIndex = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;
    const result = applySignerChange(
      h,
      buildRemoveRecoverySigner({
        addresses: h.addresses,
        oldSigner: added.publicKey,
        proposer: h.primary.publicKey,
        rentPayer: h.primary.publicKey,
        transactionIndex: removeIndex,
      }),
      removeIndex,
      h.primary,
    );

    expect(failed(result)).toBe(false);
    expect(signerKeys(h)).not.toContain(added.publicKey.toBase58());
    expect(signerKeys(h)).toHaveLength(3);
  });

  it("leaves the spend path untouched when the signer set changes", () => {
    const h = setUp();
    const added = Keypair.generate();

    // Both policies, in seed order. The program allocates policy seeds
    // sequentially, so seed 2 cannot be created before seed 1 exists.
    const limitIndex = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;
    const limit = buildCreateSpendingLimitPolicy({
      addresses: h.addresses,
      policySeed: LIMIT_POLICY_SEED,
      terms: {
        mint: SOL,
        maxPerUse: BigInt(2 * LAMPORTS_PER_SOL),
        maxPerPeriod: BigInt(5 * LAMPORTS_PER_SOL),
        period: "Daily",
      },
      limitSigner: h.primary.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex: limitIndex,
    });
    expect(
      failed(applySettingsChange(h, limit.propose, limitIndex, limit.policy)),
    ).toBe(false);

    const policyIndex = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;
    const { policy, propose } = buildCreateAboveLimitPolicy({
      addresses: h.addresses,
      policySeed: ABOVE_LIMIT_POLICY_SEED,
      primary: h.primary.publicKey,
      approval: h.approval.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex: policyIndex,
    });
    expect(failed(applySettingsChange(h, propose, policyIndex, policy))).toBe(
      false,
    );

    const index = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;

    applySignerChange(
      h,
      buildAddRecoverySigner({
        addresses: h.addresses,
        newSigner: added.publicKey,
        proposer: h.primary.publicKey,
        rentPayer: h.primary.publicKey,
        transactionIndex: index,
      }),
      index,
      h.primary,
    );

    // The reason no PolicyUpdate accompanies the change: policies carry their
    // own inline signer sets and the Settings account is never loaded on the
    // spend path, so a signer added here reaches no money.
    const created = decode<{ signers: { key: PublicKey }[] }>(
      h.svm,
      h.abovePolicy,
      accounts.Policy,
    );
    expect(
      created.signers.map((signer) => signer.key.toBase58()),
    ).not.toContain(added.publicKey.toBase58());
  });

  it("still lets the program strip the last recovery signer", () => {
    const h = setUp();
    const index = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;

    const result = applySignerChange(
      h,
      buildRemoveRecoverySigner({
        addresses: h.addresses,
        oldSigner: h.recovery.publicKey,
        proposer: h.primary.publicKey,
        rentPayer: h.primary.publicKey,
        transactionIndex: index,
      }),
      index,
      h.primary,
    );

    // Succeeds, and that is the point of the assertion. Two signers remain,
    // which satisfies the threshold, so the program has no objection to an
    // Account that can never recover a lost phone. `RecoveryService` is the
    // only thing standing between a Consumer and that state.
    expect(failed(result)).toBe(false);
    expect(signerKeys(h)).toHaveLength(2);
  });

  it("refuses to add a signer that is already in the set", () => {
    const h = setUp();
    const index = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;

    const result = applySignerChange(
      h,
      buildAddRecoverySigner({
        addresses: h.addresses,
        newSigner: h.recovery.publicKey,
        proposer: h.primary.publicKey,
        rentPayer: h.primary.publicKey,
        transactionIndex: index,
      }),
      index,
      h.primary,
    );

    // Rejected only here, at execute, after both approvals and the whole time
    // lock. The index is consumed and the wait is spent either way, which is
    // why the caller has to check the set before proposing.
    expect(failed(result)).toBe(true);
    expect(signerKeys(h)).toHaveLength(3);
  });

  it("charges the rent for a longer signer set to the rent payer", () => {
    const h = setUp();
    const added = Keypair.generate();
    const payer = Keypair.generate();
    h.svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const before = h.svm.getBalance(payer.publicKey) ?? 0n;
    const index = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;

    applySignerChange(
      h,
      buildAddRecoverySigner({
        addresses: h.addresses,
        newSigner: added.publicKey,
        proposer: h.primary.publicKey,
        rentPayer: payer.publicKey,
        transactionIndex: index,
      }),
      index,
      payer,
    );

    // Adding a signer reallocates the Settings account, so someone funds the
    // difference. Naming the payer is what keeps that off a Consumer who has
    // no lamports.
    expect(h.svm.getBalance(payer.publicKey) ?? 0n).toBeLessThan(before);
  });
});

describe.skipIf(!HAVE_FIXTURES)("rejecting a settings change", () => {
  /**
   * How many signers it takes to actually stop a change.
   *
   * The product promises the Consumer can refuse a settings change during the
   * time lock, and offers one button to do it. What the program requires is a
   * different question, and it is the only one that decides whether the promise
   * is kept, so it is asked here against the deployed bytecode rather than read
   * off the docs.
   */
  function proposalOf(h: Harness, transactionIndex: bigint) {
    return decode<{
      status: { __kind: string };
      approved: PublicKey[];
      rejected: PublicKey[];
    }>(
      h.svm,
      deriveProposalAddress(h.addresses.settings, transactionIndex),
      accounts.Proposal,
    );
  }

  /** Proposes a signer addition and leaves it open, unapproved. */
  function propose(h: Harness): bigint {
    const index = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;
    const ixs = buildAddRecoverySigner({
      addresses: h.addresses,
      newSigner: Keypair.generate().publicKey,
      proposer: h.primary.publicKey,
      rentPayer: h.primary.publicKey,
      transactionIndex: index,
    });
    expect(failed(send(h.svm, h.primary, ixs, [h.primary]))).toBe(false);
    return index;
  }

  function reject(h: Harness, signer: Keypair, transactionIndex: bigint) {
    return send(
      h.svm,
      signer,
      [
        buildRejectSettingsChange({
          addresses: h.addresses,
          transactionIndex,
          signer: signer.publicKey,
        }),
      ],
      [signer],
    );
  }

  it("records one signer's rejection but leaves the change open", () => {
    const h = setUp();
    const index = propose(h);

    expect(failed(reject(h, h.primary, index))).toBe(false);

    const proposal = proposalOf(h, index);
    expect(proposal.rejected.map((k) => k.toBase58())).toEqual([
      h.primary.publicKey.toBase58(),
    ]);
    // The point of the whole test. One signature is not a refusal: the change
    // is still live and still becomes executable if the remaining signers
    // approve it.
    expect(proposal.status.__kind).toBe("Active");
  });

  it("settles the change once a second signer rejects", () => {
    const h = setUp();
    const index = propose(h);

    expect(failed(reject(h, h.primary, index))).toBe(false);
    expect(failed(reject(h, h.approval, index))).toBe(false);

    expect(proposalOf(h, index).status.__kind).toBe("Rejected");
  });

  it("refuses a second rejection from the same signer", () => {
    const h = setUp();
    const index = propose(h);

    expect(failed(reject(h, h.primary, index))).toBe(false);
    // What the Consumer hits when they tap reject twice: the first vote stands
    // and the retry fails, so a UI that treats one tap as the whole refusal
    // reports an error for a change it has not actually stopped.
    expect(failed(reject(h, h.primary, index))).toBe(true);
  });

  it("rejecting after approving replaces the vote rather than adding one", () => {
    const h = setUp();
    const index = propose(h);

    expect(
      failed(
        send(
          h.svm,
          h.primary,
          [
            buildApproveSettingsChange({
              addresses: h.addresses,
              transactionIndex: index,
              signer: h.primary.publicKey,
            }),
          ],
          [h.primary],
        ),
      ),
    ).toBe(false);
    expect(failed(reject(h, h.primary, index))).toBe(false);

    const proposal = proposalOf(h, index);
    expect(proposal.approved).toHaveLength(0);
    expect(proposal.rejected.map((k) => k.toBase58())).toEqual([
      h.primary.publicKey.toBase58(),
    ]);
    expect(proposal.status.__kind).toBe("Active");
  });
});

describe.skipIf(!HAVE_FIXTURES)("approval signer rotation", () => {
  /**
   * The lost-phone recovery: S2 is gone, so the two approvals are S1 and S3.
   * The old approval key never participates, which is the whole point.
   */
  function rotateWithRecovery(
    h: Harness,
    newApproval: Keypair,
    transactionIndex: bigint,
  ) {
    const { propose, policies } = buildRotateApprovalSigner({
      addresses: h.addresses,
      oldApproval: h.approval.publicKey,
      newApproval: newApproval.publicKey,
      primary: h.primary.publicKey,
      aboveLimitSeed: ABOVE_LIMIT_POLICY_SEED,
      proposer: h.primary.publicKey,
      transactionIndex,
    });

    expect(failed(send(h.svm, h.primary, propose, [h.primary]))).toBe(false);
    for (const signer of [h.primary, h.recovery]) {
      expect(
        failed(
          send(
            h.svm,
            signer,
            [
              buildApproveSettingsChange({
                addresses: h.addresses,
                transactionIndex,
                signer: signer.publicKey,
              }),
            ],
            [signer],
          ),
        ),
      ).toBe(false);
    }

    const clock = h.svm.getClock();
    clock.unixTimestamp = clock.unixTimestamp + BigInt(SETTINGS_TIME_LOCK + 10);
    h.svm.setClock(clock);
    h.svm.expireBlockhash();

    return send(
      h.svm,
      h.primary,
      [
        buildExecuteSettingsChange({
          addresses: h.addresses,
          transactionIndex,
          signer: h.primary.publicKey,
          policies,
        }),
      ],
      [h.primary],
    );
  }

  /** An Account provisioned the way signup leaves it: both policies, lock on. */
  function provisioned(): Harness {
    const h = setUp({ timeLockSeconds: 0 });
    const index =
      BigInt(
        decode<{ transactionIndex: { toString(): string } }>(
          h.svm,
          h.addresses.settings,
          accounts.Settings,
        ).transactionIndex.toString(),
      ) + 1n;

    const { propose } = buildProvisionAccount({
      addresses: h.addresses,
      spendingLimitSeed: LIMIT_POLICY_SEED,
      aboveLimitSeed: ABOVE_LIMIT_POLICY_SEED,
      terms: {
        mint: SOL,
        maxPerUse: BigInt(2 * LAMPORTS_PER_SOL),
        maxPerPeriod: BigInt(5 * LAMPORTS_PER_SOL),
        period: "Daily",
        destinations: [],
      },
      primary: h.primary.publicKey,
      approval: h.approval.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex: index,
      timeLockSeconds: SETTINGS_TIME_LOCK,
    });

    expect(failed(send(h.svm, h.primary, propose, [h.primary]))).toBe(false);
    for (const signer of [h.primary, h.approval]) {
      expect(
        failed(
          send(
            h.svm,
            signer,
            [
              buildApproveSettingsChange({
                addresses: h.addresses,
                transactionIndex: index,
                signer: signer.publicKey,
              }),
            ],
            [signer],
          ),
        ),
      ).toBe(false);
    }
    h.svm.expireBlockhash();
    expect(
      failed(
        send(
          h.svm,
          h.primary,
          [
            buildExecuteSettingsChange({
              addresses: h.addresses,
              transactionIndex: index,
              signer: h.primary.publicKey,
              policies: [h.policy, h.abovePolicy],
            }),
          ],
          [h.primary],
        ),
      ),
    ).toBe(false);

    return h;
  }

  function nextIndex(h: Harness): bigint {
    return (
      BigInt(
        decode<{ transactionIndex: { toString(): string } }>(
          h.svm,
          h.addresses.settings,
          accounts.Settings,
        ).transactionIndex.toString(),
      ) + 1n
    );
  }

  it("swaps the signer set and the above-limit policy in one change", () => {
    const h = provisioned();
    const newApproval = Keypair.generate();
    h.svm.airdrop(newApproval.publicKey, BigInt(5 * LAMPORTS_PER_SOL));

    expect(failed(rotateWithRecovery(h, newApproval, nextIndex(h)))).toBe(
      false,
    );

    const settings = decode<{ signers: { key: PublicKey }[] }>(
      h.svm,
      h.addresses.settings,
      accounts.Settings,
    );
    const keys = settings.signers.map((s) => s.key.toBase58());
    expect(keys).toContain(newApproval.publicKey.toBase58());
    expect(keys).not.toContain(h.approval.publicKey.toBase58());
  });

  it("leaves the new phone able to make an above-limit spend", () => {
    const h = provisioned();
    const newApproval = Keypair.generate();
    h.svm.airdrop(newApproval.publicKey, BigInt(5 * LAMPORTS_PER_SOL));
    expect(failed(rotateWithRecovery(h, newApproval, nextIndex(h)))).toBe(
      false,
    );

    const destination = Keypair.generate().publicKey;
    const tx = spend(
      h,
      [h.primary.publicKey, newApproval.publicKey],
      destination,
      BigInt(3 * LAMPORTS_PER_SOL),
    );
    expect(failed(send(h.svm, h.primary, [tx], [h.primary, newApproval]))).toBe(
      false,
    );
    expect(h.svm.getBalance(destination)).toBe(BigInt(3 * LAMPORTS_PER_SOL));
  });

  it("leaves the old approval key unable to spend", () => {
    const h = provisioned();
    const newApproval = Keypair.generate();
    h.svm.airdrop(newApproval.publicKey, BigInt(5 * LAMPORTS_PER_SOL));
    expect(failed(rotateWithRecovery(h, newApproval, nextIndex(h)))).toBe(
      false,
    );

    const tx = spend(
      h,
      [h.primary.publicKey, h.approval.publicKey],
      Keypair.generate().publicKey,
      BigInt(3 * LAMPORTS_PER_SOL),
    );
    expect(failed(send(h.svm, h.primary, [tx], [h.primary, h.approval]))).toBe(
      true,
    );
  });

  it("leaves the one-signature route untouched", () => {
    const h = provisioned();
    const newApproval = Keypair.generate();
    h.svm.airdrop(newApproval.publicKey, BigInt(5 * LAMPORTS_PER_SOL));
    expect(failed(rotateWithRecovery(h, newApproval, nextIndex(h)))).toBe(
      false,
    );

    const destination = Keypair.generate().publicKey;
    const tx = buildSpend({
      addresses: h.addresses,
      request: {
        mint: SOL,
        amount: BigInt(LAMPORTS_PER_SOL),
        destination,
      },
      route: { kind: "spending-limit", policy: h.policy },
      signers: [h.primary.publicKey],
      decimals: 9,
    });
    expect(failed(send(h.svm, h.primary, [tx], [h.primary]))).toBe(false);
    expect(h.svm.getBalance(destination)).toBe(BigInt(LAMPORTS_PER_SOL));
  });
});
