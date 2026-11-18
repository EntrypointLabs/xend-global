import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  FX_QUOTE_PROVIDER,
  type FxQuoteProvider,
} from './fx-quote-provider.interface';

/**
 * Keyless reference rates (European Central Bank), published once each working
 * day. Covers the major currencies; it does not publish NGN.
 */
const MARKET_ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=USD';

const REQUEST_TIMEOUT_MS = 4_000;

/** ECB rates move daily, so an hour of reuse costs nothing in accuracy. */
const CACHE_TTL_MS = 60 * 60_000;

export interface DisplayRates {
  /** Units of each currency that one US dollar buys. */
  perUsd: Record<string, number>;
  quotedAt: string;
}

/**
 * Rates for showing a dollar balance in a Consumer's local currency.
 *
 * Display only: nothing is priced or settled on these. NGN comes from the
 * checkout quote, the rate Prydd actually converts at, and the rest from the
 * ECB reference. When an upstream is down the last good answer is served, so
 * a card already showing a balance keeps showing one.
 */
@Injectable()
export class DisplayRatesService {
  private readonly logger = new Logger(DisplayRatesService.name);
  private cached?: { rates: DisplayRates; at: number };
  private inFlight?: Promise<DisplayRates>;

  constructor(
    @Inject(FX_QUOTE_PROVIDER) private readonly ngnQuote: FxQuoteProvider,
  ) {}

  async current(): Promise<DisplayRates> {
    if (this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) {
      return this.cached.rates;
    }
    this.inFlight ??= this.refresh().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async refresh(): Promise<DisplayRates> {
    const [market, ngn] = await Promise.allSettled([
      this.fetchMarket(),
      this.ngnQuote.getQuote(),
    ]);

    const perUsd: Record<string, number> = {
      ...(this.cached?.rates.perUsd ?? {}),
    };
    if (market.status === 'fulfilled') Object.assign(perUsd, market.value);
    else this.logger.warn(`market rates unavailable: ${reason(market.reason)}`);

    if (ngn.status === 'fulfilled') {
      const value = Number(ngn.value.ngnPerUsdc);
      if (Number.isFinite(value) && value > 0) perUsd.NGN = value;
    } else {
      this.logger.warn(`NGN quote unavailable: ${reason(ngn.reason)}`);
    }

    if (Object.keys(perUsd).length === 0) {
      throw new ServiceUnavailableException('no display rates available');
    }

    const fresh = market.status === 'fulfilled' || ngn.status === 'fulfilled';
    const rates: DisplayRates = {
      perUsd,
      quotedAt:
        fresh || !this.cached
          ? new Date().toISOString()
          : this.cached.rates.quotedAt,
    };
    if (fresh) this.cached = { rates, at: Date.now() };
    return rates;
  }

  private async fetchMarket(): Promise<Record<string, number>> {
    const res = await fetch(MARKET_ENDPOINT, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`frankfurter responded ${res.status}`);
    const body = (await res.json()) as { rates?: Record<string, unknown> };
    const rates: Record<string, number> = { USD: 1 };
    for (const [code, value] of Object.entries(body.rates ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        rates[code] = value;
      }
    }
    return rates;
  }
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
