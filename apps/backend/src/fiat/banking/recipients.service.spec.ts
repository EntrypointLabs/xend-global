import {
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { BankingRegistry } from './banking.registry';
import type { BankPayoutProvider } from './banking-provider.interface';
import { NombaError } from './nomba.adapter';
import { BankRecipientsService } from './recipients.service';

const BANKS = [
  { code: '090645', name: 'Nombank' },
  { code: '044', name: 'Access Bank' },
  { code: ' 090820', name: 'Ukpor  MFB ' },
  { code: '305', name: 'Paycom (Opay)' },
  { code: '058', name: 'GTBank' },
];

function setup(overrides: { banks?: jest.Mock } = {}) {
  const banks = overrides.banks ?? jest.fn().mockResolvedValue(BANKS);
  const resolveRecipient = jest.fn((bankCode: string, accountNumber: string) =>
    Promise.resolve({
      bankCode,
      accountNumber,
      accountName: 'Gift Chukwudi Opia',
    }),
  );
  const provider = {
    name: 'nomba',
    banks,
    resolveRecipient,
    submitPayout: jest.fn(),
    getPayout: jest.fn(),
  } as unknown as BankPayoutProvider;
  const registry = {
    payoutProvider: () => provider,
  } as unknown as BankingRegistry;
  return {
    banks,
    resolveRecipient,
    service: new BankRecipientsService(registry),
  };
}

afterEach(() => jest.restoreAllMocks());

describe('BankRecipientsService', () => {
  it('lists banks sorted by name with tidy codes and names, fetched once', async () => {
    const { banks, service } = setup();
    const listed = await service.banks();
    await service.banks();
    expect(listed.map((bank) => bank.name)).toEqual([
      'Access Bank',
      'GTBank',
      'Nombank',
      'Paycom (Opay)',
      'Ukpor MFB',
    ]);
    expect(listed.find((bank) => bank.name === 'Ukpor MFB')?.code).toBe(
      '090820',
    );
    expect(banks).toHaveBeenCalledTimes(1);
  });

  it('refetches after the cache expires and keeps the old list if that fails', async () => {
    const { banks, service } = setup();
    const start = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(start);
    await service.banks();
    jest.spyOn(Date, 'now').mockReturnValue(start + 7 * 60 * 60 * 1000);
    banks.mockRejectedValueOnce(new NombaError('NOMBA_UNAVAILABLE'));
    await expect(service.banks()).resolves.toHaveLength(5);
    expect(banks).toHaveBeenCalledTimes(2);
  });

  it('reports an outage when the bank list cannot be loaded at all', async () => {
    const { service } = setup({
      banks: jest.fn().mockRejectedValue(new NombaError('NOMBA_UNAVAILABLE')),
    });
    await expect(service.banks()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('suggests only listed banks whose check digit fits the number', async () => {
    const { service } = setup();
    await expect(service.candidates('7784374958')).resolves.toEqual([
      { code: '305', name: 'Paycom (Opay)' },
      { code: '090645', name: 'Nombank' },
    ]);
    await expect(service.candidates('1231459544')).resolves.toContainEqual({
      code: '044',
      name: 'Access Bank',
    });
  });

  it('returns the holder name the bank confirmed, with the bank name', async () => {
    const { resolveRecipient, service } = setup();
    await expect(
      service.resolve('user-1', {
        accountNumber: '1231459544',
        bankCode: '044',
      }),
    ).resolves.toEqual({
      accountNumber: '1231459544',
      bankCode: '044',
      bankName: 'Access Bank',
      accountName: 'Gift Chukwudi Opia',
    });
    expect(resolveRecipient).toHaveBeenCalledWith('044', '1231459544');
  });

  it('rejects banks that are not in the list without asking the bank', async () => {
    const { resolveRecipient, service } = setup();
    await expect(
      service.resolve('user-1', {
        accountNumber: '1231459544',
        bankCode: '999',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(resolveRecipient).not.toHaveBeenCalled();
  });

  it('tells a missing account apart from an outage', async () => {
    const { resolveRecipient, service } = setup();
    const input = { accountNumber: '1231459544', bankCode: '044' };
    resolveRecipient.mockRejectedValueOnce(
      new NombaError('NOMBA_REQUEST_REJECTED'),
    );
    await expect(service.resolve('user-1', input)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    resolveRecipient.mockRejectedValueOnce(
      new NombaError('NOMBA_SUBMISSION_UNCERTAIN'),
    );
    await expect(service.resolve('user-1', input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    resolveRecipient.mockResolvedValueOnce({
      bankCode: '044',
      accountNumber: '1231459544',
      accountName: '   ',
    });
    await expect(service.resolve('user-1', input)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('limits how many accounts one user can check in a window', async () => {
    const { service } = setup();
    const input = { accountNumber: '1231459544', bankCode: '044' };
    for (let i = 0; i < 30; i += 1) await service.resolve('user-1', input);
    const blocked = service.resolve('user-1', input);
    await expect(blocked).rejects.toBeInstanceOf(HttpException);
    await expect(blocked).rejects.toMatchObject({ status: 429 });
    await expect(service.resolve('user-2', input)).resolves.toBeDefined();
  });

  it('reports an outage when no authenticated provider is configured', async () => {
    const service = new BankRecipientsService({
      payoutProvider: () => null,
    } as unknown as BankingRegistry);
    await expect(service.banks()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
