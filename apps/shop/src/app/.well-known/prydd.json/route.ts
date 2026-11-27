import {
  PayoutWalletConfigError,
  payoutWalletResponse,
} from "@prydd/checkout-core/payout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return payoutWalletResponse({
      mainnet: process.env.PRYDD_PAYOUT_WALLET_MAINNET,
      devnet: process.env.PRYDD_PAYOUT_WALLET_DEVNET,
    });
  } catch (err) {
    if (err instanceof PayoutWalletConfigError)
      return new Response(err.message, { status: 404 });
    throw err;
  }
}
