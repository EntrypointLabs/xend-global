import { Module } from '@nestjs/common';
import { PricesModule } from '../prices/prices.module';
import { JupiterPriceHistoryAdapter } from './jupiter-price-history.adapter';
import { JupiterTokenMarketAdapter } from './jupiter-token-market.adapter';
import {
  TOKEN_MARKET_PROVIDER,
  TOKEN_PRICE_HISTORY_PROVIDER,
} from './token-market.interface';
import { TokenOverviewController } from './token-overview.controller';
import { TokenOverviewService } from './token-overview.service';

@Module({
  imports: [PricesModule],
  controllers: [TokenOverviewController],
  providers: [
    TokenOverviewService,
    { provide: TOKEN_MARKET_PROVIDER, useClass: JupiterTokenMarketAdapter },
    {
      provide: TOKEN_PRICE_HISTORY_PROVIDER,
      useClass: JupiterPriceHistoryAdapter,
    },
  ],
})
export class TokenOverviewModule {}
