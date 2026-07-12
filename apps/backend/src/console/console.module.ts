import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { ConsoleAuthGuard } from './console-auth.guard';
import { ConsoleService } from './console.service';
import { ConsoleController } from './console.controller';

/**
 * Internal read-only ops console (ADR 0022). Imports WebhookModule for its
 * exported WebhookDeliveryService (the in-process manual redelivery
 * capability, owned by Phase 6). DbService comes from the global DbModule.
 * This is disposable pilot tooling, distinct from the merchant-facing
 * self-serve portal.
 */
@Module({
  imports: [WebhookModule],
  providers: [ConsoleAuthGuard, ConsoleService],
  controllers: [ConsoleController],
})
export class ConsoleModule {}
