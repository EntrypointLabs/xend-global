import { Module } from '@nestjs/common';
import { RecoveryModule } from '../recovery/recovery.module';
import { WebhookModule } from '../webhook/webhook.module';
import { ConsoleAuthGuard } from './console-auth.guard';
import { ConsoleService } from './console.service';
import { ConsoleController } from './console.controller';

/**
 * Internal ops console (ADR 0022). Imports WebhookModule for its exported
 * WebhookDeliveryService (the in-process manual redelivery capability) and
 * RecoveryModule for the recovery release freeze, which is the one lever
 * support holds over an Account: refusing our own signature, never overriding
 * the Consumer's. DbService comes from the global DbModule. This is disposable
 * pilot tooling, distinct from the merchant-facing self-serve portal.
 */
@Module({
  imports: [WebhookModule, RecoveryModule],
  providers: [ConsoleAuthGuard, ConsoleService],
  controllers: [ConsoleController],
})
export class ConsoleModule {}
