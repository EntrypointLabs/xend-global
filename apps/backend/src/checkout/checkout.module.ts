import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { CapabilityModule } from '../capability/capability.module';
import { SessionModule } from '../session/session.module';
// TEST ONLY — never production: SettlementModule is imported so the controller
// can reach the dev-only settlement short-circuit (SettlementConfirmationService.
// devForceSettleSucceeded). The real settlement flow is unaffected.
import { SettlementModule } from '../settlement/settlement.module';
import { CheckoutController } from './checkout.controller';

/**
 * The consumer-facing Checkout HTTP surface. Consumes Phase 2's
 * PaymentIntentService, PaymentAuthorizationService, IdentityService, and
 * SessionService; owns no new services (the signed return-URL scheme is a pure
 * function). No CORS machinery here (Phase 1 owns the exact-origin allowlist).
 */
@Module({
  imports: [PaymentModule, CapabilityModule, SessionModule, SettlementModule],
  controllers: [CheckoutController],
})
export class CheckoutModule {}
