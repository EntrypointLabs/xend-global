import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { SolanaModule } from '../solana/solana.module';

@Module({
  // SolanaModule provides SOLANA_RPC for the /wallet/me/* endpoints.
  imports: [SolanaModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
