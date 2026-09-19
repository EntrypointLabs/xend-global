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
import { SettlementAccountNotProvisionedError } from '../settlement/settlement.errors';

function setup(
  merchant: Record<string, unknown> | null = {
    id: 'merchant-owned',
    kybStatus: 'pending',
    receivingWallet: 'owner-wallet',
    settlementTermsAcceptedAt: new Date(),
  },
  cluster = 'devnet',
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
  const revokeKey = jest.fn().mockResolvedValue({
    id: 'ak-owned',
    revokedAt: new Date('2026-09-19T00:00:00Z'),
  });
  const controller = new MerchantPortalController(
    { client: { select } } as unknown as DbService,
    { verifyIdToken } as unknown as MerchantIdentityService,
    { issueKey, revokeKey } as unknown as KeyIssuanceService,
    { provisionOrLink } as unknown as SettlementProvisioningService,
    { get: () => cluster } as unknown as ConfigService,
  );
  return {
    controller,
    verifyIdToken,
    issueKey,
    revokeKey,
    provisionOrLink,
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
    expect(revokeKey).toHaveBeenCalledWith('ak-owned');
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
    expect(issueKey).toHaveBeenCalledWith('merchant-owned', 'test');
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
    const { controller, provisionOrLink } = setup();
    await controller.provision('Bearer token');
    expect(provisionOrLink).toHaveBeenCalledWith('merchant-owned', {
      currency: 'USDC',
      merchantAddress: 'owner-wallet',
    });
  });
  it('blocks unverified mainnet provisioning', async () => {
    const { controller, provisionOrLink } = setup(undefined, 'mainnet');
    await expect(controller.provision('Bearer token')).rejects.toThrow(
      ConflictException,
    );
    expect(provisionOrLink).not.toHaveBeenCalled();
  });
});
