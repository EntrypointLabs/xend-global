export interface ObservedHolding {
  currency: 'NGN' | 'USDC';
  decimals: 2 | 6;
  /** Available means the observation is available, not a spendable reservation. */
  status: 'available' | 'unavailable';
  amountMinor: string | null;
  observedAt: string | null;
  reason: string | null;
}

export interface ObservedBalances {
  mode: 'observed';
  bankEnvironment: 'sandbox';
  network: 'devnet' | 'mainnet' | null;
  holdings: ObservedHolding[];
  total: {
    currency: 'USD';
    amountMinor: string;
    estimate: true;
    asOf: string;
  } | null;
  valuationReason: string | null;
}
