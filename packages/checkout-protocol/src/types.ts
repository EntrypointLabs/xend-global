/** Terminal statuses. Single-l 'canceled' is canonical (Stripe-style). */
export type CheckoutStatus = 'succeeded' | 'failed' | 'canceled' | 'expired';

/** The message types that report an outcome, and so carry a reference and a status. */
export type CheckoutTerminalMessageTypeValue =
  | 'xend.checkout.result'
  | 'xend.checkout.cancel';

export type CheckoutMessageTypeValue =
  | 'xend.checkout.ready'
  | CheckoutTerminalMessageTypeValue;

/**
 * Surface-to-merchant envelope. Carries a reference and a status only:
 * no amount, no verified flag. The webhook is the truth signal;
 * this channel is UX convenience. Every terminal message carries a status
 * (cancel carries 'canceled') so status-only consumers need no
 * per-type special case.
 */
export interface CheckoutEnvelope {
  xend: 'checkout';
  v: 1;
  nonce: string;
  reference: string;
  type: CheckoutTerminalMessageTypeValue;
  status: CheckoutStatus;
}

/**
 * The surface's mount handshake. Sent as soon as the surface loads, which can
 * be before an intent exists, so it carries neither a reference nor a status:
 * it reports that the surface is there and nothing else. A frame the checkout
 * refused to be embedded in can never send it, which is what makes it the
 * embedder's proof that the inline ceremony is live.
 */
export interface CheckoutReadyEnvelope {
  xend: 'checkout';
  v: 1;
  nonce: string;
  type: 'xend.checkout.ready';
}
