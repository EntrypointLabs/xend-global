import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { SolanaModule } from '../solana/solana.module';

@Module({
  // SolanaModule provides SOLANA_RPC for the /wallet/me/* endpoints.
  // Phase 5 removed the legacy Grid-backed /wallets/me handlers.
  imports: [SolanaModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
