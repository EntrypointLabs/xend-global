import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { BankingRegistry } from './banking.registry';
import { BankNotificationInbox } from './notification-inbox';
import { verifyNombaWebhook } from './nomba.adapter';

const identifier = z.string().min(1).max(512);
const payloadSchema = z.object({
  event_type: identifier,
  requestId: identifier,
  data: z.object({
    merchant: z.object({ userId: identifier, walletId: identifier }),
    transaction: z.object({
      transactionId: identifier,
      type: identifier,
      time: identifier.refine((value) => Number.isFinite(Date.parse(value))),
      responseCode: z.string().max(100).nullish(),
    }),
  }),
});
const events = new Set([
  'payment_success',
  'payment_failed',
  'payment_reversal',
  'payout_success',
  'payout_failed',
  'payout_refund',
]);

/** This endpoint acknowledges durable notification intake, never a customer credit.
 * Nomba does not sign amount, fee, currency or beneficiary; none enter this inbox.
 */
@Controller('webhooks/nomba')
export class NombaWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly banking: BankingRegistry,
    private readonly inbox: BankNotificationInbox,
  ) {}

  @Post('sandbox')
  @HttpCode(200)
  async receive(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const secret = this.config.get<string>('NOMBA_SANDBOX_WEBHOOK_SECRET');
    const merchantId = this.config.get<string>('NOMBA_SANDBOX_ACCOUNT_ID');
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      !secret ||
      !merchantId ||
      !this.banking.accountProvisioningReady('nomba')
    )
      throw new ServiceUnavailableException(
        'Nomba sandbox webhook is not configured.',
      );
    // The dashboard validates the URL with an unsigned POST containing exactly {}.
    // Acknowledge connectivity only; this cannot enter the notification inbox.
    if (
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0 &&
      !Object.keys(headers).some((key) =>
        key.toLowerCase().startsWith('nomba-'),
      )
    )
      return { accepted: true as const, ignored: true };
    if (!verifyNombaWebhook(body, headers, secret))
      throw new UnauthorizedException('Invalid Nomba webhook signature.');
    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success || parsed.data.data.merchant.userId !== merchantId)
      throw new UnauthorizedException('Invalid Nomba webhook identity.');
    const payload = parsed.data;
    if (!events.has(payload.event_type))
      return { accepted: true as const, ignored: true };
    const { merchant, transaction } = payload.data;
    return this.inbox.receive('nomba', 'sandbox', {
      eventType: payload.event_type,
      requestId: payload.requestId,
      merchantId: merchant.userId,
      walletId: merchant.walletId,
      transactionId: transaction.transactionId,
      transactionType: transaction.type,
      transactionTime: transaction.time,
      responseCode:
        transaction.responseCode == null || transaction.responseCode === 'null'
          ? ''
          : transaction.responseCode,
    });
  }
}
