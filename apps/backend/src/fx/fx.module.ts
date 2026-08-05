import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { FX_QUOTE_PROVIDER } from './fx-quote-provider.interface';
import { PartnerFxAdapter } from './partner-fx.adapter';
import { CachedFxQuoteProvider } from './cached-fx-quote.provider';

/**
 * FX quote seam (ADR 0023). FX_QUOTE_PROVIDER is bound to the cached provider,
 * which wraps the partner adapter. Redis is reached only inside the cache
 * adapter (ADR 0010). Swapping the partner is a single edit here.
 */
@Module({
  imports: [RedisModule],
  providers: [
    PartnerFxAdapter,
    CachedFxQuoteProvider,
    { provide: FX_QUOTE_PROVIDER, useExisting: CachedFxQuoteProvider },
  ],
  exports: [FX_QUOTE_PROVIDER],
})
export class FxModule {}
