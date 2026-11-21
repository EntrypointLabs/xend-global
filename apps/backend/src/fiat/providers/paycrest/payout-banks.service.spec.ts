import { PayoutBanksService } from './payout-banks.service';
import type { PaycrestClient } from './paycrest.client';
import { nubanCheckDigit } from '../../banking/nuban';
import { payoutNarration } from './paycrest-fiat.provider';

describe('PayoutBanksService.list', () => {
  it('sorts by name and names the bundled logo for banks that have one', async () => {
    const paycrest = {
      institutions: jest.fn().mockResolvedValue([
        { code: 'ZEIBNGLA', name: 'Zenith Bank' },
        { code: 'NEWBNGLA', name: 'A New Bank' },
        { code: 'GTBINGLA', name: 'Guaranty Trust Bank' },
      ]),
    } as unknown as PaycrestClient;

    const { banks } = await new PayoutBanksService(paycrest).list();

    expect(banks).toEqual([
      { code: 'NEWBNGLA', name: 'A New Bank', logoKey: null },
      { code: 'GTBINGLA', name: 'Guaranty Trust Bank', logoKey: 'gtbank' },
      { code: 'ZEIBNGLA', name: 'Zenith Bank', logoKey: 'zenith-bank' },
    ]);
  });
});

describe('PayoutBanksService.candidates', () => {
  it('offers the Paycrest banks whose NUBAN check digit fits the number', async () => {
    const serial = '012345678';
    const gtbank = `${serial}${nubanCheckDigit('000058', serial)}`;
    const paycrest = {
      institutions: jest.fn().mockResolvedValue([
        { code: 'GTBINGLA', name: 'Guaranty Trust Bank' },
        { code: 'ZZZZNGLA', name: 'Unlisted Bank' },
      ]),
    } as unknown as PaycrestClient;

    const { banks } = await new PayoutBanksService(paycrest).candidates(gtbank);

    expect(banks.map((bank) => bank.code)).toContain('GTBINGLA');
    expect(banks.map((bank) => bank.code)).not.toContain('ZZZZNGLA');
  });
});

describe('payoutNarration', () => {
  it('keeps a plain note and trims it to bank length', () => {
    expect(payoutNarration('  Rent for   May 🏠 ')).toBe('Rent for May');
    expect(payoutNarration('x'.repeat(80))).toHaveLength(60);
  });

  it('falls back when the sender left no note', () => {
    expect(payoutNarration(undefined)).toBe('Prydd transfer');
    expect(payoutNarration('🎉')).toBe('Prydd transfer');
  });
});
