import { JupiterSwapTokensAdapter } from './jupiter-swap-tokens.adapter';

const verified = (symbol: string, over: object = {}) => ({
  id: `mint-${symbol}`,
  symbol,
  name: symbol,
  decimals: 6,
  isVerified: true,
  ...over,
});

const listed = [
  verified('SOL', { usdPrice: 180, tags: ['major', 'verified'] }),
  { id: 'mint-copy', symbol: 'SOL', name: 'SOL copy', decimals: 6 },
  verified('USDC', { tags: ['stable'], icon: 'https://x/usdc.png' }),
  verified('NVDAx', { tags: ['rwa', 'xstocks', 'stocks'] }),
  verified('BONK', { tags: ['meme', 'community'] }),
  verified('FRESH', { launchpad: 'pump.fun' }),
  verified('PUMP', { launchpad: 'pump.fun', tags: ['defi'] }),
  { id: 'mint-NEW', symbol: 'NEW', name: 'New', decimals: 6 },
  { id: 'mint-nodecimals', symbol: 'DDD', isVerified: true },
];

describe('JupiterSwapTokensAdapter', () => {
  let fetched: string[];
  const symbols = (tokens: { symbol: string }[]) => tokens.map((t) => t.symbol);

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

  it('finds every token it can describe in full, verified or not', async () => {
    const tokens = await new JupiterSwapTokensAdapter().search('anything');
    expect(symbols(tokens)).toEqual([
      'SOL',
      'SOL',
      'USDC',
      'NVDAx',
      'BONK',
      'FRESH',
      'PUMP',
      'NEW',
    ]);
    expect(tokens[0]).toEqual({
      mint: 'mint-SOL',
      symbol: 'SOL',
      name: 'SOL',
      decimals: 6,
      iconUrl: null,
      category: 'crypto',
      trust: 'verified',
      usdPrice: 180,
    });
  });

  it("warns about an unverified token wearing a verified token's ticker", async () => {
    const tokens = await new JupiterSwapTokensAdapter().search('anything');
    const trust = (mint: string) => tokens.find((t) => t.mint === mint)?.trust;
    expect(trust('mint-copy')).toBe('caution');
    // Unverified, but passing itself off as nothing.
    expect(trust('mint-NEW')).toBe('unverified');
  });

  it('warns about a token the source itself calls suspicious', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'mint-x',
            symbol: 'XXX',
            decimals: 6,
            audit: { isSus: true },
          },
        ]),
        { status: 200 },
      ),
    );
    const [token] = await new JupiterSwapTokensAdapter().search('xxx');
    expect(token.trust).toBe('caution');
  });

  it('browses verified tokens only', async () => {
    const adapter = new JupiterSwapTokensAdapter();
    const listed = [
      ...(await adapter.popular()),
      ...(await adapter.popular('crypto')),
      ...(await adapter.popular('meme')),
    ];
    expect(listed.every((token) => token.trust === 'verified')).toBe(true);
  });

  it('keeps stocks and meme tokens out of the everyday list', async () => {
    const tokens = await new JupiterSwapTokensAdapter().popular();
    expect(symbols(tokens)).toEqual(['SOL', 'USDC', 'PUMP']);
  });

  it('shelves each token by what the source calls it', async () => {
    const adapter = new JupiterSwapTokensAdapter();
    expect(symbols(await adapter.popular('stocks'))).toEqual(['NVDAx']);
    expect(symbols(await adapter.popular('stable'))).toEqual(['USDC']);
    expect(symbols(await adapter.popular('meme'))).toEqual(['BONK', 'FRESH']);
    // One ranking serves every shelf.
    expect(fetched).toHaveLength(1);
  });

  it('answers an empty search with the everyday list', async () => {
    const tokens = await new JupiterSwapTokensAdapter().search('  ');
    expect(fetched[0]).toContain('/toporganicscore/24h');
    expect(symbols(tokens)).toEqual(['SOL', 'USDC', 'PUMP']);
  });

  it('does not ask again for a search it has just answered', async () => {
    const adapter = new JupiterSwapTokensAdapter();
    await adapter.search('Bonk');
    await adapter.search('bonk ');
    expect(fetched.filter((url) => url.includes('/search'))).toHaveLength(1);
  });

  it('keeps the last ranking when the source stops answering', async () => {
    const adapter = new JupiterSwapTokensAdapter();
    const first = await adapter.popular();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000);
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    await expect(adapter.popular()).resolves.toEqual(first);
  });
});
