import {
  fundingRequirement,
  planFunding,
  planSendAll,
  valueHoldings,
  type Holdings,
  type ConversionQuote,
} from './funding-planner';
const now = Date.parse('2026-09-09T00:00:00Z');
const holdings: Holdings = {
  NGN: { settledMinor: '50000000', reservedMinor: '0' },
  USDC: { settledMinor: '100000000', reservedMinor: '0' },
};
const quote: ConversionQuote = {
  reference: 'quote-1',
  sourceCurrency: 'USDC',
  destinationCurrency: 'NGN',
  sourceDebitMinor: '60000000',
  destinationCreditMinor: '10000000',
  expiresAt: '2026-09-09T00:10:00Z',
};
describe('destination-currency-first funding', () => {
  it('does not call a zero-output conversion send-all', () => {
    expect(() =>
      planSendAll(
        holdings,
        'NGN',
        '0',
        {
          ...quote,
          sourceDebitMinor: '100000000',
          destinationCreditMinor: '0',
        },
        now,
      ),
    ).toThrow('INVALID_QUOTE');
  });
  it('sends 400000 NGN without conversion', () =>
    expect(
      planFunding(holdings, 'NGN', '40000000', '0', null, now).reservations,
    ).toEqual({ NGN: '40000000', USDC: '0' }));
  it('funds 600000 NGN using 500000 NGN and only the quoted USDC shortfall', () => {
    const result = planFunding(holdings, 'NGN', '60000000', '0', quote, now);
    expect(result.shortfallMinor).toBe('10000000');
    expect(result.reservations).toEqual({ NGN: '50000000', USDC: '60000000' });
  });
  it('sends 80 USDC directly', () =>
    expect(
      planFunding(holdings, 'USDC', '80000000', '0', null, now).conversion,
    ).toBeNull());
  it('funds 150 USDC by converting only the additional 50', () => {
    const q = {
      ...quote,
      sourceCurrency: 'NGN' as const,
      destinationCurrency: 'USDC' as const,
      sourceDebitMinor: '8333334',
      destinationCreditMinor: '50000000',
    };
    expect(
      planFunding(holdings, 'USDC', '150000000', '0', q, now).reservations,
    ).toEqual({ NGN: '8333334', USDC: '100000000' });
  });
  it('includes payout fees in the required shortfall', () =>
    expect(
      fundingRequirement(holdings, 'NGN', '50000000', '5000').shortfallMinor,
    ).toBe('5000'));
  it('does not spend another operation’s reservation', () => {
    const reserved = {
      ...holdings,
      NGN: { ...holdings.NGN, reservedMinor: '10000000' },
    };
    expect(
      fundingRequirement(reserved, 'NGN', '50000000', '0').shortfallMinor,
    ).toBe('10000000');
  });
  it.each([
    ['QUOTE_EXPIRED', { ...quote, expiresAt: new Date(now).toISOString() }],
    ['QUOTE_UNDERFUNDS_SEND', { ...quote, destinationCreditMinor: '1' }],
    ['INSUFFICIENT_FUNDS', { ...quote, sourceDebitMinor: '100000001' }],
    ['QUOTE_ROUTE_MISMATCH', { ...quote, sourceCurrency: 'NGN' as const }],
  ])('rejects %s', (error, q) =>
    expect(() => planFunding(holdings, 'NGN', '60000000', '0', q, now)).toThrow(
      error,
    ),
  );
  it('keeps conversion surplus attributable to the consumer', () =>
    expect(
      planFunding(
        holdings,
        'NGN',
        '60000000',
        '0',
        { ...quote, destinationCreditMinor: '10000001' },
        now,
      ).surplusDestinationMinor,
    ).toBe('1'));
  it('send-all quotes the actual source holdings and subtracts fees', () => {
    const q = {
      ...quote,
      sourceCurrency: 'NGN' as const,
      destinationCurrency: 'USDC' as const,
      sourceDebitMinor: '50000000',
      destinationCreditMinor: '300000000',
    };
    const result = planSendAll(holdings, 'USDC', '1000000', q, now);
    expect(result.recipientMinor).toBe('399000000');
    expect(result.reservations).toEqual({ NGN: '50000000', USDC: '100000000' });
    expect(() =>
      planSendAll(holdings, 'USDC', '0', { ...q, sourceDebitMinor: '1' }, now),
    ).toThrow('SEND_ALL_QUOTE_MISMATCH');
  });
  it('shows 400 USD for 100 USDC plus 500000 NGN valued at 300 USD', () => {
    const rate = {
      ngnNumerator: '1',
      usdcDenominator: '6',
      asOf: new Date(now).toISOString(),
      expiresAt: quote.expiresAt,
    };
    expect(valueHoldings(holdings, 'USD', rate, now).totalMinor).toBe('40000');
    const reserved = {
      ...holdings,
      USDC: { ...holdings.USDC, reservedMinor: '100000000' },
    };
    expect(valueHoldings(reserved, 'USD', rate, now).availableMinor).toBe(
      '30000',
    );
  });
  it('rejects stale display rates and malformed monetary values', () => {
    expect(() =>
      valueHoldings(
        holdings,
        'USD',
        {
          ngnNumerator: '1',
          usdcDenominator: '6',
          asOf: new Date(now).toISOString(),
          expiresAt: new Date(now).toISOString(),
        },
        now,
      ),
    ).toThrow('INVALID_VALUATION_RATE');
    expect(() => fundingRequirement(holdings, 'NGN', '1.1', '0')).toThrow(
      'INVALID_MONEY',
    );
  });
});
