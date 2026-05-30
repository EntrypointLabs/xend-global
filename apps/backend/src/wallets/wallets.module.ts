import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { SolanaModule } from '../solana/solana.module';

@Module({
  // Phase 1: SolanaModule provides SOLANA_RPC for the new /wallet/me/*
  // endpoints. GridModule is @Global so the legacy /wallets/me handlers
  // (still calling GridService until Phase 4 cuts mobile over and
  // Phase 5 deletes them) don't need a re-import here.
  imports: [SolanaModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
