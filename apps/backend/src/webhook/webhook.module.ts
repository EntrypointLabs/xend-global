import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { InternalGuard } from '../merchant/internal.guard';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookRetryService } from './webhook-retry.service';
import { WebhookAdminController } from './webhook-admin.controller';

/**
 * Outbound webhook subsystem. InternalGuard is re-provided here (a small
 * stateless class) so this module never imports MerchantModule, avoiding a
 * Merchant<->Webhook cycle. The dispatcher subscribes the EVENT_CONSUMER seam
 * to confirmation/expiry events and materializes deliveries; the retry sweep
 * re-attempts failed rows (the schedule module is registered app-wide in
 * activity.module.ts, not here).
 */
@Module({
  imports: [EventsModule],
  providers: [
    InternalGuard,
    WebhookDeliveryService,
    WebhookDispatcherService,
    WebhookRetryService,
  ],
  controllers: [WebhookAdminController],
  exports: [WebhookDeliveryService],
})
export class WebhookModule {}
