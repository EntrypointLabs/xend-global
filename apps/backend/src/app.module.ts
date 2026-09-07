import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountModule } from './account/account.module';
import { RecoveryModule } from './recovery/recovery.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { EntrySessionModule } from './auth/entry-session.module';
import { WalletsModule } from './wallets/wallets.module';
import { WalletModule } from './wallet/wallet.module';
import { SolanaModule } from './solana/solana.module';
import { KycModule } from './kyc/kyc.module';
import { TransferModule } from './transfer/transfer.module';
import { ActivityModule } from './activity/activity.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RedisModule } from './redis/redis.module';
import { EventsModule } from './events/events.module';
import { CountersModule } from './counters/counters.module';
import { CapabilityModule } from './capability/capability.module';
import { PaymentModule } from './payment/payment.module';
import { PendingPaymentModule } from './payment/pending-payment.module';
import { SessionModule } from './session/session.module';
import { SettlementModule } from './settlement/settlement.module';
import { FxModule } from './fx/fx.module';
import { MerchantModule } from './merchant/merchant.module';
import { CheckoutModule } from './checkout/checkout.module';
import { WebhookModule } from './webhook/webhook.module';
import { ConsoleModule } from './console/console.module';
import { TestDashboardModule } from './test-dashboard/test-dashboard.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { TracingModule } from './tracing/tracing.module';
import { THROTTLE_LIMITS } from './common/throttle';

// Module metadata is evaluated at import time, before ConfigService exists,
// so the production check reads the raw environment. The dashboard mints
// Merchant API keys with no auth and must not exist in production at all.
const testDashboardEnabled = process.env.NODE_ENV !== 'production';

@Module({
  imports: [
    NotificationsModule,
    ConfigModule,
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ...THROTTLE_LIMITS.default },
        { name: 'auth', ...THROTTLE_LIMITS.auth },
      ],
    }),
    DbModule,
    HealthModule,
    MetricsModule,
    TracingModule,
    EntrySessionModule,
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
    PendingPaymentModule,
    SessionModule,
    SettlementModule,
    FxModule,
    MerchantModule,
    CheckoutModule,
    WebhookModule,
    ConsoleModule,
    ...(testDashboardEnabled ? [TestDashboardModule] : []),
    RecoveryModule,
    AccountModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
