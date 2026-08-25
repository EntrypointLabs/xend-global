import { CLUSTER } from "@/utils/cluster";

/**
 * A Solana explorer link for an address.
 *
 * Carries the cluster, because the same address on devnet and mainnet are
 * different accounts and a link that silently showed the wrong one would look
 * like the key does not exist.
 */
export function explorerAddressUrl(address: string): string {
  const suffix = CLUSTER === "mainnet" ? "" : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}
