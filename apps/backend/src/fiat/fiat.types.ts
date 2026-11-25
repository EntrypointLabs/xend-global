import type { LimitCheck } from './verification/limits';
import type {
  FiatInstructions,
  FiatRoute,
  FiatStatus,
  ProviderFiatQuote,
} from './fiat-provider.interface';

export interface FiatQuote extends ProviderFiatQuote {
  id: string;
  route: FiatRoute;
  /** Absent for simulated routes, which move no real money. */
  verification?: LimitCheck;
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
  /** The provider's on-chain signature for the USDC leg, once reported. */
  settlementSignature?: string;
  /** The transfer that brought a returned send's USDC back to the Account. */
  refundSignature?: string;
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
