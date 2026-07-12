import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { FxModule } from '../fx/fx.module';
import { SettlementModule } from '../settlement/settlement.module';
import { ApiKeyGuard } from './api-key.guard';
import { InternalGuard } from './internal.guard';
import { IdempotencyService } from './idempotency.service';
import { KeyIssuanceService } from './key-issuance.service';
import { MerchantController } from './merchant.controller';
import { RefundService } from './refund.service';
import { RefundController } from './refund.controller';

/**
 * The Merchant API surface. Consumes Phase 2's PaymentIntentService, the FX
 * quote seam, and Phase 4's SettlementRouter (for refund-in-reverse); owns the
 * API-key guard, the internal ops guard, the Stripe-semantics idempotency
 * layer, the KYB-gated key-issuance service, and the ops refund surface.
 */
@Module({
  imports: [PaymentModule, FxModule, SettlementModule],
  providers: [
    ApiKeyGuard,
    InternalGuard,
    IdempotencyService,
    KeyIssuanceService,
    RefundService,
  ],
  controllers: [MerchantController, RefundController],
  exports: [KeyIssuanceService, IdempotencyService],
})
export class MerchantModule {}
