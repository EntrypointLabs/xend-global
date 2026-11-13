import { Connection, PublicKey } from "@solana/web3.js";
import { ErrorType, SNSError, resolve } from "@bonfida/spl-name-service";

import { SOLANA_RPC_URL } from "@/utils/cluster";

const connection = new Connection(SOLANA_RPC_URL);

export function isPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether an address could ever sign, and so could ever be a recovery key.
 *
 * Stricter than {@link isPublicKey} on purpose. Any 32 bytes parse as a
 * PublicKey, including program-derived addresses, which sit off the Ed25519
 * curve and have no private key at all. One of those accepted as a recovery
 * key would look completely normal and be unable to sign the day it was needed.
 */
export function isSignerAddress(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

export type NameLookupFailure = "not-found" | "unavailable";

/**
 * A `.sol` lookup that did not produce an address. `not-found` means the name
 * is unregistered; `unavailable` means the RPC could not answer (rate limit,
 * network), so the name may be perfectly fine and the Consumer should retry.
 */
export class NameLookupError extends Error {
  constructor(
    readonly failure: NameLookupFailure,
    message: string
  ) {
    super(message);
    this.name = "NameLookupError";
  }
}

const NOT_FOUND_TYPES: string[] = [
  ErrorType.AccountDoesNotExist,
  ErrorType.DomainDoesNotExist,
  ErrorType.NoAccountData,
  ErrorType.InvalidDomain,
  ErrorType.InvalidSubdomain,
  ErrorType.NftRecordNotFound,
  ErrorType.CouldNotFindNftOwner,
];

export async function isSnsName(name: string): Promise<boolean> {
  try {
    await resolveSnsName(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a `.sol` name to the address that receives funds.
 *
 * Goes through the SDK's resolver rather than reading the registry owner: a
 * tokenized name's registry owner is the NFT program, not the holder, so the
 * owner read sent such names to the wrong place. Program-derived addresses are
 * allowed because a Squads vault is one.
 */
export async function resolveSnsName(domain: string): Promise<string> {
  try {
    const address = await resolve(connection, domain.trim().toLowerCase(), {
      allowPda: "any",
    });
    return address.toBase58();
  } catch (err) {
    if (err instanceof SNSError && NOT_FOUND_TYPES.includes(err.type)) {
      throw new NameLookupError("not-found", "No matching address found");
    }
    throw new NameLookupError(
      "unavailable",
      "Couldn't look up that name. Try again in a moment."
    );
  }
}

export function formatAmount(amount: string, decimal: number): string {
  return (Number(amount) / Math.pow(10, decimal)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
