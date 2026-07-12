import { Logger } from '@nestjs/common';
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
  const client = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(rows) }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        opts.onInsert?.(values);
        return { onConflictDoUpdate: () => Promise.resolve(undefined) };
      },
    }),
  };
  return { client } as unknown as DbService;
}

function makeSolana(registerWebhookAddress: jest.Mock): SolanaRpc {
  return { registerWebhookAddress } as unknown as SolanaRpc;
}

describe('SettlementProvisioningService', () => {
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
    });
    expect(inserted?.provisionedAt).toBeInstanceOf(Date);
    expect(register).toHaveBeenCalledWith(ENDPOINT);
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
        },
      ],
    });
    const register = jest.fn();
    const service = new SettlementProvisioningService(
      db,
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

  it('routes NGN to the unregistered Blockradar slot and throws SETTLEMENT_PROVIDER_UNAVAILABLE', async () => {
    const { provider } = fakeUsdcProvider();
    const router = new SettlementRouter([provider]);
    const db = makeDb({ existing: [] });
    const service = new SettlementProvisioningService(
      db,
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
      makeSolana(jest.fn()),
      router,
    );

    await expect(
      service.getSettlementAddressForSettlement('m_missing'),
    ).rejects.toThrow(SettlementAccountNotProvisionedError);
  });
});
