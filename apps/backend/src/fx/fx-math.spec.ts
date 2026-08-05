import { ngnMinorToUsdcRaw } from './fx-math';

describe('ngnMinorToUsdcRaw', () => {
  it('converts NGN165342.00 at 1653.42 -> 100000000 (100 USDC)', () => {
    // 16534200 kobo / 1653.42 = 10000.00 USDC -> 100000000 raw (6dp).
    expect(ngnMinorToUsdcRaw('16534200', '1653.42', 6)).toBe('100000000');
  });

  it('rounds half-up at the boundary', () => {
    // 1 kobo at rate 2 NGN/USDC: 0.01/2 = 0.005 USDC = 5000 raw exactly.
    expect(ngnMinorToUsdcRaw('1', '2', 6)).toBe('5000');
    // A value that lands exactly on .5 raw rounds up.
    // 3 kobo at rate 2: 0.03/2 = 0.015 USDC = 15000 raw.
    expect(ngnMinorToUsdcRaw('3', '2', 6)).toBe('15000');
  });

  it('handles an integer rate with no fractional part', () => {
    // 160000 kobo (1600 NGN) at 1600 NGN/USDC = 1 USDC = 1000000 raw.
    expect(ngnMinorToUsdcRaw('160000', '1600', 6)).toBe('1000000');
  });

  it('throws when the rate has more decimals than rateDecimals allows', () => {
    expect(() => ngnMinorToUsdcRaw('100', '1600.1234567', 6)).toThrow(
      /rate precision/,
    );
  });

  it('throws on a non-digit NGN minor amount', () => {
    expect(() => ngnMinorToUsdcRaw('12.5', '1600', 6)).toThrow(/ngn minor/);
    expect(() => ngnMinorToUsdcRaw('abc', '1600', 6)).toThrow(/ngn minor/);
  });

  it('throws on a malformed or zero rate', () => {
    expect(() => ngnMinorToUsdcRaw('100', 'x', 6)).toThrow(/rate/);
    expect(() => ngnMinorToUsdcRaw('100', '0', 6)).toThrow(/rate <= 0/);
    expect(() => ngnMinorToUsdcRaw('100', '0.000000', 6)).toThrow(/rate <= 0/);
  });
});
