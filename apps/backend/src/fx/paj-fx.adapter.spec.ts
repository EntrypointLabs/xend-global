import type { ConfigService } from '@nestjs/config';
import type { PajClient } from '../settlement/providers/paj/paj.client';
import { FxQuoteUnavailableError } from './fx.errors';
import { PajFxAdapter } from './paj-fx.adapter';

const config = { getOrThrow: () => 3000 } as unknown as ConfigService;

describe('PajFxAdapter', () => {
  it('quotes the off-ramp rate, not the on-ramp rate', async () => {
    const getRates = jest.fn().mockResolvedValue({
      onRampRate: { rate: 1397.72, createdAt: 'x' },
      offRampRate: { rate: 1376.08, createdAt: 'x' },
    });
    const adapter = new PajFxAdapter(
      { getRates } as unknown as PajClient,
      config,
    );

    const quote = await adapter.getQuote();

    expect(quote.ngnPerUsdc).toBe('1376.08');
    expect(quote.source).toBe('paj-offramp');
    expect(getRates).toHaveBeenCalledWith(3000);
  });

  it('fails as an unavailable quote when PAJ cannot be reached', async () => {
    const adapter = new PajFxAdapter(
      {
        getRates: () => Promise.reject(new Error('timeout')),
      } as unknown as PajClient,
      config,
    );

    await expect(adapter.getQuote()).rejects.toBeInstanceOf(
      FxQuoteUnavailableError,
    );
  });
});
