import {
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { assertFreshTimestamp } from '../db/inbound-webhook-dedupe';
import { PajClient } from '../settlement/providers/paj/paj.client';
import { FiatService } from './fiat.service';
import { PaycrestClient } from './providers/paycrest/paycrest.client';
import { FiatVerificationService } from './verification/verification.service';

type RawRequest = Request & { rawBody?: Buffer };

function unauthorized(): HttpException {
  return new HttpException(
    'invalid webhook signature',
    HttpStatus.UNAUTHORIZED,
  );
}

function parse(raw: Buffer): Record<string, unknown> {
  try {
    const body: unknown = JSON.parse(raw.toString('utf-8'));
    if (body && typeof body === 'object')
      return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpException('body is not JSON', HttpStatus.BAD_REQUEST);
}

/**
 * Consumer ramp webhooks. A delivery only says "look again": after the
 * signature checks out, the order is re-read from the provider's API and
 * that answer is what gets recorded. A replayed or reordered delivery
 * therefore cannot move an order anywhere the provider does not agree with.
 */
@Controller('webhooks/fiat')
export class FiatWebhookController {
  private readonly logger = new Logger(FiatWebhookController.name);

  constructor(
    private readonly fiat: FiatService,
    private readonly paj: PajClient,
    private readonly paycrest: PaycrestClient,
    private readonly verification: FiatVerificationService,
  ) {}

  @Post('paj')
  @HttpCode(200)
  async pajUpdate(
    @Req() req: RawRequest,
    @Headers('x-paj-timestamp') timestamp: string | undefined,
    @Headers('x-paj-signature') signature: string | undefined,
  ) {
    const body = this.verifyPaj(req, timestamp, signature);
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return { ok: true, skipped: true };
    const order = await this.fiat.refreshFromProvider('paj', id);
    return { ok: true, ...(order ? {} : { skipped: true }) };
  }

  @Post('paj/kyc')
  @HttpCode(200)
  async pajKyc(
    @Req() req: RawRequest,
    @Headers('x-paj-timestamp') timestamp: string | undefined,
    @Headers('x-paj-signature') signature: string | undefined,
  ) {
    const body = this.verifyPaj(req, timestamp, signature);
    const customerId =
      typeof body.customerId === 'string' ? body.customerId : null;
    const externalUserId =
      typeof body.externalUserId === 'string' ? body.externalUserId : null;
    if (body.event !== 'kyc.status_changed' || !customerId || !externalUserId) {
      return { ok: true, skipped: true };
    }
    const customer = await this.paj.getKycCustomer(customerId);
    const applied = await this.verification.applyDecision({
      externalUserId,
      customerId,
      status: customer.status,
      tier: customer.tier,
    });
    return { ok: true, ...(applied ? {} : { skipped: true }) };
  }

  @Post('paycrest')
  @HttpCode(200)
  async paycrestUpdate(
    @Req() req: RawRequest,
    @Headers('x-paycrest-signature') signature: string | undefined,
  ) {
    if (
      !req.rawBody ||
      !this.paycrest.verifyWebhookSignature(req.rawBody, signature)
    ) {
      throw unauthorized();
    }
    const body = parse(req.rawBody);
    const data = body.data as Record<string, unknown> | undefined;
    const id = typeof data?.id === 'string' ? data.id : null;
    if (!id) return { ok: true, skipped: true };
    const order = await this.fiat.refreshFromProvider('paycrest', id);
    if (!order) this.logger.warn(`paycrest.webhook unknown order=${id}`);
    return { ok: true, ...(order ? {} : { skipped: true }) };
  }

  private verifyPaj(
    req: RawRequest,
    timestamp: string | undefined,
    signature: string | undefined,
  ): Record<string, unknown> {
    if (!req.rawBody || !timestamp) throw unauthorized();
    this.paj.verifyWebhookSignature(req.rawBody, timestamp, signature);
    assertFreshTimestamp(timestamp);
    return parse(req.rawBody);
  }
}
