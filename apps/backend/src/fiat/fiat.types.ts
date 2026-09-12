import type {
  FiatInstructions,
  FiatRoute,
  FiatStatus,
  ProviderFiatQuote,
} from './fiat-provider.interface';

export interface FiatQuote extends ProviderFiatQuote {
  id: string;
  route: FiatRoute;
}
export interface FiatOrder {
  id: string;
  route: FiatRoute;
  quote: FiatQuote;
  status: FiatStatus;
  instructions: FiatInstructions;
  createdAt: string;
  updatedAt: string;
  simulation: boolean;
}
export type SimulationEvent =
  | 'payment_received'
  | 'complete'
  | 'fail'
  | 'return'
  | 'expire';
export interface StoredFiatOrder {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  providerReference: string | null;
  order: FiatOrder;
}
