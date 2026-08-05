import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { PartnerFxAdapter } from './partner-fx.adapter';
import { CachedFxQuoteProvider } from './cached-fx-quote.provider';
import { FxQuoteUnavailableError } from './fx.errors';
import type { FxQuote } from './fx-quote-provider.interface';

function makeRedis(initial?: string) {
  const store = new Map<string, string>();
  if (initial) store.set('fx:quote:ngn_usdc', initial);
  const redis = {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    set: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve('OK');
    },
  } as unknown as Redis;
  return { redis, store };
}

const config = {
  getOrThrow: (k: string) => {
    if (k === 'FX_STALENESS_CAP_SECONDS') return 900;
    throw new Error(`unexpected key ${k}`);
  },
} as unknown as ConfigService;

function partnerReturning(quote: FxQuote): PartnerFxAdapter {
  return {
    getQuote: () => Promise.resolve(quote),
  } as unknown as PartnerFxAdapter;
}

function partnerThrowing(): PartnerFxAdapter {
  return {
    getQuote: () => Promise.reject(new FxQuoteUnavailableError('partner down')),
  } as unknown as PartnerFxAdapter;
}

describe('CachedFxQuoteProvider', () => {
  it('caches and returns a fresh partner quote', async () => {
    const { redis, store } = makeRedis();
    const quotedAt = new Date();
    const provider = new CachedFxQuoteProvider(
      partnerReturning({ ngnPerUsdc: '1600.00', source: 'partner', quotedAt }),
      config,
      redis,
    );
    const result = await provider.getQuote();
    expect(result.ngnPerUsdc).toBe('1600.00');
    expect(result.source).toBe('partner');
    expect(store.get('fx:quote:ngn_usdc')).toContain('1600.00');
  });

  it('returns a within-cap cached quote when the partner is down', async () => {
    const quotedAt = new Date(Date.now() - 60_000).toISOString();
    const { redis } = makeRedis(
      JSON.stringify({ ngnPerUsdc: '1590.00', source: 'partner', quotedAt }),
    );
    const provider = new CachedFxQuoteProvider(
      partnerThrowing(),
      config,
      redis,
    );
    const result = await provider.getQuote();
    expect(result.ngnPerUsdc).toBe('1590.00');
    expect(result.source).toBe('partner+cached');
  });

  it('throws FX_QUOTE_UNAVAILABLE when the cached quote is beyond the cap', async () => {
    const quotedAt = new Date(Date.now() - 1_000_000).toISOString();
    const { redis } = makeRedis(
      JSON.stringify({ ngnPerUsdc: '1590.00', source: 'partner', quotedAt }),
    );
    const provider = new CachedFxQuoteProvider(
      partnerThrowing(),
      config,
      redis,
    );
    await expect(provider.getQuote()).rejects.toMatchObject({
      code: 'FX_QUOTE_UNAVAILABLE',
    });
  });

  it('throws FX_QUOTE_UNAVAILABLE when the partner is down and no cache exists', async () => {
    const { redis } = makeRedis();
    const provider = new CachedFxQuoteProvider(
      partnerThrowing(),
      config,
      redis,
    );
    await expect(provider.getQuote()).rejects.toMatchObject({
      code: 'FX_QUOTE_UNAVAILABLE',
    });
  });
});
