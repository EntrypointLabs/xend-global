import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";

import type { SwapQuote } from "@/utils/swapQuote";

export class SwapTransactionError extends Error {}

/**
 * Turns a quote into something signable.
 *
 * Socket returns two shapes for the same pair, chosen per request by whichever
 * venue wins, so both have to work. The reference Bungee widget hard-throws on
 * the serialised shape (`useAutoTxFlow.ts` requires an object with
 * `instructions`), which means copying it would break every bitget route.
 */
export async function buildSwapTransaction(
  quote: SwapQuote,
  payer: PublicKey,
  connection: Connection
): Promise<VersionedTransaction> {
  if (quote.txKind === "versioned") {
    return deserializeVersioned(quote.txPayload);
  }
  return assembleFromInstructions(quote.txPayload, payer, connection);
}

/**
 * The serialised form arrives already partially signed by a co-signer, and its
 * blockhash is the server's. Deserialising and signing is the whole job:
 * rebuilding the message or refreshing the blockhash discards that signature
 * and the transaction is rejected.
 */
function deserializeVersioned(payload: unknown): VersionedTransaction {
  if (typeof payload !== "string") {
    throw new SwapTransactionError("Malformed swap transaction");
  }
  try {
    return VersionedTransaction.deserialize(bs58.decode(payload));
  } catch {
    // Base58, not base64. Jupiter uses base64 for the equivalent field, so a
    // decoder chosen by habit produces bytes that almost parse.
    throw new SwapTransactionError("Could not read the swap transaction");
  }
}

async function assembleFromInstructions(
  payload: unknown,
  payer: PublicKey,
  connection: Connection
): Promise<VersionedTransaction> {
  const source = payload as {
    instructions?: unknown[];
    lookupTables?: unknown[];
  } | null;

  if (!source?.instructions?.length) {
    throw new SwapTransactionError("Malformed swap transaction");
  }

  const instructions = source.instructions.map(toInstruction);
  const lookupTables = await loadLookupTables(source.lookupTables, connection);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  return new VersionedTransaction(message);
}

function toInstruction(raw: any): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys: (raw.keys ?? []).map((key: any) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: !!key.isSigner,
      isWritable: !!key.isWritable,
    })),
    data: Buffer.from(toBytes(raw.data)),
  });
}

/**
 * Instruction data is base64 from one provider and a plain byte array from
 * another. `atob` is absent from Hermes, so decoding goes through Buffer.
 */
export function toBytes(data: unknown): Uint8Array {
  if (typeof data === "string")
    return new Uint8Array(Buffer.from(data, "base64"));
  if (Array.isArray(data)) return Uint8Array.from(data);
  throw new SwapTransactionError("Malformed swap transaction");
}

async function loadLookupTables(
  addresses: unknown[] | undefined,
  connection: Connection
): Promise<AddressLookupTableAccount[]> {
  if (!addresses?.length) return [];

  const accounts = await Promise.all(
    addresses.map((address) =>
      connection.getAddressLookupTable(new PublicKey(String(address)))
    )
  );

  const resolved = accounts
    .map((result) => result.value)
    .filter((value): value is AddressLookupTableAccount => value !== null);

  // A missing table silently drops the accounts it carried, and the
  // transaction fails on chain with an opaque error instead of here.
  if (resolved.length !== addresses.length) {
    throw new SwapTransactionError("Swap route expired, try again");
  }
  return resolved;
}
