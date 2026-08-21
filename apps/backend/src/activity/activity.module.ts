import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SolanaModule } from '../solana/solana.module';
import { PricesModule } from '../prices/prices.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TokensModule } from '../tokens/tokens.module';
import { EventParser } from './event-parser';
import { ReconcilerService } from './reconciler.service';
import { TailerService } from './tailer.service';
import { WebhookController } from './webhook.controller';

/**
 * RPC tailer: webhook receiver + reconciler for confirmed transfers.
 *
 * ScheduleModule.forRoot() registers the cron metadata scanner so the
 * @Cron on ReconcilerService.tick() actually fires.
 */
@Module({
  // PricesModule values a transfer at the moment it is indexed.
  // NotificationsModule tells the Consumer when money arrives.
  imports: [
    SolanaModule,
    PricesModule,
    NotificationsModule,
    // TokensModule names the mint an arrival came in.
    TokensModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [WebhookController],
  providers: [TailerService, EventParser, ReconcilerService],
  exports: [TailerService, EventParser, ReconcilerService],
})
export class ActivityModule {}
