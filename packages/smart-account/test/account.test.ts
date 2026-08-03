import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_THRESHOLD,
  assertSignerSet,
  buildCreateAccount,
  deriveAccountAddresses,
  InvalidSignerSetError,
  nextSettingsSeed,
} from "../src/index.js";
import type { SignerSet } from "../src/types.js";

const signerSet = (): SignerSet => [
  { role: "primary", address: Keypair.generate().publicKey },
  { role: "approval", address: Keypair.generate().publicKey },
  { role: "recovery", address: Keypair.generate().publicKey },
];

describe("assertSignerSet", () => {
  it("accepts one signer per role", () => {
    expect(() => assertSignerSet(signerSet())).not.toThrow();
  });

  it("rejects a missing recovery signer", () => {
    const shared = Keypair.generate().publicKey;
    const signers = [
      { role: "primary", address: Keypair.generate().publicKey },
      { role: "approval", address: shared },
      { role: "approval", address: Keypair.generate().publicKey },
    ] as unknown as SignerSet;
    expect(() => assertSignerSet(signers)).toThrow(InvalidSignerSetError);
  });

  it("rejects a duplicate address, which would let one compromise meet the threshold", () => {
    const shared = Keypair.generate().publicKey;
    const signers = [
      { role: "primary", address: shared },
      { role: "approval", address: shared },
      { role: "recovery", address: Keypair.generate().publicKey },
    ] as unknown as SignerSet;
    expect(() => assertSignerSet(signers)).toThrow(/distinct/);
  });
});

describe("deriveAccountAddresses", () => {
  it("returns a vault distinct from the settings account", () => {
    const { settings, vault } = deriveAccountAddresses(42n);
    expect(settings.equals(vault)).toBe(false);
  });

  it("is deterministic for a given seed", () => {
    expect(deriveAccountAddresses(42n).vault.toBase58()).toBe(
      deriveAccountAddresses(42n).vault.toBase58(),
    );
  });

  it("gives different Accounts different addresses", () => {
    expect(deriveAccountAddresses(42n).vault.toBase58()).not.toBe(
      deriveAccountAddresses(43n).vault.toBase58(),
    );
  });
});

describe("nextSettingsSeed", () => {
  it("claims the seed after the current global counter", () => {
    expect(
      nextSettingsSeed({
        treasury: PublicKey.default,
        creationFeeLamports: 0n,
        smartAccountIndex: 502_795n,
      }),
    ).toBe(502_796n);
  });
});

describe("buildCreateAccount", () => {
  it("builds against the deployed program", () => {
    const { instruction } = buildCreateAccount({
      signers: signerSet(),
      creator: Keypair.generate().publicKey,
      treasury: Keypair.generate().publicKey,
      settingsSeed: 1n,
    });
    expect(instruction.programId.toBase58()).toBe(
      "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG",
    );
    expect(instruction.data.length).toBeGreaterThan(0);
  });

  it("refuses to build from an invalid signer set", () => {
    const signers = [
      { role: "primary", address: Keypair.generate().publicKey },
      { role: "primary", address: Keypair.generate().publicKey },
      { role: "recovery", address: Keypair.generate().publicKey },
    ] as unknown as SignerSet;
    expect(() =>
      buildCreateAccount({
        signers,
        creator: Keypair.generate().publicKey,
        treasury: Keypair.generate().publicKey,
        settingsSeed: 1n,
      }),
    ).toThrow(InvalidSignerSetError);
  });

  it("threshold is 2, so no single signer can move funds", () => {
    expect(ACCOUNT_THRESHOLD).toBe(2);
  });
});
