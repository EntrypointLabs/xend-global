import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  buildCreateAboveLimitPolicy,
  buildRemoveRecoverySigner,
  buildRemoveSpendingLimit,
  buildRotatePrimarySigner,
  buildUpdateSpendingLimit,
  deriveAccountAddresses,
  derivePolicyAddress,
  SettingsChangeRefusedError,
  SYSTEM_PROGRAM_ID,
  type SettingsSigner,
  type SpendingLimit,
} from "../src/index.js";

const addresses = deriveAccountAddresses(7n);
const key = () => Keypair.generate().publicKey;

const ALL = 7;
const VOTE_AND_EXECUTE = 6;

describe("buildRemoveRecoverySigner", () => {
  const proposer = key();

  it("builds a removal while another recovery signer remains", () => {
    const leaving = key();
    const propose = buildRemoveRecoverySigner({
      addresses,
      oldSigner: leaving,
      recoverySigners: [key(), leaving],
      proposer,
      transactionIndex: 1n,
    });
    expect(propose).toHaveLength(2);
  });

  it("refuses to strip the only recovery signer", () => {
    const only = key();
    expect(() =>
      buildRemoveRecoverySigner({
        addresses,
        oldSigner: only,
        recoverySigners: [only],
        proposer,
        transactionIndex: 1n,
      }),
    ).toThrow(SettingsChangeRefusedError);
    expect(() =>
      buildRemoveRecoverySigner({
        addresses,
        oldSigner: only,
        recoverySigners: [only],
        proposer,
        transactionIndex: 1n,
      }),
    ).toThrow(/only recovery signer/);
  });

  it("refuses a key that is not a recovery signer at all", () => {
    expect(() =>
      buildRemoveRecoverySigner({
        addresses,
        oldSigner: key(),
        recoverySigners: [key(), key()],
        proposer,
        transactionIndex: 1n,
      }),
    ).toThrow(/not one of the Account's recovery signers/);
  });
});

describe("buildRotatePrimarySigner", () => {
  const oldPrimary = key();
  const approval = key();
  const recovery = key();
  const SPENDING_LIMIT_SEED = 1n;
  const ABOVE_LIMIT_SEED = 2n;

  const signers = (approvalMask = ALL): SettingsSigner[] => [
    { key: oldPrimary, permissions: { mask: ALL } },
    { key: approval, permissions: { mask: approvalMask } },
    { key: recovery, permissions: { mask: 2 } },
  ];

  const currentLimit = (policy: PublicKey): SpendingLimit => ({
    policy,
    mint: key(),
    maxPerUse: 100n,
    maxPerPeriod: 500n,
    remainingInPeriod: 400n,
    period: "Daily",
    destinations: [],
  });

  const params = (
    over: Partial<Parameters<typeof buildRotatePrimarySigner>[0]> = {},
  ) => ({
    addresses,
    oldPrimary,
    newPrimary: key(),
    approval,
    signers: signers(),
    spendingLimitSeed: SPENDING_LIMIT_SEED,
    currentLimit: currentLimit(
      derivePolicyAddress(addresses.settings, SPENDING_LIMIT_SEED),
    ),
    aboveLimitSeed: ABOVE_LIMIT_SEED,
    proposer: approval,
    transactionIndex: 3n,
    ...over,
  });

  it("builds when the approval signer holds Initiate and the limit is the policy's", () => {
    const { propose, policies } = buildRotatePrimarySigner(params());
    expect(propose).toHaveLength(2);
    expect(policies).toHaveLength(2);
  });

  it("refuses an approval signer without Initiate, which could not propose it", () => {
    expect(() =>
      buildRotatePrimarySigner(params({ signers: signers(VOTE_AND_EXECUTE) })),
    ).toThrow(SettingsChangeRefusedError);
    expect(() =>
      buildRotatePrimarySigner(params({ signers: signers(VOTE_AND_EXECUTE) })),
    ).toThrow(/does not hold Initiate/);
  });

  it("refuses an approval signer that is not on the Settings", () => {
    expect(() => buildRotatePrimarySigner(params({ approval: key() }))).toThrow(
      /not on the Settings signer set/,
    );
  });

  it("refuses a limit decoded from some other policy", () => {
    expect(() =>
      buildRotatePrimarySigner(params({ currentLimit: currentLimit(key()) })),
    ).toThrow(/not the one at seed 1/);
  });
});

describe("above-limit program allowlist", () => {
  const base = {
    addresses,
    policySeed: 2n,
    primary: key(),
    approval: key(),
    proposer: key(),
    transactionIndex: 1n,
  };

  it("defaults to the system, token and compute programs", () => {
    expect(ABOVE_LIMIT_PROGRAM_ALLOWLIST.map((p) => p.toBase58())).toEqual([
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "ComputeBudget111111111111111111111111111111",
    ]);
    expect(buildCreateAboveLimitPolicy(base).propose).toHaveLength(2);
  });

  it("refuses an empty allowlist, which would switch constraint checking off", () => {
    expect(() =>
      buildCreateAboveLimitPolicy({ ...base, allowedPrograms: [] }),
    ).toThrow(/at least one allowed program/);
  });

  it("refuses a duplicated program", () => {
    expect(() =>
      buildCreateAboveLimitPolicy({
        ...base,
        allowedPrograms: [SYSTEM_PROGRAM_ID, SYSTEM_PROGRAM_ID],
      }),
    ).toThrow(/distinct/);
  });

  it("refuses more programs than the policy can hold", () => {
    const tooMany = Array.from({ length: 21 }, () => key());
    expect(() =>
      buildCreateAboveLimitPolicy({ ...base, allowedPrograms: tooMany }),
    ).toThrow(/at most 20/);
  });
});

describe("spending limit changes", () => {
  const primary = key();
  const approval = key();
  const recovery = key();
  const SPENDING_LIMIT_SEED = 1n;
  const mint = key();
  const policy = derivePolicyAddress(addresses.settings, SPENDING_LIMIT_SEED);

  const signers = (primaryMask = ALL): SettingsSigner[] => [
    { key: primary, permissions: { mask: primaryMask } },
    { key: approval, permissions: { mask: ALL } },
    { key: recovery, permissions: { mask: 2 } },
  ];

  const currentLimit = (over: Partial<SpendingLimit> = {}): SpendingLimit => ({
    policy,
    mint,
    maxPerUse: 100_000_000n,
    maxPerPeriod: 100_000_000n,
    remainingInPeriod: 40_000_000n,
    period: "Daily",
    destinations: [],
    ...over,
  });

  const raised = {
    mint,
    maxPerUse: 250_000_000n,
    maxPerPeriod: 250_000_000n,
    period: "Daily" as const,
    destinations: [],
  };

  const updateParams = (
    over: Partial<Parameters<typeof buildUpdateSpendingLimit>[0]> = {},
  ) => ({
    addresses,
    spendingLimitSeed: SPENDING_LIMIT_SEED,
    currentLimit: currentLimit(),
    terms: raised,
    limitSigner: primary,
    signers: signers(),
    proposer: primary,
    transactionIndex: 4n,
    ...over,
  });

  const removeParams = (
    over: Partial<Parameters<typeof buildRemoveSpendingLimit>[0]> = {},
  ) => ({
    addresses,
    spendingLimitSeed: SPENDING_LIMIT_SEED,
    currentLimit: currentLimit(),
    signers: signers(),
    proposer: primary,
    transactionIndex: 4n,
    ...over,
  });

  it("builds an update that rewrites the policy at the limit's seed", () => {
    const { propose, policies } = buildUpdateSpendingLimit(updateParams());
    expect(propose).toHaveLength(2);
    expect(policies.map((p) => p.toBase58())).toEqual([policy.toBase58()]);
  });

  it("refuses an update whose limit was read off another policy", () => {
    expect(() =>
      buildUpdateSpendingLimit(
        updateParams({ currentLimit: currentLimit({ policy: key() }) }),
      ),
    ).toThrow(SettingsChangeRefusedError);
    expect(() =>
      buildUpdateSpendingLimit(
        updateParams({ currentLimit: currentLimit({ policy: key() }) }),
      ),
    ).toThrow(/not the one at seed 1/);
  });

  it("refuses an update that switches the mint the limit is denominated in", () => {
    expect(() =>
      buildUpdateSpendingLimit(
        updateParams({ terms: { ...raised, mint: key() } }),
      ),
    ).toThrow(/denominated in/);
  });

  it("refuses an update that changes nothing", () => {
    expect(() =>
      buildUpdateSpendingLimit(
        updateParams({
          terms: {
            mint,
            maxPerUse: 100_000_000n,
            maxPerPeriod: 100_000_000n,
            period: "Daily",
            destinations: [],
          },
        }),
      ),
    ).toThrow(/already carries/);
  });

  it("refuses a limit signer the Account does not name", () => {
    expect(() =>
      buildUpdateSpendingLimit(updateParams({ limitSigner: key() })),
    ).toThrow(/cannot be the key the limit answers to/);
  });

  it("refuses a proposer without Initiate", () => {
    expect(() =>
      buildUpdateSpendingLimit(
        updateParams({ signers: signers(VOTE_AND_EXECUTE) }),
      ),
    ).toThrow(/does not hold Initiate/);
    expect(() =>
      buildRemoveSpendingLimit(
        removeParams({ signers: signers(VOTE_AND_EXECUTE) }),
      ),
    ).toThrow(/does not hold Initiate/);
  });

  it("refuses a proposer that is not on the signer set at all", () => {
    expect(() =>
      buildRemoveSpendingLimit(removeParams({ proposer: key() })),
    ).toThrow(/not on the Settings signer set/);
  });

  it("refuses an update whose per-use cap could never be reached", () => {
    expect(() =>
      buildUpdateSpendingLimit(
        updateParams({
          terms: { ...raised, maxPerUse: 300_000_000n },
        }),
      ),
    ).toThrow(/maxPerUse exceeds maxPerPeriod/);
  });

  it("builds a removal naming the policy at the limit's seed", () => {
    const { propose, policies } = buildRemoveSpendingLimit(removeParams());
    expect(propose).toHaveLength(2);
    expect(policies.map((p) => p.toBase58())).toEqual([policy.toBase58()]);
  });

  it("refuses a removal whose limit was read off another policy", () => {
    expect(() =>
      buildRemoveSpendingLimit(
        removeParams({ currentLimit: currentLimit({ policy: key() }) }),
      ),
    ).toThrow(SettingsChangeRefusedError);
  });
});
