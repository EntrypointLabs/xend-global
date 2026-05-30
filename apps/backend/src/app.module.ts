import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { GridModule } from './grid/grid.module';
import { AuthModule } from './auth/auth.module';
import { WalletsModule } from './wallets/wallets.module';
import { TransactionsModule } from './transactions/transactions.module';
// Phase 0 (Grid migration): new provider-neutral modules. Stub adapters only;
// nothing consumes them yet. GridModule stays alongside until the Phase 5
// cleanup. See .claude/plans/xend-grid-migration/.
import { WalletModule } from './wallet/wallet.module';
import { SolanaModule } from './solana/solana.module';
import { KycModule } from './kyc/kyc.module';
// Phase 1: new transfer module (prepare/submit/list) mounted at
// /transfers/*. Legacy TransactionsModule stays alongside.
import { TransferModule } from './transfer/transfer.module';
// Phase 2: RPC tailer (webhook receiver + reconciler) lives here.
// Owns POST /webhooks/helius and the 30s ReconcilerService cron tick.
import { ActivityModule } from './activity/activity.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    GridModule,
    AuthModule,
    WalletsModule,
    TransactionsModule,
    WalletModule,
    SolanaModule,
    KycModule,
    TransferModule,
    ActivityModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
