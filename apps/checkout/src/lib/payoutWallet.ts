import { z } from 'zod';

/**
 * Where a Merchant publishes its Prydd payout wallet, on its own site:
 *
 *   { "payoutWallets": { "mainnet": "<address>", "devnet": "<address>" } }
 *
 * Served with `Access-Control-Allow-Origin: *` so this page can read it.
 */
export const PAYOUT_WALLET_PATH = '/.well-known/prydd.json';

const PayoutFileSchema = z.object({
  payoutWallets: z.record(z.string(), z.string()),
});

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class PayoutWalletUnavailableError extends Error {
  constructor(reason: string) {
    super(`the store's payout wallet could not be confirmed: ${reason}`);
    this.name = 'PayoutWalletUnavailableError';
  }
}

function clusterKey(executionCluster: string): string {
  return executionCluster === 'mainnet-beta' ? 'mainnet' : executionCluster;
}

/**
 * The store's origin for this Payment. The page that opened the checkout names
 * itself in the launch URL, which the backend never writes; when it did, the
 * Payment's recorded store has to be that same page.
 */
export function payingStoreOrigin(
  merchantOrigin: string | null,
  opener: string | null,
): string {
  if (!merchantOrigin) {
    throw new PayoutWalletUnavailableError('the Payment names no store');
  }
  if (opener && opener !== merchantOrigin) {
    throw new PayoutWalletUnavailableError(
      'the Payment names a different store than the page you came from',
    );
  }
  return merchantOrigin;
}

/**
 * Reads the wallet the store publishes for Prydd payouts. The backend decides
 * where a Payment goes, so a destination it names proves nothing on its own;
 * the store's own site is the one place it cannot write.
 */
export async function fetchPayoutWallet(
  origin: string,
  executionCluster: string,
  init: { signal?: AbortSignal } = {},
): Promise<string> {
  let body: unknown;
  try {
    const response = await fetch(`${origin}${PAYOUT_WALLET_PATH}`, {
      signal: init.signal,
      headers: { Accept: 'application/json' },
      redirect: 'error',
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new PayoutWalletUnavailableError(`status ${response.status}`);
    }
    body = await response.json();
  } catch (err) {
    if (err instanceof PayoutWalletUnavailableError) throw err;
    throw new PayoutWalletUnavailableError((err as Error).message);
  }

  const parsed = PayoutFileSchema.safeParse(body);
  const key = clusterKey(executionCluster);
  const wallet = parsed.success ? parsed.data.payoutWallets[key] : undefined;
  if (!wallet || !BASE58_ADDRESS.test(wallet)) {
    throw new PayoutWalletUnavailableError(`no wallet for ${key}`);
  }
  return wallet;
}
