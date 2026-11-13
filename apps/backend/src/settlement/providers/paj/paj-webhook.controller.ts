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
import { and, eq, inArray } from 'drizzle-orm';
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
import { PajClient } from './paj.client';
import {
  PAJ_PROVIDER,
  PajSettlementProvider,
  type PajOfframpEvent,
} from './paj-settlement.provider';

/**
 * POST /webhooks/paj receives PAJ's ramp status updates. The signature is
 * checked over the raw body before anything is read from it or the database.
 * A payout that landed completes the Payment through
 * completeDeferredSettlement. PAJ redelivers on a non-2xx, so a failure while
 * recording an owned event answers 500.
 */
@Controller('webhooks')
export class PajWebhookController {
  private readonly logger = new Logger(PajWebhookController.name);

  constructor(
    private readonly db: DbService,
    private readonly paj: PajClient,
    private readonly provider: PajSettlementProvider,
    private readonly confirmation: SettlementConfirmationService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    private readonly config: ConfigService,
    private readonly dedupe: InboundWebhookDedupe,
  ) {}

  @Post('paj')
  @HttpCode(200)
  async receive(
    @Req() reqUnknown: unknown,
    @Headers('x-paj-timestamp') timestamp: string | undefined,
    @Headers('x-paj-signature') signature: string | undefined,
    @Body() bodyParsed: unknown,
  ): Promise<{
    ok: true;
    killSwitched?: boolean;
    skipped?: boolean;
    replayed?: boolean;
  }> {
    if (this.config.get<boolean>('SETTLEMENT_WEBHOOK_KILLSWITCH') === true) {
      this.logger.warn('paj.webhook killSwitched');
      return { ok: true, killSwitched: true };
    }

    const req = reqUnknown as Request & { rawBody?: Buffer };
    // A re-serialised body differs from the signed bytes in key order and
    // escaping, so without the raw body the delivery cannot be verified.
    if (!req.rawBody) {
      throw new HttpException(
        'invalid webhook signature',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.paj.verifyWebhookSignature(req.rawBody, timestamp, signature);
    assertFreshTimestamp(timestamp ?? '');

    const event = this.provider.parseWebhookEvent(bodyParsed);
    if (!event) return { ok: true, skipped: true };

    if (!(await this.dedupe.claim(PAJ_PROVIDER, event.eventId))) {
      this.logger.warn(`paj.webhook.replayed event_id=${event.eventId}`);
      return { ok: true, replayed: true };
    }

    try {
      if (event.type === 'paid') await this.handlePaid(event);
      else if (event.type === 'failed') await this.handleFailed(event);
      else await this.handleProcessing(event);
    } catch (err) {
      this.logger.error(
        `paj.webhook.failed signature=${event.depositSignature} error=${(err as Error).message}`,
      );
      // The claim must not outlive a failed attempt, or PAJ's redelivery
      // would be dropped as a replay.
      await this.dedupe.release(PAJ_PROVIDER, event.eventId);
      throw new HttpException(
        'webhook processing failed; retry requested',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.logger.log(
      `paj.webhook signature=${event.depositSignature} status=${event.type}`,
    );
    return { ok: true };
  }

  private openSettlement(event: PajOfframpEvent) {
    return and(
      eq(settlementOfframps.providerRef, event.depositSignature),
      eq(settlementOfframps.provider, PAJ_PROVIDER),
      eq(settlementOfframps.direction, 'settlement'),
      inArray(settlementOfframps.status, ['pending', 'converting']),
    );
  }

  private async handleProcessing(event: PajOfframpEvent): Promise<void> {
    await this.db.client
      .update(settlementOfframps)
      .set({ status: 'converting', updatedAt: new Date() })
      .where(this.openSettlement(event));
  }

  private async handlePaid(event: PajOfframpEvent): Promise<void> {
    const completedAt = new Date();
    // Only a still-open row flips, so a replay of a terminal row is a no-op.
    const [offramp] = await this.db.client
      .update(settlementOfframps)
      .set({
        status: 'paid',
        ngnAmountMinor: event.ngnSettledMinor ?? null,
        fxRate: event.fxRate ?? null,
        completedAt,
        updatedAt: completedAt,
      })
      .where(this.openSettlement(event))
      .returning({
        id: settlementOfframps.id,
        paymentId: settlementOfframps.paymentId,
        merchantId: settlementOfframps.merchantId,
      });
    if (!offramp) return;

    if (offramp.paymentId) {
      await this.confirmation.completeDeferredSettlement(offramp.paymentId, {
        status: 'complete',
        ngnSettledMinor: event.ngnSettledMinor,
        completedAt: completedAt.toISOString(),
        providerTxRef: event.providerTxRef,
      });
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

  private async handleFailed(event: PajOfframpEvent): Promise<void> {
    const [offramp] = await this.db.client
      .update(settlementOfframps)
      .set({
        status: 'failed',
        failureReason: `paj transaction ${event.providerTxRef} ended in error`,
        updatedAt: new Date(),
      })
      .where(this.openSettlement(event))
      .returning({
        id: settlementOfframps.id,
        merchantId: settlementOfframps.merchantId,
        paymentId: settlementOfframps.paymentId,
      });
    if (!offramp) return;

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
