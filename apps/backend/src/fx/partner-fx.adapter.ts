import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FxQuote, FxQuoteProvider } from './fx-quote-provider.interface';
import { FxQuoteUnavailableError } from './fx.errors';

/**
 * The only toucher of the off-ramp partner quote API (the Blockradar/Paycrest
 * quote-API vendor category, ADR 0023). When FX_PARTNER_QUOTE_URL is set it
 * fetches an executable NGN/USDC rate; when it is blank it returns the pilot
 * static rate so devnet E2E is deterministic and the seam is ready for the
 * real quote API. This adapter never caches; the cache wraps it.
 */
@Injectable()
export class PartnerFxAdapter implements FxQuoteProvider {
  private readonly logger = new Logger(PartnerFxAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async getQuote(): Promise<FxQuote> {
    const url = this.config.get<string>('FX_PARTNER_QUOTE_URL');
    if (!url) {
      return {
        ngnPerUsdc: this.config.getOrThrow<string>('FX_PILOT_STATIC_RATE'),
        source: 'pilot-static',
        quotedAt: new Date(),
      };
    }

    const timeoutMs = this.config.getOrThrow<number>('FX_QUOTE_TIMEOUT_MS');
    let body: unknown;
    try {
      const res = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new FxQuoteUnavailableError(
          `partner quote returned ${res.status}`,
        );
      }
      body = await res.json();
    } catch (err) {
      if (err instanceof FxQuoteUnavailableError) throw err;
      throw new FxQuoteUnavailableError(
        `partner quote fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const rate = this.extractRate(body);
    if (!rate) {
      throw new FxQuoteUnavailableError('partner quote missing a valid rate');
    }
    return { ngnPerUsdc: rate, source: 'partner', quotedAt: new Date() };
  }

  private extractRate(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) return undefined;
    const raw = (body as { ngnPerUsdc?: unknown }).ngnPerUsdc;
    const value =
      typeof raw === 'number'
        ? String(raw)
        : typeof raw === 'string'
          ? raw
          : '';
    return /^\d+(\.\d+)?$/.test(value) ? value : undefined;
  }
}
