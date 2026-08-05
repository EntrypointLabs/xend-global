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
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { accounts } from "@sqds/smart-account";
import { LiteSVM } from "litesvm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildApproveSettingsChange,
  buildCreateAccount,
  buildCreateSpendingLimitPolicy,
  buildExecuteSettingsChange,
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
const POLICY_SEED = 1n;
const SOL = PublicKey.default;

interface Harness {
  svm: LiteSVM;
  addresses: AccountAddresses;
  policy: PublicKey;
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
    policy: derivePolicyAddress(addresses.settings, POLICY_SEED),
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

function spend(
  h: Harness,
  signers: PublicKey[],
  destination: PublicKey,
  amount: bigint,
): TransactionInstruction {
  return buildSpend({
    addresses: h.addresses,
    request: { mint: SOL, amount, destination },
    route: { kind: "two-signature", reason: "no-spending-limit" },
    signers,
    decimals: 9,
  });
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
      policySeed: POLICY_SEED,
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
    expect(failed(send(h.svm, h.primary, propose, [h.primary]))).toBe(false);

    for (const signer of [h.primary, h.approval]) {
      const approve = buildApproveSettingsChange({
        addresses: h.addresses,
        transactionIndex,
        signer: signer.publicKey,
      });
      expect(failed(send(h.svm, signer, [approve], [signer]))).toBe(false);
    }

    const execute = () =>
      send(
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

    expect(failed(execute())).toBe(true);

    const clock = h.svm.getClock();
    clock.unixTimestamp = clock.unixTimestamp + BigInt(SETTINGS_TIME_LOCK + 10);
    h.svm.setClock(clock);
    h.svm.expireBlockhash();

    expect(failed(execute())).toBe(false);

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

    const route = resolveSpendRoute({ mint: SOL, amount, destination }, [
      {
        policy: h.policy,
        mint: SOL,
        maxPerUse: BigInt(2 * LAMPORTS_PER_SOL),
        remainingInPeriod: BigInt(5 * LAMPORTS_PER_SOL),
        destinations: [],
      },
    ]);
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

  it("cannot spend through the Settings while it carries a time lock", () => {
    // Synchronous execution requires the consensus account's time lock to be zero,
    // so a time-locked Settings cannot carry Spends at all. This is why every Spend
    // must run under a policy, and why the above-limit policy is still needed before
    // an Account like this one can spend above its limit.
    const destination = Keypair.generate().publicKey;
    const instruction = spend(
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
    // Uses a second Account with no time lock, since a time-locked Settings refuses
    // synchronous execution regardless of who signs.
    const open = setUp({ timeLockSeconds: 0 });
    const destination = Keypair.generate().publicKey;
    const instruction = spend(
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
});
