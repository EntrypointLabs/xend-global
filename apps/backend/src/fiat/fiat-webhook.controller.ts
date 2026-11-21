import {
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
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
 * Consumer ramp webhooks. A delivery only says "look again": once it proves
 * itself, the order is re-read from the provider's API and that answer is
 * what gets recorded. A replayed or reordered delivery therefore cannot move
 * an order anywhere the provider does not agree with.
 *
 * Paycrest proves itself with an HMAC signature. PAJ's deliveries are not
 * verified by signature yet (no usable secret from PAJ), so a deposit update
 * proves itself with the token in its per-order URL, and a KYC update by
 * naming a customer we already hold for that person.
 */
@Controller('webhooks/fiat')
export class FiatWebhookController {
  private readonly logger = new Logger(FiatWebhookController.name);

  constructor(
    private readonly fiat: FiatService,
    private readonly paycrest: PaycrestClient,
    private readonly verification: FiatVerificationService,
  ) {}

  @Post('paj/orders/:orderId/:token')
  @HttpCode(200)
  async pajOrderUpdate(
    @Param('orderId') orderId: string,
    @Param('token') token: string,
  ) {
    const order = await this.fiat.refreshFromOrderHook(orderId, token);
    if (order === 'rejected') {
      throw new HttpException('unknown callback', HttpStatus.NOT_FOUND);
    }
    return { ok: true, ...(order ? {} : { skipped: true }) };
  }

  @Post('paj/kyc')
  @HttpCode(200)
  async pajKyc(@Req() req: RawRequest) {
    if (!req.rawBody)
      throw new HttpException('no body', HttpStatus.BAD_REQUEST);
    const body = parse(req.rawBody);
    const customerId =
      typeof body.customerId === 'string' ? body.customerId : null;
    const externalUserId =
      typeof body.externalUserId === 'string' ? body.externalUserId : null;
    if (body.event !== 'kyc.status_changed' || !customerId || !externalUserId) {
      return { ok: true, skipped: true };
    }
    const applied = await this.verification.applyHook({
      externalUserId,
      customerId,
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
}
