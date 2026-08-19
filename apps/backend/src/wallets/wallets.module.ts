import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { SolanaModule } from '../solana/solana.module';
import { PricesModule } from '../prices/prices.module';
import { TokensModule } from '../tokens/tokens.module';

@Module({
  // SolanaModule provides SOLANA_RPC for the /wallet/me/* endpoints;
  // PricesModule provides TOKEN_PRICE_PROVIDER for their USD values.
  imports: [SolanaModule, PricesModule, TokensModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
