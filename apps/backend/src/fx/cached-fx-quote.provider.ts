import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { FxQuote, FxQuoteProvider } from './fx-quote-provider.interface';
import { PartnerFxAdapter } from './partner-fx.adapter';
import { FxQuoteUnavailableError } from './fx.errors';

const CACHE_KEY = 'fx:quote:ngn_usdc';

interface CachedQuote {
  ngnPerUsdc: string;
  source: string;
  quotedAt: string;
}

/**
 * The active FX_QUOTE_PROVIDER binding. Wraps the partner adapter and is the
 * SOLE Redis importer in this module (ADR 0010 second-caller rule). On a
 * partner success it caches the quote (no TTL: staleness is judged from
 * quotedAt, not eviction). When the partner is down it serves a cached quote
 * ONLY inside the staleness cap; beyond the cap it throws rather than pricing
 * an intent on a stale or guessed rate (fail loud).
 */
@Injectable()
export class CachedFxQuoteProvider implements FxQuoteProvider {
  private readonly logger = new Logger(CachedFxQuoteProvider.name);

  constructor(
    private readonly partner: PartnerFxAdapter,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getQuote(): Promise<FxQuote> {
    try {
      const fresh = await this.partner.getQuote();
      const cached: CachedQuote = {
        ngnPerUsdc: fresh.ngnPerUsdc,
        source: fresh.source,
        quotedAt: fresh.quotedAt.toISOString(),
      };
      await this.redis.set(CACHE_KEY, JSON.stringify(cached));
      this.log(fresh.source, 0, true);
      return fresh;
    } catch (partnerErr) {
      const raw = await this.redis.get(CACHE_KEY);
      if (!raw) {
        throw new FxQuoteUnavailableError(
          `partner quote unavailable and no cached quote: ${
            partnerErr instanceof Error
              ? partnerErr.message
              : String(partnerErr)
          }`,
        );
      }
      const cached = JSON.parse(raw) as CachedQuote;
      const quotedAt = new Date(cached.quotedAt);
      const ageSeconds = Math.floor((Date.now() - quotedAt.getTime()) / 1000);
      const cap = this.config.getOrThrow<number>('FX_STALENESS_CAP_SECONDS');
      if (ageSeconds > cap) {
        this.log(`${cached.source}+cached`, ageSeconds, false);
        throw new FxQuoteUnavailableError(
          `cached quote is stale (age ${ageSeconds}s > cap ${cap}s)`,
        );
      }
      this.log(`${cached.source}+cached`, ageSeconds, false);
      return {
        ngnPerUsdc: cached.ngnPerUsdc,
        source: `${cached.source}+cached`,
        quotedAt,
      };
    }
  }

  private log(source: string, ageSeconds: number, fresh: boolean): void {
    this.logger.log(
      `fx.quote source=${source} age_s=${ageSeconds} fresh=${fresh}`,
    );
  }
}
