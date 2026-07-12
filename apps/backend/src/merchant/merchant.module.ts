import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { FxModule } from '../fx/fx.module';
import { ApiKeyGuard } from './api-key.guard';
import { InternalGuard } from './internal.guard';
import { IdempotencyService } from './idempotency.service';
import { KeyIssuanceService } from './key-issuance.service';
import { MerchantController } from './merchant.controller';

/**
 * The Merchant API surface. Consumes Phase 2's PaymentIntentService and the
 * FX quote seam; owns the API-key guard, the internal ops guard, the
 * Stripe-semantics idempotency layer, and the KYB-gated key-issuance service.
 */
@Module({
  imports: [PaymentModule, FxModule],
  providers: [
    ApiKeyGuard,
    InternalGuard,
    IdempotencyService,
    KeyIssuanceService,
  ],
  controllers: [MerchantController],
  exports: [KeyIssuanceService, IdempotencyService],
})
export class MerchantModule {}
