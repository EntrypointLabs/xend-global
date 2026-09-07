import { localMinorToUsdcRaw, usdcRawToUsdMinor } from './fx-math';

describe('localMinorToUsdcRaw', () => {
  it('converts NGN165342.00 at 1653.42 -> 100000000 (100 USDC)', () => {
    // 16534200 kobo / 1653.42 = 10000.00 USDC -> 100000000 raw (6dp).
    expect(localMinorToUsdcRaw('16534200', '1653.42', 6, 'NGN')).toBe(
      '100000000',
    );
  });

  it('rounds half-up at the boundary', () => {
    // 1 kobo at rate 2 NGN/USDC: 0.01/2 = 0.005 USDC = 5000 raw exactly.
    expect(localMinorToUsdcRaw('1', '2', 6, 'NGN')).toBe('5000');
    // A value that lands exactly on .5 raw rounds up.
    // 3 kobo at rate 2: 0.03/2 = 0.015 USDC = 15000 raw.
    expect(localMinorToUsdcRaw('3', '2', 6, 'NGN')).toBe('15000');
  });

  it('handles an integer rate with no fractional part', () => {
    // 160000 kobo (1600 NGN) at 1600 NGN/USDC = 1 USDC = 1000000 raw.
    expect(localMinorToUsdcRaw('160000', '1600', 6, 'NGN')).toBe('1000000');
  });

  it('throws when the rate has more decimals than rateDecimals allows', () => {
    expect(() => localMinorToUsdcRaw('100', '1600.1234567', 6, 'NGN')).toThrow(
      /rate precision/,
    );
  });

  it('throws on a non-digit NGN minor amount', () => {
    expect(() => localMinorToUsdcRaw('12.5', '1600', 6, 'NGN')).toThrow(
      /display minor/,
    );
    expect(() => localMinorToUsdcRaw('abc', '1600', 6, 'NGN')).toThrow(
      /display minor/,
    );
  });

  it('throws on a malformed or zero rate', () => {
    expect(() => localMinorToUsdcRaw('100', 'x', 6, 'NGN')).toThrow(/rate/);
    expect(() => localMinorToUsdcRaw('100', '0', 6, 'NGN')).toThrow(
      /rate <= 0/,
    );
    expect(() => localMinorToUsdcRaw('100', '0.000000', 6, 'NGN')).toThrow(
      /rate <= 0/,
    );
  });
});

describe('usdcRawToUsdMinor', () => {
  it('drops the four decimals a shopper never sees', () => {
    // 12.34 USDC settles as 12340000 raw and is shown as 1234 cents.
    expect(usdcRawToUsdMinor('12340000')).toBe('1234');
  });

  it('rounds half-up rather than truncating a fraction of a cent away', () => {
    expect(usdcRawToUsdMinor('12345000')).toBe('1235');
    expect(usdcRawToUsdMinor('12344999')).toBe('1234');
  });

  it('refuses anything that is not a raw integer amount', () => {
    expect(() => usdcRawToUsdMinor('12.5')).toThrow(/usdc raw/);
  });
});
