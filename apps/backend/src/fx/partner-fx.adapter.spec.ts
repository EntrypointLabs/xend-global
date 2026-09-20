import type { ConfigService } from '@nestjs/config';
import { BlockradarFxAdapter } from './blockradar-fx.adapter';
import { PartnerFxAdapter } from './partner-fx.adapter';
import { FxQuoteUnavailableError } from './fx.errors';

describe('PartnerFxAdapter mainnet pricing', () => {
  afterEach(() => jest.restoreAllMocks());
  const blockradarConfig = (key?: string) =>
    ({
      get: (name: string) =>
        ({
          FX_QUOTE_SOURCE: 'blockradar',
          BLOCKRADAR_API_KEY: key,
          SOLANA_CLUSTER: 'mainnet',
        })[name],
      getOrThrow: () => 3000,
    }) as unknown as ConfigService;

  it('fetches only the authenticated reference price for USDC/NGN', async () => {
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ statusCode: 200, data: { USDC: { NGN: 1500.25 } } }),
        ),
      );
    const quote = await new BlockradarFxAdapter(
      blockradarConfig('test-key'),
    ).getQuote();
    expect(quote).toMatchObject({
      ngnPerUsdc: '1500.25',
      source: 'blockradar-reference',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.blockradar.co/v1/assets/rates?currency=NGN&assets=USDC',
      expect.objectContaining({
        redirect: 'error',
        headers: { 'x-api-key': 'test-key' },
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { statusCode: 200, data: { USDC: { USD: 1 } } },
    { statusCode: 200, data: { USDC: { NGN: 0 } } },
    { statusCode: 200, data: { USDC: { NGN: 0.0006 } } },
    { statusCode: 200, data: { USDC: { NGN: 1500000 } } },
    { statusCode: 200, data: { USDC: { NGN: -1 } } },
    { statusCode: 500, data: { USDC: { NGN: 1500 } } },
  ])('refuses an invalid pair or rate: %j', async (body) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(
      new BlockradarFxAdapter(blockradarConfig('test-key')).getQuote(),
    ).rejects.toThrow(FxQuoteUnavailableError);
  });

  it('refuses missing credentials without making a request', async () => {
    const fetcher = jest.spyOn(global, 'fetch');
    await expect(
      new BlockradarFxAdapter(blockradarConfig()).getQuote(),
    ).rejects.toThrow(FxQuoteUnavailableError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  const config = (cluster: string) =>
    ({
      get: (key: string) => (key === 'SOLANA_CLUSTER' ? cluster : undefined),
      getOrThrow: () => '1500',
    }) as unknown as ConfigService;

  it('refuses a static mainnet rate when no provider is configured', async () => {
    await expect(
      new PartnerFxAdapter(config('mainnet')).getQuote(),
    ).rejects.toThrow(FxQuoteUnavailableError);
  });

  it('keeps explicit devnet pricing available', async () => {
    await expect(
      new PartnerFxAdapter(config('devnet')).getQuote(),
    ).resolves.toMatchObject({ source: 'pilot-static', ngnPerUsdc: '1500' });
  });
});
