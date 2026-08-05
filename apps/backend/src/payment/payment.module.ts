import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { PaymentIntentService } from './payment-intent.service';

/**
 * Durable Payment intent domain. No controller: merchant-facing HTTP (API
 * keys, cancel, response-snapshot idempotency) lands with the Merchant API;
 * these services are consumed in-process for now.
 */
@Module({
  imports: [EventsModule],
  providers: [PaymentIntentService],
  exports: [PaymentIntentService],
})
export class PaymentModule {}
