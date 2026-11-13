import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { FxQuote, FxQuoteProvider } from './fx-quote-provider.interface';
import { FxQuoteUnavailableError } from './fx.errors';

// Contract: https://docs.blockradar.co/en/api-reference/miscellaneous/get-rates
// data[asset][currency] is units of the requested currency per one asset.
// Broad operational bounds catch reciprocals and unit errors; values outside
// this range require operator review instead of silently mispricing Payments.
const Rate = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (value) =>
      /^\d+(\.\d+)?$/.test(value) &&
      Number(value) >= 10 &&
      Number(value) <= 100000,
  );
const ResponseSchema = z.object({
  statusCode: z.literal(200),
  data: z.object({ USDC: z.object({ NGN: Rate }) }),
});

@Injectable()
export class BlockradarFxAdapter implements FxQuoteProvider {
  constructor(private readonly config: ConfigService) {}

  async getQuote(): Promise<FxQuote> {
    const key = this.config.get<string>('BLOCKRADAR_API_KEY');
    if (!key)
      throw new FxQuoteUnavailableError(
        'Blockradar pricing access is not configured',
      );
    try {
      const response = await fetch(
        'https://api.blockradar.co/v1/assets/rates?currency=NGN&assets=USDC',
        {
          redirect: 'error',
          headers: { 'x-api-key': key },
          signal: AbortSignal.timeout(
            this.config.getOrThrow<number>('FX_QUOTE_TIMEOUT_MS'),
          ),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = ResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('Invalid USDC/NGN reference rate');
      return {
        ngnPerUsdc: parsed.data.data.USDC.NGN,
        source: 'blockradar-reference',
        quotedAt: new Date(),
      };
    } catch (error) {
      throw new FxQuoteUnavailableError(
        `Blockradar quote unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
