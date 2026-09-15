import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../../../db/db.service';
import {
  InboundWebhookDedupe,
  assertFreshTimestamp,
} from '../../../db/inbound-webhook-dedupe';
import { settlementOfframps } from '../../../db/schema';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../events/event-publisher.interface';
import { SettlementConfirmationService } from '../../settlement-confirmation.service';
import { BlockradarSettlementProvider } from './blockradar-settlement.provider';

/**
 * POST /webhooks/blockradar — the Blockradar off-ramp status receiver
 * (Pattern 4). Flow: kill switch -> raw-body HMAC verify BEFORE any DB access
 * -> timestamp tolerance -> parse -> claim the provider event id -> conditional
 * idempotent status transition on the off-ramp row.
 *
 * On a 'paid' event (naira landed) it builds a SettlementCompletion and drives
 * completion through Phase 4's completeDeferredSettlement(paymentId, completion)
 * — the seam that runs settling->succeeded and publishes payment.succeeded. The
 * adapter never transitions the intent or publishes payment.succeeded itself.
 * Blockradar redelivers on non-2xx, so an owned-event persistence failure
 * throws 500; replays of an already-terminal row are no-ops.
 *
 * The controller lives in the Blockradar adapter directory (ADR 0010 Grid rule)
 * but is registered by SettlementModule so it can reach completeDeferredSettlement
 * without a module cycle.
 */
const PROVIDER = 'blockradar';

@Controller('webhooks')
export class BlockradarWebhookController {
  private readonly logger = new Logger(BlockradarWebhookController.name);

  constructor(
    private readonly db: DbService,
    private readonly provider: BlockradarSettlementProvider,
    private readonly confirmation: SettlementConfirmationService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    private readonly config: ConfigService,
    private readonly dedupe: InboundWebhookDedupe,
  ) {}

  /**
   * SETTLEMENT_WEBHOOK_KILLSWITCH: acknowledge deliveries without verifying,
   * parsing, or writing. A one-line operator toggle (env var, not a table).
   */
  private killSwitchActive(): boolean {
    return this.config.get<boolean>('SETTLEMENT_WEBHOOK_KILLSWITCH') === true;
  }

  @Post('blockradar')
  @HttpCode(200)
  async receive(
    @Req() reqUnknown: unknown,
    @Headers('x-blockradar-signature') signature: string,
    @Headers('x-blockradar-timestamp') timestamp: string | undefined,
    @Body() bodyParsed: unknown,
  ): Promise<{
    ok: true;
    killSwitched?: boolean;
    skipped?: boolean;
    replayed?: boolean;
  }> {
    if (this.killSwitchActive()) {
      this.logger.warn('settlement.offramp.webhook killSwitched');
      return { ok: true, killSwitched: true };
    }

    const req = reqUnknown as Request & { rawBody?: Buffer };
    const rawBody: Buffer =
      req.rawBody ?? Buffer.from(JSON.stringify(bodyParsed), 'utf-8');

    // Throws 401 on mismatch; no DB access happens before this line.
    this.provider.verifyWebhookSignature(rawBody, signature ?? '');
    // A valid signature over a stale body is a replay with the original
    // headers; when the provider dates the delivery, the date has to hold.
    if (timestamp) assertFreshTimestamp(timestamp);

    const event = this.provider.parseWebhookEvent(bodyParsed);
    if (!event) {
      return { ok: true, skipped: true };
    }

    if (!(await this.dedupe.claim(PROVIDER, event.eventId))) {
      this.logger.warn(
        `settlement.offramp.webhook.replayed event_id=${event.eventId}`,
      );
      return { ok: true, replayed: true };
    }

    try {
      if (event.type === 'paid') {
        await this.handlePaid(event);
      } else if (event.type === 'failed') {
        await this.handleFailed(event);
      } else {
        // 'processing' is a non-terminal progress ping; record best-effort.
        await this.db.client
          .update(settlementOfframps)
          .set({ status: 'converting', updatedAt: new Date() })
          .where(
            and(
              eq(settlementOfframps.providerRef, event.providerRef),
              eq(settlementOfframps.status, 'pending'),
            ),
          );
      }
    } catch (err) {
      this.logger.error(
        `settlement.offramp.webhook.failed provider_ref=${event.providerRef} error=${(err as Error).message}`,
      );
      // The provider redelivers on 500; the claim must not outlive the attempt
      // or that redelivery would be dropped as a replay.
      await this.dedupe.release(PROVIDER, event.eventId);
      throw new HttpException(
        'webhook processing failed; retry requested',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.logger.log(
      `settlement.offramp.webhook provider_ref=${event.providerRef} status=${event.type}`,
    );
    return { ok: true };
  }

  private async handlePaid(event: {
    providerRef: string;
    ngnSettledMinor?: string;
    fxRate?: string;
    providerTxRef?: string;
    completedAt?: string;
  }): Promise<void> {
    const completedAt = event.completedAt ?? new Date().toISOString();
    // Conditional transition: only a still-open row flips (rowCount 0 on an
    // already-terminal row -> replay no-op).
    const updated = await this.db.client
      .update(settlementOfframps)
      .set({
        status: 'paid',
        ngnAmountMinor: event.ngnSettledMinor ?? null,
        fxRate: event.fxRate ?? null,
        completedAt: new Date(completedAt),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(settlementOfframps.providerRef, event.providerRef),
          eq(settlementOfframps.direction, 'settlement'),
          eq(settlementOfframps.status, 'pending'),
        ),
      )
      .returning({
        id: settlementOfframps.id,
        paymentId: settlementOfframps.paymentId,
        merchantId: settlementOfframps.merchantId,
      });

    if (updated.length === 0) {
      // Already terminal (replay) or unknown ref: no completion, no event.
      return;
    }
    const offramp = updated[0];

    if (offramp.paymentId) {
      // Drive completion through Phase 4's seam (settling->succeeded +
      // payment.succeeded publish, idempotent). The adapter never transitions
      // the intent itself.
      const completion = {
        status: 'complete' as const,
        ngnSettledMinor: event.ngnSettledMinor,
        completedAt,
        providerTxRef: event.providerTxRef,
      };
      await this.confirmation.completeDeferredSettlement(
        offramp.paymentId,
        completion,
      );
    }

    await this.events.publish({
      topic: 'payout.completed',
      key: offramp.id,
      payload: {
        offrampId: offramp.id,
        merchantId: offramp.merchantId,
        paymentId: offramp.paymentId,
        ngnSettledMinor: event.ngnSettledMinor,
      },
      correlationId: offramp.id,
    });
  }

  private async handleFailed(event: { providerRef: string }): Promise<void> {
    const updated = await this.db.client
      .update(settlementOfframps)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(
        and(
          eq(settlementOfframps.providerRef, event.providerRef),
          eq(settlementOfframps.direction, 'settlement'),
          eq(settlementOfframps.status, 'pending'),
        ),
      )
      .returning({
        id: settlementOfframps.id,
        merchantId: settlementOfframps.merchantId,
        paymentId: settlementOfframps.paymentId,
      });

    if (updated.length === 0) return;
    const offramp = updated[0];

    // Do NOT call completeDeferredSettlement (its status is 'complete'|'pending'
    // only) — the stuck settling Payment is Phase 4's deferred-settlement
    // reconciler concern.
    await this.events.publish({
      topic: 'payout.failed',
      key: offramp.id,
      payload: {
        offrampId: offramp.id,
        merchantId: offramp.merchantId,
        paymentId: offramp.paymentId,
      },
      correlationId: offramp.id,
    });
  }
}
