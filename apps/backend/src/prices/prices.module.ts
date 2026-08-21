import { Module } from '@nestjs/common';
import { JupiterPriceAdapter } from './jupiter-price.adapter';
import { PinnedStablecoinPriceProvider } from './pinned-stablecoin-price.provider';
import { TOKEN_PRICE_PROVIDER } from './token-price.interface';

@Module({
  providers: [
    JupiterPriceAdapter,
    PinnedStablecoinPriceProvider,
    {
      provide: TOKEN_PRICE_PROVIDER,
      useClass: PinnedStablecoinPriceProvider,
    },
  ],
  exports: [TOKEN_PRICE_PROVIDER],
})
export class PricesModule {}
