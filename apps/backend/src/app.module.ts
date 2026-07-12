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
import { RedisModule } from './redis/redis.module';
import { EventsModule } from './events/events.module';
import { CountersModule } from './counters/counters.module';
import { CapabilityModule } from './capability/capability.module';
import { PaymentModule } from './payment/payment.module';
import { SessionModule } from './session/session.module';
import { SettlementModule } from './settlement/settlement.module';
import { FxModule } from './fx/fx.module';
import { MerchantModule } from './merchant/merchant.module';
import { CheckoutModule } from './checkout/checkout.module';

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
    RedisModule,
    EventsModule,
    CountersModule,
    CapabilityModule,
    PaymentModule,
    SessionModule,
    SettlementModule,
    FxModule,
    MerchantModule,
    CheckoutModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
