import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { webhookDeliveries } from '../db/schema';
import { WebhookDeliveryService } from '../webhook/webhook-delivery.service';
import { ConsoleAuthGuard } from './console-auth.guard';
import {
  ConsoleService,
  type ConsoleDeliveryRow,
  type ConsoleKeyRow,
  type ConsolePaymentRow,
} from './console.service';
import { escapeHtml, layout } from './console-html';

function cell(value: string | null | undefined, mono = false): string {
  const text =
    value === null || value === undefined || value === '' ? '—' : value;
  const cls = mono ? ' class="mono"' : '';
  return `<td${cls}>${escapeHtml(text)}</td>`;
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Read-only ops console (ADR 0022, REQ-CONSOLE-READONLY). Renders three
 * server-side HTML tables behind Basic Auth: payments (with refund linkage
 * shown, never actionable), the webhook delivery log with a per-row manual
 * Redeliver button, and API key fingerprints. The single write path is the
 * redelivery POST, which calls Phase 6's WebhookDeliveryService in-process.
 */
@Controller('console')
@UseGuards(ConsoleAuthGuard)
export class ConsoleController {
  private readonly logger = new Logger(ConsoleController.name);

  constructor(
    private readonly console: ConsoleService,
    private readonly delivery: WebhookDeliveryService,
    private readonly db: DbService,
  ) {}

  @Get()
  root(@Res() res: Response): void {
    res.redirect(302, '/console/payments');
  }

  @Get('payments')
  async payments(@Res() res: Response): Promise<void> {
    const rows = await this.console.listPayments();
    res.type('html').send(layout('Payments', this.renderPayments(rows)));
  }

  @Get('deliveries')
  async deliveries(@Res() res: Response): Promise<void> {
    const rows = await this.console.listDeliveries();
    res
      .type('html')
      .send(layout('Webhook deliveries', this.renderDeliveries(rows)));
  }

  @Get('keys')
  async keys(@Res() res: Response): Promise<void> {
    const rows = await this.console.listKeyFingerprints();
    res.type('html').send(layout('API keys', this.renderKeys(rows)));
  }

  @Post('deliveries/:id/redeliver')
  async redeliver(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const [existing] = await this.db.client
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException(`delivery ${id} not found`);
    }
    try {
      // Reuse Phase 6's redelivery capability: a manual redelivery keeps the
      // SAME event id so merchant-side dedup is not bypassed, and is exempt
      // from the auto partial-unique index so a fresh attempt row is created.
      const created = await this.delivery.createDelivery({
        endpointId: existing.endpointId,
        eventId: existing.eventId,
        eventType: existing.eventType,
        payload: existing.payload,
        correlationId: existing.correlationId,
        origin: 'manual',
      });
      if (created) await this.delivery.attempt(created);
      this.logger.log(`console.redeliver delivery_id=${id}`);
    } catch (err) {
      // Surface the failure as a logged 5xx to the browser — no retry loop,
      // no swallowing. The operator retries manually from the refreshed log.
      this.logger.error(
        `console.redeliver.failed delivery_id=${id} error=${(err as Error).message}`,
      );
      throw err;
    }
    res.redirect(303, '/console/deliveries');
  }

  private renderPayments(rows: ConsolePaymentRow[]): string {
    if (rows.length === 0) {
      return '<p class="empty">No payments yet.</p>';
    }
    const head =
      '<tr><th>Payment</th><th>Merchant</th><th>USDC</th><th>NGN</th>' +
      '<th>Intent status</th><th>Signature</th><th>Settled</th><th>Refund of</th></tr>';
    const body = rows
      .map(
        (r) =>
          '<tr>' +
          cell(r.id, true) +
          cell(r.merchantName) +
          cell(r.usdcAmount) +
          cell(r.ngnAmount) +
          cell(r.intentStatus) +
          cell(r.signature, true) +
          cell(iso(r.settledAt)) +
          cell(r.refundOfPaymentId, true) +
          '</tr>',
      )
      .join('');
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  private renderDeliveries(rows: ConsoleDeliveryRow[]): string {
    if (rows.length === 0) {
      return '<p class="empty">No webhook deliveries yet.</p>';
    }
    const head =
      '<tr><th>Event</th><th>Type</th><th>Endpoint</th><th>Attempt</th>' +
      '<th>Status</th><th>Response</th><th>Duration (ms)</th>' +
      '<th>Next retry</th><th>Created</th><th></th></tr>';
    const body = rows
      .map((r) => {
        const action = `/console/deliveries/${encodeURIComponent(r.id)}/redeliver`;
        const button = `<form method="post" action="${escapeHtml(action)}"><button type="submit">Redeliver</button></form>`;
        return (
          '<tr>' +
          cell(r.eventId, true) +
          cell(r.eventType) +
          cell(r.endpointUrl) +
          cell(String(r.attemptNo)) +
          cell(r.status) +
          cell(r.responseStatus === null ? null : String(r.responseStatus)) +
          cell(r.durationMs === null ? null : String(r.durationMs)) +
          cell(iso(r.nextRetryAt)) +
          cell(iso(r.createdAt)) +
          `<td>${button}</td>` +
          '</tr>'
        );
      })
      .join('');
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  private renderKeys(rows: ConsoleKeyRow[]): string {
    if (rows.length === 0) {
      return '<p class="empty">No API keys yet.</p>';
    }
    const head =
      '<tr><th>Merchant</th><th>Fingerprint</th><th>Mode</th>' +
      '<th>Created</th><th>Last used</th><th>Revoked</th></tr>';
    const body = rows
      .map(
        (r) =>
          '<tr>' +
          cell(r.merchantName) +
          cell(r.fingerprint, true) +
          cell(r.mode) +
          cell(iso(r.createdAt)) +
          cell(iso(r.lastUsedAt)) +
          cell(iso(r.revokedAt)) +
          '</tr>',
      )
      .join('');
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }
}
