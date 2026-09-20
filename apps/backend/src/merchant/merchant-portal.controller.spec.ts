import { ServiceUnavailableException } from '@nestjs/common';
import {
  PrivyUnavailableError,
  PrivyUserShapeError,
} from '../wallet/privy.errors';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import type { MerchantIdentityService } from './merchant-identity.service';
import type { SettlementProvisioningService } from '../settlement/settlement-provisioning.service';
import type { KeyIssuanceService } from './key-issuance.service';
import { MerchantPortalController } from './merchant-portal.controller';
import { MerchantOwnerService } from './merchant-owner.service';
import type { MerchantAuditService } from './merchant-audit.service';
import { SettlementAccountNotProvisionedError } from '../settlement/settlement.errors';
import { ApiKeyNotFoundError, KybNotVerifiedError } from './merchant.errors';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  apiKeys,
  merchants,
  paymentIntents,
  settlementAccounts,
} from '../db/schema';

function setup(
  merchant: Record<string, unknown> | null = {
    id: 'merchant-owned',
    kybStatus: 'pending',
    receivingWallet: 'owner-wallet',
    settlementTermsAcceptedAt: new Date(),
  },
  cluster = 'devnet',
  enabled = false,
) {
  const where = jest.fn().mockReturnValue({
    limit: () => Promise.resolve(merchant ? [merchant] : []),
  });
  const select = jest.fn().mockReturnValue({ from: () => ({ where }) });
  const verifyIdToken = jest.fn().mockResolvedValue({
    providerUserId: 'verified-owner',
    walletAddress: 'owner-wallet',
  });
  const issueKey = jest
    .fn()
    .mockResolvedValue({ raw: 'test-key', fingerprint: 'test…key' });
  const provisionOrLink = jest.fn().mockResolvedValue({ address: 'ata' });
  const getSettlementAddressForSettlement = jest
    .fn()
    .mockResolvedValue({ address: 'ata' });
  const revokeKey = jest.fn().mockResolvedValue({
    id: 'ak-owned',
    revokedAt: new Date('2026-09-19T00:00:00Z'),
  });
  const rotateKey = jest.fn().mockResolvedValue({
    id: 'ak-next',
    raw: 'next-key',
    fingerprint: 'next…key',
  });
  const db = {
    client: {
      select,
      // Key issue/revoke/rotate run inside a transaction; the mocked services
      // ignore the handle, so invoking the callback with a stub is enough.
      transaction: (cb: (tx: unknown) => unknown) => cb({}),
    },
  } as unknown as DbService;
  const owner = new MerchantOwnerService(db, {
    verifyIdToken,
  } as unknown as MerchantIdentityService);
  const record = jest.fn().mockResolvedValue(undefined);
  const controller = new MerchantPortalController(
    db,
    owner,
    { issueKey, revokeKey, rotateKey } as unknown as KeyIssuanceService,
    {
      provisionOrLink,
      getSettlementAddressForSettlement,
    } as unknown as SettlementProvisioningService,
    {
      get: (key: string) =>
        ({
          SOLANA_CLUSTER: cluster,
          NODE_ENV: 'development',
          DEVNET_PAYMENTS_ENABLED: enabled,
        })[key],
    } as unknown as ConfigService,
    { record } as unknown as MerchantAuditService,
  );
  return {
    controller,
    getSettlementAddressForSettlement,
    verifyIdToken,
    issueKey,
    revokeKey,
    rotateKey,
    provisionOrLink,
    record,
    select,
  };
}

describe('Merchant portal ownership', () => {
  it('rejects unauthenticated revocation before accessing keys', async () => {
    const { controller, revokeKey, select } = setup();
    await expect(controller.revoke(undefined, 'ak-owned')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(select).not.toHaveBeenCalled();
    expect(revokeKey).not.toHaveBeenCalled();
  });
  it.each([
    { rows: [] },
    { rows: [{ id: 'ak-other', merchantId: 'another-merchant' }] },
  ])('does not revoke missing or foreign keys: %j', async ({ rows }) => {
    const { controller, revokeKey, select } = setup();
    select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: 'merchant-owned' }]),
        }),
      }),
    });
    select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    });
    await expect(controller.revoke('Bearer token', 'ak-other')).rejects.toThrow(
      NotFoundException,
    );
    expect(revokeKey).not.toHaveBeenCalled();
  });
  it('revokes only a key belonging to the authenticated Merchant', async () => {
    const { controller, revokeKey, select } = setup();
    select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: 'merchant-owned' }]),
        }),
      }),
    });
    select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([{ id: 'ak-owned', merchantId: 'merchant-owned' }]),
        }),
      }),
    });
    await expect(
      controller.revoke('Bearer token', 'ak-owned'),
    ).resolves.toEqual({
      id: 'ak-owned',
      revokedAt: '2026-09-19T00:00:00.000Z',
    });
    expect(revokeKey).toHaveBeenCalledWith('ak-owned', expect.anything());
  });
  it('reports unconfirmed receiving-account ownership as a retryable conflict', async () => {
    const { controller, provisionOrLink } = setup();
    provisionOrLink.mockRejectedValue(
      new SettlementAccountNotProvisionedError('unconfirmed'),
    );
    await expect(controller.provision('Bearer token')).rejects.toThrow(
      ConflictException,
    );
  });
  it('rejects missing authentication before database or key operations', async () => {
    const { controller, issueKey, select } = setup();
    await expect(controller.issue(undefined, { mode: 'test' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(select).not.toHaveBeenCalled();
    expect(issueKey).not.toHaveBeenCalled();
  });
  it('requires a real provider wallet, including in development', async () => {
    const { controller, verifyIdToken, issueKey } = setup();
    await controller.issue('Bearer token', { mode: 'test' });
    expect(verifyIdToken).toHaveBeenCalledWith('token');
    expect(issueKey).toHaveBeenCalledWith(
      'merchant-owned',
      'test',
      { name: undefined },
      expect.anything(),
    );
  });
  it('cannot issue keys without an owned Merchant record', async () => {
    const { controller, issueKey } = setup(null);
    await expect(
      controller.issue('Bearer token', { mode: 'test' }),
    ).rejects.toThrow(NotFoundException);
    expect(issueKey).not.toHaveBeenCalled();
  });
  it('never self-approves business verification for live keys', async () => {
    const { controller, issueKey } = setup();
    await expect(
      controller.issue('Bearer token', { mode: 'live' }),
    ).rejects.toThrow(ConflictException);
    expect(issueKey).not.toHaveBeenCalled();
  });
  it('permits devnet ATA creation for the stored Merchant wallet', async () => {
    const { controller, provisionOrLink, record } = setup();
    const tx = { insert: jest.fn() };
    provisionOrLink.mockImplementation(
      async (
        _merchantId: string,
        _opts: unknown,
        onProvisioned?: (tx: unknown) => Promise<void>,
      ) => {
        await onProvisioned?.(tx);
        return { address: 'ata', provider: 'direct_usdc', provisioned: true };
      },
    );
    await controller.provision('Bearer token');
    expect(provisionOrLink).toHaveBeenCalledWith(
      'merchant-owned',
      { currency: 'USDC', merchantAddress: 'owner-wallet' },
      expect.any(Function),
    );
    // The audit entry is written through the transaction handle the callback
    // receives, so it commits with the destination row.
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'destination.provision' }),
      tx,
    );
  });
  it('blocks unverified mainnet provisioning', async () => {
    const { controller, provisionOrLink } = setup(undefined, 'mainnet');
    await expect(controller.provision('Bearer token')).rejects.toThrow(
      ConflictException,
    );
    expect(provisionOrLink).not.toHaveBeenCalled();
  });
});

describe('execution key gates', () => {
  it('issues enabled devnet keys after verifying the destination', async () => {
    const { controller, issueKey, getSettlementAddressForSettlement } = setup(
      undefined,
      'devnet',
      true,
    );
    await controller.issue('Bearer token', { mode: 'devnet' });
    expect(getSettlementAddressForSettlement).toHaveBeenCalledWith(
      'merchant-owned',
    );
    expect(issueKey).toHaveBeenCalledWith(
      'merchant-owned',
      'devnet',
      { name: undefined },
      expect.anything(),
    );
  });
  it('refuses disabled devnet execution', async () => {
    const { controller, issueKey } = setup();
    await expect(
      controller.issue('Bearer token', { mode: 'devnet' }),
    ).rejects.toThrow(ConflictException);
    expect(issueKey).not.toHaveBeenCalled();
  });
  it('maps missing destination ownership to 409', async () => {
    const { controller, issueKey, getSettlementAddressForSettlement } = setup(
      undefined,
      'devnet',
      true,
    );
    getSettlementAddressForSettlement.mockRejectedValue(
      new SettlementAccountNotProvisionedError('pending'),
    );
    await expect(
      controller.issue('Bearer token', { mode: 'devnet' }),
    ).rejects.toThrow(ConflictException);
    expect(issueKey).not.toHaveBeenCalled();
  });
});

describe('Merchant identity error mapping', () => {
  it.each([
    [new PrivyUnavailableError('provider down'), 502],
    [new PrivyUserShapeError('missing wallet'), 422],
    [new ServiceUnavailableException('not configured'), 503],
  ])('preserves provider failure %s as HTTP %s', async (error, status) => {
    const { controller, verifyIdToken, select } = setup();
    verifyIdToken.mockRejectedValue(error);
    await expect(
      controller.issue('Bearer token', { mode: 'test' }),
    ).rejects.toMatchObject({ status });
    expect(select).not.toHaveBeenCalled();
  });
});

describe('Merchant portal cluster scope', () => {
  it('loads the destination and Payments only for the active cluster', async () => {
    const captured: { destination?: SQL; payments?: SQL } = {};
    const merchant = {
      id: 'merchant-owned',
      ownerProviderId: 'verified-owner',
      name: 'Store',
      displayName: 'Store',
      status: 'active',
      receivingWallet: 'owner-wallet',
      allowedOrigins: null,
      kybStatus: 'pending',
      kybVerifiedAt: null,
      kybSubmittedAt: null,
      kybReviewNote: null,
      settlementTermsAcceptedAt: null,
      flatFeeBps: 0,
      fxSpreadBps: 0,
      profileVersion: 0,
      businessProfile: {},
      createdAt: new Date('2026-01-01'),
    };
    const client = {
      select: jest.fn().mockReturnValue({
        from: (table: unknown) => ({
          where: (condition: SQL) => {
            if (table === merchants) {
              return { limit: () => Promise.resolve([merchant]) };
            }
            if (table === settlementAccounts) {
              captured.destination = condition;
              return { limit: () => Promise.resolve([]) };
            }
            if (table === apiKeys)
              return { orderBy: () => Promise.resolve([]) };
            captured.payments = condition;
            expect(table).toBe(paymentIntents);
            return {
              orderBy: () => ({ limit: () => Promise.resolve([]) }),
            };
          },
        }),
      }),
    };
    const config = {
      get: (key: string) =>
        ({ SOLANA_CLUSTER: 'devnet', DEVNET_PAYMENTS_ENABLED: true })[key],
      getOrThrow: () => 'devnet',
    } as unknown as ConfigService;
    const db = { client } as unknown as DbService;
    const owner = new MerchantOwnerService(db, {
      verifyIdToken: jest.fn().mockResolvedValue({
        providerUserId: 'verified-owner',
        walletAddress: 'owner-wallet',
      }),
    } as unknown as MerchantIdentityService);
    const controller = new MerchantPortalController(
      db,
      owner,
      {} as KeyIssuanceService,
      {} as SettlementProvisioningService,
      config,
      {
        record: jest.fn().mockResolvedValue(undefined),
      } as unknown as MerchantAuditService,
    );

    await controller.me('Bearer token');

    for (const condition of [captured.destination, captured.payments]) {
      const query = new PgDialect().sqlToQuery(condition as SQL);
      expect(query.params).toEqual(
        expect.arrayContaining(['merchant-owned', 'devnet']),
      );
    }
  });
});

describe('Merchant portal key rotation', () => {
  it('maps a missing key to 404', async () => {
    const { controller, rotateKey } = setup();
    rotateKey.mockRejectedValue(new ApiKeyNotFoundError('gone'));
    await expect(controller.rotate('Bearer token', 'ak-x')).rejects.toThrow(
      NotFoundException,
    );
  });
  it('maps a rotation eligibility failure to a 409 conflict', async () => {
    const { controller, rotateKey } = setup();
    rotateKey.mockRejectedValue(new KybNotVerifiedError('kyb regressed'));
    await expect(controller.rotate('Bearer token', 'ak-x')).rejects.toThrow(
      ConflictException,
    );
  });
});
