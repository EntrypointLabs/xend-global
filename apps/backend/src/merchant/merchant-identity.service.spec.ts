import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';
import { MerchantIdentityService } from './merchant-identity.service';

jest.mock('@privy-io/server-auth', () => ({ PrivyClient: jest.fn() }));

describe('Merchant identity isolation', () => {
  const getUser = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    (PrivyClient as jest.Mock).mockImplementation(() => ({ getUser }));
  });
  function service(overrides = {}) {
    return new MerchantIdentityService(
      new ConfigService({
        PRIVY_APP_ID: 'consumer-app',
        PRIVY_APP_SECRET: 'consumer-secret',
        MERCHANT_PRIVY_APP_ID: 'merchant-app',
        MERCHANT_PRIVY_APP_SECRET: 'merchant-secret',
        NODE_ENV: 'development',
        ...overrides,
      }),
    );
  }
  it('uses only Merchant app credentials and verifies each token', async () => {
    getUser.mockResolvedValue({
      id: 'merchant-owner',
      linkedAccounts: [
        {
          type: 'wallet',
          chainType: 'solana',
          walletClientType: 'privy',
          address: 'receiving-wallet',
        },
      ],
    });
    const identity = service();
    await expect(
      identity.verifyIdToken('merchant-token'),
    ).resolves.toMatchObject({ walletAddress: 'receiving-wallet' });
    await identity.verifyIdToken('second-token');
    expect(PrivyClient).toHaveBeenCalledTimes(1);
    expect(PrivyClient).toHaveBeenCalledWith('merchant-app', 'merchant-secret');
    expect(getUser).toHaveBeenLastCalledWith({ idToken: 'second-token' });
  });
  it.each([
    { MERCHANT_PRIVY_APP_ID: '' },
    { MERCHANT_PRIVY_APP_SECRET: '' },
    { MERCHANT_PRIVY_APP_ID: 'consumer-app' },
  ])('fails closed for missing or shared configuration %o', (overrides) => {
    expect(() => service(overrides).verifyIdToken('token')).toThrow(
      ServiceUnavailableException,
    );
    expect(PrivyClient).not.toHaveBeenCalled();
  });
  it('does not substitute a development placeholder for a missing wallet', async () => {
    getUser.mockResolvedValue({ id: 'merchant-owner', linkedAccounts: [] });
    await expect(service().verifyIdToken('token')).rejects.toThrow(
      'no Solana wallet',
    );
  });
  it('does not retry a rejected token with Consumer credentials', async () => {
    getUser.mockRejectedValue(new Error('invalid token'));
    await expect(service().verifyIdToken('wrong-app-token')).rejects.toThrow();
    expect(PrivyClient).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
