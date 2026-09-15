import { Module, Global } from '@nestjs/common';
import { DbService } from './db.service';
import { InboundWebhookDedupe } from './inbound-webhook-dedupe';

@Global()
@Module({
  providers: [DbService, InboundWebhookDedupe],
  exports: [DbService, InboundWebhookDedupe],
})
export class DbModule {}
