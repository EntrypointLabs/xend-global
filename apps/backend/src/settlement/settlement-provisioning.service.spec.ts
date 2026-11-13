import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { SettlementProvisioningService } from './settlement-provisioning.service';
import { SettlementRouter } from './settlement-router';
import {
  SettlementAccountNotProvisionedError,
  SettlementProviderUnavailableError,
} from './settlement.errors';
import type { SettlementProvider } from './settlement-provider.interface';

const ENDPOINT = 'ENDPOINT_TOKEN_ACCOUNT';
const AUTHORITY = 'AUTHORITY_ATTRIBUTION_ROOT';

function makeConfig(cluster = 'devnet'): ConfigService {
  return {
    getOrThrow: () => cluster,
  } as unknown as ConfigService;
}

function fakeUsdcProvider(): {
  provider: SettlementProvider;
  provision: jest.Mock;
} {
  const provision = jest.fn().mockResolvedValue({
    address: ENDPOINT,
    providerReference: ENDPOINT,
    attributionRef: AUTHORITY,
    payoutConfig: null,
  });
  const provider: SettlementProvider = {
    capabilities: {
      provider: 'direct_usdc',
      currencies: ['USDC'],
      refundSupport: true,
      settlementLatency: 'instant',
    },
    provision,
    handleIncomingSettlement: jest.fn(),
    reverse: jest.fn(),
    report: jest.fn(),
  };
  return { provider, provision };
}

function makeDb(opts: {
  existing?: unknown[];
  onInsert?: (values: Record<string, unknown>) => void;
}): DbService {
  const rows = opts.existing ?? [];
  const executor = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        opts.onInsert?.(values);
        return { onConflictDoUpdate: () => Promise.resolve(undefined) };
      },
    }),
  };
  const client = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(rows) }),
      }),
    }),
    ...executor,
    transaction: <T>(fn: (tx: typeof executor) => Promise<T>) => fn(executor),
  };
  return { client } as unknown as DbService;
}

function makeSolana(registerWebhookAddress: jest.Mock): SolanaRpc {
  return { registerWebhookAddress } as unknown as SolanaRpc;
}

describe('SettlementProvisioningService', () => {
  it.each([
    { authorityAddress: AUTHORITY, observed: AUTHORITY },
    { authorityAddress: null, observed: 'WRONG_OWNER' },
    { authorityAddress: null, observed: null },
  ])(
    'refuses an unverified Merchant-controlled destination: %j',
    async ({ authorityAddress, observed }) => {
      const { provider } = fakeUsdcProvider();
      const service = new SettlementProvisioningService(
        makeDb({
          existing: [
            {
              address: ENDPOINT,
              provider: 'direct_usdc',
              provisionedAt: new Date(),
              providerReference: 'MERCHANT',
              authorityAddress,
              executionCluster: 'devnet',
            },
          ],
        }),
        makeConfig(),
        {
          getTokenAccountOwner: jest.fn().mockResolvedValue(observed),
        } as unknown as SolanaRpc,
        new SettlementRouter([provider]),
      );
      await expect(
        service.getSettlementAddressForSettlement('m_1'),
      ).rejects.toThrow(SettlementAccountNotProvisionedError);
    },
  );

  it('resolves a confirmed Merchant-owned USDC destination', async () => {
    const { provider } = fakeUsdcProvider();
    const service = new SettlementProvisioningService(
      makeDb({
        existing: [
          {
            address: ENDPOINT,
            provider: 'direct_usdc',
            provisionedAt: new Date(),
            providerReference: 'MERCHANT',
            authorityAddress: null,
            executionCluster: 'devnet',
          },
        ],
      }),
      makeConfig(),
      {
        getTokenAccountOwner: jest.fn().mockResolvedValue('MERCHANT'),
      } as unknown as SolanaRpc,
      new SettlementRouter([provider]),
    );
    await expect(
      service.getSettlementAddressForSettlement('m_1'),
    ).resolves.toEqual({
      address: ENDPOINT,
      owner: 'MERCHANT',
      provider: 'direct_usdc',
    });
  });
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('provisions via the router, records the polymorphic reference, and registers the webhook', async () => {
    const { provider, provision } = fakeUsdcProvider();
    const router = new SettlementRouter([provider]);
    let inserted: Record<string, unknown> | undefined;
    const db = makeDb({ existing: [], onInsert: (v) => (inserted = v) });
    const register = jest.fn().mockResolvedValue(undefined);
    const service = new SettlementProvisioningService(
      db,
      makeConfig(),
      makeSolana(register),
      router,
    );

    const result = await service.provisionOrLink('m_1', { currency: 'USDC' });

    expect(provision).toHaveBeenCalledWith({
      merchantId: 'm_1',
      merchantAddress: undefined,
    });
    expect(result).toEqual({
      address: ENDPOINT,
      provider: 'direct_usdc',
      provisioned: true,
    });
    expect(inserted).toMatchObject({
      merchantId: 'm_1',
      address: ENDPOINT,
      provider: 'direct_usdc',
      currency: 'USDC',
      providerReference: ENDPOINT,
      payoutConfig: null,
      authorityAddress: AUTHORITY,
      executionCluster: 'devnet',
    });
    expect(inserted?.provisionedAt).toBeInstanceOf(Date);
    expect(register).toHaveBeenCalledWith(ENDPOINT);
  });

  it('runs the onProvisioned callback in the same transaction as the destination upsert, only when it provisions', async () => {
    const { provider } = fakeUsdcProvider();
    const inserts: Record<string, unknown>[] = [];
    const audited: unknown[] = [];
    const service = new SettlementProvisioningService(
      makeDb({ existing: [], onInsert: (v) => inserts.push(v) }),
      makeConfig(),
      makeSolana(jest.fn().mockResolvedValue(undefined)),
      new SettlementRouter([provider]),
    );

    await service.provisionOrLink('m_1', { currency: 'USDC' }, (tx) => {
      // The callback receives the transaction handle, not the pooled client.
      expect(typeof tx.insert).toBe('function');
      audited.push('destination.provision');
      return Promise.resolve();
    });

    expect(inserts).toHaveLength(1);
    expect(audited).toEqual(['destination.provision']);
  });

  it('does not run onProvisioned on the idempotent path', async () => {
    const { provider } = fakeUsdcProvider();
    const audited: unknown[] = [];
    const service = new SettlementProvisioningService(
      makeDb({
        existing: [
          {
            address: ENDPOINT,
            provider: 'direct_usdc',
            provisionedAt: new Date(),
            executionCluster: 'devnet',
          },
        ],
      }),
      makeConfig(),
      makeSolana(jest.fn()),
      new SettlementRouter([provider]),
    );

    const result = await service.provisionOrLink(
      'm_1',
      { currency: 'USDC' },
      () => {
        audited.push('destination.provision');
        return Promise.resolve();
      },
    );

    expect(result.provisioned).toBe(false);
    expect(audited).toEqual([]);
  });

  it('is idempotent: an already-provisioned merchant returns the existing row without re-provisioning', async () => {
    const { provider, provision } = fakeUsdcProvider();
    const router = new SettlementRouter([provider]);
    const db = makeDb({
      existing: [
        {
          address: ENDPOINT,
          provider: 'direct_usdc',
          provisionedAt: new Date(),
          executionCluster: 'devnet',
        },
      ],
    });
    const register = jest.fn();
    const service = new SettlementProvisioningService(
      db,
      makeConfig(),
      makeSolana(register),
      router,
    );

    const result = await service.provisionOrLink('m_1', { currency: 'USDC' });

    expect(result).toEqual({
      address: ENDPOINT,
      provider: 'direct_usdc',
      provisioned: false,
    });
    expect(provision).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('reprovisions instead of reusing a destination from another cluster', async () => {
    const { provider, provision } = fakeUsdcProvider();
    let inserted: Record<string, unknown> | undefined;
    const service = new SettlementProvisioningService(
      makeDb({
        existing: [
          {
            address: 'DEVNET_ENDPOINT',
            provider: 'direct_usdc',
            provisionedAt: new Date(),
            executionCluster: 'devnet',
          },
        ],
        onInsert: (values) => (inserted = values),
      }),
      makeConfig('mainnet'),
      makeSolana(jest.fn()),
      new SettlementRouter([provider]),
    );

    await expect(
      service.provisionOrLink('m_1', { currency: 'USDC' }),
    ).resolves.toMatchObject({ provisioned: true, address: ENDPOINT });
    expect(provision).toHaveBeenCalledTimes(1);
    expect(inserted).toMatchObject({ executionCluster: 'mainnet' });
  });

  it('rejects a settlement destination from another cluster', async () => {
    const { provider } = fakeUsdcProvider();
    const service = new SettlementProvisioningService(
      makeDb({
        existing: [
          {
            address: ENDPOINT,
            provider: 'direct_usdc',
            provisionedAt: new Date(),
            executionCluster: 'devnet',
          },
        ],
      }),
      makeConfig('mainnet'),
      makeSolana(jest.fn()),
      new SettlementRouter([provider]),
    );

    await expect(
      service.getSettlementAddressForSettlement('m_1'),
    ).rejects.toThrow(SettlementAccountNotProvisionedError);
  });

  it('routes NGN to the unregistered Blockradar slot and throws SETTLEMENT_PROVIDER_UNAVAILABLE', async () => {
    const { provider } = fakeUsdcProvider();
    const router = new SettlementRouter([provider]);
    const db = makeDb({ existing: [] });
    const service = new SettlementProvisioningService(
      db,
      makeConfig(),
      makeSolana(jest.fn()),
      router,
    );

    await expect(
      service.provisionOrLink('m_ngn', { currency: 'NGN' }),
    ).rejects.toThrow(SettlementProviderUnavailableError);
  });

  it('does not fail provisioning when webhook registration fails', async () => {
    const { provider } = fakeUsdcProvider();
    const router = new SettlementRouter([provider]);
    const db = makeDb({ existing: [] });
    const register = jest
      .fn()
      .mockRejectedValue(new Error('helius webhook down'));
    const service = new SettlementProvisioningService(
      db,
      makeConfig(),
      makeSolana(register),
      router,
    );

    const result = await service.provisionOrLink('m_1', { currency: 'USDC' });
    expect(result.provisioned).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('getSettlementAddressForSettlement throws when the merchant is unprovisioned', async () => {
    const { provider } = fakeUsdcProvider();
    const router = new SettlementRouter([provider]);
    const db = makeDb({ existing: [] });
    const service = new SettlementProvisioningService(
      db,
      makeConfig(),
      makeSolana(jest.fn()),
      router,
    );

    await expect(
      service.getSettlementAddressForSettlement('m_missing'),
    ).rejects.toThrow(SettlementAccountNotProvisionedError);
  });

  it('refuses to silently reuse a Xend-controlled endpoint for Merchant-owned onboarding', async () => {
    const { provider, provision } = fakeUsdcProvider();
    const service = new SettlementProvisioningService(
      makeDb({
        existing: [
          {
            address: ENDPOINT,
            provider: 'direct_usdc',
            provisionedAt: new Date(),
            authorityAddress: AUTHORITY,
            providerReference: ENDPOINT,
            executionCluster: 'devnet',
          },
        ],
      }),
      makeConfig(),
      makeSolana(jest.fn()),
      new SettlementRouter([provider]),
    );
    await expect(
      service.provisionOrLink('m_1', {
        currency: 'USDC',
        merchantAddress: 'MERCHANT',
      }),
    ).rejects.toThrow(SettlementAccountNotProvisionedError);
    expect(provision).not.toHaveBeenCalled();
  });
});
