/** Exact accounting amounts. Callers supply reconciled balances, never UI totals. */
export type FundingCurrency = 'NGN' | 'USDC';
export type Holdings = Record<
  FundingCurrency,
  { settledMinor: string; reservedMinor: string }
>;
export interface FundingRequirement {
  destinationCurrency: FundingCurrency;
  recipientMinor: string;
  payoutFeeMinor: string;
  directMinor: string;
  shortfallMinor: string;
  conversionSource: FundingCurrency;
  availableConversionSourceMinor: string;
}
export interface ConversionQuote {
  reference: string;
  sourceCurrency: FundingCurrency;
  destinationCurrency: FundingCurrency;
  /** Total source debit inclusive of conversion fees; never add fees twice. */
  sourceDebitMinor: string;
  destinationCreditMinor: string;
  expiresAt: string;
}
export interface FundingPlan extends FundingRequirement {
  reservations: Record<FundingCurrency, string>;
  conversion: ConversionQuote | null;
  surplusDestinationMinor: string;
}
function units(value: string): bigint {
  if (!/^(0|[1-9]\d{0,29})$/.test(value)) throw new Error('INVALID_MONEY');
  return BigInt(value);
}
function other(currency: FundingCurrency): FundingCurrency {
  if (currency !== 'NGN' && currency !== 'USDC')
    throw new Error('INVALID_CURRENCY');
  return currency === 'NGN' ? 'USDC' : 'NGN';
}
export function available(
  holdings: Holdings,
  currency: FundingCurrency,
): bigint {
  const balance = units(holdings[currency].settledMinor);
  const reserved = units(holdings[currency].reservedMinor);
  if (reserved > balance) throw new Error('INVALID_RESERVATION');
  return balance - reserved;
}
/** Phase one: determine exact destination shortfall before requesting an executable quote. */
export function fundingRequirement(
  holdings: Holdings,
  destinationCurrency: FundingCurrency,
  recipientMinor: string,
  payoutFeeMinor: string,
): FundingRequirement {
  const conversionSource = other(destinationCurrency);
  const recipient = units(recipientMinor);
  if (recipient === 0n) throw new Error('ZERO_SEND');
  const needed = recipient + units(payoutFeeMinor);
  const balance = available(holdings, destinationCurrency);
  const direct = balance < needed ? balance : needed;
  return {
    destinationCurrency,
    recipientMinor,
    payoutFeeMinor,
    directMinor: direct.toString(),
    shortfallMinor: (needed - direct).toString(),
    conversionSource,
    availableConversionSourceMinor: available(
      holdings,
      conversionSource,
    ).toString(),
  };
}
/** Recalculate from current holdings immediately before atomically reserving the plan. */
export function planFunding(
  holdings: Holdings,
  destinationCurrency: FundingCurrency,
  recipientMinor: string,
  payoutFeeMinor: string,
  quote: ConversionQuote | null,
  now = Date.now(),
): FundingPlan {
  const requirement = fundingRequirement(
    holdings,
    destinationCurrency,
    recipientMinor,
    payoutFeeMinor,
  );
  const reservations = { NGN: '0', USDC: '0' };
  reservations[destinationCurrency] = requirement.directMinor;
  if (requirement.shortfallMinor === '0') {
    return {
      ...requirement,
      reservations,
      conversion: null,
      surplusDestinationMinor: '0',
    };
  }
  if (!quote) throw new Error('CONVERSION_QUOTE_REQUIRED');
  if (
    !quote.reference ||
    quote.sourceCurrency !== requirement.conversionSource ||
    quote.destinationCurrency !== destinationCurrency
  ) {
    throw new Error('QUOTE_ROUTE_MISMATCH');
  }
  const expiry = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now)
    throw new Error('QUOTE_EXPIRED');
  const debit = units(quote.sourceDebitMinor);
  const credit = units(quote.destinationCreditMinor);
  if (debit === 0n) throw new Error('INVALID_QUOTE');
  if (debit > BigInt(requirement.availableConversionSourceMinor))
    throw new Error('INSUFFICIENT_FUNDS');
  if (credit < BigInt(requirement.shortfallMinor))
    throw new Error('QUOTE_UNDERFUNDS_SEND');
  reservations[requirement.conversionSource] = debit.toString();
  return {
    ...requirement,
    reservations,
    conversion: { ...quote },
    surplusDestinationMinor: (
      credit - BigInt(requirement.shortfallMinor)
    ).toString(),
  };
}
/** Send-all uses a source-exact quote for all available non-destination holdings. */
export function planSendAll(
  holdings: Holdings,
  destinationCurrency: FundingCurrency,
  payoutFeeMinor: string,
  quote: ConversionQuote | null,
  now = Date.now(),
): FundingPlan {
  const source = other(destinationCurrency);
  const sourceAmount = available(holdings, source);
  let converted = 0n;
  if (sourceAmount > 0n) {
    if (!quote) throw new Error('CONVERSION_QUOTE_REQUIRED');
    if (units(quote.sourceDebitMinor) !== sourceAmount)
      throw new Error('SEND_ALL_QUOTE_MISMATCH');
    converted = units(quote.destinationCreditMinor);
    if (converted === 0n) throw new Error('INVALID_QUOTE');
  }
  const gross = available(holdings, destinationCurrency) + converted;
  const fee = units(payoutFeeMinor);
  if (gross <= fee) throw new Error('INSUFFICIENT_FUNDS');
  return planFunding(
    holdings,
    destinationCurrency,
    (gross - fee).toString(),
    payoutFeeMinor,
    sourceAmount > 0n ? quote : null,
    now,
  );
}
export interface ValuationRate {
  /** NGN minor units per USDC minor unit as a rational, e.g. 1/6 at NGN 500000 per 300 USDC. */
  ngnNumerator: string;
  usdcDenominator: string;
  asOf: string;
  expiresAt: string;
}
/** Display-only estimates, separate from quotes and execution. USD is valued at USDC parity here. */
export function valueHoldings(
  holdings: Holdings,
  displayCurrency: 'NGN' | 'USD',
  rate: ValuationRate,
  now = Date.now(),
) {
  if (displayCurrency !== 'NGN' && displayCurrency !== 'USD')
    throw new Error('INVALID_CURRENCY');
  const numerator = units(rate.ngnNumerator);
  const denominator = units(rate.usdcDenominator);
  const asOf = Date.parse(rate.asOf);
  const expiresAt = Date.parse(rate.expiresAt);
  if (
    numerator === 0n ||
    denominator === 0n ||
    !Number.isFinite(asOf) ||
    asOf > now ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now
  )
    throw new Error('INVALID_VALUATION_RATE');
  const ngnAvailable = available(holdings, 'NGN');
  const usdcAvailable = available(holdings, 'USDC');
  const value = (ngn: bigint, usdc: bigint) =>
    displayCurrency === 'NGN'
      ? ngn + (usdc * numerator) / denominator
      : (usdc + (ngn * denominator) / numerator) / 10000n;
  return {
    currency: displayCurrency,
    decimals: 2,
    totalMinor: value(
      units(holdings.NGN.settledMinor),
      units(holdings.USDC.settledMinor),
    ).toString(),
    availableMinor: value(ngnAvailable, usdcAvailable).toString(),
    asOf: rate.asOf,
    estimate: true as const,
  };
}
