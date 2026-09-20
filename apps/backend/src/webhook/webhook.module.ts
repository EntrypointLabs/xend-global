import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { InternalGuard } from '../merchant/internal.guard';
import { ApiKeyGuard } from '../merchant/api-key.guard';
import { MerchantAuditService } from '../merchant/merchant-audit.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookRetryService } from './webhook-retry.service';
import { WebhookAdminController } from './webhook-admin.controller';
import { WebhookEndpointService } from './webhook-endpoint.service';
import { MerchantWebhookEndpointsController } from './merchant-webhook-endpoints.controller';

/**
 * Outbound webhook subsystem. InternalGuard and ApiKeyGuard are re-provided
 * here (small classes over the global DbService) so this module never imports
 * MerchantModule, avoiding a Merchant<->Webhook cycle. MerchantAuditService is
 * re-provided for the same reason: it depends only on the global DbService, so
 * the API-key webhook surface can write the owner-visible audit trail without
 * pulling in MerchantModule. The dispatcher subscribes the EVENT_CONSUMER seam
 * to confirmation/expiry events and materializes deliveries; the retry sweep
 * re-attempts failed rows (the schedule module is registered app-wide in
 * activity.module.ts, not here).
 */
@Module({
  imports: [EventsModule],
  providers: [
    InternalGuard,
    ApiKeyGuard,
    MerchantAuditService,
    WebhookEndpointService,
    WebhookDeliveryService,
    WebhookDispatcherService,
    WebhookRetryService,
  ],
  controllers: [WebhookAdminController, MerchantWebhookEndpointsController],
  exports: [WebhookDeliveryService, WebhookEndpointService],
})
export class WebhookModule {}
