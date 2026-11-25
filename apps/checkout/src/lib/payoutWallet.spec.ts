import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPayoutWallet, payingStoreOrigin } from './payoutWallet';

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('payingStoreOrigin', () => {
  it('takes the store the Payment names', () => {
    expect(payingStoreOrigin('https://shop.example', null)).toBe(
      'https://shop.example',
    );
  });

  it('refuses a store other than the page that opened the checkout', () => {
    expect(() =>
      payingStoreOrigin('https://evil.example', 'https://shop.example'),
    ).toThrow('different store');
  });

  it('refuses a Payment with no store', () => {
    expect(() => payingStoreOrigin(null, null)).toThrow('names no store');
  });
});

describe('fetchPayoutWallet', () => {
  it('reads the wallet for the Payment network from the store site', async () => {
    respond(200, { payoutWallets: { mainnet: WALLET } });
    await expect(
      fetchPayoutWallet('https://shop.example', 'mainnet-beta'),
    ).resolves.toBe(WALLET);
    expect(fetch).toHaveBeenCalledWith(
      'https://shop.example/.well-known/prydd.json',
      expect.objectContaining({ redirect: 'error', credentials: 'omit' }),
    );
  });

  it('refuses when the store has published nothing', async () => {
    respond(404, {});
    await expect(
      fetchPayoutWallet('https://shop.example', 'devnet'),
    ).rejects.toThrow('status 404');
  });

  it('refuses when the store has no wallet for this network', async () => {
    respond(200, { payoutWallets: { mainnet: WALLET } });
    await expect(
      fetchPayoutWallet('https://shop.example', 'devnet'),
    ).rejects.toThrow('no wallet for devnet');
  });

  it('refuses a value that is not an address', async () => {
    respond(200, { payoutWallets: { devnet: 'not-a-wallet' } });
    await expect(
      fetchPayoutWallet('https://shop.example', 'devnet'),
    ).rejects.toThrow('no wallet for devnet');
  });
});
