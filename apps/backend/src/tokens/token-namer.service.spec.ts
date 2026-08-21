import { TokenNamer } from './token-namer.service';
import type { ConfigService } from '@nestjs/config';
import type { TokenMetadataProvider } from './token-metadata.interface';

const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function makeNamer(opts: {
  index?: Record<string, { name: string; symbol: string; iconUrl: null }>;
  usdc?: string;
  throws?: boolean;
}) {
  const metadata = {
    getMetadata: jest.fn(() =>
      opts.throws
        ? Promise.reject(new Error('index down'))
        : Promise.resolve(new Map(Object.entries(opts.index ?? {}))),
    ),
  } as unknown as TokenMetadataProvider;

  const config = {
    get: (key: string) =>
      key === 'EXPO_PUBLIC_USDC_MINT_ADDRESS' ? opts.usdc : undefined,
  } as unknown as ConfigService;

  return { namer: new TokenNamer(metadata, config), metadata };
}

describe('TokenNamer', () => {
  it('names native SOL without asking anyone', async () => {
    const { namer, metadata } = makeNamer({});
    await expect(namer.symbolFor(WRAPPED_SOL)).resolves.toBe('SOL');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(metadata.getMetadata).not.toHaveBeenCalled();
  });

  it("names this cluster's USDC, which the index has never heard of", async () => {
    // The index covers mainnet, so on devnet the mint a Consumer actually
    // holds is exactly the one it cannot name.
    const { namer } = makeNamer({ usdc: DEVNET_USDC });
    await expect(namer.symbolFor(DEVNET_USDC)).resolves.toBe('USDC');
  });

  it('falls back to the index for anything else', async () => {
    const { namer } = makeNamer({
      index: { BonkMint: { name: 'Bonk', symbol: 'BONK', iconUrl: null } },
    });
    await expect(namer.symbolFor('BonkMint')).resolves.toBe('BONK');
  });

  it('returns nothing rather than inventing a ticker', async () => {
    const { namer } = makeNamer({});
    await expect(namer.symbolFor('MintNobodyKnows')).resolves.toBe('');
  });

  it('returns nothing when the index is unreachable', async () => {
    const { namer } = makeNamer({ throws: true });
    await expect(namer.symbolFor('AnyMint')).resolves.toBe('');
  });
});
