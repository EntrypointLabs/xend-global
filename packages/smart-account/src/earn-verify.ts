import { Buffer } from "buffer";
import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import { buildEarnInstructions, type BuildEarnParams } from "./earn.js";
/** Rebuild every money-moving byte on the phone, using its own trusted terms. */
export function checkEarnMessage(
  wire: string,
  expected: BuildEarnParams,
  tables: AddressLookupTableAccount[],
): string | null {
  try {
    const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    if (
      !tx.message.staticAccountKeys[0]?.equals(expected.feePayer) ||
      expected.signers.some((s) => s.equals(expected.feePayer)) ||
      expected.feePayer.equals(expected.addresses.vault)
    )
      return "Unexpected fee payer";
    const decoded = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: tables,
    });
    const budget = [];
    const kinds = new Set<number>();
    for (const ix of decoded.instructions) {
      if (!ix.programId.equals(ComputeBudgetProgram.programId)) break;
      const kind = ix.data[0]!;
      if (kinds.has(kind) || ix.keys.length !== 0)
        return "Unexpected compute budget";
      if (
        kind === 2 &&
        ix.data.length === 5 &&
        ix.data.readUInt32LE(1) <= 1_400_000
      ) {
        // A bounded unit-limit instruction is allowed.
      } else if (
        kind === 3 &&
        ix.data.length === 9 &&
        ix.data.readBigUInt64LE(1) <= 1_000_000n
      ) {
        // A bounded sponsor-paid priority fee is allowed.
      } else return "Unexpected compute budget";
      kinds.add(kind);
      budget.push(ix);
    }
    if (!kinds.has(2)) return "Missing compute limit";
    const rebuilt = new TransactionMessage({
      payerKey: expected.feePayer,
      recentBlockhash: tx.message.recentBlockhash,
      instructions: [...budget, ...buildEarnInstructions(expected)],
    }).compileToV0Message(tables);
    const actual = tx.message.serialize(),
      wanted = rebuilt.serialize();
    if (
      actual.length !== wanted.length ||
      actual.some((b, i) => b !== wanted[i])
    )
      return "Earn transaction differs from the amount or product approved";
    return null;
  } catch {
    return "Earn transaction could not be verified";
  }
}
