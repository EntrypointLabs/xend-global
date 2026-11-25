import { parseKaminoRate, parseJupiterRate } from './earn-rate';
import { EARN_PROVIDERS, EARN_USDC } from '@prydd/smart-account';
const row = {
  reserve: EARN_PROVIDERS.kamino.reserve,
  liquidityTokenMint: EARN_USDC.toBase58(),
  supplyApy: '0.04',
};
describe('Kamino rate selection', () => {
  it('uses the pinned active reserve rather than another USDC strategy', () => {
    expect(
      parseKaminoRate([
        { ...row, reserve: 'another reserve', supplyApy: '0.99' },
        row,
      ]),
    ).toBe(0.04);
  });
  it.each([
    [],
    [row, row],
    [{ ...row, liquidityTokenMint: 'a different mint' }],
    [{ ...row, supplyApy: '' }],
    [{ ...row, supplyApy: 'Infinity' }],
    [{ ...row, supplyApy: -1 }],
  ])('rejects missing, ambiguous and invalid rates', (...rows: unknown[]) => {
    expect(() => parseKaminoRate(rows)).toThrow();
  });
});

describe('Jupiter SDK APY units', () => {
  it('does not compound an already annualized supply APY', () => {
    expect(parseJupiterRate('400')).toBe(0.04);
    expect(parseJupiterRate('0')).toBe(0);
    expect(() => parseJupiterRate('Infinity')).toThrow();
    expect(() => parseJupiterRate('-1')).toThrow();
  });
});
