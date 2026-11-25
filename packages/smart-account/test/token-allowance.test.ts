import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { buildTokenAllowance } from "../src/token-allowance.js";
import { TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../src/programs.js";
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const params = {
  addresses: { settings: key(1), vault: key(2) },
  policy: key(3),
  signers: [key(4), key(5)],
  delegate: key(4),
  mint: key(6),
  amount: 1000000n,
  allowedPrograms: [SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID],
};
describe("existing Account token allowance", () => {
  it("builds both grant and cleanup using the current Token policy", () => {
    const result = buildTokenAllowance(params);
    expect(result.grant.programId.equals(result.revoke.programId)).toBe(true);
    expect(
      result.grant.keys.some(
        (k) => k.pubkey.equals(params.delegate) && k.isSigner,
      ),
    ).toBe(true);
    expect(
      result.revoke.keys.some(
        (k) => k.pubkey.equals(params.signers[1]!) && k.isSigner,
      ),
    ).toBe(true);
    expect(result.grant.keys.some((k) => k.pubkey.equals(result.source))).toBe(
      true,
    );
  });
  it("refuses a non-signing delegate or one repeated signer", () => {
    expect(() =>
      buildTokenAllowance({ ...params, delegate: key(7) }),
    ).toThrow();
    expect(() =>
      buildTokenAllowance({ ...params, signers: [key(4), key(4)] }),
    ).toThrow();
  });
  it("refuses missing policy permission and unbounded approvals", () => {
    expect(() =>
      buildTokenAllowance({ ...params, allowedPrograms: [SYSTEM_PROGRAM_ID] }),
    ).toThrow();
    for (const amount of [0n, -1n, 1n << 64n])
      expect(() => buildTokenAllowance({ ...params, amount })).toThrow();
  });
});
