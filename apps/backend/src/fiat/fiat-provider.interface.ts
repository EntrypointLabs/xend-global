/** Xend-owned wire/domain vocabulary. Provider payloads never cross this boundary. */
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
  paymentStep: 'manual_transfer' | 'redirect' | 'simulation';
}
export interface FiatInstructions {
  kind: 'simulation' | 'bank_transfer' | 'crypto_transfer' | 'redirect';
  message: string;
  accountNumber?: string;
  bankName?: string;
  accountName?: string;
  expiresAt?: string;
  url?: string;
}
export interface ProviderFiatOrder {
  reference: string;
  status: FiatStatus;
  instructions: FiatInstructions;
}
export interface FiatProvider {
  readonly name: string;
  routes(): Promise<FiatRoute[]>;
  quote(route: FiatRoute, amountMinor: string): Promise<ProviderFiatQuote>;
  createOrder(input: {
    idempotencyKey: string;
    route: FiatRoute;
    quote: ProviderFiatQuote;
    fields: Record<string, string>;
    /** Server-resolved Squads vault, never a caller-supplied destination. */
    destinationAddress: string;
  }): Promise<ProviderFiatOrder>;
  getOrder(reference: string): Promise<ProviderFiatOrder>;
}
