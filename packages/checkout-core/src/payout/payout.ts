/**
 * Where Prydd reads a Merchant's payout wallet. The Prydd app and checkout
 * fetch this from the store's own site and refuse to pay any other wallet, so
 * a Payment can only land where the store itself says.
 */
export const PAYOUT_WALLET_PATH = "/.well-known/prydd.json";

export type PayoutNetwork = "mainnet" | "devnet";

export type PayoutWallets = Partial<Record<PayoutNetwork, string>>;

export interface PayoutWalletFile {
  payoutWallets: PayoutWallets;
}

export class PayoutWalletConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutWalletConfigError";
  }
}

const NETWORKS: readonly PayoutNetwork[] = ["mainnet", "devnet"];
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The file's body. Throws when no wallet is given or one is not a Solana
 * address, so a misconfigured store fails at its own deploy rather than at a
 * shopper's checkout.
 */
export function payoutWalletFile(wallets: PayoutWallets): PayoutWalletFile {
  const payoutWallets: PayoutWallets = {};
  for (const network of NETWORKS) {
    const wallet = wallets[network]?.trim();
    if (!wallet) continue;
    if (!SOLANA_ADDRESS.test(wallet)) {
      throw new PayoutWalletConfigError(
        `the ${network} payout wallet is not a Solana address`,
      );
    }
    payoutWallets[network] = wallet;
  }
  if (Object.keys(payoutWallets).length === 0) {
    throw new PayoutWalletConfigError("no payout wallet was given");
  }
  return { payoutWallets };
}

/**
 * The file as a Fetch API `Response`, ready to return from a route handler at
 * {@link PAYOUT_WALLET_PATH}. It is readable from any origin, because the
 * Prydd checkout reads it from its own page.
 */
export function payoutWalletResponse(wallets: PayoutWallets): Response {
  return new Response(JSON.stringify(payoutWalletFile(wallets)), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
