import {
  candidateBankCodes,
  isNubanValid,
  nubanCheckDigit,
  nubanIdentifier,
} from './nuban';

describe('NUBAN check digit', () => {
  it('matches the worked example in the CBN NUBAN standard', () => {
    expect(nubanCheckDigit('000011', '000001457')).toBe(9);
    expect(isNubanValid('011', '0000014579')).toBe(true);
  });

  it('rejects every other check digit for the same serial', () => {
    for (const digit of '012345678')
      expect(isNubanValid('011', `000001457${digit}`)).toBe(false);
  });

  it('maps a sum that is already a multiple of ten to zero', () => {
    // 000044 weights 3,7,3 on "044" → 0+28+12 = 40, serial of zeros adds 0.
    expect(nubanCheckDigit('000044', '000000000')).toBe(0);
    expect(isNubanValid('044', '0000000000')).toBe(true);
  });

  it('accepts a real Access Bank account under its 3-digit code', () => {
    expect(nubanCheckDigit('000044', '123145954')).toBe(4);
    expect(isNubanValid('044', '1231459544')).toBe(true);
  });

  it('accepts a real Nombank account under its NIP code', () => {
    expect(isNubanValid('090645', '7784374958')).toBe(true);
  });

  it('builds identifiers only for the supported code formats', () => {
    expect(nubanIdentifier('058')).toBe('000058');
    expect(nubanIdentifier('50211')).toBe('950211');
    expect(nubanIdentifier('090267')).toBe('090267');
    expect(nubanIdentifier('7a1')).toBeNull();
    expect(nubanIdentifier('1234567')).toBeNull();
    expect(nubanIdentifier('9f1c2e0a-uuid')).toBeNull();
    expect(isNubanValid('abc', '0000014579')).toBe(false);
    expect(isNubanValid('011', '000001457')).toBe(false);
  });
});

describe('candidate banks', () => {
  it('suggests popular banks whose check digit passes, most used first', () => {
    expect(candidateBankCodes('7784374958')).toEqual(['305', '090645']);
    expect(candidateBankCodes('0000014579')).toContain('011');
    expect(candidateBankCodes('1231459544')).toContain('044');
  });

  it('adds phone-number wallets when the number looks like a phone number', () => {
    const codes = candidateBankCodes('8031234567');
    expect(codes.slice(0, 3)).toEqual(['305', '090405', '100033']);
  });

  it('returns nothing for malformed numbers', () => {
    expect(candidateBankCodes('12345')).toEqual([]);
  });
});
