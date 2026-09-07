import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { CapabilityModule } from '../capability/capability.module';
import { SessionModule } from '../session/session.module';
import { SettlementModule } from '../settlement/settlement.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CheckoutController } from './checkout.controller';

/**
 * The consumer-facing Checkout HTTP surface. Consumes PaymentIntentService,
 * PaymentAuthorizationService, CapacityService, IdentityService, SessionService
 * and SettlementService; owns no new services (the signed return-URL scheme is
 * a pure function). No CORS machinery here (Phase 1 owns the exact-origin
 * allowlist). NotificationsModule is here for the one Payment this surface
 * cannot finish: the Consumer has to be told on the phone that can.
 */
@Module({
  imports: [
    PaymentModule,
    CapabilityModule,
    SessionModule,
    SettlementModule,
    NotificationsModule,
  ],
  controllers: [CheckoutController],
})
export class CheckoutModule {}
