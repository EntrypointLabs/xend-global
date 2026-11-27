export const PAYOUT_FILE_PATH = "/.well-known/prydd.json";

export type PayoutFileCheck =
  | { state: "match" }
  | { state: "mismatch"; published: string }
  | { state: "missing" };

/**
 * The store's live sites, where shoppers' phones and the checkout look for the
 * payout file. Local development origins are left out: no shopper pays there.
 */
export function storeSites(origins: readonly string[] | null | undefined) {
  const sites: string[] = [];
  for (const origin of origins ?? []) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:") continue;
      if (url.hostname === "localhost" || url.hostname.endsWith(".localhost"))
        continue;
      if (!sites.includes(url.origin)) sites.push(url.origin);
    } catch {
      continue;
    }
  }
  return sites;
}

function networkKey(cluster: string): string {
  return cluster === "mainnet-beta" ? "mainnet" : cluster;
}

/**
 * Reads the payout wallet a site publishes and compares it with the wallet
 * Payments settle to. Shoppers' phones refuse any Payment where the two
 * differ, so a mismatch here means the store cannot be paid.
 */
export async function checkPayoutFile(
  origin: string,
  cluster: string,
  wallet: string,
  init: { signal?: AbortSignal } = {},
): Promise<PayoutFileCheck> {
  let body: unknown;
  try {
    const response = await fetch(`${origin}${PAYOUT_FILE_PATH}`, {
      signal: init.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) return { state: "missing" };
    body = await response.json();
  } catch (error) {
    if (init.signal?.aborted) throw error;
    return { state: "missing" };
  }

  const wallets =
    body && typeof body === "object" && "payoutWallets" in body
      ? (body as { payoutWallets: unknown }).payoutWallets
      : null;
  const published =
    wallets && typeof wallets === "object"
      ? (wallets as Record<string, unknown>)[networkKey(cluster)]
      : undefined;
  if (typeof published !== "string" || published.trim() === "") {
    return { state: "missing" };
  }
  return published.trim() === wallet
    ? { state: "match" }
    : { state: "mismatch", published: published.trim() };
}
