import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  buildEarnInstructions,
  earnProviderAccounts,
  earnAuthority,
  type BuildEarnParams,
} from "../src/earn.js";
import { checkEarnMessage } from "../src/earn-verify.js";
import { ABOVE_LIMIT_PROGRAM_ALLOWLIST } from "../src/programs.js";
import { deriveAccountAddresses, derivePolicyAddress } from "../src/pda.js";
const key = () => Keypair.generate().publicKey;
function setup(): BuildEarnParams {
  const addresses = deriveAccountAddresses(42n);
  return {
    provider: "kamino",
    action: "deposit",
    amount: 1000000n,
    minimumOut: 100n,
    addresses,
    policy: derivePolicyAddress(addresses.settings, 2n),
    signers: [key(), key()],
    allowedPrograms: ABOVE_LIMIT_PROGRAM_ALLOWLIST,
    forwarderProgram: key(),
    feePayer: key(),
  };
}
function wire(
  expected: BuildEarnParams,
  change?: (ixs: ReturnType<typeof buildEarnInstructions>) => void,
) {
  const ixs = buildEarnInstructions(expected);
  change?.(ixs);
  const addresses = [
    ...new Map(
      earnProviderAccounts(
        expected.provider,
        expected.action,
        earnAuthority(expected.addresses.vault, expected.forwarderProgram),
      ).map((a) => [a.pubkey.toBase58(), a.pubkey]),
    ).values(),
  ];
  const table = new AddressLookupTableAccount({
    key: key(),
    state: {
      addresses,
      deactivationSlot: 0xffffffffffffffffn,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      isActive: true,
    },
  } as unknown as ConstructorParameters<typeof AddressLookupTableAccount>[0]);
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: expected.feePayer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
        ...ixs,
      ],
    }).compileToV0Message([table]),
  );
  return {
    encoded: Buffer.from(tx.serialize()).toString("base64"),
    tables: [table],
  };
}
describe("phone Earn message checks", () => {
  it.each(["kamino", "jupiter"] as const)(
    "accepts exactly the selected %s deposit and withdrawal",
    (provider) => {
      for (const action of ["deposit", "redeem"] as const) {
        const expected = { ...setup(), provider, action };
        const { encoded, tables } = wire(expected);
        expect(checkEarnMessage(encoded, expected, tables)).toBeNull();
      }
    },
  );
  it.each(["amount", "minimum", "recipient", "provider", "revoke"])(
    "refuses a changed %s before either signature",
    (kind) => {
      const expected = setup();
      const { encoded, tables } = wire(expected, (ixs) => {
        if (kind === "amount") ixs[4]!.data.writeBigUInt64LE(2000000n, 3);
        if (kind === "minimum") ixs[4]!.data.writeBigUInt64LE(1n, 11);
        if (kind === "recipient") ixs[4]!.keys[6]!.pubkey = key();
        if (kind === "provider") ixs[4]!.keys[10]!.pubkey = key();
        if (kind === "revoke") ixs.pop();
      });
      expect(checkEarnMessage(encoded, expected, tables)).not.toBeNull();
    },
  );
  it("uses a policy's existing constraint ordering and refuses a different signer", () => {
    const expected = {
      ...setup(),
      allowedPrograms: [...ABOVE_LIMIT_PROGRAM_ALLOWLIST].reverse(),
    };
    const { encoded, tables } = wire(expected);
    expect(checkEarnMessage(encoded, expected, tables)).toBeNull();
    expect(
      checkEarnMessage(
        encoded,
        { ...expected, signers: [expected.signers[0]!, key()] },
        tables,
      ),
    ).not.toBeNull();
  });
  it("does not make an Account signer pay the sponsor's fee", () => {
    const expected = setup();
    const { encoded, tables } = wire(expected);
    expect(
      checkEarnMessage(
        encoded,
        { ...expected, feePayer: expected.signers[0]! },
        tables,
      ),
    ).not.toBeNull();
  });
});
