import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { THROTTLE_LIMITS } from '../common/throttle';
import { DbService } from '../db/db.service';
import { webhookDeliveries } from '../db/schema';
import { RecoveryService } from '../recovery/recovery.service';
import { WebhookDeliveryService } from '../webhook/webhook-delivery.service';
import { AdminAuditService } from './admin-audit.service';
import { ConsoleAuthGuard, consoleActor } from './console-auth.guard';
import { ConsoleCsrfGuard, csrfField } from './console-csrf.guard';
import {
  ConsoleService,
  type ConsoleAccountRow,
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

/** Set by ConsoleCsrfGuard on every safe request; base64url, so HTML-safe. */
function csrfTokenOf(res: Response): string {
  return (res.locals as { csrfToken?: string }).csrfToken ?? '';
}

/**
 * Ops console (ADR 0022). Renders server-side HTML tables behind Basic Auth:
 * payments (with refund linkage shown, never actionable), the webhook delivery
 * log with a per-row manual Redeliver button, API key fingerprints, and
 * Consumer Accounts. Two write paths: webhook redelivery, and freezing or
 * releasing an Account's recovery signer. Neither reaches a Consumer-facing
 * route, and the freeze is a refusal to sign rather than a power to sign.
 * Every write is CSRF-checked and lands a row in admin_audit_log. The auth
 * throttle caps credential guessing against the Basic Auth prompt.
 */
@Controller('console')
@Throttle({ auth: THROTTLE_LIMITS.auth })
@UseGuards(ConsoleAuthGuard, ConsoleCsrfGuard)
export class ConsoleController {
  private readonly logger = new Logger(ConsoleController.name);

  constructor(
    private readonly console: ConsoleService,
    private readonly delivery: WebhookDeliveryService,
    private readonly recovery: RecoveryService,
    private readonly db: DbService,
    private readonly audit: AdminAuditService,
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
      .send(
        layout(
          'Webhook deliveries',
          this.renderDeliveries(rows, csrfTokenOf(res)),
        ),
      );
  }

  @Get('keys')
  async keys(@Res() res: Response): Promise<void> {
    const rows = await this.console.listKeyFingerprints();
    res.type('html').send(layout('API keys', this.renderKeys(rows)));
  }

  @Get('accounts')
  async accounts(@Res() res: Response): Promise<void> {
    const rows = await this.console.listAccounts();
    res
      .type('html')
      .send(layout('Accounts', this.renderAccounts(rows, csrfTokenOf(res))));
  }

  /**
   * Stops the recovery signer being released for this Account, for as long
   * as a compromise report is open.
   *
   * A Consumer holding their passkey and phone is unaffected: those two are
   * threshold on their own. What changes is that an inbox alone can no longer
   * start moving the Account to another phone.
   */
  @Post('accounts/:userId/recovery/freeze')
  async freezeRecovery(
    @Param('userId') userId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.requireAccount(userId);
    await this.recovery.freezeRelease(userId);
    const actor = consoleActor(req);
    await this.audit.record(actor, 'recovery.freeze', userId);
    this.logger.warn(`console.recovery_freeze user=${userId} actor=${actor}`);
    res.redirect(303, '/console/accounts');
  }

  @Post('accounts/:userId/recovery/unfreeze')
  async unfreezeRecovery(
    @Param('userId') userId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.requireAccount(userId);
    await this.recovery.unfreezeRelease(userId);
    const actor = consoleActor(req);
    await this.audit.record(actor, 'recovery.unfreeze', userId);
    this.logger.warn(`console.recovery_unfreeze user=${userId} actor=${actor}`);
    res.redirect(303, '/console/accounts');
  }

  @Post('deliveries/:id/redeliver')
  async redeliver(
    @Param('id') id: string,
    @Req() req: Request,
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
      const actor = consoleActor(req);
      await this.audit.record(actor, 'webhook.redeliver', id);
      this.logger.log(`console.redeliver delivery_id=${id} actor=${actor}`);
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
      '<tr><th>Payment</th><th>Merchant</th><th>USDC</th><th>Charged</th>' +
      '<th>Intent status</th><th>Signature</th><th>Settled</th><th>Refund of</th></tr>';
    const body = rows
      .map(
        (r) =>
          '<tr>' +
          cell(r.id, true) +
          cell(r.merchantName) +
          cell(r.usdcAmount) +
          cell(r.displayAmount) +
          cell(r.intentStatus) +
          cell(r.signature, true) +
          cell(iso(r.settledAt)) +
          cell(r.refundOfPaymentId, true) +
          '</tr>',
      )
      .join('');
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  private renderDeliveries(
    rows: ConsoleDeliveryRow[],
    csrfToken: string,
  ): string {
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
        const button = `<form method="post" action="${escapeHtml(action)}">${csrfField(csrfToken)}<button type="submit">Redeliver</button></form>`;
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

  private async requireAccount(userId: string): Promise<void> {
    if (!(await this.console.hasAccount(userId))) {
      throw new NotFoundException(`no Account for user ${userId}`);
    }
  }

  private renderAccounts(rows: ConsoleAccountRow[], csrfToken: string): string {
    if (rows.length === 0) {
      return '<p class="empty">No Accounts yet.</p>';
    }
    const head =
      '<tr><th>User</th><th>Email</th><th>Vault</th><th>Created</th>' +
      '<th>Recovery release</th><th></th></tr>';
    const body = rows
      .map((r) => {
        const frozen = r.recoveryReleaseFrozenAt !== null;
        const action = `/console/accounts/${encodeURIComponent(r.userId)}/recovery/${frozen ? 'unfreeze' : 'freeze'}`;
        const button = `<form method="post" action="${escapeHtml(action)}">${csrfField(csrfToken)}<button type="submit">${frozen ? 'Release' : 'Freeze'}</button></form>`;
        return (
          '<tr>' +
          cell(r.userId, true) +
          cell(r.email) +
          cell(r.vaultAddress, true) +
          cell(iso(r.createdAt)) +
          cell(
            frozen
              ? `Frozen since ${iso(r.recoveryReleaseFrozenAt) ?? ''}`
              : 'Open',
          ) +
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
