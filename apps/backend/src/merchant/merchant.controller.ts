import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { assertPublicHttpsUrl, UnsafeUrlError } from '../common/url-safety';
import { FX_QUOTE_PROVIDER } from '../fx/fx-quote-provider.interface';
import type { FxQuoteProvider } from '../fx/fx-quote-provider.interface';
import { ngnMinorToUsdcRaw } from '../fx/fx-math';
import { FxQuoteUnavailableError } from '../fx/fx.errors';
import {
  PaymentIntentService,
  type CreateIntentParams,
} from '../payment/payment-intent.service';
import {
  IntentNotFoundError,
  MerchantNotFoundError,
  MerchantSuspendedError,
} from '../payment/payment.errors';
import { paymentIntents } from '../db/schema';
import { ApiKeyGuard, type MerchantRequest } from './api-key.guard';
import { IdempotencyService } from './idempotency.service';
import {
  CreateIntentBodySchema,
  type CreateIntentBody,
  type IntentObject,
} from './dtos';
import { IdempotencyKeyReuseError } from './merchant.errors';

type IntentRow = typeof paymentIntents.$inferSelect;

/** Stable JSON so a re-ordered body hashes identically. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The merchant API surface: server-to-server payment intent create/retrieve
 * under the ApiKeyGuard. Intents are created server-side only; the browser
 * never supplies an amount. NGN intents pin an executable FX quote at
 * creation; USDC intents leave the FX columns null. Every write is idempotent
 * by Idempotency-Key.
 */
@Controller('v1')
@UseGuards(ApiKeyGuard)
export class MerchantController {
  constructor(
    private readonly intents: PaymentIntentService,
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService,
    @Inject(FX_QUOTE_PROVIDER) private readonly fx: FxQuoteProvider,
  ) {}

  @Post('payment_intents')
  @HttpCode(HttpStatus.CREATED)
  async createIntent(
    @Req() req: MerchantRequest,
    @Body(new ZodValidationPipe(CreateIntentBodySchema)) body: CreateIntentBody,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<IntentObject> {
    const { merchantId, mode } = req.merchant;
    try {
      const allowPrivate =
        this.config.get<boolean>('WEBHOOK_ALLOW_PRIVATE_URLS') ?? false;
      if (body.return_url) {
        await assertPublicHttpsUrl(body.return_url, { allowPrivate });
      }
      if (body.cancel_url) {
        await assertPublicHttpsUrl(body.cancel_url, { allowPrivate });
      }

      const requestHash = createHash('sha256')
        .update(
          stableStringify({
            method: 'POST',
            path: '/v1/payment_intents',
            body,
          }),
        )
        .digest('hex');

      const result = await this.idempotency.run<IntentObject>(
        merchantId,
        idempotencyKey,
        requestHash,
        async () => {
          const params: CreateIntentParams = {
            merchantId,
            mode,
            usdcSettlementRaw: '',
            merchantReference: body.merchant_reference,
            returnUrl: body.return_url,
            cancelUrl: body.cancel_url,
            idempotencyKey,
          };

          if (body.currency === 'NGN') {
            const quote = await this.fx.getQuote();
            const rateDecimals =
              this.config.getOrThrow<number>('FX_RATE_DECIMALS');
            params.usdcSettlementRaw = ngnMinorToUsdcRaw(
              body.amount,
              quote.ngnPerUsdc,
              rateDecimals,
            );
            params.ngnDisplayMinor = body.amount;
            params.fxRate = quote.ngnPerUsdc;
            params.fxSource = quote.source;
            params.fxQuotedAt = quote.quotedAt;
          } else {
            params.usdcSettlementRaw = body.amount;
          }

          const intent = await this.intents.create(params);
          return { status: HttpStatus.CREATED, body: this.toObject(intent) };
        },
      );
      return result.body;
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  @Get('payment_intents/:id')
  async getIntent(
    @Req() req: MerchantRequest,
    @Param('id') id: string,
  ): Promise<IntentObject> {
    try {
      const intent = await this.intents.findById(id);
      // Scope to the calling merchant + mode; never leak cross-merchant
      // existence.
      if (
        intent.merchantId !== req.merchant.merchantId ||
        intent.mode !== req.merchant.mode
      ) {
        throw new IntentNotFoundError(`intent ${id} not found`);
      }
      return this.toObject(intent);
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  private toObject(intent: IntentRow): IntentObject {
    const currency = intent.ngnDisplayMinor !== null ? 'NGN' : 'USDC';
    const amount =
      currency === 'NGN'
        ? (intent.ngnDisplayMinor as string)
        : intent.usdcSettlementRaw;
    return {
      id: intent.id,
      object: 'payment_intent',
      status: intent.status,
      currency,
      amount,
      usdc_settlement_raw: intent.usdcSettlementRaw,
      ngn_display_minor: intent.ngnDisplayMinor,
      fx_rate: intent.fxRate,
      fx_source: intent.fxSource,
      fx_quoted_at: intent.fxQuotedAt ? intent.fxQuotedAt.toISOString() : null,
      expires_at: intent.expiresAt.toISOString(),
      merchant_reference: intent.merchantReference,
      return_url: intent.returnUrl,
      cancel_url: intent.cancelUrl,
      livemode: intent.mode === 'live',
      created: Math.floor(intent.createdAt.getTime() / 1000),
    };
  }

  private mapServiceError(err: unknown): never {
    if (
      err instanceof MerchantNotFoundError ||
      err instanceof IntentNotFoundError
    ) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.NOT_FOUND,
      );
    }
    if (err instanceof MerchantSuspendedError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.FORBIDDEN,
      );
    }
    if (err instanceof IdempotencyKeyReuseError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.CONFLICT,
      );
    }
    if (err instanceof FxQuoteUnavailableError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (err instanceof UnsafeUrlError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    throw err as Error;
  }
}
