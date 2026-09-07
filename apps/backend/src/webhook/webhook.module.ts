import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { InternalGuard } from '../merchant/internal.guard';
import { ApiKeyGuard } from '../merchant/api-key.guard';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookRetryService } from './webhook-retry.service';
import { WebhookAdminController } from './webhook-admin.controller';
import { WebhookEndpointService } from './webhook-endpoint.service';
import { MerchantWebhookEndpointsController } from './merchant-webhook-endpoints.controller';

/**
 * Outbound webhook subsystem. InternalGuard and ApiKeyGuard are re-provided
 * here (small classes over the global DbService) so this module never imports
 * MerchantModule, avoiding a Merchant<->Webhook cycle. The dispatcher subscribes the EVENT_CONSUMER seam
 * to confirmation/expiry events and materializes deliveries; the retry sweep
 * re-attempts failed rows (the schedule module is registered app-wide in
 * activity.module.ts, not here).
 */
@Module({
  imports: [EventsModule],
  providers: [
    InternalGuard,
    ApiKeyGuard,
    WebhookEndpointService,
    WebhookDeliveryService,
    WebhookDispatcherService,
    WebhookRetryService,
  ],
  controllers: [WebhookAdminController, MerchantWebhookEndpointsController],
  exports: [WebhookDeliveryService, WebhookEndpointService],
})
export class WebhookModule {}
