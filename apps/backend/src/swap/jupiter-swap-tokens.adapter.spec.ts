import { JupiterSwapTokensAdapter } from './jupiter-swap-tokens.adapter';

const listed = [
  { id: 'mint-a', symbol: 'AAA', name: 'Alpha', decimals: 6, isVerified: true },
  { id: 'mint-b', symbol: 'AAA', name: 'Alpha copy', decimals: 6 },
  {
    id: 'mint-c',
    symbol: 'CCC',
    decimals: 9,
    isVerified: true,
    icon: 'https://x/c.png',
  },
  { id: 'mint-d', symbol: 'DDD', isVerified: true },
];

describe('JupiterSwapTokensAdapter', () => {
  let fetched: string[];

  beforeEach(() => {
    fetched = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      fetched.push(url instanceof Request ? url.url : url.toString());
      return Promise.resolve(
        new Response(JSON.stringify(listed), { status: 200 }),
      );
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('offers only verified tokens it can describe in full', async () => {
    const tokens = await new JupiterSwapTokensAdapter().search('aaa');
    expect(tokens).toEqual([
      {
        mint: 'mint-a',
        symbol: 'AAA',
        name: 'Alpha',
        decimals: 6,
        iconUrl: null,
      },
      {
        mint: 'mint-c',
        symbol: 'CCC',
        name: 'CCC',
        decimals: 9,
        iconUrl: 'https://x/c.png',
      },
    ]);
  });

  it('answers an empty search with the popular list', async () => {
    await new JupiterSwapTokensAdapter().search('  ');
    expect(fetched[0]).toContain('/toporganicscore/24h');
  });

  it('does not ask again for a search it has just answered', async () => {
    const adapter = new JupiterSwapTokensAdapter();
    await adapter.search('Bonk');
    await adapter.search('bonk ');
    expect(fetched).toHaveLength(1);
  });

  it('keeps the last popular list when the source stops answering', async () => {
    const adapter = new JupiterSwapTokensAdapter();
    const first = await adapter.popular();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000);
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    await expect(adapter.popular()).resolves.toEqual(first);
  });
});
