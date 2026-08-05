/** Terminal statuses. Single-l 'canceled' is canonical (Stripe-style). */
export type CheckoutStatus = 'succeeded' | 'failed' | 'canceled' | 'expired';

export type CheckoutMessageTypeValue =
  | 'xend.checkout.result'
  | 'xend.checkout.cancel';

/**
 * Popup-to-opener envelope. Carries a reference and a status only:
 * no amount, no verified flag. The webhook is the truth signal;
 * this channel is UX convenience. Every message carries a status
 * (cancel carries 'canceled') so status-only consumers need no
 * per-type special case.
 */
export interface CheckoutEnvelope {
  xend: 'checkout';
  v: 1;
  nonce: string;
  reference: string;
  type: CheckoutMessageTypeValue;
  status: CheckoutStatus;
}
