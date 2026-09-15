import {
  Keypair,
  PublicKey,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import { accounts, PROGRAM_ID } from "@sqds/smart-account";
import { describe, expect, it } from "vitest";

import {
  AccountStateError,
  decodeProposal,
  decodeSpendingLimit,
  fetchSettings,
  fetchSpendingLimit,
  nextPolicySeed,
} from "../src/index.js";

function settingsWith(policySeed: number | null) {
  return accounts.Settings.fromArgs({
    seed: 1,
    settingsAuthority: PublicKey.default,
    threshold: 2,
    timeLock: 86_400,
    transactionIndex: 1,
    staleTransactionIndex: 0,
    archivalAuthority: null,
    archivableAfter: 0,
    bump: 255,
    signers: [],
    accountUtilization: 0,
    policySeed,
    reserved2: 0,
  });
}

/**
 * A u64 past 2^53, where a Number would already have rounded. The SDK's
 * bignum accepts a decimal string at runtime whatever its declaration says.
 */
const BIG = 9_007_199_254_740_993n;
const u64 = (value: bigint) => value.toString() as unknown as number;

const info = (data: Buffer): AccountInfo<Buffer> => ({
  data,
  owner: PROGRAM_ID,
  lamports: 1,
  executable: false,
});

const connectionFor = (account: AccountInfo<Buffer> | null): Connection =>
  ({ getAccountInfo: async () => account }) as unknown as Connection;

const MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const POLICY = Keypair.generate().publicKey;

function spendingLimitPolicy({
  period = "Daily" as "OneTime" | "Daily" | "Weekly" | "Monthly" | "Custom",
  destinations = [] as PublicKey[],
} = {}) {
  return accounts.Policy.fromArgs({
    settings: Keypair.generate().publicKey,
    seed: 1,
    bump: 255,
    transactionIndex: 0,
    staleTransactionIndex: 0,
    signers: [{ key: Keypair.generate().publicKey, permissions: { mask: 7 } }],
    threshold: 1,
    timeLock: 0,
    policyState: {
      __kind: "SpendingLimit",
      fields: [
        {
          sourceAccountIndex: 0,
          destinations,
          spendingLimit: {
            mint: MINT,
            timeConstraints: {
              start: 0,
              expiration: null,
              period:
                period === "Custom"
                  ? { __kind: "Custom", fields: [3600] }
                  : { __kind: period },
              accumulateUnused: false,
            },
            quantityConstraints: {
              maxPerPeriod: u64(BIG + 1n),
              maxPerUse: u64(BIG),
              enforceExactQuantity: false,
            },
            usage: { remainingInPeriod: u64(BIG - 1n), lastReset: 0 },
          },
        },
      ],
    },
    start: 0,
    expiration: null,
    rentCollector: Keypair.generate().publicKey,
  });
}

describe("decodeSpendingLimit", () => {
  it("reads the terms and usage without rounding past 2^53", () => {
    const destination = Keypair.generate().publicKey;
    const [data] = spendingLimitPolicy({
      period: "Weekly",
      destinations: [destination],
    }).serialize();

    const limit = decodeSpendingLimit(POLICY, info(data));

    expect(limit.policy.equals(POLICY)).toBe(true);
    expect(limit.mint.equals(MINT)).toBe(true);
    expect(limit.maxPerUse).toBe(BIG);
    expect(limit.maxPerPeriod).toBe(BIG + 1n);
    expect(limit.remainingInPeriod).toBe(BIG - 1n);
    expect(limit.period).toBe("Weekly");
    expect(limit.destinations.map((d) => d.toBase58())).toEqual([
      destination.toBase58(),
    ]);
  });

  it("refuses a policy that is not a spending limit", () => {
    const [data] = accounts.Policy.fromArgs({
      settings: Keypair.generate().publicKey,
      seed: 2,
      bump: 255,
      transactionIndex: 0,
      staleTransactionIndex: 0,
      signers: [],
      threshold: 2,
      timeLock: 0,
      policyState: {
        __kind: "ProgramInteraction",
        fields: [
          {
            accountIndex: 0,
            instructionsConstraints: [],
            preHook: null,
            postHook: null,
            spendingLimits: [],
          },
        ],
      },
      start: 0,
      expiration: null,
      rentCollector: Keypair.generate().publicKey,
    }).serialize();

    expect(() => decodeSpendingLimit(POLICY, info(data))).toThrow(
      AccountStateError,
    );
    expect(() => decodeSpendingLimit(POLICY, info(data))).toThrow(
      /ProgramInteraction/,
    );
  });

  it("refuses a custom period, which provisioning never writes", () => {
    const [data] = spendingLimitPolicy({ period: "Custom" }).serialize();
    expect(() => decodeSpendingLimit(POLICY, info(data))).toThrow(
      /custom period/,
    );
  });

  it("wraps an undecodable account in an AccountStateError naming the policy", () => {
    const garbage = info(Buffer.from([1, 2, 3]));
    expect(() => decodeSpendingLimit(POLICY, garbage)).toThrow(
      AccountStateError,
    );
    expect(() => decodeSpendingLimit(POLICY, garbage)).toThrow(
      POLICY.toBase58(),
    );
  });
});

describe("decodeProposal", () => {
  const approver = Keypair.generate().publicKey;
  const rejecter = Keypair.generate().publicKey;

  function proposal(
    status: Parameters<typeof accounts.Proposal.fromArgs>[0]["status"],
  ) {
    const [data] = accounts.Proposal.fromArgs({
      settings: Keypair.generate().publicKey,
      transactionIndex: 1,
      rentCollector: Keypair.generate().publicKey,
      status,
      bump: 255,
      approved: [approver],
      rejected: [rejecter],
      cancelled: [],
    }).serialize();
    return decodeProposal(info(data));
  }

  it("reads the votes and the status timestamp of an open proposal", () => {
    const state = proposal({ __kind: "Active", timestamp: u64(BIG) });

    expect(state.status).toBe("Active");
    expect(state.settled).toBe(false);
    expect(state.statusTimestamp).toBe(BIG);
    expect(state.approved).toEqual([approver.toBase58()]);
    expect(state.rejected).toEqual([rejecter.toBase58()]);
  });

  it("calls Approved unfinished, since execute is still owed", () => {
    const state = proposal({ __kind: "Approved", timestamp: 10 });
    expect(state.settled).toBe(false);
    expect(state.statusTimestamp).toBe(10n);
  });

  it("gives Executing no timestamp and leaves it unfinished", () => {
    const state = proposal({ __kind: "Executing" });
    expect(state.settled).toBe(false);
    expect(state.statusTimestamp).toBeNull();
  });

  it.each(["Executed", "Rejected", "Cancelled"] as const)(
    "calls %s settled",
    (kind) => {
      const state = proposal({ __kind: kind, timestamp: 5 });
      expect(state.status).toBe(kind);
      expect(state.settled).toBe(true);
    },
  );
});

describe("fetchSettings", () => {
  const primary = Keypair.generate().publicKey;
  const recovery = Keypair.generate().publicKey;

  it("reads the lock, the index past 2^53 and each signer's permission mask", async () => {
    const [data] = accounts.Settings.fromArgs({
      seed: 1,
      settingsAuthority: PublicKey.default,
      threshold: 2,
      timeLock: 86_400,
      transactionIndex: u64(BIG),
      staleTransactionIndex: 0,
      archivalAuthority: null,
      archivableAfter: 0,
      bump: 255,
      signers: [
        { key: primary, permissions: { mask: 7 } },
        { key: recovery, permissions: { mask: 2 } },
      ],
      accountUtilization: 0,
      policySeed: null,
      reserved2: 0,
    }).serialize();

    const settings = await fetchSettings(
      connectionFor(info(data)),
      Keypair.generate().publicKey,
    );

    expect(settings.timeLockSeconds).toBe(86_400);
    expect(settings.transactionIndex).toBe(BIG);
    expect(
      settings.signers.map((s) => [s.key.toBase58(), s.permissions.mask]),
    ).toEqual([
      [primary.toBase58(), 7],
      [recovery.toBase58(), 2],
    ]);
  });

  it("reports no assigned policy seed as none, so the first policy takes one", async () => {
    const [data] = settingsWith(null).serialize();

    const settings = await fetchSettings(
      connectionFor(info(data)),
      Keypair.generate().publicKey,
    );

    expect(settings.policySeed).toBeNull();
    expect(nextPolicySeed(settings)).toBe(1n);
  });

  it("reports the seed the program last assigned, which the next has to follow", async () => {
    const [data] = settingsWith(2).serialize();

    const settings = await fetchSettings(
      connectionFor(info(data)),
      Keypair.generate().publicKey,
    );

    // Seeds only move forward, so a policy removed from seed 1 leaves the next
    // one at 3 rather than filling the gap.
    expect(settings.policySeed).toBe(2n);
    expect(nextPolicySeed(settings)).toBe(3n);
  });

  it("throws when there is no Settings account", async () => {
    await expect(
      fetchSettings(connectionFor(null), Keypair.generate().publicKey),
    ).rejects.toThrow();
  });
});

describe("fetchSpendingLimit", () => {
  it("decodes the policy at the address", async () => {
    const [data] = spendingLimitPolicy().serialize();
    const limit = await fetchSpendingLimit(connectionFor(info(data)), POLICY);
    expect(limit.policy.equals(POLICY)).toBe(true);
    expect(limit.maxPerUse).toBe(BIG);
  });

  it("refuses a missing policy rather than reporting no limit", async () => {
    await expect(
      fetchSpendingLimit(connectionFor(null), POLICY),
    ).rejects.toThrow(AccountStateError);
  });
});
