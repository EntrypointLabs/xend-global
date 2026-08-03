import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  buildSpend,
  resolveSpendRoute,
  deriveAccountAddresses,
  type SpendingLimit,
} from "../src/index.js";

const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const OTHER_MINT = Keypair.generate().publicKey;
const addresses = deriveAccountAddresses(1n);

const limit = (over: Partial<SpendingLimit> = {}): SpendingLimit => ({
  policy: Keypair.generate().publicKey,
  mint: USDC,
  maxPerUse: 100_000_000n,
  remainingInPeriod: 500_000_000n,
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
    expect(resolveSpendRoute(request(1_000_000n), [])).toEqual({
      kind: "two-signature",
      reason: "no-spending-limit",
    });
  });

  it("routes to one signature when a limit admits the spend", () => {
    const l = limit();
    expect(resolveSpendRoute(request(1_000_000n), [l])).toEqual({
      kind: "spending-limit",
      policy: l.policy,
    });
  });

  it("falls back to two signatures above the per-use cap", () => {
    const route = resolveSpendRoute(request(200_000_000n), [limit()]);
    expect(route).toEqual({
      kind: "two-signature",
      reason: "exceeds-per-use",
    });
  });

  it("falls back to two signatures when the period is spent", () => {
    const route = resolveSpendRoute(request(50_000_000n), [
      limit({ remainingInPeriod: 10_000_000n }),
    ]);
    expect(route).toEqual({
      kind: "two-signature",
      reason: "exceeds-remaining",
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
    );
    expect(route).toEqual({ kind: "two-signature", reason: "different-mint" });
  });

  it("honours a destination allowlist", () => {
    const allowed = Keypair.generate().publicKey;
    const l = limit({ destinations: [allowed] });

    expect(resolveSpendRoute(request(1n, allowed), [l])).toEqual({
      kind: "spending-limit",
      policy: l.policy,
    });
    expect(resolveSpendRoute(request(1n), [l])).toEqual({
      kind: "two-signature",
      reason: "destination-not-allowed",
    });
  });

  it("picks the limit that admits the spend when several exist", () => {
    const usable = limit({ maxPerUse: 500_000_000n });
    const route = resolveSpendRoute(request(200_000_000n), [limit(), usable]);
    expect(route).toEqual({ kind: "spending-limit", policy: usable.policy });
  });
});

describe("buildSpend", () => {
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

  it("builds a two-signature spend against the settings", () => {
    const ix = buildSpend({
      addresses,
      request: { mint: USDC, amount: 1_000_000n, destination: dest },
      route: { kind: "two-signature", reason: "no-spending-limit" },
      signers: [primary, approval],
      decimals: 6,
    });
    expect(ix.keys.some((k) => k.pubkey.equals(primary) && k.isSigner)).toBe(
      true,
    );
    expect(ix.keys.some((k) => k.pubkey.equals(approval) && k.isSigner)).toBe(
      true,
    );
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
        route: { kind: "two-signature", reason: "no-spending-limit" },
        signers: [primary],
        decimals: 6,
      }),
    ).toThrow(/at least two signers/);
  });
});
