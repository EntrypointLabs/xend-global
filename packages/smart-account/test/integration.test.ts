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
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { accounts, instructions, utils } from "@sqds/smart-account";
import { LiteSVM } from "litesvm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
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
  buildRemoveSpendingLimit,
  buildRotateApprovalSigner,
  buildRotatePrimarySigner,
  buildRotateRecoverySigner,
  buildSetTimeLock,
  buildSpend,
  buildUpdateSpendingLimit,
  decodeSpendingLimit,
  derivePolicyAddress,
  resolveSpendRoute,
  SettingsChangeRefusedError,
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
    /** The last seed the program assigned a policy. Null before the first. */
    policySeed: { toString(): string } | null;
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
        recoverySigners: [h.recovery.publicKey, added.publicKey],
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

    // Built against the SDK directly, because the builder refuses this. Kept
    // so the finding it guards against stays demonstrated on the real
    // program: two signers remain, which satisfies the threshold, so the
    // program has no objection to an Account that can never recover a lost
    // phone.
    const propose = [
      instructions.createSettingsTransaction({
        settingsPda: h.addresses.settings,
        transactionIndex: index,
        creator: h.primary.publicKey,
        rentPayer: h.primary.publicKey,
        actions: [{ __kind: "RemoveSigner", oldSigner: h.recovery.publicKey }],
      }),
      instructions.createProposal({
        settingsPda: h.addresses.settings,
        transactionIndex: index,
        creator: h.primary.publicKey,
        rentPayer: h.primary.publicKey,
      }),
    ];
    const result = applySignerChange(h, propose, index, h.primary);

    expect(failed(result)).toBe(false);
    expect(signerKeys(h)).toHaveLength(2);
  });

  it("refuses to build a removal of the only recovery signer", () => {
    const h = setUp();
    const index = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;

    expect(() =>
      buildRemoveRecoverySigner({
        addresses: h.addresses,
        oldSigner: h.recovery.publicKey,
        recoverySigners: [h.recovery.publicKey],
        proposer: h.primary.publicKey,
        rentPayer: h.primary.publicKey,
        transactionIndex: index,
      }),
    ).toThrow(SettingsChangeRefusedError);
    expect(signerKeys(h)).toHaveLength(3);
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

describe.skipIf(!HAVE_FIXTURES)("single-transaction provisioning", () => {
  /**
   * The whole provisioning change in one transaction: propose, both
   * approvals, execute. Legal precisely here because the Settings time lock
   * is still zero until this very change sets it, so there is nothing to
   * wait out between approval and execution.
   */
  function provisionInOne(
    h: Harness,
    index: bigint,
    {
      payer = h.primary,
      rentPayer,
    }: { payer?: Keypair; rentPayer?: Keypair } = {},
  ) {
    const { propose, policies } = buildProvisionAccount({
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
      rentPayer: rentPayer?.publicKey,
      transactionIndex: index,
      timeLockSeconds: SETTINGS_TIME_LOCK,
    });

    const signers = [h.primary, h.approval];
    if (rentPayer) signers.push(rentPayer);
    return send(
      h.svm,
      payer,
      [
        ...propose,
        buildApproveSettingsChange({
          addresses: h.addresses,
          transactionIndex: index,
          signer: h.primary.publicKey,
        }),
        buildApproveSettingsChange({
          addresses: h.addresses,
          transactionIndex: index,
          signer: h.approval.publicKey,
        }),
        buildExecuteSettingsChange({
          addresses: h.addresses,
          transactionIndex: index,
          signer: h.primary.publicKey,
          rentPayer: rentPayer?.publicKey,
          policies,
        }),
      ],
      signers,
    );
  }

  function expectProvisioned(h: Harness) {
    const settings = decode<{ timeLock: number }>(
      h.svm,
      h.addresses.settings,
      accounts.Settings,
    );
    expect(settings.timeLock).toBe(SETTINGS_TIME_LOCK);

    // Both policies exist and the everyday route works immediately.
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
  }

  it("proposes, approves twice and executes in one transaction", () => {
    const h = setUp({ timeLockSeconds: 0 });
    expect(failed(provisionInOne(h, nextIndex(h)))).toBe(false);
    expectProvisioned(h);
  });

  it("is refused once the Settings already carries a time lock", () => {
    // The same bundle against an Account that is already locked. Execute
    // comes before the lock has elapsed since approval, so the program
    // refuses it and the whole transaction rolls back: no policies, and the
    // lock as it was.
    const h = setUp({ timeLockSeconds: SETTINGS_TIME_LOCK });
    expect(failed(provisionInOne(h, nextIndex(h)))).toBe(true);

    const settings = decode<{
      timeLock: number;
      transactionIndex: { toString(): string };
    }>(h.svm, h.addresses.settings, accounts.Settings);
    expect(settings.timeLock).toBe(SETTINGS_TIME_LOCK);
    expect(settings.transactionIndex.toString()).toBe("0");
    expect(h.svm.getAccount(h.policy)).toBeNull();
    expect(h.svm.getAccount(h.abovePolicy)).toBeNull();
  });

  it("charges every account it creates to a rent payer that is not a signer", () => {
    // How the backend runs it: its own authority pays the fee and the rent
    // for the transaction, proposal and both policy accounts, and the
    // Consumer's primary signer authorises without holding a lamport.
    const h = setUp({ timeLockSeconds: 0 });
    const authority = Keypair.generate();
    h.svm.airdrop(authority.publicKey, BigInt(5 * LAMPORTS_PER_SOL));
    const primaryBefore = h.svm.getBalance(h.primary.publicKey);
    const authorityBefore = h.svm.getBalance(authority.publicKey);

    expect(
      failed(
        provisionInOne(h, nextIndex(h), {
          payer: authority,
          rentPayer: authority,
        }),
      ),
    ).toBe(false);

    expect(h.svm.getBalance(h.primary.publicKey)).toBe(primaryBefore);
    expect(h.svm.getBalance(authority.publicKey)).toBeLessThan(
      authorityBefore!,
    );
    expectProvisioned(h);
  });
});

/*
 * The above-limit policy lets a two-signature Spend call only the programs on
 * its allowlist. These pin that the allowlist is written to chain, that a
 * transfer through a listed program still executes, and that the program
 * refuses an instruction to anything else.
 */
describe.skipIf(!HAVE_FIXTURES)("above-limit program allowlist", () => {
  const FOREIGN_PROGRAM = new PublicKey(
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  );

  const errorLogs = (result: unknown): string =>
    (result as { meta(): { logs(): string[] } }).meta().logs().join("\n");

  /** A two-signature Spend whose inner instruction the builder would refuse. */
  function spendForeign(h: Harness, constraintIndex: number) {
    const inner = new TransactionInstruction({
      programId: FOREIGN_PROGRAM,
      keys: [{ pubkey: h.addresses.vault, isSigner: true, isWritable: true }],
      data: Buffer.from("hello"),
    });
    const compiled = utils.instructionsToSynchronousTransactionDetails({
      vaultPda: h.addresses.vault,
      members: [],
      transaction_instructions: [inner],
    });
    const signerAccounts = [h.primary, h.approval].map((kp) => ({
      pubkey: kp.publicKey,
      isSigner: true,
      isWritable: false,
    }));
    return instructions.executePolicyPayloadSync({
      policy: h.abovePolicy,
      accountIndex: 0,
      numSigners: 2,
      policyPayload: {
        __kind: "ProgramInteraction",
        fields: [
          {
            instructionConstraintIndices: Uint8Array.from([constraintIndex]),
            transactionPayload: {
              __kind: "SyncTransaction",
              fields: [
                { accountIndex: 0, instructions: compiled.instructions },
              ],
            },
          },
        ],
      },
      instruction_accounts: [...signerAccounts, ...compiled.accounts],
    });
  }

  it("writes one constraint per allowed program onto the policy", () => {
    const h = provisioned();
    const policy = decode<{
      policyState: {
        __kind: string;
        fields: [{ instructionsConstraints: { programId: PublicKey }[] }];
      };
    }>(h.svm, h.abovePolicy, accounts.Policy);

    expect(policy.policyState.__kind).toBe("ProgramInteraction");
    expect(
      policy.policyState.fields[0].instructionsConstraints.map((c) =>
        c.programId.toBase58(),
      ),
    ).toEqual(ABOVE_LIMIT_PROGRAM_ALLOWLIST.map((p) => p.toBase58()));
  });

  it("settles a transfer through an allowlisted program", () => {
    const h = provisioned();
    const destination = Keypair.generate().publicKey;
    const tx = spend(
      h,
      [h.primary.publicKey, h.approval.publicKey],
      destination,
      BigInt(3 * LAMPORTS_PER_SOL),
    );
    expect(failed(send(h.svm, h.primary, [tx], [h.primary, h.approval]))).toBe(
      false,
    );
    expect(h.svm.getBalance(destination)).toBe(BigInt(3 * LAMPORTS_PER_SOL));
  });

  it("refuses an instruction to a program outside the allowlist", () => {
    const h = provisioned();

    // Claiming the System constraint for a Memo instruction: the program
    // compares the constraint's program to the instruction's and stops.
    const mismatched = send(
      h.svm,
      h.primary,
      [spendForeign(h, 0)],
      [h.primary, h.approval],
    );
    expect(failed(mismatched)).toBe(true);
    expect(errorLogs(mismatched)).toContain(
      "ProgramInteractionProgramIdMismatch",
    );

    // Claiming a constraint the policy does not have.
    const outOfBounds = send(
      h.svm,
      h.primary,
      [spendForeign(h, ABOVE_LIMIT_PROGRAM_ALLOWLIST.length)],
      [h.primary, h.approval],
    );
    expect(failed(outOfBounds)).toBe(true);
    expect(errorLogs(outOfBounds)).toContain(
      "ProgramInteractionConstraintIndexOutOfBounds",
    );
  });
});

/** The spending limit as the chain holds it, the way a rotation must read it. */
function liveLimit(h: Harness) {
  const account = h.svm.getAccount(h.policy);
  if (!account) throw new Error("no spending-limit policy on the Account");
  return decodeSpendingLimit(h.policy, {
    ...account,
    data: Buffer.from(account.data),
  });
}

describe.skipIf(!HAVE_FIXTURES)("primary signer rotation", () => {
  /**
   * The lost-passkey recovery: S1 is gone, so the pair meeting the threshold
   * is the approval signer on the phone and the recovery signer in the vault.
   * The approval signer proposes and executes, which is what its Initiate and
   * Execute permissions exist for; the old primary never participates.
   */
  function rotatePrimary(
    h: Harness,
    newPrimary: Keypair,
    transactionIndex: bigint,
  ) {
    const { propose, policies } = buildRotatePrimarySigner({
      addresses: h.addresses,
      oldPrimary: h.primary.publicKey,
      newPrimary: newPrimary.publicKey,
      approval: h.approval.publicKey,
      signers: settingsOf(h).signers as {
        key: PublicKey;
        permissions: { mask: number };
      }[],
      spendingLimitSeed: LIMIT_POLICY_SEED,
      currentLimit: liveLimit(h),
      aboveLimitSeed: ABOVE_LIMIT_POLICY_SEED,
      proposer: h.approval.publicKey,
      transactionIndex,
    });

    expect(failed(send(h.svm, h.approval, propose, [h.approval]))).toBe(false);
    for (const signer of [h.approval, h.recovery]) {
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
      h.approval,
      [
        buildExecuteSettingsChange({
          addresses: h.addresses,
          transactionIndex,
          signer: h.approval.publicKey,
          policies,
        }),
      ],
      [h.approval],
    );
  }

  it("swaps the signer set without the old primary ever signing", () => {
    const h = provisioned();
    const newPrimary = Keypair.generate();
    h.svm.airdrop(newPrimary.publicKey, BigInt(5 * LAMPORTS_PER_SOL));

    expect(failed(rotatePrimary(h, newPrimary, nextIndex(h)))).toBe(false);

    const settings = decode<{ signers: { key: PublicKey }[] }>(
      h.svm,
      h.addresses.settings,
      accounts.Settings,
    );
    const keys = settings.signers.map((s) => s.key.toBase58());
    expect(keys).toContain(newPrimary.publicKey.toBase58());
    expect(keys).not.toContain(h.primary.publicKey.toBase58());
  });

  it("moves the one-signature route to the new primary and closes it to the old", () => {
    const h = provisioned();
    const newPrimary = Keypair.generate();
    h.svm.airdrop(newPrimary.publicKey, BigInt(5 * LAMPORTS_PER_SOL));
    expect(failed(rotatePrimary(h, newPrimary, nextIndex(h)))).toBe(false);

    const destination = Keypair.generate().publicKey;
    const fresh = buildSpend({
      addresses: h.addresses,
      request: {
        mint: SOL,
        amount: BigInt(LAMPORTS_PER_SOL),
        destination,
      },
      route: { kind: "spending-limit", policy: h.policy },
      signers: [newPrimary.publicKey],
      decimals: 9,
    });
    expect(failed(send(h.svm, newPrimary, [fresh], [newPrimary]))).toBe(false);
    expect(h.svm.getBalance(destination)).toBe(BigInt(LAMPORTS_PER_SOL));

    const stale = buildSpend({
      addresses: h.addresses,
      request: {
        mint: SOL,
        amount: BigInt(LAMPORTS_PER_SOL),
        destination: Keypair.generate().publicKey,
      },
      route: { kind: "spending-limit", policy: h.policy },
      signers: [h.primary.publicKey],
      decimals: 9,
    });
    expect(failed(send(h.svm, h.primary, [stale], [h.primary]))).toBe(true);
  });

  it("keeps the above-limit route working for the new pair only", () => {
    const h = provisioned();
    const newPrimary = Keypair.generate();
    h.svm.airdrop(newPrimary.publicKey, BigInt(5 * LAMPORTS_PER_SOL));
    expect(failed(rotatePrimary(h, newPrimary, nextIndex(h)))).toBe(false);

    const destination = Keypair.generate().publicKey;
    const fresh = spend(
      h,
      [newPrimary.publicKey, h.approval.publicKey],
      destination,
      BigInt(3 * LAMPORTS_PER_SOL),
    );
    expect(
      failed(send(h.svm, newPrimary, [fresh], [newPrimary, h.approval])),
    ).toBe(false);
    expect(h.svm.getBalance(destination)).toBe(BigInt(3 * LAMPORTS_PER_SOL));

    const stale = spend(
      h,
      [h.primary.publicKey, h.approval.publicKey],
      Keypair.generate().publicKey,
      BigInt(3 * LAMPORTS_PER_SOL),
    );
    expect(
      failed(send(h.svm, h.primary, [stale], [h.primary, h.approval])),
    ).toBe(true);
  });

  it("leaves the recovery signer in place and able to vote on the next change", () => {
    const h = provisioned();
    const newPrimary = Keypair.generate();
    h.svm.airdrop(newPrimary.publicKey, BigInt(5 * LAMPORTS_PER_SOL));
    expect(failed(rotatePrimary(h, newPrimary, nextIndex(h)))).toBe(false);

    const settings = decode<{ signers: { key: PublicKey }[] }>(
      h.svm,
      h.addresses.settings,
      accounts.Settings,
    );
    const keys = settings.signers.map((s) => s.key.toBase58());
    expect(keys).toContain(h.recovery.publicKey.toBase58());
  });
});

/*
 * A Merchant is paid into a token account Xend provisions for it, which is a
 * bare account rather than anybody's ATA. These pin the two facts Checkout
 * settlement rests on: the program accepts such an account, and it accepts it
 * on the route an everyday Payment actually takes.
 */
describe.skipIf(!HAVE_FIXTURES)(
  "paying a Merchant's settlement account",
  () => {
    const SETTLEMENT_AMOUNT = 1_000_000n;

    /** An Account whose spending limit is denominated in the token, not in SOL. */
    function withTokenLimit(): Harness & { mint: PublicKey } {
      const h = setUp({ timeLockSeconds: 0 });
      const mint = Keypair.generate().publicKey;
      writeMint(h.svm, mint, TOKEN_DECIMALS);

      // Both policies, the way a real Account is provisioned: the above-limit
      // route has no policy to execute under otherwise.
      const index = BigInt(settingsOf(h).transactionIndex.toString()) + 1n;
      const { propose } = buildProvisionAccount({
        addresses: h.addresses,
        spendingLimitSeed: LIMIT_POLICY_SEED,
        aboveLimitSeed: ABOVE_LIMIT_POLICY_SEED,
        terms: {
          mint,
          maxPerUse: 100_000_000n,
          maxPerPeriod: 100_000_000n,
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

      writeTokenAccount(
        h.svm,
        associatedTokenAddress(h.addresses.vault, mint, TOKEN_PROGRAM),
        { mint, owner: h.addresses.vault, amount: 20_000_000n },
      );
      return { ...h, mint };
    }

    /** The settlement account: owned by the authority, derived from nothing. */
    function settlementAccount(
      h: Harness & { mint: PublicKey },
      owner: PublicKey,
    ): PublicKey {
      const account = Keypair.generate().publicKey;
      writeTokenAccount(h.svm, account, {
        mint: h.mint,
        owner,
        amount: 0n,
      });
      return account;
    }

    it("settles under the limit on one signature", () => {
      const h = withTokenLimit();
      const authority = Keypair.generate().publicKey;
      const account = settlementAccount(h, authority);

      const instruction = buildSpend({
        addresses: h.addresses,
        request: {
          mint: h.mint,
          amount: SETTLEMENT_AMOUNT,
          destination: authority,
          destinationTokenAccount: account,
        },
        route: { kind: "spending-limit", policy: h.policy },
        signers: [h.primary.publicKey],
        decimals: TOKEN_DECIMALS,
        tokenProgram: TOKEN_PROGRAM,
      });

      expect(failed(send(h.svm, h.primary, [instruction], [h.primary]))).toBe(
        false,
      );
      expect(tokenBalance(h.svm, account)).toBe(SETTLEMENT_AMOUNT);
    });

    it("settles above the limit on two signatures", () => {
      const h = withTokenLimit();
      const authority = Keypair.generate().publicKey;
      const account = settlementAccount(h, authority);

      const instruction = buildSpend({
        addresses: h.addresses,
        request: {
          mint: h.mint,
          amount: SETTLEMENT_AMOUNT,
          destination: authority,
          destinationTokenAccount: account,
        },
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
      expect(tokenBalance(h.svm, account)).toBe(SETTLEMENT_AMOUNT);
    });

    it("refuses an account the named destination does not own", () => {
      // The destination is what a policy allowlist would be checked against, so
      // a token account belonging to someone else must not be reachable by
      // naming an allowed destination beside it.
      const h = withTokenLimit();
      const authority = Keypair.generate().publicKey;
      const stranger = Keypair.generate().publicKey;
      const account = settlementAccount(h, stranger);

      const instruction = buildSpend({
        addresses: h.addresses,
        request: {
          mint: h.mint,
          amount: SETTLEMENT_AMOUNT,
          destination: authority,
          destinationTokenAccount: account,
        },
        route: { kind: "spending-limit", policy: h.policy },
        signers: [h.primary.publicKey],
        decimals: TOKEN_DECIMALS,
        tokenProgram: TOKEN_PROGRAM,
      });

      expect(failed(send(h.svm, h.primary, [instruction], [h.primary]))).toBe(
        true,
      );
      expect(tokenBalance(h.svm, account)).toBe(0n);
    });
  },
);

describe.skipIf(!HAVE_FIXTURES)("recovery signer rotation", () => {
  /**
   * Changing the contact address. The Consumer holds both Active Keys, so the
   * two approvals are S1 and S2, and the recovery signer being retired never
   * votes: an attacker holding that inbox has nothing to add here.
   */
  function rotateRecovery(
    h: Harness,
    newRecovery: Keypair,
    transactionIndex: bigint,
  ) {
    const propose = buildRotateRecoverySigner({
      addresses: h.addresses,
      oldSigner: h.recovery.publicKey,
      newSigner: newRecovery.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex,
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
        }),
      ],
      [h.primary],
    );
  }

  const settingsSigners = (h: Harness) =>
    decode<{ signers: { key: PublicKey; permissions: { mask: number } }[] }>(
      h.svm,
      h.addresses.settings,
      accounts.Settings,
    ).signers;

  const policySigners = (h: Harness, policy: PublicKey): string[] =>
    decode<{ signers: { key: PublicKey }[] }>(
      h.svm,
      policy,
      accounts.Policy,
    ).signers.map((signer) => signer.key.toBase58());

  /** Proposes a harmless signer addition and returns its index, unapproved. */
  function openChange(h: Harness): bigint {
    const index = nextIndex(h);
    const ixs = buildAddRecoverySigner({
      addresses: h.addresses,
      newSigner: Keypair.generate().publicKey,
      proposer: h.primary.publicKey,
      transactionIndex: index,
    });
    expect(failed(send(h.svm, h.primary, ixs, [h.primary]))).toBe(false);
    return index;
  }

  function approve(h: Harness, signer: Keypair, transactionIndex: bigint) {
    return send(
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
    );
  }

  it("swaps one recovery signer for another without the set ever shrinking", () => {
    const h = provisioned();
    const fresh = Keypair.generate();
    const maskBefore = settingsSigners(h).find((signer) =>
      signer.key.equals(h.recovery.publicKey),
    )?.permissions.mask;

    expect(failed(rotateRecovery(h, fresh, nextIndex(h)))).toBe(false);

    const signers = settingsSigners(h);
    const keys = signers.map((signer) => signer.key.toBase58());
    expect(keys).toContain(fresh.publicKey.toBase58());
    expect(keys).not.toContain(h.recovery.publicKey.toBase58());
    expect(keys).toHaveLength(3);
    // The replacement is exactly as powerful as what it replaced: a vote and
    // nothing more.
    const installed = signers.find((signer) =>
      signer.key.equals(fresh.publicKey),
    );
    expect(installed?.permissions.mask).toBe(maskBefore);
  });

  it("leaves the old recovery key unable to approve a change, and the new one able", () => {
    const h = provisioned();
    const fresh = Keypair.generate();
    h.svm.airdrop(fresh.publicKey, BigInt(LAMPORTS_PER_SOL));
    expect(failed(rotateRecovery(h, fresh, nextIndex(h)))).toBe(false);

    const index = openChange(h);

    // The compromised inbox's key is out: it can no longer contribute a vote
    // toward any change on this Account.
    expect(failed(approve(h, h.recovery, index))).toBe(true);
    expect(failed(approve(h, fresh, index))).toBe(false);

    const proposal = decode<{ approved: PublicKey[] }>(
      h.svm,
      deriveProposalAddress(h.addresses.settings, index),
      accounts.Proposal,
    );
    expect(proposal.approved.map((key) => key.toBase58())).toEqual([
      fresh.publicKey.toBase58(),
    ]);
  });

  it("leaves both policies carrying the signer sets they were created with", () => {
    const h = provisioned();
    const fresh = Keypair.generate();
    const limitBefore = policySigners(h, h.policy);
    const aboveBefore = policySigners(h, h.abovePolicy);

    expect(failed(rotateRecovery(h, fresh, nextIndex(h)))).toBe(false);

    // Neither policy names a recovery key before or after, which is why the
    // rotation carries no PolicyUpdate and still leaves every spend route
    // exactly as it was.
    expect(policySigners(h, h.policy)).toEqual(limitBefore);
    expect(policySigners(h, h.abovePolicy)).toEqual(aboveBefore);
    for (const key of [h.recovery.publicKey, fresh.publicKey]) {
      expect(limitBefore).not.toContain(key.toBase58());
      expect(aboveBefore).not.toContain(key.toBase58());
    }
  });

  it("still spends on both routes after the rotation", () => {
    const h = provisioned();
    const fresh = Keypair.generate();
    expect(failed(rotateRecovery(h, fresh, nextIndex(h)))).toBe(false);

    const under = Keypair.generate().publicKey;
    const one = buildSpend({
      addresses: h.addresses,
      request: {
        mint: SOL,
        amount: BigInt(LAMPORTS_PER_SOL),
        destination: under,
      },
      route: { kind: "spending-limit", policy: h.policy },
      signers: [h.primary.publicKey],
      decimals: 9,
    });
    expect(failed(send(h.svm, h.primary, [one], [h.primary]))).toBe(false);
    expect(h.svm.getBalance(under)).toBe(BigInt(LAMPORTS_PER_SOL));

    const over = Keypair.generate().publicKey;
    const two = spend(
      h,
      [h.primary.publicKey, h.approval.publicKey],
      over,
      BigInt(3 * LAMPORTS_PER_SOL),
    );
    expect(failed(send(h.svm, h.primary, [two], [h.primary, h.approval]))).toBe(
      false,
    );
    expect(h.svm.getBalance(over)).toBe(BigInt(3 * LAMPORTS_PER_SOL));
  });

  it("refuses to build a rotation of a key onto itself", () => {
    const h = provisioned();
    expect(() =>
      buildRotateRecoverySigner({
        addresses: h.addresses,
        oldSigner: h.recovery.publicKey,
        newSigner: h.recovery.publicKey,
        proposer: h.primary.publicKey,
        transactionIndex: nextIndex(h),
      }),
    ).toThrow();
  });
});

/*
 * Changing the limit after the Account is live. These pin the three facts the
 * settings screen rests on: a raised limit is what the next Spend is measured
 * against, a removed limit leaves the two-signature route and nothing else,
 * and neither lands before the Consumer has had a day to object.
 */
describe.skipIf(!HAVE_FIXTURES)("spending limit changes", () => {
  const RAISED = {
    mint: SOL,
    maxPerUse: BigInt(4 * LAMPORTS_PER_SOL),
    maxPerPeriod: BigInt(9 * LAMPORTS_PER_SOL),
    period: "Daily" as const,
    destinations: [],
  };

  function signerSet(h: Harness) {
    return settingsOf(h).signers as {
      key: PublicKey;
      permissions: { mask: number };
    }[];
  }

  function proposeAndApprove(
    h: Harness,
    propose: TransactionInstruction[],
    transactionIndex: bigint,
  ) {
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
                transactionIndex,
                signer: signer.publicKey,
              }),
            ],
            [signer],
          ),
        ),
      ).toBe(false);
    }
  }

  function execute(
    h: Harness,
    transactionIndex: bigint,
    policies: PublicKey[],
  ) {
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

  function warpPastTheLock(h: Harness) {
    const clock = h.svm.getClock();
    clock.unixTimestamp = clock.unixTimestamp + BigInt(SETTINGS_TIME_LOCK + 10);
    h.svm.setClock(clock);
  }

  function limitSpend(h: Harness, amount: bigint, destination: PublicKey) {
    return buildSpend({
      addresses: h.addresses,
      request: { mint: SOL, amount, destination },
      route: { kind: "spending-limit", policy: h.policy },
      signers: [h.primary.publicKey],
      decimals: 9,
    });
  }

  function raiseTheLimit(h: Harness) {
    const index = nextIndex(h);
    const { propose, policies } = buildUpdateSpendingLimit({
      addresses: h.addresses,
      spendingLimitSeed: LIMIT_POLICY_SEED,
      currentLimit: liveLimit(h),
      terms: RAISED,
      limitSigner: h.primary.publicKey,
      signers: signerSet(h),
      proposer: h.primary.publicKey,
      transactionIndex: index,
    });
    proposeAndApprove(h, propose, index);
    warpPastTheLock(h);
    return execute(h, index, policies);
  }

  function removeTheLimit(h: Harness) {
    const index = nextIndex(h);
    const { propose, policies } = buildRemoveSpendingLimit({
      addresses: h.addresses,
      spendingLimitSeed: LIMIT_POLICY_SEED,
      currentLimit: liveLimit(h),
      signers: signerSet(h),
      proposer: h.primary.publicKey,
      transactionIndex: index,
    });
    proposeAndApprove(h, propose, index);
    warpPastTheLock(h);
    return execute(h, index, policies);
  }

  it("measures a later spend against the raised limit, not the old one", () => {
    const h = provisioned();
    const amount = BigInt(3 * LAMPORTS_PER_SOL);

    // Over the $2-equivalent per-use cap the Account was provisioned with, so
    // the one-signature route is closed to it.
    const before = Keypair.generate().publicKey;
    expect(
      failed(
        send(h.svm, h.primary, [limitSpend(h, amount, before)], [h.primary]),
      ),
    ).toBe(true);

    expect(failed(raiseTheLimit(h))).toBe(false);
    expect(liveLimit(h).maxPerUse).toBe(RAISED.maxPerUse);
    expect(liveLimit(h).maxPerPeriod).toBe(RAISED.maxPerPeriod);

    const after = Keypair.generate().publicKey;
    expect(
      failed(
        send(h.svm, h.primary, [limitSpend(h, amount, after)], [h.primary]),
      ),
    ).toBe(false);
    expect(h.svm.getBalance(after)).toBe(amount);
  });

  it("leaves the same Spend routed two-signature once the limit is removed", () => {
    const h = provisioned();
    const amount = BigInt(LAMPORTS_PER_SOL);

    expect(failed(removeTheLimit(h))).toBe(false);
    expect(h.svm.getAccount(h.policy)).toBeNull();

    // Nothing admits the Spend now, and the route resolver says so without
    // being told the policy is gone: it is asked with the limits that remain.
    expect(
      resolveSpendRoute(
        { mint: SOL, amount, destination: Keypair.generate().publicKey },
        [],
        h.abovePolicy,
      ),
    ).toEqual({
      kind: "two-signature",
      reason: "no-spending-limit",
      policy: h.abovePolicy,
    });

    const closed = Keypair.generate().publicKey;
    expect(
      failed(
        send(h.svm, h.primary, [limitSpend(h, amount, closed)], [h.primary]),
      ),
    ).toBe(true);
    expect(h.svm.getBalance(closed)).toBeNull();

    const open = Keypair.generate().publicKey;
    const both = spend(
      h,
      [h.primary.publicKey, h.approval.publicKey],
      open,
      amount,
    );
    expect(
      failed(send(h.svm, h.primary, [both], [h.primary, h.approval])),
    ).toBe(false);
    expect(h.svm.getBalance(open)).toBe(amount);
  });

  it("sets a limit on an Account that has none and measures a later Spend against it", () => {
    // A fresh Account, so the policy the program assigns is the one at the
    // spending-limit seed. Nothing admits a Spend until this lands.
    const h = setUp();
    const index = nextIndex(h);
    const { propose, policy } = buildCreateSpendingLimitPolicy({
      addresses: h.addresses,
      policySeed: LIMIT_POLICY_SEED,
      terms: {
        mint: SOL,
        maxPerUse: BigInt(2 * LAMPORTS_PER_SOL),
        maxPerPeriod: BigInt(2 * LAMPORTS_PER_SOL),
        period: "Daily",
        destinations: [],
      },
      limitSigner: h.primary.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex: index,
    });
    expect(policy.equals(h.policy)).toBe(true);

    const before = Keypair.generate().publicKey;
    expect(
      failed(
        send(
          h.svm,
          h.primary,
          [limitSpend(h, BigInt(LAMPORTS_PER_SOL), before)],
          [h.primary],
        ),
      ),
    ).toBe(true);

    proposeAndApprove(h, propose, index);
    warpPastTheLock(h);
    expect(failed(execute(h, index, [policy]))).toBe(false);
    expect(liveLimit(h).maxPerPeriod).toBe(BigInt(2 * LAMPORTS_PER_SOL));

    const paid = Keypair.generate().publicKey;
    const amount = BigInt(LAMPORTS_PER_SOL);
    expect(
      failed(
        send(h.svm, h.primary, [limitSpend(h, amount, paid)], [h.primary]),
      ),
    ).toBe(false);
    expect(h.svm.getBalance(paid)).toBe(amount);

    const refused = Keypair.generate().publicKey;
    expect(
      failed(
        send(
          h.svm,
          h.primary,
          [limitSpend(h, BigInt(3 * LAMPORTS_PER_SOL), refused)],
          [h.primary],
        ),
      ),
    ).toBe(true);
  });

  it("re-creates a removed limit at the next free seed and spends under it", () => {
    // The Account provisioning writes: seeds 1 and 2 are spent, so a limit
    // removed and set again lands at 3 and nothing may look for it at 1.
    const h = provisioned();
    expect(failed(removeTheLimit(h))).toBe(false);

    const assigned = settingsOf(h).policySeed;
    const seed = (assigned === null ? 0n : BigInt(assigned.toString())) + 1n;
    expect(seed).toBe(3n);

    const index = nextIndex(h);
    const { propose, policy } = buildCreateSpendingLimitPolicy({
      addresses: h.addresses,
      policySeed: seed,
      terms: {
        mint: SOL,
        maxPerUse: BigInt(4 * LAMPORTS_PER_SOL),
        maxPerPeriod: BigInt(4 * LAMPORTS_PER_SOL),
        period: "Daily",
        destinations: [],
      },
      limitSigner: h.primary.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex: index,
    });
    proposeAndApprove(h, propose, index);
    warpPastTheLock(h);
    expect(failed(execute(h, index, [policy]))).toBe(false);
    expect(policy.equals(h.policy)).toBe(false);

    const created = decodeSpendingLimit(policy, {
      ...h.svm.getAccount(policy)!,
      data: Buffer.from(h.svm.getAccount(policy)!.data),
    });
    expect(created.maxPerPeriod).toBe(BigInt(4 * LAMPORTS_PER_SOL));

    // The new policy is what a later Spend is measured against, on one
    // signature under it and refused above it.
    const paid = Keypair.generate().publicKey;
    const amount = BigInt(3 * LAMPORTS_PER_SOL);
    const under = buildSpend({
      addresses: h.addresses,
      request: { mint: SOL, amount, destination: paid },
      route: { kind: "spending-limit", policy },
      signers: [h.primary.publicKey],
      decimals: 9,
    });
    expect(failed(send(h.svm, h.primary, [under], [h.primary]))).toBe(false);
    expect(h.svm.getBalance(paid)).toBe(amount);

    const over = buildSpend({
      addresses: h.addresses,
      request: {
        mint: SOL,
        amount: BigInt(5 * LAMPORTS_PER_SOL),
        destination: Keypair.generate().publicKey,
      },
      route: { kind: "spending-limit", policy },
      signers: [h.primary.publicKey],
      decimals: 9,
    });
    expect(failed(send(h.svm, h.primary, [over], [h.primary]))).toBe(true);
  });

  /*
   * The program assigns policy seeds in order from a counter on the Settings,
   * and a removal does not give one back. So a limit removed from an Account
   * cannot be put back at the seed it used to occupy: the next create lands at
   * the next seed, whatever the caller asks for.
   */
  it("refuses a policy at any seed but the next one", () => {
    const h = setUp();

    const first = nextIndex(h);
    const created = buildCreateSpendingLimitPolicy({
      addresses: h.addresses,
      policySeed: LIMIT_POLICY_SEED,
      terms: {
        mint: SOL,
        maxPerUse: BigInt(LAMPORTS_PER_SOL),
        maxPerPeriod: BigInt(LAMPORTS_PER_SOL),
        period: "Daily",
        destinations: [],
      },
      limitSigner: h.primary.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex: first,
    });
    expect(
      failed(applySettingsChange(h, created.propose, first, created.policy)),
    ).toBe(false);

    const removal = nextIndex(h);
    const removed = buildRemoveSpendingLimit({
      addresses: h.addresses,
      spendingLimitSeed: LIMIT_POLICY_SEED,
      currentLimit: liveLimit(h),
      signers: signerSet(h),
      proposer: h.primary.publicKey,
      transactionIndex: removal,
    });
    expect(
      failed(applySettingsChange(h, removed.propose, removal, created.policy)),
    ).toBe(false);
    expect(h.svm.getAccount(h.policy)).toBeNull();

    const reuse = nextIndex(h);
    const again = buildCreateSpendingLimitPolicy({
      addresses: h.addresses,
      policySeed: LIMIT_POLICY_SEED,
      terms: {
        mint: SOL,
        maxPerUse: BigInt(LAMPORTS_PER_SOL),
        maxPerPeriod: BigInt(LAMPORTS_PER_SOL),
        period: "Daily",
        destinations: [],
      },
      limitSigner: h.primary.publicKey,
      proposer: h.primary.publicKey,
      transactionIndex: reuse,
    });
    // Refused at execute, after both approvals and the whole wait, which is
    // why nothing proposes a create the counter will not accept.
    expect(
      failed(applySettingsChange(h, again.propose, reuse, again.policy)),
    ).toBe(true);
  });

  it("refuses the change until the time lock has run, then takes it", () => {
    const h = provisioned();
    const index = nextIndex(h);
    const { propose, policies } = buildUpdateSpendingLimit({
      addresses: h.addresses,
      spendingLimitSeed: LIMIT_POLICY_SEED,
      currentLimit: liveLimit(h),
      terms: RAISED,
      limitSigner: h.primary.publicKey,
      signers: signerSet(h),
      proposer: h.primary.publicKey,
      transactionIndex: index,
    });
    proposeAndApprove(h, propose, index);

    expect(failed(execute(h, index, policies))).toBe(true);
    expect(liveLimit(h).maxPerUse).toBe(BigInt(2 * LAMPORTS_PER_SOL));

    warpPastTheLock(h);
    expect(failed(execute(h, index, policies))).toBe(false);
    expect(liveLimit(h).maxPerUse).toBe(RAISED.maxPerUse);
  });
});
