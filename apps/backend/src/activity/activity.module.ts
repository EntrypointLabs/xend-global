import { Module } from '@nestjs/common';
import { SolanaModule } from '../solana/solana.module';
import { EventParser } from './event-parser';
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
 *   ReconcilerService — 30s poll over outstanding PENDING transfers
 *     (added in Task 2.3).
 *   EventParser — projects Helius decoded payloads into
 *     `ConfirmedTransferEvent`.
 *
 * Spec: docs/specs/migration-already-built-features.md §5.6.
 * Plan:  .claude/plans/xend-grid-migration/phases/phase-2-rpc-tailer/PLAN.md
 */
@Module({
  imports: [SolanaModule],
  controllers: [WebhookController],
  providers: [TailerService, EventParser],
  exports: [TailerService, EventParser],
})
export class ActivityModule {}
