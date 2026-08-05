import type { CheckoutEnvelope, CheckoutStatus } from './types';

/** Bump only for a breaking envelope change; consumers ignore unknown versions. */
export const CHECKOUT_PROTOCOL_VERSION = 1 as const;

/** The one origin the checkout surface is ever served from. */
export const CHECKOUT_ORIGIN = 'https://pay.xend.global' as const;

export const CheckoutMessageType = {
  Result: 'xend.checkout.result',
  Cancel: 'xend.checkout.cancel',
} as const;

export function buildResult(
  nonce: string,
  reference: string,
  status: CheckoutStatus,
): CheckoutEnvelope {
  return {
    xend: 'checkout',
    v: CHECKOUT_PROTOCOL_VERSION,
    nonce,
    reference,
    type: CheckoutMessageType.Result,
    status,
  };
}

/** User-initiated close/back-out; carries status 'canceled' by contract. */
export function buildCancel(
  nonce: string,
  reference: string,
): CheckoutEnvelope {
  return {
    xend: 'checkout',
    v: CHECKOUT_PROTOCOL_VERSION,
    nonce,
    reference,
    type: CheckoutMessageType.Cancel,
    status: 'canceled',
  };
}
