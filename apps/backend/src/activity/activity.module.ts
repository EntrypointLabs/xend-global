import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SolanaModule } from '../solana/solana.module';
import { EventParser } from './event-parser';
import { ReconcilerService } from './reconciler.service';
import { TailerService } from './tailer.service';
import { WebhookController } from './webhook.controller';

/**
 * ActivityModule — Phase 2 RPC tailer (webhook receiver + reconciler).
 *
 * Endpoints:
 *   POST /webhooks/helius — Helius webhook delivery target.
 *
 * Services:
 *   TailerService — single-write path for confirmed transfers
 *     (UPSERT with status guard).
 *   ReconcilerService — boot-time replay (onModuleInit) + 30s @Cron
 *     tick over outstanding PENDING transfers.
 *   EventParser — projects Helius decoded payloads into
 *     `ConfirmedTransferEvent`.
 *
 * ScheduleModule.forRoot() registers the cron metadata scanner so
 * @Cron('*\/30 * * * * *') on ReconcilerService.tick() actually fires.
 *
 * Spec: docs/specs/migration-already-built-features.md §5.6.
 * Plan:  .claude/plans/xend-grid-migration/phases/phase-2-rpc-tailer/PLAN.md
 */
@Module({
  imports: [SolanaModule, ScheduleModule.forRoot()],
  controllers: [WebhookController],
  providers: [TailerService, EventParser, ReconcilerService],
  exports: [TailerService, EventParser, ReconcilerService],
})
export class ActivityModule {}
