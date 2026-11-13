import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PajClient } from '../settlement/providers/paj/paj.client';
import type { FxQuote, FxQuoteProvider } from './fx-quote-provider.interface';
import { FxQuoteUnavailableError } from './fx.errors';

/**
 * Prices checkout off PAJ's off-ramp rate, the direction a Payment actually
 * travels (USDC out, naira in). The rate already carries the fee PAJ applies
 * to the business. It is indicative: PAJ settles at the rate live when the
 * deposit is observed, so the Merchant's proceeds can differ from this quote.
 */
@Injectable()
export class PajFxAdapter implements FxQuoteProvider {
  constructor(
    private readonly paj: PajClient,
    private readonly config: ConfigService,
  ) {}

  async getQuote(): Promise<FxQuote> {
    try {
      const { offRampRate } = await this.paj.getRates(
        this.config.getOrThrow<number>('FX_QUOTE_TIMEOUT_MS'),
      );
      return {
        ngnPerUsdc: String(offRampRate.rate),
        source: 'paj-offramp',
        quotedAt: new Date(),
      };
    } catch (error) {
      throw new FxQuoteUnavailableError(
        `PAJ quote unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
