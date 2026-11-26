import { JupiterTokenMetadataAdapter } from './jupiter-token-metadata.adapter';

const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

describe('JupiterTokenMetadataAdapter', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps an expired name and logo when the refresh fails', async () => {
    const adapter = new JupiterTokenMetadataAdapter();
    jest.useFakeTimers({ now: Date.UTC(2026, 10, 26) });
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: USDT, name: 'USDT', symbol: 'USDT', icon: 'https://usdt' },
          ]),
      } as unknown as Response)
      .mockRejectedValueOnce(new Error('timeout'));

    await adapter.getMetadata([USDT]);
    jest.setSystemTime(Date.UTC(2026, 10, 26, 7));
    const found = await adapter.getMetadata([USDT]);

    expect(found.get(USDT)).toEqual({
      name: 'USDT',
      symbol: 'USDT',
      iconUrl: 'https://usdt',
    });
  });

  it('has nothing to offer for a mint it never resolved', async () => {
    const adapter = new JupiterTokenMetadataAdapter();
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));

    expect((await adapter.getMetadata([USDT])).size).toBe(0);
  });
});
