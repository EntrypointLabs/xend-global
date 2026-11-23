/*
 * Executes live Jupiter routes from a Squads vault, against the deployed
 * bytecode of both programs and a snapshot of the pools they trade through.
 *
 * Jupiter exists on mainnet only, so this needs mainnet fixtures:
 *
 *   RPC_URL=<mainnet rpc> node test/fixtures/fetch-program.mjs
 *   RPC_URL=<mainnet rpc> node test/fixtures/fetch-jupiter.mjs
 *
 * Without them the suite skips.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AddressLookupTableAccount,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { accounts } from "@sqds/smart-account";
import { LiteSVM } from "litesvm";
import { describe, expect, it } from "vitest";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  buildApproveSettingsChange,
  buildCreateAccount,
  buildExecuteSettingsChange,
  buildProvisionAccount,
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  buildSwap,
  buildUpdateAboveLimitAllowlist,
  decodeAllowedPrograms,
  derivePolicyAddress,
  deriveProposalAddress,
  describeTransaction,
  fetchStagedSettingsChange,
  JUPITER_PROGRAM_ID,
  minimumAmountOut,
  SETTINGS_TIME_LOCK_SECONDS,
  SYSTEM_PROGRAM_ID,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
  type AccountAddresses,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const PROGRAM_SO = join(FIXTURES, "program.so");
const PROGRAM_CONFIG = join(FIXTURES, "program-config.json");
const USDC_TO_SOL = join(FIXTURES, "jupiter", "usdc-to-sol.json");
const SOL_TO_USDC = join(FIXTURES, "jupiter", "sol-to-usdc.json");
const HAVE_FIXTURES = [
  PROGRAM_SO,
  PROGRAM_CONFIG,
  USDC_TO_SOL,
  SOL_TO_USDC,
].every((path) => existsSync(path));

const SQUADS = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111";
const MAX_TRANSACTION_BYTES = 1232;
const TOKEN_ACCOUNT_LEN = 165;

interface Snapshot {
  settingsSeed: string;
  vault: string;
  slot: number;
  unixTimestamp: number;
  inputMint: string;
  outputMint: string;
  amountIn: string;
  quotedAmountOut: string;
  slippageBps: number;
  route: {
    programId: string;
    data: string;
    accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  };
  accounts: {
    address: string;
    owner: string;
    lamports: number;
    data: string;
  }[];
  programs: { address: string; elf: string }[];
}

interface Harness {
  svm: LiteSVM;
  addresses: AccountAddresses;
  abovePolicy: PublicKey;
  primary: Keypair;
  approval: Keypair;
  feePayer: Keypair;
  snapshot: Snapshot;
  route: TransactionInstruction;
  lookupTables: AddressLookupTableAccount[];
}

const failed = (result: unknown): boolean =>
  typeof (result as { err?: unknown })?.err === "function";

const logsOf = (result: unknown): string =>
  (result as { meta?: () => { logs: () => string[] } })
    .meta?.()
    .logs()
    .join("\n") ?? "";

function transaction(
  h: Harness,
  instructions: TransactionInstruction[],
  signers: Keypair[],
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: h.feePayer.publicKey,
    recentBlockhash: h.svm.latestBlockhash(),
    instructions,
  }).compileToV0Message(h.lookupTables);
  const tx = new VersionedTransaction(message);
  tx.sign([h.feePayer, ...signers]);
  return tx;
}

/** A provisioned Account at the vault the snapshot's routes were built for. */
function setUp(
  path: string,
  allowedPrograms: readonly PublicKey[] = ABOVE_LIMIT_PROGRAM_ALLOWLIST,
): Harness {
  const snapshot = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
  const svm = new LiteSVM();
  svm.addProgramFromFile(SQUADS, PROGRAM_SO);

  const raw = JSON.parse(readFileSync(PROGRAM_CONFIG, "utf8"));
  const programConfigPda = new PublicKey(raw.address);
  svm.setAccount(programConfigPda, {
    lamports: Number(raw.lamports),
    data: Buffer.from(raw.data, "base64"),
    owner: new PublicKey(raw.owner),
    executable: false,
    rentEpoch: 0,
  });
  const [programConfig] = accounts.ProgramConfig.fromAccountInfo({
    data: Buffer.from(raw.data, "base64"),
  } as never);

  const primary = Keypair.generate();
  const approval = Keypair.generate();
  const recovery = Keypair.generate();
  const feePayer = Keypair.generate();
  for (const kp of [primary, feePayer]) {
    svm.airdrop(kp.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  }
  svm.airdrop(programConfig.treasury, BigInt(LAMPORTS_PER_SOL));

  const { instruction, addresses } = buildCreateAccount({
    signers: [
      { role: "primary", address: primary.publicKey },
      { role: "approval", address: approval.publicKey },
      { role: "recovery", address: recovery.publicKey },
    ],
    creator: primary.publicKey,
    treasury: programConfig.treasury,
    settingsSeed: BigInt(snapshot.settingsSeed),
    timeLockSeconds: 0,
  });
  if (addresses.vault.toBase58() !== snapshot.vault) {
    throw new Error(
      "the Jupiter snapshot was taken for a different program config; fetch both again",
    );
  }

  const abovePolicy = derivePolicyAddress(addresses.settings, 2n);
  const h: Harness = {
    svm,
    addresses,
    abovePolicy,
    primary,
    approval,
    feePayer,
    snapshot,
    route: new TransactionInstruction({
      programId: new PublicKey(snapshot.route.programId),
      data: Buffer.from(snapshot.route.data, "base64"),
      keys: snapshot.route.accounts.map((a) => ({
        ...a,
        pubkey: new PublicKey(a.pubkey),
      })),
    }),
    lookupTables: [],
  };

  const created = svm.sendTransaction(transaction(h, [instruction], [primary]));
  if (failed(created)) throw new Error(`create failed\n${logsOf(created)}`);

  const { propose, policies } = buildProvisionAccount({
    addresses,
    spendingLimitSeed: 1n,
    aboveLimitSeed: 2n,
    terms: {
      mint: PublicKey.default,
      maxPerUse: BigInt(LAMPORTS_PER_SOL),
      maxPerPeriod: BigInt(LAMPORTS_PER_SOL),
      period: "Daily",
      destinations: [],
    },
    primary: primary.publicKey,
    approval: approval.publicKey,
    proposer: primary.publicKey,
    transactionIndex: 1n,
    timeLockSeconds: SETTINGS_TIME_LOCK_SECONDS,
    allowedPrograms,
  });
  const provisioned = svm.sendTransaction(
    transaction(
      h,
      [
        ...propose,
        ...[primary, approval].map((signer) =>
          buildApproveSettingsChange({
            addresses,
            transactionIndex: 1n,
            signer: signer.publicKey,
          }),
        ),
        buildExecuteSettingsChange({
          addresses,
          transactionIndex: 1n,
          signer: primary.publicKey,
          policies,
        }),
      ],
      [primary, approval],
    ),
  );
  if (failed(provisioned)) {
    throw new Error(`provisioning failed\n${logsOf(provisioned)}`);
  }

  for (const program of snapshot.programs) {
    svm.addProgram(
      new PublicKey(program.address),
      Buffer.from(program.elf, "base64"),
    );
  }
  for (const account of snapshot.accounts) {
    const data = Buffer.from(account.data, "base64");
    svm.setAccount(new PublicKey(account.address), {
      lamports: account.lamports,
      data,
      owner: new PublicKey(account.owner),
      executable: false,
      rentEpoch: 0,
    });
    if (account.owner === LOOKUP_TABLE_PROGRAM) {
      h.lookupTables.push(
        new AddressLookupTableAccount({
          key: new PublicKey(account.address),
          state: AddressLookupTableAccount.deserialize(data),
        }),
      );
    }
  }

  // The pools are as they stood at the snapshot, so the clock has to be too.
  const clock = svm.getClock();
  clock.slot = BigInt(snapshot.slot) + 1n;
  clock.unixTimestamp = BigInt(snapshot.unixTimestamp);
  svm.setClock(clock);
  svm.expireBlockhash();

  return h;
}

function openTokenAccount(h: Harness, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: h.feePayer.publicKey, isSigner: true, isWritable: true },
      {
        pubkey: associatedTokenAddress(
          h.addresses.vault,
          mint,
          TOKEN_PROGRAM_ID,
        ),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: h.addresses.vault, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function fundToken(h: Harness, mint: PublicKey, amount: bigint) {
  const data = Buffer.alloc(TOKEN_ACCOUNT_LEN);
  mint.toBuffer().copy(data, 0);
  h.addresses.vault.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt8(1, 108);
  h.svm.setAccount(
    associatedTokenAddress(h.addresses.vault, mint, TOKEN_PROGRAM_ID),
    {
      lamports: Number(TOKEN_ACCOUNT_RENT_LAMPORTS),
      data,
      owner: TOKEN_PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
    },
  );
}

function tokenBalance(h: Harness, mint: PublicKey): bigint | null {
  const account = h.svm.getAccount(
    associatedTokenAddress(h.addresses.vault, mint, TOKEN_PROGRAM_ID),
  );
  return account ? Buffer.from(account.data).readBigUInt64LE(64) : null;
}

const lamports = (h: Harness, address: PublicKey) =>
  h.svm.getBalance(address) ?? 0n;

describe.skipIf(!HAVE_FIXTURES)(
  "a swap out of the vault through Jupiter",
  () => {
    it("turns a Consumer's USDC into SOL when the vault holds no SOL at all", () => {
      const h = setUp(USDC_TO_SOL);
      const usdc = new PublicKey(h.snapshot.inputMint);
      const amountIn = BigInt(h.snapshot.amountIn);
      fundToken(h, usdc, amountIn + 5_000_000n);
      expect(lamports(h, h.addresses.vault)).toBe(0n);

      const tx = transaction(
        h,
        [
          openTokenAccount(h, WRAPPED_SOL_MINT),
          buildSwap({
            addresses: h.addresses,
            policy: h.abovePolicy,
            signers: [h.primary.publicKey, h.approval.publicKey],
            route: h.route,
            unwrapOutput: true,
            refundRentTo: h.feePayer.publicKey,
          }),
        ],
        [h.primary, h.approval],
      );
      const wire = tx.serialize();
      expect(wire.length).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES);

      const described = describeTransaction(
        Buffer.from(wire).toString("base64"),
        { addresses: h.addresses, lookupTables: h.lookupTables },
      );
      expect(described).toMatchObject({
        kind: "swap",
        outputMint: "SOL",
        amountIn,
        quotedAmountOut: BigInt(h.snapshot.quotedAmountOut),
        slippageBps: h.snapshot.slippageBps,
        refundsRent: true,
      });

      const payerBefore = lamports(h, h.feePayer.publicKey);
      const result = h.svm.sendTransaction(tx);
      expect(failed(result), logsOf(result)).toBe(false);

      const received = lamports(h, h.addresses.vault);
      expect(received).toBeGreaterThanOrEqual(
        minimumAmountOut(
          BigInt(h.snapshot.quotedAmountOut),
          h.snapshot.slippageBps,
        ),
      );
      expect(tokenBalance(h, usdc)).toBe(5_000_000n);
      expect(tokenBalance(h, WRAPPED_SOL_MINT)).toBeNull();
      // The fee payer fronted a token account's rent and got it back, so the
      // swap cost it the network fee and nothing else.
      expect(payerBefore - lamports(h, h.feePayer.publicKey)).toBeLessThan(
        100_000n,
      );
    });

    it("swaps every last lamport, leaving the vault with no SOL at all", () => {
      const h = setUp(SOL_TO_USDC);
      const usdc = new PublicKey(h.snapshot.outputMint);
      const amountIn = BigInt(h.snapshot.amountIn);
      h.svm.airdrop(h.addresses.vault, amountIn);

      const result = h.svm.sendTransaction(
        transaction(
          h,
          [
            openTokenAccount(h, WRAPPED_SOL_MINT),
            openTokenAccount(h, usdc),
            buildSwap({
              addresses: h.addresses,
              policy: h.abovePolicy,
              signers: [h.primary.publicKey, h.approval.publicKey],
              route: h.route,
              wrapInput: true,
              refundRentTo: h.feePayer.publicKey,
            }),
          ],
          [h.primary, h.approval],
        ),
      );
      expect(failed(result), logsOf(result)).toBe(false);
      expect(lamports(h, h.addresses.vault)).toBe(0n);
      expect(tokenBalance(h, usdc)).toBeGreaterThanOrEqual(
        minimumAmountOut(
          BigInt(h.snapshot.quotedAmountOut),
          h.snapshot.slippageBps,
        ),
      );
    });

    it("turns the vault's SOL into USDC", () => {
      const h = setUp(SOL_TO_USDC);
      const usdc = new PublicKey(h.snapshot.outputMint);
      const amountIn = BigInt(h.snapshot.amountIn);
      h.svm.airdrop(h.addresses.vault, amountIn + BigInt(LAMPORTS_PER_SOL));

      const tx = transaction(
        h,
        [
          openTokenAccount(h, WRAPPED_SOL_MINT),
          openTokenAccount(h, usdc),
          buildSwap({
            addresses: h.addresses,
            policy: h.abovePolicy,
            signers: [h.primary.publicKey, h.approval.publicKey],
            route: h.route,
            wrapInput: true,
            refundRentTo: h.feePayer.publicKey,
          }),
        ],
        [h.primary, h.approval],
      );
      expect(tx.serialize().length).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES);
      expect(
        describeTransaction(Buffer.from(tx.serialize()).toString("base64"), {
          addresses: h.addresses,
          lookupTables: h.lookupTables,
        }),
      ).toMatchObject({ kind: "swap", inputMint: "SOL", amountIn });

      const result = h.svm.sendTransaction(tx);
      expect(failed(result), logsOf(result)).toBe(false);

      expect(tokenBalance(h, usdc)).toBeGreaterThanOrEqual(
        minimumAmountOut(
          BigInt(h.snapshot.quotedAmountOut),
          h.snapshot.slippageBps,
        ),
      );
      expect(lamports(h, h.addresses.vault)).toBe(BigInt(LAMPORTS_PER_SOL));
      expect(tokenBalance(h, WRAPPED_SOL_MINT)).toBeNull();
    });

    it("reads the allowlist back off a provisioned Account's policy", () => {
      const h = setUp(USDC_TO_SOL);
      const info = h.svm.getAccount(h.abovePolicy)!;
      const allowed = decodeAllowedPrograms(h.abovePolicy, {
        ...info,
        data: Buffer.from(info.data),
      } as never);
      expect(
        allowed.some((program) => program.equals(JUPITER_PROGRAM_ID)),
      ).toBe(true);
    });

    it("is refused when the second signature is not the approval signer's", () => {
      const h = setUp(USDC_TO_SOL);
      const usdc = new PublicKey(h.snapshot.inputMint);
      fundToken(h, usdc, BigInt(h.snapshot.amountIn));
      const stranger = Keypair.generate();

      const result = h.svm.sendTransaction(
        transaction(
          h,
          [
            openTokenAccount(h, WRAPPED_SOL_MINT),
            buildSwap({
              addresses: h.addresses,
              policy: h.abovePolicy,
              signers: [h.primary.publicKey, stranger.publicKey],
              route: h.route,
              unwrapOutput: true,
            }),
          ],
          [h.primary, stranger],
        ),
      );
      expect(failed(result)).toBe(true);
      expect(tokenBalance(h, usdc)).toBe(BigInt(h.snapshot.amountIn));
    });
  },
);

describe.skipIf(!HAVE_FIXTURES)(
  "an Account provisioned before Jupiter joined the allowlist",
  () => {
    const BEFORE_JUPITER = ABOVE_LIMIT_PROGRAM_ALLOWLIST.filter(
      (program) => !program.equals(JUPITER_PROGRAM_ID),
    );

    function swapOf(h: Harness, allowedPrograms: readonly PublicKey[]) {
      return transaction(
        h,
        [
          openTokenAccount(h, WRAPPED_SOL_MINT),
          buildSwap({
            addresses: h.addresses,
            policy: h.abovePolicy,
            signers: [h.primary.publicKey, h.approval.publicKey],
            route: h.route,
            unwrapOutput: true,
            refundRentTo: h.feePayer.publicKey,
            allowedPrograms,
          }),
        ],
        [h.primary, h.approval],
      );
    }

    /** Propose and both approvals in one transaction, as the app sends it. */
    function stageUpdate(h: Harness) {
      const { propose } = buildUpdateAboveLimitAllowlist({
        addresses: h.addresses,
        primary: h.primary.publicKey,
        approval: h.approval.publicKey,
        aboveLimitSeed: 2n,
        proposer: h.primary.publicKey,
        rentPayer: h.feePayer.publicKey,
        transactionIndex: 2n,
      });
      return h.svm.sendTransaction(
        transaction(
          h,
          [
            ...propose,
            ...[h.primary, h.approval].map((signer) =>
              buildApproveSettingsChange({
                addresses: h.addresses,
                transactionIndex: 2n,
                signer: signer.publicKey,
              }),
            ),
          ],
          [h.primary, h.approval],
        ),
      );
    }

    function execute(h: Harness) {
      h.svm.expireBlockhash();
      return h.svm.sendTransaction(
        transaction(
          h,
          [
            buildExecuteSettingsChange({
              addresses: h.addresses,
              transactionIndex: 2n,
              signer: h.primary.publicKey,
              rentPayer: h.feePayer.publicKey,
              policies: [h.abovePolicy],
            }),
          ],
          [h.primary],
        ),
      );
    }

    function waitOutTheLock(h: Harness) {
      const clock = h.svm.getClock();
      clock.unixTimestamp += BigInt(SETTINGS_TIME_LOCK_SECONDS + 1);
      h.svm.setClock(clock);
    }

    it("can be read back off the chain as the change an approval stands for", async () => {
      const h = setUp(USDC_TO_SOL, BEFORE_JUPITER);
      expect(failed(stageUpdate(h))).toBe(false);

      const connection = {
        getAccountInfo: (address: PublicKey) => {
          const account = h.svm.getAccount(address);
          return Promise.resolve(
            account && {
              ...account,
              data: Buffer.from(account.data),
              owner: new PublicKey(account.owner),
            },
          );
        },
      } as unknown as Connection;
      const proposal = deriveProposalAddress(h.addresses.settings, 2n);

      const staged = await fetchStagedSettingsChange(
        connection,
        h.addresses.settings,
        proposal,
      );
      expect(staged?.transactionIndex).toBe(2n);
      expect(staged?.actions).toHaveLength(1);
      const [action] = staged?.actions ?? [];
      expect(action?.kind).toBe("policy-update");
      if (action?.kind !== "policy-update") return;
      expect(action.terms).toMatchObject({
        kind: "program-interaction",
        threshold: 2,
        timeLock: 0,
      });

      // A proposal address that does not belong to this Account reads as
      // nothing, whatever account happens to sit there.
      await expect(
        fetchStagedSettingsChange(
          connection,
          h.addresses.settings,
          h.abovePolicy,
        ),
      ).resolves.toBeNull();
    });

    it("cannot swap, because its policy has no constraint for Jupiter", () => {
      const h = setUp(USDC_TO_SOL, BEFORE_JUPITER);
      fundToken(h, new PublicKey(h.snapshot.inputMint), 100_000_000n);
      expect(() => swapOf(h, BEFORE_JUPITER)).toThrow(/allowlist/);
      // Built against the current list anyway, the chain refuses it.
      expect(
        failed(h.svm.sendTransaction(swapOf(h, ABOVE_LIMIT_PROGRAM_ALLOWLIST))),
      ).toBe(true);
    });

    it("stages the update with one transaction and cannot land it early", () => {
      const h = setUp(USDC_TO_SOL, BEFORE_JUPITER);
      const staged = stageUpdate(h);
      expect(failed(staged), logsOf(staged)).toBe(false);
      expect(failed(execute(h))).toBe(true);
    });

    it("can swap once the update has waited out the time lock", () => {
      const h = setUp(USDC_TO_SOL, BEFORE_JUPITER);
      const usdc = new PublicKey(h.snapshot.inputMint);
      fundToken(h, usdc, BigInt(h.snapshot.amountIn));
      expect(failed(stageUpdate(h))).toBe(false);

      // The pools are a snapshot, so the swap has to run at the snapshot's
      // time: the lock is waited out and the clock put back.
      const before = h.svm.getClock();
      const snapshotTime = before.unixTimestamp;
      waitOutTheLock(h);
      const executed = execute(h);
      expect(failed(executed), logsOf(executed)).toBe(false);
      const after = h.svm.getClock();
      after.unixTimestamp = snapshotTime;
      h.svm.setClock(after);
      h.svm.expireBlockhash();

      const info = h.svm.getAccount(h.abovePolicy)!;
      const allowed = decodeAllowedPrograms(h.abovePolicy, {
        ...info,
        data: Buffer.from(info.data),
      } as never);
      expect(allowed.map(String)).toEqual(
        ABOVE_LIMIT_PROGRAM_ALLOWLIST.map(String),
      );

      const swapped = h.svm.sendTransaction(swapOf(h, allowed));
      expect(failed(swapped), logsOf(swapped)).toBe(false);
      expect(tokenBalance(h, usdc)).toBe(0n);
      expect(lamports(h, h.addresses.vault)).toBeGreaterThanOrEqual(
        minimumAmountOut(
          BigInt(h.snapshot.quotedAmountOut),
          h.snapshot.slippageBps,
        ),
      );
    });
  },
);
