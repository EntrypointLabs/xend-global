import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

import { CLUSTER, type SolanaCluster } from "@/utils/cluster";

export const PAYOUT_WALLET_PATH = "/.well-known/prydd.json";

const PayoutFileSchema = z.object({
  payoutWallets: z.record(z.string(), z.string()),
});

export class PayoutWalletUnavailableError extends Error {
  constructor(reason: string) {
    super(`the store's payout wallet could not be confirmed: ${reason}`);
    this.name = "PayoutWalletUnavailableError";
  }
}

/** The store's web origin, or null when it is not a plain https origin. */
export function storeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Reads the wallet a Merchant publishes on its own site for Prydd payouts.
 *
 * The backend decides where a Payment goes, so a destination it names proves
 * nothing on its own. The store's site is the one place the backend cannot
 * write, and the Consumer can see which store they are paying.
 */
export async function fetchPayoutWallet(
  origin: string,
  options: { cluster?: SolanaCluster; timeoutMs?: number } = {}
): Promise<string> {
  const cluster = options.cluster ?? CLUSTER;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  let body: unknown;
  try {
    const response = await fetch(`${origin}${PAYOUT_WALLET_PATH}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) {
      throw new PayoutWalletUnavailableError(`status ${response.status}`);
    }
    body = await response.json();
  } catch (err) {
    if (err instanceof PayoutWalletUnavailableError) throw err;
    throw new PayoutWalletUnavailableError((err as Error).message);
  } finally {
    clearTimeout(timer);
  }

  const parsed = PayoutFileSchema.safeParse(body);
  const wallet = parsed.success ? parsed.data.payoutWallets[cluster] : null;
  if (!wallet) {
    throw new PayoutWalletUnavailableError(`no wallet for ${cluster}`);
  }
  try {
    return new PublicKey(wallet).toBase58();
  } catch {
    throw new PayoutWalletUnavailableError("the wallet is not an address");
  }
}
