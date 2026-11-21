/** Prydd-owned wire/domain vocabulary. Provider payloads never cross this boundary. */
export const FIAT_PROVIDERS = Symbol('FIAT_PROVIDERS');
export type FiatDirection = 'receive' | 'send';
export type FiatStatus =
  | 'creating'
  | 'awaiting_payment'
  | 'processing'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'needs_attention'
  | 'return_pending'
  | 'returned';
export interface FiatRoute {
  id: string;
  provider: string;
  direction: FiatDirection;
  environment: 'simulation' | 'sandbox' | 'production';
  sourceCurrency: 'NGN' | 'USDC';
  destinationCurrency: 'NGN' | 'USDC';
  network: 'solana';
  quoteAvailable: boolean;
  orderAvailable: boolean;
  accountKinds: ('temporary' | 'permanent')[];
  holdsFiat: boolean;
  thirdPartyPayments: 'supported' | 'unsupported' | 'unknown';
}
export interface FiatField {
  key: string;
  label: string;
  type: 'text' | 'select';
  required: boolean;
  options?: { value: string; label: string }[];
}
export interface FiatMoney {
  currency: 'NGN' | 'USDC';
  amountMinor: string;
  decimals: 2 | 6;
}
export interface ProviderFiatQuote {
  reference: string;
  expiresAt: string;
  debit: FiatMoney;
  credit: FiatMoney;
  fees: FiatMoney[];
  fields: FiatField[];
  /** account_transfer: the Consumer's Account sends USDC to the order's deposit address. */
  paymentStep:
    | 'manual_transfer'
    | 'account_transfer'
    | 'redirect'
    | 'simulation';
}
export interface FiatInstructions {
  kind: 'simulation' | 'bank_transfer' | 'crypto_transfer' | 'redirect';
  message: string;
  accountNumber?: string;
  bankName?: string;
  accountName?: string;
  /** The exact naira the sender's bank must transfer, for bank_transfer. */
  transferAmount?: FiatMoney;
  /** Where the Account sends USDC for crypto_transfer, valid for this order only. */
  depositAddress?: string;
  depositAmount?: FiatMoney;
  /** Resolved payout beneficiary, for a send. */
  payoutAccountName?: string;
  expiresAt?: string;
  url?: string;
}
export interface ProviderFiatOrder {
  reference: string;
  status: FiatStatus;
  instructions: FiatInstructions;
}
/** A provider's current word on an order. Instructions are kept from creation. */
export interface ProviderFiatOrderStatus {
  reference: string;
  status: FiatStatus;
  /** On-chain signature of the USDC leg, when the provider reports one. */
  signature?: string;
}
/**
 * `debit` fixes what leaves the Consumer; `credit` fixes what the recipient
 * gets, which is how a naira bank send is usually asked for.
 */
export type FiatQuoteSide = 'debit' | 'credit';
export interface FiatProvider {
  readonly name: string;
  routes(): Promise<FiatRoute[]>;
  quote(
    route: FiatRoute,
    amountMinor: string,
    side?: FiatQuoteSide,
  ): Promise<ProviderFiatQuote>;
  createOrder(input: {
    idempotencyKey: string;
    route: FiatRoute;
    quote: ProviderFiatQuote;
    fields: Record<string, string>;
    /** Server-resolved Squads vault, never a caller-supplied destination. */
    destinationAddress: string;
    /** The provider's verified-customer id, sent only when the order needs it. */
    customerId?: string;
    webhookUrl?: string;
  }): Promise<ProviderFiatOrder>;
  /** Null when the provider has no record of the reference. */
  getOrder(reference: string): Promise<ProviderFiatOrderStatus | null>;
}
