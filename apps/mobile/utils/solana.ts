import { Connection, PublicKey } from "@solana/web3.js";
import { NameRegistryState, getDomainKeySync } from "@bonfida/spl-name-service";

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

export async function isSnsName(name: string): Promise<boolean> {
  try {
    const resolvedSns = await resolveSnsName(name);
    return resolvedSns !== null;
  } catch {
    return false;
  }
}

export async function resolveSnsName(domain: string): Promise<string | null> {
  const { pubkey } = getDomainKeySync(domain);

  const { registry } = await NameRegistryState.retrieve(connection, pubkey);

  return registry.owner.toBase58();
}

export function formatAmount(amount: string, decimal: number): string {
  return (Number(amount) / Math.pow(10, decimal)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
