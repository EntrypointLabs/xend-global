import type { ConfigService } from '@nestjs/config';
import {
  BankAccountUnconfirmedError,
  type PajSettlementProvider,
} from '../settlement/providers/paj/paj-settlement.provider';
import type { SettlementProvisioningService } from '../settlement/settlement-provisioning.service';
import type { MerchantAuditService } from './merchant-audit.service';
import type { MerchantOwnerService } from './merchant-owner.service';
import { MerchantPortalNairaController } from './merchant-portal-naira.controller';

const CONFIRMED = {
  accountName: 'ADA STORES LTD',
  bankName: 'GTBank',
  accountLast4: '6789',
};
const BODY = {
  bankCode: '058',
  accountNumber: '0123456789',
  confirmedAccountName: 'ADA STORES LTD',
};

function setup(
  opts: {
    enabled?: boolean;
    cluster?: string;
    kybStatus?: string;
    confirm?: jest.Mock;
    provisionedProvider?: string;
  } = {},
) {
  const owned = jest.fn().mockResolvedValue({
    id: 'm_1',
    kybStatus: opts.kybStatus ?? 'verified',
    ownerProviderId: 'did:privy:owner',
  });
  const confirmBankAccount =
    opts.confirm ?? jest.fn().mockResolvedValue(CONFIRMED);
  const listBanks = jest
    .fn()
    .mockResolvedValue([{ code: '058', name: 'GTBank' }]);
  const provisionOrLink = jest.fn().mockResolvedValue({
    address: 'TokenAccount',
    provider: opts.provisionedProvider ?? 'paj',
    provisioned: true,
  });
  const controller = new MerchantPortalNairaController(
    { owned } as unknown as MerchantOwnerService,
    {
      enabled: opts.enabled ?? true,
      capabilities: { provider: 'paj' },
      listBanks,
      confirmBankAccount,
    } as unknown as PajSettlementProvider,
    { provisionOrLink } as unknown as SettlementProvisioningService,
    { get: () => opts.cluster ?? 'mainnet-beta' } as unknown as ConfigService,
    { record: jest.fn() } as unknown as MerchantAuditService,
  );
  return { controller, owned, confirmBankAccount, listBanks, provisionOrLink };
}

describe('MerchantPortalNairaController', () => {
  it('lists banks for a signed-in owner', async () => {
    const { controller, owned } = setup();

    await expect(controller.banks('Bearer t')).resolves.toEqual({
      banks: [{ code: '058', name: 'GTBank' }],
    });
    expect(owned).toHaveBeenCalledWith('Bearer t');
  });

  it('is absent while naira settlement is switched off', async () => {
    const { controller, listBanks } = setup({ enabled: false });

    await expect(controller.banks('Bearer t')).rejects.toThrow('not available');
    expect(listBanks).not.toHaveBeenCalled();
  });

  it('returns the account holder name for the owner to confirm', async () => {
    const { controller } = setup();

    await expect(controller.account('Bearer t', BODY)).resolves.toEqual(
      CONFIRMED,
    );
  });

  it('explains an account the bank could not confirm', async () => {
    const { controller } = setup({
      confirm: jest.fn().mockRejectedValue(new BankAccountUnconfirmedError()),
    });

    await expect(controller.account('Bearer t', BODY)).rejects.toThrow(
      'We could not confirm that account',
    );
  });

  it('connects the confirmed bank account as an NGN destination', async () => {
    const { controller, provisionOrLink } = setup();

    await expect(
      controller.destination('Bearer t', BODY),
    ).resolves.toMatchObject({ provider: 'paj', provisioned: true });
    expect(provisionOrLink).toHaveBeenCalledWith(
      'm_1',
      {
        currency: 'NGN',
        bankAccount: { bankCode: '058', accountNumber: '0123456789' },
      },
      expect.any(Function),
    );
  });

  it('refuses when the name at the bank is not the one the owner confirmed', async () => {
    const { controller, provisionOrLink } = setup();

    await expect(
      controller.destination('Bearer t', {
        ...BODY,
        confirmedAccountName: 'SOMEONE ELSE',
      }),
    ).rejects.toThrow('The account name changed');
    expect(provisionOrLink).not.toHaveBeenCalled();
  });

  it('requires business verification outside devnet', async () => {
    const { controller, confirmBankAccount } = setup({ kybStatus: 'pending' });

    await expect(controller.destination('Bearer t', BODY)).rejects.toThrow(
      'Business verification is required',
    );
    expect(confirmBankAccount).not.toHaveBeenCalled();
  });

  it('allows an unverified Merchant on devnet', async () => {
    const { controller } = setup({ kybStatus: 'pending', cluster: 'devnet' });

    await expect(
      controller.destination('Bearer t', BODY),
    ).resolves.toMatchObject({ provider: 'paj' });
  });

  it('tells a Merchant that already settles in USDC', async () => {
    const { controller } = setup({ provisionedProvider: 'direct_usdc' });

    await expect(controller.destination('Bearer t', BODY)).rejects.toThrow(
      'already has a receiving account',
    );
  });
});
