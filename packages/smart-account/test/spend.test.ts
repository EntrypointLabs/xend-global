import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  associatedTokenAddress,
  buildSpend,
  resolveSpendRoute,
  deriveAccountAddresses,
  TOKEN_PROGRAM_ID,
  type SpendingLimit,
} from "../src/index.js";

const NATIVE = PublicKey.default;
const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const OTHER_MINT = Keypair.generate().publicKey;
const addresses = deriveAccountAddresses(1n);
const ABOVE_POLICY = Keypair.generate().publicKey;

const limit = (over: Partial<SpendingLimit> = {}): SpendingLimit => ({
  policy: Keypair.generate().publicKey,
  mint: USDC,
  maxPerUse: 100_000_000n,
  maxPerPeriod: 500_000_000n,
  remainingInPeriod: 500_000_000n,
  period: "Daily",
  destinations: [],
  ...over,
});

const request = (
  amount: bigint,
  destination = Keypair.generate().publicKey,
) => ({
  mint: USDC,
  amount,
  destination,
});

describe("resolveSpendRoute", () => {
  it("routes to two signatures when the Account has no spending limit", () => {
    expect(resolveSpendRoute(request(1_000_000n), [], ABOVE_POLICY)).toEqual({
      kind: "two-signature",
      reason: "no-spending-limit",
      policy: ABOVE_POLICY,
    });
  });

  it("routes to one signature when a limit admits the spend", () => {
    const l = limit();
    expect(resolveSpendRoute(request(1_000_000n), [l], ABOVE_POLICY)).toEqual({
      kind: "spending-limit",
      policy: l.policy,
    });
  });

  it("falls back to two signatures above the per-use cap", () => {
    const route = resolveSpendRoute(
      request(200_000_000n),
      [limit()],
      ABOVE_POLICY,
    );
    expect(route).toEqual({
      kind: "two-signature",
      reason: "exceeds-per-use",
      policy: ABOVE_POLICY,
    });
  });

  it("falls back to two signatures when the period is spent", () => {
    const route = resolveSpendRoute(
      request(50_000_000n),
      [limit({ remainingInPeriod: 10_000_000n })],
      ABOVE_POLICY,
    );
    expect(route).toEqual({
      kind: "two-signature",
      reason: "exceeds-remaining",
      policy: ABOVE_POLICY,
    });
  });

  it("falls back to two signatures for a mint the limit does not cover", () => {
    const route = resolveSpendRoute(
      {
        mint: OTHER_MINT,
        amount: 1n,
        destination: Keypair.generate().publicKey,
      },
      [limit()],
      ABOVE_POLICY,
    );
    expect(route).toEqual({
      kind: "two-signature",
      reason: "different-mint",
      policy: ABOVE_POLICY,
    });
  });

  it("honours a destination allowlist", () => {
    const allowed = Keypair.generate().publicKey;
    const l = limit({ destinations: [allowed] });

    expect(resolveSpendRoute(request(1n, allowed), [l], ABOVE_POLICY)).toEqual({
      kind: "spending-limit",
      policy: l.policy,
    });
    expect(resolveSpendRoute(request(1n), [l], ABOVE_POLICY)).toEqual({
      kind: "two-signature",
      reason: "destination-not-allowed",
      policy: ABOVE_POLICY,
    });
  });

  it("picks the limit that admits the spend when several exist", () => {
    const usable = limit({ maxPerUse: 500_000_000n });
    const route = resolveSpendRoute(
      request(200_000_000n),
      [limit(), usable],
      ABOVE_POLICY,
    );
    expect(route).toEqual({ kind: "spending-limit", policy: usable.policy });
  });
});

const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

describe("buildSpend", () => {
  it("gives a token spend the accounts the policy reads, not the native ones", () => {
    // The program branches on the policy's mint: a token needs both token
    // accounts, the mint and its program. Handing it the native list is what
    // failed on chain as InvalidNumberOfAccounts, with the Consumer told only
    // that the network was unavailable.
    const l = limit();
    const ix = buildSpend({
      addresses,
      request: { mint: USDC, amount: 1_000_000n, destination: dest },
      route: { kind: "spending-limit", policy: l.policy },
      signers: [primary],
      decimals: 6,
      tokenProgram: TOKEN_PROGRAM,
    });

    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keys).toContain(
      associatedTokenAddress(addresses.vault, USDC, TOKEN_PROGRAM).toBase58(),
    );
    expect(keys).toContain(
      associatedTokenAddress(dest, USDC, TOKEN_PROGRAM).toBase58(),
    );
    expect(keys).toContain(USDC.toBase58());
    expect(keys).toContain(TOKEN_PROGRAM.toBase58());
  });

  it("refuses a token spend with no token program rather than guessing one", () => {
    const l = limit();
    expect(() =>
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 1_000_000n, destination: dest },
        route: { kind: "spending-limit", policy: l.policy },
        signers: [primary],
        decimals: 6,
      }),
    ).toThrow(/token program/);
  });

  const dest = Keypair.generate().publicKey;
  const primary = Keypair.generate().publicKey;
  const approval = Keypair.generate().publicKey;

  it("builds a one-signature spend under a limit", () => {
    const l = limit();
    const ix = buildSpend({
      addresses,
      request: { mint: USDC, amount: 1_000_000n, destination: dest },
      route: { kind: "spending-limit", policy: l.policy },
      signers: [primary],
      decimals: 6,
      tokenProgram: TOKEN_PROGRAM,
    });
    // The anchor accounts (policy, program) lead, then the remaining accounts.
    expect(ix.keys.some((k) => k.pubkey.equals(primary) && k.isSigner)).toBe(
      true,
    );
    expect(ix.keys.some((k) => k.pubkey.equals(l.policy))).toBe(true);
    expect(
      ix.keys.some((k) => k.pubkey.equals(addresses.vault) && k.isWritable),
    ).toBe(true);
    expect(ix.keys.filter((k) => k.isSigner)).toHaveLength(1);
  });

  it("builds a two-signature spend against the above-limit policy", () => {
    const ix = buildSpend({
      addresses,
      request: { mint: NATIVE, amount: 1_000_000n, destination: dest },
      route: {
        kind: "two-signature",
        reason: "no-spending-limit",
        policy: ABOVE_POLICY,
      },
      signers: [primary, approval],
      decimals: 9,
    });
    expect(ix.keys.some((k) => k.pubkey.equals(primary) && k.isSigner)).toBe(
      true,
    );
    expect(ix.keys.some((k) => k.pubkey.equals(approval) && k.isSigner)).toBe(
      true,
    );
  });

  it("refuses a two-signature spend whose program is off the policy's allowlist", () => {
    expect(() =>
      buildSpend({
        addresses,
        request: { mint: NATIVE, amount: 1_000_000n, destination: dest },
        route: {
          kind: "two-signature",
          reason: "no-spending-limit",
          policy: ABOVE_POLICY,
        },
        signers: [primary, approval],
        decimals: 9,
        allowedPrograms: [TOKEN_PROGRAM_ID],
      }),
    ).toThrow(/not on the above-limit program allowlist/);
  });

  it("refuses a limit route carrying more than one signer", () => {
    expect(() =>
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 1n, destination: dest },
        route: { kind: "spending-limit", policy: Keypair.generate().publicKey },
        signers: [primary, approval],
        decimals: 6,
      }),
    ).toThrow(/exactly one signer/);
  });

  it("refuses a two-signature route carrying one signer", () => {
    expect(() =>
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 1n, destination: dest },
        route: {
          kind: "two-signature",
          reason: "no-spending-limit",
          policy: ABOVE_POLICY,
        },
        signers: [primary],
        decimals: 6,
      }),
    ).toThrow(/at least two signers/);
  });

  it("carries a token on the two-signature route, naming both token accounts", () => {
    // This route built a SystemProgram.transfer whatever the mint said, which
    // read the amount as lamports and moved SOL while the row recorded USDC.
    const ix = buildSpend({
      addresses,
      request: { mint: USDC, amount: 1_000_000n, destination: dest },
      route: {
        kind: "two-signature",
        reason: "exceeds-per-use",
        policy: ABOVE_POLICY,
      },
      signers: [primary, approval],
      decimals: 6,
      tokenProgram: TOKEN_PROGRAM,
    });

    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keys).toContain(
      associatedTokenAddress(addresses.vault, USDC, TOKEN_PROGRAM).toBase58(),
    );
    expect(keys).toContain(
      associatedTokenAddress(dest, USDC, TOKEN_PROGRAM).toBase58(),
    );
    expect(keys).toContain(TOKEN_PROGRAM.toBase58());
    // The recipient's wallet is only an ATA seed here; the transfer names the
    // token account, so the wallet itself must not appear.
    expect(keys).not.toContain(dest.toBase58());
    expect(keys).not.toContain(SystemProgram.programId.toBase58());
  });

  it("refuses a token on the two-signature route with no token program", () => {
    expect(() =>
      buildSpend({
        addresses,
        request: { mint: USDC, amount: 1_000_000n, destination: dest },
        route: {
          kind: "two-signature",
          reason: "exceeds-per-use",
          policy: ABOVE_POLICY,
        },
        signers: [primary, approval],
        decimals: 6,
      }),
    ).toThrow(/token program/);
  });
});
