import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { WalletsModule } from './wallets/wallets.module';
import { WalletModule } from './wallet/wallet.module';
import { SolanaModule } from './solana/solana.module';
import { KycModule } from './kyc/kyc.module';
import { TransferModule } from './transfer/transfer.module';
import { ActivityModule } from './activity/activity.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    AuthModule,
    WalletsModule,
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
