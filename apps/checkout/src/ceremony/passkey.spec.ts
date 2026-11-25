// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  signTransaction: vi.fn(),
  assertCheckoutSpend: vi.fn(),
}));
vi.mock('./verifySpend', () => ({
  assertCheckoutSpend: mocks.assertCheckoutSpend,
}));
vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({ authenticated: true }),
  useIdentityToken: () => ({ identityToken: 'identity' }),
  useLoginWithPasskey: () => ({ loginWithPasskey: vi.fn() }),
}));
vi.mock('@privy-io/react-auth/solana', () => ({
  useSignTransaction: () => ({ signTransaction: mocks.signTransaction }),
  useWallets: () => ({ wallets: [{ address: 'consumer-s1' }] }),
}));

import { usePasskeyCeremony } from './passkey';
import { solanaRpcs } from '../lib/solana';

let root: Root;
function renderHook(hook: typeof usePasskeyCeremony) {
  const result = {} as { current: ReturnType<typeof usePasskeyCeremony> };
  function Probe() {
    result.current = hook();
    return null;
  }
  root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
  return { result };
}
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => act(() => root?.unmount()));

describe('Payment signing network', () => {
  beforeEach(() => {
    mocks.assertCheckoutSpend.mockReset();
    mocks.signTransaction
      .mockReset()
      .mockResolvedValue({ signedTransaction: new Uint8Array([1]) });
  });

  it.each([
    ['devnet', 'solana:devnet'],
    ['testnet', 'solana:testnet'],
    ['mainnet-beta', 'solana:mainnet'],
  ] as const)(
    'passes the backend %s network to the signer with a configured RPC',
    async (cluster, chain) => {
      const { result } = renderHook(() => usePasskeyCeremony());
      await result.current.signSpend(
        'AQ==',
        'consumer-s1',
        cluster,
        '1000',
        'store-wallet',
      );
      expect(mocks.signTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          chain,
          wallet: { address: 'consumer-s1' },
          options: { uiOptions: { showWalletUIs: false } },
        }),
      );
      expect(solanaRpcs[chain].rpc).toBeDefined();
      expect(solanaRpcs[chain].rpcSubscriptions).toBeDefined();
    },
  );

  it.each(['', 'unknown', undefined])(
    'refuses an absent or unsupported network instead of defaulting to mainnet: %s',
    async (cluster) => {
      const { result } = renderHook(() => usePasskeyCeremony());
      await expect(
        result.current.signSpend(
          'AQ==',
          'consumer-s1',
          cluster as string,
          '1000',
          'store-wallet',
        ),
      ).rejects.toThrow('execution network');
      expect(mocks.signTransaction).not.toHaveBeenCalled();
    },
  );

  it('signs nothing when the Spend does not match the Payment on screen', async () => {
    mocks.assertCheckoutSpend.mockImplementation(() => {
      throw new Error('it sends a different amount');
    });
    const { result } = renderHook(() => usePasskeyCeremony());
    await expect(
      result.current.signSpend(
        'AQ==',
        'consumer-s1',
        'devnet',
        '1000',
        'store-wallet',
      ),
    ).rejects.toThrow('different amount');
    expect(mocks.signTransaction).not.toHaveBeenCalled();
  });
});
