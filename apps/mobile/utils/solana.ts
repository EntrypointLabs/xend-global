import { Connection, PublicKey } from "@solana/web3.js";
import { NameRegistryState, getDomainKeySync } from "@bonfida/spl-name-service";

// RPC endpoint for SNS resolution. Read from the environment so it follows
// the same devnet/mainnet toggle as the rest of the app and no provider API
// key is embedded in the device bundle. Falls back to the public devnet RPC.
const SOLANA_RPC_URL =
  process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const connection = new Connection(SOLANA_RPC_URL);

export function isPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
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
