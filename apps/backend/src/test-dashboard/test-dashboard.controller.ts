import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { escapeHtml } from '../console/console-html';
import { KeyIssuanceService } from '../merchant/key-issuance.service';
import { MerchantNotFoundError } from '../payment/payment.errors';
import { layout, testModeBadge } from './test-dashboard-html';
import { TestDashboardGuard } from './test-dashboard.guard';
import {
  TestDashboardService,
  type CreatedTestMerchant,
  type TestMerchantRow,
} from './test-dashboard.service';

function cell(value: string | null | undefined, mono = false): string {
  const text = value ? value : '-';
  const cls = mono ? ' class="mono"' : '';
  return `<td${cls}>${escapeHtml(text)}</td>`;
}

function kybButton(merchantId: string): string {
  const action = `/test-dashboard/merchants/${encodeURIComponent(merchantId)}/kyb`;
  return `<form method="post" action="${escapeHtml(action)}"><button type="submit">Mark KYB verified (stub)</button></form>`;
}

/**
 * LOCAL TEST TOOL ONLY, never for production. A self-serve page for creating
 * test businesses and test API keys during local development, so real
 * Merchant rows land in the DB and are fetchable by the backend. Every route
 * is dev-gated by TestDashboardGuard (404 unless NODE_ENV=development)
 * because key creation here has no auth. Distinct from both the read-only
 * ops console (ADR 0022) and the deferred merchants.xend.global self-serve
 * portal; key issuance goes through the same KeyIssuanceService as both.
 */
@Controller('test-dashboard')
@UseGuards(TestDashboardGuard)
export class TestDashboardController {
  constructor(
    private readonly dashboard: TestDashboardService,
    private readonly keyIssuance: KeyIssuanceService,
  ) {}

  @Get()
  async index(@Res() res: Response): Promise<void> {
    const rows = await this.dashboard.listTestMerchants();
    res.type('html').send(layout('Test dashboard', this.renderIndex(rows)));
  }

  @Post('merchants')
  async createMerchant(
    @Body('name') name: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      throw new BadRequestException('business name is required');
    }
    const merchant = await this.dashboard.createMerchant(trimmed);
    // Same issuance path as the ops script: the raw key exists only in this
    // one response and is never stored or logged.
    const key = await this.keyIssuance.issueKey(merchant.id, 'test');
    res
      .type('html')
      .send(
        layout(
          'Test business created',
          this.renderCreated(trimmed, merchant, key.raw),
        ),
      );
  }

  @Post('merchants/:id/kyb')
  async markKybVerified(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      await this.keyIssuance.markKybVerified(id);
    } catch (err) {
      if (err instanceof MerchantNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
    res.redirect(303, '/test-dashboard');
  }

  private renderIndex(rows: TestMerchantRow[]): string {
    const notice =
      '<p class="notice">You are in test mode. Businesses and keys created ' +
      'here are for local testing only and never move real money.</p>';
    const form =
      '<form method="post" action="/test-dashboard/merchants" class="create">' +
      '<input type="text" name="name" placeholder="Business name" required>' +
      '<button type="submit">Create test business</button>' +
      '</form>';
    if (rows.length === 0) {
      return `${notice}${form}<p class="empty">No test businesses yet. Create one above.</p>`;
    }
    const head =
      '<tr><th>Merchant ID</th><th>Display name</th><th>Key fingerprint</th>' +
      '<th>Mode</th><th>KYB status</th><th></th></tr>';
    const body = rows
      .map(
        (r) =>
          '<tr>' +
          cell(r.merchantId, true) +
          cell(r.displayName) +
          cell(r.fingerprint, true) +
          cell(r.mode) +
          cell(r.kybStatus) +
          `<td>${r.kybStatus === 'verified' ? '' : kybButton(r.merchantId)}</td>` +
          '</tr>',
      )
      .join('');
    return `${notice}${form}<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  private renderCreated(
    name: string,
    merchant: CreatedTestMerchant,
    rawKey: string,
  ): string {
    return (
      `<p>${testModeBadge()} Business <strong>${escapeHtml(name)}</strong> is ready.</p>` +
      '<p><strong>API key.</strong> Copy it now, it is shown once and cannot be retrieved later.</p>' +
      `<pre class="key">${escapeHtml(rawKey)}</pre>` +
      `<p>Merchant ID: <span class="mono">${escapeHtml(merchant.id)}</span></p>` +
      `<p>KYB status: ${escapeHtml(merchant.kybStatus)}</p>` +
      kybButton(merchant.id) +
      '<p><a href="/test-dashboard">Back to test dashboard</a></p>'
    );
  }
}
