/**
 * Read-only pricing probe. Run from apps/backend:
 * node --env-file=.env -r ts-node/register scripts/check-checkout-fx.ts
 * Prints only price metadata, never credentials. Does not create an order.
 */
import { ConfigService } from '@nestjs/config';
import { PartnerFxAdapter } from '../src/fx/partner-fx.adapter';
import { localMinorToUsdcRaw } from '../src/fx/fx-math';

async function main() {
  if (!process.env.BLOCKRADAR_API_KEY) {
    throw new Error(
      'BLOCKRADAR_API_KEY is required for the live pricing probe',
    );
  }
  const config = new ConfigService({
    FX_QUOTE_SOURCE: 'blockradar',
    BLOCKRADAR_API_KEY: process.env.BLOCKRADAR_API_KEY,
    SOLANA_CLUSTER: 'mainnet',
    FX_QUOTE_TIMEOUT_MS: 5000,
  });
  const quote = await new PartnerFxAdapter(config).getQuote();
  const scale = Math.max(6, quote.ngnPerUsdc.split('.')[1]?.length ?? 0);
  console.log(
    JSON.stringify(
      {
        pair: 'USDC/NGN',
        ngnPerUsdc: quote.ngnPerUsdc,
        source: quote.source,
        observedAt: quote.quotedAt.toISOString(),
        kind: 'reference-price-only',
        example: {
          displayCurrency: 'NGN',
          displayAmountMinor: '800000',
          usdcSettlementRaw: localMinorToUsdcRaw(
            '800000',
            quote.ngnPerUsdc,
            scale,
            'NGN',
          ),
          createsPayment: false,
        },
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Pricing probe failed',
  );
  process.exitCode = 1;
});
